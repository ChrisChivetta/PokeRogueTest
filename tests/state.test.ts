import { describe, it, expect } from "vitest";
import { readPokeballCounts } from "../src/state";

// The game stores pokeballCounts as a `Record<PokeballType, number>` — a PLAIN OBJECT keyed by the
// numeric enum value ({0:5,1:0,…}), NOT an array. The old `Array.isArray` read missed it and the
// bot believed it had zero balls ("no balls in stock") so it never threw one. These lock in the
// object-form read so the regression can't return.
describe("readPokeballCounts", () => {
  it("reads the game's object form (Record keyed by enum index) positionally 0..4", () => {
    // The real default at run start: 5 Poké Balls, nothing else.
    expect(readPokeballCounts({ 0: 5, 1: 0, 2: 0, 3: 0, 4: 0 })).toEqual([5, 0, 0, 0, 0]);
  });

  it("reads a full object form across all ball tiers", () => {
    expect(readPokeballCounts({ 0: 5, 1: 3, 2: 2, 3: 1, 4: 1 })).toEqual([5, 3, 2, 1, 1]);
  });

  it("still reads a plain array form (defensive)", () => {
    expect(readPokeballCounts([5, 5, 5, 5, 1])).toEqual([5, 5, 5, 5, 1]);
  });

  it("treats missing / non-numeric slots as 0", () => {
    expect(readPokeballCounts({ 0: 5 })).toEqual([5, 0, 0, 0, 0]);
    expect(readPokeballCounts({ 0: "x", 1: null })).toEqual([0, 0, 0, 0, 0]);
  });

  it("returns null only for pre-init / non-object input", () => {
    expect(readPokeballCounts(null)).toBeNull();
    expect(readPokeballCounts(undefined)).toBeNull();
    expect(readPokeballCounts(42)).toBeNull();
  });

  it("yields a bag the catch logic sees as non-empty (the bug's symptom flips)", () => {
    const bag = readPokeballCounts({ 0: 5, 1: 0, 2: 0, 3: 0, 4: 0 })!;
    expect(bag.some((c) => c > 0)).toBe(true); // mirrors hasAnyBall in catch.ts
  });
});
