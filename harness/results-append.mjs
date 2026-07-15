#!/usr/bin/env node
// Phase H1 (docs/PLAN-V2.md §5): turn a headless-soak JSONL file into a RESULTS.md entry,
// automatically, in the format RESULTS.md's own template prescribes — the measurement discipline
// the June effort designed for itself but never once exercised (its baseline entry is still blank
// underscores after 14+ hours of soaking). No more excuse to skip it: this script IS the loop.
//
// Usage: node harness/results-append.mjs <soak.jsonl> --label "<one-line change>" [--kept|--reverted]
//                                         [--hypothesis "..."] [--note "..."] [--commit <sha>]
//
// Reads one JSON object per line: {seed, deathWave, clear, durationMs, party, retriesUsed, lastPhase}
// (see tests/integration/headless-soak.test.ts). Computes median death wave (wipes only — a clear
// has no death wave), clear/wipe counts, max wave reached, and the same depth histogram format
// harness/soak.mjs's FINAL block uses, then prepends a filled-in template block to RESULTS.md.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--kept") out.outcome = "KEPT";
    else if (a === "--reverted") out.outcome = "REVERTED";
    else if (a.startsWith("--")) { out[a.slice(2)] = argv[++i]; }
    else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const jsonlPath = args._[0];
if (!jsonlPath) {
  console.error("Usage: node harness/results-append.mjs <soak.jsonl> --label \"<change>\" [--kept|--reverted] [--hypothesis ...] [--note ...] [--commit <sha>]");
  process.exit(1);
}
if (!existsSync(jsonlPath)) {
  console.error(`No such file: ${jsonlPath}`);
  process.exit(1);
}

const label = args.label ?? "baseline (no change yet)";
const outcome = args.outcome ?? null; // null for the very first baseline entry (no verdict yet)
const hypothesis = args.hypothesis ?? "establish where unmodified play dies.";
const note = args.note ?? "";
const commit = args.commit ?? (() => {
  try { return execSync("git rev-parse --short HEAD", { cwd: new URL("..", import.meta.url).pathname }).toString().trim(); }
  catch { return "?"; }
})();

const lines = readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean);
const records = lines.map((l) => JSON.parse(l));
if (records.length === 0) {
  console.error(`${jsonlPath} has no records — nothing to summarize.`);
  process.exit(1);
}

const clears = records.filter((r) => r.clear);
const wipes = records.filter((r) => !r.clear);
const deathWaves = wipes.map((r) => r.deathWave).filter((w) => w != null);

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Same bucketing as harness/soak.mjs's waveHistogram(), so a live-soak FINAL block and a
// headless-soak RESULTS.md entry are directly comparable at a glance.
function histogram() {
  const buckets = [[1, 10], [11, 25], [26, 50], [51, 100], [101, 150], [151, 199], [200, 999]];
  const labels = ["1-10", "11-25", "26-50", "51-100", "101-150", "151-199", "200+(clear)"];
  const depths = records.map((r) => r.clear ? 200 : (r.deathWave ?? 0));
  const counts = buckets.map(([lo, hi]) => depths.filter((d) => d >= lo && d <= hi).length);
  return labels.map((l, i) => `${l}:${counts[i]}`).join(" ");
}

const medianDeathWave = median(deathWaves);
const maxWave = Math.max(...records.map((r) => r.clear ? 200 : (r.deathWave ?? 0)));
const outcomeTag = outcome ? `   [${outcome}]` : "";
const today = args.date ?? new Date().toISOString().slice(0, 10);

const entry = `## ${today} — ${label}${outcomeTag}
- **hypothesis:** ${hypothesis}
- **median death wave:** ${medianDeathWave ?? "n/a (no wipes)"}   ·   **clears/wipes:** ${clears.length}/${wipes.length}   ·   **max wave:** ${maxWave}
- **depth histogram:** ${histogram()}
- **soak:** headless, ${records.length} seeded runs   ·   **commit:** ${commit}
- **note:** ${note || `${jsonlPath}, ${records.length} seeds.`}
`;

const resultsPath = new URL("../RESULTS.md", import.meta.url).pathname;
const existing = readFileSync(resultsPath, "utf8");

// Insert right after the intro + template comment block (the doc's own "newest at the top" rule),
// i.e. before the first "## " heading — EXCEPT the first-ever run, where that first heading is
// the still-blank "## YYYY-MM-DD — baseline" placeholder entry, which this call replaces in place
// rather than stacking a real entry on top of a fake one.
const firstHeadingIdx = existing.indexOf("\n## ");
const isBlankBaselinePlaceholder = /## YYYY-MM-DD — baseline \(no change yet\)/.test(existing);

let updated;
if (isBlankBaselinePlaceholder) {
  const templateEnd = existing.indexOf("\n## YYYY-MM-DD — baseline");
  updated = existing.slice(0, templateEnd + 1) + entry;
} else if (firstHeadingIdx === -1) {
  updated = `${existing.trimEnd()}\n\n${entry}`;
} else {
  updated = existing.slice(0, firstHeadingIdx + 1) + entry + "\n" + existing.slice(firstHeadingIdx + 1);
}

writeFileSync(resultsPath, updated);
console.log(`Appended RESULTS.md entry: median death wave ${medianDeathWave ?? "n/a"}, ${clears.length}/${wipes.length} clears/wipes, max wave ${maxWave} (${records.length} seeds).`);
