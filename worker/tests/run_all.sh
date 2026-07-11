#!/usr/bin/env bash
# Full worker test suite: byte-compile every module, import the entrypoint
# (proves no eager heavy imports), run the Python unit/integration tests, and
# run the real Postgres queue-RPC tests.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
cd "$REPO"

echo "== byte-compile worker package =="
python3 -m compileall -q worker/app
python3 -c "import py_compile; py_compile.compile('worker/modal_app.py', doraise=True); print('modal_app syntax ok')"

echo "== import entrypoint without heavy deps =="
python3 -c "import worker.app.main; import worker.app.health; import worker.app.pipeline; import worker.app.translation_local; import worker.app.subtitles; import worker.app.subtitle_generation; import worker.app.insights; import worker.app.insight_generation; import worker.app.insight_provider; print('imports ok')"

echo "== subtitle builder loads with NO AI deps (stdlib only) =="
python3 - <<'PY'
import sys
import worker.app.subtitles, worker.app.subtitle_generation  # noqa: F401
heavy = [m for m in ("torch", "faster_whisper", "transformers", "numpy") if m in sys.modules]
assert not heavy, f"subtitle path must not import AI libs, found: {heavy}"
print("subtitle-only path imports no AI libraries")
PY

echo "== insight modules import lazily (no eager AI libs, no whisper/NLLB/media) =="
python3 - <<'PY'
import sys
import worker.app.insights, worker.app.insight_generation, worker.app.insight_provider  # noqa: F401
heavy = [m for m in ("torch", "faster_whisper", "transformers", "numpy") if m in sys.modules]
assert not heavy, f"insight path must not eagerly import AI libs, found: {heavy}"
banned = [m for m in ("worker.app.transcription", "worker.app.translation_local", "worker.app.media") if m in sys.modules]
assert not banned, f"insight path must not import transcription/translation/media modules, found: {banned}"
print("insight path imports no AI libraries and no whisper/NLLB/media modules")
PY

echo "== python unit + integration tests =="
python3 -m unittest worker.tests.test_worker worker.tests.test_subtitles worker.tests.test_subtitle_generation worker.tests.test_insights worker.tests.test_insight_generation

echo "== postgres queue RPC tests =="
bash "$HERE/run_queue_rpc_tests.sh"

echo "ALL WORKER TESTS PASSED"
