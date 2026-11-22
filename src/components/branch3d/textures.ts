// نقوش مرسومة على Canvas للمجسم: البلاط، الخشب، التوهج، وأيقونات الحالة الدائرية.
type Three = typeof import("three");
type Tex = InstanceType<Three["CanvasTexture"]>;

export type BadgeIcon = "desk" | "people" | "meeting" | "admin" | "water" | "plan" | "hub";

function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!] as const;
}

export function createTextures(THREE: Three) {
  const wrap = (c: HTMLCanvasElement, srgb = true) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };

  /** بلاط بخطوط رفيعة (2م لكل بلاطة): داكن لليلي، رخامي فاتح للنهاري */
  const makeTiles = (light: boolean) => {
    const [c, x] = canvas(256);
    x.fillStyle = light ? "#e9e1d6" : "#101a28";
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const v = (i * 7 + j * 3) % 5;
        x.fillStyle = light ? `rgb(${236 - v * 2},${228 - v * 2},${216 - v * 2})` : `rgb(${16 + v},${26 + v},${40 + v})`;
        x.fillRect(i * 64 + 1, j * 64 + 1, 62, 62);
      }
    x.strokeStyle = light ? "#d6cbbc" : "#1e3048";
    x.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke();
      x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke();
    }
    const t = wrap(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const tiles = makeTiles(false);
  const tilesLight = makeTiles(true);

  /** أرضية خشبية: دافئة لليلي، بلوط فاتح للنهاري */
  const makeWood = (base: [number, number, number]) => {
    const [c, x] = canvas(256);
    for (let r = 0; r < 16; r++) {
      const shade = 0.82 + ((r * 37) % 11) / 55;
      x.fillStyle = `rgb(${Math.min(255, Math.round(base[0] * shade))},${Math.min(255, Math.round(base[1] * shade))},${Math.min(255, Math.round(base[2] * shade))})`;
      x.fillRect(0, r * 16, 256, 16);
      x.fillStyle = "rgba(40,24,12,.35)";
      x.fillRect(0, r * 16, 256, 1);
      x.fillRect(((r * 97) % 200) + 20, r * 16, 1, 16);
    }
    for (let i = 0; i < 260; i++) {
      x.fillStyle = `rgba(60,36,18,${Math.random() * 0.08})`;
      x.fillRect(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 40, 1);
    }
    const t = wrap(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const wood = makeWood([150, 108, 74]);
  const woodLight = makeWood([226, 196, 158]);

  /** بقعة ضوء ناعمة (للإضاءة على الأرض والظلال) */
  const glow = (() => {
    const [c, x] = canvas(128);
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.35, "rgba(255,255,255,.55)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    return wrap(c, false);
  })();

  const drawIcon = (x: CanvasRenderingContext2D, icon: BadgeIcon, color: string) => {
    x.strokeStyle = color;
    x.fillStyle = color;
    x.lineWidth = 7;
    x.lineCap = "round";
    x.lineJoin = "round";
    switch (icon) {
      case "desk": // شاشة
        x.strokeRect(78, 82, 100, 64);
        x.beginPath(); x.moveTo(128, 148); x.lineTo(128, 170); x.moveTo(104, 174); x.lineTo(152, 174); x.stroke();
        break;
      case "people": // ثلاثة أشخاص
        for (const [cx, r] of [[92, 13], [164, 13], [128, 17]] as const) {
          x.beginPath(); x.arc(cx, cx === 128 ? 100 : 108, r, 0, Math.PI * 2); x.fill();
          x.beginPath(); x.arc(cx, cx === 128 ? 168 : 170, r * 2.1, Math.PI, 0); x.fill();
        }
        break;
      case "meeting": // طاولة وكراسٍ
        x.beginPath(); x.ellipse(128, 128, 42, 26, 0, 0, Math.PI * 2); x.stroke();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          x.beginPath(); x.arc(128 + Math.cos(a) * 64, 128 + Math.sin(a) * 44, 8, 0, Math.PI * 2); x.fill();
        }
        break;
      case "admin": // حقيبة
        x.strokeRect(80, 104, 96, 64);
        x.strokeRect(108, 86, 40, 18);
        x.beginPath(); x.moveTo(80, 132); x.lineTo(176, 132); x.stroke();
        break;
      case "water": // قطرة
        x.beginPath();
        x.moveTo(128, 76);
        x.bezierCurveTo(160, 120, 168, 136, 168, 150);
        x.arc(128, 150, 40, 0, Math.PI);
        x.bezierCurveTo(88, 136, 96, 120, 128, 76);
        x.stroke();
        break;
      case "plan": // علامة +
        x.setLineDash([10, 10]);
        x.beginPath(); x.arc(128, 128, 46, 0, Math.PI * 2); x.stroke();
        x.setLineDash([]);
        x.beginPath(); x.moveTo(128, 108); x.lineTo(128, 148); x.moveTo(108, 128); x.lineTo(148, 128); x.stroke();
        break;
      case "hub":
        x.font = "bold 50px system-ui, sans-serif";
        x.textAlign = "center";
        x.textBaseline = "middle";
        x.fillText("ZAKI", 128, 132);
        break;
    }
  };

  const badgeCache = new Map<string, Tex>();
  /** شارة دائرية متوهجة بلون الحالة وأيقونة النوع */
  const badge = (color: string, icon: BadgeIcon, light = false) => {
    const key = color + icon + light;
    const hit = badgeCache.get(key);
    if (hit) return hit;
    const [c, x] = canvas(256);
    const halo = x.createRadialGradient(128, 128, 60, 128, 128, 128);
    halo.addColorStop(0, color + (light ? "40" : "99"));
    halo.addColorStop(1, color + "00");
    x.fillStyle = halo;
    x.fillRect(0, 0, 256, 256);
    x.beginPath(); x.arc(128, 128, 86, 0, Math.PI * 2);
    x.fillStyle = light ? "rgba(255,252,247,.96)" : "rgba(6,14,26,.92)";
    x.fill();
    x.lineWidth = 9;
    x.strokeStyle = color;
    x.stroke();
    x.beginPath(); x.arc(128, 128, 72, 0, Math.PI * 2);
    x.lineWidth = 2;
    x.strokeStyle = color + "88";
    x.stroke();
    drawIcon(x, icon, light ? color : "#ffffff");
    const t = wrap(c);
    badgeCache.set(key, t);
    return t;
  };

  return { tiles, tilesLight, wood, woodLight, glow, badge, all: () => [tiles, tilesLight, wood, woodLight, glow, ...badgeCache.values()] };
}
