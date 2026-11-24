// ملاحظة: بدون "server-only" لأن المهمة اليومية (scripts/daily.ts على Render Cron) تستورد هذا الملف خارج Next.js
import net from "node:net";
import tls from "node:tls";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * إرسال إيميل عبر SMTP من صندوق بريد موجود (بدون مكتبات وبدون اشتراك).
 * - المنفذ 465: TLS من البداية. المنفذ 587: STARTTLS إلزامي.
 * - الاتصال غير المشفر مسموح فقط مع localhost (للاختبار).
 * بدون إعداد SMTP_* تُرجع false ولا ترمي خطأ.
 */
export type MailAttachment = { filename: string; content: Buffer; contentType?: string };
export type MailMessage = { to: string; subject: string; html: string; text: string; attachments?: MailAttachment[] };

export function mailConfigured(): boolean {
  const e = env();
  return !!(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS && e.MAIL_FROM);
}

/** رابط النظام لاستخدامه داخل الإيميلات. */
export function appUrl(path = "/"): string {
  const base = (env().APP_URL ?? "https://erp.smartcompany.sa").replace(/\/+$/, "");
  return base + path;
}

const ADDRESS = /^[^\s<>"\r\n@]+@[^\s<>"\r\n@]+\.[^\s<>"\r\n@]+$/;

function encodeHeader(v: string) {
  return `=?UTF-8?B?${Buffer.from(v.replace(/[\r\n]+/g, " "), "utf8").toString("base64")}?=`;
}
function b64Lines(v: string) {
  return Buffer.from(v, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
}

export function buildMime(from: string, m: MailMessage, now = new Date()): string {
  const boundary = "zaki_" + randomBytes(12).toString("hex");
  const domain = from.split("@")[1] ?? "localhost";
  const alt = [
    "Content-Type: multipart/alternative; boundary=\"" + boundary + "\"",
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(m.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(m.html),
    `--${boundary}--`,
  ];
  if (m.attachments?.length) {
    // مرفقات: multipart/mixed يحتوي النص ثم الملفات
    const mixed = "zakimix_" + randomBytes(12).toString("hex");
    const safeName = (n: string) => n.replace(/[^\w.\-]+/g, "_").slice(0, 100) || "file";
    return [
      `From: ${encodeHeader("ZAKI Smart ERP")} <${from}>`,
      `To: <${m.to}>`,
      `Subject: ${encodeHeader(m.subject)}`,
      `Date: ${now.toUTCString()}`,
      `Message-ID: <${randomBytes(16).toString("hex")}@${domain}>`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      "",
      `--${mixed}`,
      ...alt,
      ...m.attachments.flatMap((a) => [
        `--${mixed}`,
        `Content-Type: ${a.contentType ?? "application/octet-stream"}; name="${safeName(a.filename)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${safeName(a.filename)}"`,
        "",
        a.content.toString("base64").replace(/.{1,76}/g, "$&\r\n"),
      ]),
      `--${mixed}--`,
      "",
    ].join("\r\n");
  }
  return [
    `From: ${encodeHeader("ZAKI Smart ERP")} <${from}>`,
    `To: <${m.to}>`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(m.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(m.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** قارئ ردود SMTP (يدعم الردود متعددة الأسطر 250-... / 250 ...). */
function replyReader(sock: net.Socket) {
  let buf = "";
  let lines: string[] = [];
  const waiters: ((r: { code: number; text: string }) => void)[] = [];
  const ready: { code: number; text: string }[] = [];
  const onData = (d: Buffer) => {
    buf += d.toString("utf8");
    let i: number;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const r = { code: Number(line.slice(0, 3)), text: lines.join("\n") };
        lines = [];
        const w = waiters.shift();
        if (w) w(r);
        else ready.push(r);
      }
    }
  };
  sock.on("data", onData);
  return {
    next: () =>
      new Promise<{ code: number; text: string }>((resolve) => {
        const r = ready.shift();
        if (r) resolve(r);
        else waiters.push(resolve);
      }),
    detach: () => sock.off("data", onData),
  };
}

export async function sendMail(m: MailMessage): Promise<boolean> {
  if (!mailConfigured()) return false;
  if (!ADDRESS.test(m.to)) throw new Error("عنوان المستلم غير صالح");
  const e = env();
  const host = e.SMTP_HOST!;
  const port = e.SMTP_PORT;
  const from = e.MAIL_FROM!;
  const local = host === "localhost" || host === "127.0.0.1";
  if (!ADDRESS.test(from)) throw new Error("MAIL_FROM غير صالح");

  let sock: net.Socket =
    port === 465
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
  sock.setTimeout(20_000, () => sock.destroy(new Error("SMTP timeout")));
  const failed = new Promise<never>((_, reject) => sock.once("error", reject));
  failed.catch(() => {});

  let reader = replyReader(sock);
  const expect = async (codes: number[], step: string) => {
    const r = await Promise.race([reader.next(), failed]);
    if (!codes.includes(r.code)) throw new Error(`SMTP ${step}: ${r.text.slice(0, 200)}`);
    return r;
  };
  const cmd = async (line: string, codes: number[], step: string) => {
    sock.write(line + "\r\n");
    return expect(codes, step);
  };

  try {
    await expect([220], "greeting");
    let ehlo = await cmd("EHLO zaki-erp", [250], "EHLO");
    if (port !== 465) {
      if (/STARTTLS/i.test(ehlo.text)) {
        await cmd("STARTTLS", [220], "STARTTLS");
        reader.detach();
        sock = tls.connect({ socket: sock, servername: host });
        sock.once("error", () => {});
        await new Promise<void>((res, rej) => {
          sock.once("secureConnect", () => res());
          sock.once("error", rej);
        });
        reader = replyReader(sock);
        ehlo = await cmd("EHLO zaki-erp", [250], "EHLO");
      } else if (!local) {
        throw new Error("خادم البريد لا يدعم التشفير (STARTTLS)");
      }
    }
    await cmd("AUTH LOGIN", [334], "AUTH");
    await cmd(Buffer.from(e.SMTP_USER!).toString("base64"), [334], "AUTH user");
    await cmd(Buffer.from(e.SMTP_PASS!).toString("base64"), [235], "AUTH pass");
    await cmd(`MAIL FROM:<${from}>`, [250], "MAIL FROM");
    await cmd(`RCPT TO:<${m.to}>`, [250, 251], "RCPT TO");
    await cmd("DATA", [354], "DATA");
    // base64 لا يبدأ سطره بنقطة؛ والرؤوس مُرمّزة — لا حاجة لـ dot-stuffing إضافي
    await cmd(buildMime(from, m) + "\r\n.", [250], "send");
    sock.write("QUIT\r\n");
    return true;
  } finally {
    sock.end();
    setTimeout(() => sock.destroy(), 1000).unref();
  }
}

/** قالب إيميل موحد بهوية ذكي (عربي RTL). */
export function brandedEmail(opts: { title: string; lines: string[]; button?: { label: string; url: string }; footer?: string }) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const html = `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#f4f6f9;font-family:Tahoma,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#132E4B;padding:20px 28px;color:#fff;font-size:18px;font-weight:bold">ZAKI Smart ERP</td></tr>
<tr><td style="padding:28px;color:#111827;font-size:15px;line-height:1.8;text-align:right">
<h1 style="margin:0 0 12px;font-size:20px;color:#132E4B">${esc(opts.title)}</h1>
${opts.lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join("")}
${opts.button ? `<p style="margin:22px 0"><a href="${esc(opts.button.url)}" style="display:inline-block;background:#1EADC0;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:bold">${esc(opts.button.label)}</a></p>` : ""}
${opts.footer ? `<p style="margin:18px 0 0;font-size:12px;color:#6b7280">${esc(opts.footer)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
  const text = [opts.title, "", ...opts.lines, ...(opts.button ? ["", `${opts.button.label}: ${opts.button.url}`] : []), ...(opts.footer ? ["", opts.footer] : [])].join("\n");
  return { html, text };
}
