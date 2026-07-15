import { describe, it, expect } from "vitest";
import { planCandy, nextReductionCost, MAX_VALUE_REDUCTION, type CandyStarter } from "../src/candy";

const mk = (o: Partial<CandyStarter>): CandyStarter =>
  ({ speciesId: 1, baseCost: 4, candyCount: 0, valueReduction: 0, isCarry: false, ...o });

describe("nextReductionCost", () => {
  it("reads the per-base-cost candy table", () => {
    expect(nextReductionCost(4, 0)).toBe(15); // base cost 4: 1st reduction = 15 candy
    expect(nextReductionCost(4, 1)).toBe(40); // 2nd reduction = 40
  });

  it("returns null once fully reduced", () => {
    expect(nextReductionCost(4, MAX_VALUE_REDUCTION)).toBeNull();
  });
});

describe("planCandy", () => {
  it("recommends a reduction the species can afford", () => {
    const actions = planCandy([mk({ speciesId: 909, baseCost: 4, candyCount: 20, isCarry: true })]);
    expect(actions).toEqual([{ speciesId: 909, spend: 15, fromReduction: 0, toReduction: 1 }]);
  });

  it("chains both reductions when candy covers them", () => {
    // base 4: 15 then 40 = 55 total; 60 candy covers both.
    const actions = planCandy([mk({ speciesId: 909, baseCost: 4, candyCount: 60, isCarry: true })]);
    expect(actions.map((a) => a.toReduction)).toEqual([1, 2]);
    expect(actions.reduce((n, a) => n + a.spend, 0)).toBe(55);
  });

  it("recommends nothing when candy is short or the species is maxed", () => {
    expect(planCandy([mk({ baseCost: 4, candyCount: 10 })])).toEqual([]); // < 15
    expect(planCandy([mk({ baseCost: 4, candyCount: 999, valueReduction: 2 })])).toEqual([]); // maxed
  });

  it("prioritises carries before passengers in the output order", () => {
    const actions = planCandy([
      mk({ speciesId: 50, baseCost: 4, candyCount: 15, isCarry: false }),
      mk({ speciesId: 909, baseCost: 4, candyCount: 15, isCarry: true }),
    ]);
    expect(actions.map((a) => a.speciesId)).toEqual([909, 50]); // carry first
  });

  it("spends only each species' own candy (independent budgets)", () => {
    const actions = planCandy([
      mk({ speciesId: 909, baseCost: 4, candyCount: 15, isCarry: true }), // affords 1
      mk({ speciesId: 50, baseCost: 4, candyCount: 5, isCarry: false }), //  affords 0
    ]);
    expect(actions.map((a) => a.speciesId)).toEqual([909]);
  });
});
