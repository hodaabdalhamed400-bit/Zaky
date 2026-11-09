/** مهمة الصيانة اليومية من سطر الأوامر (Render Cron Job): npm run job:daily */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runContractMaintenance } from "../src/services/contracts.service";

const db = new PrismaClient();
runContractMaintenance(db)
  .then((r) => console.log(JSON.stringify({ at: new Date().toISOString(), ...r })))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
