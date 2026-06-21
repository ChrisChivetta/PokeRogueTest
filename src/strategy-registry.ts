// Hot-swappable STRATEGY seam (the meta-loop's UI-driving + planning half).
//
// Mirrors policy-registry.ts. Where the policy decides battle inputs, the STRATEGY drives the
// out-of-battle flow: navigating the title screen into a run (driveStartRun), enacting the team plan
// in starter-select (driveStarterSelect), and computing the next run's plan (planRun). These are the
// version-fragile UI adapters most likely to wedge on a game update — so making them swappable lets
// us patch a starter-select loop and resume IN PLACE instead of restarting the whole soak.
//
// The pushed bundle is an IIFE (build.mjs → dist/strategy.hot.js) whose only job is to set
//   globalThis.__strategyModule = { driveStartRun, driveStarterSelect, planRun }
// applyStrategyModule() evaluates that source, validates the exports, and swaps it in. A bad patch is
// caught and DISCARDED — the previously-good strategy keeps driving, so a typo can never wedge the
// running soak. Starter-select phase state lives on the host seam (exec-state.ts), so a swap resumes
// mid-flow rather than re-planning.

import type { GameSnapshot } from "./state";
import type { StarterInfo, TeamOptions } from "./team";
import type { RunPlan } from "./orchestrator";
import { driveStartRun as builtinStartRun, driveStarterSelect as builtinStarterSelect } from "./execution";
import { planRun as builtinPlanRun } from "./orchestrator";
import { log } from "./log";

/** The shape a strategy module must expose to be swappable. */
export interface StrategyModule {
  driveStartRun: (s: GameSnapshot) => Promise<void>;
  driveStarterSelect: (s: GameSnapshot) => Promise<void>;
  planRun: (roster: StarterInfo[], options?: Partial<TeamOptions>) => RunPlan;
}

/** Where a pushed bundle parks its export for us to pick up. */
declare global {
  // eslint-disable-next-line no-var
  var __strategyModule: StrategyModule | undefined;
}

const builtin: StrategyModule = {
  driveStartRun: builtinStartRun,
  driveStarterSelect: builtinStarterSelect,
  planRun: builtinPlanRun,
};

let active: StrategyModule = builtin;
let version = 0; // bumps on every successful swap; 0 = built-in

/** The strategy module the main loop should call this tick. Always returns a usable module. */
export function getStrategy(): StrategyModule {
  return active;
}

/** Current strategy version (0 = the built-in strategy that shipped in the bundle). */
export function strategyVersion(): number {
  return version;
}

/** Validate a candidate module exposes the full contract (used by setStrategy + applyStrategyModule). */
function isStrategyModule(mod: any): mod is StrategyModule {
  return (
    !!mod &&
    typeof mod.driveStartRun === "function" &&
    typeof mod.driveStarterSelect === "function" &&
    typeof mod.planRun === "function"
  );
}

/** Directly install a strategy module (tests; the live path goes through applyStrategyModule). */
export function setStrategy(mod: StrategyModule): void {
  if (!isStrategyModule(mod)) throw new Error("strategy module is missing a required export");
  active = mod;
  version += 1;
}

/** Reset to the built-in strategy (test hook + a safe-rollback escape hatch). */
export function resetStrategyRegistry(): void {
  active = builtin;
  version = 0;
}

export interface ReloadResult {
  ok: boolean;
  version: number;
  error?: string;
}

/**
 * Evaluate a pushed strategy bundle and swap it in LIVE. `src` is the IIFE from dist/strategy.hot.js;
 * running it sets globalThis.__strategyModule = { driveStartRun, driveStarterSelect, planRun }. We
 * validate the exports and only then swap. On ANY failure we keep the current strategy and report the
 * error — the running loop is never left without a working set of adapters.
 *
 * SECURITY NOTE: this evaluates code we built ourselves and push over the local control channel.
 * It is the mechanism, by design, for live strategy iteration; it is not a general eval endpoint.
 */
export function applyStrategyModule(src: string): ReloadResult {
  if (typeof src !== "string" || src.length === 0) {
    return { ok: false, version, error: "empty strategy source" };
  }
  const prev = globalThis.__strategyModule;
  try {
    globalThis.__strategyModule = undefined;
    // Indirect eval → runs in global scope, so the IIFE can assign globalThis.__strategyModule.
    (0, eval)(src);
    const mod = globalThis.__strategyModule as StrategyModule | undefined;
    if (!isStrategyModule(mod)) {
      throw new Error("bundle did not export driveStartRun/driveStarterSelect/planRun");
    }
    active = mod;
    version += 1;
    log.banner(`[strategy-reload] swapped in strategy v${version} — resuming in place.`);
    return { ok: true, version };
  } catch (e) {
    // Keep the last good strategy; surface the failure so the agent can fix the patch.
    globalThis.__strategyModule = prev;
    const error = e instanceof Error ? e.message : String(e);
    log.error(`[strategy-reload] REJECTED bad patch (${error}). Keeping strategy v${version}.`);
    return { ok: false, version, error };
  }
}
