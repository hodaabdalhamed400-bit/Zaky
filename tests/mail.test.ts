import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";

/** خادم SMTP وهمي محلي (بدون تشفير — مسموح فقط مع localhost) لاختبار بروتوكول الإرسال. */
let server: net.Server;
let port = 0;
const received: { lines: string[]; data: string } = { lines: [], data: "" };

beforeAll(async () => {
  server = net.createServer((sock) => {
    let inData = false;
    let buf = "";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            sock.write("250 queued\r\n");
          } else received.data += line + "\n";
          continue;
        }
        received.lines.push(line);
        if (/^EHLO/.test(line)) sock.write("250-fake\r\n250 AUTH LOGIN\r\n");
        else if (line === "AUTH LOGIN") sock.write("334 VXNlcm5hbWU6\r\n");
        else if (received.lines.length && received.lines[received.lines.length - 2] === "AUTH LOGIN") sock.write("334 UGFzc3dvcmQ6\r\n");
        else if (received.lines[received.lines.length - 3] === "AUTH LOGIN") sock.write("235 ok\r\n");
        else if (/^MAIL FROM|^RCPT TO/.test(line)) sock.write("250 ok\r\n");
        else if (line === "DATA") {
          inData = true;
          sock.write("354 go\r\n");
        } else if (line === "QUIT") sock.end("221 bye\r\n");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as net.AddressInfo).port;
  Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_USER: "erp@test.zaki.local", SMTP_PASS: "secret-pass", MAIL_FROM: "erp@test.zaki.local" });
});
afterAll(() => server.close());

describe("إرسال الإيميل عبر SMTP", () => {
  it("يرسل رسالة كاملة بالمصادقة", async () => {
    const { sendMail, brandedEmail } = await import("@/lib/mail");
    const body = brandedEmail({ title: "تجربة", lines: ["هلا"], button: { label: "افتح", url: "https://erp.example/x" } });
    expect(await sendMail({ to: "someone@test.zaki.local", subject: "اختبار", ...body })).toBe(true);
    expect(received.lines).toContain("MAIL FROM:<erp@test.zaki.local>");
    expect(received.lines).toContain("RCPT TO:<someone@test.zaki.local>");
    expect(received.lines).toContain(Buffer.from("secret-pass").toString("base64"));
    expect(received.data).toMatch(/Content-Type: multipart\/alternative/);
    const html = received.data.split("text/html; charset=UTF-8")[1]!.split("\n\n")[1]!.replace(/\n/g, "");
    expect(Buffer.from(html, "base64").toString("utf8")).toContain("https://erp.example/x");
  });

  it("يرفض عنوان مستلم فيه حقن", async () => {
    const { sendMail } = await import("@/lib/mail");
    await expect(sendMail({ to: "a@b.sa>\r\nRCPT TO:<evil@x.sa", subject: "x", html: "x", text: "x" })).rejects.toThrow();
  });
});
