// شخصيات المجسم: رجل بالثوب والشماغ، امرأة بالعباءة، وموظف بلباس عملي.
// مبنية من أشكال بسيطة بمفاصل (كتف، ورك، ركبة) لتتحرك بلطف: مشي، توقف، جلوس وكتابة.
type Three = typeof import("three");
type Obj = InstanceType<Three["Object3D"]>;
type Mat = InstanceType<Three["MeshStandardMaterial"]>;

export type Outfit = "thobe" | "abaya" | "casual";

export type Person = {
  root: InstanceType<Three["Group"]>;
  body: Obj;
  head: Obj;
  arms: [Obj, Obj];
  thighs: [Obj, Obj];
  shins: [Obj, Obj];
  skirt: Obj | null;
  seed: number;
};

const SKINS = [0xd7a982, 0xc08a63, 0xa8734f, 0x8a5a3c, 0xe3b995];

export function createPeopleKit(THREE: Three) {
  const std = (color: number, roughness = 0.85, extra: Partial<ConstructorParameters<Three["MeshStandardMaterial"]>[0]> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, ...extra });

  // نقشة الشماغ الأحمر المربّع
  const shemaghTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const x = c.getContext("2d")!;
    x.fillStyle = "#f4f1ea";
    x.fillRect(0, 0, 32, 32);
    x.fillStyle = "#b3202c";
    for (let i = 0; i < 32; i += 8) {
      x.fillRect(i, 0, 3, 32);
      x.fillRect(0, i, 32, 3);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    return t;
  })();

  const m = {
    thobe: std(0xf3f1ea, 0.9),
    abaya: std(0x15151a, 0.7, { metalness: 0.05 }),
    shemagh: std(0xffffff, 0.9, { map: shemaghTex }),
    ghutra: std(0xf7f7f4, 0.9),
    agal: std(0x0d0d0f, 0.5),
    sandal: std(0x4a3426, 0.8),
    shoe: std(0x1b1b1f, 0.5),
    blazer: std(0x1d3557, 0.75),
    shirt: std(0xe8edf3, 0.8),
    trousers: std(0x2e3440, 0.8),
    hair: std(0x1b1410, 0.9),
    skins: SKINS.map((c) => std(c, 0.65)),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
  };

  // أشكال مشتركة لتخفيف الذاكرة
  const lathe = (pts: [number, number][]) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 18);
  const g = {
    thobe: lathe([[0.001, 0.1], [0.26, 0.1], [0.235, 0.45], [0.205, 0.85], [0.2, 1.18], [0.225, 1.36], [0.17, 1.47], [0.06, 1.52], [0.001, 1.52]]),
    abaya: lathe([[0.001, 0.04], [0.29, 0.04], [0.255, 0.42], [0.2, 0.86], [0.185, 1.15], [0.205, 1.34], [0.16, 1.45], [0.06, 1.5], [0.001, 1.5]]),
    upper: lathe([[0.001, 0.86], [0.19, 0.86], [0.2, 1.18], [0.225, 1.36], [0.17, 1.47], [0.06, 1.52], [0.001, 1.52]]),
    blazer: lathe([[0.001, 0.84], [0.2, 0.84], [0.205, 1.18], [0.23, 1.36], [0.17, 1.47], [0.06, 1.52], [0.001, 1.52]]),
    neck: new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10),
    head: new THREE.SphereGeometry(0.105, 18, 14),
    // غطاء الرأس يترك الوجه (اتجاه +z) مكشوفًا
    shemagh: new THREE.SphereGeometry(0.122, 18, 12, Math.PI / 2 + 0.55, Math.PI * 2 - 1.1, 0, Math.PI * 0.62),
    hijab: new THREE.SphereGeometry(0.118, 18, 12, Math.PI / 2 + 0.5, Math.PI * 2 - 1.0, 0, Math.PI * 0.72),
    hairCap: new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
    drape: new THREE.BoxGeometry(0.25, 0.3, 0.035),
    agal: new THREE.TorusGeometry(0.1, 0.016, 8, 22),
    arm: new THREE.CapsuleGeometry(0.052, 0.46, 4, 8),
    hand: new THREE.SphereGeometry(0.045, 10, 8),
    thigh: new THREE.CapsuleGeometry(0.068, 0.32, 4, 8),
    shin: new THREE.CapsuleGeometry(0.058, 0.32, 4, 8),
    foot: new THREE.BoxGeometry(0.095, 0.06, 0.22),
    blob: new THREE.CircleGeometry(0.34, 20),
  };

  const mesh = (geo: ConstructorParameters<Three["Mesh"]>[0], mat: InstanceType<Three["Material"]>, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    return o;
  };

  /** يبني شخصًا يتجه نحو +z. seated: وضعية الجلوس على كرسي (مقعده على ارتفاع 0.48م). */
  function person(outfit: Outfit, opts: { seated?: boolean; seed?: number } = {}): Person {
    const seed = opts.seed ?? Math.random();
    const skin = m.skins[Math.floor(seed * 997) % m.skins.length]!;
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const cloth = outfit === "thobe" ? m.thobe : outfit === "abaya" ? m.abaya : m.trousers;
    const sleeve = outfit === "thobe" ? m.thobe : outfit === "abaya" ? m.abaya : m.blazer;
    const footMat = outfit === "thobe" ? m.sandal : m.shoe;

    // الساقان: ورك ← فخذ ← ركبة ← ساق ← قدم
    const thighs: Obj[] = [];
    const shins: Obj[] = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.095, 0.86, 0);
      const thigh = mesh(g.thigh, cloth, 0, -0.22, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.43;
      const shin = mesh(g.shin, cloth, 0, -0.2, 0);
      const foot = mesh(g.foot, footMat, 0, -0.4, 0.05);
      knee.add(shin, foot);
      hip.add(thigh, knee);
      body.add(hip);
      thighs.push(hip);
      shins.push(knee);
    }

    // الجسم والثوب
    let skirt: Obj | null = null;
    if (outfit === "casual") {
      body.add(mesh(g.blazer, m.blazer));
      const collar = mesh(new THREE.BoxGeometry(0.07, 0.1, 0.02), m.shirt, 0, 1.42, 0.165);
      body.add(collar);
    } else if (opts.seated) {
      body.add(mesh(g.upper, cloth));
    } else {
      skirt = mesh(outfit === "thobe" ? g.thobe : g.abaya, cloth);
      skirt.scale.z = 0.78;
      body.add(skirt);
    }
    body.children.forEach((c) => {
      if (c !== skirt && (c as InstanceType<Three["Mesh"]>).geometry instanceof THREE.LatheGeometry) c.scale.z = 0.78;
    });

    // الرأس وغطاؤه
    const head = new THREE.Group();
    head.position.y = 1.56;
    head.add(mesh(g.neck, skin, 0, 0, 0));
    const face = mesh(g.head, skin, 0, 0.12, 0.005);
    face.scale.set(0.92, 1.08, 0.98);
    head.add(face);
    if (outfit === "thobe") {
      const red = seed > 0.35;
      const cover = mesh(g.shemagh, red ? m.shemagh : m.ghutra, 0, 0.13, 0);
      cover.scale.set(1, 1.12, 1.05);
      const drape = mesh(g.drape, red ? m.shemagh : m.ghutra, 0, -0.04, -0.1);
      drape.rotation.x = 0.18;
      const agal = mesh(g.agal, m.agal, 0, 0.2, 0);
      agal.rotation.x = Math.PI / 2;
      head.add(cover, drape, agal);
    } else if (outfit === "abaya") {
      const cover = mesh(g.hijab, m.abaya, 0, 0.12, 0);
      cover.scale.set(1.02, 1.12, 1.06);
      const drape = mesh(g.drape, m.abaya, 0, -0.06, -0.08);
      drape.scale.set(1.15, 1, 1);
      head.add(cover, drape);
    } else {
      const hair = mesh(g.hairCap, m.hair, 0, 0.15, -0.008);
      head.add(hair);
    }
    body.add(head);

    // الذراعان من الكتفين
    const arms: Obj[] = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(side * 0.225, 1.4, 0);
      sh.rotation.z = side * 0.06;
      sh.add(mesh(g.arm, sleeve, 0, -0.27, 0), mesh(g.hand, skin, 0, -0.55, 0.01));
      body.add(sh);
      arms.push(sh);
    }

    root.traverse((o) => {
      if ((o as InstanceType<Three["Mesh"]>).isMesh) o.castShadow = false;
    });

    // ظل ناعم تحت القدمين
    if (!opts.seated) {
      const blob = mesh(g.blob, m.shadow, 0, 0.012, 0);
      blob.rotation.x = -Math.PI / 2;
      root.add(blob);
    }

    const p: Person = { root, body, head, arms: arms as [Obj, Obj], thighs: thighs as [Obj, Obj], shins: shins as [Obj, Obj], skirt, seed };
    if (opts.seated) sit(p);
    return p;
  }

  function sit(p: Person) {
    // الورك فوق مقعد الكرسي، الفخذان للأمام، الساقان للأسفل، اليدان على المكتب
    p.body.position.y = 0.5 - 0.86;
    for (const t of p.thighs) t.rotation.x = -Math.PI / 2;
    for (const s of p.shins) s.rotation.x = Math.PI / 2;
    for (const a of p.arms) a.rotation.x = -0.95;
  }

  return { person, materials: m, geometries: g, shemaghTex };
}

/** حركة المشي: amp من 0 (واقف) إلى 1 (يمشي)، phase تتقدم مع المسافة. */
export function poseWalk(p: Person, phase: number, amp: number, t: number) {
  // الثوب والعباءة يغطيان الساقين: خطوة أقصر
  const s = Math.sin(phase) * (p.skirt ? 0.2 : 0.36) * amp;
  p.thighs[0].rotation.x = s;
  p.thighs[1].rotation.x = -s;
  const bend = p.skirt ? 0.5 : 1.1;
  p.shins[0].rotation.x = Math.max(0, s) * bend;
  p.shins[1].rotation.x = Math.max(0, -s) * bend;
  const arm = (p.skirt ? 1.3 : 0.75) * s;
  p.arms[0].rotation.x = -arm;
  p.arms[1].rotation.x = arm;
  if (p.skirt) p.skirt.rotation.z = Math.sin(phase) * 0.025 * amp;
  p.body.position.y = Math.abs(Math.cos(phase)) * 0.022 * amp;
  p.body.rotation.z = Math.sin(phase) * 0.018 * amp;
  // عند الوقوف: تنفس هادئ والتفات بطيء للرأس
  const idle = 1 - amp;
  p.head.rotation.y = Math.sin(t * 0.35 + p.seed * 20) * 0.45 * idle;
  p.body.scale.y = 1 + Math.sin(t * 1.6 + p.seed * 9) * 0.004 * idle;
}

/** حركة الجالس: كتابة خفيفة وإيماءة رأس. */
export function poseSeated(p: Person, t: number) {
  const k = t * 7 + p.seed * 40;
  p.arms[0].rotation.x = -0.95 + Math.sin(k) * 0.035;
  p.arms[1].rotation.x = -0.95 + Math.sin(k + 1.7) * 0.035;
  p.head.rotation.x = 0.08 + Math.sin(t * 0.5 + p.seed * 7) * 0.05;
  p.head.rotation.y = Math.sin(t * 0.21 + p.seed * 13) * 0.25;
}
