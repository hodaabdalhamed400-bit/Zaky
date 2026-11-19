"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SceneFloor, SceneUnit } from "@/services/branch-scene.service";
import { TONE } from "./tones";

const WALL_H = 2.6;
const FLOOR_GAP = 9;

type Hover = { unit: SceneUnit; x: number; y: number } | null;

export function BranchScene({ floors, height = 620 }: { floors: SceneFloor[]; height?: number }) {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ showFloor: (i: number | "all") => void; reset: () => void } | null>(null);
  const [active, setActive] = useState<number | "all">(floors.length > 1 ? "all" : 0);
  const [hover, setHover] = useState<Hover>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const floorsKey = useMemo(() => JSON.stringify(floors.map((f) => f.units.map((u) => [u.id, u.x, u.y, u.w, u.d, u.tone, u.bookedNow]))), [floors]);

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

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch {
        setFailed(true);
        return;
      }
      const W = () => el.clientWidth;
      const H = () => el.clientHeight;
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.setSize(W(), H());
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
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
      scene.fog = new THREE.Fog(0x0b1f35, 60, 160);
      const camera = new THREE.PerspectiveCamera(42, W() / H(), 0.1, 500);

      scene.add(new THREE.HemisphereLight(0xdbeafe, 0x0b2036, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0005;
      scene.add(sun);
      scene.add(sun.target);
      const accent = new THREE.PointLight(0x1eadc0, 40, 60, 2);
      scene.add(accent);

      // ── مواد مشتركة ──
      const mat = {
        wood: new THREE.MeshStandardMaterial({ color: 0xc9a47e, roughness: 0.6 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5, metalness: 0.4 }),
        chair: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 }),
        sofa: new THREE.MeshStandardMaterial({ color: 0x1a3a5c, roughness: 0.9 }),
        leaf: new THREE.MeshStandardMaterial({ color: 0x2f9e6b, roughness: 0.9 }),
        pot: new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.7 }),
        slab: new THREE.MeshStandardMaterial({ color: 0xe9eef4, roughness: 0.95 }),
        slabEdge: new THREE.MeshStandardMaterial({ color: 0x132e4b, roughness: 0.6 }),
        screenOff: new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.3 }),
        screenOn: new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x38bdf8, emissiveIntensity: 0.8 }),
        person: new THREE.MeshStandardMaterial({ color: 0x132e4b, roughness: 0.6 }),
        head: new THREE.MeshStandardMaterial({ color: 0xe8c4a0, roughness: 0.7 }),
      };
      const box = (w: number, h: number, d: number, m: InstanceType<typeof THREE.Material>) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
      };

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
      const chair = (m: InstanceType<typeof THREE.Material>) => {
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
        l.castShadow = true;
        g.add(p, l);
        return g;
      };

      // ── بناء الطوابق ──
      type Built = { group: InstanceType<typeof THREE.Group>; unit: SceneUnit; tile: InstanceType<typeof THREE.Mesh>; beacon: InstanceType<typeof THREE.Mesh>; delay: number; lift: number };
      const built: Built[] = [];
      const floorGroups: InstanceType<typeof THREE.Group>[] = [];
      const walkers: { mesh: InstanceType<typeof THREE.Group>; from: number; to: number; z: number; speed: number; phase: number }[] = [];
      const pickables: InstanceType<typeof THREE.Object3D>[] = [];
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

      floors.forEach((floor, fi) => {
        const fg = new THREE.Group();
        fg.position.y = fi * FLOOR_GAP;
        scene.add(fg);
        floorGroups.push(fg);

        const slab = box(maxW + 4, 0.3, maxD + 4, mat.slab);
        slab.position.set(0, -0.15, 0);
        slab.castShadow = false;
        fg.add(slab);
        const edge = box(maxW + 4.2, 0.12, maxD + 4.2, mat.slabEdge);
        edge.position.y = -0.33;
        fg.add(edge);
        const grid = new THREE.GridHelper(Math.max(maxW, maxD) + 4, Math.round(Math.max(maxW, maxD) + 4), 0xc7d2de, 0xdde4ec);
        grid.position.y = 0.005;
        (grid.material as InstanceType<typeof THREE.Material>).transparent = true;
        (grid.material as InstanceType<typeof THREE.Material>).opacity = 0.5;
        fg.add(grid);

        const floorLabel = document.createElement("div");
        floorLabel.className = "rounded-full bg-brand-900/85 px-3 py-1 text-xs font-bold text-white shadow-lg ring-1 ring-white/20 backdrop-blur";
        floorLabel.textContent = floor.name;
        const fl = new CSS2DObject(floorLabel);
        fl.position.set(-maxW / 2 - 1, 0.4, maxD / 2 + 1.6);
        fg.add(fl);

        floor.units.forEach((u, ui) => {
          const tone = new THREE.Color(TONE[u.tone].color);
          const g = new THREE.Group();
          g.position.set(ox + u.x + u.w / 2, 0, oz + u.y + u.d / 2);
          fg.add(g);

          const carpet = new THREE.MeshStandardMaterial({ color: tone.clone().lerp(new THREE.Color(0xffffff), 0.72), roughness: 0.95, emissive: tone, emissiveIntensity: 0 });
          const tile = box(u.w - 0.12, 0.06, u.d - 0.12, carpet);
          tile.position.y = 0.03;
          tile.userData.unitId = u.id;
          g.add(tile);
          pickables.push(tile);

          // جدران زجاجية مع فتحة باب في الواجهة
          const glass = new THREE.MeshStandardMaterial({ color: tone, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, depthWrite: false });
          const t = 0.06;
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
          const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(u.w, WALL_H, u.d)), new THREE.LineBasicMaterial({ color: tone, transparent: true, opacity: 0.9 }));
          frame.position.y = WALL_H / 2;
          g.add(frame);

          // الأثاث حسب النوع والسعة
          const rented = u.tone === "rented" || u.tone === "expiring" || u.tone === "partial";
          const seatMat = new THREE.MeshStandardMaterial({ color: tone, roughness: 0.7 });
          if (u.typeKey === "MEETING_ROOM") {
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
              c.position.set(-tw / 2 + (tw / side) * (idx + 0.5), 0, row * (td / 2 + 0.38));
              c.rotation.y = row < 0 ? 0 : Math.PI;
              g.add(c);
            }
            const tv = box(Math.min(2.2, u.w * 0.5), 1.1, 0.06, u.bookedNow ? mat.screenOn : mat.screenOff);
            tv.position.set(0, 1.5, -u.d / 2 + 0.1);
            g.add(tv);
            if (u.bookedNow) {
              const lamp = new THREE.PointLight(0xffc56b, 6, 8, 2);
              lamp.position.set(0, 2.3, 0);
              g.add(lamp);
            }
          } else if (u.typeKey === "ADMIN_SPACE") {
            const sofa = box(Math.min(2.4, u.w * 0.55), 0.45, 0.8, mat.sofa);
            sofa.position.set(0, 0.23, -u.d / 2 + 0.7);
            const coffee = box(1, 0.4, 0.55, mat.wood);
            coffee.position.set(0, 0.2, 0.2);
            const d1 = desk(rented);
            d1.position.set(u.w / 2 - 1, 0, u.d / 2 - 1);
            d1.rotation.y = Math.PI;
            g.add(sofa, coffee, d1);
          } else {
            const shared = u.typeKey === "SHARED_OFFICE";
            const n = Math.min(shared ? 24 : 6, Math.max(1, u.capacity));
            const cols = Math.max(1, Math.floor((u.w - 0.6) / 1.5));
            const rows = Math.max(1, Math.ceil(n / cols));
            const rowGap = Math.min(1.9, (u.d - 0.8) / rows);
            for (let i = 0; i < n; i++) {
              const col = i % cols;
              const row = Math.floor(i / cols);
              const x = -u.w / 2 + 0.3 + (u.w - 0.6) * ((col + 0.5) / cols);
              const z = -u.d / 2 + 0.5 + rowGap * (row + 0.35);
              if (z > u.d / 2 - 0.4) break;
              const occupied = shared ? i < u.occupiedSeats : rented;
              const d1 = desk(occupied);
              d1.position.set(x, 0, z);
              d1.scale.setScalar(Math.min(1, (u.w - 0.4) / cols / 1.45));
              const c = chair(occupied ? seatMat : mat.chair);
              c.position.set(x, 0, z + 0.55);
              g.add(d1, c);
            }
          }
          const pl = plant();
          pl.position.set(u.w / 2 - 0.35, 0, -u.d / 2 + 0.35);
          g.add(pl);

          // علامة الحالة الطائرة
          const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), new THREE.MeshStandardMaterial({ color: tone, emissive: tone, emissiveIntensity: 0.9, roughness: 0.3 }));
          beacon.position.y = WALL_H + 0.8;
          g.add(beacon);

          // اسم الوحدة والمستأجر
          const tag = document.createElement("div");
          tag.className = "pointer-events-none select-none whitespace-nowrap rounded-lg bg-white/90 px-2 py-0.5 text-center text-[11px] leading-tight shadow-md ring-1 ring-black/5";
          const code = document.createElement("b");
          code.textContent = u.code;
          code.style.color = TONE[u.tone].color;
          tag.appendChild(code);
          if (u.tenants[0]) {
            const sub = document.createElement("span");
            sub.className = "block max-w-36 truncate text-[10px] text-gray-600";
            sub.textContent = u.tenants[0];
            tag.appendChild(sub);
          }
          const lbl = new CSS2DObject(tag);
          lbl.position.y = WALL_H + 1.5;
          g.add(lbl);

          built.push({ group: g, unit: u, tile, beacon, delay: reduce ? 0 : 0.35 + ui * 0.07 + fi * 0.4, lift: 0 });
        });

        // أشخاص يتحركون في الممر الأمامي (لمسة حياة)
        const people = reduce ? 0 : Math.min(5, Math.max(2, Math.round(floor.units.length / 3)));
        for (let p = 0; p < people; p++) {
          const m = new THREE.Group();
          const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.75, 4, 10), mat.person);
          body.position.y = 0.6;
          body.castShadow = true;
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), mat.head);
          head.position.y = 1.28;
          head.castShadow = true;
          m.add(body, head);
          fg.add(m);
          const z = maxD / 2 + 0.8 + (p % 2) * 0.7;
          walkers.push({ mesh: m, from: -maxW / 2, to: maxW / 2, z, speed: 0.06 + Math.random() * 0.05, phase: Math.random() });
        }
      });

      // ── الكاميرا والتحكم ──
      const span = Math.max(maxW, maxD);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI / 2.15;
      controls.minDistance = 6;
      controls.maxDistance = span * 4 + 40;
      controls.autoRotate = !reduce;
      controls.autoRotateSpeed = 0.55;
      controls.addEventListener("start", () => (controls.autoRotate = false));

      let focusY = 0;
      let visibleFloors = floorGroups.length;
      const goal = new THREE.Vector3();
      const placeCamera = (instant: boolean) => {
        const r = span * 0.85 + 5 + (visibleFloors > 1 ? (visibleFloors - 1) * 4 : 0);
        const multi = visibleFloors > 1;
        goal.set(r * 0.8, focusY + (multi ? (visibleFloors - 1) * FLOOR_GAP * 0.55 + r * 0.42 : r * 0.72), r * 1.0);
        controls.target.set(0, focusY + (visibleFloors > 1 ? (visibleFloors - 1) * FLOOR_GAP * 0.4 : 0), 0);
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
        startPos.copy(camera.position);
      };

      const startPos = new THREE.Vector3(span * 2.6 + 20, span * 2.2 + 25, -span * 0.4);
      camera.position.copy(startPos);
      placeCamera(reduce);
      sun.position.set(span * 0.8, span * 1.6 + 20, span * 0.6);
      sun.shadow.camera.left = -span;
      sun.shadow.camera.right = span;
      sun.shadow.camera.top = span;
      sun.shadow.camera.bottom = -span;
      sun.shadow.camera.far = span * 6 + 80;
      accent.position.set(-span * 0.6, 8, span * 0.6);

      let intro = reduce ? 1 : 0;
      api.current = {
        showFloor,
        reset: () => {
          controls.autoRotate = !reduce;
          intro = reduce ? 1 : 0;
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
          hovered = found;
          renderer.domElement.style.cursor = found ? "pointer" : "grab";
        }
        setHover(found ? { unit: found.unit, x: ev.clientX - r.left, y: ev.clientY - r.top } : null);
      };
      let downAt = 0;
      const onDown = () => (downAt = performance.now());
      const onUp = (ev: PointerEvent) => {
        if (performance.now() - downAt > 250) return; // سحب وليس ضغطة
        const { found } = pick(ev);
        if (found) router.push(`/units/${found.unit.id}`);
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
        labels.setSize(W(), H());
      });
      ro.observe(el);

      // ── الحركة ──
      const clock = new THREE.Clock();
      const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
      let raf = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, clock.getDelta());
        const t = clock.elapsedTime;
        if (intro < 1) {
          intro = Math.min(1, intro + dt / 2.4);
          camera.position.lerpVectors(startPos, goal, ease(intro));
        }
        for (const b of built) {
          const k = reduce ? 1 : ease((t - b.delay) / 0.8);
          b.group.scale.set(1, Math.max(0.001, k), 1);
          const target = hovered === b ? 0.25 : 0;
          b.lift += (target - b.lift) * Math.min(1, dt * 10);
          b.group.position.y = b.lift;
          (b.tile.material as InstanceType<typeof THREE.MeshStandardMaterial>).emissiveIntensity = hovered === b ? 0.35 : 0;
          if (!reduce) {
            b.beacon.rotation.y = t * 1.4;
            b.beacon.position.y = WALL_H + 0.8 + Math.sin(t * 2 + b.delay * 3) * 0.15;
            const pulse = b.unit.tone === "available" || b.unit.tone === "expiring" ? 1 + Math.sin(t * 4) * 0.22 : 1;
            b.beacon.scale.setScalar(pulse);
          }
        }
        for (const w of walkers) {
          const span2 = w.to - w.from;
          const p = (t * w.speed + w.phase) % 2;
          const fwd = p < 1;
          const x = w.from + span2 * (fwd ? p : 2 - p);
          w.mesh.position.set(x, Math.abs(Math.sin(t * 8 + w.phase * 10)) * 0.05, w.z);
          w.mesh.rotation.y = fwd ? Math.PI / 2 : -Math.PI / 2;
        }
        controls.update();
        renderer.render(scene, camera);
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
  }, [floorsKey]);

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
    <div className="relative overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_top,#1b4268,#0b1f35_70%)] ring-1 ring-brand-900/20" style={{ height }} data-branch-3d>
      <div ref={host} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-sm text-brand-100" role="status">
          <span className="flex items-center gap-2"><span className="size-4 animate-spin rounded-full border-2 border-accent-300 border-t-transparent" />جارٍ بناء المجسم…</span>
        </div>
      )}

      {floors.length > 1 && (
        <div className="absolute start-4 top-4 flex flex-wrap gap-1.5 rounded-xl bg-white/10 p-1 text-xs ring-1 ring-white/15 backdrop-blur" role="tablist" aria-label="الأدوار">
          <button type="button" role="tab" aria-selected={active === "all"} onClick={() => setActive("all")} className={active === "all" ? "rounded-lg bg-white px-3 py-1.5 font-semibold text-brand-900" : "rounded-lg px-3 py-1.5 text-white hover:bg-white/10"}>كل الأدوار</button>
          {floors.map((f, i) => (
            <button key={f.id ?? "none"} type="button" role="tab" aria-selected={active === i} onClick={() => setActive(i)} className={active === i ? "rounded-lg bg-white px-3 py-1.5 font-semibold text-brand-900" : "rounded-lg px-3 py-1.5 text-white hover:bg-white/10"}>{f.name}</button>
          ))}
        </div>
      )}
      <button type="button" onClick={() => api.current?.reset()} className="absolute end-4 top-4 rounded-xl bg-white/10 px-3 py-1.5 text-xs text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20">↻ إعادة الجولة</button>
      <p className="pointer-events-none absolute bottom-3 start-4 text-[11px] text-brand-100/80">اسحب للف · مرّر للتقريب · اضغط على مكتب لفتح بياناته</p>

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
          <p className="mt-0.5 text-gray-500">{u.typeName} · السعة {u.capacity}{u.areaSqm ? ` · ${u.areaSqm} م²` : ""}</p>
          {u.tenants.length > 0 && <p className="mt-1.5 font-medium text-gray-900">{u.tenants.join("، ")}</p>}
          {u.until && <p className="text-gray-500">حتى {u.until}{u.daysLeft !== null && u.daysLeft <= 30 ? ` — متبقٍ ${u.daysLeft} يومًا` : ""}</p>}
          {u.bookedNow && <p className="mt-1 font-semibold text-amber-700">محجوزة الآن</p>}
          <p className="tabular mt-1.5 font-semibold text-brand-900">{Number(u.price).toLocaleString("en", { minimumFractionDigits: 2 })} ر.س / {u.cycle}</p>
        </div>
      )}
    </div>
  );
}
