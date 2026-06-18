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
PR="${POKEROGUE_SRC:-/home/user/pokerogue-src}"
DEST="$PR/test/tests/auto-ribbon"

if [ ! -d "$PR/node_modules" ]; then
  echo "PokéRogue checkout not found or not installed at: $PR" >&2
  echo "Clone https://github.com/pagefaultgames/pokerogue.git, init submodules, pnpm install." >&2
  exit 1
fi

mkdir -p "$DEST/bot"
# Stage the current bot source (browser-only main.ts/hud.ts excluded) + the tests.
cp "$ROOT"/src/{bridge,state,config,log,input,policy,typechart}.ts "$DEST/bot/"
cp "$ROOT"/tests/integration/*.test.ts "$DEST/"

cd "$PR"
export PATH="/usr/local/bin:$PATH"
exec npx vitest run test/tests/auto-ribbon "$@"
