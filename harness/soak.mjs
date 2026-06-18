// ── Unattended soak runner ───────────────────────────────────────────────────
// Boots the LOCAL PokéRogue build in a headless browser, injects the bot, turns it loose
// (dryRun=false) for a long stretch, and records structured telemetry — runs started/finished,
// waves reached, ribbons gained, safety halts, errors, FPS — auto-recovering from page crashes
// and safety halts so a multi-hour session survives hiccups. This is what the cloud box runs to
// test full clears + soak at real FPS (which this dev container can't do at 3-7 FPS).
//
// Usage:  node harness/soak.mjs        (dev server must be up on SOAK_URL)
// Env:    SOAK_URL (default http://127.0.0.1:8000/)
//         SOAK_HOURS (default 6)              — how long to run
//         SOAK_GL (default swiftshader)       — auto | swiftshader | egl | desktop
//                                                 (auto = real GPU; use auto on a Mac, egl on a Linux GPU box)
//         SOAK_HEADED (default 0)              — 1 = visible window (real GPU accel; best on a Mac desktop)
//         SOAK_LOG (default soak-<ts>.jsonl)  — JSONL event log path
//         SOAK_ENABLE_RETRIES (default 1)     — turn on the game's retry-on-defeat to exercise retries
//         SOAK_HUMAN_PACING (default 0)       — 1 = shipped human pacing; 0 = brisk (more coverage)
import { chromium } from "playwright";
import { readFileSync, appendFileSync } from "node:fs";

const URL = process.env.SOAK_URL ?? "http://127.0.0.1:8000/";
const HOURS = Number(process.env.SOAK_HOURS ?? 6);
const DEADLINE = Date.now() + HOURS * 3600_000;
const GL = process.env.SOAK_GL ?? "swiftshader";
const HEADED = process.env.SOAK_HEADED === "1"; // visible window → real GPU (best on a Mac/desktop)
const LOG = process.env.SOAK_LOG ?? `soak-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
const ENABLE_RETRIES = (process.env.SOAK_ENABLE_RETRIES ?? "1") === "1";
const HUMAN_PACING = (process.env.SOAK_HUMAN_PACING ?? "0") === "1";
const BUNDLE = "dist/pokerogue-auto-ribbon.user.js";

const glArgs =
  GL === "auto" ? [] // force nothing → Chrome uses the platform's real GPU (use this on a Mac)
  : GL === "swiftshader" ? ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"]
  : GL === "egl" ? ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
  : ["--use-gl=desktop", "--ignore-gpu-blocklist"];
const launchOpts = { headless: !HEADED, args: [...glArgs, "--no-sandbox", "--disable-dev-shm-usage"] };

const t0 = Date.now();
const stamp = () => `${String(Math.floor((Date.now() - t0) / 60000)).padStart(3, " ")}m`;
function emit(event, data = {}) {
  const rec = { t: new Date().toISOString(), elapsedMs: Date.now() - t0, event, ...data };
  appendFileSync(LOG, JSON.stringify(rec) + "\n");
  if (event !== "sample") console.log(`[soak ${stamp()}] ${event}`, Object.keys(data).length ? JSON.stringify(data) : "");
}

// Aggregate stats across the whole session (survive browser restarts).
const stats = { runsStarted: 0, runsEnded: 0, maxWaveEver: 0, ribbonsGained: 0, halts: 0, crashes: 0, errors: 0, ribbonsBaseline: null };
const runRecords = []; // one {n, maxWave, outcome, durationMs, retriesUsed, minHpFrac, maxFainted, topLevel} per finished run

/** Bucket finished-run depths into a 1-line histogram (waves 1-10, 11-25, 26-50, …). */
function waveHistogram() {
  const buckets = [[1, 10], [11, 25], [26, 50], [51, 100], [101, 150], [151, 199], [200, 999]];
  const labels = ["1-10", "11-25", "26-50", "51-100", "101-150", "151-199", "200+(clear)"];
  const counts = buckets.map(([lo, hi]) => runRecords.filter((r) => r.maxWave >= lo && r.maxWave <= hi).length);
  return labels.map((l, i) => `${l}:${counts[i]}`).join(" ");
}
function median(xs) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

async function bootBot(browser) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { stats.errors++; emit("pageerror", { msg: String(e.message).slice(0, 200) }); });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => {
    const pool = globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool;
    return Array.isArray(pool) && pool.some((e) => e?.parent?.game?.scene?.scenes?.some((s) => s && typeof s.getPlayerParty === "function"));
  }, { timeout: 120_000, polling: 500 });
  await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });
  await page.waitForFunction(() => !!globalThis.autoRibbon, { timeout: 15_000 });
  await (await page.$("canvas"))?.click({ position: { x: 400, y: 300 } }).catch(() => {});
  // Expose the scene for telemetry; flip the retry setting; enable the bot.
  await page.evaluate(({ enableRetries, human }) => {
    const pool = globalThis.Phaser.Display.Canvas.CanvasPool.pool;
    for (const e of pool) { const sc = e?.parent?.game?.scene?.scenes?.find((s) => s && typeof s.getPlayerParty === "function"); if (sc) globalThis.__sc = sc; }
    if (enableRetries && globalThis.__sc) globalThis.__sc.enableRetries = true;
    const c = globalThis.autoRibbon.config;
    c.dryRun = false;
    if (!human) { c.inputDelayMinMs = 40; c.inputDelayMaxMs = 90; c.tickIntervalMs = 80; }
  }, { enableRetries: ENABLE_RETRIES, human: HUMAN_PACING });
  return page;
}

async function sample(page) {
  return page.evaluate(() => {
    const t = globalThis.autoRibbon.telemetry();
    const sc = globalThis.__sc;
    return {
      ...t,
      mode: t.uiMode,
      party: t.partySize,
      actions: globalThis.autoRibbon.actions(),
      enabled: globalThis.autoRibbon.config.enabled,
      phase: sc?.phaseManager?.getCurrentPhase?.()?.phaseName ?? null,
      fps: Math.round(sc?.game?.loop?.actualFps ?? 0),
    };
  });
}

let browser = await chromium.launch(launchOpts);
let page = await bootBot(browser);
emit("start", { url: URL, hours: HOURS, gl: GL, headed: HEADED, log: LOG, enableRetries: ENABLE_RETRIES, humanPacing: HUMAN_PACING });

let inRun = false, run = null, lastSummary = Date.now();
while (Date.now() < DEADLINE) {
  let s;
  try {
    s = await sample(page);
  } catch (e) {
    // Page/browser died — relaunch and continue the soak.
    stats.crashes++;
    emit("crash-recover", { msg: String(e.message).slice(0, 160) });
    try { await browser.close(); } catch {}
    try {
      browser = await chromium.launch(launchOpts);
      page = await bootBot(browser);
    } catch (e2) { emit("relaunch-failed", { msg: String(e2.message).slice(0, 160) }); await new Promise((r) => setTimeout(r, 30_000)); }
    continue;
  }

  if (stats.ribbonsBaseline == null) { stats.ribbonsBaseline = s.ribboned; emit("baseline", { ribboned: s.ribboned, owned: s.owned }); }
  const gained = s.ribboned - stats.ribbonsBaseline;
  if (gained > stats.ribbonsGained) { stats.ribbonsGained = gained; emit("ribbon-gained", { total: s.ribboned, gainedThisSoak: gained }); }

  // Run lifecycle by the battle wave appearing/disappearing, with per-run health/strategy stats.
  const nowInRun = s.wave != null && s.party > 0;
  if (nowInRun && !inRun) {
    inRun = true;
    stats.runsStarted++;
    run = { n: stats.runsStarted, startMs: Date.now(), maxWave: s.wave, minHpFrac: 1, maxFainted: 0, topLevel: 0, retriesAt: s.retries };
    emit("run-start", { n: run.n, ribboned: s.ribboned });
  }
  if (nowInRun && run) {
    run.maxWave = Math.max(run.maxWave, s.wave);
    run.minHpFrac = Math.min(run.minHpFrac, s.hpFrac ?? 1);
    run.maxFainted = Math.max(run.maxFainted, s.partyFainted ?? 0);
    run.topLevel = Math.max(run.topLevel, s.topLevel ?? 0);
    if (s.wave > stats.maxWaveEver) stats.maxWaveEver = s.wave;
  }
  if (!nowInRun && inRun && s.phase !== "GameOverPhase") {
    inRun = false;
    stats.runsEnded++;
    const outcome = run.maxWave >= 200 ? "clear" : "wipe"; // wave-200 Eternatus clear vs earlier wipe
    const rec = { n: run.n, maxWave: run.maxWave, outcome, durationMs: Date.now() - run.startMs,
      retriesUsed: s.retries - run.retriesAt, minHpFrac: Math.round(run.minHpFrac * 100) / 100,
      maxFainted: run.maxFainted, topLevel: run.topLevel };
    runRecords.push(rec);
    emit("run-end", rec);
    run = null;
  }

  // Objective complete → we're done; stop early.
  if (s.done) { emit("objective-complete", { ribboned: s.ribboned }); break; }

  // Safety halt fired (bot disabled itself) → log and resume so the soak keeps going.
  if (!s.enabled) {
    stats.halts++;
    emit("safety-halt-resume", { halts: stats.halts, wave: s.wave });
    await page.evaluate(() => globalThis.autoRibbon.start()).catch(() => {});
  }

  emit("sample", s);
  if (Date.now() - lastSummary > 300_000) { // every 5 min, a human-readable rollup
    lastSummary = Date.now();
    const wipes = runRecords.filter((r) => r.outcome === "wipe").map((r) => r.maxWave);
    emit("summary", {
      ...stats, curWave: s.wave, curMode: s.mode, fps: s.fps,
      clears: runRecords.filter((r) => r.outcome === "clear").length,
      medianDeathWave: median(wipes), histogram: waveHistogram(),
    });
  }
  await new Promise((r) => setTimeout(r, 5000));
}

const wipes = runRecords.filter((r) => r.outcome === "wipe").map((r) => r.maxWave);
const clears = runRecords.filter((r) => r.outcome === "clear").length;
emit("done", {
  ...stats, ranHours: ((Date.now() - t0) / 3600_000).toFixed(2),
  clears, medianDeathWave: median(wipes), histogram: waveHistogram(),
});
console.log(`\n[soak] FINAL ─────────────────────────────────────────`);
console.log(`  runs:${stats.runsStarted} finished:${stats.runsEnded}  clears:${clears} wipes:${wipes.length}`);
console.log(`  max wave ever:${stats.maxWaveEver}  median death wave:${median(wipes)}  ribbons+:${stats.ribbonsGained}`);
console.log(`  retries:${stats.runsEnded ? runRecords.reduce((a, r) => a + r.retriesUsed, 0) : 0}  halts:${stats.halts} crashes:${stats.crashes} errors:${stats.errors}`);
console.log(`  depth histogram: ${waveHistogram()}`);
console.log(`  full event log: ${LOG}`);
try { await browser.close(); } catch {}
process.exit(0);
