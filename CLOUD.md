# CLOUD.md — launch a self-running soak box on DigitalOcean

Stands up a throwaway DigitalOcean droplet that provisions the local PokéRogue build and turns a
**headless Claude session (your Max subscription)** loose on `BOX.md` to soak-test and improve the
bot autonomously — at real FPS. You run the launcher from your machine; **your credentials never
leave it** (they go straight into the droplet's user-data).

## One-time prep on your machine
1. **doctl**, authed, with an SSH key registered (so you can attach):
   ```bash
   doctl auth init
   doctl compute ssh-key list            # must show at least one key
   ```
2. **GitHub PAT** — **Contents: Read AND Write** on this private repo (the box clones *and* pushes
   its improvements back):
   ```bash
   export GITHUB_TOKEN=github_pat_...     # fine-grained, Contents:Read+Write on chrischivetta/pokeroguetest
   ```
3. **Claude subscription token** — mint it from a machine where you're logged into Claude Max:
   ```bash
   claude setup-token                     # copy the printed token (valid ~1 year)
   export CLAUDE_CODE_OAUTH_TOKEN=...      # paste it
   ```

## Launch
```bash
bash harness/do-launch.sh
# default size is s-8vcpu-16gb (basic, works on new accounts, ≈$0.18/hr)
# more FPS (needs a higher account tier):  DO_SIZE=c-16 bash harness/do-launch.sh
# smaller/cheaper:                          DO_SIZE=s-4vcpu-8gb bash harness/do-launch.sh
# different region:                         DO_REGION=sfo3 bash harness/do-launch.sh
```
> **422 "size is currently restricted"?** Your account tier can't launch that size yet (common on
> new accounts for the `c-*` CPU-optimized droplets). Use a basic `s-*` size (the default already
> is one); `doctl compute size list` shows what's available.
The droplet boots, clones this branch, runs `soak-setup.sh`, installs Claude Code, and starts the
autonomous loop. First boot ~10–15 min (the 800MB asset pull dominates).

## Watch / attach
```bash
ssh bot@<ip> 'tail -f /var/log/soak-bootstrap.log'   # provisioning
ssh bot@<ip> 'tail -f ~/claude.out'                  # what Claude is doing
ssh bot@<ip> -t 'tmux attach -t claude'              # jump into the live session
ssh bot@<ip> 'cd ~/repo && git log --oneline -10'    # measured wins land as commits on the branch
```
Claude commits each improvement to `claude/vibrant-newton-iv3zlw` and writes a `RESULTS.md` when it
stops. Pull the branch here to review.

## When done — DESTROY IT
```bash
doctl compute droplet delete pokerogue-soak-<name>   # the launcher prints the exact name
```
This stops billing **and** wipes the tokens that live in the droplet's user-data/metadata.

## Cost & security notes
- **Cost:** `s-8vcpu-16gb` ≈ $0.18/hr (default), `s-4vcpu-8gb` ≈ $0.07/hr, `c-16` ≈ $0.95/hr (if
  your tier allows it). A few hours is a couple dollars — just destroy it.
- **Tokens in metadata:** the GitHub PAT and Claude token sit in the droplet's user-data while it
  lives. That's why the box is throwaway and single-user; destroying it removes them. The clone
  token is also stripped from `.git/config` right after cloning. You can revoke either token after
  (rotate the PAT; re-run `claude setup-token` invalidates… no — it mints a new one, so just don't
  reuse the old token elsewhere). Subscription billing, not per-token API.
- **Autonomy:** the box runs `claude --dangerously-skip-permissions` so it can act unattended. It's
  scoped by `BOX.md` (input-only guardrails, which files are safe to touch, when to stop). Safe
  *because* the box is isolated and disposable — never point this token at a machine you care about.
- **Untested against live DO from here** (this session has no DO access): watch the first
  `soak-bootstrap.log` — if a step fails it's logged there. Ping me with that log and I'll fix it.
