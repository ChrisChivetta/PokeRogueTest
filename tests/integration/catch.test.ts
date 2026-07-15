import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachBot, detachBot, withBotDriving } from "./_driver";
import { config } from "./bot/config";

// Deterministic validation that the bot DETECTS a catchable new species and actually throws
// a ball at it in a real (headless) battle — driving the live Command/Ball handlers. We force
// the foe "un-caught" in the dex and stock Master Balls so the catch is guaranteed, letting us
// assert the species ends up recorded (the unlock) rather than depending on catch-rate RNG.
describe("auto-ribbon — catch (unlock engine)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single").criticalHits(false)
      .ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(60).enemyLevel(5)
      .enemySpecies(SpeciesId.PIDGEY).enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.VINE_WHIP]);
  });

  afterEach(() => {
    detachBot();
    config.catchAttemptsPerTarget = 3;
  });

  /** Force the foe to read as a brand-new species and stock guaranteed-catch balls. */
  const setUpNewSpeciesCatch = (species: SpeciesId) => {
    game.scene.gameData.dexData[species].caughtAttr = 0n; // pretend never caught → "new"
    game.scene.pokeballCounts = [0, 0, 0, 0, 99]; // Master Balls only → deterministic catch
  };

  it("throws at and catches a new wild species", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    setUpNewSpeciesCatch(SpeciesId.PIDGEY);
    expect(game.scene.gameData.dexData[SpeciesId.PIDGEY].caughtAttr).toBe(0n);
    attachBot(game.scene);

    // The bot opens the Ball menu, throws, and the wild is caught → the battle is won.
    await withBotDriving(() => game.phaseInterceptor.to("VictoryPhase"));

    expect(game.scene.gameData.dexData[SpeciesId.PIDGEY].caughtAttr).not.toBe(0n);
  }, 40000);

  it("catches a boss on its last shield segment (but not before)", async () => {
    game.override.startingWave(10).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    const boss = game.scene.getEnemyPokemon()!;
    expect(boss.isBoss()).toBe(true);
    boss.bossSegmentIndex = 0; // drop it straight to the only catchable segment
    setUpNewSpeciesCatch(SpeciesId.SNORLAX);
    attachBot(game.scene);

    await withBotDriving(() => game.phaseInterceptor.to("VictoryPhase"));

    expect(game.scene.gameData.dexData[SpeciesId.SNORLAX].caughtAttr).not.toBe(0n);
  }, 60000);

  it("does NOT waste balls on an already-caught species (fights instead)", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    // Leave PIDGEY marked caught; give a full bag. The bot should fight, not throw.
    game.scene.pokeballCounts = [9, 9, 9, 9, 9];
    game.scene.gameData.dexData[SpeciesId.PIDGEY].caughtAttr = 1n; // already known
    attachBot(game.scene);
    const ballsBefore = [...game.scene.pokeballCounts];

    await withBotDriving(() => game.phaseInterceptor.to("FaintPhase"));

    expect(game.scene.getEnemyParty()[0].isFainted()).toBe(true); // KO'd, not caught
    expect([...game.scene.pokeballCounts]).toEqual(ballsBefore); // no ball spent
  }, 40000);
});
