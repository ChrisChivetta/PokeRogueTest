#!/usr/bin/env bash
# Phase H1 (docs/PLAN-V2.md §5): run an N-seed headless soak and record the result in RESULTS.md.
# This IS the primary policy-evaluation loop — see Gate H0's finding that the ~40-100x-faster
# headless GameManager path sat unused as a test gate for 14 hours of real-time browser soaking
# while nothing got measured. No live browser, no Playwright: this stages the bot into the
# pokerogue-src checkout (same as harness/integration.sh) and runs it through vitest in small
# batches (see BATCH_SIZE below — a single big `vitest run` with all N seeds crashes fork workers
# at real scale because pokerogue-src's repo-wide `isolate: false` never tears down state between
# cases in one worker).
#
# Usage:
#   harness/headless-soak.sh [N] [--label "<change>"] [--kept|--reverted] [--hypothesis "..."] [--note "..."]
#
#   N defaults to 100 (Gate H1's baseline size). Extra flags pass straight through to
#   results-append.mjs to fill in the RESULTS.md entry — omit them for a plain baseline run.
#   SOAK_BATCH_SIZE env var controls seeds-per-vitest-process (default 10 — see BATCH_SIZE below).
#
# Example — the Gate H1 baseline:
#   harness/headless-soak.sh 100
#
# Example — evaluating a policy change (Phase H2's per-hypothesis loop):
#   harness/headless-soak.sh 100 --label "P1: real damage calc" --hypothesis "typechart scoring \
#     ignores stats/category, so a special attacker's physical move scores identically to the \
#     reverse" --note "median death wave unchanged — see damage.ts for the actual bug"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PR="${POKEROGUE_SRC:-$ROOT/../pokerogue-src}"
DEST="$PR/test/tests/auto-ribbon"

if [ ! -d "$PR/node_modules" ]; then
  echo "PokéRogue checkout not found or not installed at: $PR" >&2
  echo "Clone https://github.com/pagefaultgames/pokerogue.git, init submodules, pnpm install." >&2
  exit 1
fi

N=100
if [ "$#" -gt 0 ] && [[ "$1" =~ ^[0-9]+$ ]]; then
  N="$1"
  shift
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="$ROOT/soak-headless-${TS}.jsonl"
SEED_PREFIX="soak-${TS}"

# Same staging as harness/integration.sh (kept in sync manually — both wipe-then-copy the same
# browser-only exclude list; a real shared-lib refactor is more churn than this duplication is
# worth for two ~15-line staging blocks).
BROWSER_ONLY=(main hud policy-hot-entry strategy-hot-entry host-seam)
rm -rf "$DEST"
mkdir -p "$DEST/bot"
for f in "$ROOT"/src/*.ts; do
  name="$(basename "$f" .ts)"
  skip=0
  for b in "${BROWSER_ONLY[@]}"; do [ "$name" = "$b" ] && skip=1 && break; done
  [ "$skip" -eq 1 ] || cp "$f" "$DEST/bot/"
done
cp "$ROOT"/tests/integration/*.ts "$DEST/"

# Each headless run boots a full Phaser scene + all game data. pokerogue-src's vitest.config.ts
# sets `isolate: false` repo-wide (other tests depend on that, so we don't override it) — meaning
# test cases in the SAME worker share a module registry and never get torn down between cases.
# Across ~25+ sequential GameManager boots in one worker, that accumulates until the worker dies
# ("Worker exited unexpectedly" / "Timeout terminating forks worker") — observed at N=30-100
# regardless of --maxWorkers, since worker COUNT wasn't the variable, cases-PER-worker was. Fix:
# run in small batches, each its own `vitest run` process (fresh memory every time), and
# concatenate the JSONL. Override BATCH_SIZE via SOAK_BATCH_SIZE if your box handles more/fewer
# cases per process before the same accumulation bites.
BATCH_SIZE="${SOAK_BATCH_SIZE:-10}"

echo "[headless-soak] running $N seeds in batches of $BATCH_SIZE (prefix: $SEED_PREFIX) → $OUTPUT"
cd "$PR"
export PATH="/usr/local/bin:$PATH"
touch "$OUTPUT"
REMAINING="$N"
BATCH_N=0
while [ "$REMAINING" -gt 0 ]; do
  THIS_BATCH=$(( REMAINING < BATCH_SIZE ? REMAINING : BATCH_SIZE ))
  BATCH_PREFIX="${SEED_PREFIX}-b${BATCH_N}"
  echo "[headless-soak] batch $BATCH_N: $THIS_BATCH seeds (prefix $BATCH_PREFIX)"
  # NOT `set -e`-guarded: vitest exits 1 on a harmless post-teardown i18n unhandled-rejection even
  # when every assertion passed (see harness/integration.sh's known noise), so a nonzero exit here
  # doesn't by itself mean the batch failed — the real signal is how many JSONL records landed.
  set +e
  SOAK_SEED_COUNT="$THIS_BATCH" SOAK_SEED_PREFIX="$BATCH_PREFIX" SOAK_OUTPUT="$OUTPUT" \
    npx vitest run test/tests/auto-ribbon/headless-soak.test.ts
  BATCH_EXIT=$?
  set -e
  [ "$BATCH_EXIT" -ne 0 ] && echo "[headless-soak] batch $BATCH_N: vitest exited $BATCH_EXIT (checking record count before deciding if that matters)"
  REMAINING=$(( REMAINING - THIS_BATCH ))
  BATCH_N=$(( BATCH_N + 1 ))
done

RUN_COUNT="$([ -f "$OUTPUT" ] && wc -l < "$OUTPUT" | tr -d ' ' || echo 0)"
echo "[headless-soak] $RUN_COUNT/$N runs recorded to $OUTPUT"
if [ "$RUN_COUNT" -eq 0 ]; then
  echo "[headless-soak] no records written — every batch failed before any test completed; skipping RESULTS.md." >&2
  exit 1
fi
if [ "$RUN_COUNT" -lt "$N" ]; then
  echo "[headless-soak] WARNING: only $RUN_COUNT/$N seeds completed — some runs failed outright (not just wiped). Check vitest output above before trusting this distribution." >&2
fi

cd "$ROOT"
node harness/results-append.mjs "$OUTPUT" "$@"
echo "[headless-soak] done. Raw records: $OUTPUT"
