# Handoff — pickup note for the next session

This was started in a local session that couldn't run the game (no PokéRogue access on
that laptop, no Chrome extension connected). Continuing in a **cloud session on this repo**,
on a laptop that has the game + the Claude-in-Chrome extension connected.

## Reference docs (full context, in `docs/`)

- `docs/PLAN.md` — the complete approved implementation plan (architecture, phases, risk,
  verification). This is the authoritative spec.
- `docs/research-automation-tooling.md` — how existing bots work + the exact game interface
  (CanvasPool walk, BattleScene accessors, `ui.processInput`). Background for `bridge.ts`.
- `docs/research-classic-ribbon-mechanics.md` — source-verified Classic/ribbon mechanics
  (all-party ribbon award, final-party semantics, wave structure, starter cost).
- `docs/research-strategy.md` — carry tier list, the carry-and-swap loop, reward priority,
  unattended-reliability rules, and pseudocode. Feeds Phases 2–3 (`src/carries.ts`, policy).

## Where we are: Phase 0 LIVE-VERIFIED ✓; Phases 1–2 done; Phase 3 brain done

**Phase 0 is verified against real browser-rendered PokéRogue** (`npm run smoke` —
`harness/smoke.mjs` boots the local dev server build in Playwright Chromium, injects
`dist/…user.js`, and exercises the bridge). Confirmed on Phaser v3.90 / software WebGL:
scene acquired via the CanvasPool walk, `battleShaped`, `snapshot.ready`, and — the big one —
**UI-mode mapping has NO drift across all 48 live handlers** (mode 0→MESSAGE/BattleMessageUiHandler,
etc.). The two version-fragile assumptions in `bridge.ts` hold on a real build. To re-run after a
game update: start the dev server (`cd <pokerogue checkout> && VITE_BYPASS_LOGIN=1 npx vite --mode
development --host 127.0.0.1 --port 8000`), then `npm run smoke`. Still live-unverified: input
DRIVING and the title→starter-select EXECUTION glue (build them on this smoke harness next).

## Soak testing on a cloud box (the way to test full runs)

This dev container has no GPU → PokéRogue runs at 3-7 FPS, fine for validating UI-driving logic
but far too slow for full 200-wave clears / multi-run soak. To test further, run the bot against
the LOCAL build on a box with real FPS (a GPU box, or a fat-CPU box that hits ~20-30 FPS on
SwiftShader). No real account involved → no ToS/ban risk.

- `harness/soak-setup.sh` — provision a fresh Ubuntu box (Node 20, bot deps + build, Playwright
  Chromium, clone PokéRogue + submodules + `pnpm install`, offline-boot env).
- `harness/soak-run.sh` — start the dev server + run the soak. `SOAK_GL=egl` on a GPU box.
- `harness/soak.mjs` — boots the build headless, injects the bot, runs it for `SOAK_HOURS`
  (default 6) with retries on, and writes structured JSONL telemetry (`run-start`/`run-end`,
  `ribbon-gained`, `safety-halt-resume`, `crash-recover`, periodic `summary`, FPS) — auto-recovers
  from page crashes and safety halts so a long session survives hiccups. Final rollup: runs
  started/ended, max wave reached, ribbons gained, halts, crashes, errors.

Quickstart on the box: `bash harness/soak-setup.sh && SOAK_HOURS=8 SOAK_GL=egl bash harness/soak-run.sh`.
Review `soak-*.jsonl` (or the console `summary`/`FINAL` lines) for what the bot actually achieved.

## (historical) Phase 0 built, not yet live-verified

The plan is a 5-phase, MVP-first build of an unattended Classic-mode bot that ribbons every
starter. Full rationale + mechanics are in `README.md` and `docs/PLAN.md`. Roadmap below.

**Done (committed + pushed):**
- Userscript build: `npm run build` → `dist/pokerogue-auto-ribbon.user.js` (esbuild, single
  Tampermonkey bundle with banner).
- `src/bridge.ts` — acquires the game's `BattleScene` via the Phaser `CanvasPool` walk
  (`globalScene` is a module-only export, not on `window`). UI mode is resolved
  **handler-class-name-first** (robust to enum renumbering), with enum-translation fallback.
- `src/state.ts` — typed, **read-only**, defensively-read snapshot (wave, both parties, HP,
  moves+PP, types, status, UI mode, cursor, `awaitingActionInput`). Drift degrades to safe
  defaults instead of throwing.
- `src/main.ts` — observe-only loop: samples state each tick, logs a summary, renders a HUD,
  exposes `window.autoRibbon`. **Sends zero inputs** (`config.dryRun = true`; no input layer
  wired yet).
- Every game accessor used was verified against `pagefaultgames/pokerogue@main` (getPlayerParty,
  getEnemyParty, getPlayerField/getEnemyField, currentBattle, arena, money, pokeballCounts,
  ui.getMode/getHandler/processInput, handler.cursor, AwaitableUiHandler.awaitingActionInput).

**Not done:** the empirical "does the bridge read the LIVE scene correctly" test. That's the
whole point of Phase 0 and the next action.

## ▶ Do this first — verify Phase 0 (read-only, no inputs, no save writes)

1. Confirm Claude-in-Chrome is connected (`list_connected_browsers`).
2. Open <https://pokerogue.net>, signed in, and **start a Classic run**.
3. Build + load the userscript (or inject the read-code directly for a faster loop):
   `npm install && npm run build`, then load `dist/pokerogue-auto-ribbon.user.js` in Tampermonkey.
4. Verify the snapshot matches the screen across **4 states**: a wild battle, the **FIGHT** menu,
   a reward (**MODIFIER_SELECT**) screen, and a **trainer** fight. Check:
   - `wave` index correct; `uiMode` names the right screen (not `UNKNOWN`);
   - lead Pokémon name + HP %, the foe, party size, and the lead's moves+PP read correctly.
   - HUD border: amber = scene unreadable, red = stopped, purple = ok.
   Console: `autoRibbon.snapshot()`, `autoRibbon.ready()`, `autoRibbon.stop()/start()`.
5. **The load-bearing risk** is `getUiModeName()` returning `UNKNOWN` everywhere (would mean
   neither handler-name nor enum lookup worked on the live/minified build). If so, log the raw
   `ui.getMode()` numbers per screen and we'll map numbers→modes empirically, then harden the bridge.

Only after reads are confirmed do we wire inputs.

## Guardrails (do not regress)

- **Input-only. Never write a save value** (no money/shiny/voucher edits). That's the line that
  separates this from the save-editor projects that warn about account flagging.
- Keep `config.dryRun = true` until reads are verified; build Phase 1 behind it too.
- Human-paced inputs only (jittered delays, action cap). Kill-switch + hard caps stay.
- `bridge.ts` is the one version-fragile file — changes from a game patch belong there. Re-check
  `game-over-phase.ts` (ribbon logic) after any major upstream patch.

## Roadmap

- **Phase 0 ✓ built** — observe-only harness + scene bridge. *(verify live, then close)*
- **Phase 1 ✓ done** — input driver: `ui.processInput(Button.*)`, cursor pathing, human pacing,
  dryRun. Auto-advance dialogue + type-effective move-select, faint-switch. *(verified hands-off
  via the Tier-2 integration suite.)*
- **Phase 2 ✓ done** — full battle policy to wave 200: move-select (PP-aware, safe type-effective),
  switch (carry protection), catch (boss last-segment = unlock engine), rewards (priority table),
  and the wave-200 Eternatus clear. The whole stack clears Classic hands-off — see the capstone
  `tests/integration/classic-clear.test.ts` (beats both Eternatus phases incl. the Eternamax
  transformation, registers `sessionsWon`, and confirms the CLASSIC ribbon lands on the final
  party's dex line). No bespoke in-battle "endgame handler" was needed: the catch guard already
  stops at the End Biome, and the post-victory sequence (ending dialogue → EndCard → voucher
  rewards → PostGameOver) all flows through the message handler the bot already advances. The
  "never out-stat Eternamax — neutralize/outlast/type-wall" strategy is TEAM selection → Phase 3.
  - **Catch ✓ done** — `src/catch.ts` + COMMAND/BALL cases in `src/policy.ts`. Throws at NEW
    (un-caught) species only; mirrors the game's own ball-legality exactly (wild + single foe +
    not End Biome; bosses only on the last shield segment `bossSegmentIndex === 0`). Conserves
    premium balls (cheapest on wilds, up to Rogue on bosses; Master only as last resort), caps
    throws per target (`config.catchAttemptsPerTarget`, then KOs). State reads `isBoss`/
    `bossSegmentIndex`/`speciesCaught` (dex `caughtAttr`). Tests: `tests/catch.test.ts` (unit) +
    `tests/integration/catch.test.ts` (catches a wild + a last-segment boss in the headless game).
  - **Reward priority ✓ done** — `src/rewards.ts` + `handleReward` in `src/policy.ts`. Picks the
    free reward most valuable to finishing a run by a curated priority over `ModifierType.id`
    (survival held items > permanent progression > one-shot heals > junk), with a tier-based
    fallback for unlisted items. Navigates the modifier screen's 2-D grid (rowCursor 1 = rewards
    row) to the best column. Status orbs score negative → the whole reward is skipped (CANCEL →
    accept the "skip?" confirm) rather than self-inflicted. Tests: `tests/rewards.test.ts` (unit)
    + `tests/integration/rewards.test.ts` (picks Leftovers over Potions; skips a lone Toxic Orb).
  - **Classic clear ✓ done** — `tests/integration/classic-clear.test.ts`: the full policy clears
    the wave-200 Eternatus fight hands-off and awards the Classic ribbon. Phase 2 complete.
- **Phase 3** — orchestration: team auto-select (lowest-cost Tier-S carry + Eternatus answer +
  cheapest un-ribboned passengers to cost 10), run sequencing, candy routing (reduce carry cost
  first), ribbon tracking, safety. *Verify: N unattended clears, +~4–5 ribbons/clear.*
  - **Planning core ✓ done** — all PURE + unit-tested. `src/team.ts` `selectTeam()` (carry +
    cheapest un-ribboned passengers under the 10-pt budget; `CARRY_RANK` shortlist),
    `src/orchestrator.ts` `planRun()` (progress + done-detection + next team), `src/candy.ts`
    `planCandy()` (route a species' candy into cost reductions, carries first; table from
    `data/balance/starters.ts`). `src/roster.ts` reads the live gameData into these
    (`readRoster`/`readCandyStarters` — owned starters, effective+base cost, ribbon status,
    candy/valueReduction). Tests: `tests/{team,orchestrator,candy}.test.ts` +
    `tests/integration/roster.test.ts` (against real headless gameData).
  - **Run-loop router ✓ done** — `src/runloop.ts` `decideLoopAction()` routes each screen to
    PLAY / START_RUN / SELECT_TEAM / STOP_DONE / WAIT (`inRun` disambiguates the shared
    OPTION_SELECT/CONFIRM/MESSAGE modes); `src/main.ts` `tick()` dispatches, routing the whole
    `SelectStarterPhase` to the team driver by phase name. Pure parts unit-tested.
  - **Execution glue ✓ LIVE-VALIDATED** — `src/execution.ts`. `driveStartRun()` navigates the
    title flow (intro → gender → New Game → Classic) and `driveStarterSelect()` enacts the team:
    scans the real 9-col starter grid (reading `filteredStarterContainers[cursor]`), adds each
    planned species, then SUBMITs through the confirm-start + save-slot to begin the run. Proven
    end-to-end on the live harness (`npm run smoke:full`): the bot autonomously goes title →
    builds its planned team on the grid → **starts a Classic run at wave 1** with a non-empty
    party. Two live-found bugs fixed: slow one-step grid nav (now batches 8 steps/call) and a
    SUBMIT mash that restarted the (mode-less) confirm-start message before its CONFIRM could open
    (now a 3s submit cooldown). GameManager can't test any of this (upstream's own starter-select
    UI test is `describe.todo`), so the smoke harness IS the test.
  - **Safety + progress ✓ done** — `src/safety.ts` `checkRunSafety()` halts (kill-switch) a wedged
    run (a wave running > `config.maxTurnsPerWave`, or a run over `maxWallClockPerRunMs`); `tick()`
    logs deduped ribbon progress at the title. Unit-tested.
  - **Retry strategy ✓ done** — `src/retry.ts` + `tick()` + the FIGHT case. With the game's
    retry-on-defeat setting ON, a loss prompts a replay; the bot accepts up to
    `config.maxRetriesPerWave` retries and VARIES its line each generation — `typechart.rankedMoves`
    + `retryGeneration()` pick the Nth-best move on the Nth retry, so it isn't the same losing line.
    Budget resets on progress to a new wave. Unit-tested (`tests/retry.test.ts`).
  - **Server-down resilience ✓ done** — `runloop.isServerTrouble()` flags the connection screens
    (UNAVAILABLE / SESSION_RELOAD / LOGIN_*); the bot idles and lets the game's auto-reconnect (the
    Unavailable modal backs off exponentially) recover — never mashing. Unit-tested.
  - **Candy application ⚠ experimental (off)** — `config.applyCandyReductions` (default false). The
    `planCandy` DECISIONS are correct + unit-tested, but reliably driving the "Use Candies" →
    "Reduce Cost" sub-menus on the live grid is still flaky (six harness iterations: the cursor
    reaches the target but the per-mon menu won't open from the initial cursor — a `setSpecies`/
    focus quirk that needs fresh instrumentation). The candy phase safely falls through, so the
    loop is unaffected. Re-enable + finish driving it as a follow-up.
- **Phase 4** — hardening: edge cases (doubles, odd encounters, shop variants), recovery from a
  lost run, local-instance fallback (`@match localhost`). *Verify: long unattended session.*
  - **Mystery encounters ✓ done** — detection (UI mode `MYSTERY_ENCOUNTER`) + resolution in
    `src/policy.ts`. All 30 encounter types curated from game source to the most run-favorable,
    no-stall option (`FAVORABLE_ME_OPTION`): heal > free reward > safe leave > easiest winnable
    battle; never sacrifices/trades/transforms a party member. Requirement-gated options fall
    back automatically; secondary party/sub-option selects (e.g. Field Trip) are driven via the
    PARTY `SELECT` + `OPTION_SELECT` cases. Covered by `tests/integration/mystery.test.ts`.

## Core mechanics (verified against game source — these justify the whole approach)

- **One Classic win ribbons every eligible mon in the final party at once** → min runs = `⌈N/6⌉`.
- Ribbons award to the **final party**, not the start roster; **benched/fainted still count** →
  passengers just ride to wave 200.
- **Catching a species permanently unlocks its evo line as a future starter** → strong runs
  double-dip (ribbon 6 + unlock carries).

## Carry shortlist (strong without egg moves — Phase 2/3 `src/carries.ts`)

Skeledirge/Torch Song (top budget pick), Sneasler/Dire Claw (status spam),
Garganacl/Salt Cure + Purifying Salt (near-unkillable), Venusaur/Leech Seed (Eternatus counter),
Maushold + Skill Link + Multi-Lens (nuke). **Avoid** 10-cost box legends — they leave no passenger
room. Reward priority: Reviver Seed > Leftovers/Shell Bell > Focus Sash > EXP/Lucky Egg >
Amulet Coin > resist berries > Multi-Lens (nukes only) > Soothe Bell (candy farming).
