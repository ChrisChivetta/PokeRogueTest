import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getPolicy,
  setPolicy,
  policyVersion,
  resetPolicyRegistry,
  applyPolicyModule,
} from "../src/policy-registry";
import type { GameSnapshot } from "../src/state";

const snap = {} as GameSnapshot;

beforeEach(() => {
  resetPolicyRegistry();
  delete (globalThis as any).__policyModule;
});

afterEach(() => {
  resetPolicyRegistry();
  delete (globalThis as any).__policyModule;
});

describe("policy registry — default + direct set", () => {
  it("starts at version 0 with a callable built-in step", () => {
    expect(policyVersion()).toBe(0);
    expect(typeof getPolicy()).toBe("function");
  });

  it("setPolicy swaps the active step and bumps the version", async () => {
    const calls: string[] = [];
    setPolicy({ step: async () => { calls.push("swapped"); } });
    expect(policyVersion()).toBe(1);
    await getPolicy()(snap);
    expect(calls).toEqual(["swapped"]);
  });

  it("setPolicy rejects a module with no step()", () => {
    expect(() => setPolicy({} as any)).toThrow(/no step/);
    // Version unchanged, built-in still active.
    expect(policyVersion()).toBe(0);
  });

  it("resetPolicyRegistry restores the built-in and zeroes the version", async () => {
    setPolicy({ step: async () => {} });
    expect(policyVersion()).toBe(1);
    resetPolicyRegistry();
    expect(policyVersion()).toBe(0);
    expect(typeof getPolicy()).toBe("function");
  });
});

describe("applyPolicyModule — live hot swap from bundle source", () => {
  it("evaluates an IIFE that sets __policyModule and swaps it in", async () => {
    const calls: string[] = [];
    (globalThis as any).__hotProbe = () => calls.push("hot");
    const src = `(() => { globalThis.__policyModule = { step: async () => { globalThis.__hotProbe(); } }; })();`;
    const res = applyPolicyModule(src);
    expect(res.ok).toBe(true);
    expect(res.version).toBe(1);
    expect(policyVersion()).toBe(1);
    await getPolicy()(snap);
    expect(calls).toEqual(["hot"]);
    delete (globalThis as any).__hotProbe;
  });

  it("bumps the version on each successful swap", () => {
    const mk = (n: number) =>
      `(() => { globalThis.__policyModule = { step: async () => ${n} }; })();`;
    expect(applyPolicyModule(mk(1)).version).toBe(1);
    expect(applyPolicyModule(mk(2)).version).toBe(2);
    expect(policyVersion()).toBe(2);
  });

  it("rejects empty source and keeps the current policy", () => {
    const res = applyPolicyModule("");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/empty/);
    expect(policyVersion()).toBe(0);
  });

  it("rejects a bundle that does not export step() and keeps the last good policy", async () => {
    // First land a good v1 so we can prove it survives a later bad patch.
    const good: string[] = [];
    (globalThis as any).__goodProbe = () => good.push("good");
    applyPolicyModule(`(() => { globalThis.__policyModule = { step: async () => globalThis.__goodProbe() }; })();`);
    expect(policyVersion()).toBe(1);

    const res = applyPolicyModule(`(() => { globalThis.__policyModule = { notStep: 1 }; })();`);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/step\(\)/);
    expect(policyVersion()).toBe(1); // unchanged

    // The good v1 policy is still the one driving.
    await getPolicy()(snap);
    expect(good).toEqual(["good"]);
    delete (globalThis as any).__goodProbe;
  });

  it("rejects source that throws on eval and keeps the last good policy", async () => {
    const good: string[] = [];
    (globalThis as any).__g2 = () => good.push("g2");
    applyPolicyModule(`(() => { globalThis.__policyModule = { step: async () => globalThis.__g2() }; })();`);
    expect(policyVersion()).toBe(1);

    const res = applyPolicyModule(`throw new Error("boom in patch");`);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/boom/);
    expect(policyVersion()).toBe(1);

    await getPolicy()(snap);
    expect(good).toEqual(["g2"]);
    delete (globalThis as any).__g2;
  });
});
