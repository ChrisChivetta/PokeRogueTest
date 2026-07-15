// Entry point for the HOT-SWAPPABLE strategy bundle (built by build.mjs → dist/strategy.hot.js).
//
// This bundles the meta-loop's UI-driving + planning adapters (execution.ts + orchestrator.ts + their
// pure deps) into a standalone IIFE whose only side effect is to publish the current adapter set for
// the live registry to pick up. The running page evaluates this source via autoRibbon.reloadStrategy(src);
// strategy-registry.applyStrategyModule then reads globalThis.__strategyModule and swaps it in — no
// page reload, the run resumes in place (starter-select phase state lives on the host seam).
//
// IMPORTANT: keep this bundle's surface to execution/orchestrator + PURE modules. The stateful seam
// modules (bridge/input/config/roster/exec-state) are aliased to shims by build.mjs so the swapped
// adapters share the host's live singletons rather than re-initializing them.

import { driveStartRun, driveStarterSelect } from "./execution";
import { planRun } from "./orchestrator";

(globalThis as any).__strategyModule = { driveStartRun, driveStarterSelect, planRun };
