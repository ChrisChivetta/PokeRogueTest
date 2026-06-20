// Builds two bundles:
//   1. dist/pokerogue-auto-ribbon.user.js  — the full Tampermonkey userscript (the HOST bundle).
//   2. dist/policy.hot.js                  — the HOT-SWAPPABLE policy bundle. Evaluated live by
//      autoRibbon.reloadPolicy(src) to replace the decision logic WITHOUT reloading the page.
//
// The hot bundle must SHARE the host's live seam singletons (config/input/bridge/catch/retry/
// roster) — otherwise a swapped policy would get fresh, disconnected copies and break pacing,
// counters and budgets. A resolver plugin (seamShimPlugin) redirects those imports to the thin
// global-reading shims in src/seam-shims/ ONLY in the hot build. The host build is untouched.
//
// Usage: node build.mjs [--watch]
import * as esbuild from "esbuild";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOST_OUT = "dist/pokerogue-auto-ribbon.user.js";
const HOT_OUT = "dist/policy.hot.js";

// The stateful seam modules the hot bundle must NOT re-bundle — each redirects to its shim so the
// swapped policy reaches the host's live singleton. (Pure modules — learnmove, typechart, rewards,
// shop, log, state, team, candy — are safe to re-bundle into the hot policy.)
const SEAM = new Set(["bridge", "input", "config", "catch", "retry", "roster"]);

/** esbuild plugin: when building the hot policy, swap seam imports for their global-reading shim. */
const seamShimPlugin = {
  name: "seam-shim",
  setup(build) {
    build.onResolve({ filter: /^\.\.?\// }, (args) => {
      // Only redirect bare seam modules imported from within src/ (not the shims themselves).
      if (args.importer.includes(`${"/seam-shims/"}`)) return null;
      const m = args.path.match(/^\.\.?\/(\w+)$/);
      if (!m || !SEAM.has(m[1])) return null;
      return { path: resolve(ROOT, "src/seam-shims", `${m[1]}.ts`) };
    });
  },
};

// ── HOST bundle (full userscript) ─────────────────────────────────────────────
const banner = `// ==UserScript==
// @name         PokéRogue Auto-Ribbon
// @namespace    https://github.com/chrischivetta/pokerogue-auto-ribbon
// @version      0.1.0
// @description  Unattended Classic-mode bot that ribbons every starter. Input-only, no save tampering.
// @author       Chris Chivetta
// @match        https://pokerogue.net/*
// @match        https://*.pokerogue.net/*
// @match        http://localhost:8000/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
`;

/** @type {import('esbuild').BuildOptions} */
const hostOpts = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: HOST_OUT,
  banner: { js: banner },
  legalComments: "none",
  logLevel: "info",
};

// ── HOT policy bundle ─────────────────────────────────────────────────────────
// IIFE so evaluating the source runs immediately and sets globalThis.__policyModule = { step }.
/** @type {import('esbuild').BuildOptions} */
const hotOpts = {
  entryPoints: ["src/policy-hot-entry.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: HOT_OUT,
  legalComments: "none",
  logLevel: "info",
  plugins: [seamShimPlugin],
};

const kb = (p) => (statSync(p).size / 1024).toFixed(1);

if (process.argv.includes("--watch")) {
  const hostCtx = await esbuild.context(hostOpts);
  const hotCtx = await esbuild.context(hotOpts);
  await hostCtx.watch();
  await hotCtx.watch();
  console.log(`[build] watching → ${HOST_OUT} + ${HOT_OUT}`);
} else if (process.argv.includes("--hot-only")) {
  // Fast path for the auto-iterate loop: rebuild ONLY the hot policy after a policy edit.
  await esbuild.build(hotOpts);
  console.log(`[build] wrote ${HOT_OUT} (${kb(HOT_OUT)} KB)`);
} else {
  await esbuild.build(hostOpts);
  await esbuild.build(hotOpts);
  console.log(`[build] wrote ${HOST_OUT} (${kb(HOST_OUT)} KB) + ${HOT_OUT} (${kb(HOT_OUT)} KB)`);
}
