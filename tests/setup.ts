import { TEST_DATABASE_URL } from "./test-db";
process.env.DATABASE_URL = TEST_DATABASE_URL;
(process.env as Record<string, string>).NODE_ENV = "test";
