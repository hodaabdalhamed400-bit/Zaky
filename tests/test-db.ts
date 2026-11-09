// قاعدة اختبار منفصلة تمامًا — لا تُشغَّل الاختبارات على قاعدة التطوير أو الإنتاج.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://zaki:zaki_dev_only@localhost:5432/zaki_test?schema=public";

if (!/zaki_test|_test\b|test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error("TEST_DATABASE_URL يجب أن يشير إلى قاعدة اختبار (اسمها يحتوي test)");
}
