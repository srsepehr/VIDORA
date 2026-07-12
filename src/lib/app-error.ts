export type AppErrorCode =
  | "CONFIG_MISSING"
  | "CONFIG_INVALID"
  | "INVALID_EMAIL"
  | "INVALID_PASSWORD"
  | "PASSWORD_MISMATCH"
  | "TERMS_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_NOT_FOUND"
  | "DUPLICATE_ACCOUNT"
  | "SIGNUP_DISABLED"
  | "EMAIL_CONFIRMATION_REQUIRED"
  | "WEAK_PASSWORD"
  | "PROFILE_SYNC_FAILURE"
  | "RATE_LIMIT"
  | "SESSION_EXPIRED"
  | "UNAUTHORIZED"
  | "MISSING_SUBSCRIPTION"
  | "INVALID_VIDEO_FORMAT"
  | "FILE_TOO_LARGE"
  | "VIDEO_TOO_LONG"
  | "INVALID_SOURCE_URL"
  | "PRIVATE_SOURCE_URL"
  | "STORAGE_FAILURE"
  | "DATABASE_FAILURE"
  | "UPLOAD_INTERRUPTED"
  | "AUTH_REQUIRED"
  | "ACCESS_DENIED"
  | "STORAGE_CONFIGURATION_MISSING"
  | "STORAGE_UPLOAD_FAILED"
  | "STORAGE_OBJECT_MISSING"
  | "FILE_EMPTY"
  | "FILE_TYPE_UNSUPPORTED"
  | "VIDEO_CREATE_FAILED"
  | "JOB_CREATE_FAILED"
  | "JOB_ALREADY_EXISTS"
  | "INVALID_URL"
  | "UNSUPPORTED_SOURCE"
  | "SOURCE_PRIVATE"
  | "SOURCE_AUTH_REQUIRED"
  | "UNSAFE_URL"
  | "UPLOAD_CANCELLED"
  | "VIDEO_NOT_FOUND"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "DATABASE_ERROR"
  | "UNKNOWN_ERROR"
  | "PROCESSING_PROVIDER_UNAVAILABLE"
  | "TRANSCRIPTION_FAILURE"
  | "TRANSLATION_FAILURE"
  | "SUBTITLE_GENERATION_FAILURE"
  | "RENDER_FAILURE"
  | "NETWORK_TIMEOUT"
  | "NETWORK_FAILURE"
  | "CHAT_AUTH_REQUIRED"
  | "CHAT_ACCESS_DENIED"
  | "CHAT_VIDEO_NOT_FOUND"
  | "CHAT_QUESTION_EMPTY"
  | "CHAT_QUESTION_TOO_LONG"
  | "CHAT_RATE_LIMITED"
  | "CHAT_TRANSCRIPT_MISSING"
  | "CHAT_TRANSLATION_INCOMPLETE"
  | "CHAT_INDEX_MISSING"
  | "CHAT_STALE_INDEX"
  | "CHAT_PROVIDER_UNAVAILABLE"
  | "CHAT_INVALID_OUTPUT"
  | "CHAT_GROUNDING_FAILED"
  | "CHAT_REQUEST_CONFLICT"
  | "UNKNOWN_SERVER_ERROR";

export interface AppErrorInit {
  code: AppErrorCode;
  httpStatus: number;
  messageFa: string;
  retryable?: boolean;
  requestId?: string;
  logMessage?: string;
  cause?: unknown;
}

export class AppError extends Error {
  code: AppErrorCode;
  httpStatus: number;
  messageFa: string;
  retryable: boolean;
  requestId: string;
  cause?: unknown;

  constructor(init: AppErrorInit) {
    super(init.logMessage || init.messageFa);
    this.name = "AppError";
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.messageFa = init.messageFa;
    this.retryable = init.retryable ?? false;
    this.requestId = init.requestId || createRequestId();
    this.cause = init.cause;
  }
}

export function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof TypeError) {
    return new AppError({
      code: "NETWORK_FAILURE",
      httpStatus: 0,
      messageFa: "ارتباط با سرور برقرار نشد. اتصال اینترنت، VPN یا تنظیمات شبکه را بررسی کرده و دوباره تلاش کنید.",
      retryable: true,
      logMessage: error.message,
      cause: error,
    });
  }
  return new AppError({
      code: "UNKNOWN_SERVER_ERROR",
      httpStatus: 500,
      messageFa: "در انجام عملیات خطایی رخ داد. دوباره تلاش کنید.",
    retryable: true,
    logMessage: error instanceof Error ? error.message : "Unknown error",
    cause: error,
  });
}

export function logAppError(error: AppError, context: string): void {
  const diagnostic = {
    operation: context,
    errorName: error.name,
    errorCode: error.code,
    status: error.httpStatus,
    message: error.message,
    correlationId: error.requestId,
  };
  try {
    if (typeof window !== "undefined") window.sessionStorage.setItem("vidora.lastSafeError", JSON.stringify(diagnostic));
  } catch {
    // ignore diagnostic storage failures
  }
  console.error("[Vidora]", context, diagnostic);
}

export function getLastSafeError(): { operation: string; errorName: string; errorCode: AppErrorCode; status: number; message: string; correlationId: string } | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem("vidora.lastSafeError");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function mapSupabaseAuthError(status: number, payload: unknown): AppError {
  const record = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  const message = String(record.message || record.msg || record.error_description || record.error || "").toLowerCase();
  const errorCode = String(record.error_code || record.code || record.error || "").toLowerCase();
  const raw = `${message} ${errorCode} ${JSON.stringify(payload).toLowerCase()}`;

  if (status === 400 && (raw.includes("invalid login") || raw.includes("invalid_grant"))) {
    return new AppError({
      code: "INVALID_CREDENTIALS",
      httpStatus: 401,
      messageFa: "ایمیل یا رمز عبور صحیح نیست.",
      retryable: false,
      logMessage: "Supabase auth rejected credentials",
    });
  }
  if (status === 400 && raw.includes("already")) {
    return new AppError({
      code: "DUPLICATE_ACCOUNT",
      httpStatus: 409,
      messageFa: "قبلاً با این ایمیل حساب ساخته شده است. وارد حساب خود شوید.",
      retryable: false,
      logMessage: "Duplicate Supabase account",
    });
  }
  if (raw.includes("signup_disabled") || raw.includes("signup is disabled") || raw.includes("signups not allowed")) {
    return new AppError({
      code: "SIGNUP_DISABLED",
      httpStatus: status || 403,
      messageFa: "ساخت حساب جدید در حال حاضر غیرفعال است.",
      retryable: false,
      logMessage: "Supabase signup disabled",
    });
  }
  if (raw.includes("email_not_confirmed") || raw.includes("email not confirmed") || raw.includes("confirm")) {
    return new AppError({
      code: "EMAIL_CONFIRMATION_REQUIRED",
      httpStatus: status || 403,
      messageFa: "برای ورود، ابتدا ایمیل خود را تأیید کنید.",
      retryable: false,
      logMessage: "Supabase email confirmation required",
    });
  }
  if (raw.includes("weak_password") || raw.includes("password") && (raw.includes("weak") || raw.includes("short") || raw.includes("least"))) {
    return new AppError({
      code: "WEAK_PASSWORD",
      httpStatus: status || 400,
      messageFa: "رمز عبور شرایط لازم را ندارد. از یک رمز قوی‌تر استفاده کنید.",
      retryable: false,
      logMessage: "Supabase weak password",
    });
  }
  if (status === 429) {
    return new AppError({
      code: "RATE_LIMIT",
      httpStatus: 429,
      messageFa: "تعداد تلاش‌های ورود بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
      retryable: true,
      logMessage: "Supabase auth rate limit",
    });
  }
  if (status === 401 || status === 403) {
    return new AppError({
      code: "SESSION_EXPIRED",
      httpStatus: status,
      messageFa: "نشست شما منقضی شده است. لطفاً دوباره وارد شوید.",
      retryable: false,
      logMessage: "Supabase session rejected",
    });
  }
  return new AppError({
    code: "UNKNOWN_SERVER_ERROR",
    httpStatus: status || 500,
    messageFa: "در انجام عملیات خطایی رخ داد. دوباره تلاش کنید.",
    retryable: true,
    logMessage: `Supabase auth error ${status}`,
  });
}

export function validateEmail(email: string): AppError | null {
  const value = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return new AppError({
      code: "INVALID_EMAIL",
      httpStatus: 400,
      messageFa: "فرمت ایمیل واردشده صحیح نیست.",
      retryable: false,
      logMessage: "Invalid email format",
    });
  }
  return null;
}

export function validatePassword(password: string): AppError | null {
  if (password.length < 8) {
    return new AppError({
      code: "INVALID_PASSWORD",
      httpStatus: 400,
      messageFa: "رمز عبور شرایط لازم را ندارد. از یک رمز قوی‌تر استفاده کنید.",
      retryable: false,
      logMessage: "Password shorter than policy",
    });
  }
  return null;
}
