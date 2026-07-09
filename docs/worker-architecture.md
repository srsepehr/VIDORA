# Vidora Worker — Architecture Decision Record (Phase 3)

Internal record of the choices made for the asynchronous processing worker.

## 1. What the worker does

Claims queued `video_jobs`, then per job: acquires the source → validates with
ffprobe → extracts normalized audio with FFmpeg → transcribes with faster-whisper
→ persists timestamped source segments → translates every segment into Persian →
marks the phase done (video ends at `translating`). It heartbeats to hold a
lease, reaps crashed leases, retries recoverable failures within an attempt cap,
and stops promptly on cancellation. No subtitle/SRT/VTT/render work in this phase.

## 2. Runtime platform

**Selected: Fly.io** — one always-on `shared-cpu-1x` Machine (2 GB) running the
Docker image, with a small Fly Volume mounted at `/models` to cache the STT model
across restarts.

Why Fly.io for the MVP:

| Requirement | Fly.io |
|---|---|
| FFmpeg + ffprobe | apt-installed in the image |
| Long-running process | native (Machine runs the poll loop indefinitely) |
| CPU / RAM | shared-cpu-1x @ 2 GB fits `small`/`int8` whisper (~1–1.5 GB) |
| Temp disk | Machine rootfs + optional volume; 500 MB source cap fits |
| Outbound network | unrestricted (Supabase, translation host, HF at build) |
| Secrets | `fly secrets set` (never in the image) |
| Restart on crash | Machine restart policy |
| Health checks | native HTTP checks against `/health` and `/ready` |
| Model cache | baked into image at build + optional `/models` volume |
| Region | selectable (pick nearest the Supabase region) |
| Cost | per-second billing; see below |

**Expected baseline cost:** ~**$5–10/month** for a single always-on 2 GB Machine
plus a ~1–3 GB volume ($0.15/GB-month). Translation API usage is separate and
small (see §5).

**Does it sleep?** For a queue-polling worker we keep it **always-on** (no
auto-stop) so jobs start within the poll interval. Fly can `auto_stop`/`auto_start`
Machines, but that suits request-driven services, not a poller. To cut idle cost
later, the loop can be moved behind a scheduled wake or a webhook enqueue trigger.

**Max execution duration:** unlimited (persistent process); per-job timeouts are
enforced in-worker (ffmpeg/transcribe/translate timeouts + lease reaping).

**Disk / RAM / CPU limits:** shared-cpu-1x, 2 GB RAM, ephemeral rootfs + volume.
`small`/`int8` is chosen precisely to fit this envelope.

**Near-equivalent alternatives** (all run the same Docker image unchanged):
- **Railway** — usage-based (~$5–10/mo), equally simple; good second choice.
- **Render Background Worker** — clean, but needs the $25/mo Standard plan for
  2 GB (Starter's 512 MB is too small for `small`); higher fixed cost.
- **Modal** — serverless, scale-to-zero, cheapest when idle; best if job volume
  is bursty, at the cost of slightly more provider-specific wiring.
- **$4–6/mo VPS + Docker** — cheapest predictable price, most ops overhead.

The worker is deployable **independently of the frontend** (its own image, its
own secrets, its own health checks). GitHub Pages / Vite are untouched.

## 3. Speech-to-text

**faster-whisper (CTranslate2), model `small`, `int8`, CPU.** Self-hosted, so
there is **no API key and no per-request cost** — only CPU/RAM and a one-time
model download cached in the image (and optionally the `/models` volume).

Model sizing for a 2 GB CPU Machine:

| Model | ~RAM (int8) | CPU speed (rel.) | Accuracy | Notes |
|---|---|---|---|---|
| tiny | ~0.4 GB | fastest | low | too lossy for real subtitles |
| base | ~0.6 GB | fast | modest | acceptable fallback |
| **small** | **~1.0–1.5 GB** | **moderate** | **good** | **chosen MVP default** |
| medium | ~2.5–3 GB | slow | high | exceeds the 2 GB envelope on CPU |

`small`/`int8` is the best stability/accuracy trade-off that fits the MVP host and
covers multilingual audio incl. English source with Persian handled downstream by
translation. Model is configurable via `STT_MODEL`/`STT_COMPUTE_TYPE` and can be
raised to `medium` on a larger Machine later without code changes.

## 4. Translation — and the `Qwen3.6-27B` finding

**Finding: `Qwen3.6-27B` does not appear to be a real model.** The Qwen family has
no "3.6" generation and no "27B" size. Real, current Qwen instruct models are:

- **Qwen2.5-Instruct**: 7B / 14B / 32B / **72B** (72B is the strong multilingual
  choice, good Persian).
- **Qwen3**: 8B / 14B / 32B dense, plus **30B-A3B** and 235B-A22B MoE.
- **QwQ-32B** (reasoning — overkill and slower for translation).

I could **not** verify live endpoints, quotas, or pricing from the build sandbox:
its network reaches only `api.github.com`, `pypi`, and `npm` — every inference host
(DashScope, OpenRouter, Together, DeepInfra, Novita, Fireworks, SiliconFlow) and
even web search are blocked. So rather than invent an endpoint or silently
substitute a model, the worker was built **provider-agnostic**: it calls any
OpenAI-compatible `/chat/completions` endpoint selected purely by
`TRANSLATION_BASE_URL` + `TRANSLATION_MODEL` + `TRANSLATION_API_KEY`. The exact
Qwen model is a configuration value, never hard-coded.

**Recommended real options** (all OpenAI-compatible; pricing is public-list from
memory and must be confirmed against the provider at setup — do not treat as a
guarantee):

| Provider | Base URL (compatible mode) | Example model id | Rough $/1M tok (in/out) | Commercial use |
|---|---|---|---|---|
| Alibaba DashScope-Intl | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen2.5-72b-instruct` | ~$0.4 / ~$1.2 | yes (paid) |
| DeepInfra | `https://api.deepinfra.com/v1/openai` | `Qwen/Qwen2.5-72B-Instruct` | ~$0.35 / ~$0.40 | yes |
| Together AI | `https://api.together.xyz/v1` | `Qwen/Qwen2.5-72B-Instruct-Turbo` | ~$0.9 / ~$0.9 | yes |
| OpenRouter | `https://openrouter.ai/api/v1` | `qwen/qwen-2.5-72b-instruct` | varies by route | yes |

**No provider is meaningfully free for commercial use;** some give trial credits.

**Estimated translation cost per hour of video:** ~1 hour of speech ≈ 9–10k words
≈ ~13k source tokens; with Persian output plus batch/context overhead, ~30–40k
total tokens per video-hour. At ~$0.4/1M that is **well under $0.05 per hour of
video** on 72B, and sub-cent on 32B/7B. STT adds only CPU time (self-hosted).

**Quality trade-off:** 72B gives the most fluent, faithful Persian; 32B is a solid
cheaper step down; 7B/14B are usable but weaker on idiom and technical terms.
Recommended default: **Qwen2.5-72B-Instruct** via DeepInfra or DashScope-Intl.

The translation request uses structured JSON (`response_format: json_object`), a
versioned system prompt (`worker/app/prompts.py`), context-preserving batching,
and strict response validation (exact id match; no missing/extra/duplicate/empty),
with safe retries on malformed batches and idempotent per-segment persistence.

## 5. Queue & lease implementation

Migration `202607100001_video_worker_queue.sql`, all functions `service_role`-only
(`execute` revoked from `public`/`anon`/`authenticated`):

- `claim_next_video_job` — oldest `queued` job, `FOR UPDATE SKIP LOCKED`, sets
  `running` + `worker_id` + lease + `acquiring_source`. Two workers can never
  claim the same job.
- `heartbeat_video_job` — extends the lease, records real progress, returns a
  `cancelled` flag so the worker stops promptly.
- `complete_video_job_stage` / `complete_video_job` — advance stage / finish phase.
- `fail_video_job` — retryable → re-queue with `attempt++` (bounded by
  `max_attempts`); permanent → mark video+job failed with a Persian message.
- `release_expired_video_jobs` — reaps crashed leases (re-queue or fail at cap;
  cancelled videos' jobs finalized as cancelled).
- `upsert_transcript_segments` / `update_transcript_translations` — idempotent,
  keyed by `(video_id, segment_index)`; retries never duplicate rows.
- `cancel_video_processing` broadened so users can cancel mid-processing.

Verified for real against a local Postgres cluster in
`worker/tests/run_queue_rpc_tests.sh` (42 checks incl. a true concurrent-claim
race and client-role privilege denial).

## 6. Security

Service-role and translation keys live only in the worker process/host secret
store, never in logs, health output, or the browser. Media is re-validated
server-side (ffprobe) regardless of client input; direct-URL fetches are
SSRF-guarded per redirect hop; storage keys are owner-scoped and never trusted
from filenames; all subprocess calls use argument arrays (no shell). Transcript
text is not logged by default (`LOG_TRANSCRIPTS=false`).

## 7. Remaining human steps before a real end-to-end run

See the phase report / `worker/.env.example`. The worker code, migration, and
tests are complete; a real run needs (a) the migration applied to the live DB,
(b) a deploy target with billing, (c) the Supabase service-role key, and (d) a
chosen Qwen provider + API key.
