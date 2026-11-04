// فلاتر الكاميرا: ألوان، خلفية (تغبيش/استبدال)، وستيكرات على الوش 😎
// الفيديو بيتعالج على Canvas، والناتج هو اللي بيتبعت للمشاركين.
// موديلات الذكاء الاصطناعي (MediaPipe) بتتحمّل من خادمنا بس لما حد يختار فلتر محتاجها.
(() => {
  'use strict';

  const COLOR = {
    none: '',
    bw: 'grayscale(1) contrast(1.15)',
    vintage: 'sepia(.65) contrast(1.05) saturate(1.2)',
    warm: 'saturate(1.35) sepia(.2) brightness(1.05)',
    cool: 'saturate(1.15) hue-rotate(12deg) brightness(1.04) contrast(1.05)',
    vivid: 'saturate(1.9) contrast(1.15)',
    soft: 'brightness(1.08) contrast(.93) saturate(1.1) blur(.7px)',
    noir: 'grayscale(1) contrast(1.7) brightness(.85)',
    invert: 'invert(1) hue-rotate(180deg)',
  };
  const BG_IMAGES = { brand: '/img/bg-brand.svg', office: '/img/bg-office.svg', space: '/img/bg-space.svg' };

  const state = { color: 'none', bg: 'none', sticker: 'none', fun: 'none' };
  let raw = null; let video = null; let canvas = null; let ctx = null; let out = null; let timer = null;
  let person = null; let pctx = null; let maskCv = null; let mctx = null; let maskData = null;
  const bgImgs = {};
  let vision = null; let faceDet = null; let segmenter = null; let loading = null;
  let lastFaces = []; let lastTs = -1; let frame = 0;

  const needsSeg = () => state.bg !== 'none';
  const needsFace = () => state.sticker !== 'none';
  const active = () => state.color !== 'none' || state.bg !== 'none' || state.sticker !== 'none' || state.fun !== 'none';

  async function loadAI() {
    if (loading) return loading;
    loading = (async () => {
      vision = await import('/vendor/mediapipe/vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
      const opts = (path) => ({ baseOptions: { modelAssetPath: path, delegate: 'GPU' }, runningMode: 'VIDEO' });
      const make = async (Cls, o) => { try { return await Cls.createFromOptions(files, o); } catch { o.baseOptions.delegate = 'CPU'; return Cls.createFromOptions(files, o); } };
      [faceDet, segmenter] = await Promise.all([
        make(vision.FaceDetector, { ...opts('/models/face_detector.tflite'), minDetectionConfidence: 0.5 }),
        make(vision.ImageSegmenter, { ...opts('/models/selfie_segmenter.tflite'), outputCategoryMask: false, outputConfidenceMasks: true }),
      ]);
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  function bgImage(key) {
    if (!bgImgs[key]) { const im = new Image(); im.src = BG_IMAGES[key]; bgImgs[key] = im; }
    return bgImgs[key];
  }

  function drawCover(c, img, w, h) {
    const iw = img.naturalWidth || img.videoWidth || w; const ih = img.naturalHeight || img.videoHeight || h;
    const s = Math.max(w / iw, h / ih);
    c.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
  }

  function updateMask(w, h, ts) {
    const res = segmenter.segmentForVideo(video, ts);
    const m = res.confidenceMasks?.[0];
    if (!m) return false;
    const mw = m.width; const mh = m.height; const arr = m.getAsFloat32Array();
    if (!maskCv || maskCv.width !== mw || maskCv.height !== mh) {
      maskCv = document.createElement('canvas'); maskCv.width = mw; maskCv.height = mh;
      mctx = maskCv.getContext('2d'); maskData = mctx.createImageData(mw, mh);
    }
    const d = maskData.data;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      d[i * 4 + 3] = v < 0.35 ? 0 : v > 0.75 ? 255 : ((v - 0.35) / 0.4) * 255;
    }
    mctx.putImageData(maskData, 0, 0);
    res.close?.();
    return true;
  }

  // ---- الستيكرات ----
  function emoji(c, ch, x, y, size, angle = 0) {
    c.save(); c.translate(x, y); c.rotate(angle);
    c.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, 0, 0); c.restore();
  }
  function drawSticker(c, f, w, h, t) {
    const k = f.keypoints; if (!k || k.length < 6) return;
    const P = (i) => ({ x: k[i].x * w, y: k[i].y * h });
    const re = P(0); const le = P(1); const nose = P(2); const mouth = P(3);
    const eyeD = Math.hypot(le.x - re.x, le.y - re.y);
    const ang = Math.atan2(le.y - re.y, le.x - re.x);
    const mid = { x: (re.x + le.x) / 2, y: (re.y + le.y) / 2 };
    const up = { x: Math.sin(ang), y: -Math.cos(ang) }; // اتجاه فوق الراس
    const bb = f.boundingBox; const top = bb ? bb.originY : mid.y - eyeD * 1.6;
    const headTop = { x: mid.x + up.x * eyeD * 1.55, y: Math.min(mid.y + up.y * eyeD * 1.55, top + eyeD * .2) };
    switch (state.sticker) {
      case 'glasses': emoji(c, '🕶️', mid.x, mid.y + eyeD * .05, eyeD * 2.1, ang); break;
      case 'nerd': emoji(c, '👓', mid.x, mid.y, eyeD * 2.1, ang); break;
      case 'crown': emoji(c, '👑', headTop.x, headTop.y - eyeD * .35, eyeD * 2, ang); break;
      case 'hat': emoji(c, '🎩', headTop.x, headTop.y - eyeD * .6, eyeD * 2.4, ang); break;
      case 'party': {
        c.save(); c.translate(headTop.x, headTop.y); c.rotate(ang + .12);
        const hw = eyeD * .8; const hh = eyeD * 1.9;
        const g = c.createLinearGradient(-hw, 0, hw, 0); g.addColorStop(0, '#7c5cff'); g.addColorStop(.5, '#1faec1'); g.addColorStop(1, '#f472b6');
        c.fillStyle = g; c.beginPath(); c.moveTo(-hw, 0); c.lineTo(0, -hh); c.lineTo(hw, 0); c.closePath(); c.fill();
        c.fillStyle = '#fde047'; for (let i = 1; i < 4; i++) { c.beginPath(); c.arc((i % 2 ? -1 : 1) * hw * .25, -hh * i / 4.2, eyeD * .09, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = '#fff'; c.beginPath(); c.arc(0, -hh, eyeD * .2, 0, Math.PI * 2); c.fill(); c.restore();
        emoji(c, '🎉', headTop.x + eyeD * 1.3, headTop.y, eyeD * .8, ang + .4);
        break;
      }
      case 'clown': {
        c.save(); c.fillStyle = '#ef4444'; c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = eyeD * .15;
        c.beginPath(); c.arc(nose.x, nose.y, eyeD * .3, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.arc(nose.x - eyeD * .09, nose.y - eyeD * .1, eyeD * .08, 0, Math.PI * 2); c.fill(); c.restore();
        break;
      }
      case 'mustache': {
        c.save(); c.translate((nose.x + mouth.x) / 2, nose.y + (mouth.y - nose.y) * .55); c.rotate(ang); c.fillStyle = '#2b1a10';
        const s = eyeD * .62;
        c.beginPath(); c.moveTo(0, 0);
        c.bezierCurveTo(s * .4, -s * .45, s * 1.1, -s * .2, s * 1.3, s * .05); c.bezierCurveTo(s * 1.0, -s * .02, s * .6, s * .3, 0, s * .12);
        c.bezierCurveTo(-s * .6, s * .3, -s * 1.0, -s * .02, -s * 1.3, s * .05); c.bezierCurveTo(-s * 1.1, -s * .2, -s * .4, -s * .45, 0, 0);
        c.fill(); c.restore();
        break;
      }
      case 'cat': {
        c.save(); c.translate(headTop.x, headTop.y); c.rotate(ang);
        for (const sx of [-1, 1]) {
          c.fillStyle = '#f5f5f4'; c.beginPath(); c.moveTo(sx * eyeD * .35, eyeD * .15); c.lineTo(sx * eyeD * .95, -eyeD * .9); c.lineTo(sx * eyeD * 1.2, eyeD * .2); c.fill();
          c.fillStyle = '#f9a8d4'; c.beginPath(); c.moveTo(sx * eyeD * .55, eyeD * .1); c.lineTo(sx * eyeD * .95, -eyeD * .55); c.lineTo(sx * eyeD * 1.07, eyeD * .12); c.fill();
        }
        c.restore();
        c.save(); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = Math.max(1.5, eyeD * .03); c.lineCap = 'round';
        for (const sx of [-1, 1]) for (const dy of [-.1, .05, .2]) { c.beginPath(); c.moveTo(nose.x + sx * eyeD * .25, nose.y + eyeD * dy); c.lineTo(nose.x + sx * eyeD * .9, nose.y + eyeD * (dy * 1.8)); c.stroke(); }
        c.fillStyle = '#f472b6'; c.beginPath(); c.arc(nose.x, nose.y, eyeD * .12, 0, Math.PI * 2); c.fill(); c.restore();
        break;
      }
      case 'hearts': {
        const r = eyeD * 1.35;
        for (let i = 0; i < 5; i++) {
          const a = t / 700 + (i * Math.PI * 2) / 5;
          emoji(c, i % 2 ? '💖' : '💕', headTop.x + Math.cos(a) * r, headTop.y + Math.sin(a) * r * .35 - eyeD * .2, eyeD * .55);
        }
        break;
      }
      case 'stars': emoji(c, '⭐', re.x, re.y, eyeD * .8, t / 400); emoji(c, '⭐', le.x, le.y, eyeD * .8, -t / 400); break;
      case 'dog': {
        c.save(); c.fillStyle = '#7c4a26';
        for (const sx of [-1, 1]) { c.save(); c.translate(headTop.x + sx * eyeD * 1.05, headTop.y + eyeD * .35); c.rotate(ang + sx * .35); c.beginPath(); c.ellipse(0, 0, eyeD * .32, eyeD * .7, 0, 0, Math.PI * 2); c.fill(); c.restore(); }
        c.fillStyle = '#1f1308'; c.beginPath(); c.ellipse(nose.x, nose.y, eyeD * .2, eyeD * .14, ang, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#f472b6'; c.beginPath(); c.ellipse(mouth.x, mouth.y + eyeD * .28, eyeD * .14, eyeD * .24, ang, 0, Math.PI * 2); c.fill(); c.restore();
        break;
      }
      default: break;
    }
  }

  function render() {
    if (!video || video.readyState < 2) return;
    const w = video.videoWidth; const h = video.videoHeight;
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (person.width !== w || person.height !== h) { person.width = w; person.height = h; }
    const t = performance.now();
    let ts = Math.round(t); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
    frame++;
    const colorF = COLOR[state.color] || '';
    const funF = state.fun === 'party' ? `hue-rotate(${(t / 6) % 360}deg) saturate(1.6)` : '';
    const filter = [colorF, funF].filter(Boolean).join(' ') || 'none';
    const aiReady = !!segmenter && !!faceDet;

    // 1) الصورة الأساسية (+ الخلفية)
    if (needsSeg() && aiReady && updateMask(w, h, ts)) {
      ctx.save(); ctx.filter = filter;
      if (state.bg === 'blur') { ctx.filter = `${filter === 'none' ? '' : filter} blur(14px)`; drawCover(ctx, video, w, h); }
      else { const im = bgImage(state.bg); if (im.complete && im.naturalWidth) drawCover(ctx, im, w, h); else { ctx.fillStyle = '#0d1b2e'; ctx.fillRect(0, 0, w, h); } }
      ctx.restore();
      pctx.globalCompositeOperation = 'source-over'; pctx.filter = filter; pctx.clearRect(0, 0, w, h); pctx.drawImage(video, 0, 0, w, h);
      pctx.filter = 'none'; pctx.globalCompositeOperation = 'destination-in'; pctx.drawImage(maskCv, 0, 0, w, h);
      ctx.drawImage(person, 0, 0);
    } else {
      ctx.save(); ctx.filter = filter;
      if (state.fun === 'pixel') {
        const s = 0.07; const pw = Math.max(8, Math.round(w * s)); const ph = Math.max(6, Math.round(h * s));
        pctx.clearRect(0, 0, w, h); pctx.imageSmoothingEnabled = true; pctx.drawImage(video, 0, 0, pw, ph);
        ctx.imageSmoothingEnabled = false; ctx.drawImage(person, 0, 0, pw, ph, 0, 0, w, h); ctx.imageSmoothingEnabled = true;
      } else ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    }

    // 2) مؤثرات مضحكة
    if (state.fun === 'mirror') {
      ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(canvas, 0, 0, w / 2, h, 0, 0, w / 2, h); ctx.restore();
    } else if (state.fun === 'squeeze') {
      pctx.globalCompositeOperation = 'source-over'; pctx.clearRect(0, 0, w, h); pctx.drawImage(canvas, 0, 0);
      ctx.fillStyle = '#0d1b2e'; ctx.fillRect(0, 0, w, h);
      const sq = 0.62 + Math.sin(t / 300) * 0.06; ctx.drawImage(person, 0, 0, w, h, (w - w * sq) / 2, 0, w * sq, h);
    } else if (state.fun === 'stretch') {
      pctx.globalCompositeOperation = 'source-over'; pctx.clearRect(0, 0, w, h); pctx.drawImage(canvas, 0, 0);
      const st = 1.35; ctx.drawImage(person, 0, 0, w, h, (w - w * st) / 2, 0, w * st, h);
    } else if (state.fun === 'tv') {
      ctx.save(); ctx.globalAlpha = .18; ctx.fillStyle = '#000';
      for (let y = (frame * 2) % 4; y < h; y += 4) ctx.fillRect(0, y, w, 2);
      ctx.restore();
      const g = ctx.createRadialGradient(w / 2, h / 2, h * .3, w / 2, h / 2, h * .85); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }

    // 3) ستيكرات الوش
    if (needsFace() && aiReady) {
      if (frame % 2 === 0) { try { lastFaces = faceDet.detectForVideo(video, ts).detections || []; } catch { /* ignore */ } }
      for (const f of lastFaces) {
        const k = f.keypoints;
        if (state.fun === 'mirror' && k?.[2] && k[2].x < 0.5) continue; // الوش اللي في النص المعكوس
        drawSticker(ctx, f, w, h, t);
      }
    }
  }

  function startLoop() { stopLoop(); timer = setInterval(render, 1000 / 24); }
  function stopLoop() { clearInterval(timer); timer = null; }

  // يرجّع Track الفيديو بعد الفلاتر (أو الأصلي لو مفيش فلتر)
  async function apply(cameraTrack) {
    if (!cameraTrack || !active()) { stop(); return cameraTrack; }
    if (needsSeg() || needsFace()) {
      try { await loadAI(); } catch (e) { console.error('filters AI failed', e); window.dispatchEvent(new CustomEvent('camfx-error')); }
    }
    if (raw === cameraTrack && out && out.readyState === 'live') return out;
    stop();
    raw = cameraTrack;
    video = document.createElement('video'); video.muted = true; video.playsInline = true;
    video.srcObject = new MediaStream([raw]);
    await video.play().catch(() => {});
    canvas = document.createElement('canvas'); ctx = canvas.getContext('2d');
    person = document.createElement('canvas'); pctx = person.getContext('2d');
    const st = raw.getSettings(); canvas.width = st.width || 1280; canvas.height = st.height || 720;
    render();
    out = canvas.captureStream(24).getVideoTracks()[0];
    startLoop();
    return out;
  }
  function stop() {
    stopLoop();
    out?.stop(); out = null;
    if (video) { video.srcObject = null; video = null; }
    raw = null;
  }

  window.CamFX = {
    state,
    set(kind, value) { state[kind] = value; },
    active, apply, stop,
    needsAI: () => needsSeg() || needsFace(),
    aiReady: () => !!segmenter && !!faceDet,
    preload: () => loadAI(),
  };
})();
