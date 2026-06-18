import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachBot, detachBot, withBotDriving } from "./_driver";
import { readState } from "./bot/state";

describe("auto-ribbon — flows", () => {
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
      .startingLevel(50).enemyLevel(1)
      .enemySpecies(SpeciesId.MAGIKARP).enemyMoveset(MoveId.SPLASH);
  });

  afterEach(() => detachBot());

  it("does not hang on game over when the last mon faints", async () => {
    // A lone starter using Memento faints itself → no party left → game over.
    game.override.moveset([MoveId.MEMENTO]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);

    await withBotDriving(() => game.phaseInterceptor.to("GameOverPhase"));

    expect(game.scene.getPlayerParty()[0].isFainted()).toBe(true);
  }, 25000);

  it("reads a trainer battle and fights it", async () => {
    game.override.battleType(BattleType.TRAINER).randomTrainer({ trainerType: TrainerType.SCHOOL_KID })
      .moveset([MoveId.VINE_WHIP]).startingLevel(100);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);

    // Our read correctly flags the trainer battle.
    const s = readState();
    expect(s.battle?.isTrainer).toBe(true);

    // And the bot fights it: the first enemy mon is KO'd by our move.
    await withBotDriving(() => game.phaseInterceptor.to("FaintPhase"));
    expect(game.scene.getEnemyParty()[0].isFainted()).toBe(true);
  }, 25000);

  it("declines a level-up move-learn without hanging", async () => {
    // 4 full move slots + big XP → on level-up the game asks to forget a move to learn a
    // new one. The bot should decline and not wedge on the confirm dialog(s).
    game.override.xpMultiplier(64)
      .moveset([MoveId.TACKLE, MoveId.GROWL, MoveId.LEECH_SEED, MoveId.VINE_WHIP]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);
    const bulba = game.field.getPlayerPokemon();
    const before = bulba.getMoveset().map((m) => m?.moveId);

    // Win the wave (level-up → learn-move prompt → declined) and reach the reward screen.
    await withBotDriving(() => game.phaseInterceptor.to("SelectModifierPhase"));

    // Moveset unchanged — the new move was declined, not learned.
    expect(bulba.getMoveset().map((m) => m?.moveId)).toEqual(before);
  }, 25000);
});
