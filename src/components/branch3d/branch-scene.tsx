"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SceneFloor, SceneUnit, SceneTone } from "@/services/branch-scene.service";
import { TONE } from "./tones";
import { createPeopleKit, poseSeated, poseWalk, type Outfit, type Person } from "./people";
import { createTextures, type BadgeIcon } from "./textures";

const WALL_H_NIGHT = 2.6;
const FLOOR_GAP = 9;
const BG_NIGHT = 0x050b16;
const BG_DAY = 0xefe7dc;

type Hover = { unit: SceneUnit; x: number; y: number } | null;

/** إضاءة الغرفة حسب حالتها: دافئة للمؤجرة، باردة خافتة للمتاحة، ومطفأة لغير المسجلة */
const ROOM_LIGHT: Record<SceneTone, [number, number] | null> = {
  rented: [0xffb35c, 1],
  partial: [0xffc070, 0.9],
  expiring: [0xffb050, 0.95],
  reserved: [0xffd28a, 0.7],
  available: [0xbfe3ff, 0.45],
  maintenance: [0xff7a59, 0.3],
  facility: [0xdbeeff, 0.4],
  inactive: null,
  unregistered: null,
};

const iconFor = (u: SceneUnit): BadgeIcon =>
  u.kind === "facility" ? (u.typeKey === "COFFEE" ? "coffee" : u.typeKey === "PARKING" ? "car" : "water") : u.kind === "plan" ? "plan" : u.typeKey === "MEETING_ROOM" ? "meeting" : u.typeKey === "SHARED_OFFICE" ? "people" : u.typeKey === "ADMIN_SPACE" ? "admin" : "desk";

const OUTFITS: Outfit[] = ["thobe", "abaya", "thobe", "casual", "abaya", "thobe", "abaya", "casual"];

export function BranchScene({ floors, height = 620 }: { floors: SceneFloor[]; height?: number }) {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ showFloor: (i: number | "all") => void; reset: () => void } | null>(null);
  const [active, setActive] = useState<number | "all">(floors.length > 1 ? "all" : 0);
  const [hover, setHover] = useState<Hover>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  // نهاري (الافتراضي، مثل مجسمات التصميم الداخلي) أو ليلي (إضاءة وشبكة متوهجة)
  const [theme, setTheme] = useState<"day" | "night">("day");
  useEffect(() => {
    try {
      if (localStorage.getItem("zaki.b3d.theme") === "night") setTheme("night");
    } catch {}
  }, []);
  const switchTheme = () => {
    const next = theme === "day" ? "night" : "day";
    setReady(false);
    setTheme(next);
    try {
      localStorage.setItem("zaki.b3d.theme", next);
    } catch {}
  };
  const floorsKey = useMemo(() => JSON.stringify(floors.map((f) => f.units.map((u) => [u.id, u.x, u.y, u.w, u.d, u.tone, u.bookedNow, u.occupiedSeats]))), [floors]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const { CSS2DRenderer, CSS2DObject } = await import("three/examples/jsm/renderers/CSS2DRenderer.js");
      const el = host.current;
      if (!el || disposed) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      type Mesh = InstanceType<typeof THREE.Mesh>;
      type Group = InstanceType<typeof THREE.Group>;
      type Material = InstanceType<typeof THREE.Material>;
      const day = theme === "day";
      const WALL_H = day ? 1.25 : WALL_H_NIGHT; // النهاري: جدران مقطوعة ليظهر الداخل
      const NET_Y = WALL_H + 1.05; // ارتفاع الشارات (والشبكة في الليلي) فوق الغرف
      const BG = day ? BG_DAY : BG_NIGHT;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      } catch {
        setFailed(true);
        return;
      }
      const W = () => el.clientWidth;
      const H = () => el.clientHeight;
      const pr = Math.min(1.75, window.devicePixelRatio);
      renderer.setPixelRatio(pr);
      renderer.setSize(W(), H());
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = day ? 1.0 : 1.1;
      renderer.shadowMap.enabled = day;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.setAttribute("aria-hidden", "true");
      el.appendChild(renderer.domElement);

      const labels = new CSS2DRenderer();
      labels.setSize(W(), H());
      labels.domElement.dir = "ltr"; // CSS2DRenderer يحسب المواضع من اليسار
      labels.domElement.style.position = "absolute";
      labels.domElement.style.left = "0";
      labels.domElement.style.top = "0";
      labels.domElement.style.inset = "0";
      labels.domElement.style.pointerEvents = "none";
      el.appendChild(labels.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(BG);
      scene.fog = new THREE.Fog(BG, 70, 190);
      const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.1, 500);

      // ── إضاءة ليلية: سماء زرقاء خافتة + ضوء قمر + أضواء داخلية دافئة ──
      scene.add(day ? new THREE.HemisphereLight(0xfff4e6, 0xb89a7a, 1.15) : new THREE.HemisphereLight(0x5577aa, 0x0a0f18, 1.0));
      // النهاري: شمس دافئة بظلال ناعمة · الليلي: ضوء قمر بارد
      const moon = day ? new THREE.DirectionalLight(0xffe9cc, 3.2) : new THREE.DirectionalLight(0xa9c4ff, 0.9);
      if (day) {
        moon.castShadow = true;
        moon.shadow.mapSize.set(2048, 2048);
        moon.shadow.bias = -0.0004;
        moon.shadow.normalBias = 0.02;
        moon.shadow.radius = 4;
      }
      scene.add(moon);
      scene.add(moon.target);

      // التوهج (Bloom): إن تعذّر نرسم مباشرة
      let composer: { render: () => void; setSize: (w: number, h: number) => void; dispose?: () => void } | null = null;
      if (!day) try {
        const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js");
        const { RenderPass } = await import("three/examples/jsm/postprocessing/RenderPass.js");
        const { UnrealBloomPass } = await import("three/examples/jsm/postprocessing/UnrealBloomPass.js");
        const { OutputPass } = await import("three/examples/jsm/postprocessing/OutputPass.js");
        const c = new EffectComposer(renderer);
        c.setPixelRatio(pr);
        c.setSize(W(), H());
        c.addPass(new RenderPass(scene, camera));
        c.addPass(new UnrealBloomPass(new THREE.Vector2(W() / 2, H() / 2), 0.75, 0.5, 0.86));
        c.addPass(new OutputPass());
        composer = c;
      } catch {
        composer = null;
      }
      if (disposed) return;

      const tex = createTextures(THREE);
      const kit = createPeopleKit(THREE);
      const bright = (hex: number | string, k: number) => new THREE.Color(hex).multiplyScalar(k);

      // ── مواد مشتركة ──
      const mat = {
        wood: new THREE.MeshStandardMaterial({ color: day ? 0xcfa77c : 0x9a6e4c, roughness: 0.55 }),
        dark: new THREE.MeshStandardMaterial({ color: day ? 0x8a6a4c : 0x1f2937, roughness: 0.5, metalness: day ? 0.1 : 0.4 }),
        chair: new THREE.MeshStandardMaterial({ color: day ? 0xeee4d6 : 0x2b3442, roughness: 0.85 }),
        sofa: new THREE.MeshStandardMaterial({ color: day ? 0xf1e9de : 0x6b4f3a, roughness: 0.9 }),
        sage: new THREE.MeshStandardMaterial({ color: 0x9aa878, roughness: 0.85 }),
        rug: new THREE.MeshStandardMaterial({ color: 0xe3d5c1, roughness: 1 }),
        wallDay: new THREE.MeshStandardMaterial({ color: 0xf7f2ec, roughness: 0.92 }),
        wallCap: new THREE.MeshStandardMaterial({ color: 0xfffcf8, roughness: 0.8 }),
        lampGlow: new THREE.MeshBasicMaterial({ color: bright(0xffd49a, 1.4), toneMapped: false }),
        lampShade: new THREE.MeshStandardMaterial({ color: 0xf8ecd8, roughness: 0.6, emissive: 0xffc77a, emissiveIntensity: 0.6 }),
        leaf: new THREE.MeshStandardMaterial({ color: 0x2f8f5f, roughness: 0.9 }),
        pot: new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.7 }),
        slab: new THREE.MeshStandardMaterial({ color: 0xffffff, map: day ? tex.tilesLight : tex.tiles, roughness: day ? 0.75 : 0.6, metalness: day ? 0 : 0.15 }),
        slabEdge: new THREE.MeshStandardMaterial({ color: day ? 0xf4eee6 : 0x0c1a2c, roughness: 0.6 }),
        screenOff: new THREE.MeshStandardMaterial({ color: day ? 0x3a3f47 : 0x0b1220, roughness: 0.3 }),
        screenOn: new THREE.MeshBasicMaterial({ color: bright(0x7dd3fc, 1.6), toneMapped: false }),
        net: new THREE.MeshBasicMaterial({ color: bright(0x22d3ee, 1.35), toneMapped: false, transparent: true, opacity: 0 }),
        netDim: new THREE.MeshBasicMaterial({ color: bright(0x38bdf8, 0.9), toneMapped: false, transparent: true, opacity: 0 }),
        dot: new THREE.MeshBasicMaterial({ color: bright(0xa5f3fc, 4), toneMapped: false, transparent: true, opacity: 0 }),
        edge: new THREE.LineBasicMaterial({ color: bright(0x22d3ee, 1.6), toneMapped: false }),
      };
      const box = (w: number, h: number, d: number, m: Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

      const desk = (screenOn: boolean) => {
        const g = new THREE.Group();
        const top = box(1.3, 0.05, 0.65, mat.wood);
        top.position.y = 0.74;
        g.add(top);
        for (const [x, z] of [[-0.6, -0.28], [0.6, -0.28], [-0.6, 0.28], [0.6, 0.28]] as const) {
          const leg = box(0.04, 0.72, 0.04, mat.dark);
          leg.position.set(x, 0.36, z);
          g.add(leg);
        }
        const screen = box(0.55, 0.34, 0.03, screenOn ? mat.screenOn : mat.screenOff);
        screen.position.set(0, 1.0, -0.22);
        g.add(screen);
        return g;
      };
      const chair = (m: Material) => {
        const g = new THREE.Group();
        const seat = box(0.46, 0.07, 0.46, m);
        seat.position.y = 0.46;
        const back = box(0.46, 0.5, 0.06, m);
        back.position.set(0, 0.74, 0.21);
        const post = box(0.05, 0.42, 0.05, mat.dark);
        post.position.y = 0.21;
        g.add(seat, back, post);
        return g;
      };
      const plant = () => {
        const g = new THREE.Group();
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.35, 12), mat.pot);
        p.position.y = 0.17;
        const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), mat.leaf);
        l.position.y = 0.62;
        g.add(p, l);
        return g;
      };
      const pool = (color: number, size: number, opacity: number) => {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(size, size),
          new THREE.MeshBasicMaterial({ map: tex.glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        m.rotation.x = -Math.PI / 2;
        return m;
      };
      const rect = (w: number, d: number, y: number, m: InstanceType<typeof THREE.LineBasicMaterial>) => {
        const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => new THREE.Vector3(x, y, z));
        return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), m);
      };
      // قطعة من خط الشبكة بين نقطتين على نفس الارتفاع
      const segment = (a: InstanceType<typeof THREE.Vector3>, b: InstanceType<typeof THREE.Vector3>, m: Material, w = 0.035) => {
        const len = a.distanceTo(b);
        const s = box(Math.abs(b.x - a.x) > 0.001 ? len : w, w, Math.abs(b.z - a.z) > 0.001 ? len : w, m);
        s.position.copy(a).add(b).multiplyScalar(0.5);
        return s;
      };

      // ── بناء الطوابق ──
      type Built = { label: InstanceType<typeof CSS2DObject>; group: Group; unit: SceneUnit; tile: Mesh; badge: InstanceType<typeof THREE.Sprite>; delay: number; lift: number };
      type Walker = { p: Person; x: number; z: number; heading: number; queue: { x: number; z: number; pause: number }[]; pause: number; amp: number; phase: number; speed: number; lane: number; span: [number, number]; doors: { x: number; zIn: number }[] };
      type Flow = { mesh: Mesh; pts: InstanceType<typeof THREE.Vector3>[]; len: number; off: number; speed: number };
      const built: Built[] = [];
      const floorGroups: Group[] = [];
      const walkers: Walker[] = [];
      const seated: Person[] = [];
      const flows: Flow[] = [];
      const hubs: InstanceType<typeof THREE.Sprite>[] = [];
      const pickables: InstanceType<typeof THREE.Object3D>[] = [];
      let seatedBudget = 56;
      let maxW = 10;
      let maxD = 10;
      floors.forEach((f) => {
        for (const u of f.units) {
          maxW = Math.max(maxW, u.x + u.w);
          maxD = Math.max(maxD, u.y + u.d);
        }
      });
      const ox = -maxW / 2;
      const oz = -maxD / 2;
      const lightsPerFloor = Math.max(1, Math.min(3, Math.floor(6 / Math.max(1, floors.length))));
      let lastDelay = 0;

      floors.forEach((floor, fi) => {
        const fg = new THREE.Group();
        fg.position.y = fi * FLOOR_GAP;
        scene.add(fg);
        floorGroups.push(fg);

        // أرضية بلاط داكنة بحافة متوهجة
        const slab = box(maxW + 4, 0.3, maxD + 4, mat.slab);
        (day ? tex.tilesLight : tex.tiles).repeat.set((maxW + 4) / 8, (maxD + 4) / 8);
        slab.position.set(0, -0.15, 0);
        fg.add(slab);
        const edge = box(maxW + 4.2, 0.12, maxD + 4.2, mat.slabEdge);
        edge.position.y = -0.33;
        fg.add(edge);
        if (!day) fg.add(rect(maxW + 4, maxD + 4, 0.01, mat.edge));
        else {
          // سور خارجي أبيض بزوايا مستديرة يؤطر المبنى مثل مجسمات التصميم الداخلي
          const OW = maxW + 4;
          const OD = maxD + 4;
          const th = 0.3;
          const hh = WALL_H * 0.85;
          for (const [w, d, x, z] of [
            [OW - 1.2, th, 0, -OD / 2],
            [OW - 1.2, th, 0, OD / 2],
            [th, OD - 1.2, -OW / 2, 0],
            [th, OD - 1.2, OW / 2, 0],
          ] as const) {
            const wall = box(w, hh, d, mat.wallDay);
            wall.position.set(x, hh / 2, z);
            fg.add(wall);
          }
          for (const [x, z, a] of [[-1, -1, Math.PI], [1, -1, Math.PI * 1.5], [1, 1, 0], [-1, 1, Math.PI / 2]] as const) {
            const corner = new THREE.Mesh(new THREE.CylinderGeometry(0.6 + th / 2, 0.6 + th / 2, hh, 20, 1, true, a, Math.PI / 2), mat.wallDay);
            corner.position.set(x * (OW / 2 - 0.6), hh / 2, z * (OD / 2 - 0.6));
            (corner.material as Material).side = THREE.DoubleSide;
            fg.add(corner);
          }
        }

        for (let i = 0; i < (day ? 0 : lightsPerFloor); i++) {
          const l = new THREE.PointLight(0xffb36b, 34, Math.max(14, maxW / lightsPerFloor + 6), 1.6);
          l.position.set(ox + (maxW * (i + 0.5)) / lightsPerFloor, 2.3, 0);
          fg.add(l);
        }

        const floorLabel = document.createElement("div");
        floorLabel.className = day
          ? "rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-[#5b4636] shadow-md ring-1 ring-black/5"
          : "rounded-full bg-slate-950/80 px-3 py-1 text-xs font-bold text-cyan-100 shadow-lg ring-1 ring-cyan-300/30 backdrop-blur";
        floorLabel.textContent = floor.name;
        const fl = new CSS2DObject(floorLabel);
        fl.position.set(-maxW / 2 - 1, 0.4, maxD / 2 + 1.6);
        fg.add(fl);

        // الممرات: الشرائح الأقل امتلاءً بالغرف
        const lanes: number[] = [];
        {
          const cands: { y: number; cover: number }[] = [];
          for (let y = 0.6; y < maxD - 0.6; y += 0.25) {
            const cover = floor.units.filter((u) => y > u.y - 0.05 && y < u.y + u.d + 0.05).reduce((sum, u) => sum + u.w, 0);
            cands.push({ y, cover });
          }
          for (const c of cands.sort((a, b) => a.cover - b.cover)) {
            if (c.cover > maxW * 0.35 || lanes.length >= 2) break;
            if (lanes.every((l) => Math.abs(l - c.y) > 2)) lanes.push(c.y);
          }
          if (!lanes.length) lanes.push(maxD + 0.8);
        }
        const laneZ = lanes.map((l) => oz + l);
        const laneSpan = laneZ.map(() => [0, 0] as [number, number]);
        const doorsByLane = laneZ.map(() => [] as { x: number; zIn: number }[]);
        const net = new THREE.Group();
        fg.add(net);

        floor.units.forEach((u, ui) => {
          const tone = new THREE.Color(TONE[u.tone].color);
          const ghost = u.kind === "plan";
          const cx = ox + u.x + u.w / 2;
          const cz = oz + u.y + u.d / 2;
          const g = new THREE.Group();
          g.position.set(cx, 0, cz);
          fg.add(g);

          // أرضية الغرفة: خشب دافئ للمكاتب، داكنة للغرف غير المسجلة
          const floorMat =
            ghost ? new THREE.MeshStandardMaterial({ color: day ? 0xe4dbcf : 0x1a2536, roughness: 0.9, emissive: tone, emissiveIntensity: 0 })
            : u.typeKey === "PARKING" ? new THREE.MeshStandardMaterial({ color: day ? 0x9a9ca1 : 0x2a2f38, roughness: 0.95, emissive: tone, emissiveIntensity: 0 })
            : u.kind === "facility" ? new THREE.MeshStandardMaterial({ color: day ? 0xe6e4e0 : 0x5d6b7e, roughness: 0.5, emissive: tone, emissiveIntensity: 0 })
            : new THREE.MeshStandardMaterial({ map: day ? tex.woodLight : tex.wood, color: u.typeKey === "MEETING_ROOM" ? (day ? 0xf2e6d6 : 0xd8c2a8) : 0xffffff, roughness: 0.65, emissive: tone, emissiveIntensity: 0 });
          const tile = box(u.w - 0.12, 0.06, u.d - 0.12, floorMat);
          tile.position.y = 0.03;
          tile.userData.unitId = u.id;
          g.add(tile);
          pickables.push(tile);
          // خط الحالة المضيء حول أرضية الغرفة (الليلي) · سجادة ناعمة تحت الأثاث (النهاري)
          if (!day) g.add(rect(u.w - 0.2, u.d - 0.2, 0.075, new THREE.LineBasicMaterial({ color: tone.clone().multiplyScalar(ghost ? 0.5 : 1.8), toneMapped: false, transparent: ghost, opacity: ghost ? 0.5 : 1 })));
          else if (!ghost && u.kind !== "facility" && u.w > 2 && u.d > 2) {
            const rug = u.typeKey === "MEETING_ROOM" || u.typeKey === "ADMIN_SPACE"
              ? new THREE.Mesh(new THREE.CircleGeometry(Math.min(u.w, u.d) * 0.38, 40), mat.rug)
              : new THREE.Mesh(new THREE.PlaneGeometry(u.w * 0.72, u.d * 0.62), mat.rug);
            rug.rotation.x = -Math.PI / 2;
            rug.position.y = 0.065;
            rug.receiveShadow = true;
            g.add(rug);
          }

          // جدران زجاجية داكنة بحافة علوية مضيئة وفتحة باب في الواجهة
          const glass = day
            ? ghost ? new THREE.MeshStandardMaterial({ color: 0xf7f2ec, roughness: 0.92, transparent: true, opacity: 0.55 }) : mat.wallDay
            : new THREE.MeshStandardMaterial({ color: new THREE.Color(0x1a2b42).lerp(tone, 0.18), transparent: true, opacity: ghost ? 0.1 : 0.3, roughness: 0.1, metalness: 0.3, depthWrite: false });
          const t = day ? 0.16 : 0.06;
          const door = Math.min(1.1, u.w * 0.35);
          const walls: [number, number, number, number][] = [
            [u.w, t, 0, -u.d / 2],
            [t, u.d, -u.w / 2, 0],
            [t, u.d, u.w / 2, 0],
            [(u.w - door) / 2, t, -(door / 2 + (u.w - door) / 4), u.d / 2],
            [(u.w - door) / 2, t, door / 2 + (u.w - door) / 4, u.d / 2],
          ];
          for (const [ww, dd, x, z] of walls) {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, WALL_H, dd), glass);
            wall.position.set(x, WALL_H / 2, z);
            wall.userData.unitId = u.id;
            g.add(wall);
            pickables.push(wall);
          }
          if (!day) {
            const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(u.w, WALL_H, u.d)), new THREE.LineBasicMaterial({ color: tone, transparent: true, opacity: ghost ? 0.15 : 0.3 }));
            frame.position.y = WALL_H / 2;
            g.add(frame);
            g.add(rect(u.w, u.d, WALL_H, new THREE.LineBasicMaterial({ color: tone.clone().multiplyScalar(ghost ? 0.45 : 1.5), toneMapped: false, transparent: ghost, opacity: ghost ? 0.5 : 1 })));
          } else if (!ghost) {
            // خط رفيع بلون الحالة على حافة الجدار المقطوعة — الحالة تبقى واضحة دون أن تطغى على التصميم
            g.add(rect(u.w - t, u.d - t, WALL_H + 0.005, new THREE.LineBasicMaterial({ color: tone })));
          }

          // ضوء الغرفة: بقعة على الأرض + مصباح معلّق متوهج
          const light = ROOM_LIGHT[u.tone];
          if (day && light && !ghost && u.kind !== "facility") {
            // أباجورة دافئة في زاوية الغرفة (مثل الصورة المرجعية)
            const lamp = new THREE.Group();
            const stand = box(0.35, 0.5, 0.35, mat.wood);
            stand.position.y = 0.25;
            const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.22, 16), mat.lampShade);
            shade.position.y = 0.62;
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat.lampGlow);
            bulb.position.y = 0.58;
            lamp.add(stand, shade, bulb);
            lamp.position.set(-u.w / 2 + 0.38, 0, -u.d / 2 + 0.38);
            g.add(lamp);
            if (u.tone !== "available") {
              const pl = pool(0xffc98a, Math.min(3.2, Math.min(u.w, u.d) * 0.9), 0.22);
              pl.position.set(-u.w / 2 + 0.6, 0.07, -u.d / 2 + 0.6);
              g.add(pl);
            }
          }
          if (!day && light && !ghost) {
            const [lc, li] = light;
            const k = u.bookedNow ? 1.25 : li;
            const pl = pool(lc, Math.min(7, Math.max(u.w, u.d) * 1.05), 0.36 * k);
            pl.position.y = 0.08;
            g.add(pl);
            const lamps = Math.max(1, Math.min(4, Math.round(u.w / 3.5)));
            for (let i = 0; i < lamps; i++) {
              const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.05, 16), new THREE.MeshBasicMaterial({ color: bright(lc, 1 + 1.5 * k), toneMapped: false }));
              lamp.position.set(-u.w / 2 + (u.w * (i + 0.5)) / lamps, WALL_H - 0.25, 0);
              g.add(lamp);
            }
          }

          // الأثاث والأشخاص الجالسون
          const rented = u.tone === "rented" || u.tone === "expiring" || u.tone === "partial";
          const seatMat = day ? mat.sage : new THREE.MeshStandardMaterial({ color: tone.clone().lerp(new THREE.Color(0x222831), 0.45), roughness: 0.7 });
          const seat = (x: number, z: number, rotY: number, scale = 1) => {
            if (seatedBudget <= 0 || scale < 0.75) return;
            seatedBudget--;
            const s = Math.random();
            const p = kit.person(s < 0.45 ? "thobe" : s < 0.8 ? "abaya" : "casual", { seated: true, seed: Math.random() });
            p.root.position.set(x, 0, z);
            p.root.rotation.y = rotY;
            g.add(p.root);
            seated.push(p);
          };
          if (u.typeKey === "PARKING") {
            // باركينج: مواقف بخطوط بيضاء على صفّين أو أكثر، وسيارات بألوان مختلفة في أغلبها
            const bay = 2.6;
            const deep = 5;
            const lineMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f0 });
            const rows: { z: number; flip: boolean }[] = [{ z: -u.d / 2 + 0.3 + deep / 2, flip: false }, { z: u.d / 2 - 0.3 - deep / 2, flip: true }];
            if (u.d > 2 * deep + 6 + 2 * deep) rows.push({ z: -deep / 2 - 0.05, flip: true }, { z: deep / 2 + 0.05, flip: false });
            let seed = 7;
            const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
            const carColors = [0xf4f4f2, 0x1f2329, 0x9aa1aa, 0x6b7280, 0xb91c1c, 0x1e3a8a, 0xe7dcc8, 0x0f172a];
            const carGeo = { body: new THREE.BoxGeometry(1.8, 0.62, 4.3), cabin: new THREE.BoxGeometry(1.6, 0.52, 2.3), wheel: new THREE.CylinderGeometry(0.34, 0.34, 0.22, 14) };
            const glassMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.15, metalness: 0.5 });
            const tyreMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
            const n = Math.floor((u.w - 1) / bay);
            for (const row of rows) {
              for (let i = 0; i <= n; i++) {
                const x = -u.w / 2 + 0.5 + i * bay;
                const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.1, deep), lineMat);
                ln.rotation.x = -Math.PI / 2;
                ln.position.set(x, 0.07, row.z);
                g.add(ln);
                if (i === n || rnd() > 0.78) continue;
                const car = new THREE.Group();
                const paint = new THREE.MeshStandardMaterial({ color: carColors[Math.floor(rnd() * carColors.length)]!, roughness: 0.35, metalness: 0.4 });
                const body = new THREE.Mesh(carGeo.body, paint);
                body.position.y = 0.58;
                const cabin = new THREE.Mesh(carGeo.cabin, glassMat);
                cabin.position.set(0, 1.12, -0.2);
                car.add(body, cabin);
                for (const [wx, wz] of [[-0.88, 1.35], [0.88, 1.35], [-0.88, -1.35], [0.88, -1.35]] as const) {
                  const w = new THREE.Mesh(carGeo.wheel, tyreMat);
                  w.rotation.z = Math.PI / 2;
                  w.position.set(wx, 0.34, wz);
                  car.add(w);
                }
                car.position.set(x + bay / 2, 0, row.z);
                car.rotation.y = row.flip ? Math.PI : 0;
                g.add(car);
              }
            }
          } else if (u.kind === "facility" && u.typeKey === "COFFEE") {
            // ركن القهوة: كاونتر بماكينة قهوة وأكواب، وطاولة صغيرة بكرسيين
            const along = u.d >= u.w; // الكاونتر على الضلع الأطول
            const len = Math.min(3, (along ? u.d : u.w) - 0.6);
            const counter = box(along ? 0.6 : len, 0.9, along ? len : 0.6, mat.wood);
            const top = box(along ? 0.66 : len + 0.06, 0.05, along ? len + 0.06 : 0.66, mat.pot);
            const cx0 = along ? -u.w / 2 + 0.42 : 0;
            const cz0 = along ? 0 : -u.d / 2 + 0.42;
            counter.position.set(cx0, 0.45, cz0);
            top.position.set(cx0, 0.925, cz0);
            const machine = box(0.36, 0.42, 0.32, mat.dark);
            machine.position.set(cx0 + (along ? 0 : -len / 3), 1.16, cz0 + (along ? -len / 3 : 0));
            const kettle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.24, 14), mat.pot);
            kettle.position.set(cx0 + (along ? 0 : len / 6), 1.07, cz0 + (along ? len / 6 : 0));
            g.add(counter, top, machine, kettle);
            for (let i = 0; i < 3; i++) {
              const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.09, 10), mat.chair);
              cup.position.set(cx0 + (along ? 0.1 : len / 4 + i * 0.13), 0.995, cz0 + (along ? len / 4 + i * 0.13 : 0.1));
              g.add(cup);
            }
            const tbl = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 24), mat.wood);
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.12, 0.72, 10), mat.dark);
            const tx = along ? u.w / 2 - 0.75 : 0;
            const tz = along ? 0.3 : u.d / 2 - 0.75;
            tbl.position.set(tx, 0.74, tz);
            leg.position.set(tx, 0.36, tz);
            g.add(tbl, leg);
            for (const sgn of [-1, 1]) {
              const c = chair(mat.sage);
              c.position.set(tx + (along ? 0 : sgn * 0.7), 0, tz + (along ? sgn * 0.7 : 0));
              c.rotation.y = along ? (sgn < 0 ? Math.PI : 0) : (sgn < 0 ? -Math.PI / 2 : Math.PI / 2);
              g.add(c);
            }
            const pl2 = plant();
            pl2.position.set(u.w / 2 - 0.35, 0, -u.d / 2 + 0.35);
            g.add(pl2);
          } else if (u.kind === "facility") {
            const n = Math.max(2, Math.floor(u.w / 1.1));
            for (let i = 0; i < n; i++) {
              const sh = Math.min(1.8, WALL_H - 0.05);
              const stall = box(0.06, sh, Math.min(1.6, u.d * 0.4), mat.pot);
              stall.position.set(-u.w / 2 + (u.w / n) * i + 0.05, sh / 2, u.d / 2 - Math.min(1.6, u.d * 0.4) / 2 - 0.1);
              g.add(stall);
            }
            const sinks = box(Math.min(u.w * 0.7, 6), 0.85, 0.5, mat.pot);
            sinks.position.set(0, 0.43, -u.d / 2 + 0.4);
            g.add(sinks);
          } else if (u.typeKey === "MEETING_ROOM") {
            const tw = Math.max(1.6, u.w * 0.6);
            const td = Math.max(0.9, u.d * 0.35);
            const table = box(tw, 0.06, td, mat.wood);
            table.position.y = 0.74;
            const base = box(tw * 0.6, 0.7, 0.2, mat.dark);
            base.position.y = 0.36;
            g.add(table, base);
            const n = Math.min(12, Math.max(4, u.capacity));
            const side = Math.ceil(n / 2);
            for (let i = 0; i < n; i++) {
              const c = chair(u.bookedNow ? seatMat : mat.chair);
              const row = i < side ? -1 : 1;
              const idx = i % side;
              const x = -tw / 2 + (tw / side) * (idx + 0.5);
              const z = row * (td / 2 + 0.38);
              c.position.set(x, 0, z);
              c.rotation.y = row < 0 ? Math.PI : 0; // الكراسي تواجه الطاولة
              g.add(c);
              if (u.bookedNow && idx % 2 === 0) seat(x, z, row < 0 ? 0 : Math.PI);
            }
            const tv = box(Math.min(2.2, u.w * 0.5), day ? 0.55 : 1.1, 0.06, u.bookedNow ? mat.screenOn : mat.screenOff);
            tv.position.set(0, day ? 0.95 : 1.5, -u.d / 2 + (day ? 0.16 : 0.1));
            g.add(tv);
          } else if (u.typeKey === "ADMIN_SPACE") {
            const sofa = box(Math.min(2.4, u.w * 0.55), 0.45, 0.8, mat.sofa);
            sofa.position.set(0, 0.23, -u.d / 2 + 0.7);
            const coffee = box(1, 0.4, 0.55, mat.wood);
            coffee.position.set(0, 0.2, 0.2);
            const d1 = desk(true);
            d1.position.set(u.w / 2 - 1, 0, u.d / 2 - 1);
            d1.rotation.y = Math.PI;
            const c1 = chair(mat.chair);
            c1.position.set(u.w / 2 - 1, 0, u.d / 2 - 1.55);
            c1.rotation.y = Math.PI;
            g.add(sofa, coffee, d1, c1);
            if (!ghost) seat(u.w / 2 - 1, u.d / 2 - 1.52, 0);
          } else {
            const shared = u.typeKey === "SHARED_OFFICE";
            const n = Math.min(shared ? 24 : 6, Math.max(1, u.capacity));
            const cols = Math.max(1, Math.floor((u.w - 0.6) / 1.5));
            const rows = Math.max(1, Math.ceil(n / cols));
            const rowGap = Math.min(1.9, (u.d - 0.8) / rows);
            let placed = 0;
            for (let i = 0; i < n; i++) {
              const col = i % cols;
              const row = Math.floor(i / cols);
              const x = -u.w / 2 + 0.3 + (u.w - 0.6) * ((col + 0.5) / cols);
              const z = -u.d / 2 + 0.5 + rowGap * (row + 0.35);
              if (z > u.d / 2 - 0.4) break;
              const occupied = shared ? i < u.occupiedSeats : rented;
              const s = Math.min(1, (u.w - 0.4) / cols / 1.45);
              const d1 = desk(occupied);
              d1.position.set(x, 0, z);
              d1.scale.setScalar(s);
              const c = chair(occupied ? seatMat : mat.chair);
              c.position.set(x, 0, z + 0.55);
              g.add(d1, c);
              if (occupied && (shared ? placed < 6 : placed < 2)) {
                seat(x, z + 0.52, Math.PI, s);
                placed++;
              }
            }
          }
          if (u.kind !== "facility") {
            const pl = plant();
            pl.position.set(u.w / 2 - 0.35, 0, -u.d / 2 + 0.35);
            g.add(pl);
          }

          // الشارة الدائرية المتوهجة فوق الغرفة
          const badge = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: tex.badge(TONE[u.tone].color, iconFor(u), day), transparent: true, depthWrite: false, toneMapped: false, color: ghost ? 0x8899aa : day ? 0xffffff : bright(0xffffff, 1.35), opacity: ghost ? 0.55 : 1 }),
          );
          const bs = ghost ? 0.85 : u.kind === "facility" ? 0.95 : 1.15;
          badge.scale.set(bs, bs, 1);
          badge.position.y = NET_Y;
          badge.renderOrder = 2;
          badge.userData.unitId = u.id;
          g.add(badge);
          pickables.push(badge);

          // خط من الشارة إلى أقرب ممر (الشبكة)
          let li = 0;
          laneZ.forEach((z, i) => {
            if (Math.abs(z - cz) < Math.abs(laneZ[li]! - cz)) li = i;
          });
          const lz = laneZ[li]!;
          const node = new THREE.Vector3(cx, NET_Y, cz);
          const junction = new THREE.Vector3(cx, NET_Y, lz);
          if (Math.abs(cz - lz) > 0.3) net.add(segment(node, junction, ghost ? mat.netDim : mat.net));
          laneSpan[li] = [Math.min(laneSpan[li]![0], cx), Math.max(laneSpan[li]![1], cx)];
          const hub = new THREE.Vector3(0, NET_Y, laneZ[0]!);
          if (!ghost && !reduce && !day) {
            const pts = [node, junction, new THREE.Vector3(0, NET_Y, lz)];
            if (li !== 0) pts.push(hub);
            let len = 0;
            for (let i = 1; i < pts.length; i++) len += pts[i]!.distanceTo(pts[i - 1]!);
            const dot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mat.dot);
            net.add(dot);
            flows.push({ mesh: dot, pts, len, off: Math.random() * len, speed: 2 + Math.random() * 1.2 });
          }
          // باب الغرفة على الممر (للمشاة)
          const front = oz + u.y + u.d;
          if (u.kind !== "plan" && lz - front > 0.2 && lz - front < 2.8) doorsByLane[li]!.push({ x: cx, zIn: front - 0.9 });

          // اسم الوحدة والمستأجر
          const tag = document.createElement("div");
          tag.className = day
            ? "pointer-events-none select-none whitespace-nowrap rounded-md bg-white/90 px-2 py-0.5 text-center text-[11px] leading-tight text-[#4a3a2c] shadow-md ring-1 ring-black/5"
            : "pointer-events-none select-none whitespace-nowrap rounded-md bg-slate-950/75 px-2 py-0.5 text-center text-[11px] leading-tight text-white shadow-lg ring-1 ring-cyan-300/25 backdrop-blur-sm";
          const code = document.createElement("b");
          code.textContent = u.code;
          code.style.color = TONE[u.tone].color;
          tag.appendChild(code);
          if (u.kind === "plan") {
            const sub = document.createElement("span");
            sub.className = day ? "block text-[10px] text-[#9a8775]" : "block text-[10px] text-slate-400";
            sub.textContent = "غير مسجلة";
            tag.appendChild(sub);
          } else if (u.tenants[0]) {
            const sub = document.createElement("span");
            sub.className = day ? "block max-w-36 truncate text-[10px] text-[#7a6552]" : "block max-w-36 truncate text-[10px] text-slate-200";
            sub.textContent = u.tenants[0];
            tag.appendChild(sub);
          }
          const lbl = new CSS2DObject(tag);
          lbl.position.y = NET_Y + 0.95;
          // أسماء الغرف غير المسجلة تظهر عند المرور فقط حتى لا يزدحم المجسم
          lbl.visible = u.kind !== "plan";
          g.add(lbl);

          const delay = reduce ? 0 : 0.35 + ui * 0.05 + fi * 0.4;
          lastDelay = Math.max(lastDelay, delay);
          built.push({ label: lbl, group: g, unit: u, tile, badge, delay, lift: 0 });
        });

        // الخطوط الرئيسية للشبكة على امتداد الممرات + المحور المركزي
        laneZ.forEach((z, i) => {
          const [a, b] = laneSpan[i]!;
          const from = Math.min(a, 0);
          const to = Math.max(b, 0);
          if (to - from > 0.1) net.add(segment(new THREE.Vector3(from, NET_Y, z), new THREE.Vector3(to, NET_Y, z), mat.net, 0.045));
          if (i > 0) net.add(segment(new THREE.Vector3(0, NET_Y, z), new THREE.Vector3(0, NET_Y, laneZ[0]!), mat.net, 0.045));
        });
        const hub = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.badge("#22d3ee", "hub"), transparent: true, depthWrite: false, toneMapped: false, color: bright(0xffffff, 1.5), opacity: 0 }));
        hub.scale.set(2, 2, 1);
        hub.position.set(0, NET_Y + 0.2, laneZ[0]!);
        hub.renderOrder = 3;
        net.add(hub);
        hubs.push(hub);
        net.visible = !day; // الشبكة المتوهجة للوضع الليلي فقط

        // مشاة يتحركون بهدوء في الممرات ويدخلون بعض المكاتب
        const people = Math.min(10, Math.max(3, Math.round(floor.units.length / 4)));
        for (let p = 0; p < people; p++) {
          const li = p % laneZ.length;
          const person = kit.person(OUTFITS[(p + fi * 3) % OUTFITS.length]!, { seed: Math.random() });
          const span: [number, number] = [-maxW / 2 + 0.8, maxW / 2 - 0.8];
          const w: Walker = {
            p: person,
            x: span[0] + Math.random() * (span[1] - span[0]),
            z: laneZ[li]! + (Math.random() - 0.5) * 0.7,
            heading: Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2,
            queue: [],
            pause: Math.random() * 2,
            amp: 0,
            phase: Math.random() * 6,
            speed: 0.55 + Math.random() * 0.3,
            lane: laneZ[li]!,
            span,
            doors: doorsByLane[li]!,
          };
          person.root.position.set(w.x, 0, w.z);
          person.root.rotation.y = w.heading;
          fg.add(person.root);
          walkers.push(w);
        }
      });

      const planWalk = (w: Walker) => {
        const sub = w.lane + (Math.random() - 0.5) * 0.8;
        if (w.doors.length && Math.random() < 0.35) {
          const d = w.doors[Math.floor(Math.random() * w.doors.length)]!;
          w.queue.push({ x: d.x, z: sub, pause: 0 }, { x: d.x, z: d.zIn, pause: 2 + Math.random() * 3 }, { x: d.x, z: sub, pause: 0.4 });
        } else {
          w.queue.push({ x: w.span[0] + Math.random() * (w.span[1] - w.span[0]), z: sub, pause: Math.random() < 0.4 ? 0 : 1 + Math.random() * 3 });
        }
      };
      const angleDiff = (a: number, b: number) => {
        let d = a - b;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return d;
      };
      const stepWalker = (w: Walker, dt: number, t: number) => {
        let goal = 0;
        if (w.pause > 0) w.pause -= dt;
        else {
          if (!w.queue.length) planWalk(w);
          const tg = w.queue[0]!;
          const dx = tg.x - w.x;
          const dz = tg.z - w.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.06) {
            w.pause = tg.pause;
            w.queue.shift();
          } else {
            const diff = angleDiff(Math.atan2(dx, dz), w.heading);
            w.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, diff));
            goal = Math.abs(diff) < 0.5 ? 1 : 0.25;
            const step = Math.min(dist, w.speed * w.amp * dt);
            w.x += Math.sin(w.heading) * step;
            w.z += Math.cos(w.heading) * step;
            w.phase += (step / 1.3) * Math.PI * 2;
          }
        }
        w.amp += (goal - w.amp) * Math.min(1, dt * 3.5);
        w.p.root.position.set(w.x, 0, w.z);
        w.p.root.rotation.y = w.heading;
        poseWalk(w.p, w.phase, w.amp, t);
      };

      // ── الكاميرا والتحكم ──
      const span = Math.max(maxW, maxD);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI / 2.15;
      controls.minDistance = 4;
      controls.maxDistance = span * 4 + 40;
      controls.autoRotate = !reduce;
      controls.autoRotateSpeed = 0.35;
      controls.addEventListener("start", () => (controls.autoRotate = false));

      let focusY = 0;
      let visibleFloors = floorGroups.length;
      const goal = new THREE.Vector3();
      const placeCamera = (instant: boolean) => {
        // المسافة من نصف قطر المبنى، والنظر إلى الضلع الأطول من الأمام بزاوية شبه متساوية القياس
        const radius = Math.hypot(maxW, maxD) / 2;
        const r = radius * 1.55 + 6 + (visibleFloors > 1 ? (visibleFloors - 1) * 4 : 0);
        const multi = visibleFloors > 1;
        const wide = maxW >= maxD;
        const h = focusY + (multi ? (visibleFloors - 1) * FLOOR_GAP * 0.55 + r * 0.5 : r * 0.72);
        if (wide) goal.set(r * 0.42, h, r * 0.9);
        else goal.set(r * 0.9, h, r * 0.42);
        controls.target.set(0, focusY + (visibleFloors > 1 ? (visibleFloors - 1) * FLOOR_GAP * 0.4 : 0.6), 0);
        if (instant) camera.position.copy(goal);
      };
      const showFloor = (i: number | "all") => {
        floorGroups.forEach((g, gi) => {
          g.visible = i === "all" || gi === i;
          g.position.y = i === "all" ? gi * FLOOR_GAP : 0;
        });
        visibleFloors = i === "all" ? floorGroups.length : 1;
        focusY = 0;
        placeCamera(false);
        intro = reduce ? 1 : 0;
        introStart = clock.elapsedTime;
        startPos.copy(camera.position);
      };

      const startPos = new THREE.Vector3(span * 2.6 + 20, span * 2.2 + 25, -span * 0.4);
      camera.position.copy(startPos);
      placeCamera(reduce);
      moon.position.set(-span * 0.6, span * 1.4 + 20, span * 0.8);
      if (day) {
        moon.position.set(-span * 0.75, span * 0.85 + 10, span * 0.45); // شمس مائلة: ظلال أطول وأوضح
        scene.fog = new THREE.Fog(BG, span * 3 + 40, span * 7 + 140);
        const sc = moon.shadow.camera;
        const half = span / 2 + 4;
        sc.left = -half;
        sc.right = half;
        sc.top = half;
        sc.bottom = -half;
        sc.near = 1;
        sc.far = span * 4 + 80;
        sc.updateProjectionMatrix();
        // الظلال: كل الأثاث والجدران تُلقي ظلًا، والأرضيات تستقبله
        scene.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          const mm = m.material as Material;
          m.receiveShadow = true;
          m.castShadow = !mm.transparent && m.geometry.type !== "PlaneGeometry" && m.geometry.type !== "CircleGeometry";
        });
      }

      let intro = reduce ? 1 : 0;
      let introStart = 0;
      api.current = {
        showFloor,
        reset: () => {
          controls.autoRotate = !reduce;
          intro = reduce ? 1 : 0;
          introStart = clock.elapsedTime;
          startPos.copy(camera.position);
        },
      };

      // ── التفاعل ──
      const ray = new THREE.Raycaster();
      const ptr = new THREE.Vector2();
      let hovered: Built | null = null;
      const pick = (ev: PointerEvent) => {
        const r = renderer.domElement.getBoundingClientRect();
        ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ptr, camera);
        const hit = ray.intersectObjects(pickables.filter((o) => o.parent?.parent?.visible !== false), false)[0];
        const id = hit?.object.userData.unitId as string | undefined;
        return { found: id ? built.find((b) => b.unit.id === id) ?? null : null, r };
      };
      const onMove = (ev: PointerEvent) => {
        const { found, r } = pick(ev);
        if (found !== hovered) {
          if (hovered?.unit.kind === "plan") hovered.label.visible = false;
          hovered = found;
          if (found?.unit.kind === "plan") found.label.visible = true;
          renderer.domElement.style.cursor = found?.unit.kind === "unit" ? "pointer" : "grab";
        }
        setHover(found ? { unit: found.unit, x: ev.clientX - r.left, y: ev.clientY - r.top } : null);
      };
      let downAt = 0;
      const onDown = () => (downAt = performance.now());
      const onUp = (ev: PointerEvent) => {
        if (performance.now() - downAt > 250) return; // سحب وليس ضغطة
        const { found } = pick(ev);
        if (found && found.unit.kind === "unit") router.push(`/units/${found.unit.id}`);
      };
      const onLeave = () => {
        hovered = null;
        setHover(null);
      };
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("pointerleave", onLeave);

      const ro = new ResizeObserver(() => {
        camera.aspect = W() / H();
        camera.updateProjectionMatrix();
        renderer.setSize(W(), H());
        composer?.setSize(W(), H());
        labels.setSize(W(), H());
      });
      ro.observe(el);

      // ── الحركة ──
      const clock = new THREE.Clock();
      const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
      const tmp = new THREE.Vector3();
      for (const w of walkers) poseWalk(w.p, w.phase, 0, 0);
      for (const p of seated) poseSeated(p, p.seed * 10);
      let raf = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, clock.getDelta());
        const t = clock.elapsedTime;
        if (intro < 1) {
          intro = Math.min(1, (t - introStart) / 2.6); // بالوقت الفعلي: نفس المدة على الأجهزة البطيئة
          camera.position.lerpVectors(startPos, goal, ease(intro));
        }
        for (const b of built) {
          const k = reduce ? 1 : ease((t - b.delay) / 0.8);
          b.group.scale.set(1, Math.max(0.001, k), 1);
          const target = hovered === b ? 0.25 : 0;
          b.lift += (target - b.lift) * Math.min(1, dt * 10);
          b.group.position.y = b.lift;
          (b.tile.material as InstanceType<typeof THREE.MeshStandardMaterial>).emissiveIntensity = hovered === b ? 0.45 : 0;
          if (!reduce) {
            b.badge.position.y = NET_Y + Math.sin(t * 1.3 + b.delay * 3) * 0.06;
            const pulse = b.unit.tone === "available" || b.unit.tone === "expiring" ? 1 + Math.sin(t * 2.6) * 0.08 : 1;
            const base = b.unit.kind === "plan" ? 0.85 : b.unit.kind === "facility" ? 0.95 : 1.15;
            const s = base * pulse * (hovered === b ? 1.2 : 1);
            b.badge.scale.set(s, s, 1);
          }
        }
        // الشبكة تظهر بعد اكتمال بناء الغرف
        const nf = reduce ? 1 : ease((t - lastDelay - 0.6) / 1.2);
        mat.net.opacity = 0.9 * nf;
        mat.netDim.opacity = 0.35 * nf;
        mat.dot.opacity = nf;
        for (const h of hubs) {
          h.material.opacity = nf;
          const s = 2 + (reduce ? 0 : Math.sin(t * 1.8) * 0.12);
          h.scale.set(s, s, 1);
        }
        if (!reduce) {
          for (const f of flows) {
            let d = (f.off + t * f.speed) % f.len;
            for (let i = 1; i < f.pts.length; i++) {
              const seg = f.pts[i]!.distanceTo(f.pts[i - 1]!);
              if (d <= seg || i === f.pts.length - 1) {
                tmp.lerpVectors(f.pts[i - 1]!, f.pts[i]!, seg ? Math.min(1, d / seg) : 0);
                break;
              }
              d -= seg;
            }
            f.mesh.position.copy(tmp);
          }
          for (const w of walkers) stepWalker(w, dt, t);
          for (const p of seated) poseSeated(p, t);
        }
        controls.update();
        if (composer) composer.render();
        else renderer.render(scene, camera);
        labels.render(scene, camera);
      };
      loop();
      setReady(true);


      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointerup", onUp);
        renderer.domElement.removeEventListener("pointerleave", onLeave);
        scene.traverse((o) => {
          const m = o as InstanceType<typeof THREE.Mesh>;
          m.geometry?.dispose?.();
          const mm = m.material as InstanceType<typeof THREE.Material> | InstanceType<typeof THREE.Material>[] | undefined;
          (Array.isArray(mm) ? mm : mm ? [mm] : []).forEach((x) => x.dispose());
        });
        tex.all().forEach((x) => x.dispose());
        kit.shemaghTex.dispose();
        composer?.dispose?.();
        renderer.dispose();
        el.replaceChildren();
        api.current = null;
      };
    })().catch(() => setFailed(true));
    return () => {
      disposed = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- يُعاد البناء فقط عند تغير بيانات المشهد
  }, [floorsKey, theme]);


  useEffect(() => {
    api.current?.showFloor(active);
  }, [active]);

  if (failed)
    return (
      <div className="grid place-items-center rounded-2xl bg-gray-50 p-10 text-center text-sm text-gray-600 ring-1 ring-gray-200" style={{ height }}>
        متصفحك لا يدعم العرض ثلاثي الأبعاد (WebGL). جرّب متصفحًا حديثًا مثل Chrome، أو استخدم صفحة الوحدات.
      </div>
    );

  const u = hover?.unit;
  return (
    <div className={theme === "day" ? "relative overflow-hidden rounded-2xl bg-[#efe7dc] ring-1 ring-[#d9cbb8]" : "relative overflow-hidden rounded-2xl bg-[#050b16] ring-1 ring-cyan-400/20"} style={{ height }} data-branch-3d data-theme={theme}>
      <div ref={host} className="absolute inset-0" />
      {!ready && (
        <div className={`absolute inset-0 grid place-items-center text-sm ${theme === "day" ? "text-[#7a6552]" : "text-brand-100"}`} role="status">
          <span className="flex items-center gap-2"><span className="size-4 animate-spin rounded-full border-2 border-accent-300 border-t-transparent" />جارٍ بناء المجسم…</span>
        </div>
      )}

      {floors.length > 1 && (
        <div className={`absolute start-4 top-4 flex flex-wrap gap-1.5 rounded-xl p-1 text-xs ring-1 backdrop-blur ${theme === "day" ? "bg-white/70 ring-black/5 [&_button:not([aria-selected=true])]:text-[#5b4636]" : "bg-white/10 ring-white/15"}`} role="tablist" aria-label="الأدوار">
          <button type="button" role="tab" aria-selected={active === "all"} onClick={() => setActive("all")} className={active === "all" ? "rounded-lg bg-white px-3 py-1.5 font-semibold text-brand-900" : "rounded-lg px-3 py-1.5 text-white hover:bg-white/10"}>كل الأدوار</button>
          {floors.map((f, i) => (
            <button key={f.id ?? "none"} type="button" role="tab" aria-selected={active === i} onClick={() => setActive(i)} className={active === i ? "rounded-lg bg-white px-3 py-1.5 font-semibold text-brand-900" : "rounded-lg px-3 py-1.5 text-white hover:bg-white/10"}>{f.name}</button>
          ))}
        </div>
      )}
      <div className="absolute end-4 top-4 flex gap-1.5">
        {(["switch", "reset"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => (k === "reset" ? api.current?.reset() : switchTheme())}
            aria-pressed={k === "switch" ? theme === "night" : undefined}
            className={`rounded-xl px-3 py-1.5 text-xs ring-1 backdrop-blur transition ${theme === "day" ? "bg-white/75 text-[#5b4636] ring-black/5 hover:bg-white" : "bg-white/10 text-white ring-white/15 hover:bg-white/20"}`}
            data-theme-toggle={k === "switch" ? "" : undefined}
          >
            {k === "reset" ? "↻ إعادة الجولة" : theme === "day" ? "☾ العرض الليلي" : "☀ العرض النهاري"}
          </button>
        ))}
      </div>
      <p className={`pointer-events-none absolute bottom-3 start-4 text-[11px] ${theme === "day" ? "text-[#8a7560]" : "text-brand-100/80"}`}>اسحب للف · مرّر للتقريب · اضغط على مكتب لفتح بياناته</p>

      {u && hover && (
        <div
          className="pointer-events-none absolute z-10 w-60 animate-scale-in rounded-xl bg-white/95 p-3 text-xs shadow-2xl ring-1 ring-black/5 backdrop-blur"
          style={{ left: Math.min(hover.x + 14, (host.current?.clientWidth ?? 600) - 250), top: Math.max(8, hover.y - 10) }}
          role="tooltip"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-brand-900">{u.code}</p>
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: TONE[u.tone].color }}>{u.statusLabel}</span>
          </div>
          <p className="mt-0.5 text-gray-500">{u.typeName}{u.kind !== "facility" ? ` · السعة ${u.capacity}` : ""}{u.areaSqm ? ` · ${u.areaSqm} م²` : ""}</p>
          {u.kind === "plan" && <p className="mt-1.5 text-gray-700">من مخطط الفرع — سجّلها في «المكاتب والوحدات» بالرقم <b>{u.code}</b> لتظهر حالتها.</p>}
          {u.tenants.length > 0 && <p className="mt-1.5 font-medium text-gray-900">{u.tenants.join("، ")}</p>}
          {u.until && <p className="text-gray-500">حتى {u.until}{u.daysLeft !== null && u.daysLeft <= 30 ? ` — متبقٍ ${u.daysLeft} يومًا` : ""}</p>}
          {u.bookedNow && <p className="mt-1 font-semibold text-amber-700">محجوزة الآن</p>}
          {u.kind === "unit" && <p className="tabular mt-1.5 font-semibold text-brand-900">{Number(u.price).toLocaleString("en", { minimumFractionDigits: 2 })} ر.س / {u.cycle}</p>}
        </div>
      )}
    </div>
  );
}
