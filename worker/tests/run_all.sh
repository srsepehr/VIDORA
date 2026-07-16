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
python3 -c "import worker.app.main; import worker.app.health; import worker.app.pipeline; import worker.app.translation_local; import worker.app.subtitles; import worker.app.subtitle_generation; import worker.app.insights; import worker.app.insight_generation; import worker.app.insight_provider; import worker.app.chat_index; import worker.app.chat_service; import worker.app.chat_provider; import worker.app.embedding_provider; import worker.app.notes; import worker.app.note_service; import worker.app.note_provider; import worker.app.learning; import worker.app.learning_service; import worker.app.learning_provider; print('imports ok')"

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

echo "== chat modules import lazily (no whisper/NLLB/media/subtitles) =="
python3 - <<'PY'
import sys
import worker.app.chat_index, worker.app.chat_service, worker.app.chat_provider, worker.app.embedding_provider  # noqa: F401
heavy = [m for m in ("torch", "faster_whisper", "transformers", "numpy") if m in sys.modules]
assert not heavy, f"chat path must lazy-load AI libs, found: {heavy}"
banned = [m for m in ("worker.app.transcription", "worker.app.translation_local", "worker.app.media", "worker.app.subtitles") if m in sys.modules]
assert not banned, f"chat path imported processing modules: {banned}"
print("chat path imports no eager AI or video-processing modules")
PY

echo "== note modules import lazily (no eager AI libs, no whisper/NLLB/media/subtitles) =="
python3 - <<'PY'
import sys
import worker.app.notes, worker.app.note_service, worker.app.note_provider  # noqa: F401
heavy = [m for m in ("torch", "faster_whisper", "transformers", "numpy") if m in sys.modules]
assert not heavy, f"note path must lazy-load AI libs, found: {heavy}"
banned = [m for m in ("worker.app.transcription", "worker.app.translation_local", "worker.app.media", "worker.app.subtitles") if m in sys.modules]
assert not banned, f"note path imported processing modules: {banned}"
print("note path imports no eager AI or video-processing modules")
PY

echo "== learning modules import lazily (no eager AI libs, no whisper/NLLB/media/subtitles/embeddings) =="
python3 - <<'PY'
import sys
import worker.app.learning, worker.app.learning_service, worker.app.learning_provider  # noqa: F401
heavy = [m for m in ("torch", "faster_whisper", "transformers", "numpy") if m in sys.modules]
assert not heavy, f"learning path must lazy-load AI libs, found: {heavy}"
banned = [m for m in ("worker.app.transcription", "worker.app.translation_local", "worker.app.media",
                      "worker.app.subtitles", "worker.app.embedding_provider") if m in sys.modules]
assert not banned, f"learning path imported processing modules: {banned}"
print("learning path imports no eager AI or video-processing modules")
PY

echo "== python unit + integration tests =="
python3 -m unittest worker.tests.test_worker worker.tests.test_subtitles worker.tests.test_subtitle_generation worker.tests.test_insights worker.tests.test_insight_generation worker.tests.test_chat worker.tests.test_notes worker.tests.test_note_service worker.tests.test_learning worker.tests.test_learning_service

echo "== postgres queue RPC tests =="
bash "$HERE/run_queue_rpc_tests.sh"

echo "ALL WORKER TESTS PASSED"
