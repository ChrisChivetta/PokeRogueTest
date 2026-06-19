# Local dev loop (watch it play, fix, repeat)

The fast iteration loop: run the bot on **your Mac** in a visible browser at real FPS, watch it,
and when it wedges the harness auto-screenshots + pauses so you can hand the picture to Claude.
Claude edits + commits; you pull + re-run. No cloud box, no lag.

## One-time setup

You need the PokéRogue source checked out next to this repo and its deps installed.

```bash
# from the bot repo root (…/PokeRogueTest)
brew install node pnpm            # if you don't already have them
npm install                       # bot deps
npx playwright install chromium   # the browser the harness drives

# PokéRogue itself (sibling dir ../pokerogue-src, ~800MB of assets)
git clone --recurse-submodules https://github.com/pagefaultgames/pokerogue.git ../pokerogue-src
( cd ../pokerogue-src && pnpm install && echo "VITE_BYPASS_LOGIN=1" > .env.development.local )
```

(If you set this up on your Mac before, you can skip straight to the loop.)

## The loop

```bash
git pull                                              # 1. get Claude's latest fixes
SOAK_HEADED=1 SOAK_GL=auto SOAK_HOURS=1 \             # 2. watch it play (visible window, real GPU)
  bash harness/soak-run.sh
```

`soak-run.sh` rebuilds the bot, starts the local dev server, opens a Chromium window, and turns
the bot loose. You'll see the game play itself. Telemetry streams to `soak-<timestamp>.jsonl`.

**When it gets stuck in a loop**, the watchdog (default: no progress for 60s) kicks in:

- writes `stall-<timestamp>.png` (a screenshot of the wedged screen)
- writes `stall-<timestamp>.txt` (telemetry + the last ~40 buttons the bot pressed)
- **pauses the bot** so the screen holds still
- prints a `!! STALL` banner in the terminal

Then: **drag the `stall-*.png` into the Claude chat and paste the `stall-*.txt`.** That screenshot +
button log is everything Claude needs to see what it's looping on. Claude fixes it, commits, and
you go back to step 1.

## Useful knobs

| Env var | Default | What it does |
|---|---|---|
| `SOAK_HEADED` | `0` | `1` = visible window (use this so you can watch) |
| `SOAK_GL` | `swiftshader` | `auto` on a Mac (real GPU); leave default on Linux |
| `SOAK_HOURS` | `6` | how long to run before stopping |
| `SOAK_STALL_SECS` | `60` | flag a stall after this many seconds of no progress |
| `SOAK_STALL_PAUSE` | `1` | `0` = log stalls but keep playing (don't pause) |
| `SOAK_HUMAN_PACING` | `0` | `1` = shipped human-speed input; `0` = brisk |

## Poke at the live game yourself

In the headed window, open DevTools (`Cmd-Opt-I`) → Console and use the bot's API directly:

```js
autoRibbon.telemetry()   // wave, party HP, ballsThrown, catchDecision, ribbon progress
autoRibbon.snapshot()    // full game-state read
autoRibbon.stop()        // pause      autoRibbon.start()  // resume
```

`catchDecision` in particular tells you *why* it did/didn't throw a ball this turn — handy for the
"is it actually catching?" questions.
