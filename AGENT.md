# Autonomous local-soak prompt

Copy everything in the fenced block below into a fresh `claude` session started on your Mac in the
repo root. It turns that session into a self-driving loop: run the bot, watch it via telemetry +
stall screenshots, diagnose loops/bad decisions, fix the policy, and HOT-SWAP the fix into the
live browser without restarting it — the Phaser scene keeps running and the new policy takes over
at the exact wave/phase it stalled on. Check on it whenever; it commits as it goes.

````text
You are running an autonomous improvement loop for this PokéRogue bot ON MY LOCAL MACHINE. I am
NOT watching — you are the observer. Read LOCAL.md first for how the harness works, then run this
loop until I stop you or the objective (every owned starter line ribboned) is complete.

GOAL: make the bot play Classic mode well enough to ribbon starters, by watching it run and fixing
the loops and bad decisions you observe. Work on branch `claude/vibrant-newton-iv3zlw`. Commit and
push each fix. Never push to another branch. The bot is INPUT-ONLY: never edit save data, dex, or
ribbon state to fake progress — only improve the play logic.

KEY CAPABILITY — HOT POLICY RELOAD (resume in place):
The game engine and the decision policy are decoupled. The engine (the live Phaser BattleScene)
and your policy only touch through readState() in and press() out. That lets you REPLACE the
policy at runtime WITHOUT reloading the page: you edit src/policy.ts (or a pure sub-module it
imports — learnmove, typechart, shop, rewards, state, team, candy), rebuild ONLY the hot bundle,
and push it into the running browser. The scene keeps running; the next tick calls your new policy
and the run continues from the exact wave/phase it stalled on. No browser restart, no run lost.
  - SHARED SEAM: the hot policy shares the host's live singletons (config/input/bridge/catch/retry/
    roster) via globalThis.__hostSeam + src/seam-shims/. So counters, pacing, catch/retry budgets
    and the scene cache stay continuous across a swap. DON'T re-bundle those — the build already
    redirects them.
  - SAFETY: a broken patch never reaches the page (gates below), and even if one slipped through,
    the in-page registry validates the bundle and DISCARDS it on any error, keeping the prior
    good policy driving. A typo can't wedge or crash the soak.

SETUP (once): confirm `../pokerogue-src` exists and deps are installed (see LOCAL.md). If not, do
the one-time setup from LOCAL.md before starting.

THE LOOP:
1. Start the soak in the BACKGROUND with HOT RELOAD ENABLED so you can swap fixes in live:
     SOAK_HEADED=1 SOAK_GL=auto SOAK_HOURS=4 SOAK_STALL_PAUSE=0 SOAK_HOT_RELOAD=1 \
       SOAK_LOG=soak-live.jsonl bash harness/soak-run.sh
   (Headed+auto GL = real FPS, which matters — the bot misbehaves at low FPS. STALL_PAUSE=0 keeps
   it playing through a stall and writes one screenshot per stall episode. HOT_RELOAD=1 makes the
   soak watch for the policy-reload.signal file and live-swap when you drop it. Pick a long
   SOAK_HOURS — you no longer restart for each fix, so the same browser run absorbs many swaps.)
2. OBSERVE continuously by tailing soak-live.jsonl. Watch for these events:
     - "stall": the bot is wedged. Read the referenced stall-<ts>.png (you can view images) AND
       stall-<ts>.txt (telemetry + the exact last ~40 buttons it pressed). The telemetry now
       includes phase, cursor, awaitingActionInput, policyVersion, and recentPresses — that's your
       diagnosis.
     - "pageerror": a thrown error — read the message, find the cause in src/.
     - "policy-reload": the result of one of your hot swaps (ok + new version, or the rejection
       reason if a patch was bad). Confirm your fix actually landed here.
     - "run-end" / "summary": depth + outcomes. A low median death wave or repeated early wipes is
       a strategy problem worth fixing even without a hard stall.
     - "ribbon-gained" / "objective-complete": progress / done.
   Also spot-check play quality from the "sample" records: `catchDecision`, `ballsThrown`, `hpFrac`,
   `wave`, `mode`, `phase`, `policyVersion`. If it's making a clearly bad recurring choice, that's a
   bug to fix.
3. DIAGNOSE + FIX: trace the issue to the policy source (src/policy.ts and the pure modules it
   imports — learnmove.ts, typechart.ts, shop.ts, rewards.ts, state.ts, etc.), make a targeted
   change.
4. HOT-APPLY the fix into the LIVE soak with ONE command:
     node harness/hot-apply.mjs
   It (1) typechecks, (2) runs the policy tests, (3) rebuilds ONLY dist/policy.hot.js, then (4)
   drops the policy-reload.signal sentinel the running soak watches. Within ~5s the soak swaps the
   new policy in and resumes in place. Gates 1-2 mean a broken patch never reaches the browser; if
   one ever did, the in-page registry rejects it and keeps the last good policy. Add or update a
   unit test that captures the bug when practical (hot-apply runs the policy/learnmove/registry
   tests as a gate, so a new test both documents and guards the fix).
     - If your change touches a SHARED SEAM module (bridge/input/config/catch/retry/roster) or the
       host wiring (main.ts, host-seam.ts, build config), a hot swap is NOT enough — those live in
       the host bundle. Rebuild fully (`node build.mjs`) and RESTART the soak for those (rare).
     - If the fix touches the version-fragile game-reads (state.ts/bridge.ts) and `../pokerogue-src`
       is available, also run: bash harness/integration.sh
5. COMMIT + PUSH the fix with a clear message (end commit messages with the Co-Authored-By and
   Claude-Session trailers used in this repo's history). The browser already has the swapped policy;
   the commit just records it.
6. Repeat — same background soak keeps running across all your swaps. Keep a short running tally
   (waves reached, fixes made, current policyVersion) so I can catch up at a glance.

JUDGMENT:
- A transient stall that clears itself on its own (the key advances) needs no fix — don't chase it.
- Intervene when a stall REPEATS on the same key, an error recurs, or play quality is clearly poor.
- Make focused fixes, not large refactors. If a fix would require an architectural change or you're
  genuinely unsure which of two behaviors I want, STOP and ask me rather than guessing.
- Never disable a test, weaken a safety cap, or fake ribbon progress to make a number go up.

Don't narrate every sample. Report when you hot-apply a fix (with the new policyVersion), when the
objective completes, or when you hit something you need me to decide. Otherwise keep the loop
running. Begin by reading LOCAL.md and starting the soak with SOAK_HOT_RELOAD=1.
````
