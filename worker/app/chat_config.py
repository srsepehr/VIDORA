"""Versioned, non-secret configuration for private per-video chat."""

from __future__ import annotations

import os
from dataclasses import dataclass

CHUNKER_VERSION = "chat-chunk-v1"
EMBEDDING_PROVIDER = "local_transformers"
EMBEDDING_MODEL = "intfloat/multilingual-e5-small"
EMBEDDING_VERSION = "e5-v1"
EMBEDDING_DIMENSIONS = 384
CHAT_PROVIDER = "local_transformers"
CHAT_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
CHAT_PROMPT_VERSION = "chat-p1"
CHAT_SCHEMA_VERSION = "chat-s1"
NOT_IN_VIDEO_FA = "در متن این ویدیو اطلاعات کافی برای پاسخ به این سؤال وجود ندارد."


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class ChatConfig:
    chunk_target_chars: int = 1800
    max_question_chars: int = 800
    max_answer_tokens: int = 420
    top_k: int = 5
    min_similarity: float = 0.72
    recent_messages: int = 8
    user_window_questions: int = 20
    video_window_questions: int = 40
    rate_window_seconds: int = 3600


def load_chat_config() -> ChatConfig:
    return ChatConfig(
        chunk_target_chars=_int("CHAT_CHUNK_TARGET_CHARS", 1800),
        max_question_chars=_int("CHAT_MAX_QUESTION_CHARS", 800),
        max_answer_tokens=_int("CHAT_MAX_ANSWER_TOKENS", 420),
        top_k=_int("CHAT_TOP_K", 5),
        min_similarity=_float("CHAT_MIN_SIMILARITY", 0.72),
        recent_messages=_int("CHAT_RECENT_MESSAGES", 8),
        user_window_questions=_int("CHAT_USER_WINDOW_QUESTIONS", 20),
        video_window_questions=_int("CHAT_VIDEO_WINDOW_QUESTIONS", 40),
        rate_window_seconds=_int("CHAT_RATE_WINDOW_SECONDS", 3600),
    )
