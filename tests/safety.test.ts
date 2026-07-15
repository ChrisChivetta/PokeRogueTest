import { describe, it, expect, beforeEach } from "vitest";
import { checkRunSafety, resetSafety } from "../src/safety";
import { config } from "../src/config";
import type { GameSnapshot } from "../src/state";

const snap = (battle: any): GameSnapshot =>
  ({ ready: true, uiMode: "COMMAND", battle, playerParty: [], enemyParty: [] } as any);
const wave = (waveIndex: number, turn: number) => snap({ waveIndex, turn });

beforeEach(() => {
  resetSafety();
  config.maxTurnsPerWave = 80;
  config.maxWallClockPerRunMs = 60 * 60 * 1000;
});

describe("checkRunSafety", () => {
  it("does not halt during normal play", () => {
    expect(checkRunSafety(wave(1, 3), 1000).halt).toBe(false);
    expect(checkRunSafety(wave(1, 10), 2000).halt).toBe(false);
    expect(checkRunSafety(wave(2, 1), 3000).halt).toBe(false);
  });

  it("never halts when not in a battle", () => {
    expect(checkRunSafety(snap(null), 999999999).halt).toBe(false);
  });

  it("halts when a single wave runs too many turns (stuck battle)", () => {
    config.maxTurnsPerWave = 5;
    expect(checkRunSafety(wave(3, 5), 1000).halt).toBe(false);
    const v = checkRunSafety(wave(3, 6), 1100);
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/wave 3/);
  });

  it("resets the turn peak when the wave advances", () => {
    config.maxTurnsPerWave = 5;
    checkRunSafety(wave(3, 5), 1000);
    // New wave → counter resets, so a few turns there is fine.
    expect(checkRunSafety(wave(4, 3), 1100).halt).toBe(false);
  });

  it("halts when the run exceeds the wall-clock cap", () => {
    config.maxWallClockPerRunMs = 10_000;
    expect(checkRunSafety(wave(1, 1), 1000).halt).toBe(false); // starts the clock at t=1000
    expect(checkRunSafety(wave(5, 1), 5000).halt).toBe(false);
    const v = checkRunSafety(wave(9, 1), 1000 + 10_001);
    expect(v.halt).toBe(true);
    expect(v.reason).toMatch(/wall-clock/);
  });

  it("starts a fresh wall-clock after reset (between runs)", () => {
    config.maxWallClockPerRunMs = 10_000;
    checkRunSafety(wave(1, 1), 1000);
    resetSafety();
    // A new run far later in absolute time should not instantly trip the cap.
    expect(checkRunSafety(wave(1, 1), 1_000_000).halt).toBe(false);
  });
});
