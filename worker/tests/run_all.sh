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

echo "== import entrypoint without heavy deps =="
python3 -c "import worker.app.main; import worker.app.health; import worker.app.pipeline; print('imports ok')"

echo "== python unit + integration tests =="
python3 -m unittest worker.tests.test_worker

echo "== postgres queue RPC tests =="
bash "$HERE/run_queue_rpc_tests.sh"

echo "ALL WORKER TESTS PASSED"
