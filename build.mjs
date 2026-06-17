// Bundles src/main.ts into a single Tampermonkey userscript with the ==UserScript== banner.
// Usage: node build.mjs [--watch]
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "dist/pokerogue-auto-ribbon.user.js";

// Userscript banner. @match covers the live site AND a local clone (Phase 4 fallback).
// @grant none on purpose: we run in the page's JS context so we can reach the Phaser scene.
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
const opts = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: OUT,
  banner: { js: banner },
  legalComments: "none",
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log(`[build] watching → ${OUT}`);
} else {
  await esbuild.build(opts);
  const bytes = readFileSync(OUT).length;
  console.log(`[build] wrote ${OUT} (${(bytes / 1024).toFixed(1)} KB)`);
}
