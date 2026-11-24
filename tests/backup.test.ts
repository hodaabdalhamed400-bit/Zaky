import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { prisma, makeActor } from "./helpers";
import { TEST_DATABASE_URL } from "./test-db";
import { createBackup, decrypt, encrypt, parsePayload, restoreBackup } from "@/lib/backup";
import { downloadBackup, runWeeklyBackup } from "@/services/backup.service";
import type { MailMessage } from "@/lib/mail";

const PASS = "Backup-Pass-2026!";

describe("النسخ الاحتياطي", () => {
  it("التشفير: كلمة سر خاطئة أو قصيرة تُرفض", () => {
    const f = encrypt(Buffer.from("##ZAKI {}\n"), PASS);
    expect(decrypt(f, PASS).toString()).toBe("##ZAKI {}\n");
    expect(() => decrypt(f, "wrong-password-123")).toThrow(/كلمة السر/);
    expect(() => encrypt(Buffer.from("x"), "short")).toThrow();
    expect(() => decrypt(Buffer.from("not a backup at all, just text............................"), PASS)).toThrow(/ليس نسخة/);
  });

  it("التنزيل لمسؤول النظام فقط", async () => {
    const { actor } = await makeActor("GENERAL_MANAGER");
    await expect(downloadBackup(prisma, actor, PASS, false)).rejects.toThrow();
    const { actor: admin } = await makeActor("SUPER_ADMIN");
    const { file, info } = await downloadBackup(prisma, admin, PASS, false);
    expect(file.length).toBeGreaterThan(100);
    expect(info.tables.users).toBeGreaterThan(0);
    expect(info.tables).not.toHaveProperty("sessions");
    expect(await prisma.auditLog.count({ where: { action: "system.backup_download", userId: admin.id } })).toBe(1);
  });

  it("الاسترجاع الكامل إلى قاعدة جديدة يطابق الأصل", async () => {
    const { file, info } = await createBackup(prisma, PASS);
    const url = new URL(TEST_DATABASE_URL);
    const name = `zaki_restore_test_${Date.now() % 100000}`;
    await prisma.$executeRawUnsafe(`CREATE DATABASE ${name}`);
    url.pathname = `/${name}`;
    const restoreUrl = url.toString();
    try {
      execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: restoreUrl }, stdio: "pipe" });
      const target = new PrismaClient({ datasources: { db: { url: restoreUrl } } });
      try {
        const r = await restoreBackup(target, file, PASS, { restoreFiles: false });
        for (const [t, n] of Object.entries(info.tables)) {
          const [row] = await target.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}"`);
          expect([t, row!.n]).toEqual([t, n]);
        }
        expect(Object.keys(r.restored).length).toBeGreaterThan(5);
        // المبالغ المالية مطابقة بالهللة
        const sumSrc = await prisma.$queryRawUnsafe<{ s: string }[]>(`SELECT coalesce(sum(amount),0)::text AS s FROM payments`);
        const sumDst = await target.$queryRawUnsafe<{ s: string }[]>(`SELECT coalesce(sum(amount),0)::text AS s FROM payments`);
        expect(sumDst[0]!.s).toBe(sumSrc[0]!.s);
        // الحمايات رجعت تعمل: سجل التدقيق لا يُعدّل
        await expect(target.$executeRawUnsafe(`UPDATE audit_logs SET action = 'x'`)).rejects.toThrow();
        // قاعدة فيها بيانات: يرفض الاسترجاع فوقها
        await expect(restoreBackup(target, file, PASS)).rejects.toThrow(/ليست فارغة/);
      } finally {
        await target.$disconnect();
      }
    } finally {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  }, 120_000);

  it("النسخة الأسبوعية: مرة كل 7 أيام، مرفقة ومشفرة", async () => {
    await prisma.systemSetting.deleteMany({ where: { key: "backup.weekly_last_sent" } });
    const sent: MailMessage[] = [];
    const fake = async (m: MailMessage) => {
      sent.push(m);
      return true;
    };
    const r1 = await runWeeklyBackup(prisma, "2026-12-06", fake);
    expect(r1).toMatchObject({ sent: 1 });
    const att = sent[0]!.attachments![0]!;
    expect(att.filename).toMatch(/\.zakibak$/);
    expect(parsePayload(decrypt(att.content, "test-passphrase-only")).info.tables.users).toBeGreaterThan(0);
    expect(await runWeeklyBackup(prisma, "2026-12-09", fake)).toMatchObject({ skipped: "not-due" });
    expect(await runWeeklyBackup(prisma, "2026-12-13", fake)).toMatchObject({ sent: 1 });
    expect(sent).toHaveLength(2);
  });
});
