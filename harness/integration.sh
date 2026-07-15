#!/usr/bin/env bash
# Tier 2 — deterministic integration tests: run our bot against PokéRogue's own
# GameManager (headless, seeded, no rendering). Requires the PokéRogue checkout
# (cloned + built by the session setup; override path with POKEROGUE_SRC).
#
# Staging: PokéRogue's vitest can't import files outside its root, so we copy the
# bot source (the non-browser modules) and the integration tests into the checkout
# under test/tests/auto-ribbon/, then run them. Re-run anytime to pick up edits.
#
# Usage: harness/integration.sh            # run all auto-ribbon integration tests
#        harness/integration.sh switch     # filter by name
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PR="${POKEROGUE_SRC:-$ROOT/../pokerogue-src}"
DEST="$PR/test/tests/auto-ribbon"

if [ ! -d "$PR/node_modules" ]; then
  echo "PokéRogue checkout not found or not installed at: $PR" >&2
  echo "Clone https://github.com/pagefaultgames/pokerogue.git, init submodules, pnpm install." >&2
  exit 1
fi

# Browser-only entry points: DOM/HUD wiring and the hot-swap bundle entry points that
# publish onto globalThis.__hostSeam / window.autoRibbon. Everything else in src/ is
# portable game-logic that GameManager can drive headless.
BROWSER_ONLY=(main hud policy-hot-entry strategy-hot-entry host-seam)

# Wipe and re-stage every time so a file removed from src/ (or a leftover scratch test)
# can't keep running silently from a prior stage.
rm -rf "$DEST"
mkdir -p "$DEST/bot"
for f in "$ROOT"/src/*.ts; do
  name="$(basename "$f" .ts)"
  skip=0
  for b in "${BROWSER_ONLY[@]}"; do [ "$name" = "$b" ] && skip=1 && break; done
  [ "$skip" -eq 1 ] || cp "$f" "$DEST/bot/"
done
cp "$ROOT"/tests/integration/*.ts "$DEST/"

cd "$PR"
export PATH="/usr/local/bin:$PATH"
# A bare arg is a name filter scoped to our suite (e.g. `integration.sh battle`).
if [ "$#" -gt 0 ]; then
  exec npx vitest run "test/tests/auto-ribbon/$1"
fi
exec npx vitest run test/tests/auto-ribbon
