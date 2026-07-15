// ── Unattended soak runner ───────────────────────────────────────────────────
// Boots the LOCAL PokéRogue build in a headless browser, injects the bot, turns it loose
// (dryRun=false) for a long stretch, and records structured telemetry — runs started/finished,
// waves reached, ribbons gained, safety halts, errors, FPS — auto-recovering from page crashes
// and safety halts so a multi-hour session survives hiccups. This is what the cloud box runs to
// test full clears + soak at real FPS (which this dev container can't do at 3-7 FPS).
//
// Usage:  node harness/soak.mjs        (dev server must be up on SOAK_URL)
// Env:    SOAK_URL (default http://127.0.0.1:8000/)
//         SOAK_MINUTES (default 15)           — how long to run (SOAK_HOURS overrides if set)
//         SOAK_HOURS (unset by default)       — how long to run, in hours (takes precedence)
//         SOAK_GL (default swiftshader)       — auto | swiftshader | egl | desktop
//                                                 (auto = real GPU; use auto on a Mac, egl on a Linux GPU box)
//         SOAK_HEADED (default 0)              — 1 = visible window (real GPU accel; best on a Mac desktop)
//         SOAK_LOG (default soak-<ts>.jsonl)  — JSONL event log path
//         SOAK_ENABLE_RETRIES (default 1)     — turn on the game's retry-on-defeat to exercise retries
//         SOAK_HUMAN_PACING (default 0)       — 1 = shipped human pacing; 0 = brisk (more coverage)
//         SOAK_STALL_SECS (default 120)       — flag a stall if wave:mode:phase doesn't change for this long
//         SOAK_STALL_PAUSE (default 1)        — 1 = stop the bot + screenshot on a stall (for live debugging)
import { chromium } from "playwright";
import { readFileSync, appendFileSync, writeFileSync, existsSync, rmSync } from "node:fs";

const URL = process.env.SOAK_URL ?? "http://127.0.0.1:8000/";
// Duration: SOAK_HOURS wins if set; otherwise SOAK_MINUTES (default 15 — the policy is still
// young, so short, frequent soaks beat one long one). HOURS is kept for telemetry/back-compat.
const MINUTES = process.env.SOAK_HOURS != null
  ? Number(process.env.SOAK_HOURS) * 60
  : Number(process.env.SOAK_MINUTES ?? 15);
const HOURS = MINUTES / 60;
const DEADLINE = Date.now() + MINUTES * 60_000;
const GL = process.env.SOAK_GL ?? "swiftshader";
const HEADED = process.env.SOAK_HEADED === "1"; // visible window → real GPU (best on a Mac/desktop)
const LOG = process.env.SOAK_LOG ?? `soak-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
const ENABLE_RETRIES = (process.env.SOAK_ENABLE_RETRIES ?? "1") === "1";
const HUMAN_PACING = (process.env.SOAK_HUMAN_PACING ?? "0") === "1";
const STALL_SECS = Number(process.env.SOAK_STALL_SECS ?? 120);
const STALL_PAUSE = (process.env.SOAK_STALL_PAUSE ?? "1") === "1";
const BUNDLE = "dist/pokerogue-auto-ribbon.user.js";
const HOT_BUNDLE = "dist/policy.hot.js";
// Autonomous hot-reload: when on, the harness watches for a sentinel file that the agent drops
// after building a fixed dist/policy.hot.js, then live-swaps the policy into the RUNNING page and
// resumes from the stalled wave/phase — no browser restart, no run lost. See harness/auto-iterate.mjs.
const HOT_RELOAD = (process.env.SOAK_HOT_RELOAD ?? "0") === "1";
const RELOAD_SIGNAL = process.env.SOAK_RELOAD_SIGNAL ?? "policy-reload.signal";
// Second sentinel: the agent fixes src/execution.ts (or orchestrator/team/candy), rebuilds
// dist/strategy.hot.js, and drops this to live-swap the UI-driving + planning STRATEGY in place —
// an in-flight starter-select resumes mid-flow (its phase state lives on the host seam).
const STRATEGY_BUNDLE = "dist/strategy.hot.js";
const STRATEGY_RELOAD_SIGNAL = process.env.SOAK_STRATEGY_RELOAD_SIGNAL ?? "strategy-reload.signal";

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

// Ring buffer of the bot's own console output (the press() calls log every intended button),
// so a stall dump shows the exact button sequence the bot was looping on. Survives relaunches.
const recentLogs = [];
function pushLog(line) { recentLogs.push(line); if (recentLogs.length > 80) recentLogs.shift(); }

async function bootBot(browser) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { stats.errors++; emit("pageerror", { msg: String(e.message).slice(0, 200) }); });
  page.on("console", (m) => pushLog(`${stamp()} ${m.text().slice(0, 160)}`));
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

/**
 * Live-swap the policy into the RUNNING page from dist/policy.hot.js, then resume. The Phaser scene
 * is untouched, so play continues from the current wave/phase with the patched decision logic.
 * Returns the in-page reload result {ok, version, error}. A rejected (bad) patch leaves the prior
 * policy driving — the soak never breaks on a typo'd hot fix.
 */
async function reloadPolicyFromDisk(page) {
  let src;
  try {
    src = readFileSync(HOT_BUNDLE, "utf8");
  } catch (e) {
    return { ok: false, error: `cannot read ${HOT_BUNDLE}: ${e.message}` };
  }
  try {
    const res = await page.evaluate((s) => globalThis.autoRibbon.reloadPolicy(s), src);
    // reloadPolicy auto-resumes if we were paused; make sure the bot is enabled regardless.
    await page.evaluate(() => globalThis.autoRibbon.start()).catch(() => {});
    return res;
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 200) };
  }
}

/**
 * Live-swap the UI-driving + planning STRATEGY into the RUNNING page from dist/strategy.hot.js, then
 * resume. The Phaser scene is untouched and starter-select phase state lives on the host seam, so an
 * in-flight starter-select resumes mid-flow with the patched adapters. Returns the in-page reload
 * result {ok, version, error}. A rejected (bad) patch leaves the prior strategy driving.
 */
async function reloadStrategyFromDisk(page) {
  let src;
  try {
    src = readFileSync(STRATEGY_BUNDLE, "utf8");
  } catch (e) {
    return { ok: false, error: `cannot read ${STRATEGY_BUNDLE}: ${e.message}` };
  }
  try {
    const res = await page.evaluate((s) => globalThis.autoRibbon.reloadStrategy(s), src);
    // reloadStrategy auto-resumes if we were paused; make sure the bot is enabled regardless.
    await page.evaluate(() => globalThis.autoRibbon.start()).catch(() => {});
    return res;
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 200) };
  }
}

let browser = await chromium.launch(launchOpts);
let page = await bootBot(browser);
emit("start", { url: URL, minutes: MINUTES, hours: HOURS, gl: GL, headed: HEADED, log: LOG, enableRetries: ENABLE_RETRIES, humanPacing: HUMAN_PACING });

let inRun = false, run = null, lastSummary = Date.now();
// Stall watchdog: the "progress key" (wave:mode:phase) should change as the bot plays. If it
// holds still for STALL_SECS the bot is wedged in a loop — screenshot it, dump the recent button
// log, and (by default) pause so the screen settles for inspection. pausedForStall suppresses the
// safety-halt auto-resume below so our deliberate pause sticks.
let progressKey = "", progressSince = Date.now(), pausedForStall = false, lastStallKey = "";
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
    // The fresh page's in-page bot module state (totalRetries, ribbon baseline, …) restarts at
    // zero — any run/baseline tracked against the OLD page is now stale and unrecoverable, not
    // just paused. Drop it rather than let a later "run-end" diff a post-crash counter against a
    // pre-crash snapshot (this is exactly how retriesUsed went negative in every June soak file:
    // run.retriesAt was captured before a crash, s.retries read fresh-post-crash, no reset here).
    if (run) emit("run-abandoned-crash", { n: run.n });
    inRun = false; run = null;
    stats.ribbonsBaseline = null;
    continue;
  }

  // ── Live policy hot-reload ──────────────────────────────────────────────────
  // The agent fixes src/policy.ts, rebuilds dist/policy.hot.js, then drops RELOAD_SIGNAL. We swap
  // the new policy into the running page and resume from the stalled wave/phase — no run lost.
  if (HOT_RELOAD && existsSync(RELOAD_SIGNAL)) {
    try { rmSync(RELOAD_SIGNAL); } catch {}
    const res = await reloadPolicyFromDisk(page);
    emit("policy-reload", res);
    if (res.ok) {
      // Clear stall bookkeeping so the watchdog gives the patched policy a fresh window to progress.
      pausedForStall = false; lastStallKey = ""; progressKey = ""; progressSince = Date.now();
      console.log(`[soak] policy hot-swapped → v${res.version}; resumed in place.`);
    } else {
      console.log(`[soak] policy reload REJECTED: ${res.error}`);
    }
  }

  // ── Live strategy hot-reload ────────────────────────────────────────────────
  // The agent fixes src/execution.ts (or orchestrator/team/candy), rebuilds dist/strategy.hot.js,
  // then drops STRATEGY_RELOAD_SIGNAL. We swap the new UI-driving + planning adapters into the running
  // page; an in-flight starter-select resumes mid-flow (its phase state lives on the host seam).
  if (HOT_RELOAD && existsSync(STRATEGY_RELOAD_SIGNAL)) {
    try { rmSync(STRATEGY_RELOAD_SIGNAL); } catch {}
    const res = await reloadStrategyFromDisk(page);
    emit("strategy-reload", res);
    if (res.ok) {
      // Clear stall bookkeeping so the watchdog gives the patched strategy a fresh window to progress.
      pausedForStall = false; lastStallKey = ""; progressKey = ""; progressSince = Date.now();
      console.log(`[soak] strategy hot-swapped → v${res.version}; resumed in place.`);
    } else {
      console.log(`[soak] strategy reload REJECTED: ${res.error}`);
    }
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

  // Safety halt fired (bot disabled itself) → log and resume so the soak keeps going. Skip while
  // we're deliberately paused on a stall (otherwise we'd immediately un-pause the thing to inspect).
  if (!s.enabled && !pausedForStall) {
    stats.halts++;
    emit("safety-halt-resume", { halts: stats.halts, wave: s.wave });
    await page.evaluate(() => globalThis.autoRibbon.start()).catch(() => {});
  }

  // ── Stall / loop watchdog ───────────────────────────────────────────────────
  const pkey = `${s.wave}:${s.mode}:${s.phase}`;
  if (pkey !== progressKey) { progressKey = pkey; progressSince = Date.now(); }
  const stalledSecs = Math.round((Date.now() - progressSince) / 1000);
  // Fire at most once per stall EPISODE (per progress key) — even when not pausing — so a long
  // stall doesn't spam a screenshot every sample. The key changes when the bot makes progress.
  if (!pausedForStall && s.enabled && stalledSecs >= STALL_SECS && pkey !== lastStallKey) {
    lastStallKey = pkey;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = `stall-${ts}.png`;
    try { await page.screenshot({ path: shot }); } catch (e) { emit("stall-shot-failed", { msg: String(e.message).slice(0, 120) }); }
    const tail = recentLogs.slice(-40);
    try { writeFileSync(`stall-${ts}.txt`, [`stuck on ${pkey} for ${stalledSecs}s`, JSON.stringify(s), "", ...tail].join("\n")); } catch {}
    emit("stall", { key: pkey, stalledSecs, shot, sample: s, recentLogs: tail });
    console.log(`\n[soak] !! STALL — stuck on "${pkey}" for ${stalledSecs}s`);
    console.log(`[soak]    screenshot: ${shot}   details: stall-${ts}.txt`);
    console.log(`[soak]    last bot actions:`);
    for (const l of recentLogs.slice(-15)) console.log(`            ${l}`);
    if (STALL_PAUSE) {
      pausedForStall = true;
      await page.evaluate(() => globalThis.autoRibbon.stop()).catch(() => {});
      if (HOT_RELOAD) {
        console.log(`[soak]    bot PAUSED. Fix src/policy.ts, build the hot bundle, drop "${RELOAD_SIGNAL}" → live-swap + resume in place.\n`);
      } else {
        console.log(`[soak]    bot PAUSED. Send Claude the screenshot + stall-${ts}.txt, then re-run to resume.\n`);
      }
    }
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
