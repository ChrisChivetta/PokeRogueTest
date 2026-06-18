import { describe, it, expect } from "vitest";
import { effectiveness, bestMoveIndex, rankedMoves } from "../src/typechart";
import type { MoveSnapshot, PokemonSnapshot } from "../src/state";

// Minimal builders — only the fields the type logic reads.
const move = (p: Partial<MoveSnapshot> & { index: number }): MoveSnapshot => ({
  name: "m", pp: 10, ppMax: 10, type: null, power: null, accuracy: 100, ...p,
});
const mon = (types: string[], moves: MoveSnapshot[]): PokemonSnapshot =>
  ({ name: "p", types, moves } as unknown as PokemonSnapshot);

describe("effectiveness", () => {
  it("super effective and not very effective single types", () => {
    expect(effectiveness("fire", ["grass"])).toBe(2);
    expect(effectiveness("water", ["fire"])).toBe(2);
    expect(effectiveness("fire", ["water"])).toBe(0.5);
    expect(effectiveness("grass", ["fire"])).toBe(0.5);
  });

  it("immunities are 0", () => {
    expect(effectiveness("electric", ["ground"])).toBe(0);
    expect(effectiveness("normal", ["ghost"])).toBe(0);
    expect(effectiveness("ground", ["flying"])).toBe(0);
    expect(effectiveness("dragon", ["fairy"])).toBe(0);
  });

  it("dual-type stacks multiplicatively", () => {
    // Rock vs Charizard (fire/flying): rock→fire 2 × rock→flying 2 = 4
    expect(effectiveness("rock", ["fire", "flying"])).toBe(4);
    // Grass vs Bulbasaur-ish (grass/poison): grass→grass .5 × grass→poison .5 = .25
    expect(effectiveness("grass", ["grass", "poison"])).toBe(0.25);
    // Ground vs flying/x = 0 regardless of the other type
    expect(effectiveness("ground", ["flying", "steel"])).toBe(0);
  });

  it("unknown attacking type or empty defenders → neutral", () => {
    expect(effectiveness("mystery", ["water"])).toBe(1);
    expect(effectiveness("fire", [])).toBe(1);
  });
});

describe("bestMoveIndex", () => {
  it("prefers the super-effective move over a neutral one", () => {
    const lead = mon(["grass"], [
      move({ index: 0, type: "normal", power: 60 }), // neutral
      move({ index: 1, type: "water", power: 55 }),  // 2x vs ground foe
    ]);
    const foe = mon(["ground"], []);
    expect(bestMoveIndex(lead, foe)).toBe(1);
  });

  it("avoids a 0x immune move even at high power", () => {
    const lead = mon(["electric"], [
      move({ index: 0, type: "electric", power: 110 }), // 0x vs ground
      move({ index: 1, type: "normal", power: 40 }),    // 1x
    ]);
    const foe = mon(["ground"], []);
    expect(bestMoveIndex(lead, foe)).toBe(1);
  });

  it("skips moves with 0 PP", () => {
    const lead = mon(["fire"], [
      move({ index: 0, type: "fire", power: 90, pp: 0 }), // best but no PP
      move({ index: 1, type: "fire", power: 40, pp: 5 }),
    ]);
    const foe = mon(["grass"], []);
    expect(bestMoveIndex(lead, foe)).toBe(1);
  });

  it("breaks ties by effective power", () => {
    const lead = mon(["normal"], [
      move({ index: 0, type: "normal", power: 40 }),
      move({ index: 1, type: "normal", power: 80 }),
    ]);
    const foe = mon(["normal"], []);
    expect(bestMoveIndex(lead, foe)).toBe(1);
  });

  it("falls back to a status move only when no damaging move is usable", () => {
    const lead = mon(["grass"], [
      move({ index: 0, type: "grass", power: 0 }),   // status (power 0)
      move({ index: 1, type: "fire", power: 80, pp: 0 }), // damaging but no PP
    ]);
    const foe = mon(["water"], []);
    expect(bestMoveIndex(lead, foe)).toBe(0);
  });

  it("returns null when the lead has no usable move", () => {
    const lead = mon(["normal"], [move({ index: 0, type: "normal", power: 40, pp: 0 })]);
    expect(bestMoveIndex(lead, mon(["normal"], []))).toBeNull();
  });

  it("with no foe type info, picks highest power", () => {
    const lead = mon(["normal"], [
      move({ index: 0, type: "normal", power: 40 }),
      move({ index: 1, type: "fire", power: 95 }),
    ]);
    const foe = mon([], []);
    expect(bestMoveIndex(lead, foe)).toBe(1);
  });
});

describe("rankedMoves", () => {
  it("ranks damaging moves best-first, with status moves last", () => {
    const lead = mon(["water"], [
      move({ index: 0, type: "normal", power: 40 }), // 40
      move({ index: 1, type: "water", power: 55 }), // 110 vs ground (best)
      move({ index: 2, type: "normal", power: 0 }), // status → last
    ]);
    const foe = mon(["ground"], []);
    expect(rankedMoves(lead, foe)).toEqual([1, 0, 2]);
  });

  it("drops 0-PP moves and supports picking the Nth-best (retry variation)", () => {
    const lead = mon([], [
      move({ index: 0, type: "normal", power: 50 }),
      move({ index: 1, type: "normal", power: 80, pp: 0 }), // unusable
      move({ index: 2, type: "normal", power: 60 }),
    ]);
    const ranked = rankedMoves(lead, mon([], []));
    expect(ranked).toEqual([2, 0]); // 60 then 50; the 80-power move is out of PP
    // The retry layer would pick ranked[gen % len] — e.g. gen 1 → the 2nd-best.
    expect(ranked[1 % ranked.length]).toBe(0);
  });

  it("returns empty when nothing is usable", () => {
    expect(rankedMoves(mon([], []), mon([], []))).toEqual([]);
  });
});
