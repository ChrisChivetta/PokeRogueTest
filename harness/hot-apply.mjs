// hot-apply — the one command the autonomous agent runs to push a policy fix into a LIVE soak.
//
// After editing src/policy.ts (or a pure sub-module), run:
//     node harness/hot-apply.mjs
// It (1) typechecks, (2) runs the policy tests, (3) rebuilds ONLY dist/policy.hot.js, then
// (4) drops the reload sentinel the running soak watches (SOAK_HOT_RELOAD=1). The soak live-swaps
// the new policy and resumes from the stalled wave/phase — no browser restart, no run lost.
//
// Gates 1-2 mean a broken patch never reaches the page; even if one slipped through, the in-page
// registry rejects a non-functional bundle and keeps the prior policy. Pass --force to skip tests
// (NOT recommended) or --signal-only to just re-drop the sentinel without rebuilding.
import { execSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";

const SIGNAL = process.env.SOAK_RELOAD_SIGNAL ?? "policy-reload.signal";
const HOT = "dist/policy.hot.js";
const force = process.argv.includes("--force");
const signalOnly = process.argv.includes("--signal-only");

function run(cmd, label) {
  process.stdout.write(`[hot-apply] ${label} … `);
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
  if (!existsSync(HOT)) { console.error(`[hot-apply] ${HOT} missing — build first.`); process.exit(1); }
  writeFileSync(SIGNAL, new Date().toISOString());
  console.log(`[hot-apply] dropped ${SIGNAL} (signal-only).`);
  process.exit(0);
}

run("npm run typecheck", "typecheck");
if (!force) run("npx vitest run tests/policy.test.ts tests/learnmove.test.ts tests/policy-registry.test.ts", "policy tests");
run("node build.mjs --hot-only", "build hot bundle");

writeFileSync(SIGNAL, new Date().toISOString());
console.log(`[hot-apply] dropped ${SIGNAL} → live soak will hot-swap on its next sample (≤5s).`);
