"""Typed wrappers over the service-role queue RPCs (migration 202607100001).

Every privileged state transition the worker performs lives here so the loop and
pipeline read as intent, not REST plumbing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .supabase import SupabaseClient


@dataclass
class ClaimedJob:
    id: str
    video_id: str
    user_id: str
    stage: str
    attempt: int
    max_attempts: int

    @classmethod
    def from_row(cls, row: Optional[dict]) -> Optional["ClaimedJob"]:
        if not row or not row.get("id"):
            return None
        return cls(
            id=row["id"], video_id=row["video_id"], user_id=row["user_id"],
            stage=row.get("stage", ""), attempt=row.get("attempt", 1),
            max_attempts=row.get("max_attempts", 3),
        )


class Queue:
    def __init__(self, client: SupabaseClient, worker_id: str, lease_seconds: int):
        self.client = client
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds

    def claim_next(self) -> Optional[ClaimedJob]:
        row = self.client.rpc("claim_next_video_job", {
            "p_worker_id": self.worker_id, "p_lease_seconds": self.lease_seconds,
        })
        return ClaimedJob.from_row(row)

    def heartbeat(self, job_id: str, *, current=None, total=None, percent=None) -> tuple[bool, bool]:
        rows = self.client.rpc("heartbeat_video_job", {
            "p_job_id": job_id, "p_worker_id": self.worker_id, "p_lease_seconds": self.lease_seconds,
            "p_progress_current": current, "p_progress_total": total, "p_progress_percent": percent,
        })
        row = rows[0] if isinstance(rows, list) and rows else (rows or {})
        return bool(row.get("ok")), bool(row.get("cancelled"))

    def advance_stage(self, job_id: str, stage: str, *, current=None, total=None, percent=None) -> tuple[bool, bool]:
        rows = self.client.rpc("complete_video_job_stage", {
            "p_job_id": job_id, "p_worker_id": self.worker_id, "p_stage": stage,
            "p_lease_seconds": self.lease_seconds,
            "p_progress_current": current, "p_progress_total": total, "p_progress_percent": percent,
        })
        row = rows[0] if isinstance(rows, list) and rows else (rows or {})
        return bool(row.get("ok")), bool(row.get("cancelled"))

    def complete(self, job_id: str, video_status: str = "translating") -> tuple[bool, bool]:
        rows = self.client.rpc("complete_video_job", {
            "p_job_id": job_id, "p_worker_id": self.worker_id, "p_video_status": video_status,
        })
        row = rows[0] if isinstance(rows, list) and rows else (rows or {})
        return bool(row.get("ok")), bool(row.get("cancelled"))

    def cancel(self, job_id: str) -> None:
        self.client.rpc("cancel_video_job", {"p_job_id": job_id, "p_worker_id": self.worker_id})

    def fail(self, job_id: str, code: str, message: str, message_fa: str, retryable: bool) -> tuple[bool, bool]:
        rows = self.client.rpc("fail_video_job", {
            "p_job_id": job_id, "p_worker_id": self.worker_id,
            "p_error_code": code, "p_error_message": message[:500],
            "p_message_fa": message_fa, "p_retryable": retryable,
        })
        row = rows[0] if isinstance(rows, list) and rows else (rows or {})
        return bool(row.get("requeued")), bool(row.get("failed"))

    def reap_expired(self) -> int:
        return int(self.client.rpc("release_expired_video_jobs", {}) or 0)

    def upsert_segments(self, video_id: str, segments: list[dict]) -> int:
        return int(self.client.rpc("upsert_transcript_segments", {
            "p_video_id": video_id, "p_segments": segments,
        }) or 0)

    def update_translations(self, video_id: str, items: list[dict], provider: str, model: str) -> int:
        return int(self.client.rpc("update_transcript_translations", {
            "p_video_id": video_id, "p_items": items, "p_provider": provider, "p_model": model,
        }) or 0)

    def set_media_metadata(self, video_id: str, duration_seconds: int, detected_language: Optional[str]) -> None:
        self.client.rpc("set_video_media_metadata", {
            "p_video_id": video_id, "p_duration_seconds": duration_seconds,
            "p_detected_language": detected_language,
        })
