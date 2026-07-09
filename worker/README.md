# Vidora Worker

Asynchronous video-processing worker: claims queued jobs and runs
acquire → validate (ffprobe) → extract audio (FFmpeg) → transcribe
(faster-whisper) → translate to Persian (OpenAI-compatible endpoint) →
persist timestamped transcript + translations. Deploys independently of the
frontend. See `../docs/worker-architecture.md` for the full decision record.

## Layout

```
worker/
  app/
    config.py         env config + validation
    errors.py         stable error taxonomy (code, Persian message, retryable, stage)
    http_client.py    stdlib HTTP wrapper (no heavy deps)
    ssrf.py           server-side SSRF guard (DNS + private-range checks)
    supabase.py       service-role REST + storage client
    queue.py          typed wrappers over the queue RPCs
    storage.py        source acquisition (upload / direct URL / unsupported)
    media.py          ffprobe validation + FFmpeg audio extraction (argv arrays)
    transcription.py  SpeechToTextProvider + FasterWhisperProvider
    translation.py    TranslationProvider + OpenAICompatibleProvider + batching
    prompts.py        versioned translation system prompt
    pipeline.py       single-job orchestration (idempotent, cancellable)
    health.py         /health and /ready HTTP server
    main.py           poll/claim loop + graceful shutdown
  tests/
    test_worker.py            python unit + integration tests (mocks)
    run_queue_rpc_tests.sh    real Postgres queue-RPC tests
    run_all.sh                everything
  Dockerfile
  requirements.txt
  .env.example
```

## Run the tests

```bash
worker/tests/run_all.sh          # compile + import + python tests + Postgres RPC tests
```

Requires a local Postgres 16 (`initdb`/`pg_ctl` on PATH) for the RPC tests. No
Supabase, model download, or inference provider is needed — providers are mocked
and the queue tests run against an ephemeral local cluster.

## Build & run

```bash
docker build -t vidora-worker worker/
docker run --env-file worker/.env -p 8080:8080 vidora-worker
```

Configure via environment (see `.env.example`). Required: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and a translation endpoint
(`TRANSLATION_BASE_URL` / `TRANSLATION_MODEL` / `TRANSLATION_API_KEY`).

## Health

- `GET /health` — liveness (process up).
- `GET /ready` — readiness: tool availability (ffmpeg/ffprobe), queue/DB
  connectivity, worker version/commit/id. No secrets are ever returned.
