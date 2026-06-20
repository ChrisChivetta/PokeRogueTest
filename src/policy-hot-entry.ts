// Entry point for the HOT-SWAPPABLE policy bundle (built by build.mjs → dist/policy.hot.js).
//
// This bundles the policy decision logic (policy.ts + its pure deps) into a standalone IIFE whose
// only side effect is to publish the current `step` for the live registry to pick up. The running
// page evaluates this source via autoRibbon.reloadPolicy(src); policy-registry.applyPolicyModule
// then reads globalThis.__policyModule and swaps it in — no page reload, the run resumes in place.
//
// IMPORTANT: keep this bundle's surface to the policy + PURE modules (no bridge/input mutation at
// import time). It shares the live page's globals (Phaser scene, etc.) but must not re-initialize
// the engine seam — only the decision function is being replaced.

import { step } from "./policy";

(globalThis as any).__policyModule = { step };
