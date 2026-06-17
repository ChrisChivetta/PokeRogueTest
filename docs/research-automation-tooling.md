# PokéRogue Automation Tooling — Research Findings

## Bottom line
- No existing public bot reliably beats Classic mode end-to-end (waves 1–200 / Eternatus). The most capable project is an RL *training* framework, not a campaign completer.
- The cleanest programmatic interface is **not** a `window` global. PokéRogue exposes `globalScene` only as an ES-module export. Tools reach it via the Phaser CanvasPool walk, then call real BattleScene methods and `scene.ui.processInput(Button.X)`.

## Project inventory
### Autoplayers / bots
- **FrederikHartung/pokeRogueBot** — LEADING. Selenium + Java/Kotlin + DQN RL + TS/JS bridge. 593 commits, active. RL data-collection framework, NOT end-to-end completer.
- **guivilela7/PokeRogueBot** — Python + pyautogui/pytesseract OCR + PokeAPI. Pixel/OCR screen-scraping. 3 commits, 0 stars, incomplete (missing input + game loop). Toy.
- **GreasyFork "Autoplay (basic)" (#555445)** — Tampermonkey userscript, v0.9, ~130 installs. Tries Phaser globals but falls back to non-existent DOM `.move-button` selectors (game is canvas-rendered → broken). Move score = power × accuracy.

### Save editors / cheats (NOT autoplayers)
- RogueEdit/pyRogue (archived Sep 2024), WebManAI/RogueEdit, shadowbaofu/rogueEditor, zay.../PokeRogue-Editor
- PokeRogueMOD: JsPoRoMOD (browser ext), PyPoRoMOD (Python, server API)
- OfflineRogueEditor (claudiunderthehood, orijay) — for self-hosted offline instances
- MikeyTheA/PokeRogueModLoader — mod-loader infra, not a bot

## Cleanest interface (verified from source)
- `src/global-scene.ts`: `export let globalScene: BattleScene` + `initGlobalScene()`. Module-only; NOT on window/globalThis.
- Scene access (FrederikHartung util.ts): `Phaser.Display.Canvas.CanvasPool.pool[0].parent.game.scene.scenes` → find BattleScene.
- State reads (confirmed real BattleScene API): `scene.currentBattle`, `getPlayerParty()`, `getEnemyParty()`, `getPlayerField(true)`, `getEnemyField(true)`, `scene.arena.biomeType`, `scene.modifiers`, `scene.money`, `scene.pokeballCounts`. Battle: `currentBattle.{waveIndex,turn,double,battleType,trainer,enemyParty}`.
- UI state: `scene.ui.getMode()` (UiMode enum), `ui.getHandler()`, `handler.cursor`.
- INPUT: `scene.ui.processInput(Button.ACTION)` — PokéRogue's own input abstraction. Cleanest method; beats synthetic keyboard/DOM clicks.

## Architecture recommendation for a new lib
Inject a userscript → grab BattleScene via CanvasPool → read `globalScene` API directly → drive via `ui.processInput(Button.*)`. Single-thread in-page JS; no Selenium/OCR needed. The hard part (and what nobody has solved publicly) is the full-run decision policy to wave 200.
