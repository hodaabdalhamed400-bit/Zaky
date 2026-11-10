/** مهمة الصيانة اليومية من سطر الأوامر (Render Cron Job): npm run job:daily */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runDaily } from "../src/services/jobs.service";

const db = new PrismaClient();
runDaily(db)
  .then((r) => console.log(JSON.stringify({ at: new Date().toISOString(), ...r })))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
