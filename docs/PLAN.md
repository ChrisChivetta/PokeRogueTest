# PokéRogue Auto-Ribbon Library — Implementation Plan

## Context

**Goal:** Build a library that plays PokéRogue **Classic mode unattended** and earns a **ribbon** (200-wave clear, defeating Eternamax Eternatus) for **every starter** in your roster, in the **fewest runs possible**. You walk away; it grinds ribbons.

**Why this is tractable — the decisive facts (all verified against the game's own source, `pagefaultgames/pokerogue` `main`):**

1. **One Classic win ribbons ALL eligible mons in your final party simultaneously.** `game-over-phase.ts` → `awardRibbons()` loops the entire `getPlayerParty()`. So minimum runs = **⌈N / 6⌉** where N = un-ribboned lines. This single fact is the whole optimization.
2. **Ribbons award to the FINAL party, not the start roster.** A mon caught mid-run that's in your party at wave 200 gets ribboned; a fainted-but-still-present mon gets ribboned; a **benched** passenger gets ribboned. Passengers only need to *survive on the bench to wave 200* — they don't have to fight.
3. **Catch = permanent starter unlock.** Catching any species adds its whole evo line to your future roster. Strong runs double-dip: ribbon 6 + unlock new carries.
4. **The clean interface works on live pokerogue.net.** The game is a single `<canvas>` (Phaser 3), so DOM-button bots are dead (this is why the one existing "autoplay" userscript is broken). But scene access via the Phaser CanvasPool *does* work on the live site — confirmed by the working modmenu/type-helper userscripts that read the live scene. You read real game objects and drive the game through its **own input layer** (`scene.ui.processInput(Button.*)`).
5. **No existing project solves this.** The toy bots OCR-scrape (brittle) or click non-existent DOM buttons (broken); the one serious bot (FrederikHartung) is an RL *training* harness for early waves against a self-hosted instance, with no wave-200 policy. **The 200-wave decision policy is the real, unsolved work** — and your differentiation.

**Your parameters (from planning):** target = **live pokerogue.net account**; account state = **lots of progress** (cost-reduced carries + egg moves available, so no heavy bootstrap needed); deliverable = **full library, phased, MVP-first**.

---

## ⚠️ Risk acknowledgment (read before building)

You chose the live account. Honest assessment:
- **This is against the grain of how these tools are built.** The reference bot explicitly targets a *local* instance. We're driving the live site instead.
- **The flagging warnings in the ecosystem attach to SAVE-DATA TAMPERING** (the editor projects that write money/shinies/vouchers to the server) — **not** to input automation. This library will be **input-only: it never writes a single save value.** It plays the game legitimately, just without a human. That is a materially lower-risk category, but **not zero risk** — there is no published TOS carve-out, and a future anti-automation measure could break it or flag the account.
- **Mitigations baked into the design:** pure input driving (zero save writes), human-like action pacing with jitter (no superhuman input cadence), a global kill-switch + hard turn/time caps, and a "dry-run / observe-only" mode for the entire MVP so we validate reads before ever sending an input.
- **Decision already made** — proceeding on live. If at any phase the live site proves hostile to scene access or input, the same code runs against a local clone with a one-line config change (the fallback is built in, not bolted on).

---

## Architecture

**Single in-page userscript** (Tampermonkey/Violentmonkey), TypeScript compiled to one bundle. No Selenium, no OCR, no backend. Layered so each layer is independently testable:

```
┌─ orchestrator (meta-loop) ── team selection, run sequencing, candy routing, progress tracking
├─ policy engine ──────────── wave-range → action decision tables (the hard part)
├─ game-state reader ──────── typed snapshot of scene each tick (read-only)
├─ input driver ───────────── ui.processInput(Button.*) + cursor pathing, human-paced
└─ scene bridge ───────────── acquire BattleScene via CanvasPool; the one fragile seam
```

### Layer 1 — Scene bridge (`src/bridge.ts`)
The only version-fragile seam; isolate it so a game update only touches this file.
- Acquire scene: walk `Phaser.Display.Canvas.CanvasPool.pool` → `.parent.game.scene.scenes` → find the `BattleScene` (the one with `currentBattle`/`getPlayerParty`). `globalScene` is a module-only export (not on `window`), so the CanvasPool walk is the access path.
- Expose a thin typed handle; **fail loud** with a clear error if the scene shape changed (game updated).

### Layer 2 — Game-state reader (`src/state.ts`)
Read-only typed snapshot per tick. Confirmed real `BattleScene` API:
- Battle: `scene.currentBattle.{waveIndex, turn, double, battleType, trainer, enemyParty, battleSpec}`
- Parties: `scene.getPlayerParty()`, `getEnemyParty()`, `getPlayerField(true)`, `getEnemyField(true)` (per-mon: HP, moves+PP, types, status, level, ability)
- Context: `scene.arena.biomeType`, `scene.modifiers`, `scene.money`, `scene.pokeballCounts`
- **UI mode (critical for the input state machine):** `scene.ui.getMode()` → `UiMode` enum (COMMAND / FIGHT / BALL / MODIFIER_SELECT / PARTY / etc.), `ui.getHandler()`, `handler.cursor`.

### Layer 3 — Input driver (`src/input.ts`)
- Drive via **`scene.ui.processInput(Button.ACTION | UP | DOWN | LEFT | RIGHT | CANCEL)`** — the game's native input abstraction. Far more robust than synthetic `KeyboardEvent`s or DOM clicks.
- Cursor pathing: given current `handler.cursor` and a target index, emit the minimal Button sequence to move+confirm.
- **Human pacing:** every input wrapped in a jittered delay (e.g. 150–600ms randomized); a max-actions-per-second cap; never instantaneous menu traversal. This is both an anti-flag measure and avoids racing the game's animation/await states (`handler.awaitingActionInput`).
- A `dryRun` flag that logs intended inputs without sending them (used through all of MVP validation).

### Layer 4 — Policy engine (`src/policy/`)
The unsolved core. A **decision table keyed by wave-range + UI mode + board state**, not ML (deterministic, debuggable, tunable — an RL policy is a possible later upgrade, not the MVP). Sub-modules:
- `move-select.ts` — pick highest-value **safe** move: type-effective STAB / status / chip; account for PP; never pick a move that KOs your own setup. Type-effectiveness computed from the mon's own type data in the state snapshot.
- `switch.ts` — switch out a mon in a bad matchup / low HP if a better bencher exists (carry-protection logic).
- `catch.ts` — at every boss, chip to **last health segment**, then throw a ball if it's a **new species** (unlock engine). Stop catching in End Biome (191–200, mostly uncatchable).
- `rewards.ts` — reward/shop pick priority (rank order): **Reviver Seed > Leftovers/Shell Bell > Focus Sash > EXP/Lucky Egg > Amulet Coin > resist berries > Multi-Lens (nukes only) > Soothe Bell (candy farming)**.
- `eternatus.ts` — waves 190–200 handler: stop catching, shift to defensive items, ensure the **Eternatus answer** is deployed at 200. Never out-stat Eternamax (it self-buffs as you break shields) — **neutralize** (Topsy-Turvy Malamar), **outlast** (Leech Seed / Salt Cure + recovery), or **type-wall** (Steel/Fairy, immune to its STABs).

### Layer 5 — Orchestrator / meta-loop (`src/orchestrator.ts`)
Runs across runs, unattended:
- **Team selection:** `carry = lowest-effective-cost owned Tier-S carry` + ensure an **Eternatus answer** is present + fill remaining slots with the **cheapest un-ribboned lines** until cost == 10. (Your "lots of progress" means cost-reduced carries already exist — this works from run 1.)
- **Carry tier list** (strong without egg moves, since base kits carry them): **Skeledirge/Torch Song** (top budget pick), **Sneasler/Dire Claw** (status spam), **Garganacl/Salt Cure+Purifying Salt** (near-unkillable), **Venusaur/Leech Seed** (canonical Eternatus counter), **Maushold+Skill Link+Multi-Lens** (nuke). **Avoid** burning a run on a 10-cost box legend — it leaves no passenger slots.
- **Run sequencing:** 1 carry + up to 5 cheapest un-ribboned passengers per run → ~4–5 fresh ribbons/run.
- **Candy routing (post-run):** funnel candy into **reducing the carry's cost first** (every point shaved = one more passenger/run). Soothe Bell on the carry early to accelerate candy.
- **Progress tracking:** read `dexData[].ribbons` to know who's ribboned; recompute the cheapest un-ribboned set each run; persist a local progress log.
- **Safety:** global kill-switch (hotkey + stop-on-error), hard caps (max turns/wave, max wall-clock/run), auto-pause on any unexpected `UiMode` the policy doesn't recognize.

---

## Build phases (each independently verifiable)

**Phase 0 — Harness skeleton + scene bridge (observe-only).**
Userscript loads on pokerogue.net, acquires the BattleScene via CanvasPool, and **logs a live state snapshot every tick** (wave, party HP/moves, UI mode). `dryRun=true`, zero inputs. → *Verify: the snapshot matches what's on screen, across battle/menu/reward states.* This proves the interface works on the live site before we touch inputs.

**Phase 1 — Input driver MVP.**
Implement `processInput` driving + cursor pathing + human pacing. First real inputs: **auto-advance dialogs** and **auto-select a move** (type-effective pick) through the early waves. → *Verify: bot clears waves 1–10 of a Classic run hands-off, picking sane moves.*

**Phase 2 — Full battle policy (single run to wave 200).**
Move-select + switch + catch + rewards + the Eternatus handler. Run a single Classic clear end-to-end with a strong cost-reduced carry. → *Verify: completes wave 200, defeats Eternamax, hits CLASSIC_VICTORY — watch one full run.*

**Phase 3 — Meta-loop / ribbon orchestration.**
Team auto-selection (carry + cheapest un-ribboned passengers), run sequencing, candy routing, ribbon-progress tracking, safety caps. → *Verify: bot runs N consecutive Classic clears unattended; confirm `dexData[].ribbons` count increases by ~4–5 per clear and the un-ribboned set shrinks correctly.*

**Phase 4 — Hardening.**
Edge cases (double battles, unusual encounters, shop/menu variants), recovery from a failed run (start a fresh Classic), bad-luck mitigation tuning, local-instance fallback config. → *Verify: leave it running for many runs; it self-recovers from losses and keeps farming ribbons.*

---

## Critical files (new library)
```
pokerogue-auto-ribbon/
├─ src/bridge.ts          # scene acquisition (the fragile seam — isolate game-version coupling here)
├─ src/state.ts           # typed read-only state snapshot
├─ src/input.ts           # processInput driver + cursor pathing + human pacing + dryRun
├─ src/policy/
│  ├─ move-select.ts      # safe type-effective move choice (PP-aware)
│  ├─ switch.ts           # carry protection / matchup switching
│  ├─ catch.ts            # boss last-segment catch = unlock engine
│  ├─ rewards.ts          # reward/shop pick priority table
│  └─ eternatus.ts        # wave 190–200 + Eternamax handler
├─ src/orchestrator.ts    # team selection, run sequencing, candy routing, progress, safety
├─ src/carries.ts         # carry tier list + Eternatus-answer registry (data, easily edited)
├─ userscript.meta.ts     # Tampermonkey banner (@match pokerogue.net + local fallback)
└─ README.md              # setup, risk notes, kill-switch, local-fallback instructions
```

## Reference (best existing code to study — do NOT copy save-editing projects)
- **FrederikHartung/pokeRogueBot** — the only serious autoplayer; its TS bridge (`src/main/ts/util.ts`, `wave.ts`, `uihandler.ts`) is the best reference for the exact CanvasPool walk, the real `BattleScene` accessors, and `ui.processInput(Button.*)`. (Its RL backend and Selenium transport we do **not** need.)
- Game source of truth: `pagefaultgames/pokerogue` — `src/global-scene.ts`, `src/battle-scene.ts`, `src/ui/ui.ts` (UiMode/Button enums), `src/phases/game-over-phase.ts` (ribbon award logic), `src/game-mode.ts` (wave structure). Re-check `game-over-phase.ts` and `bridge.ts` after any major game patch.

## Verification strategy (end-to-end)
- **Per phase:** the inline verify checkpoints above — escalating from "reads match screen" → "clears early waves" → "one full clear" → "unattended multi-run ribbon farming."
- **Ground-truth the ribbon math:** after a clear, read `dexData[].ribbons` directly and confirm every final-party line flipped to ribboned. This is the load-bearing claim; verify it empirically on the first real clear before trusting the orchestrator's run-count planning.
- **Observe-only first:** Phase 0/1 run with `dryRun` so we never send a live input until the reads are proven correct.
- **Local fallback:** if live access misbehaves, `npm run pokerogue` against a clone and point the `@match` at localhost — same library, validated identically.

## Open risk / honesty notes
- **Run-count estimate (~⌈N/6⌉, front-loaded; order-of-100 runs for a full roster):** the *per-win* ribbon math is source-verified; the total depends on how cheap your carries get. Worth a sanity-check on r/pokerogue or the PokéRogue Discord before relying on a precise number.
- **Live-site fragility:** the scene bridge is the single point that a game update or an anti-automation change can break. It's isolated to one file and fails loud by design.
- **This remains automation of a live account with no explicit TOS blessing.** Input-only + no save writes is the low-risk posture, but the residual risk is yours to accept.
