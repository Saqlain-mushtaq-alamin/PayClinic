#!/usr/bin/env bash
set -euo pipefail

START_TIME=$(date +%s)

# Determine source repository or directory
SOURCE="${1:-.}"
TEMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t payclinic-clone-XXXXXX 2>/dev/null || echo ".payclinic-tmp/fresh-clone-$$")
mkdir -p "$TEMP_DIR"

cleanup() {
  local exit_code=$?
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEMP_DIR" 2>/dev/null || true
  exit $exit_code
}
trap cleanup EXIT INT TERM

echo "==> Cloning repository from $SOURCE into $TEMP_DIR..."
git clone "$SOURCE" "$TEMP_DIR"
cd "$TEMP_DIR"

echo "==> Running npm ci..."
npm ci

echo "==> Running npm run setup..."
npm run setup

echo "==> Running npm run check..."
npm run check

echo "==> Starting demo server in background..."
npm run demo &
SERVER_PID=$!

echo "==> Polling http://127.0.0.1:4000/api/health (up to 60s)..."
READY=0
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "Error: Server failed to become healthy at http://127.0.0.1:4000/api/health within 60s" >&2
  exit 1
fi

echo "==> Fetching /api/runs and checking run count..."
RUNS_JSON=$(curl -sf http://127.0.0.1:4000/api/runs)
RUN_COUNT=$(node -e "
  const data = JSON.parse(process.argv[1]);
  if (!Array.isArray(data)) {
    process.stderr.write('Expected array from /api/runs\n');
    process.exit(1);
  }
  process.stdout.write(String(data.length));
" "$RUNS_JSON")

echo "Found $RUN_COUNT runs in database."
if [ "$RUN_COUNT" -lt 3 ]; then
  echo "Error: Expected at least 3 runs, but got $RUN_COUNT" >&2
  exit 1
fi

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
unset SERVER_PID

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
echo "==> Fresh clone check succeeded! Elapsed time: ${ELAPSED}s"
exit 0

