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

## Where we are: Phase 0 built, NOT yet live-verified

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
- **Phase 1** — input driver: `ui.processInput(Button.*)`, cursor pathing, human pacing,
  dryRun. First inputs: auto-advance dialogue + auto-select type-effective move. *Verify: clears
  waves 1–10 hands-off.*
- **Phase 2** — full battle policy to wave 200: move-select (PP-aware, safe type-effective),
  switch (carry protection), catch (boss last-segment = unlock engine), rewards (priority table),
  Eternatus handler (190–200; never out-stat Eternamax — neutralize/outlast/type-wall). *Verify:
  one full clear, then read `dexData[].ribbons` and confirm every final-party line flipped.*
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
  - **Still open in Phase 2:** the Eternatus/endgame finisher (waves 190–200).
- **Phase 3** — orchestration: team auto-select (lowest-cost Tier-S carry + Eternatus answer +
  cheapest un-ribboned passengers to cost 10), run sequencing, candy routing (reduce carry cost
  first), ribbon tracking, safety. *Verify: N unattended clears, +~4–5 ribbons/clear.*
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
