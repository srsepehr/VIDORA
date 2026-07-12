"""Pure deterministic chunking, hashing, retrieval and citation validation."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass

from .chat_config import (
    CHAT_PROMPT_VERSION, CHAT_SCHEMA_VERSION, CHUNKER_VERSION,
    EMBEDDING_MODEL, EMBEDDING_PROVIDER, EMBEDDING_VERSION,
    NOT_IN_VIDEO_FA, ChatConfig,
)
from .errors import WorkerError
from .insights import is_mostly_persian, normalize_text


@dataclass(frozen=True)
class ChatSegment:
    segment_index: int
    start_ms: int
    end_ms: int
    text_fa: str
    source_text: str


@dataclass(frozen=True)
class ChatChunk:
    chunk_index: int
    start_ms: int
    end_ms: int
    segment_indexes: list[int]
    text_fa: str
    source_text: str
    content_hash: str


def prepare_chat_segments(rows: list[dict]) -> list[ChatSegment]:
    if not rows:
        raise WorkerError("CHAT_TRANSCRIPT_MISSING", dev_detail="no transcript rows")
    out: list[ChatSegment] = []
    seen: set[int] = set()
    for row in rows:
        index = int(row["segment_index"])
        fa = normalize_text(row.get("translated_text_fa") or "")
        if not fa:
            raise WorkerError("CHAT_TRANSLATION_INCOMPLETE", dev_detail=f"segment {index} missing fa")
        start, end = int(row["start_ms"]), int(row["end_ms"])
        if index in seen or start < 0 or end <= start:
            raise WorkerError("CHAT_TRANSCRIPT_MISSING", dev_detail=f"invalid segment {index}")
        seen.add(index)
        out.append(ChatSegment(index, start, end, fa, normalize_text(row.get("source_text") or "")))
    out.sort(key=lambda s: (s.start_ms, s.segment_index))
    return out


def build_chat_chunks(segments: list[ChatSegment], target_chars: int = 1800) -> list[ChatChunk]:
    if not segments:
        return []
    groups: list[list[ChatSegment]] = []
    current: list[ChatSegment] = []
    size = 0
    for segment in segments:
        segment_size = len(segment.text_fa) + len(segment.source_text) + 32
        if current and size + segment_size > target_chars:
            groups.append(current)
            current, size = [], 0
        current.append(segment)
        size += segment_size
    if current:
        groups.append(current)
    chunks: list[ChatChunk] = []
    for index, group in enumerate(groups):
        fa = "\n".join(s.text_fa for s in group)
        source = "\n".join(s.source_text for s in group if s.source_text)
        refs = [s.segment_index for s in group]
        canonical = json.dumps({"i": index, "refs": refs, "fa": fa, "source": source}, ensure_ascii=False, sort_keys=True)
        chunks.append(ChatChunk(index, group[0].start_ms, group[-1].end_ms, refs, fa, source,
                                hashlib.sha256(canonical.encode()).hexdigest()))
    assert [r for c in chunks for r in c.segment_indexes] == [s.segment_index for s in segments]
    return chunks


def canonical_index_hash(video_id: str, segments: list[ChatSegment], *, target_chars: int = 1800) -> str:
    payload = {
        "video_id": video_id, "chunker": CHUNKER_VERSION, "target_chars": target_chars,
        "provider": EMBEDDING_PROVIDER, "model": EMBEDDING_MODEL, "embedding_version": EMBEDDING_VERSION,
        "segments": [{"i": s.segment_index, "s": s.start_ms, "e": s.end_ms,
                      "fa": s.text_fa, "source": s.source_text} for s in segments],
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def lexical_terms(text: str) -> set[str]:
    return {token for token in re.findall(r"[\w\u0600-\u06ff]+", normalize_text(text).lower()) if len(token) > 2}


def lexical_score(question: str, chunk: dict) -> float:
    query = lexical_terms(question)
    if not query:
        return 0.0
    evidence = lexical_terms((chunk.get("text_fa") or "") + " " + (chunk.get("source_text") or ""))
    return len(query & evidence) / len(query)


def merge_retrieval(semantic: list[dict], lexical: list[dict], top_k: int) -> list[dict]:
    by_id: dict[str, dict] = {}
    for row in semantic + lexical:
        key = str(row["id"])
        candidate = dict(row)
        candidate["score"] = max(float(candidate.get("score") or 0), float(candidate.get("lexical_score") or 0))
        if key not in by_id or candidate["score"] > by_id[key]["score"]:
            by_id[key] = candidate
    return sorted(by_id.values(), key=lambda r: (-r["score"], int(r["chunk_index"])))[:top_k]


def validate_chat_payload(payload: dict, retrieved: list[dict], segment_rows: list[dict]) -> dict:
    if not isinstance(payload, dict):
        raise WorkerError("CHAT_INVALID_OUTPUT", dev_detail="payload not object")
    answer = normalize_text(payload.get("answer") or "")
    if not answer or not is_mostly_persian(answer, 0.45):
        raise WorkerError("CHAT_INVALID_OUTPUT", dev_detail="answer missing/not Persian")
    not_in_video = bool(payload.get("not_in_video"))
    allowed_chunks = {str(row["id"]): row for row in retrieved}
    allowed_refs = {int(ref) for row in retrieved for ref in (row.get("source_segment_indexes") or [])}
    segment_map = {int(row["segment_index"]): row for row in segment_rows}
    raw_citations = payload.get("citations") or []
    if not isinstance(raw_citations, list):
        raise WorkerError("CHAT_INVALID_OUTPUT", dev_detail="citations not list")
    citations, seen = [], set()
    for raw in raw_citations:
        if not isinstance(raw, dict):
            raise WorkerError("CHAT_GROUNDING_FAILED", dev_detail="citation not object")
        refs = sorted({int(x) for x in (raw.get("segment_indexes") or [])})
        if not refs or any(ref not in allowed_refs or ref not in segment_map for ref in refs):
            raise WorkerError("CHAT_GROUNDING_FAILED", dev_detail="citation outside retrieved evidence")
        key = tuple(refs)
        if key in seen:
            continue
        seen.add(key)
        related_chunks = [cid for cid, row in allowed_chunks.items()
                          if set(refs).intersection({int(x) for x in row.get("source_segment_indexes") or []})]
        citations.append({
            "citation_index": len(citations),
            "start_ms": min(int(segment_map[r]["start_ms"]) for r in refs),
            "end_ms": max(int(segment_map[r]["end_ms"]) for r in refs),
            "source_segment_indexes": refs,
            "chunk_ids": related_chunks,
        })
    if not_in_video:
        citations = []
        if len(answer) < 10:
            answer = NOT_IN_VIDEO_FA
    elif not citations:
        raise WorkerError("CHAT_GROUNDING_FAILED", dev_detail="grounded answer has no citations")
    followups = payload.get("suggested_followups") or []
    if not isinstance(followups, list):
        followups = []
    followups = [normalize_text(x) for x in followups if isinstance(x, str) and normalize_text(x)][:3]
    return {"answer": answer, "not_in_video": not_in_video, "citations": citations,
            "suggested_followups": followups, "prompt_version": CHAT_PROMPT_VERSION,
            "schema_version": CHAT_SCHEMA_VERSION}
