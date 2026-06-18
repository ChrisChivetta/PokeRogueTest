import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __setSceneForTest } from "./bot/bridge";
import { config } from "./bot/config";
import { step } from "./bot/policy";
import { readState } from "./bot/state";

describe("auto-ribbon — faint switch", () => {
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
      .enemySpecies(SpeciesId.MAGIKARP).enemyMoveset(MoveId.SPLASH)
      .startingLevel(100).enemyLevel(1)
      .moveset([MoveId.MEMENTO]);
    config.enabled = true;
    config.dryRun = false;
    config.inputDelayMinMs = 0;
    config.inputDelayMaxMs = 0;
  });

  afterEach(() => {
    __setSceneForTest(null);
    config.dryRun = true;
  });

  it("brings in the surviving party member when the lead faints", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER);
    __setSceneForTest(game.scene);

    const lead = game.field.getPlayerPokemon();
    const leadName = lead.name.toLowerCase();
    const survivor = leadName.includes("bulbasaur") ? "charmander" : "bulbasaur";

    game.move.use(MoveId.MEMENTO); // lead faints itself → forced switch prompt
    game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    // Let OUR policy resolve the forced switch prompt (processInput is synchronous, so
    // each step() advances the PartyUiHandler one action until it leaves PARTY).
    game.onNextPrompt("SwitchPhase", UiMode.PARTY, () => {
      for (let i = 0; i < 25; i++) {
        const s = readState();
        if (s.uiMode !== "PARTY") break;
        void step(s);
      }
    });
    await game.toNextTurn();

    const active = game.field.getPlayerPokemon();
    console.log(`active after: ${active?.name} | lead(${leadName}) fainted: ${lead.isFainted()} | expected survivor: ${survivor}`);
    expect(lead.isFainted()).toBe(true);
    expect(active.name.toLowerCase()).toContain(survivor);
  }, 20000);
});
