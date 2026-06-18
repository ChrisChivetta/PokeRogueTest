#!/usr/bin/env bash
# ── Cloud soak box provisioning ──────────────────────────────────────────────
# Stands up everything needed to soak-test the bot against the LOCAL PokéRogue build on a fresh
# Ubuntu/Debian box (GPU or fat-CPU). Run from the bot repo root:  bash harness/soak-setup.sh
# Then:  bash harness/soak-run.sh   (starts the dev server + runs harness/soak.mjs)
#
# Idempotent-ish: safe to re-run. Needs sudo for system packages (Playwright deps).
set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PR_DIR="${POKEROGUE_DIR:-$(dirname "$BOT_DIR")/pokerogue-src}"
PR_REPO="https://github.com/pagefaultgames/pokerogue.git"

echo "== bot repo:        $BOT_DIR"
echo "== pokerogue clone: $PR_DIR"

# 1. Node 20+ (via nodesource) + pnpm via corepack.
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]; then
  echo "== installing Node 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo corepack enable || npm i -g pnpm
echo "== node $(node -v), pnpm $(pnpm -v 2>/dev/null || echo '?')"

# 2. Bot repo deps + build + Playwright Chromium (with system deps).
echo "== installing bot deps + Playwright Chromium…"
cd "$BOT_DIR"
npm install
npx playwright install --with-deps chromium
node build.mjs

# 3. PokéRogue local build: clone + submodules (assets are ~800MB) + install.
if [ ! -d "$PR_DIR/.git" ]; then
  echo "== cloning PokéRogue (+ submodules, this pulls ~800MB of assets)…"
  git clone --recurse-submodules "$PR_REPO" "$PR_DIR"
else
  echo "== updating PokéRogue submodules…"
  git -C "$PR_DIR" submodule update --init --recursive
fi
cd "$PR_DIR"
pnpm install
# Offline/no-backend boot so the bot reaches the title without a login server.
grep -q VITE_BYPASS_LOGIN .env.development.local 2>/dev/null || echo "VITE_BYPASS_LOGIN=1" > .env.development.local

echo
echo "== setup complete."
echo "   Start the soak with:  bash harness/soak-run.sh"
echo "   GPU box? export SOAK_GL=egl first for real-FPS rendering."
