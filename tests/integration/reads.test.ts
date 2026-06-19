import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __setSceneForTest } from "./bot/bridge";
import { readState } from "./bot/state";

// Deterministic validation of the bot's state reads against a REAL (headless) battle.
describe("auto-ribbon — state reads", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.VINE_WHIP, MoveId.TACKLE, MoveId.GROWL]);
  });

  afterEach(() => {
    __setSceneForTest(null);
  });

  it("reads party, foe, moves, types, wave and mode at the command screen", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    __setSceneForTest(game.scene);

    const s = readState();
    expect(s.ready).toBe(true);
    expect(s.uiMode).toBe("COMMAND");
    expect(s.battle?.waveIndex).toBe(1);
    expect(s.battle?.isTrainer).toBe(false);

    // Player lead
    const lead = s.playerParty[0];
    expect(lead.name.toLowerCase()).toContain("bulbasaur");
    expect(lead.hpRatio).toBeGreaterThan(0);
    expect(lead.fainted).toBe(false);
    expect(lead.types).toEqual(expect.arrayContaining(["grass", "poison"]));

    // Moves: names, types, and PP must be readable (this is what move-selection depends on)
    const names = lead.moves.map((m) => (m.name ?? "").toLowerCase());
    expect(names.join(",")).toContain("vine");
    const vineWhip = lead.moves.find((m) => (m.name ?? "").toLowerCase().includes("vine"));
    expect(vineWhip?.type).toBe("grass");
    expect(vineWhip?.pp).toBeGreaterThan(0);
    expect(vineWhip?.power).toBeGreaterThan(0);
    // Usability flag (drives skipping disabled / out-of-PP moves): a fresh, full-PP attacking
    // move must read as usable. Validates the PokemonMove.isUsable(p, false, true) shape.
    expect(vineWhip?.usable).toBe(true);

    // Foe
    expect(s.enemyParty[0].name.toLowerCase()).toContain("rattata");
    expect(s.enemyParty[0].types).toContain("normal");
  });
});
