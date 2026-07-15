import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { attachBot, detachBot, withBotDriving } from "./_driver";
import { readState } from "./bot/state";

describe("auto-ribbon — scenarios", () => {
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
      .startingLevel(100).enemyLevel(1)
      .enemySpecies(SpeciesId.MAGIKARP).enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.VINE_WHIP]);
  });

  afterEach(() => detachBot());

  it("clears several waves hands-off (sustained operation)", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);

    // Win wave after wave, taking/skipping rewards in between, with no human input.
    // Each iteration: KO the foe, then advance through the reward to the next wave's command.
    await withBotDriving(async () => {
      for (let w = 0; w < 3 && (game.scene.currentBattle?.waveIndex ?? 0) < 3; w++) {
        await game.phaseInterceptor.to("FaintPhase").catch(() => {});
        await game.phaseInterceptor.to("CommandPhase").catch(() => {});
      }
    });

    expect(game.scene.currentBattle.waveIndex).toBeGreaterThanOrEqual(3);
  }, 40000);

  it("grinds down a tanky foe over many turns", async () => {
    // Blissey has a huge HP pool; Splash means it can't hurt us — so the bot must keep
    // selecting moves turn after turn until it finally faints.
    game.override.enemySpecies(SpeciesId.BLISSEY).enemyLevel(50).startingLevel(50);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);

    // to("FaintPhase") pumps the phase system through every turn while the bot commands.
    await withBotDriving(() => game.phaseInterceptor.to("FaintPhase"));

    expect(game.scene.getEnemyParty()[0].isFainted()).toBe(true);
    expect(game.scene.getPlayerParty()[0].getLastXMoves()[0].move).toBe(MoveId.VINE_WHIP);
  }, 40000);

  it("avoids an immune move and uses an effective one (Normal vs Ghost)", async () => {
    // Tackle (Normal) does nothing to a Ghost; the bot must pick Vine Whip instead.
    game.override.enemySpecies(SpeciesId.GASTLY).enemyLevel(1).startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.VINE_WHIP]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);

    await withBotDriving(() => game.phaseInterceptor.to("FaintPhase"));

    expect(game.scene.getEnemyParty()[0].isFainted()).toBe(true);
    expect(game.scene.getPlayerParty()[0].getLastXMoves()[0].move).toBe(MoveId.VINE_WHIP);
  }, 25000);

  it("reads status and keeps fighting while paralyzed", async () => {
    // Nuzzle paralyzes us 100%; Chansey's huge HP keeps the battle going for many turns
    // (some of which we're "fully paralyzed"). The bot must read the status and persist.
    game.override.enemySpecies(SpeciesId.CHANSEY).enemyLevel(50).startingLevel(50)
      .enemyMoveset([MoveId.NUZZLE]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);

    await withBotDriving(() => game.phaseInterceptor.to("FaintPhase"));

    expect(game.scene.getEnemyParty()[0].isFainted()).toBe(true);
    // We were paralyzed along the way — the game shows it and our reader surfaces it.
    expect(game.scene.getPlayerParty()[0].status?.effect).toBeTruthy();
    expect(readState().playerParty[0]?.status).toBeTruthy();
  }, 40000);

  it("switches in the survivor after a faint and wins the battle", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER);
    const [lead, second] = game.scene.getPlayerParty();
    // Lead can only Memento (faints itself, weakening the foe); the survivor finishes it.
    game.move.changeMoveset(lead, [MoveId.MEMENTO]);
    game.move.changeMoveset(second, [MoveId.VINE_WHIP]);
    attachBot(game.scene);

    await withBotDriving(() => game.phaseInterceptor.to("VictoryPhase"));

    expect(lead.isFainted()).toBe(true); // the original lead fainted (Memento)
    expect(game.field.getPlayerPokemon()).toBe(second); // survivor was sent in
    expect(game.scene.getEnemyParty()[0].isFainted()).toBe(true); // and won the battle
  }, 40000);

  it("grinds down a boss wave", async () => {
    // Wave 10 is a boss (multiple HP-bar segments / shields). The bot must keep attacking
    // until every segment is broken.
    game.override.startingWave(10).enemyLevel(1).startingLevel(100);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);
    expect(game.scene.getEnemyField()[0].isBoss()).toBe(true);

    await withBotDriving(() => game.phaseInterceptor.to("FaintPhase"));

    expect(game.scene.getEnemyParty()[0].isFainted()).toBe(true);
  }, 40000);
});
