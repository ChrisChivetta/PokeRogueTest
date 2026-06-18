import { describe, it, expect, beforeEach } from "vitest";
import { shouldCatch, pickBall, noteCatchAttempt, resetCatch, PokeballType } from "../src/catch";
import { config } from "../src/config";
import type { GameSnapshot } from "../src/state";

const foe = (o: any = {}) => ({
  name: "foe", speciesId: 25, fainted: false, hpRatio: 1, onField: true, types: [], moves: [],
  isBoss: false, bossSegmentIndex: null, speciesCaught: false, ...o,
});

// A wild battle on a normal wave with a single un-caught foe and a full bag, by default.
const s = (o: any = {}): GameSnapshot => ({
  ready: true, uiMode: "COMMAND", uiModeNumber: 2, cursor: 0, awaitingActionInput: false,
  battle: { waveIndex: 5, turn: 1, double: false, battleType: 0, isBossWave: false, isTrainer: false },
  playerParty: [], enemyParty: [foe()], biomeId: null, money: null,
  pokeballCounts: [5, 5, 5, 5, 1],
  ...o,
} as GameSnapshot);

beforeEach(() => { resetCatch(); config.catchNewSpecies = true; config.catchAttemptsPerTarget = 3; });

describe("catch — when to throw", () => {
  it("throws at a NEW wild species", () => {
    expect(shouldCatch(s())).toBe(true);
  });

  it("skips an already-caught species", () => {
    expect(shouldCatch(s({ enemyParty: [foe({ speciesCaught: true })] }))).toBe(false);
  });

  it("skips when the dex status is unknown (null)", () => {
    expect(shouldCatch(s({ enemyParty: [foe({ speciesCaught: null })] }))).toBe(false);
  });

  it("never throws at trainers", () => {
    expect(shouldCatch(s({ battle: { waveIndex: 5, isTrainer: true } }))).toBe(false);
  });

  it("stops catching in the End Biome (wave 191+)", () => {
    expect(shouldCatch(s({ battle: { waveIndex: 191, isTrainer: false } }))).toBe(false);
  });

  it("skips doubles / multi-foe (the ball is blocked as multi-target)", () => {
    expect(shouldCatch(s({ enemyParty: [foe(), foe({ name: "foe2" })] }))).toBe(false);
  });

  it("won't throw a normal ball at a boss above its last segment", () => {
    expect(shouldCatch(s({ enemyParty: [foe({ isBoss: true, bossSegmentIndex: 2 })] }))).toBe(false);
  });

  it("throws at a boss ON its last segment", () => {
    expect(shouldCatch(s({ enemyParty: [foe({ isBoss: true, bossSegmentIndex: 0 })] }))).toBe(true);
  });

  it("needs at least one ball in the bag", () => {
    expect(shouldCatch(s({ pokeballCounts: [0, 0, 0, 0, 0] }))).toBe(false);
  });

  it("can be disabled by config", () => {
    config.catchNewSpecies = false;
    expect(shouldCatch(s())).toBe(false);
  });

  it("gives up after the per-target attempt cap, and resets for a new target", () => {
    const snap = s();
    expect(shouldCatch(snap)).toBe(true); noteCatchAttempt();
    expect(shouldCatch(snap)).toBe(true); noteCatchAttempt();
    expect(shouldCatch(snap)).toBe(true); noteCatchAttempt();
    expect(shouldCatch(snap)).toBe(false); // 3 throws spent → fall back to fighting

    // A different foe (new wave) gets a fresh budget.
    const next = s({ battle: { waveIndex: 6, isTrainer: false }, enemyParty: [foe({ speciesId: 4 })] });
    expect(shouldCatch(next)).toBe(true);
  });
});

describe("catch — ball selection", () => {
  it("uses the cheapest ball on an ordinary wild", () => {
    expect(pickBall(s())).toBe(PokeballType.POKE);
  });

  it("falls through to the next cheapest when out of Poké Balls", () => {
    expect(pickBall(s({ pokeballCounts: [0, 3, 0, 0, 0] }))).toBe(PokeballType.GREAT);
  });

  it("spends a stronger ball on a boss (Rogue preferred)", () => {
    expect(pickBall(s({ enemyParty: [foe({ isBoss: true, bossSegmentIndex: 0 })] }))).toBe(PokeballType.ROGUE);
  });

  it("only resorts to a Master Ball when nothing else is left", () => {
    expect(pickBall(s({ pokeballCounts: [0, 0, 0, 0, 1] }))).toBe(PokeballType.MASTER);
  });

  it("returns null with an empty bag", () => {
    expect(pickBall(s({ pokeballCounts: [0, 0, 0, 0, 0] }))).toBeNull();
  });
});
