#!/usr/bin/env bash
# Start the local PokéRogue dev server (background) and run the soak. Run after soak-setup.sh.
#   bash harness/soak-run.sh
# Env passthrough: SOAK_HOURS, SOAK_GL (swiftshader|egl|desktop), SOAK_ENABLE_RETRIES, SOAK_HOURS…
set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PR_DIR="${POKEROGUE_DIR:-$(dirname "$BOT_DIR")/pokerogue-src}"
PORT="${SOAK_PORT:-8000}"
export PATH="/usr/local/bin:$PATH"

# Rebuild the bot so the soak uses the latest source.
cd "$BOT_DIR" && node build.mjs

# Start the dev server if it isn't already up.
if ! curl -s -m 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  echo "== starting dev server on :$PORT…"
  ( cd "$PR_DIR" && VITE_BYPASS_LOGIN=1 npx vite --mode development --host 127.0.0.1 --port "$PORT" > /tmp/vite-soak.log 2>&1 & )
  for i in $(seq 1 60); do curl -s -m 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 1; done
fi
curl -s -m 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || { echo "dev server failed to start; see /tmp/vite-soak.log"; exit 1; }

export SOAK_URL="http://127.0.0.1:$PORT/"
echo "== soaking against $SOAK_URL (SOAK_HOURS=${SOAK_HOURS:-6}, SOAK_GL=${SOAK_GL:-swiftshader})"
cd "$BOT_DIR" && exec node harness/soak.mjs
