"""Media validation (ffprobe) and audio extraction (FFmpeg).

All external-process calls use argument arrays — untrusted values (paths, URLs)
are never interpolated into a shell string, so shell injection is impossible.
The ffprobe JSON parser and the FFmpeg argument builder are pure functions so
they can be unit-tested without the binaries present.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from typing import Optional

from .errors import (
    WorkerError,
    FFPROBE_FAILED,
    MEDIA_CORRUPT,
    MEDIA_NO_AUDIO,
    MEDIA_FORMAT_UNSUPPORTED,
    VIDEO_TOO_LONG,
    AUDIO_EXTRACTION_FAILED,
)


@dataclass
class MediaInfo:
    duration_seconds: float
    container: str
    video_codec: Optional[str]
    audio_codec: Optional[str]
    audio_track_count: int
    width: Optional[int]
    height: Optional[int]
    frame_rate: Optional[float]
    size_bytes: Optional[int]


def _parse_frame_rate(value: Optional[str]) -> Optional[float]:
    if not value or value in ("0/0", "N/A"):
        return None
    if "/" in value:
        num, _, den = value.partition("/")
        try:
            n, d = float(num), float(den)
            return round(n / d, 3) if d else None
        except ValueError:
            return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_ffprobe_json(raw: str) -> MediaInfo:
    """Parse `ffprobe -show_format -show_streams -print_format json` output."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise WorkerError(FFPROBE_FAILED, dev_detail=f"ffprobe json parse: {exc}")

    fmt = data.get("format", {}) or {}
    streams = data.get("streams", []) or []
    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]

    duration_raw = fmt.get("duration")
    try:
        duration = float(duration_raw) if duration_raw is not None else 0.0
    except (TypeError, ValueError):
        duration = 0.0
    # Fall back to a stream duration if the container omits it.
    if duration <= 0:
        for s in streams:
            try:
                duration = max(duration, float(s.get("duration", 0) or 0))
            except (TypeError, ValueError):
                continue

    v0 = video_streams[0] if video_streams else {}
    return MediaInfo(
        duration_seconds=duration,
        container=(fmt.get("format_name") or "").split(",")[0],
        video_codec=v0.get("codec_name"),
        audio_codec=audio_streams[0].get("codec_name") if audio_streams else None,
        audio_track_count=len(audio_streams),
        width=v0.get("width"),
        height=v0.get("height"),
        frame_rate=_parse_frame_rate(v0.get("avg_frame_rate") or v0.get("r_frame_rate")),
        size_bytes=int(fmt["size"]) if str(fmt.get("size", "")).isdigit() else None,
    )


def validate_media(info: MediaInfo, *, max_duration_seconds: int) -> None:
    """Apply acceptance rules, raising a classified WorkerError on rejection."""
    if info.duration_seconds <= 0:
        raise WorkerError(MEDIA_CORRUPT, dev_detail="non-positive duration")
    if info.audio_track_count == 0 or not info.audio_codec:
        raise WorkerError(MEDIA_NO_AUDIO, dev_detail="no audio stream")
    if info.duration_seconds > max_duration_seconds:
        raise WorkerError(
            VIDEO_TOO_LONG,
            dev_detail=f"duration {info.duration_seconds:.1f}s > cap {max_duration_seconds}s",
        )
    if not info.container:
        raise WorkerError(MEDIA_FORMAT_UNSUPPORTED, dev_detail="unknown container")


def ffprobe_command(input_path: str) -> list[str]:
    return [
        "ffprobe", "-v", "error", "-hide_banner",
        "-show_format", "-show_streams",
        "-print_format", "json", input_path,
    ]


def audio_extract_command(input_path: str, output_path: str, *, sample_rate: int = 16000) -> list[str]:
    """Mono 16 kHz PCM WAV — the format faster-whisper prefers. -vn avoids any
    video re-encoding; timing is preserved 1:1."""
    return [
        "ffmpeg", "-hide_banner", "-nostdin", "-y",
        "-i", input_path,
        "-vn",
        "-ac", "1",
        "-ar", str(sample_rate),
        "-c:a", "pcm_s16le",
        "-f", "wav",
        output_path,
    ]


def run_ffprobe(input_path: str, *, timeout: float = 120.0) -> MediaInfo:
    try:
        proc = subprocess.run(
            ffprobe_command(input_path),
            capture_output=True, text=True, timeout=timeout, check=False,
        )
    except FileNotFoundError:
        raise WorkerError(FFPROBE_FAILED, dev_detail="ffprobe not installed", retryable=False)
    except subprocess.TimeoutExpired:
        raise WorkerError(FFPROBE_FAILED, dev_detail="ffprobe timeout")
    if proc.returncode != 0:
        raise WorkerError(MEDIA_CORRUPT, dev_detail=f"ffprobe rc={proc.returncode}: {proc.stderr[:200]}")
    return parse_ffprobe_json(proc.stdout)


def extract_audio(input_path: str, output_path: str, *, sample_rate: int = 16000,
                  timeout: float = 1800.0, on_heartbeat=None) -> None:
    try:
        proc = subprocess.run(
            audio_extract_command(input_path, output_path, sample_rate=sample_rate),
            capture_output=True, text=True, timeout=timeout, check=False,
        )
    except FileNotFoundError:
        raise WorkerError(AUDIO_EXTRACTION_FAILED, dev_detail="ffmpeg not installed", retryable=False)
    except subprocess.TimeoutExpired:
        raise WorkerError(AUDIO_EXTRACTION_FAILED, dev_detail="ffmpeg timeout")
    if proc.returncode != 0:
        raise WorkerError(AUDIO_EXTRACTION_FAILED, dev_detail=f"ffmpeg rc={proc.returncode}: {proc.stderr[:200]}")
