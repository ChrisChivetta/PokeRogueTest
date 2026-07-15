import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getStrategy,
  setStrategy,
  strategyVersion,
  resetStrategyRegistry,
  applyStrategyModule,
  type StrategyModule,
} from "../src/strategy-registry";
import type { GameSnapshot } from "../src/state";

const snap = {} as GameSnapshot;

// A minimal complete strategy module for direct-set tests.
const stub = (tag: string, sink: string[]): StrategyModule => ({
  driveStartRun: async () => { sink.push(`${tag}:start`); },
  driveStarterSelect: async () => { sink.push(`${tag}:select`); },
  planRun: () => { sink.push(`${tag}:plan`); return {} as any; },
});

beforeEach(() => {
  resetStrategyRegistry();
  delete (globalThis as any).__strategyModule;
});

afterEach(() => {
  resetStrategyRegistry();
  delete (globalThis as any).__strategyModule;
});

describe("strategy registry — default + direct set", () => {
  it("starts at version 0 with a complete built-in module", () => {
    expect(strategyVersion()).toBe(0);
    const m = getStrategy();
    expect(typeof m.driveStartRun).toBe("function");
    expect(typeof m.driveStarterSelect).toBe("function");
    expect(typeof m.planRun).toBe("function");
  });

  it("setStrategy swaps the active module and bumps the version", async () => {
    const sink: string[] = [];
    setStrategy(stub("swapped", sink));
    expect(strategyVersion()).toBe(1);
    await getStrategy().driveStartRun(snap);
    await getStrategy().driveStarterSelect(snap);
    getStrategy().planRun([]);
    expect(sink).toEqual(["swapped:start", "swapped:select", "swapped:plan"]);
  });

  it("setStrategy rejects a module missing a required export", () => {
    expect(() => setStrategy({ driveStartRun: async () => {} } as any)).toThrow(/missing a required export/);
    expect(strategyVersion()).toBe(0);
  });

  it("resetStrategyRegistry restores the built-in and zeroes the version", () => {
    setStrategy(stub("x", []));
    expect(strategyVersion()).toBe(1);
    resetStrategyRegistry();
    expect(strategyVersion()).toBe(0);
    expect(typeof getStrategy().planRun).toBe("function");
  });
});

describe("applyStrategyModule — live hot swap from bundle source", () => {
  it("evaluates an IIFE that sets __strategyModule and swaps it in", async () => {
    const calls: string[] = [];
    (globalThis as any).__hotProbe = () => calls.push("hot");
    const src = `(() => { globalThis.__strategyModule = {
      driveStartRun: async () => { globalThis.__hotProbe(); },
      driveStarterSelect: async () => {},
      planRun: () => ({}),
    }; })();`;
    const res = applyStrategyModule(src);
    expect(res.ok).toBe(true);
    expect(res.version).toBe(1);
    expect(strategyVersion()).toBe(1);
    await getStrategy().driveStartRun(snap);
    expect(calls).toEqual(["hot"]);
    delete (globalThis as any).__hotProbe;
  });

  it("bumps the version on each successful swap", () => {
    const mk = (n: number) =>
      `(() => { globalThis.__strategyModule = {
        driveStartRun: async () => ${n},
        driveStarterSelect: async () => ${n},
        planRun: () => ({}),
      }; })();`;
    expect(applyStrategyModule(mk(1)).version).toBe(1);
    expect(applyStrategyModule(mk(2)).version).toBe(2);
    expect(strategyVersion()).toBe(2);
  });

  it("rejects empty source and keeps the current strategy", () => {
    const res = applyStrategyModule("");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/empty/);
    expect(strategyVersion()).toBe(0);
  });

  it("rejects a bundle missing an export and keeps the last good strategy", async () => {
    const good: string[] = [];
    (globalThis as any).__goodProbe = () => good.push("good");
    applyStrategyModule(`(() => { globalThis.__strategyModule = {
      driveStartRun: async () => globalThis.__goodProbe(),
      driveStarterSelect: async () => {},
      planRun: () => ({}),
    }; })();`);
    expect(strategyVersion()).toBe(1);

    // Missing planRun → must be rejected.
    const res = applyStrategyModule(`(() => { globalThis.__strategyModule = {
      driveStartRun: async () => {},
      driveStarterSelect: async () => {},
    }; })();`);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/driveStartRun\/driveStarterSelect\/planRun/);
    expect(strategyVersion()).toBe(1); // unchanged

    // The good v1 strategy is still the one driving.
    await getStrategy().driveStartRun(snap);
    expect(good).toEqual(["good"]);
    delete (globalThis as any).__goodProbe;
  });

  it("rejects source that throws on eval and keeps the last good strategy", async () => {
    const good: string[] = [];
    (globalThis as any).__g2 = () => good.push("g2");
    applyStrategyModule(`(() => { globalThis.__strategyModule = {
      driveStartRun: async () => globalThis.__g2(),
      driveStarterSelect: async () => {},
      planRun: () => ({}),
    }; })();`);
    expect(strategyVersion()).toBe(1);

    const res = applyStrategyModule(`throw new Error("boom in patch");`);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/boom/);
    expect(strategyVersion()).toBe(1);

    await getStrategy().driveStartRun(snap);
    expect(good).toEqual(["g2"]);
    delete (globalThis as any).__g2;
  });
});
