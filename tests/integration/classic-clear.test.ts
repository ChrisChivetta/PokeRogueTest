import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { attachBot, detachBot, withBotDriving } from "./_driver";

// Capstone: the bot clears Classic mode hands-off. It jumps to the wave-200 Eternatus fight in
// the END biome, then drives the FULL battle policy through BOTH Eternatus phases (the regular
// form and the Eternamax transformation that heals to full + restores shields) to a win, and on
// into the victory sequence — proving move-select + reward/catch guards + the endgame all hold
// together. The clear is what awards Classic ribbons to the whole party (the project's goal).
describe("auto-ribbon — classic clear (Eternatus)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .startingWave(200).startingBiome(BiomeId.END)
      .criticalHits(false)
      .startingLevel(10000) // a strong-enough carry; team strategy is Phase 3's job, not the policy's
      .moveset([MoveId.DRAGON_PULSE]).enemyMoveset(MoveId.SPLASH);
  });

  afterEach(() => detachBot());

  it("beats Eternatus (both phases) and registers a Classic victory", async () => {
    await game.runToFinalBossEncounter([SpeciesId.MIRAIDON], GameModes.CLASSIC);
    const eternatus = game.field.getEnemyPokemon();
    expect(eternatus.species.speciesId).toBe(SpeciesId.ETERNATUS);
    expect(eternatus.formIndex).toBe(0); // starts in the regular form (4 shield segments)
    expect(game.scene.gameData.gameStats.sessionsWon).toBe(0);

    attachBot(game.scene);

    // Drive the bot to the end of the run: it KOs both Eternatus phases, then the victory
    // sequence awards the win (~1s after GameOverPhase starts, before the long fade-out).
    await withBotDriving(async () => {
      await game.phaseInterceptor.to("GameOverPhase").catch(() => {});
      await vi.waitUntil(() => game.scene.gameData.gameStats.sessionsWon >= 1,
        { timeout: 15000, interval: 100 });
    });

    expect(eternatus.formIndex).toBe(1); // it transformed into Eternamax along the way
    expect(game.scene.getEnemyParty().every((e) => e.isFainted())).toBe(true);
    expect(game.scene.gameData.gameStats.sessionsWon).toBe(1); // CLASSIC_VICTORY registered

    // The whole point: the clear awards the Classic ribbon to the (final-party) species line.
    const ribbons = game.scene.gameData.dexData[SpeciesId.MIRAIDON].ribbons.getRibbons();
    expect(ribbons & RibbonData.CLASSIC).not.toBe(0n);
  }, 60000);
});
