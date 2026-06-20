// Host-seam bridge for live policy hot-swap.
//
// PROBLEM: a hot-swapped policy bundle (dist/policy.hot.js) is a separate IIFE. If it re-bundled
// the stateful seam modules (config, input, bridge, catch, retry) it would get FRESH copies —
// a different config object, a different actionsSent counter, a different catch/retry budget —
// disconnected from the running game. The swap would silently break pacing, counters and budgets.
//
// SOLUTION: the HOST bundle (main.ts) publishes its live singletons here on globalThis.__hostSeam.
// The hot bundle does NOT bundle those modules; build.mjs aliases them to thin shims
// (src/seam-shims/*) that simply re-export from globalThis.__hostSeam. So the swapped policy shares
// the exact live config/input/bridge/catch/retry the engine is using — true resume-in-place.
//
// This module is imported for its side effect by main.ts. It must list EVERY stateful binding the
// policy reaches through the seam modules.

import * as bridge from "./bridge";
import * as input from "./input";
import * as catchMod from "./catch";
import * as retry from "./retry";
import * as roster from "./roster";
import { config } from "./config";

/** The live singletons the hot policy bundle reads through its shims. */
export interface HostSeam {
  config: typeof config;
  bridge: typeof bridge;
  input: typeof input;
  catch: typeof catchMod;
  retry: typeof retry;
  roster: typeof roster;
}

export function publishHostSeam(): void {
  (globalThis as any).__hostSeam = {
    config,
    bridge,
    input,
    catch: catchMod,
    retry,
    roster,
  } satisfies HostSeam;
}
