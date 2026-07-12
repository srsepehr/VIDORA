"""Server-side indexing and authenticated grounded-chat orchestration."""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from datetime import datetime, timedelta, timezone

from . import http_client
from .chat_config import (
    CHAT_MODEL, CHAT_PROMPT_VERSION, CHAT_PROVIDER, CHAT_SCHEMA_VERSION,
    CHUNKER_VERSION, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_PROVIDER,
    EMBEDDING_VERSION, NOT_IN_VIDEO_FA, load_chat_config,
)
from .chat_index import (
    build_chat_chunks, canonical_index_hash, lexical_score, merge_retrieval,
    prepare_chat_segments, validate_chat_payload,
)
from .chat_provider import LocalQwenVideoChatProvider, VideoChatProvider
from .config import load_config
from .embedding_provider import LocalE5EmbeddingProvider, VideoEmbeddingProvider
from .errors import WorkerError
from .supabase import SupabaseClient


def _segments(client: SupabaseClient, video_id: str) -> tuple[list[dict], list]:
    rows = client.select_many("transcript_segments",
        f"video_id=eq.{video_id}&select=id,segment_index,start_ms,end_ms,source_text,translated_text_fa&order=segment_index.asc")
    return rows, prepare_chat_segments(rows)


def index_video(client: SupabaseClient, video_id: str, *, force: bool = False,
                provider: VideoEmbeddingProvider | None = None) -> dict:
    config = load_chat_config()
    video = client.select_one("videos", f"id=eq.{video_id}&select=id,user_id")
    if not video:
        raise WorkerError("CHAT_VIDEO_NOT_FOUND", dev_detail="video not found")
    _, segments = _segments(client, video_id)
    content_hash = canonical_index_hash(video_id, segments, target_chars=config.chunk_target_chars)
    existing = client.select_one("video_chat_indexes",
        f"video_id=eq.{video_id}&select=id,status,content_hash,chunk_count,chunker_version,embedding_model,indexed_at")
    if existing and existing.get("status") == "ready" and existing.get("content_hash") == content_hash and not force:
        return {"status": "reused", "reused": True, "hash_prefix": content_hash[:12],
                "chunk_count": existing.get("chunk_count"), "indexed_at": existing.get("indexed_at")}
    chunks = build_chat_chunks(segments, config.chunk_target_chars)
    provider = provider or LocalE5EmbeddingProvider()
    vectors = provider.embed_documents([c.text_fa + ("\n" + c.source_text if c.source_text else "") for c in chunks])
    if len(vectors) != len(chunks) or any(len(vector) != EMBEDDING_DIMENSIONS for vector in vectors):
        raise WorkerError("CHAT_PROVIDER_UNAVAILABLE", dev_detail="embedding batch shape mismatch")
    payload = []
    for chunk, vector in zip(chunks, vectors):
        payload.append({"chunk_index": chunk.chunk_index, "start_ms": chunk.start_ms, "end_ms": chunk.end_ms,
            "source_segment_indexes": chunk.segment_indexes, "text_fa": chunk.text_fa,
            "source_text": chunk.source_text, "content_hash": chunk.content_hash,
            "embedding": "[" + ",".join(f"{value:.8f}" for value in vector) + "]"})
    client.rpc("persist_video_chat_index", {"p_video_id": video_id, "p_content_hash": content_hash,
        "p_chunker_version": CHUNKER_VERSION, "p_embedding_provider": provider.name,
        "p_embedding_model": provider.model_id, "p_embedding_version": EMBEDDING_VERSION,
        "p_embedding_dimensions": EMBEDDING_DIMENSIONS, "p_chunks": payload})
    return {"status": "generated", "reused": False, "hash_prefix": content_hash[:12],
            "chunk_count": len(chunks), "embedding_dimensions": EMBEDDING_DIMENSIONS}


def backfill_chat_index(video_id: str, force: bool = False) -> dict:
    cfg = load_config(require_translation=False)
    return index_video(SupabaseClient(cfg.supabase_url, cfg.service_role_key), video_id, force=force)


def _authenticate(client: SupabaseClient, token: str) -> dict:
    if not token:
        raise WorkerError("CHAT_AUTH_REQUIRED", dev_detail="missing bearer token")
    response = None
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = http_client.request("GET", f"{client.base_url}/auth/v1/user",
                headers={"apikey": client.key, "Authorization": f"Bearer {token}"}, timeout=15.0)
            break
        except (OSError, TimeoutError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.2 * (attempt + 1))
    if response is None:
        raise WorkerError("CHAT_PROVIDER_UNAVAILABLE",
            dev_detail=f"auth transport unavailable: {type(last_error).__name__}",
            retryable=True)
    if not response.ok:
        raise WorkerError("CHAT_AUTH_REQUIRED", dev_detail=f"auth http {response.status}")
    try:
        user = response.json() or {}
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WorkerError("CHAT_PROVIDER_UNAVAILABLE",
            dev_detail=f"auth response decode: {type(exc).__name__}", retryable=True)
    if not user.get("id"):
        raise WorkerError("CHAT_AUTH_REQUIRED", dev_detail="auth user missing id")
    return user


def _safe_question(raw: object, max_chars: int) -> str:
    question = " ".join(str(raw or "").split()).strip()
    if not question:
        raise WorkerError("CHAT_QUESTION_EMPTY", dev_detail="empty question")
    if len(question) > max_chars:
        raise WorkerError("CHAT_QUESTION_TOO_LONG", dev_detail=f"question chars {len(question)}")
    return question


def _retrieval_query(question: str, history: list[dict]) -> str:
    """Resolve short referential follow-ups without broadening the video scope."""
    normalized = question.strip()
    markers = ("این را", "این بخش", "آن را", "منظورش", "بیشتر توضیح", "ساده‌تر", "دوباره توضیح")
    if len(normalized) <= 140 and any(marker in normalized for marker in markers):
        previous = next((row.get("content", "").strip() for row in reversed(history)
                         if row.get("role") == "user" and row.get("content", "").strip()), "")
        if previous:
            return previous + "\n" + normalized
    return normalized


def _rate_limit(client: SupabaseClient, user_id: str, video_id: str, config) -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=config.rate_window_seconds)).isoformat()
    rows = client.select_many("video_chat_messages",
        f"user_id=eq.{user_id}&role=eq.user&status=eq.complete&created_at=gte.{cutoff}&select=id,video_id&limit=100")
    if len(rows) >= config.user_window_questions or sum(1 for row in rows if row.get("video_id") == video_id) >= config.video_window_questions:
        raise WorkerError("CHAT_RATE_LIMITED", dev_detail="configured window exceeded", retryable=True)


def _request_fingerprint(video_id: str, user_id: str, question: str) -> str:
    return hashlib.sha256(json.dumps({"video": video_id, "user": user_id, "question": question},
        ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _existing_exchange(client: SupabaseClient, session_id: str, request_id: str,
                       request_hash: str) -> dict | None:
    assistant = client.select_one("video_chat_messages",
        f"session_id=eq.{session_id}&request_id=eq.{request_id}&role=eq.assistant&select=id,content,not_in_video,request_hash")
    if not assistant:
        return None
    if assistant.get("request_hash") != request_hash:
        raise WorkerError("CHAT_REQUEST_CONFLICT", dev_detail="request id reused with different payload")
    citations = client.select_many("video_chat_message_citations",
        f"message_id=eq.{assistant['id']}&select=citation_index,start_ms,end_ms,source_segment_indexes&order=citation_index.asc")
    return {"status": "ok", "reused": True, "session_id": session_id, "assistant_message_id": assistant["id"],
            "answer": assistant["content"], "not_in_video": assistant["not_in_video"], "citations": citations,
            "suggested_followups": []}


def ask_video(body: dict, access_token: str, *, embedding: VideoEmbeddingProvider | None = None,
              provider: VideoChatProvider | None = None) -> dict:
    started = time.monotonic()
    config = load_chat_config()
    cfg = load_config(require_translation=False)
    client = SupabaseClient(cfg.supabase_url, cfg.service_role_key)
    user = _authenticate(client, access_token)
    try:
        video_id = str(uuid.UUID(str(body.get("video_id") or "")))
        request_id = str(uuid.UUID(str(body.get("request_id") or "")))
    except ValueError:
        raise WorkerError("CHAT_VIDEO_NOT_FOUND", dev_detail="invalid UUID")
    question = _safe_question(body.get("question"), config.max_question_chars)
    video = client.select_one("videos", f"id=eq.{video_id}&user_id=eq.{user['id']}&select=id,user_id")
    if not video:
        raise WorkerError("CHAT_ACCESS_DENIED", dev_detail="video not owned")
    request_hash = _request_fingerprint(video_id, user["id"], question)
    session = client.rpc("get_or_create_video_chat_session", {"p_video_id": video_id, "p_user_id": user["id"]})
    existing = _existing_exchange(client, session["id"], request_id, request_hash)
    if existing:
        return existing
    _rate_limit(client, user["id"], video_id, config)
    rows, segments = _segments(client, video_id)
    index_hash = canonical_index_hash(video_id, segments, target_chars=config.chunk_target_chars)
    index = client.select_one("video_chat_indexes",
        f"video_id=eq.{video_id}&select=id,status,content_hash,embedding_model")
    if not index or index.get("status") != "ready":
        raise WorkerError("CHAT_INDEX_MISSING", dev_detail="ready index missing")
    if index.get("content_hash") != index_hash:
        raise WorkerError("CHAT_STALE_INDEX", dev_detail="index hash mismatch")
    history = client.select_many("video_chat_messages",
        f"session_id=eq.{session['id']}&status=eq.complete&select=role,content&order=created_at.desc&limit={config.recent_messages}")
    history.reverse()
    retrieval_query = _retrieval_query(question, history)
    embedding = embedding or LocalE5EmbeddingProvider()
    vector = embedding.embed_query(retrieval_query)
    semantic = client.rpc("match_video_chat_chunks", {"p_video_id": video_id, "p_content_hash": index_hash,
        "p_query_embedding": "[" + ",".join(f"{v:.8f}" for v in vector) + "]",
        "p_top_k": config.top_k, "p_min_score": config.min_similarity}) or []
    all_chunks = client.select_many("video_chat_chunks",
        f"video_id=eq.{video_id}&select=id,chunk_index,start_ms,end_ms,source_segment_indexes,text_fa,source_text&order=chunk_index.asc")
    lexical = []
    for row in all_chunks:
        score = lexical_score(retrieval_query, row)
        if score >= 0.34:
            lexical.append({**row, "lexical_score": score, "score": score})
    evidence = merge_retrieval(semantic, lexical, config.top_k)
    if not evidence:
        result = {"answer": NOT_IN_VIDEO_FA, "not_in_video": True, "citations": [], "suggested_followups": []}
    else:
        provider = provider or LocalQwenVideoChatProvider(max_new_tokens=config.max_answer_tokens)
        raw = provider.answer(question, evidence, history)
        try:
            result = validate_chat_payload(raw, evidence, rows)
        except WorkerError as first:
            repaired = provider.repair(question, evidence, history, raw, first.dev_detail)
            result = validate_chat_payload(repaired, evidence, rows)
    persisted = client.rpc("persist_video_chat_exchange", {"p_session_id": session["id"], "p_video_id": video_id,
        "p_user_id": user["id"], "p_request_id": request_id, "p_question": question,
        "p_answer": result["answer"], "p_not_in_video": result["not_in_video"],
        "p_provider": CHAT_PROVIDER, "p_model": CHAT_MODEL, "p_prompt_version": CHAT_PROMPT_VERSION,
        "p_schema_version": CHAT_SCHEMA_VERSION, "p_request_hash": request_hash,
        "p_citations": result["citations"]})
    if persisted.get("conflict"):
        raise WorkerError("CHAT_REQUEST_CONFLICT", dev_detail="request id conflict detected during persist")
    return {"status": "ok", "reused": bool(persisted.get("reused")), "session_id": session["id"],
        "assistant_message_id": persisted["assistant_message_id"], "answer": result["answer"],
        "not_in_video": result["not_in_video"], "citations": result["citations"],
        "suggested_followups": result.get("suggested_followups") or [],
        "runtime_ms": int((time.monotonic() - started) * 1000)}


def persist_chat_failure(body: dict, access_token: str, error_code: str) -> None:
    """Persist only a stable failure code after revalidating token and ownership.

    This deliberately stores no provider detail, retrieved evidence, prompt, or
    token. Authentication/validation failures that cannot establish an owned
    session are not persisted.
    """
    config = load_chat_config()
    cfg = load_config(require_translation=False)
    client = SupabaseClient(cfg.supabase_url, cfg.service_role_key)
    user = _authenticate(client, access_token)
    video_id = str(uuid.UUID(str(body.get("video_id") or "")))
    request_id = str(uuid.UUID(str(body.get("request_id") or "")))
    question = _safe_question(body.get("question"), config.max_question_chars)
    video = client.select_one("videos", f"id=eq.{video_id}&user_id=eq.{user['id']}&select=id")
    if not video:
        return
    request_hash = _request_fingerprint(video_id, user["id"], question)
    session = client.rpc("get_or_create_video_chat_session", {"p_video_id": video_id, "p_user_id": user["id"]})
    client.rpc("persist_video_chat_failure", {"p_session_id": session["id"], "p_video_id": video_id,
        "p_user_id": user["id"], "p_request_id": request_id, "p_question": question,
        "p_request_hash": request_hash, "p_error_code": error_code})


def diagnose_chat_pipeline(video_id: str, question: str = "این ویدیو درباره چیست؟") -> dict:
    """Run retrieval and local generation without auth or persistence.

    This Modal-token-only diagnostic returns structural facts and safe error
    metadata. It never returns transcript text, evidence, prompts, or answers.
    """
    stage = "configuration"
    try:
        config = load_chat_config()
        cfg = load_config(require_translation=False)
        client = SupabaseClient(cfg.supabase_url, cfg.service_role_key)
        stage = "transcript"
        rows, segments = _segments(client, video_id)
        index_hash = canonical_index_hash(video_id, segments, target_chars=config.chunk_target_chars)
        stage = "index"
        index = client.select_one("video_chat_indexes",
            f"video_id=eq.{video_id}&select=id,status,content_hash,embedding_model")
        if not index or index.get("status") != "ready":
            raise WorkerError("CHAT_INDEX_MISSING", dev_detail="ready index missing")
        if index.get("content_hash") != index_hash:
            raise WorkerError("CHAT_STALE_INDEX", dev_detail="index hash mismatch")
        stage = "embedding"
        vector = LocalE5EmbeddingProvider().embed_query(question)
        stage = "retrieval"
        semantic = client.rpc("match_video_chat_chunks", {"p_video_id": video_id,
            "p_content_hash": index_hash,
            "p_query_embedding": "[" + ",".join(f"{v:.8f}" for v in vector) + "]",
            "p_top_k": config.top_k, "p_min_score": config.min_similarity}) or []
        all_chunks = client.select_many("video_chat_chunks",
            f"video_id=eq.{video_id}&select=id,chunk_index,start_ms,end_ms,source_segment_indexes,text_fa,source_text&order=chunk_index.asc")
        lexical = []
        for row in all_chunks:
            score = lexical_score(question, row)
            if score >= 0.34:
                lexical.append({**row, "lexical_score": score, "score": score})
        evidence = merge_retrieval(semantic, lexical, config.top_k)
        if not evidence:
            return {"status": "ok", "stage": "retrieval", "evidence_count": 0,
                    "not_in_video": True, "citation_count": 0}
        stage = "generation"
        provider = LocalQwenVideoChatProvider(max_new_tokens=config.max_answer_tokens)
        raw = provider.answer(question, evidence, [])
        stage = "validation"
        try:
            result = validate_chat_payload(raw, evidence, rows)
            repaired = False
        except WorkerError as first:
            repaired_raw = provider.repair(question, evidence, [], raw, first.dev_detail)
            result = validate_chat_payload(repaired_raw, evidence, rows)
            repaired = True
        return {"status": "ok", "stage": "complete", "evidence_count": len(evidence),
                "not_in_video": result["not_in_video"],
                "citation_count": len(result["citations"]),
                "answer_chars": len(result["answer"]), "repaired": repaired,
                "provider": CHAT_PROVIDER, "model": CHAT_MODEL}
    except WorkerError as err:
        return {"status": "error", "stage": stage, "code": err.code,
                "retryable": err.retryable, "detail": err.dev_detail[:240]}
    except Exception as exc:
        return {"status": "error", "stage": stage,
                "code": "CHAT_PROVIDER_UNAVAILABLE",
                "retryable": True, "error_type": type(exc).__name__}


def inspect_chat_index(video_id: str) -> dict:
    cfg = load_config(require_translation=False)
    client = SupabaseClient(cfg.supabase_url, cfg.service_role_key)
    index = client.select_one("video_chat_indexes", f"video_id=eq.{video_id}&select=*") or {}
    chunks = client.select_many("video_chat_chunks",
        f"video_id=eq.{video_id}&select=chunk_index,start_ms,end_ms,source_segment_indexes,content_hash&order=chunk_index.asc")
    return {"video_id": video_id, "status": index.get("status"), "hash_prefix": (index.get("content_hash") or "")[:12],
        "chunker_version": index.get("chunker_version"), "embedding_provider": index.get("embedding_provider"),
        "embedding_model": index.get("embedding_model"), "embedding_dimensions": index.get("embedding_dimensions"),
        "indexed_at": index.get("indexed_at"), "chunk_count": len(chunks),
        "chunks": [{"index": c["chunk_index"], "start_ms": c["start_ms"], "end_ms": c["end_ms"],
                    "segment_refs": c["source_segment_indexes"], "hash_prefix": c["content_hash"][:12]} for c in chunks]}
