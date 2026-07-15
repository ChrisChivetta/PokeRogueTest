import { BattleScene } from "#app/battle-scene";
import { activeOverrides } from "#app/overrides";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { attachBot, detachBot, withBotDriving } from "./_driver";

// Gate H0 de-risk probe (docs/PLAN-V2.md §4): does the headless bridge survive a LONG,
// FULL-FIDELITY run — real battle RNG (not GameManager's default max-roll stub) and real
// mystery encounters (not disabled) — rather than the short/rigged scenarios every other
// integration test uses? This is the harness itself under test, not play quality: a wedge here
// (a 20s vitest timeout) or runaway memory growth would poison every headless soak built on
// top of this bridge before we ever get to measuring the policy.
//
// GameManager's constructor stubs BattleScene.prototype.randBattleSeedInt to always return the
// max roll ("Simulate max rolls on RNG functions") and defaults mysteryEncounterChance to 0 —
// every headless result measured so far (including the other tests in this suite) ran under
// that rig. Restore both here so this run is representative of what a real headless soak would
// see, while still using BALL_FETCH (neutralizes ability-based combat variance we're not trying
// to test) and a fixed ability seed for a fair A/B if this test is ever re-run to compare policy
// changes.
describe("auto-ribbon — full-fidelity probe (Gate H0)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let originalRandBattleSeedInt: typeof BattleScene.prototype.randBattleSeedInt;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // Capture the REAL implementation before any GameManager construction stubs it.
    originalRandBattleSeedInt = BattleScene.prototype.randBattleSeedInt;
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Undo GameManager's "always max roll" stub — real battle RNG for a representative run.
    BattleScene.prototype.randBattleSeedInt = originalRandBattleSeedInt;
    // Undo GameManager's mysteryEncounterChance(0) — restore the REAL default (no override,
    // null) rather than pass a fabricated percentage, so MEs roll at the mode's real rate.
    vi.spyOn(activeOverrides, "MYSTERY_ENCOUNTER_RATE_OVERRIDE", "get").mockReturnValue(null);
    game.override.ability(AbilityId.BALL_FETCH); // neutralize ability RNG; not what we're probing
  });

  afterEach(() => detachBot());

  it(
    "plays waves 1→50 hands-off with real RNG and real mystery encounters, tracking cost",
    async () => {
      // Bulbasaur (4x weak to Flying/Ice/Psychic) died to the FIRST wild encounter on the
      // default test seed across repeated runs; Squirtle without a moveset override then died
      // to Struggle from turn one ("has no moves left that it can use") — GameManager's default
      // fresh-starter moveset isn't reliably usable without an explicit override, unlike every
      // OTHER test in this suite, which always sets one. Give it a real attacking move so this
      // probes harness/policy survival, not an empty-moveset artifact of my own test setup.
      game.override.moveset([MoveId.WATER_GUN, MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.SQUIRTLE);
      // Seed AFTER startBattle, not before: classicMode.startBattle() -> runToSummon() ->
      // generateStarters() unconditionally hardcodes `scene.seed = "test"` (test/utils/
      // game-manager-utils.ts) for framework-wide determinism, silently clobbering any earlier
      // .seed() override — verified empirically (3 different seed strings all produced the
      // identical wave-1 wild when set beforehand, as this test originally did). Named seed set
      // HERE, after, lets this be re-run identically for a fair before/after once the policy
      // changes — wave 1 is always the same "test"-seeded encounter regardless, but wave 2+
      // genuinely diverges per seed once resetSeed() is called.
      game.override.seed("probe-d");
      game.scene.resetSeed();
      attachBot(game.scene);

      const startedAt = Date.now();
      const startRss = process.memoryUsage().rss;
      const waveLog: { wave: number; atMs: number; rssMb: number }[] = [];
      const TARGET_WAVE = 50;

      // A real-RNG loss (unlike every other test's rigged max-roll RNG) is a live possibility
      // and a VALID de-risk outcome, not a bug — the game auto-returns to TitlePhase afterward
      // (GameOverPhase → PostGameOverPhase → TitlePhase all pass within one phaseInterceptor
      // step), so we can't catch the wipe by polling for GameOverPhase between steps; check the
      // party directly instead.
      const isWipedOut = () => game.scene.getPlayerParty().every((p) => p.isFainted());
      let reachedGameOver = false;
      await withBotDriving(async () => {
        for (let i = 0; i < TARGET_WAVE * 3; i++) {
          const wave = game.scene.currentBattle?.waveIndex ?? 0;
          if (wave >= TARGET_WAVE) break;
          if (isWipedOut()) {
            reachedGameOver = true;
            break;
          }
          // eslint-disable-next-line no-console
          console.log(`[fullrun-probe] loop i=${i} wave=${wave} atMs=${Date.now() - startedAt}`);
          // Advance to the next natural checkpoint (a win, a wipe, or a mystery encounter
          // resolving) — .catch() because which one happens is run-dependent, matching the
          // existing multi-wave pattern (scenarios.test.ts "clears several waves hands-off").
          // phaseInterceptor.to() has its OWN internal wait (TEST_TIMEOUT, ~20s) before it gives
          // up and rejects, so a wipe that lands us back at TitlePhase (no more FaintPhase ever
          // coming) still costs one full internal timeout here before the .catch() lets us
          // re-check isWipedOut() below — that cost is inherent to the framework, not a wedge.
          await game.phaseInterceptor.to("FaintPhase").catch(() => {});
          if (isWipedOut()) {
            reachedGameOver = true;
            break;
          }
          await game.phaseInterceptor.to("CommandPhase").catch(() => {});
          const nowWave = game.scene.currentBattle?.waveIndex ?? 0;
          if (nowWave !== wave) {
            waveLog.push({
              wave: nowWave,
              atMs: Date.now() - startedAt,
              rssMb: Math.round((process.memoryUsage().rss - startRss) / 1e6),
            });
          }
        }
      });

      const totalMs = Date.now() - startedAt;
      const finalWave = game.scene.currentBattle?.waveIndex ?? 0;
      // eslint-disable-next-line no-console
      console.log(
        `[fullrun-probe] finalWave=${finalWave} reachedGameOver=${reachedGameOver} ` +
          `totalMs=${totalMs} msPerWave=${waveLog.length ? Math.round(totalMs / waveLog.length) : "n/a"} ` +
          `rssDeltaMb=${Math.round((process.memoryUsage().rss - startRss) / 1e6)} ` +
          `waveLog=${JSON.stringify(waveLog)}`,
      );

      // The de-risk bar (docs/PLAN-V2.md Gate H0): a full-fidelity seeded run reaches the
      // target wave OR wipes honestly (GameOverPhase) — either is a pass, because both prove
      // the harness survives sustained real-RNG, real-ME play without wedging. What fails this
      // test is neither happening (a silent stall the loop above couldn't detect) or the vitest
      // timeout firing first (a genuine wedge, surfaced as a test failure per the plan's note
      // that wedges show up as timeouts, not hangs).
      expect(finalWave >= TARGET_WAVE || reachedGameOver).toBe(true);
    },
    10 * 60 * 1000, // 10 minutes — generous for a real (unrigged) 50-wave run
  );
});
