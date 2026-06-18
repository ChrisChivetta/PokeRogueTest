#!/bin/bash
# ── DigitalOcean droplet user-data (TEMPLATE) ────────────────────────────────
# Runs once as root on first boot. The launcher (harness/do-launch.sh) fills the @@…@@ markers
# from YOUR machine, so secrets never touch the bot author's session. It: provisions deps + the
# local PokéRogue build, installs Claude Code, and turns a headless Claude session loose on BOX.md
# to soak-test and iterate on strategy autonomously. Everything is logged for debugging.
#
# Markers filled by the launcher: @@REPO@@ (authed clone URL), @@BRANCH@@, @@CLAUDE_TOKEN@@.
set -x
exec > /var/log/soak-bootstrap.log 2>&1
echo "=== bootstrap start $(date) ==="

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl build-essential tmux ca-certificates sudo
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Claude's --dangerously-skip-permissions refuses to run as root, so do everything as 'bot'.
id bot &>/dev/null || useradd -m -s /bin/bash bot
echo "bot ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/bot

sudo -u bot -H bash <<'BOT'
set -x
cd "$HOME"
echo "=== clone + provision ==="
git clone "@@REPO@@" repo
cd repo
git checkout "@@BRANCH@@"
git remote set-url origin https://github.com/chrischivetta/pokeroguetest.git  # drop the token from .git/config

bash harness/soak-setup.sh   # Node deps, Playwright Chromium, PokéRogue clone+submodules+pnpm

echo "=== install Claude Code ==="
sudo npm install -g @anthropic-ai/claude-code

# Subscription token in a 600 file (not on the command line / not in ps).
mkdir -p "$HOME/.config"
umask 077
printf 'export CLAUDE_CODE_OAUTH_TOKEN=%q\nunset ANTHROPIC_API_KEY\n' "@@CLAUDE_TOKEN@@" > "$HOME/.config/claude.env"

echo "=== launch autonomous Claude (attach: tmux attach -t claude) ==="
TASK='Read BOX.md and follow it exactly. Run soaks in the background (SOAK_HOURS=2 to start), diagnose from the telemetry (depth histogram, median death wave, per-run health/retry stats), make ONE focused strategy improvement at a time, prove it green (npm run typecheck && npm test && bash harness/integration.sh), re-soak to measure before/after, and commit each measured win to this branch with the delta in the message. Keep iterating autonomously. Stop and write a short RESULTS.md (and commit it) only when you hit a real blocker or have landed several measured improvements.'
tmux new-session -d -s claude "cd $HOME/repo && source $HOME/.config/claude.env && claude --dangerously-skip-permissions -p \"$TASK\" 2>&1 | tee $HOME/claude.out"
echo "=== claude launched ==="
BOT

echo "=== bootstrap done $(date) ==="
