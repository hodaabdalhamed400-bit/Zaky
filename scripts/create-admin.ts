/**
 * إنشاء مسؤول النظام الأول (أو إضافي) من سطر الأوامر — لا يوجد حساب افتراضي في الكود.
 *
 * الاستخدام:
 *   npm run admin:create -- --email admin@example.com --name "اسم المسؤول"
 * كلمة المرور تُقرأ من المتغير ZAKI_ADMIN_PASSWORD إن وُجد، وإلا تُطلب بشكل تفاعلي (مخفية).
 * يُطلب من المسؤول تغييرها عند أول دخول.
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { PrismaClient } from "@prisma/client";
import { hashPassword, validatePasswordPolicy } from "../src/lib/auth/password";
import { writeAudit } from "../src/lib/audit";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function promptHidden(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => out.output.write(s.includes(q) ? s : "*");
    rl.question(q, (a) => {
      rl.close();
      process.stdout.write("\n");
      resolve(a);
    });
  });
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  if (!email || !name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('الاستخدام: npm run admin:create -- --email you@company.sa --name "الاسم"');
    process.exit(2);
  }
  let password = process.env.ZAKI_ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden("كلمة المرور: ");
    const confirm = await promptHidden("تأكيد كلمة المرور: ");
    if (password !== confirm) throw new Error("كلمتا المرور غير متطابقتين");
  }
  const policy = validatePasswordPolicy(password, { email, name });
  if (policy) throw new Error(policy);

  const db = new PrismaClient();
  try {
    const role = await db.role.findUnique({ where: { key: "SUPER_ADMIN" } });
    if (!role) throw new Error("الأدوار غير موجودة. شغّل أولًا: npm run db:seed");
    if (await db.user.findUnique({ where: { email } })) throw new Error("يوجد مستخدم بهذا البريد بالفعل");
    const user = await db.user.create({
      data: { email, name, roleId: role.id, passwordHash: await hashPassword(password), mustChangePassword: true },
    });
    await writeAudit(db, {
      actorId: user.id,
      action: "system.bootstrap_admin",
      entityType: "user",
      entityId: user.id,
      after: { email, name, role: "SUPER_ADMIN", via: "cli" },
    });
    console.log(`✔ تم إنشاء مسؤول النظام: ${email} (سيُطلب تغيير كلمة المرور عند أول دخول)`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
