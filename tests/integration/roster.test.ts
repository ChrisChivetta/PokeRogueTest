import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { RibbonData } from "#system/ribbons/ribbon-data";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __setSceneForTest } from "./bot/bridge";
import { readRoster, readCandyStarters, CLASSIC_RIBBON } from "./bot/roster";
import { selectTeam } from "./bot/team";
import { planCandy } from "./bot/candy";

// Validates the roster reader against a REAL (headless) gameData, and that the pure team
// selector produces a legal plan from it. Catches drift in the gameData accessors the
// orchestrator depends on (starterData keys, getSpeciesStarterValue, dexData[].ribbons).
describe("auto-ribbon — roster + team selection", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => __setSceneForTest(null));

  it("reads owned starters with sane costs and carry ranks", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    __setSceneForTest(game.scene);

    const roster = readRoster();
    expect(roster.length).toBeGreaterThan(0);
    // Every entry has a finite positive cost and a boolean ribbon flag.
    expect(roster.every((s) => Number.isFinite(s.cost) && s.cost > 0)).toBe(true);

    // Bulbasaur is a known starter and a shortlisted carry (the Venusaur/Eternatus line).
    const bulba = roster.find((s) => s.speciesId === SpeciesId.BULBASAUR);
    expect(bulba).toBeDefined();
    expect(bulba!.carryRank).not.toBeNull();
  });

  it("reflects an awarded Classic ribbon", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    __setSceneForTest(game.scene);
    expect(readRoster().find((s) => s.speciesId === SpeciesId.BULBASAUR)!.ribboned).toBe(false);

    // Award the Classic ribbon to Bulbasaur's line; the reader must surface it.
    game.scene.gameData.dexData[SpeciesId.BULBASAUR].ribbons.award(RibbonData.CLASSIC);
    expect(readRoster().find((s) => s.speciesId === SpeciesId.BULBASAUR)!.ribboned).toBe(true);
    expect(CLASSIC_RIBBON).toBe(RibbonData.CLASSIC as unknown as bigint);
  });

  it("plans a legal team (carry present, within the 10-point budget)", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    __setSceneForTest(game.scene);

    const plan = selectTeam(readRoster());
    expect(plan.carry).not.toBeNull();
    expect(plan.team.length).toBeGreaterThanOrEqual(1);
    expect(plan.team.length).toBeLessThanOrEqual(6);
    expect(plan.totalCost).toBeLessThanOrEqual(10);
  });

  it("reads candy state and routes a granted candy stash into a cost reduction", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    __setSceneForTest(game.scene);

    const candyStarters = readCandyStarters();
    const bulba = candyStarters.find((s) => s.speciesId === SpeciesId.BULBASAUR)!;
    expect(bulba.baseCost).toBeGreaterThanOrEqual(1);
    expect(bulba.baseCost).toBeLessThanOrEqual(10);

    // Grant plenty of candy; the router should recommend reducing Bulbasaur's cost.
    game.scene.gameData.starterData[SpeciesId.BULBASAUR].candyCount = 999;
    game.scene.gameData.starterData[SpeciesId.BULBASAUR].valueReduction = 0;
    const actions = planCandy(readCandyStarters());
    expect(actions.some((a) => a.speciesId === SpeciesId.BULBASAUR && a.toReduction === 1)).toBe(true);
  });
});
