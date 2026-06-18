import { describe, it, expect } from "vitest";
import { selectTeam, CARRY_RANK, type StarterInfo } from "../src/team";

const mk = (speciesId: number, cost: number, ribboned = false, carryRank: number | null = null): StarterInfo =>
  ({ speciesId, cost, ribboned, carryRank });

const ids = (p: { team: StarterInfo[] }) => p.team.map((s) => s.speciesId);

describe("selectTeam", () => {
  it("returns an empty plan for an empty roster", () => {
    const p = selectTeam([]);
    expect(p.team).toEqual([]);
    expect(p.carry).toBeNull();
  });

  it("picks the cheapest owned shortlist carry", () => {
    const roster = [mk(909, 6, false, 0), mk(1, 3, false, 3), mk(50, 1)];
    const p = selectTeam(roster, { fillWithRibboned: false });
    expect(p.carry!.speciesId).toBe(1); // Bulbasaur cheaper than Fuecoco despite worse rank
  });

  it("breaks carry ties by un-ribboned then by rank", () => {
    const roster = [mk(909, 3, true, 0), mk(1, 3, false, 3)];
    const p = selectTeam(roster, { fillWithRibboned: false });
    expect(p.carry!.speciesId).toBe(1); // same cost → prefer the un-ribboned carry
  });

  it("fills the rest with the cheapest un-ribboned passengers, within budget and size", () => {
    const roster = [
      mk(909, 4, false, 0), // carry
      mk(10, 1), mk(11, 1), mk(12, 1), mk(13, 1), mk(14, 1), mk(15, 1), // six cheap passengers
    ];
    const p = selectTeam(roster, { fillWithRibboned: false });
    expect(p.carry!.speciesId).toBe(909);
    expect(p.team.length).toBe(6); // capped at team size
    expect(p.totalCost).toBeLessThanOrEqual(10);
    expect(p.passengers.every((s) => !s.ribboned)).toBe(true);
  });

  it("never exceeds the point budget", () => {
    const roster = [mk(909, 5, false, 0), mk(10, 4), mk(11, 4), mk(12, 4)];
    const p = selectTeam(roster, { fillWithRibboned: false });
    expect(p.totalCost).toBeLessThanOrEqual(10);
    // 5 + 4 = 9 fits one passenger; a second 4 would be 13 → excluded.
    expect(p.team.length).toBe(2);
  });

  it("prefers un-ribboned passengers; counts fresh ribbons", () => {
    const roster = [mk(909, 4, false, 0), mk(10, 1, true), mk(11, 1, false), mk(12, 1, false)];
    const p = selectTeam(roster, { fillWithRibboned: false });
    // both un-ribboned cheap passengers chosen; the ribboned one skipped (fill disabled)
    expect(ids(p).sort()).toEqual([11, 12, 909]);
    expect(p.newRibbons).toBe(3); // carry + 2 passengers are all un-ribboned
  });

  it("uses leftover budget on ribboned bodies only when filling is enabled", () => {
    const roster = [mk(909, 4, false, 0), mk(11, 1, false), mk(20, 1, true), mk(21, 1, true)];
    const noFill = selectTeam(roster, { fillWithRibboned: false });
    expect(ids(noFill).sort()).toEqual([11, 909]); // only the un-ribboned passenger

    const fill = selectTeam(roster, { fillWithRibboned: true });
    expect(fill.team.length).toBe(4); // ribboned bodies added for resilience
    expect(fill.newRibbons).toBe(2); // …but they don't add to fresh-ribbon count
  });

  it("falls back to the cheapest owned mon as lead when no carry is owned", () => {
    const roster = [mk(500, 5), mk(501, 2), mk(502, 3)];
    const p = selectTeam(roster, { fillWithRibboned: false });
    expect(p.carry!.speciesId).toBe(501); // cheapest stands in as the lead
  });

  it("handles fractional (cost-reduced) carries", () => {
    const roster = [mk(909, 0.5, false, 0), mk(10, 1), mk(11, 1), mk(12, 1), mk(13, 1)];
    const p = selectTeam(roster, { fillWithRibboned: false });
    expect(p.carry!.speciesId).toBe(909);
    expect(p.team.length).toBe(5);
    expect(p.totalCost).toBeCloseTo(4.5);
  });

  it("exposes the documented carry shortlist", () => {
    expect(CARRY_RANK[909]).toBe(0); // Fuecoco is the top pick
    expect(Object.keys(CARRY_RANK).length).toBeGreaterThanOrEqual(5);
  });
});
