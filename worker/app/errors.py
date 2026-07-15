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

# --- subtitles -------------------------------------------------------------
STAGE_SUBTITLES = "generating_subtitles"
SUBTITLE_TRANSCRIPT_MISSING = _reg(
    "SUBTITLE_TRANSCRIPT_MISSING", "متن این ویدیو برای ساخت زیرنویس یافت نشد.", False, STAGE_SUBTITLES)
SUBTITLE_TRANSLATION_INCOMPLETE = _reg(
    "SUBTITLE_TRANSLATION_INCOMPLETE", "ترجمه فارسی همه بخش‌ها کامل نیست؛ زیرنویس ساخته نشد.", False, STAGE_SUBTITLES)
SUBTITLE_TIMESTAMP_INVALID = _reg(
    "SUBTITLE_TIMESTAMP_INVALID", "زمان‌بندی بخش‌های متن برای ساخت زیرنویس نامعتبر است.", False, STAGE_SUBTITLES)
SUBTITLE_NO_CUES = _reg(
    "SUBTITLE_NO_CUES", "هیچ زیرنویس قابل نمایشی ساخته نشد.", False, STAGE_SUBTITLES)
SUBTITLE_VALIDATION_FAILED = _reg(
    "SUBTITLE_VALIDATION_FAILED", "بررسی صحت زیرنویس ناموفق بود.", False, STAGE_SUBTITLES)
SUBTITLE_SERIALIZATION_FAILED = _reg(
    "SUBTITLE_SERIALIZATION_FAILED", "ساخت فایل زیرنویس ناموفق بود.", True, STAGE_SUBTITLES)
SUBTITLE_STORAGE_FAILED = _reg(
    "SUBTITLE_STORAGE_FAILED", "ذخیره فایل زیرنویس ناموفق بود.", True, STAGE_SUBTITLES)
SUBTITLE_PERSIST_FAILED = _reg(
    "SUBTITLE_PERSIST_FAILED", "ثبت اطلاعات زیرنویس ناموفق بود.", True, STAGE_SUBTITLES)
SUBTITLE_DURATION_MISMATCH = _reg(
    "SUBTITLE_DURATION_MISMATCH", "زمان‌بندی زیرنویس با مدت ویدیو هم‌خوانی ندارد.", False, STAGE_SUBTITLES)
SUBTITLE_STALE = _reg(
    "SUBTITLE_STALE", "زیرنویس فعلی با متن به‌روزشده هم‌خوان نیست.", True, STAGE_SUBTITLES)

# --- insights (summary / takeaways / chapters) ------------------------------
# Insight state is tracked independently from video/job status; this stage tag
# is classification metadata only and is never written to public.videos.status.
STAGE_INSIGHTS = "generating_insights"
INSIGHT_TRANSCRIPT_MISSING = _reg(
    "INSIGHT_TRANSCRIPT_MISSING", "متن این ویدیو برای ساخت خلاصه یافت نشد.", False, STAGE_INSIGHTS)
INSIGHT_TRANSLATION_INCOMPLETE = _reg(
    "INSIGHT_TRANSLATION_INCOMPLETE", "ترجمه فارسی همه بخش‌ها کامل نیست؛ خلاصه ساخته نشد.", False, STAGE_INSIGHTS)
INSIGHT_TRANSCRIPT_TOO_LARGE = _reg(
    "INSIGHT_TRANSCRIPT_TOO_LARGE", "متن این ویدیو برای پردازش خلاصه بیش از حد بزرگ است.", False, STAGE_INSIGHTS)
INSIGHT_MODEL_LOAD_FAILED = _reg(
    "INSIGHT_MODEL_LOAD_FAILED", "بارگذاری مدل خلاصه‌سازی ناموفق بود.", True, STAGE_INSIGHTS)
INSIGHT_PROVIDER_UNAVAILABLE = _reg(
    "INSIGHT_PROVIDER_UNAVAILABLE", "سرویس خلاصه‌سازی در دسترس نیست.", True, STAGE_INSIGHTS)
INSIGHT_INVALID_OUTPUT = _reg(
    "INSIGHT_INVALID_OUTPUT", "خروجی خلاصه‌سازی نامعتبر بود.", True, STAGE_INSIGHTS)
INSIGHT_GROUNDING_FAILED = _reg(
    "INSIGHT_GROUNDING_FAILED", "خلاصه ساخته‌شده با متن ویدیو هم‌خوان نبود.", True, STAGE_INSIGHTS)
INSIGHT_CHAPTERS_INVALID = _reg(
    "INSIGHT_CHAPTERS_INVALID", "فصل‌بندی ساخته‌شده نامعتبر بود.", True, STAGE_INSIGHTS)
INSIGHT_PERSIST_FAILED = _reg(
    "INSIGHT_PERSIST_FAILED", "ثبت خلاصه و فصل‌ها ناموفق بود.", True, STAGE_INSIGHTS)
INSIGHT_STALE = _reg(
    "INSIGHT_STALE", "متن ویدیو تغییر کرده و خلاصه باید دوباره ساخته شود.", True, STAGE_INSIGHTS)

# --- grounded video chat ---------------------------------------------------
# Chat state is independent from the video processing lifecycle. This stage is
# used only for safe error classification and is never written to videos.status.
STAGE_VIDEO_CHAT = "video_chat"
CHAT_AUTH_REQUIRED = _reg(
    "CHAT_AUTH_REQUIRED", "برای پرسش از ویدیو ابتدا وارد حساب شوید.", False, STAGE_VIDEO_CHAT)
CHAT_ACCESS_DENIED = _reg(
    "CHAT_ACCESS_DENIED", "شما به این ویدیو دسترسی ندارید.", False, STAGE_VIDEO_CHAT)
CHAT_VIDEO_NOT_FOUND = _reg(
    "CHAT_VIDEO_NOT_FOUND", "ویدیوی موردنظر یافت نشد.", False, STAGE_VIDEO_CHAT)
CHAT_QUESTION_EMPTY = _reg(
    "CHAT_QUESTION_EMPTY", "پرسش نمی‌تواند خالی باشد.", False, STAGE_VIDEO_CHAT)
CHAT_QUESTION_TOO_LONG = _reg(
    "CHAT_QUESTION_TOO_LONG", "متن پرسش بیش از حد طولانی است.", False, STAGE_VIDEO_CHAT)
CHAT_RATE_LIMITED = _reg(
    "CHAT_RATE_LIMITED", "تعداد پرسش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", True, STAGE_VIDEO_CHAT)
CHAT_REQUEST_CONFLICT = _reg(
    "CHAT_REQUEST_CONFLICT", "شناسه این پرسش قبلاً برای درخواست دیگری استفاده شده است.", False, STAGE_VIDEO_CHAT)
CHAT_TRANSCRIPT_MISSING = _reg(
    "CHAT_TRANSCRIPT_MISSING", "متن این ویدیو برای پاسخ‌گویی یافت نشد.", False, STAGE_VIDEO_CHAT)
CHAT_TRANSLATION_INCOMPLETE = _reg(
    "CHAT_TRANSLATION_INCOMPLETE", "ترجمه فارسی این ویدیو هنوز کامل نیست.", False, STAGE_VIDEO_CHAT)
CHAT_INDEX_MISSING = _reg(
    "CHAT_INDEX_MISSING", "نمایه پرسش‌وپاسخ این ویدیو هنوز آماده نیست.", True, STAGE_VIDEO_CHAT)
CHAT_STALE_INDEX = _reg(
    "CHAT_STALE_INDEX", "متن ویدیو تغییر کرده و نمایه باید دوباره ساخته شود.", True, STAGE_VIDEO_CHAT)
CHAT_PROVIDER_UNAVAILABLE = _reg(
    "CHAT_PROVIDER_UNAVAILABLE", "سرویس پاسخ‌گویی در دسترس نیست. دوباره تلاش کنید.", True, STAGE_VIDEO_CHAT)
CHAT_INVALID_OUTPUT = _reg(
    "CHAT_INVALID_OUTPUT", "پاسخ معتبری از مدل دریافت نشد. دوباره تلاش کنید.", True, STAGE_VIDEO_CHAT)
CHAT_GROUNDING_FAILED = _reg(
    "CHAT_GROUNDING_FAILED", "پاسخ ساخته‌شده به بخش معتبری از ویدیو متصل نبود.", True, STAGE_VIDEO_CHAT)

# --- living notes (AI overview / key points / action items) ----------------
# Note state is independent from the video processing lifecycle. This stage is
# used only for safe error classification and is never written to videos.status.
STAGE_VIDEO_NOTE = "video_note"
NOTE_AUTH_REQUIRED = _reg(
    "NOTE_AUTH_REQUIRED", "برای ساخت یادداشت هوشمند ابتدا وارد حساب شوید.", False, STAGE_VIDEO_NOTE)
NOTE_ACCESS_DENIED = _reg(
    "NOTE_ACCESS_DENIED", "شما به یادداشت این ویدیو دسترسی ندارید.", False, STAGE_VIDEO_NOTE)
NOTE_VIDEO_NOT_FOUND = _reg(
    "NOTE_VIDEO_NOT_FOUND", "ویدیوی موردنظر یافت نشد.", False, STAGE_VIDEO_NOTE)
NOTE_INSIGHT_MISSING = _reg(
    "NOTE_INSIGHT_MISSING", "برای ساخت یادداشت هوشمند ابتدا باید خلاصه ویدیو آماده شود.", False, STAGE_VIDEO_NOTE)
NOTE_TRANSCRIPT_MISSING = _reg(
    "NOTE_TRANSCRIPT_MISSING", "متن این ویدیو برای ساخت یادداشت یافت نشد.", False, STAGE_VIDEO_NOTE)
NOTE_NO_SOURCE_MATERIAL = _reg(
    "NOTE_NO_SOURCE_MATERIAL", "هنوز محتوایی برای ساخت یادداشت هوشمند وجود ندارد.", False, STAGE_VIDEO_NOTE)
NOTE_RATE_LIMITED = _reg(
    "NOTE_RATE_LIMITED", "تعداد درخواست ساخت یادداشت بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", True, STAGE_VIDEO_NOTE)
NOTE_PROVIDER_UNAVAILABLE = _reg(
    "NOTE_PROVIDER_UNAVAILABLE", "سرویس ساخت یادداشت در دسترس نیست. دوباره تلاش کنید.", True, STAGE_VIDEO_NOTE)
NOTE_INVALID_OUTPUT = _reg(
    "NOTE_INVALID_OUTPUT", "خروجی یادداشت هوشمند نامعتبر بود.", True, STAGE_VIDEO_NOTE)
NOTE_GROUNDING_FAILED = _reg(
    "NOTE_GROUNDING_FAILED", "یادداشت ساخته‌شده به بخش معتبری از ویدیو متصل نبود.", True, STAGE_VIDEO_NOTE)
NOTE_PERSIST_FAILED = _reg(
    "NOTE_PERSIST_FAILED", "ثبت یادداشت هوشمند ناموفق بود.", True, STAGE_VIDEO_NOTE)

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
