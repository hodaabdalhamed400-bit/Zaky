// ملاحظة: بدون "server-only" لأن المهمة اليومية وسكربت الاسترجاع يستوردان هذا الملف خارج Next.js
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { PrismaClient } from "@prisma/client";

/**
 * نسخة احتياطية مستقلة عن الاستضافة: كل جداول قاعدة البيانات (+ الملفات المرفوعة اختياريًا)
 * في ملف واحد مضغوط ومشفّر بكلمة سر (AES-256-GCM، والمفتاح مشتق بـ scrypt).
 * - بيانات كل جدول تُحفظ كنص JSON كما يخرجه PostgreSQL (بدون تحويل أرقام في JavaScript ⇐ لا فقد في الدقة المالية).
 * - لا تُنسخ الجلسات ورموز الدخول المؤقتة (تُنشأ من جديد).
 * - الاسترجاع إلى قاعدة جديدة فارغة بعد تطبيق نفس الترحيلات (prisma migrate deploy) — انظر docs/BACKUP.md.
 */

const MAGIC = Buffer.from("ZAKIBAK1");
const SKIP_TABLES = new Set(["_prisma_migrations", "sessions", "password_reset_tokens", "mfa_challenges", "login_attempts"]);
export const MIN_PASSPHRASE = 12;

type Db = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe" | "$transaction">;

export type BackupInfo = { createdAt: string; migration: string | null; tables: Record<string, number>; files: number; bytes: number };

async function tableOrder(db: Db) {
  const tables = (await db.$queryRawUnsafe<{ t: string }[]>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  )).map((r) => r.t).filter((t) => !SKIP_TABLES.has(t));
  const fks = await db.$queryRawUnsafe<{ child: string; parent: string }[]>(
    `SELECT DISTINCT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'`,
  );
  const clean = (s: string) => s.replace(/^public\./, "").replace(/"/g, "");
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const f of fks) {
    const child = clean(f.child);
    const parent = clean(f.parent);
    if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child)!.add(parent);
  }
  // ترتيب طوبولوجي: الجداول الأب أولًا
  const out: string[] = [];
  const left = new Map(deps);
  while (left.size) {
    const ready = [...left.entries()].filter(([, d]) => [...d].every((p) => !left.has(p))).map(([t]) => t);
    if (!ready.length) throw new Error(`تعذّر ترتيب الجداول (اعتماد دائري): ${[...left.keys()].join(", ")}`);
    for (const t of ready.sort()) {
      out.push(t);
      left.delete(t);
    }
  }
  return out;
}

const ident = (t: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`اسم جدول غير متوقع: ${t}`);
  return `"${t}"`;
};

/** يبني الملف الخام (قبل التشفير). */
async function buildPayload(db: Db, opts: { includeFiles: boolean }) {
  const tables = await tableOrder(db);
  const migration = (await db.$queryRawUnsafe<{ m: string }[]>(`SELECT migration_name AS m FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`).catch(() => []))[0]?.m ?? null;
  const parts: Buffer[] = [];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const [row] = await db.$queryRawUnsafe<{ n: number; j: string }[]>(`SELECT count(*)::int AS n, coalesce(json_agg(x), '[]'::json)::text AS j FROM ${ident(t)} x`);
    counts[t] = row!.n;
    const body = Buffer.from(row!.j, "utf8");
    parts.push(Buffer.from(`##TABLE ${t} ${body.length}\n`, "utf8"), body, Buffer.from("\n"));
  }
  let files = 0;
  if (opts.includeFiles && tables.includes("documents")) {
    // تحميل متأخر: وحدة التخزين خاصة بالخادم، والمهمة اليومية لا تحتاجها
    const { getObject, objectExists } = await import("@/lib/storage");
    const keys = await db.$queryRawUnsafe<{ k: string }[]>(`SELECT DISTINCT storage_key AS k FROM documents WHERE storage_key IS NOT NULL`).catch(() => []);
    for (const { k } of keys) {
      if (!(await objectExists(k).catch(() => false))) continue;
      const data = await getObject(k);
      parts.push(Buffer.from(`##FILE ${k} ${data.length}\n`, "utf8"), data, Buffer.from("\n"));
      files++;
    }
  }
  const info: BackupInfo = { createdAt: new Date().toISOString(), migration, tables: counts, files, bytes: 0 };
  const header = Buffer.from(`##ZAKI ${JSON.stringify(info)}\n`, "utf8");
  const raw = Buffer.concat([header, ...parts]);
  info.bytes = raw.length;
  return { raw, info };
}

export function encrypt(raw: Buffer, passphrase: string) {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`كلمة سر النسخة يجب ألا تقل عن ${MIN_PASSPHRASE} حرفًا`);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(gzipSync(raw, { level: 9 })), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}

export function decrypt(file: Buffer, passphrase: string) {
  if (file.length < 52 || !file.subarray(0, 8).equals(MAGIC)) throw new Error("الملف ليس نسخة احتياطية من ذكي ERP");
  const salt = file.subarray(8, 24);
  const iv = file.subarray(24, 36);
  const tag = file.subarray(36, 52);
  const key = scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  try {
    return gunzipSync(Buffer.concat([d.update(file.subarray(52)), d.final()]));
  } catch {
    throw new Error("كلمة السر غير صحيحة أو الملف تالف");
  }
}

/** ينشئ نسخة مشفرة جاهزة للتنزيل أو الإرسال. */
export async function createBackup(db: Db, passphrase: string, opts: { includeFiles?: boolean } = {}) {
  const { raw, info } = await buildPayload(db, { includeFiles: !!opts.includeFiles });
  return { file: encrypt(raw, passphrase), info };
}

type Section = { kind: "TABLE" | "FILE"; name: string; data: Buffer };
export function parsePayload(raw: Buffer) {
  let pos = raw.indexOf(0x0a);
  const head = raw.subarray(0, pos).toString("utf8");
  if (!head.startsWith("##ZAKI ")) throw new Error("محتوى النسخة غير صالح");
  const info = JSON.parse(head.slice(7)) as BackupInfo;
  const sections: Section[] = [];
  pos++;
  while (pos < raw.length) {
    const nl = raw.indexOf(0x0a, pos);
    const m = raw.subarray(pos, nl).toString("utf8").match(/^##(TABLE|FILE) (\S+) (\d+)$/);
    if (!m) throw new Error("محتوى النسخة غير صالح");
    const len = Number(m[3]);
    sections.push({ kind: m[1] as Section["kind"], name: m[2]!, data: raw.subarray(nl + 1, nl + 1 + len) });
    pos = nl + 1 + len + 1;
  }
  return { info, sections };
}

/**
 * يسترجع النسخة إلى قاعدة بيانات جديدة (بعد prisma migrate deploy، وبدون seed).
 * يرفض إن كانت القاعدة فيها بيانات أو بنسخة ترحيلات مختلفة، إلا مع force.
 */
export async function restoreBackup(db: Db, file: Buffer, passphrase: string, opts: { force?: boolean; restoreFiles?: boolean } = {}) {
  const { info, sections } = parsePayload(decrypt(file, passphrase));
  const current = (await db.$queryRawUnsafe<{ m: string }[]>(`SELECT migration_name AS m FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`))[0]?.m ?? null;
  if (info.migration && current !== info.migration && !opts.force)
    throw new Error(`إصدار قاعدة البيانات مختلف (النسخة: ${info.migration}، القاعدة: ${current}). شغّل نفس إصدار النظام ثم prisma migrate deploy.`);
  const order = await tableOrder(db);
  const tables = new Map(sections.filter((s) => s.kind === "TABLE").map((s) => [s.name, s.data.toString("utf8")]));
  if (!opts.force) {
    for (const t of order) {
      const [r] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${ident(t)}`);
      if (r!.n > 0) throw new Error(`القاعدة ليست فارغة (الجدول ${t} فيه بيانات). استرجع إلى قاعدة جديدة.`);
    }
  }
  const restored: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    for (const t of order) {
      const json = tables.get(t);
      if (!json || json === "[]") continue;
      await tx.$executeRawUnsafe(`ALTER TABLE ${ident(t)} DISABLE TRIGGER USER`);
      const n = await tx.$executeRawUnsafe(`INSERT INTO ${ident(t)} SELECT * FROM json_populate_recordset(NULL::${ident(t)}, $1::json)`, json);
      await tx.$executeRawUnsafe(`ALTER TABLE ${ident(t)} ENABLE TRIGGER USER`);
      restored[t] = n;
    }
    // تحديث العدّادات التلقائية (مثل سجل التدقيق) بعد إدخال المعرّفات القديمة
    const seqs = await tx.$queryRawUnsafe<{ t: string; c: string }[]>(
      `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`,
    );
    for (const s of seqs) {
      if (!order.includes(s.t)) continue;
      await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('${ident(s.t)}', '${s.c.replace(/[^a-z0-9_]/g, "")}'), GREATEST(coalesce((SELECT max("${s.c.replace(/[^a-z0-9_]/g, "")}") FROM ${ident(s.t)}), 0), 1))`);
    }
  }, { timeout: 10 * 60_000, maxWait: 60_000 });
  let files = 0;
  if (opts.restoreFiles !== false && sections.some((x) => x.kind === "FILE")) {
    const { objectExists, putObject } = await import("@/lib/storage");
    for (const s of sections.filter((x) => x.kind === "FILE")) {
      if (await objectExists(s.name).catch(() => false)) continue;
      await putObject(s.name, s.data);
      files++;
    }
  }
  return { info, restored, files };
}
