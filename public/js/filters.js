// فلاتر الوش بأسلوب سناب شات وإنستجرام (AR Lenses)
// - تتبع 478 نقطة في الوش + تعبيرات الوش (MediaPipe Face Landmarker)
// - تعديل ملامح الوش وتنعيم البشرة على الـ GPU (WebGL2)
// - مكياج وأقنعة متحركة بترسم فوق الوش وبتتحرك معاه
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
  const LIPS_OUT = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
  const LIPS_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
  const R_LID = [33, 246, 161, 160, 159, 158, 157, 173, 133];
  const L_LID = [263, 466, 388, 387, 386, 385, 384, 398, 362];

  // ---------- العدسات ----------
  // warp: ملامح | smooth: تنعيم | css: ألوان | draw: رسومات فوق الوش
  const LENSES = {
    none: {},
    beauty: { smooth: .85, bright: 1.05, warp: { eyes: .14, slim: .09, nose: -.12 }, css: 'saturate(1.08) contrast(1.02)' },
    makeup: { smooth: .8, bright: 1.04, warp: { eyes: .12, slim: .08, nose: -.1 }, draw: ['blush', 'lips', 'liner'] },
    glam: { smooth: .9, bright: 1.06, warp: { eyes: .16, slim: .12, nose: -.14 }, draw: ['blush', 'lips', 'liner', 'freckles', 'sparkles'], css: 'saturate(1.12) sepia(.12)' },
    dog: { smooth: .55, warp: { eyes: .1 }, draw: ['dog'] },
    cat: { smooth: .65, warp: { eyes: .14, slim: .08 }, draw: ['cat', 'blush'] },
    flowers: { smooth: .75, bright: 1.04, warp: { eyes: .1, slim: .06 }, draw: ['flowers', 'blush'], css: 'saturate(1.1)' },
    butterfly: { smooth: .7, warp: { eyes: .1 }, draw: ['butterflies', 'sparkles'] },
    hearts: { smooth: .6, draw: ['heartEyes', 'floatHearts', 'blush'] },
    gold: { smooth: .7, bright: 1.05, draw: ['freckles', 'sparkles'], css: 'sepia(.25) saturate(1.25) contrast(1.05)' },
    glasses: { smooth: .5, draw: ['glasses'] },
    baby: { smooth: 1, bright: 1.06, warp: { eyes: .38, nose: -.3, mouth: -.28, slim: .14 }, draw: ['blush'] },
    alien: { warp: { eyes: .6, mouth: -.35, chin: .7, forehead: .28 }, css: 'hue-rotate(75deg) saturate(1.4)' },
    bigmouth: { warp: { mouth: .55, nose: .25 } },
    bignose: { warp: { nose: .62 } },
    thin: { warp: { slim: .38, chin: .35 } },
    chubby: { warp: { slim: -.32, cheeks: .3 } },
  };
  const COLOR = {
    none: '', bw: 'grayscale(1) contrast(1.15)', vintage: 'sepia(.65) contrast(1.05) saturate(1.2)', warm: 'saturate(1.35) sepia(.2) brightness(1.05)',
    cool: 'saturate(1.15) hue-rotate(12deg) brightness(1.04) contrast(1.05)', vivid: 'saturate(1.9) contrast(1.15)', noir: 'grayscale(1) contrast(1.7) brightness(.85)',
  };
  const BG_IMAGES = { brand: '/img/bg-brand.svg', office: '/img/bg-office.svg', space: '/img/bg-space.svg' };

  const state = { lens: 'none', bg: 'none', color: 'none' };
  const lens = () => LENSES[state.lens] || LENSES.none;
  const needsFace = () => state.lens !== 'none';
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
  uniform float smoothAmt; uniform float bright;
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
        col.rgb = mix(col.rgb, col.rgb*1.06+.015, k2*.6);
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
    for (const n of ['tex', 'res', 'n', 'wa', 'wb', 'nf', 'face', 'fang', 'smoothAmt', 'bright']) U[n] = gl.getUniformLocation(prog, n);
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

  function warpsFor(f, g, w) {
    const out = []; if (!w) return out;
    const E = g.eye * 2; // وحدة القياس ≈ المسافة بين العينين
    const push = (c, r, s, dir) => out.push({ c, r: r * 2, s: dir ? s * 2 : s, dir });
    const inward = (side) => ({ x: -g.right.x * side, y: -g.right.y * side });
    if (w.eyes) { push(P(f, I.rIris), g.eye * .5, w.eyes); push(P(f, I.lIris), g.eye * .5, w.eyes); }
    if (w.nose) push(P(f, I.noseTip), g.eye * .45, w.nose);
    if (w.mouth) push(mid(P(f, I.upLipIn), P(f, I.lowLipIn)), g.eye * .85, w.mouth);
    if (w.forehead) push(add(P(f, I.forehead), g.down, g.eye * .2), g.eye * 1.2, w.forehead);
    if (w.slim) for (const [ids, side] of [[I.rJaw, -1], [I.lJaw, 1]]) for (const id of ids) push(P(f, id), g.eye * 1.05, g.eye * w.slim * .55, inward(side));
    if (w.cheeks) for (const [id, side] of [[I.rCheek, -1], [I.lCheek, 1]]) push(P(f, id), g.eye * 1.1, g.eye * w.cheeks * .5, inward(-side));
    if (w.chin) push(P(f, I.chin), g.eye * 1.1, g.eye * w.chin * .4, g.up);
    return out;
  }

  // ---------- الرسومات فوق الوش ----------
  const emo = (c, ch, x, y, size, rot = 0, sx = 1) => {
    if (size < 2) return;
    c.save(); c.translate(x, y); c.rotate(rot); c.scale(sx, 1);
    c.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, 0, 0); c.restore();
  };
  const poly = (c, f, ids) => { ids.forEach((id, k) => { const p = P(f, id); if (k) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.closePath(); };
  const seeded = (n, seed) => { let s = seed; const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; return Array.from({ length: n }, () => [r(), r()]); };
  const FRECKLES = seeded(46, 7);
  const SPARK = seeded(14, 3);
  const hearts = [];

  const DRAW = {
    lips(c, f) {
      c.save(); c.beginPath(); poly(c, f, LIPS_OUT); poly(c, f, LIPS_IN);
      c.globalCompositeOperation = 'multiply'; c.fillStyle = 'rgba(214,40,86,.55)'; c.fill('evenodd');
      c.globalCompositeOperation = 'soft-light'; c.fillStyle = 'rgba(255,120,150,.5)'; c.fill('evenodd'); c.restore();
    },
    blush(c, f, g) {
      for (const id of [I.rCheek, I.lCheek]) {
        const p = add(P(f, id), g.down, g.eye * .05);
        const gr = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, g.eye * .55);
        gr.addColorStop(0, 'rgba(255,92,128,.30)'); gr.addColorStop(1, 'rgba(255,92,128,0)');
        c.fillStyle = gr; c.beginPath(); c.arc(p.x, p.y, g.eye * .55, 0, Math.PI * 2); c.fill();
      }
    },
    liner(c, f, g) {
      c.save(); c.strokeStyle = 'rgba(25,15,20,.85)'; c.lineWidth = Math.max(1.5, g.eye * .045); c.lineCap = 'round'; c.lineJoin = 'round';
      for (const [ids, side] of [[R_LID, -1], [L_LID, 1]]) {
        c.beginPath(); ids.forEach((id, k) => { const p = P(f, id); if (k) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.stroke();
        const o = P(f, ids[0]); const wing = add(add(o, g.right, side * g.eye * .22), g.up, g.eye * .12);
        c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(wing.x, wing.y); c.stroke();
      }
      c.restore();
    },
    freckles(c, f, g) {
      const a = P(f, I.betweenEyes); c.save(); c.fillStyle = 'rgba(122,62,32,.38)';
      for (const [u, v] of FRECKLES) {
        const side = u < .5 ? -1 : 1; const uu = Math.abs(u - .5) * 2 * 1.15 + .12;
        const p = add(add(a, g.right, side * uu * g.eye), g.down, (.55 + v * .55) * g.eye);
        c.beginPath(); c.arc(p.x, p.y, g.eye * (.018 + v * .012), 0, Math.PI * 2); c.fill();
      }
      c.restore();
    },
    sparkles(c, f, g, t) {
      c.save();
      SPARK.forEach(([u, v], k) => {
        const tw = (Math.sin(t / 240 + k * 1.7) + 1) / 2; if (tw < .25) return;
        const p = add(add(g.center, g.right, (u - .5) * g.rx * 2.6), g.up, (v - .35) * g.ry * 2.4);
        const s = g.eye * (.06 + tw * .1);
        c.fillStyle = `rgba(255,236,170,${.35 + tw * .6})`; c.beginPath();
        for (let i = 0; i < 8; i++) { const r = i % 2 ? s * .25 : s; const a = (i * Math.PI) / 4 + t / 900; c.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r); }
        c.closePath(); c.fill();
      });
      c.restore();
    },
    dog(c, f, g) {
      for (const side of [-1, 1]) {
        const base = add(add(g.headTop, g.right, side * g.eye * 1.05), g.down, g.eye * .35);
        c.save(); c.translate(base.x, base.y); c.rotate(g.ang + side * .38);
        const gr = c.createLinearGradient(0, -g.eye * .8, 0, g.eye * .8); gr.addColorStop(0, '#8a5a32'); gr.addColorStop(1, '#5c3a1e');
        c.fillStyle = gr; c.beginPath(); c.ellipse(0, g.eye * .2, g.eye * .38, g.eye * .82, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(240,170,170,.55)'; c.beginPath(); c.ellipse(0, g.eye * .28, g.eye * .2, g.eye * .55, 0, 0, Math.PI * 2); c.fill(); c.restore();
      }
      const n = P(f, I.noseTip);
      c.save(); c.translate(n.x, n.y); c.rotate(g.ang);
      c.fillStyle = '#1d1410'; c.beginPath(); c.ellipse(0, 0, g.eye * .3, g.eye * .21, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.45)'; c.beginPath(); c.ellipse(-g.eye * .08, -g.eye * .07, g.eye * .09, g.eye * .05, -.3, 0, Math.PI * 2); c.fill(); c.restore();
      const open = bs(f, 'jawOpen');
      if (open > .18) { // اللسان بيطلع لما تفتح بقك 👅
        const top = P(f, I.lowLipIn); const len = g.eye * (.35 + open * 1.1); const tw = g.eye * .26;
        c.save(); c.translate(top.x, top.y - g.eye * .05); c.rotate(g.ang);
        const gr = c.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, '#e2557a'); gr.addColorStop(1, '#ff8fab');
        c.fillStyle = gr; c.beginPath(); c.moveTo(-tw, 0); c.lineTo(-tw, len - tw);
        c.quadraticCurveTo(-tw, len, 0, len); c.quadraticCurveTo(tw, len, tw, len - tw); c.lineTo(tw, 0); c.fill();
        c.strokeStyle = 'rgba(160,30,60,.5)'; c.lineWidth = g.eye * .03; c.beginPath(); c.moveTo(0, g.eye * .08); c.lineTo(0, len * .7); c.stroke(); c.restore();
      }
    },
    cat(c, f, g) {
      for (const side of [-1, 1]) {
        const b = add(add(g.headTop, g.right, side * g.eye * .82), g.down, g.eye * .15);
        c.save(); c.translate(b.x, b.y); c.rotate(g.ang + side * .2);
        c.fillStyle = '#2b2b33'; c.beginPath(); c.moveTo(-g.eye * .42, g.eye * .2); c.lineTo(side * g.eye * .1, -g.eye * .78); c.lineTo(g.eye * .42, g.eye * .2); c.fill();
        c.fillStyle = '#f9a8d4'; c.beginPath(); c.moveTo(-g.eye * .22, g.eye * .12); c.lineTo(side * g.eye * .07, -g.eye * .45); c.lineTo(g.eye * .22, g.eye * .12); c.fill(); c.restore();
      }
      const n = P(f, I.noseTip);
      c.save(); c.translate(n.x, n.y); c.rotate(g.ang);
      c.fillStyle = '#f472b6'; c.beginPath(); c.moveTo(-g.eye * .13, -g.eye * .06); c.lineTo(g.eye * .13, -g.eye * .06); c.lineTo(0, g.eye * .1); c.fill();
      c.strokeStyle = 'rgba(30,30,35,.8)'; c.lineWidth = Math.max(1.2, g.eye * .025); c.lineCap = 'round';
      for (const side of [-1, 1]) for (const dy of [-.08, .06, .2]) { c.beginPath(); c.moveTo(side * g.eye * .3, g.eye * dy); c.lineTo(side * g.eye * 1.05, g.eye * dy * 1.9); c.stroke(); }
      c.restore();
    },
    flowers(c, f, g) {
      const fl = ['🌸', '🌼', '🌺', '🌷', '🌸', '🌼', '🌺', '🌸', '🌼'];
      fl.forEach((ch, k) => {
        const a = -1.35 + (k * 2.7) / (fl.length - 1);
        const p = add(add(g.headTop, g.right, Math.sin(a) * g.eye * 1.35), g.down, (1 - Math.cos(a)) * g.eye * .55 + g.eye * .15);
        emo(c, ch, p.x, p.y, g.eye * (k % 2 ? .5 : .62), g.ang + a * .4);
      });
    },
    butterflies(c, f, g, t) {
      for (let i = 0; i < 3; i++) {
        const a = t / 1100 + i * 2.09;
        const p = add(add(g.headTop, g.right, Math.cos(a) * g.eye * 1.75), g.up, Math.sin(a * 1.3) * g.eye * .45 + g.eye * .2);
        emo(c, '🦋', p.x, p.y, g.eye * .6, g.ang + Math.sin(a) * .3, .35 + Math.abs(Math.sin(t / 110 + i)) * .65);
      }
    },
    heartEyes(c, f, g, t) { // عيون قلوب لما تضحك 😍
      const smile = (bs(f, 'mouthSmileLeft') + bs(f, 'mouthSmileRight')) / 2;
      if (smile < .3) return;
      const k = Math.min(1, (smile - .3) / .3); const pulse = 1 + Math.sin(t / 140) * .12;
      for (const id of [I.rIris, I.lIris]) { const p = P(f, id); emo(c, '❤️', p.x, p.y, g.eye * .62 * k * pulse, g.ang); }
    },
    floatHearts(c, f, g) {
      if (Math.random() < .08) hearts.push({ x: g.center.x + (Math.random() - .5) * g.rx * 2.2, y: g.center.y + g.ry * .3, vy: -(1 + Math.random() * 1.5) * g.eye * .02, life: 1, s: g.eye * (.25 + Math.random() * .25) });
      for (const h of hearts) { h.y += h.vy * 3; h.life -= .015; c.globalAlpha = Math.max(0, h.life); emo(c, '💗', h.x + Math.sin(h.life * 8) * g.eye * .1, h.y, h.s); }
      c.globalAlpha = 1;
      for (let i = hearts.length - 1; i >= 0; i--) if (hearts[i].life <= 0) hearts.splice(i, 1);
    },
    glasses(c, f, g) {
      c.save(); c.lineWidth = Math.max(2, g.eye * .07); c.strokeStyle = '#151318'; c.lineJoin = 'round';
      const centers = [mid(P(f, I.rEyeOut), P(f, I.rEyeIn)), mid(P(f, I.lEyeIn), P(f, I.lEyeOut))];
      for (const p of centers) {
        c.save(); c.translate(p.x, p.y); c.rotate(g.ang);
        const rw = g.eye * .5; const rh = g.eye * .38;
        c.beginPath(); if (c.roundRect) c.roundRect(-rw, -rh * .9, rw * 2, rh * 1.9, g.eye * .14); else c.rect(-rw, -rh * .9, rw * 2, rh * 1.9);
        const gr = c.createLinearGradient(0, -rh, 0, rh); gr.addColorStop(0, 'rgba(60,40,90,.55)'); gr.addColorStop(1, 'rgba(31,174,193,.25)');
        c.fillStyle = gr; c.fill(); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = g.eye * .03; c.beginPath(); c.moveTo(-rw * .6, -rh * .5); c.lineTo(-rw * .1, -rh * .7); c.stroke(); c.restore();
      }
      const a = add(centers[0], g.right, g.eye * .5); const b = add(centers[1], g.right, -g.eye * .5);
      c.beginPath(); c.moveTo(a.x, a.y); c.quadraticCurveTo((a.x + b.x) / 2 + g.up.x * g.eye * .15, (a.y + b.y) / 2 + g.up.y * g.eye * .15, b.x, b.y); c.stroke();
      c.restore();
    },
  };

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
        for (const x of warpsFor(f, g, L.warp)) {
          if (n >= MAXW) break;
          wa.set([x.c.x, x.c.y, x.r, x.s], n * 4);
          wb.set(x.dir ? [1, x.dir.x, x.dir.y, 0] : [0, 0, 0, 0], n * 4); n++;
        }
      });
      gl.uniform1i(U.tex, 0); gl.uniform2f(U.res, w, h); gl.uniform1i(U.n, n);
      gl.uniform4fv(U.wa, wa); gl.uniform4fv(U.wb, wb);
      gl.uniform1i(U.nf, Math.min(2, faces.length)); gl.uniform4fv(U.face, fc); gl.uniform1fv(U.fang, fa);
      gl.uniform1f(U.smoothAmt, L.smooth || 0); gl.uniform1f(U.bright, L.bright || 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = glc;
    }
    const filter = [COLOR[state.color], L.css].filter(Boolean).join(' ') || 'none';

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

    // 3) المكياج والأقنعة
    if (L.draw && faces.length) for (const f of faces) { const g = geom(f); for (const d of L.draw) DRAW[d]?.(ctx, f, g, t); }
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
