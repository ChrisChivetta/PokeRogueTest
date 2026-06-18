#!/bin/bash
# ── DigitalOcean droplet user-data (TEMPLATE) ────────────────────────────────
# Runs once as root on first boot. The launcher (harness/do-launch.sh) fills the @@...@@ markers
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
# DO installs your SSH key on root only — copy it to bot so `ssh bot@<ip>` works.
install -d -o bot -g bot -m 700 /home/bot/.ssh
cp /root/.ssh/authorized_keys /home/bot/.ssh/authorized_keys 2>/dev/null || true
chown bot:bot /home/bot/.ssh/authorized_keys 2>/dev/null || true
chmod 600 /home/bot/.ssh/authorized_keys 2>/dev/null || true

sudo -u bot -H bash <<'BOT'
set -x
cd "$HOME"
echo "=== clone + provision ==="
set +x   # SECRET: the clone URL carries the GitHub token — keep it out of the log
git clone "@@REPO@@" repo
set -x
cd repo
git checkout "@@BRANCH@@"
git config user.email "soak-bot@localhost"
git config user.name "soak-bot"
# Keep the token in the remote URL (this throwaway box needs it to PUSH its improvements). The
# token only lives in .git/config on this disposable box; destroying the droplet wipes it.

bash harness/soak-setup.sh   # Node deps, Playwright Chromium, PokéRogue clone+submodules+pnpm

echo "=== install Claude Code ==="
sudo npm install -g @anthropic-ai/claude-code

# Subscription token in a 600 file (not on the command line / not in ps / not in the log).
mkdir -p "$HOME/.config"
umask 077
set +x   # SECRET: don't echo the subscription token
printf 'export CLAUDE_CODE_OAUTH_TOKEN=%q\nunset ANTHROPIC_API_KEY\n' "@@CLAUDE_TOKEN@@" > "$HOME/.config/claude.env"
set -x

echo "=== launch autonomous Claude (attach: tmux attach -t claude) ==="
TASK='Read BOX.md and follow it exactly. Run soaks in the background (SOAK_HOURS=2 to start), diagnose from the telemetry (depth histogram, median death wave, per-run health/retry stats), make ONE focused strategy improvement at a time, prove it green (npm run typecheck && npm test && bash harness/integration.sh), re-soak to measure before/after, and commit each measured win to this branch with the delta in the message. Keep iterating autonomously. Stop and write a short RESULTS.md (and commit it) only when you hit a real blocker or have landed several measured improvements.'
tmux new-session -d -s claude "cd $HOME/repo && source $HOME/.config/claude.env && claude --dangerously-skip-permissions -p \"$TASK\" 2>&1 | tee $HOME/claude.out"
echo "=== claude launched ==="
BOT

echo "=== bootstrap done $(date) ==="
