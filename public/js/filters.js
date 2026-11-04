// فلاتر البشرة (تجميل طبيعي)
// - تتبع الوش (MediaPipe Face Landmarker) علشان التأثير يبقى على البشرة بس
// - تنعيم وتصفية ولون للبشرة على الـ GPU (WebGL2) — من غير تغيير الملامح
// كل المعالجة على جهاز الشخص، والناتج هو اللي بيتبعت للاجتماع.
(() => {
  'use strict';

  // ---------- نقاط الوش (Face Mesh) ----------
  const I = {
    rEyeOut: 33, rEyeIn: 133, lEyeIn: 362, lEyeOut: 263, rIris: 468, lIris: 473,
    noseTip: 4, betweenEyes: 168, forehead: 10, chin: 152,
    upLipIn: 13, lowLipIn: 14, rCheek: 50, lCheek: 280, rFace: 234, lFace: 454,
    rJaw: [172, 136], lJaw: [397, 365],
  };

  // ---------- فلاتر البشرة ----------
  // smooth: تنعيم | lift: إشراقة | tint: لون البشرة (R,G,B)
  const LENSES = {
    none: {},
    light: { smooth: .45, lift: .015 },
    smooth: { smooth: .8, lift: .025 },
    clear: { smooth: 1, lift: .035, tint: [1.02, 1.01, 1.0] },
    fresh: { smooth: .7, lift: .03, tint: [1.05, 1.0, 1.0] },
    glow: { smooth: .7, lift: .06, tint: [1.03, 1.02, 1.0] },
    bronze: { smooth: .65, lift: .01, tint: [1.06, 1.0, .9] },
    fair: { smooth: .7, lift: .07, tint: [1.0, 1.01, 1.03] },
  };
  const COLOR = {
    none: '', bw: 'grayscale(1) contrast(1.15)', vintage: 'sepia(.65) contrast(1.05) saturate(1.2)', warm: 'saturate(1.35) sepia(.2) brightness(1.05)',
    cool: 'saturate(1.15) hue-rotate(12deg) brightness(1.04) contrast(1.05)', vivid: 'saturate(1.9) contrast(1.15)', noir: 'grayscale(1) contrast(1.7) brightness(.85)',
  };
  const BG_IMAGES = { brand: '/img/bg-brand.svg', office: '/img/bg-office.svg', space: '/img/bg-space.svg' };

  const state = { lens: 'none', bg: 'none', color: 'none' };
  const lens = () => LENSES[state.lens] || LENSES.none;
  const needsFace = () => state.lens !== 'none' && !!LENSES[state.lens];
  const needsSeg = () => state.bg !== 'none';
  const active = () => needsFace() || needsSeg() || state.color !== 'none';

  // ---------- تحميل الذكاء الاصطناعي ----------
  let landmarker = null; let segmenter = null; let loading = null;
  async function loadAI() {
    if (loading) return loading;
    loading = (async () => {
      const vision = await import('/vendor/mediapipe/vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
      const make = async (Cls, o) => {
        try { return await Cls.createFromOptions(files, { ...o, baseOptions: { ...o.baseOptions, delegate: 'GPU' } }); }
        catch { return Cls.createFromOptions(files, { ...o, baseOptions: { ...o.baseOptions, delegate: 'CPU' } }); }
      };
      [landmarker, segmenter] = await Promise.all([
        make(vision.FaceLandmarker, { baseOptions: { modelAssetPath: '/models/face_landmarker.task' }, runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: true }),
        make(vision.ImageSegmenter, { baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite' }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true }),
      ]);
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  // ---------- WebGL: تعديل الملامح + التنعيم ----------
  const MAXW = 16;
  const VS = `#version 300 es
  in vec2 p; out vec2 uv;
  void main(){ uv = vec2(p.x*.5+.5, .5-p.y*.5); gl_Position = vec4(p,0.,1.); }`;
  const FS = `#version 300 es
  precision highp float;
  uniform sampler2D tex; uniform vec2 res; uniform int n;
  uniform vec4 wa[${MAXW}]; uniform vec4 wb[${MAXW}];
  uniform int nf; uniform vec4 face[2]; uniform float fang[2];
  uniform float smoothAmt; uniform float bright; uniform float lift; uniform vec3 tint;
  in vec2 uv; out vec4 o;
  void main(){
    vec2 px = uv*res; vec2 q = px;
    for (int i=0;i<${MAXW};i++){ if(i>=n) break;
      vec2 c = wa[i].xy; float r = wa[i].z; float s = wa[i].w;
      vec2 d = px-c; float t = length(d)/r;
      if (t<1.){ float w = 1.-t*t; w*=w;
        if (wb[i].x<.5) q -= d*s*w;
        else q -= wb[i].yz*s*w;
      }
    }
    vec4 col = texture(tex, q/res);
    if (smoothAmt>0.){
      float m = 0.;
      for (int f=0; f<2; f++){ if(f>=nf) break;
        vec2 fd = px-face[f].xy; float ca=cos(fang[f]), sa=sin(fang[f]);
        vec2 fr = vec2(ca*fd.x+sa*fd.y, -sa*fd.x+ca*fd.y);
        m = max(m, 1.-smoothstep(.72, 1., length(fr/face[f].zw)));
      }
      if (m>0.){
        vec3 acc = col.rgb; float ws = 1.; float rad = max(1.5, face[0].z*.028);
        for (int k=0;k<12;k++){ float a = float(k)*.5236;
          for (int j=1;j<=2;j++){ vec2 off = vec2(cos(a),sin(a))*rad*float(j)*.75;
            vec3 c2 = texture(tex,(q+off)/res).rgb; vec3 dd = c2-col.rgb;
            float w2 = exp(-dot(dd,dd)*55.); acc += c2*w2; ws += w2; } }
        vec3 sm = acc/ws; float k2 = m*smoothAmt;
        col.rgb = mix(col.rgb, sm, k2);
        col.rgb = mix(col.rgb, col.rgb*tint + lift, m);
      }
    }
    o = vec4(clamp(col.rgb*bright,0.,1.),1.);
  }`;
  let glc = null; let gl = null; let texture = null; const U = {};
  function initGL() {
    if (gl) return true;
    glc = document.createElement('canvas');
    gl = glc.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) return false;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    for (const n of ['tex', 'res', 'n', 'wa', 'wb', 'nf', 'face', 'fang', 'smoothAmt', 'bright', 'lift', 'tint']) U[n] = gl.getUniformLocation(prog, n);
    return true;
  }

  // ---------- أدوات ----------
  const faces = [];
  const P = (f, i) => f.pts[i];
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const add = (p, v, k) => ({ x: p.x + v.x * k, y: p.y + v.y * k });
  const bs = (f, name) => f.shapes?.[name] || 0;
  function geom(f) {
    const ro = P(f, I.rEyeOut); const lo = P(f, I.lEyeOut);
    const eye = dist(ro, lo) / 2.1;
    const ang = Math.atan2(lo.y - ro.y, lo.x - ro.x);
    const right = { x: Math.cos(ang), y: Math.sin(ang) };
    const down = { x: -Math.sin(ang), y: Math.cos(ang) };
    const up = { x: -down.x, y: -down.y };
    const fh = P(f, I.forehead); const ch = P(f, I.chin);
    return {
      eye, ang, right, down, up,
      headTop: add(fh, up, eye * .55), center: mid(fh, ch),
      rx: dist(P(f, I.rFace), P(f, I.lFace)) / 2, ry: dist(fh, ch) / 2 * 1.08,
    };
  }

  // ---------- خط الإنتاج ----------
  let raw = null; let video = null; let canvas = null; let ctx = null; let out = null; let timer = null;
  let person = null; let pctx = null; let maskCv = null; let mctx = null; let maskData = null; let lastTs = -1;
  const bgImgs = {};
  const bgImage = (k) => { if (!bgImgs[k]) { const im = new Image(); im.src = BG_IMAGES[k]; bgImgs[k] = im; } return bgImgs[k]; };
  function drawCover(c, img, w, h) {
    const iw = img.naturalWidth || img.videoWidth || w; const ih = img.naturalHeight || img.videoHeight || h;
    const s = Math.max(w / iw, h / ih); c.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
  }
  function updateMask(ts) {
    const res = segmenter.segmentForVideo(video, ts); const m = res.confidenceMasks?.[0]; if (!m) return false;
    const mw = m.width; const mh = m.height; const arr = m.getAsFloat32Array();
    if (!maskCv || maskCv.width !== mw || maskCv.height !== mh) { maskCv = document.createElement('canvas'); maskCv.width = mw; maskCv.height = mh; mctx = maskCv.getContext('2d'); maskData = mctx.createImageData(mw, mh); }
    const d = maskData.data;
    for (let i = 0; i < arr.length; i++) { const v = arr[i]; d[i * 4 + 3] = v < .35 ? 0 : v > .75 ? 255 : ((v - .35) / .4) * 255; }
    mctx.putImageData(maskData, 0, 0); res.close?.(); return true;
  }
  function track(ts, w, h) {
    let res; try { res = landmarker.detectForVideo(video, ts); } catch { return; }
    const list = res.faceLandmarks || [];
    faces.length = Math.min(faces.length, list.length);
    list.forEach((lm, k) => {
      const shapes = {}; (res.faceBlendshapes?.[k]?.categories || []).forEach((c) => { shapes[c.categoryName] = c.score; });
      const pts = lm.map((p) => ({ x: p.x * w, y: p.y * h }));
      const prev = faces[k];
      if (prev && prev.pts.length === pts.length && dist(prev.pts[1], pts[1]) < w * .08) { // تنعيم الحركة (من غير رعشة)
        for (let i = 0; i < pts.length; i++) { prev.pts[i].x += (pts[i].x - prev.pts[i].x) * .6; prev.pts[i].y += (pts[i].y - prev.pts[i].y) * .6; }
        prev.shapes = shapes;
      } else faces[k] = { pts, shapes };
    });
  }

  function render() {
    if (!video || video.readyState < 2) return;
    const w = video.videoWidth; const h = video.videoHeight; if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (person.width !== w || person.height !== h) { person.width = w; person.height = h; }
    const t = performance.now(); let ts = Math.round(t); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
    const L = lens();
    if (needsFace() && landmarker) track(ts, w, h); else faces.length = 0;

    // 1) الوش: الملامح والتنعيم على الـ GPU
    let src = video;
    if (needsFace() && gl && faces.length) {
      if (glc.width !== w || glc.height !== h) { glc.width = w; glc.height = h; gl.viewport(0, 0, w, h); }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      const wa = new Float32Array(MAXW * 4); const wb = new Float32Array(MAXW * 4); let n = 0;
      const fc = new Float32Array(8); const fa = new Float32Array(2);
      faces.slice(0, 2).forEach((f, k) => {
        const g = geom(f);
        fc.set([g.center.x, g.center.y, g.rx * 1.05, g.ry], k * 4); fa[k] = g.ang;
      });
      gl.uniform1i(U.tex, 0); gl.uniform2f(U.res, w, h); gl.uniform1i(U.n, n);
      gl.uniform4fv(U.wa, wa); gl.uniform4fv(U.wb, wb);
      gl.uniform1i(U.nf, Math.min(2, faces.length)); gl.uniform4fv(U.face, fc); gl.uniform1fv(U.fang, fa);
      gl.uniform1f(U.smoothAmt, L.smooth || 0); gl.uniform1f(U.bright, 1);
      gl.uniform1f(U.lift, L.lift || 0); gl.uniform3fv(U.tint, L.tint || [1, 1, 1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = glc;
    }
    const filter = COLOR[state.color] || 'none';

    // 2) الخلفية
    if (needsSeg() && segmenter && updateMask(ts)) {
      ctx.save(); ctx.filter = filter;
      if (state.bg === 'blur') { ctx.filter = `${filter === 'none' ? '' : filter} blur(14px)`; drawCover(ctx, video, w, h); }
      else { const im = bgImage(state.bg); if (im.complete && im.naturalWidth) drawCover(ctx, im, w, h); else { ctx.fillStyle = '#0d1b2e'; ctx.fillRect(0, 0, w, h); } }
      ctx.restore();
      pctx.globalCompositeOperation = 'source-over'; pctx.filter = filter; pctx.clearRect(0, 0, w, h); pctx.drawImage(src, 0, 0, w, h);
      pctx.filter = 'none'; pctx.globalCompositeOperation = 'destination-in'; pctx.drawImage(maskCv, 0, 0, w, h);
      ctx.drawImage(person, 0, 0);
    } else {
      ctx.save(); ctx.filter = filter; ctx.drawImage(src, 0, 0, w, h); ctx.restore();
    }

  }

  function startLoop() { stopLoop(); timer = setInterval(render, 1000 / 24); }
  function stopLoop() { clearInterval(timer); timer = null; }

  async function apply(cameraTrack) {
    if (!cameraTrack || !active()) { stop(); return cameraTrack; }
    if (needsFace() || needsSeg()) {
      try { await loadAI(); } catch (e) { console.error('filters AI failed', e); window.dispatchEvent(new CustomEvent('camfx-error')); }
    }
    if (needsFace()) { try { initGL(); } catch (e) { console.error('webgl failed', e); gl = null; } }
    if (raw === cameraTrack && out && out.readyState === 'live') return out;
    stop();
    raw = cameraTrack;
    video = document.createElement('video'); video.muted = true; video.playsInline = true;
    video.srcObject = new MediaStream([raw]); await video.play().catch(() => {});
    canvas = document.createElement('canvas'); ctx = canvas.getContext('2d');
    person = document.createElement('canvas'); pctx = person.getContext('2d');
    const st = raw.getSettings(); canvas.width = st.width || 1280; canvas.height = st.height || 720;
    render();
    out = canvas.captureStream(24).getVideoTracks()[0];
    startLoop();
    return out;
  }
  function stop() { stopLoop(); out?.stop(); out = null; if (video) { video.srcObject = null; video = null; } raw = null; faces.length = 0; }

  window.CamFX = {
    state,
    set(kind, value) { state[kind] = value; },
    active, apply, stop,
    needsAI: () => needsFace() || needsSeg(),
    aiReady: () => !!landmarker && !!segmenter,
    debug: () => ({ gl: !!gl, faces: faces.length, glErr: gl ? gl.getError() : null }),
  };
})();
