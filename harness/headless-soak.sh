#!/usr/bin/env bash
# Phase H1 (docs/PLAN-V2.md §5): run an N-seed headless soak and record the result in RESULTS.md.
# This IS the primary policy-evaluation loop — see Gate H0's finding that the ~40-100x-faster
# headless GameManager path sat unused as a test gate for 14 hours of real-time browser soaking
# while nothing got measured. No live browser, no Playwright: this stages the bot into the
# pokerogue-src checkout (same as harness/integration.sh) and drives it through vitest's own fork
# workers, which parallelize `it.each` cases across cores automatically.
#
# Usage:
#   harness/headless-soak.sh [N] [--label "<change>"] [--kept|--reverted] [--hypothesis "..."] [--note "..."]
#
#   N defaults to 100 (Gate H1's baseline size). Extra flags pass straight through to
#   results-append.mjs to fill in the RESULTS.md entry — omit them for a plain baseline run.
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

echo "[headless-soak] running $N seeds (prefix: $SEED_PREFIX) → $OUTPUT"
cd "$PR"
export PATH="/usr/local/bin:$PATH"
# NOT `set -e`-guarded: vitest exits 1 on a harmless post-teardown i18n unhandled-rejection even
# when every assertion passed (see harness/integration.sh's known noise), so a nonzero exit here
# doesn't by itself mean the soak failed — the real signal is how many JSONL records actually
# landed, checked right below.
set +e
SOAK_SEED_COUNT="$N" SOAK_SEED_PREFIX="$SEED_PREFIX" SOAK_OUTPUT="$OUTPUT" \
  npx vitest run test/tests/auto-ribbon/headless-soak.test.ts
VITEST_EXIT=$?
set -e
[ "$VITEST_EXIT" -ne 0 ] && echo "[headless-soak] vitest exited $VITEST_EXIT (may be the known harmless i18n teardown noise — checking record count before deciding)"

RUN_COUNT="$([ -f "$OUTPUT" ] && wc -l < "$OUTPUT" | tr -d ' ' || echo 0)"
echo "[headless-soak] $RUN_COUNT/$N runs recorded to $OUTPUT"
if [ "$RUN_COUNT" -eq 0 ]; then
  echo "[headless-soak] no records written — vitest failed before any test completed; skipping RESULTS.md." >&2
  exit 1
fi
if [ "$RUN_COUNT" -lt "$N" ]; then
  echo "[headless-soak] WARNING: only $RUN_COUNT/$N seeds completed — some runs failed outright (not just wiped). Check vitest output above before trusting this distribution." >&2
fi

cd "$ROOT"
node harness/results-append.mjs "$OUTPUT" "$@"
echo "[headless-soak] done. Raw records: $OUTPUT"
