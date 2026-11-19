"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { SceneFloor } from "@/services/branch-scene.service";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { Alert, buttonClass, cx, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import type { FormState } from "@/lib/auth/server";
import { TONE } from "./tones";

type Box = { id: string; code: string; floor: number; x: number; y: number; w: number; d: number; tone: keyof typeof TONE; typeName: string };
const SNAP = 0.25;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const overlap = (a: Box, b: Box) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.d - 0.01 && b.y < a.y + a.d - 0.01;

/** ترتيب تلقائي لوحدات دور: صفوف بعرض 30م وممرات بينها */
function pack(boxes: Box[]): Box[] {
  let x = 0;
  let y = 0;
  let row = 0;
  return boxes.map((b) => {
    if (x > 0 && x + b.w > 30) {
      y += row + 2.25;
      x = 0;
      row = 0;
    }
    const out = { ...b, x, y };
    x += b.w + 1.5;
    row = Math.max(row, b.d);
    return out;
  });
}

export function LayoutEditor({
  branchId,
  floors,
  saveAction,
  resetAction,
}: {
  branchId: string;
  floors: SceneFloor[];
  saveAction: (p: FormState, fd: FormData) => Promise<FormState>;
  resetAction: (p: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [boxes, setBoxes] = useState<Box[]>(() =>
    floors.flatMap((f, fi) => f.units.filter((u) => u.kind === "unit").map((u) => ({ id: u.id, code: u.code, floor: fi, x: u.x, y: u.y, w: u.w, d: u.d, tone: u.tone, typeName: u.typeName }))),
  );
  // غرف المخطط الجاهز غير المسجلة والمرافق: تظهر مرجعًا رماديًا ولا تُحرَّك
  const refs = floors.flatMap((f, fi) => f.units.filter((u) => u.kind !== "unit").map((u) => ({ ...u, floor: fi })));
  const [floor, setFloor] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [bg, setBg] = useState<{ url: string; width: number; opacity: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; start: Box } | null>(null);
  const [saveState, onSave, saving] = useActionForm(async (p: FormState, fd: FormData) => {
    const r = await saveAction(p, fd);
    if (r.success) setDirty(false);
    return r;
  }, {});
  const [resetState, onReset, resetting] = useActionForm(resetAction, {});

  const here = boxes.filter((b) => b.floor === floor);
  const hereRefs = refs.filter((r) => r.floor === floor);
  const W = Math.max(36, ...here.map((b) => b.x + b.w + 6), ...hereRefs.map((r) => r.x + r.w + 2), bg ? bg.width + 2 : 0);
  const D = Math.max(22, ...here.map((b) => b.y + b.d + 6), ...hereRefs.map((r) => r.y + r.d + 2));
  const bad = useMemo(() => new Set(here.flatMap((a) => (here.some((b) => b !== a && overlap(a, b)) ? [a.id] : []))), [here]);
  const selected = boxes.find((b) => b.id === sel) ?? null;

  const update = (id: string, patch: Partial<Box>) => {
    setBoxes((all) => all.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setDirty(true);
  };
  const toPlan = (ev: { clientX: number; clientY: number }) => {
    const s = svg.current!;
    const pt = s.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(s.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const onDown = (ev: React.PointerEvent, b: Box, mode: "move" | "resize") => {
    ev.stopPropagation();
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    const p = toPlan(ev);
    drag.current = { id: b.id, mode, sx: p.x, sy: p.y, start: b };
    setSel(b.id);
  };
  const onMove = (ev: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toPlan(ev);
    const dx = p.x - d.sx;
    const dy = p.y - d.sy;
    if (d.mode === "move") update(d.id, { x: clamp(snap(d.start.x + dx), 0, 480), y: clamp(snap(d.start.y + dy), 0, 480) });
    else update(d.id, { w: clamp(snap(d.start.w + dx), 1, 60), d: clamp(snap(d.start.d + dy), 1, 60) });
  };
  const onUp = () => (drag.current = null);
  const onKey = (ev: React.KeyboardEvent) => {
    if (!selected) return;
    const step = ev.shiftKey ? 1 : SNAP;
    const m: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = m[ev.key];
    if (!v) return;
    ev.preventDefault();
    update(selected.id, { x: clamp(selected.x + v[0], 0, 480), y: clamp(selected.y + v[1], 0, 480) });
  };
  const autoArrange = () => {
    const packed = pack(here);
    setBoxes((all) => all.map((b) => packed.find((p) => p.id === b.id) ?? b));
    setDirty(true);
  };
  const numField = (label: string, key: "x" | "y" | "w" | "d", min: number) => (
    <label className="text-xs text-gray-600">
      {label}
      <input
        type="number"
        step={SNAP}
        min={min}
        max={key === "w" || key === "d" ? 60 : 480}
        value={selected ? selected[key] : ""}
        onChange={(e) => selected && update(selected.id, { [key]: clamp(Number(e.target.value) || min, min, key === "w" || key === "d" ? 60 : 480) })}
        className={inputClass + " tabular mt-1"}
        dir="ltr"
      />
    </label>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_18rem]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {floors.length > 1 ? (
            <div className="inline-flex flex-wrap rounded-xl bg-gray-100 p-1 text-sm" role="tablist" aria-label="الأدوار">
              {floors.map((f, i) => (
                <button key={f.id ?? "none"} type="button" role="tab" aria-selected={floor === i} onClick={() => { setFloor(i); setSel(null); }} className={cx("rounded-lg px-3 py-1.5 font-medium transition", floor === i ? "bg-white text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800")}>
                  {f.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-brand-900">{floors[0]?.name}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={autoArrange} className={buttonClass("secondary")}>ترتيب تلقائي لهذا الدور</button>
            <label className={buttonClass("secondary", "cursor-pointer")}>
              صورة المخطط خلفية
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setBg({ url: URL.createObjectURL(f), width: Math.round(W - 4), opacity: 0.45 });
                }}
              />
            </label>
          </div>
        </div>
        {bg && (
          <div className="flex flex-wrap items-center gap-4 rounded-xl bg-accent-50/60 px-3 py-2 text-xs text-gray-700 ring-1 ring-accent-100">
            <span>الصورة للاستعانة فقط ولا تُرفع.</span>
            <label className="flex items-center gap-2">عرض الصورة بالأمتار <input type="number" min={5} max={300} value={bg.width} onChange={(e) => setBg({ ...bg, width: Number(e.target.value) || 20 })} className={inputClass.replace("w-full", "w-20") + " tabular"} dir="ltr" /></label>
            <label className="flex items-center gap-2">الشفافية <input type="range" min={0.1} max={1} step={0.05} value={bg.opacity} onChange={(e) => setBg({ ...bg, opacity: Number(e.target.value) })} /></label>
            <button type="button" onClick={() => setBg(null)} className="text-red-700 hover:underline">إزالة الصورة</button>
          </div>
        )}

        <div dir="ltr" className="overflow-hidden rounded-2xl bg-white ring-1 ring-gray-200" tabIndex={0} onKeyDown={onKey} aria-label="مخطط الدور: اسحب المكاتب لتحريكها، والزاوية لتغيير المقاس، أو استخدم الأسهم">
          <svg ref={svg} viewBox={`-1 -1 ${W + 2} ${D + 2}`} className="block h-auto w-full touch-none select-none" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onPointerDown={() => setSel(null)} data-layout-canvas>
            <defs>
              <pattern id="g1" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#eef2f6" strokeWidth="0.03" /></pattern>
              <pattern id="g5" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#g1)" /><path d="M5 0H0V5" fill="none" stroke="#d9e1ea" strokeWidth="0.06" /></pattern>
            </defs>
            <rect x={-1} y={-1} width={W + 2} height={D + 2} fill="url(#g5)" />
            {bg && <image href={bg.url} x={0} y={0} width={bg.width} opacity={bg.opacity} preserveAspectRatio="xMinYMin meet" />}
            {Array.from({ length: Math.floor(W / 5) + 1 }, (_, i) => (
              <text key={i} x={i * 5} y={-0.25} fontSize={0.6} fill="#94a3b8">{i * 5} م</text>
            ))}
            {hereRefs.map((r) => (
              <g key={r.id} opacity={0.7} pointerEvents="none">
                <rect x={r.x} y={r.y} width={r.w} height={r.d} rx={0.15} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.06} strokeDasharray="0.25 0.18" />
                <text x={r.x + r.w / 2} y={r.y + r.d / 2} fontSize={Math.min(0.8, r.w / 4)} textAnchor="middle" dominantBaseline="middle" fill="#64748b">{r.code}</text>
              </g>
            ))}
            {here.map((b) => {
              const c = TONE[b.tone].color;
              const isSel = b.id === sel;
              return (
                <g key={b.id} data-layout-unit={b.code}>
                  <rect
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.d}
                    rx={0.15}
                    fill={c}
                    fillOpacity={isSel ? 0.35 : 0.2}
                    stroke={bad.has(b.id) ? "#dc2626" : c}
                    strokeWidth={isSel ? 0.14 : 0.08}
                    strokeDasharray={bad.has(b.id) ? "0.3 0.2" : undefined}
                    className="cursor-move"
                    onPointerDown={(e) => onDown(e, b, "move")}
                  />
                  <text x={b.x + b.w / 2} y={b.y + b.d / 2} fontSize={Math.min(0.9, b.w / 4)} textAnchor="middle" dominantBaseline="middle" fill="#132e4b" fontWeight={700} pointerEvents="none">{b.code}</text>
                  <text x={b.x + b.w / 2} y={b.y + b.d / 2 + 0.8} fontSize={0.45} textAnchor="middle" fill="#64748b" pointerEvents="none">{b.w} × {b.d} م</text>
                  <circle cx={b.x + b.w} cy={b.y + b.d} r={isSel ? 0.35 : 0.25} fill="#fff" stroke={c} strokeWidth={0.08} className="cursor-nwse-resize" onPointerDown={(e) => onDown(e, b, "resize")} />
                </g>
              );
            })}
          </svg>
        </div>
        <p className="text-xs text-gray-500">اسحب المكتب لتحريكه، واسحب الدائرة في زاويته لتغيير المقاس (كل مربع صغير = 1م). الأسهم تحرك المكتب المحدد ربع متر، ومع Shift مترًا كاملًا. الحدود الحمراء المتقطعة = تداخل مع مكتب آخر.</p>
      </div>

      <aside className="space-y-4">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-gray-200">
          <p className="mb-2 text-sm font-semibold text-brand-900">{selected ? `المكتب ${selected.code}` : "اختر مكتبًا"}</p>
          {selected ? (
            <>
              <p className="mb-2 text-xs text-gray-500">{selected.typeName}</p>
              <div className="grid grid-cols-2 gap-2">
                {numField("من اليسار (م)", "x", 0)}
                {numField("من الأعلى (م)", "y", 0)}
                {numField("العرض (م)", "w", 1)}
                {numField("العمق (م)", "d", 1)}
              </div>
              <p className="tabular mt-2 text-xs text-gray-500">المساحة على المخطط: {(selected.w * selected.d).toFixed(1)} م²</p>
            </>
          ) : (
            <p className="text-xs text-gray-500">اضغط على أي مكتب في المخطط لتعديل مكانه ومقاسه بدقة.</p>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto rounded-2xl bg-white p-2 ring-1 ring-gray-200">
          {here.map((b) => (
            <button key={b.id} type="button" onClick={() => setSel(b.id)} className={cx("flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition", b.id === sel ? "bg-brand-900 text-white" : "hover:bg-gray-50")}>
              <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: TONE[b.tone].color }} />{b.code}</span>
              <span className={cx("tabular text-xs", b.id === sel ? "text-brand-100" : "text-gray-400")}>{b.w}×{b.d}</span>
            </button>
          ))}
        </div>
        <ActionForm onSubmit={onSave} pending={saving} className="space-y-2">
          <input type="hidden" name="layout" value={JSON.stringify(boxes.map(({ id, x, y, w, d }) => ({ unitId: id, x, y, w, d })))} />
          {saveState.error && <Alert>{saveState.error}</Alert>}
          {saveState.success && !dirty && <Alert kind="success">{saveState.success}</Alert>}
          {bad.size > 0 && <p className="text-xs text-red-700">يوجد {bad.size} مكتب متداخل في هذا الدور — يمكنك الحفظ، لكن راجعها.</p>}
          <SubmitButton className="w-full" pendingText="جارٍ حفظ المخطط…">حفظ المخطط{dirty ? " *" : ""}</SubmitButton>
          <Link href={`/branches/${branchId}/3d`} className={buttonClass("secondary", "w-full")}>عرض المجسم 3D</Link>
        </ActionForm>
        <ActionForm onSubmit={onReset} pending={resetting}>
          {resetState.error && <Alert>{resetState.error}</Alert>}
          <ConfirmButton message="إعادة كل مكاتب الفرع للترتيب التلقائي ومسح المخطط المحفوظ؟" variant="ghost" className="w-full text-red-700">مسح المخطط المحفوظ</ConfirmButton>
        </ActionForm>
      </aside>
    </div>
  );
}
