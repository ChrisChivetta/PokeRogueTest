// Hot-swappable policy seam.
//
// The game engine (the live Phaser BattleScene) and the policy (our decision logic) only ever
// touch through readState() in and press() out. That clean boundary lets us REPLACE the policy
// at runtime without reloading the page: the scene keeps running, and the next tick simply calls
// whatever `step` is currently registered here. This is what makes "fix a loop and resume in
// place" possible — we patch the decision function, push a freshly-built policy bundle into the
// live page, swap it in, and the run continues from the exact wave/phase it stalled on.
//
// The pushed bundle is an IIFE (built by build.mjs → dist/policy.hot.js) whose only job is to set
//   globalThis.__policyModule = { step }
// applyPolicyModule() evaluates that source, validates the export, and swaps it in. A bad patch is
// caught and DISCARDED — the previously-good policy keeps driving, so a typo in a hot patch can
// never wedge or crash the running soak.

import type { GameSnapshot } from "./state";
import { step as builtinStep } from "./policy";
import { log } from "./log";

/** The shape a policy module must expose to be swappable. */
export interface PolicyModule {
  step: (s: GameSnapshot) => Promise<void>;
}

/** Where a pushed bundle parks its export for us to pick up. */
declare global {
  // eslint-disable-next-line no-var
  var __policyModule: PolicyModule | undefined;
}

let active: PolicyModule = { step: builtinStep };
let version = 0; // bumps on every successful swap; 0 = built-in

/** The policy `step` the main loop should call this tick. Always returns a usable function. */
export function getPolicy(): (s: GameSnapshot) => Promise<void> {
  return active.step;
}

/** Current policy version (0 = the built-in policy that shipped in the bundle). */
export function policyVersion(): number {
  return version;
}

/** Directly install a policy module (used by tests; the live path goes through applyPolicyModule). */
export function setPolicy(mod: PolicyModule): void {
  if (typeof mod?.step !== "function") throw new Error("policy module has no step()");
  active = mod;
  version += 1;
}

/** Reset to the built-in policy (test hook + a safe-rollback escape hatch). */
export function resetPolicyRegistry(): void {
  active = { step: builtinStep };
  version = 0;
}

export interface ReloadResult {
  ok: boolean;
  version: number;
  error?: string;
}

/**
 * Evaluate a pushed policy bundle and swap it in LIVE. `src` is the IIFE from dist/policy.hot.js;
 * running it sets globalThis.__policyModule = { step }. We validate the export and only then swap.
 * On ANY failure we keep the current policy and report the error — the running loop is never left
 * without a working `step`.
 *
 * SECURITY NOTE: this evaluates code we built ourselves and push over the local control channel.
 * It is the mechanism, by design, for live policy iteration; it is not a general eval endpoint.
 */
export function applyPolicyModule(src: string): ReloadResult {
  if (typeof src !== "string" || src.length === 0) {
    return { ok: false, version, error: "empty policy source" };
  }
  const prev = globalThis.__policyModule;
  try {
    globalThis.__policyModule = undefined;
    // Indirect eval → runs in global scope, so the IIFE can assign globalThis.__policyModule.
    (0, eval)(src);
    const mod = globalThis.__policyModule as PolicyModule | undefined;
    if (!mod || typeof mod.step !== "function") {
      throw new Error("bundle did not export a step() function");
    }
    active = mod;
    version += 1;
    log.banner(`[policy-reload] swapped in policy v${version} — resuming in place.`);
    return { ok: true, version };
  } catch (e) {
    // Keep the last good policy; surface the failure so the agent can fix the patch.
    globalThis.__policyModule = prev;
    const error = e instanceof Error ? e.message : String(e);
    log.error(`[policy-reload] REJECTED bad patch (${error}). Keeping policy v${version}.`);
    return { ok: false, version, error };
  }
}
