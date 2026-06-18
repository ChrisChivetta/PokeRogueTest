import { describe, it, expect, beforeEach } from "vitest";
import { shouldRetry, noteRetry, noteWave, retryGeneration, resetRetry } from "../src/retry";
import { config } from "../src/config";

beforeEach(() => {
  resetRetry();
  config.maxRetriesPerWave = 3;
});

describe("retry budget + generation", () => {
  it("starts at generation 0 and allows retries up to the cap", () => {
    expect(retryGeneration()).toBe(0);
    expect(shouldRetry()).toBe(true);
    noteRetry();
    expect(retryGeneration()).toBe(1);
    noteRetry();
    noteRetry();
    expect(retryGeneration()).toBe(3);
    expect(shouldRetry()).toBe(false); // 3 retries spent, cap reached
  });

  it("never retries when the cap is 0", () => {
    config.maxRetriesPerWave = 0;
    expect(shouldRetry()).toBe(false);
  });

  it("resets the budget + generation when the run progresses to a new wave", () => {
    noteWave(5);
    noteRetry();
    noteRetry();
    expect(retryGeneration()).toBe(2);
    noteWave(6); // cleared wave 5 → fresh budget for wave 6
    expect(retryGeneration()).toBe(0);
    expect(shouldRetry()).toBe(true);
  });

  it("does not reset on the same wave (so retries of one wave accumulate)", () => {
    noteWave(5);
    noteRetry();
    noteWave(5); // still wave 5 (a retry reloads the same wave)
    expect(retryGeneration()).toBe(1);
  });

  it("does not reset when the wave number goes backwards (a reload to the same wall)", () => {
    noteWave(10);
    noteRetry();
    noteWave(10);
    expect(retryGeneration()).toBe(1);
  });

  it("resetRetry clears everything", () => {
    noteWave(5);
    noteRetry();
    resetRetry();
    expect(retryGeneration()).toBe(0);
    expect(shouldRetry()).toBe(true);
  });
});
