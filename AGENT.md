# Autonomous local-soak prompt

Copy everything in the fenced block below into a fresh `claude` session started on your Mac in the
repo root. It turns that session into a self-driving loop: run the bot, watch it via telemetry +
stall screenshots, diagnose loops/bad decisions, fix the code, commit, restart, repeat — no human
observation needed. Check on it whenever; it commits as it goes.

````text
You are running an autonomous improvement loop for this PokéRogue bot ON MY LOCAL MACHINE. I am
NOT watching — you are the observer. Read LOCAL.md first for how the harness works, then run this
loop until I stop you or the objective (every owned starter line ribboned) is complete.

GOAL: make the bot play Classic mode well enough to ribbon starters, by watching it run and fixing
the loops and bad decisions you observe. Work on branch `claude/vibrant-newton-iv3zlw`. Commit and
push each fix. Never push to another branch. The bot is INPUT-ONLY: never edit save data, dex, or
ribbon state to fake progress — only improve the play logic.

SETUP (once): confirm `../pokerogue-src` exists and deps are installed (see LOCAL.md). If not, do
the one-time setup from LOCAL.md before starting.

THE LOOP:
1. Start the soak in the BACKGROUND so you can keep working while it plays:
     SOAK_HEADED=1 SOAK_GL=auto SOAK_HOURS=2 SOAK_STALL_PAUSE=0 SOAK_LOG=soak-live.jsonl \
       bash harness/soak-run.sh
   (Headed+auto GL = real FPS, which matters — the bot misbehaves at low FPS. STALL_PAUSE=0 keeps
   it playing through a stall and writes one screenshot per stall episode.)
2. OBSERVE continuously by tailing soak-live.jsonl. Watch for these events:
     - "stall": the bot is wedged. Read the referenced stall-<ts>.png (you can view images) AND
       stall-<ts>.txt (telemetry + the exact last ~40 buttons it pressed). That's your diagnosis.
     - "pageerror": a thrown error — read the message, find the cause in src/.
     - "run-end" / "summary": depth + outcomes. A low median death wave or repeated early wipes is
       a strategy problem worth fixing even without a hard stall.
     - "ribbon-gained" / "objective-complete": progress / done.
   Also spot-check play quality from the "sample" records: `catchDecision` (why it did/didn't throw
   a ball), `ballsThrown`, `hpFrac`, `wave`, `mode`. If it's making a clearly bad recurring choice
   (skipping catchable new species, picking weak moves, not healing), treat that as a bug to fix.
3. DIAGNOSE + FIX: trace the issue to the bot source (src/policy.ts, catch.ts, typechart.ts,
   state.ts, shop.ts, etc.), make a targeted change, and ALWAYS validate before restarting:
     npm run typecheck && npx vitest run && node build.mjs
   Add or update a unit test that captures the bug when practical. If the fix touches the
   version-fragile game-reads (state.ts/bridge.ts) and `../pokerogue-src` is available, also run:
     bash harness/integration.sh
4. COMMIT + PUSH the fix with a clear message (end commit messages with the Co-Authored-By and
   Claude-Session trailers used in this repo's history).
5. RESTART the soak to pick up the rebuilt bundle: kill the background harness, then relaunch
   step 1. (The running browser holds the OLD bundle, so a code fix needs a fresh launch.)
6. Repeat. Keep a short running tally (waves reached, fixes made) so I can catch up at a glance.

JUDGMENT:
- A transient stall that clears itself on its own (the key advances) needs no fix — don't chase it.
- Intervene when a stall REPEATS on the same key, an error recurs, or play quality is clearly poor.
- Make focused fixes, not large refactors. If a fix would require an architectural change or you're
  genuinely unsure which of two behaviors I want, STOP and ask me rather than guessing.
- Never disable a test, weaken a safety cap, or fake ribbon progress to make a number go up.

Don't narrate every sample. Report when you make a fix, when the objective completes, or when you
hit something you need me to decide. Otherwise keep the loop running. Begin by reading LOCAL.md and
starting the soak.
````
