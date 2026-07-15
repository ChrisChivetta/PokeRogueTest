// hot-apply-strategy — the one command the autonomous agent runs to push a STRATEGY fix into a LIVE soak.
//
// After editing src/execution.ts (the UI-driving adapters) or a pure planning sub-module
// (orchestrator/team/candy), run:
//     node harness/hot-apply-strategy.mjs
// It (1) typechecks, (2) runs the strategy/planning tests, (3) rebuilds ONLY dist/strategy.hot.js,
// then (4) drops the strategy reload sentinel the running soak watches (SOAK_HOT_RELOAD=1). The soak
// live-swaps the new strategy and resumes in place — an in-flight starter-select continues mid-flow
// (its phase state lives on the host seam) — no browser restart, no run lost.
//
// Gates 1-2 mean a broken patch never reaches the page; even if one slipped through, the in-page
// registry rejects a non-functional bundle and keeps the prior strategy. Pass --force to skip tests
// (NOT recommended) or --signal-only to just re-drop the sentinel without rebuilding.
import { execSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";

const SIGNAL = process.env.SOAK_STRATEGY_RELOAD_SIGNAL ?? "strategy-reload.signal";
const HOT = "dist/strategy.hot.js";
const force = process.argv.includes("--force");
const signalOnly = process.argv.includes("--signal-only");

function run(cmd, label) {
  process.stdout.write(`[hot-apply-strategy] ${label} … `);
  try {
    execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] });
    console.log("ok");
  } catch (e) {
    console.log("FAILED");
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.toString().trim();
    if (out) console.error(out.split("\n").slice(-30).join("\n"));
    process.exit(1);
  }
}

if (signalOnly) {
  if (!existsSync(HOT)) { console.error(`[hot-apply-strategy] ${HOT} missing — build first.`); process.exit(1); }
  writeFileSync(SIGNAL, new Date().toISOString());
  console.log(`[hot-apply-strategy] dropped ${SIGNAL} (signal-only).`);
  process.exit(0);
}

run("npm run typecheck", "typecheck");
if (!force) run("npx vitest run tests/team.test.ts tests/orchestrator.test.ts tests/strategy-registry.test.ts", "strategy tests");
run("node build.mjs --strategy-only", "build strategy bundle");

writeFileSync(SIGNAL, new Date().toISOString());
console.log(`[hot-apply-strategy] dropped ${SIGNAL} → live soak will hot-swap on its next sample (≤5s).`);
