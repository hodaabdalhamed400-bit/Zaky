/**
 * إعادة تعيين كلمة مرور مستخدم من سطر الأوامر (للطوارئ، مثل نسيان كلمة مرور مسؤول النظام الوحيد).
 * الاستخدام:
 *   ZAKI_NEW_PASSWORD='كلمة-مؤقتة' npm run admin:reset-password -- --email user@example.com
 * - كلمة المرور تُكتب ظاهرة عمدًا حتى يُتأكد من لغة لوحة المفاتيح، وهي مؤقتة: يُطلب تغييرها عند الدخول.
 * - تُنهى جلسات المستخدم، وتُمسح محاولات الدخول الفاشلة الأخيرة لبريده، ويُسجَّل الإجراء في سجل التدقيق.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword, validatePasswordPolicy } from "../src/lib/auth/password";
import { writeAudit } from "../src/lib/audit";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const password = process.env.ZAKI_NEW_PASSWORD ?? "";
  if (!email) throw new Error("الاستخدام: ZAKI_NEW_PASSWORD='...' npm run admin:reset-password -- --email user@example.com");
  if (!password) throw new Error("ضع كلمة المرور المؤقتة في ZAKI_NEW_PASSWORD");
  if (/[^\x20-\x7E]/.test(password)) throw new Error("كلمة المرور تحتوي حروفًا غير إنجليزية — تأكد من لغة لوحة المفاتيح");
  const policy = validatePasswordPolicy(password, { email });
  if (policy) throw new Error(policy);

  const db = new PrismaClient();
  try {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      const all = await db.user.findMany({ select: { email: true }, take: 20 });
      throw new Error(`لا يوجد مستخدم بالبريد ${email}. المستخدمون الحاليون: ${all.map((u) => u.email).join("، ") || "لا يوجد"}`);
    }
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, isActive: true },
      });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.loginAttempt.deleteMany({ where: { email, success: false } });
      await writeAudit(tx, { actorId: null, action: "user.password_reset", entityType: "user", entityId: user.id, after: { via: "cli" } });
    });
    console.log(`✔ تم تعيين كلمة مرور مؤقتة لـ ${email}. ادخل بها وسيُطلب تغييرها.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
