/** أخطاء تطبيقية آمنة للعرض للمستخدم (لا تكشف تفاصيل داخلية). */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class AuthError extends AppError {
  constructor(message = "يجب تسجيل الدخول") {
    super("UNAUTHENTICATED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "ليست لديك صلاحية لتنفيذ هذا الإجراء") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "العنصر غير موجود") {
    super("NOT_FOUND", message, 404);
  }
}

/** يحول أي خطأ إلى رسالة عربية آمنة، ويسجل التفاصيل في الخادم فقط. */
export function toSafeMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  console.error("[unexpected-error]", err);
  return "حدث خطأ غير متوقع. حاول مرة أخرى أو تواصل مع مسؤول النظام.";
}
