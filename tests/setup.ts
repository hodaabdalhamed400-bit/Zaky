import { TEST_DATABASE_URL } from "./test-db";
process.env.DATABASE_URL = TEST_DATABASE_URL;
(process.env as Record<string, string>).NODE_ENV = "test";
import { tmpdir } from "node:os";
import { join } from "node:path";
// تخزين مستندات معزول للاختبارات
process.env.STORAGE_DIR = join(tmpdir(), `zaki-test-storage-${process.pid}`);
