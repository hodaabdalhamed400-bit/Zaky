"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { buttonClass } from "./primitives";

const MAX_SIDE = 2200; // يكفي لقراءة الفاتورة بوضوح
const QUALITY = 0.85;

/** تصغير صورة الكاميرا قبل الرفع (أسرع على شبكة الجوال، ولا تتجاوز حد 10 ميجابايت). يعيد الأصل عند أي تعذر. */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]*$/, "") || "فاتورة";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

/**
 * حقل مرفق بخيارين: «تصوير» يفتح كاميرا الجوال مباشرة، و«اختيار ملف» لملف PDF أو صورة.
 * الملف المختار يوضع في حقل واحد باسم `name` فيُرسل مع النموذج كالمعتاد.
 */
export function FileOrCamera({ name = "file", id, hint }: { name?: string; id: string; hint?: string }) {
  const target = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<{ name: string; size: number; preview: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (chosen?.preview) URL.revokeObjectURL(chosen.preview); }, [chosen]);

  // عند إعادة ضبط النموذج (بعد رفع ناجح) نمسح المعاينة
  useEffect(() => {
    const form = target.current?.form;
    if (!form) return;
    const onReset = () => setChosen(null);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const take = async (input: HTMLInputElement | null) => {
    const f = input?.files?.[0];
    if (!f || !target.current) return;
    setBusy(true);
    const file = await shrinkImage(f);
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      target.current.files = dt.files;
    } catch {
      // متصفح قديم لا يدعم DataTransfer: نرسل الملف الأصلي من الحقل نفسه
      if (input) input.name = name;
    }
    setChosen({ name: file.name, size: file.size, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    setBusy(false);
    if (input) input.value = "";
  };

  const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} م.ب` : `${Math.ceil(n / 1024)} ك.ب`);

  return (
    <div className="space-y-2">
      <input ref={target} id={id} name={name} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={() => take(camera.current)} />
      <input ref={picker} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={() => take(picker.current)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => camera.current?.click()} className={buttonClass("primary")} disabled={busy}>
          <Icon name="camera" className="size-4" />
          تصوير الفاتورة
        </button>
        <button type="button" onClick={() => picker.current?.click()} className={buttonClass("secondary")} disabled={busy}>
          <Icon name="inbox" className="size-4" />
          اختيار ملف
        </button>
      </div>
      {busy && <p className="text-xs text-gray-500" role="status">جارٍ تجهيز الصورة…</p>}
      {chosen && !busy && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-sm" role="status">
          {chosen.preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- معاينة محلية قبل الرفع
            <img src={chosen.preview} alt="معاينة الفاتورة" className="size-14 rounded-md object-cover ring-1 ring-emerald-200" />
          ) : (
            <span className="grid size-14 place-items-center rounded-md bg-white text-xs font-bold text-red-700 ring-1 ring-emerald-200">PDF</span>
          )}
          <div className="min-w-0">
            <p className="flex items-center gap-1 font-medium text-emerald-800"><Icon name="check" className="size-4" /> جاهز للرفع</p>
            <p className="truncate text-xs text-gray-500" dir="ltr">{chosen.name} · {kb(chosen.size)}</p>
          </div>
        </div>
      )}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
