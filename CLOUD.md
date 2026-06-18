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
2. **GitHub PAT** — read-only access to this private repo:
   ```bash
   export GITHUB_TOKEN=github_pat_...     # fine-grained, Contents:Read on chrischivetta/pokeroguetest
   ```
3. **Claude subscription token** — mint it from a machine where you're logged into Claude Max:
   ```bash
   claude setup-token                     # copy the printed token (valid ~1 year)
   export CLAUDE_CODE_OAUTH_TOKEN=...      # paste it
   ```

## Launch
```bash
bash harness/do-launch.sh
# cheaper/slower box:   DO_SIZE=c-8 bash harness/do-launch.sh
# different region:     DO_REGION=sfo3 bash harness/do-launch.sh
```
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
- **Cost:** `c-16` ≈ $0.95/hr, `c-8` ≈ $0.48/hr. A few hours is a few dollars — just destroy it.
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
