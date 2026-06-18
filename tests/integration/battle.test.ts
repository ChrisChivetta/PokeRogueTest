import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachBot, detachBot, driveBot, withBotDriving } from "./_driver";

// The bot driving real battles end-to-end through the live command/fight/target handlers.
describe("auto-ribbon — battle driving", () => {
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

  it("picks the super-effective move and KOs the foe", async () => {
    // Vine Whip (grass) is 2x vs Magikarp (water); Growl is a status decoy it must avoid.
    game.override.moveset([MoveId.GROWL, MoveId.VINE_WHIP]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);

    driveBot(); // already at the command prompt → drive COMMAND→FIGHT→move now
    await game.phaseInterceptor.to("FaintPhase"); // our move KOs the foe

    // Read from the party array (the active-field accessor throws once the foe faints).
    expect(game.scene.getEnemyParty()[0].isFainted()).toBe(true);
    // It used Vine Whip, not Growl:
    expect(game.scene.getPlayerParty()[0].getLastXMoves()[0].move).toBe(MoveId.VINE_WHIP);
  }, 20000);

  it("handles a double battle: commands both mons and selects targets", async () => {
    // Tankier foes so the turn completes (both our mons act) before any KO ends the wave.
    game.override.battleStyle("double").moveset([MoveId.VINE_WHIP]).enemyLevel(30);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.SQUIRTLE);
    attachBot(game.scene);
    expect(game.scene.getPlayerField().length).toBe(2); // confirm it's really a double

    // Interval driver handles every decision (mon1/mon2 commands + target selects).
    await withBotDriving(() => game.phaseInterceptor.to("TurnEndPhase"));

    // Both our mons used Vine Whip this turn (commanded both + picked targets).
    for (const ally of game.scene.getPlayerField()) {
      expect(ally.getLastXMoves()[0]?.move).toBe(MoveId.VINE_WHIP);
    }
    // And both foes took super-effective damage.
    for (const foe of game.scene.getEnemyField()) {
      expect(foe.hp).toBeLessThan(foe.getMaxHp());
    }
  }, 25000);

  it("does not stall when the lead has no usable move (Struggle)", async () => {
    // Single move with 0 PP → bestMoveIndex returns null → policy backs out of FIGHT; the
    // game then forces Struggle. The turn must still resolve (no hang).
    game.override.moveset([MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);
    const lead = game.field.getPlayerPokemon();
    lead.moveset[0]!.ppUsed = lead.moveset[0]!.getMovePp(); // drain all PP

    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => driveBot());
    await game.phaseInterceptor.to("BerryPhase");

    // It attempted a move (Struggle) rather than wedging the FIGHT menu.
    expect(game.field.getPlayerPokemon().getLastXMoves().length).toBeGreaterThan(0);
  }, 20000);
});
