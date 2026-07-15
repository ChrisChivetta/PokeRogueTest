import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachBot, detachBot, withBotDriving } from "./_driver";

// Deterministic validation that the bot DETECTS a mystery encounter and RESOLVES it with
// the curated run-favorable option — driving the real (headless) MysteryEncounterUiHandler,
// not a mock. Reaching the target phase is itself the no-stall proof: if the bot wedged on
// the option screen, phaseInterceptor.to(...) would time out and the test would fail.
describe("auto-ribbon — mystery encounters", () => {
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
      .startingLevel(100).enemyLevel(5)
      // Mystery encounters only roll on WILD, non-boss, ME-legal waves; force a 100% spawn
      // on an eligible wave so runToMysteryEncounter reliably lands on the requested type.
      .mysteryEncounterChance(100).startingWave(45).disableTrainerWaves()
      .moveset([MoveId.VINE_WHIP]).enemyMoveset(MoveId.SPLASH);
  });

  afterEach(() => detachBot());

  /** Index of the option the bot ended up choosing (selectedOption is set on resolve). */
  const chosenOptionIndex = (): number => {
    const me = game.scene.currentBattle.mysteryEncounter!;
    return me.options.indexOf(me.selectedOption!);
  };

  it("takes the free full-heal refusal at A Trainer's Test (no battle)", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.A_TRAINERS_TEST, [
      SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE,
    ]);
    attachBot(game.scene);

    await withBotDriving(() => game.phaseInterceptor.to("MysteryEncounterRewardsPhase"));

    // Option index 1 = "Refuse the Challenge" → full heal party + egg (the run-safe pick).
    expect(chosenOptionIndex()).toBe(1);
  }, 30000);

  it("leaves the Mysterious Chest rather than risking a party KO", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.MYSTERIOUS_CHEST, [
      SpeciesId.BULBASAUR, SpeciesId.CHARMANDER,
    ]);
    attachBot(game.scene);

    await withBotDriving(() => game.phaseInterceptor.to("MysteryEncounterRewardsPhase"));

    expect(chosenOptionIndex()).toBe(1); // "Too Risky, Leave"
  }, 30000);

  it("takes the free shop at the Department Store Sale", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [
      SpeciesId.BULBASAUR, SpeciesId.CHARMANDER,
    ]);
    attachBot(game.scene);

    await withBotDriving(() => game.phaseInterceptor.to("MysteryEncounterRewardsPhase"));

    // Any of the four counters is a free shop; the bot prefers the vitamin counter (index 1).
    expect(chosenOptionIndex()).toBe(1);
  }, 30000);

  it("resolves Field Trip through its secondary party + move sub-select (no stall)", async () => {
    // Every Field Trip option needs a Pokémon-and-move sub-selection and there is no leave —
    // the bot must drive the secondary PARTY (SELECT) and OPTION_SELECT screens to get out.
    // It's a zero-risk encounter, so simply reaching the rewards phase is the win condition.
    await game.runToMysteryEncounter(MysteryEncounterType.FIELD_TRIP, [
      SpeciesId.BULBASAUR, SpeciesId.CHARMANDER,
    ]);
    attachBot(game.scene);

    await withBotDriving(() => game.phaseInterceptor.to("MysteryEncounterRewardsPhase"));

    expect(game.scene.currentBattle.mysteryEncounter!.selectedOption).toBeTruthy();
  }, 40000);

  it("fights the standard battle at Mysterious Challengers and wins it", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.MYSTERIOUS_CHALLENGERS, [
      SpeciesId.BULBASAUR, SpeciesId.CHARMANDER,
    ]);
    attachBot(game.scene);

    // Option 0 (the easiest "clever foe" battle) is chosen, then the bot fights it. The ME
    // battle begins; pump until the encounter trainer is out of Pokémon.
    await withBotDriving(async () => {
      await game.phaseInterceptor.to("MysteryEncounterBattlePhase").catch(() => {});
      for (let i = 0; i < 30 && !game.scene.getEnemyParty().every((e) => e.isFainted()); i++) {
        await game.phaseInterceptor.to("TurnEndPhase").catch(() => {});
      }
    });

    expect(chosenOptionIndex()).toBe(0);
    expect(game.scene.getEnemyParty().every((e) => e.isFainted())).toBe(true);
  }, 60000);
});
