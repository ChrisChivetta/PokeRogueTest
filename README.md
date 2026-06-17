# PokéRogue Auto-Ribbon

An unattended bot that plays **PokéRogue Classic mode** and earns a **ribbon** (200-wave
clear, Eternamax Eternatus defeated) for every starter in your roster, in the fewest runs.
You walk away; it grinds ribbons.

It runs as a **single Tampermonkey userscript**. It is **input-only**: it reads the live
game state and drives the game through its own input layer. It **never writes a save value**
(no money/shiny/voucher edits) — that's the line that separates this from the save-editor
projects that warn about account flagging.

## Why it works (the core mechanics, verified against game source)

- **One Classic win ribbons every eligible mon in your final party at once.** So the minimum
  number of runs to ribbon `N` starters is `⌈N / 6⌉`.
- **Ribbons award to the *final* party**, not the start roster. A benched or even fainted mon
  still gets the ribbon as long as it's in the party at wave 200. → passengers don't have to
  fight; they just ride along.
- **Catching a species permanently unlocks its evolution line as a future starter.** Strong
  runs double-dip: ribbon 6 *and* unlock new carries.

Strategy: each run = **1 strong (cost-reduced) carry + up to 5 cheapest un-ribboned
passengers**, staying within the 10-point starter budget. ~4–5 fresh ribbons per win.

## ⚠️ Risk

This automates a **live pokerogue.net account**. PokéRogue is a free single-player fangame —
there's no money or competitive ladder — and the ecosystem's account-flagging warnings attach
to **save-data tampering**, which this tool does **not** do. It plays legitimately, just
without a human, with **human-paced inputs** (jittered delays, no superhuman cadence).

That said: there is **no published TOS carve-out for automation**, and a future anti-automation
measure could break the bot or flag the account. **Residual risk is yours to accept.** A
**kill-switch** and **dry-run mode** are built in; early phases never send an input at all.

If you'd rather not touch your live account, the same script runs against a **local clone** of
the open-source game — see *Local fallback*.

## Build

```bash
npm install
npm run build      # → dist/pokerogue-auto-ribbon.user.js
npm run watch      # rebuild on save
npm run typecheck  # tsc --noEmit
```

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open `dist/pokerogue-auto-ribbon.user.js`, copy its contents into a new userscript, save.
   (During development, point Tampermonkey at the file via a `@require file://…` or just paste
   after each build.)
3. Load <https://pokerogue.net>. A small HUD appears top-left.

## Current status — Phase 0 (observe-only)

The bot currently **only reads and reports** game state. It sends **zero inputs**
(`config.dryRun = true`, and no input layer is wired yet). This phase exists to prove the
state reads are correct on the live site before any input code runs.

Console API (open DevTools on the game tab):

```js
autoRibbon.snapshot()  // full typed state object, logged + returned
autoRibbon.ready()     // is the BattleScene reachable yet?
autoRibbon.stop()      // kill-switch — pause everything
autoRibbon.start()     // resume
autoRibbon.config      // live tunables (dryRun, logLevel, pacing, caps…)
```

**Verify Phase 0:** start a Classic run, then watch the HUD / call `autoRibbon.snapshot()`
across a wild battle, the FIGHT menu, a reward (MODIFIER_SELECT) screen, and a trainer fight.
The reported wave, your lead's HP %, the foe, party size, moves, and UI mode should match what's
on screen. If the HUD border turns **amber**, the scene isn't readable; **red** means stopped.

## Architecture

```
orchestrator  ── team selection, run sequencing, candy routing, ribbon tracking   (Phase 3)
policy        ── wave-range → action decision tables                              (Phase 2)
state.ts      ── typed read-only snapshot of the scene each tick                   (Phase 0 ✓)
input.ts      ── ui.processInput(Button.*) driver, cursor pathing, human pacing    (Phase 1)
bridge.ts     ── acquire BattleScene via Phaser CanvasPool — the one fragile seam  (Phase 0 ✓)
```

`bridge.ts` is the **only** version-fragile file: it reaches the game's `BattleScene` (a
module-only export, not on `window`) by walking Phaser's `CanvasPool`. If a game update changes
the scene shape, it breaks **here** and fails loud. `state.ts` reads every field defensively, so
minor API drift degrades to safe defaults rather than throwing. Re-check both — plus the game's
`game-over-phase.ts` (ribbon logic) — after any major PokéRogue patch.

## Local fallback

Clone the open-source game, run it locally, and the userscript's `@match http://localhost:8000/*`
picks it up — identical code path, zero account risk:

```bash
git clone https://github.com/pagefaultgames/pokerogue
cd pokerogue && npm ci && npm run start   # serves on localhost
```

## License

AGPL-3.0-only (matches the upstream game). This project is unaffiliated with the PokéRogue team.
