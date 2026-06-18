#!/usr/bin/env bash
# ── Launch a DigitalOcean soak box (run this on YOUR machine) ─────────────────
# Your credentials stay here — they go straight into the droplet's user-data, never to anyone else.
#
# Prereqs:
#   • doctl installed + authed:        doctl auth init
#   • an SSH key registered with DO:    doctl compute ssh-key list   (so you can attach later)
#   • a GitHub PAT (read-only) for the private bot repo  →  export GITHUB_TOKEN=github_pat_...
#   • a Claude subscription token       →  run `claude setup-token` on your logged-in machine,
#                                            then  export CLAUDE_CODE_OAUTH_TOKEN=...
# Optional: DO_SIZE (default s-8vcpu-16gb basic ≈ $0.18/hr, works on new accounts; bump to a
#           CPU-optimized c-16/c-8 for more FPS once your account tier allows it),
#           DO_REGION (default nyc3), REPO, BRANCH.
set -euo pipefail

: "${GITHUB_TOKEN:?export GITHUB_TOKEN (read-only PAT for the private repo)}"
: "${CLAUDE_CODE_OAUTH_TOKEN:?export CLAUDE_CODE_OAUTH_TOKEN (from: claude setup-token)}"

SIZE="${DO_SIZE:-s-8vcpu-16gb}"
REGION="${DO_REGION:-nyc3}"
IMAGE="ubuntu-22-04-x64"
BRANCH="${BRANCH:-claude/vibrant-newton-iv3zlw}"
OWNER_REPO="${REPO:-chrischivetta/pokeroguetest}"
CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${OWNER_REPO}.git"
NAME="pokerogue-soak-$(date +%s)"
TMPL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/do-bootstrap.tmpl.sh"

SSH_KEYS="${DO_SSH_KEY:-$(doctl compute ssh-key list --no-header --format FingerPrint | paste -sd, -)}"
[ -n "$SSH_KEYS" ] || { echo "No DO SSH key found — add one so you can attach: doctl compute ssh-key import"; exit 1; }

# Fill the template (| delimiter; tokens are alnum/-_. so they won't collide). Secrets only ever
# live in this temp file on your machine + the droplet's user-data.
USERDATA="$(mktemp)"; trap 'rm -f "$USERDATA"' EXIT
sed -e "s|@@REPO@@|${CLONE_URL}|g" \
    -e "s|@@BRANCH@@|${BRANCH}|g" \
    -e "s|@@CLAUDE_TOKEN@@|${CLAUDE_CODE_OAUTH_TOKEN}|g" \
    "$TMPL" > "$USERDATA"

echo "Launching $NAME — $SIZE in $REGION (branch $BRANCH)…"
doctl compute droplet create "$NAME" \
  --image "$IMAGE" --size "$SIZE" --region "$REGION" \
  --ssh-keys "$SSH_KEYS" --user-data-file "$USERDATA" --wait \
  --format ID,Name,PublicIPv4,Status

IP="$(doctl compute droplet get "$NAME" --format PublicIPv4 --no-header)"
cat <<EOF

Launched. The box is provisioning (clone → setup → soak → Claude); first boot takes ~10-15 min.
  watch setup:    ssh bot@$IP 'tail -f /var/log/soak-bootstrap.log'
  watch Claude:   ssh bot@$IP 'tail -f ~/claude.out'   (or: tmux attach -t claude)
  soak results:   ssh bot@$IP 'ls ~/repo/soak-*.jsonl; tail ~/repo/RESULTS.md'

DESTROY WHEN DONE (stops billing + wipes the tokens in metadata):
  doctl compute droplet delete $NAME
EOF
