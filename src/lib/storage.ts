import "server-only";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

/**
 * تخزين خاص للملفات على قرص الخادم.
 * - المفاتيح يولدها النظام فقط (لا يُستخدم اسم الملف المرفوع في المسار).
 * - لا يُخدم المجلد مباشرة؛ التنزيل فقط عبر /api/documents/[id] بعد التحقق من الصلاحيات.
 * الواجهة مصممة ليسهل إضافة مزود S3 متوافق لاحقًا بعد حسم مكان الاستضافة.
 */
const KEY_RE = /^\d{4}\/\d{2}\/[0-9a-f-]{36}$/;

function root() {
  return resolve(env().STORAGE_DIR);
}

function pathFor(key: string) {
  if (!KEY_RE.test(key)) throw new Error("مفتاح تخزين غير صالح");
  const p = resolve(join(root(), key));
  if (!p.startsWith(root() + sep)) throw new Error("مسار خارج مجلد التخزين");
  return p;
}

export function newStorageKey(now = new Date()) {
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
}

export async function putObject(key: string, data: Uint8Array) {
  const p = pathFor(key);
  await mkdir(dirname(p), { recursive: true, mode: 0o700 });
  await writeFile(p, data, { mode: 0o600, flag: "wx" }); // wx: لا يكتب فوق ملف موجود
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(pathFor(key));
}

export async function objectExists(key: string) {
  try {
    await stat(pathFor(key));
    return true;
  } catch {
    return false;
  }
}
