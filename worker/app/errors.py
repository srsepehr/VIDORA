"""Worker error taxonomy.

Every failure the pipeline can raise is a WorkerError carrying a stable code, a
Persian user-facing message, a retryability flag, and the stage it belongs to.
Raw provider/exception text is kept in ``dev_detail`` for logs only and never
reaches the user. Codes mirror the frontend's stable identifiers where they
overlap so the two layers speak the same language.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional

# Pipeline stages (must match the public.video_status values the worker uses).
STAGE_ACQUIRING = "acquiring_source"
STAGE_VALIDATING = "validating"
STAGE_EXTRACTING = "extracting_audio"
STAGE_TRANSCRIBING = "transcribing"
STAGE_TRANSLATING = "translating"


@dataclass
class ErrorSpec:
    code: str
    message_fa: str
    retryable: bool
    stage: str


# Central registry: code -> spec. Persian messages are subtitle-plain and never
# expose provider internals.
_SPECS: dict[str, ErrorSpec] = {}


def _reg(code: str, message_fa: str, retryable: bool, stage: str) -> str:
    _SPECS[code] = ErrorSpec(code=code, message_fa=message_fa, retryable=retryable, stage=stage)
    return code


# --- configuration / infrastructure ---------------------------------------
WORKER_CONFIGURATION_MISSING = _reg(
    "WORKER_CONFIGURATION_MISSING", "پیکربندی پردازشگر ناقص است.", False, STAGE_ACQUIRING)
WORKER_LEASE_FAILED = _reg(
    "WORKER_LEASE_FAILED", "امکان رزرو کار پردازش وجود نداشت.", True, STAGE_ACQUIRING)
WORKER_HEARTBEAT_FAILED = _reg(
    "WORKER_HEARTBEAT_FAILED", "ارتباط پردازشگر با سرور قطع شد.", True, STAGE_ACQUIRING)

# --- source acquisition ----------------------------------------------------
SOURCE_OBJECT_MISSING = _reg(
    "SOURCE_OBJECT_MISSING", "فایل ویدیو یافت نشد. دوباره تلاش کنید.", False, STAGE_ACQUIRING)
SOURCE_DOWNLOAD_FAILED = _reg(
    "SOURCE_DOWNLOAD_FAILED", "دریافت ویدیو از منبع ناموفق بود.", True, STAGE_ACQUIRING)
SOURCE_PRIVATE = _reg(
    "SOURCE_PRIVATE", "ویدیوی منبع خصوصی است یا برای دسترسی نیاز به ورود دارد.", False, STAGE_ACQUIRING)
SOURCE_AUTH_REQUIRED = _reg(
    "SOURCE_AUTH_REQUIRED", "برای دریافت این ویدیو ورود به حساب لازم است.", False, STAGE_ACQUIRING)
SOURCE_TOO_LARGE = _reg(
    "SOURCE_TOO_LARGE", "حجم ویدیوی منبع بیش از حد مجاز است.", False, STAGE_ACQUIRING)
SSRF_BLOCKED = _reg(
    "SSRF_BLOCKED", "این آدرس به دلایل امنیتی قابل پردازش نیست.", False, STAGE_ACQUIRING)
SOURCE_UNSUPPORTED = _reg(
    "SOURCE_UNSUPPORTED", "دریافت خودکار ویدیو از این منبع هنوز پشتیبانی نمی‌شود.", False, STAGE_ACQUIRING)

# --- media validation ------------------------------------------------------
MEDIA_CORRUPT = _reg(
    "MEDIA_CORRUPT", "فایل ویدیو خراب است یا قابل خواندن نیست.", False, STAGE_VALIDATING)
MEDIA_NO_AUDIO = _reg(
    "MEDIA_NO_AUDIO", "این ویدیو صدای قابل پردازشی ندارد.", False, STAGE_VALIDATING)
MEDIA_FORMAT_UNSUPPORTED = _reg(
    "MEDIA_FORMAT_UNSUPPORTED", "فرمت این ویدیو پشتیبانی نمی‌شود.", False, STAGE_VALIDATING)
VIDEO_TOO_LONG = _reg(
    "VIDEO_TOO_LONG", "مدت این ویدیو بیش از حد مجاز برای پردازش است.", False, STAGE_VALIDATING)
FFPROBE_FAILED = _reg(
    "FFPROBE_FAILED", "بررسی مشخصات ویدیو ناموفق بود.", True, STAGE_VALIDATING)

# --- audio extraction ------------------------------------------------------
AUDIO_EXTRACTION_FAILED = _reg(
    "AUDIO_EXTRACTION_FAILED", "آماده‌سازی صدای ویدیو ناموفق بود.", True, STAGE_EXTRACTING)

# --- speech to text --------------------------------------------------------
STT_CONFIGURATION_MISSING = _reg(
    "STT_CONFIGURATION_MISSING", "سرویس تبدیل گفتار پیکربندی نشده است.", False, STAGE_TRANSCRIBING)
STT_MODEL_LOAD_FAILED = _reg(
    "STT_MODEL_LOAD_FAILED", "بارگذاری مدل تشخیص گفتار ناموفق بود.", True, STAGE_TRANSCRIBING)
STT_PROVIDER_UNAVAILABLE = _reg(
    "STT_PROVIDER_UNAVAILABLE", "سرویس تشخیص گفتار در دسترس نیست.", True, STAGE_TRANSCRIBING)
STT_RATE_LIMITED = _reg(
    "STT_RATE_LIMITED", "محدودیت نرخ سرویس تشخیص گفتار. کمی بعد دوباره تلاش می‌شود.", True, STAGE_TRANSCRIBING)
STT_FAILED = _reg(
    "STT_FAILED", "تشخیص گفتار این ویدیو ناموفق بود.", True, STAGE_TRANSCRIBING)
TRANSCRIPT_EMPTY = _reg(
    "TRANSCRIPT_EMPTY", "در این ویدیو گفتاری برای پردازش یافت نشد.", False, STAGE_TRANSCRIBING)

# --- translation -----------------------------------------------------------
TRANSLATION_CONFIGURATION_MISSING = _reg(
    "TRANSLATION_CONFIGURATION_MISSING", "سرویس ترجمه پیکربندی نشده است.", False, STAGE_TRANSLATING)
TRANSLATION_MODEL_UNAVAILABLE = _reg(
    "TRANSLATION_MODEL_UNAVAILABLE", "مدل ترجمه در دسترس نیست.", True, STAGE_TRANSLATING)
TRANSLATION_PROVIDER_UNAVAILABLE = _reg(
    "TRANSLATION_PROVIDER_UNAVAILABLE", "سرویس ترجمه در دسترس نیست.", True, STAGE_TRANSLATING)
TRANSLATION_RATE_LIMITED = _reg(
    "TRANSLATION_RATE_LIMITED", "محدودیت نرخ سرویس ترجمه. کمی بعد دوباره تلاش می‌شود.", True, STAGE_TRANSLATING)
TRANSLATION_INVALID_RESPONSE = _reg(
    "TRANSLATION_INVALID_RESPONSE", "پاسخ نامعتبر از سرویس ترجمه دریافت شد.", True, STAGE_TRANSLATING)
TRANSLATION_INCOMPLETE = _reg(
    "TRANSLATION_INCOMPLETE", "ترجمه همه بخش‌ها کامل نشد.", True, STAGE_TRANSLATING)

# --- lifecycle -------------------------------------------------------------
JOB_TIMEOUT = _reg("JOB_TIMEOUT", "زمان پردازش این ویدیو به پایان رسید.", True, STAGE_ACQUIRING)
JOB_CANCELLED = _reg("JOB_CANCELLED", "پردازش این ویدیو لغو شد.", False, STAGE_ACQUIRING)
INTERNAL_PROCESSING_ERROR = _reg(
    "INTERNAL_PROCESSING_ERROR", "خطای ناشناخته‌ای در پردازش رخ داد.", True, STAGE_ACQUIRING)


class WorkerError(Exception):
    """A classified, user-safe processing failure."""

    def __init__(self, code: str, dev_detail: str = "", *, retryable: Optional[bool] = None,
                 stage: Optional[str] = None, correlation_id: Optional[str] = None):
        spec = _SPECS.get(code) or _SPECS[INTERNAL_PROCESSING_ERROR]
        self.code = spec.code
        self.message_fa = spec.message_fa
        self.retryable = spec.retryable if retryable is None else retryable
        self.stage = stage or spec.stage
        self.dev_detail = dev_detail
        self.correlation_id = correlation_id or uuid.uuid4().hex
        super().__init__(f"{self.code}: {dev_detail}")

    def to_log(self) -> dict:
        return {
            "code": self.code,
            "retryable": self.retryable,
            "stage": self.stage,
            "correlation_id": self.correlation_id,
            "dev_detail": self.dev_detail[:500],
        }


def spec_for(code: str) -> ErrorSpec:
    return _SPECS[code]


def all_codes() -> list[str]:
    return sorted(_SPECS.keys())
