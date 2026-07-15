#!/usr/bin/env bash
# Start the local PokéRogue dev server (background) and run the soak. Run after soak-setup.sh.
#   bash harness/soak-run.sh
# Env passthrough: SOAK_HOURS, SOAK_GL (swiftshader|egl|desktop), SOAK_ENABLE_RETRIES, SOAK_HOURS...
set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PR_DIR="${POKEROGUE_DIR:-$(dirname "$BOT_DIR")/pokerogue-src}"
PORT="${SOAK_PORT:-8000}"
export PATH="/usr/local/bin:$PATH"

# ── Single-instance guard ────────────────────────────────────────────────────
# Only ONE soak (and its headed browser) should ever be open at a time. Before
# starting, reap any prior soak: the runner (soak.mjs), other soak-run.sh shells,
# and the Playwright Chromium they spawned. We target ONLY this harness' processes
# (soak.mjs / soak-run.sh / the playwright_chromiumdev_profile temp dir) so a
# normal Chrome you have open is left untouched. SOAK_NO_REAP=1 skips this.
if [ "${SOAK_NO_REAP:-0}" != "1" ]; then
  # Never reap ourselves or our own ancestry (this shell + its parent launcher).
  SELF_PID=$$
  PARENT_PID="$(ps -o ppid= -p "$SELF_PID" 2>/dev/null | tr -d ' ' || true)"
  SAFE="^(${SELF_PID}|${PARENT_PID:-0})\$"
  reap() {
    # $1 = pgrep pattern, $2 = signal (default TERM). Kill matches outside our ancestry.
    local pids
    pids="$(pgrep -f "$1" 2>/dev/null | grep -Ev "$SAFE" || true)"
    [ -n "$pids" ] && kill "-${2:-TERM}" $pids 2>/dev/null || true
  }
  # soak.mjs (the runner) and the Playwright Chromium are always safe to reap.
  # We intentionally do NOT pattern-match soak-run.sh (would risk our own chain);
  # killing the runner + its browser is enough to free the single slot.
  reap "harness/soak.mjs"
  reap "playwright_chromiumdev_profile"
  sleep 1
  reap "harness/soak.mjs" KILL
  reap "playwright_chromiumdev_profile" KILL
  echo "== single-instance: reaped any prior soak runner + browser before launch"
fi

# Rebuild the bot so the soak uses the latest source.
cd "$BOT_DIR" && node build.mjs

# Start the dev server if it isn't already up.
if ! curl -s -m 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  echo "== starting dev server on :$PORT..."
  ( cd "$PR_DIR" && VITE_BYPASS_LOGIN=1 npx vite --mode development --host 127.0.0.1 --port "$PORT" > /tmp/vite-soak.log 2>&1 & )
  for i in $(seq 1 60); do curl -s -m 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 1; done
fi
curl -s -m 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || { echo "dev server failed to start; see /tmp/vite-soak.log"; exit 1; }

export SOAK_URL="http://127.0.0.1:$PORT/"
echo "== soaking against $SOAK_URL (duration: ${SOAK_HOURS:+SOAK_HOURS=$SOAK_HOURS}${SOAK_HOURS:-SOAK_MINUTES=${SOAK_MINUTES:-15}}, SOAK_GL=${SOAK_GL:-swiftshader})"
cd "$BOT_DIR" && exec node harness/soak.mjs
