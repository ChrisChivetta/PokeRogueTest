import { describe, it, expect } from "vitest";
import { planRun, summarizeProgress } from "../src/orchestrator";
import type { StarterInfo } from "../src/team";

const mk = (speciesId: number, cost: number, ribboned = false, carryRank: number | null = null): StarterInfo =>
  ({ speciesId, cost, ribboned, carryRank });

describe("planRun", () => {
  it("reports progress and plans a productive team while ribbons remain", () => {
    const roster = [mk(909, 4, false, 0), mk(10, 1, true), mk(11, 1, false), mk(12, 1, false)];
    const plan = planRun(roster);
    expect(plan.ownedCount).toBe(4);
    expect(plan.ribbonedCount).toBe(1);
    expect(plan.remaining).toBe(3);
    expect(plan.done).toBe(false);
    expect(plan.productive).toBe(true);
    expect(plan.team.carry!.speciesId).toBe(909);
  });

  it("flags completion when every owned line is ribboned", () => {
    const roster = [mk(909, 4, true, 0), mk(10, 1, true)];
    const plan = planRun(roster);
    expect(plan.remaining).toBe(0);
    expect(plan.done).toBe(true);
    expect(plan.productive).toBe(false); // nothing new to earn
  });

  it("is not done on an empty roster", () => {
    const plan = planRun([]);
    expect(plan.done).toBe(false);
    expect(plan.ownedCount).toBe(0);
  });

  it("a run with only a ribboned carry and no new passengers is unproductive", () => {
    // Carry already ribboned, every other owned mon ribboned too → fill adds bodies but 0 new.
    const roster = [mk(909, 4, true, 0), mk(10, 1, true), mk(11, 1, true)];
    const plan = planRun(roster);
    expect(plan.team.newRibbons).toBe(0);
    expect(plan.productive).toBe(false);
  });

  it("summarizes progress for the log", () => {
    const plan = planRun([mk(909, 4, false, 0), mk(11, 1, false)]);
    const line = summarizeProgress(plan);
    expect(line).toContain("ribboned 0/2");
    expect(line).toContain("carry #909");
  });
});
