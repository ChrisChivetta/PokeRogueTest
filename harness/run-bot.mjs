// Phase-1 run: start a local Classic run (state-driven), hand control to the bot
// (dryRun=false), and watch how many waves it clears hands-off.
//
// Usage: node harness/run-bot.mjs

import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(__dirname, "out", "bot");
mkdirSync(OUT, { recursive: true });
const BUNDLE = readFileSync(join(ROOT, "dist", "pokerogue-auto-ribbon.user.js"), "utf8");

const B = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, SUBMIT: 4, ACTION: 5, CANCEL: 6 };
const RUN_BUDGET_MS = 8 * 60 * 1000;
const STOP_AT_WAVE = 26;

const PRESS = (btn) => {
  const looks = (s) => !!s && typeof s.getPlayerParty === "function" && !!s.ui && typeof s.ui.processInput === "function";
  const pool = globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool ?? [];
  for (const e of pool) { const ss = e?.parent?.game?.scene?.scenes; if (Array.isArray(ss)) { const m = ss.find(looks); if (m) return m.ui.processInput(btn); } }
  return "no-scene";
};

const HEADLESS = process.env.HEADED !== "1";
const browser = await chromium.launch({
  headless: HEADLESS,
  args: [
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--no-sandbox",
    // #2: stop Chrome from throttling timers / pausing rAF on "hidden"/backgrounded
    // pages — the prime suspect for Phaser's message timers freezing the game loop.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.stack || e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`CONSOLE.error: ${m.text()}`); });

// #1: trap errors as early as possible (before page scripts load), in case Phaser
// swallows them or they fire from timer callbacks the page listeners miss.
await page.addInitScript(`
  window.__errs = [];
  window.addEventListener("error", (e) => window.__errs.push("ERROR: " + (e.error?.stack || e.message)));
  window.addEventListener("unhandledrejection", (e) => window.__errs.push("REJECT: " + (e.reason?.stack || e.reason)));
`);

await page.goto("http://localhost:8000", { waitUntil: "domcontentloaded", timeout: 60000 });

const ready = () => page.evaluate(`(() => { const looks=(s)=>!!s&&typeof s.getPlayerParty==="function"&&!!s.ui&&typeof s.ui.getMode==="function"; const pool=globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool??[]; for(const e of pool){const ss=e?.parent?.game?.scene?.scenes; if(Array.isArray(ss)&&ss.find(looks))return true;} return false; })()`);
const snap = () => page.evaluate(() => window.autoRibbon?.snapshot?.() ?? null);
// Game-loop telemetry: current phase name, render FPS, and page visibility.
const PHASE = () => page.evaluate(`(() => {
  const looks=(s)=>!!s&&typeof s.getPlayerParty==="function"&&!!s.ui;
  const pool=globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool??[];
  for(const e of pool){const ss=e?.parent?.game?.scene?.scenes; if(Array.isArray(ss)){const m=ss.find(looks); if(m){
    const ph=m.phaseManager?.getCurrentPhase?.()?.constructor?.name ?? "?";
    const fps=Math.round(e.parent.game.loop?.actualFps ?? 0);
    return { phase: ph, fps, vis: document.visibilityState };
  }}}
  return { phase:"?", fps:0, vis: document.visibilityState };
})()`);
const press = (b) => page.evaluate(PRESS, b);
const shot = (n) => page.screenshot({ path: join(OUT, n) }).catch(() => {});
const sleep = (ms) => page.waitForTimeout(ms);
const modeOf = (s) => s?.uiMode ?? "?";

// Press `btn` until untilFn(snap) is true (re-checking each step), or timeout.
async function driveUntil(btn, untilFn, maxMs, label) {
  const t = Date.now();
  while (Date.now() - t < maxMs) {
    const s = await snap();
    if (untilFn(s)) return s;
    await press(btn);
    await sleep(550);
  }
  return null;
}

// Boot + inject. Bot starts in observe/dryRun.
const t0 = Date.now();
while (Date.now() - t0 < 120000) { if (await ready()) break; await sleep(2000); }
await page.addScriptTag({ content: BUNDLE });
await sleep(1000);
// Disable tutorials AND crank speed / kill animations. Headless SwiftShader renders
// pokerogue's 1920x1080 + post-FX at only ~3-7 fps, so fewer rendered frames per turn
// (no move anims, max game speed, skipped EXP, instant HP bars) is the difference
// between progressing and crawling. Harness-only; the shipped bot never mutates these.
await page.evaluate(`(() => { const looks=(s)=>!!s&&typeof s.getPlayerParty==="function"&&!!s.ui; const pool=globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool??[]; for(const e of pool){const ss=e?.parent?.game?.scene?.scenes; if(Array.isArray(ss)){const m=ss.find(looks); if(m){
  m.enableTutorials=false; m.disableMenu=false;
  m.gameSpeed=5; m.moveAnimations=false; m.expGainsSpeed=3; m.hpBarSpeed=3; m.fieldVolume=0;
  return;
}}} })()`);

// ── Phase A: state-driven run start — draft a 3-mon team (Bulbasaur/Charmander/Squirtle,
//    cost 3 each = 9 ≤ 10) so faint-switch has fodder, then begin. ──
const startLog = [];
await driveUntil(B.ACTION, (s) => modeOf(s) === "STARTER_SELECT", 70000, "→starter");
startLog.push("reached STARTER_SELECT");
let added = 0;
for (let k = 0; k < 3; k++) {
  const opened = await driveUntil(B.ACTION, (s) => modeOf(s) === "OPTION_SELECT", 5000, "open-menu");
  if (!opened) break;
  await driveUntil(B.ACTION, (s) => modeOf(s) === "STARTER_SELECT", 5000, "add-to-party"); // "Add to Party"
  added++;
  if (k < 2) { await press(B.RIGHT); await sleep(450); } // move cursor to the next starter
}
startLog.push(`added ~${added} starters`);
// Begin the run (retry once if the confirm doesn't show).
let confirmed = await driveUntil(B.SUBMIT, (s) => modeOf(s) === "CONFIRM", 6000, "submit→confirm");
if (!confirmed) { await press(B.CANCEL); confirmed = await driveUntil(B.SUBMIT, (s) => modeOf(s) === "CONFIRM", 6000, "retry-submit"); }
startLog.push(confirmed ? "begin confirm shown" : "FAILED to reach confirm");
await driveUntil(B.ACTION, (s) => !["CONFIRM", "STARTER_SELECT", "OPTION_SELECT"].includes(modeOf(s)), 8000, "confirm-begin");
startLog.push("run starting");
const atCmd = await driveUntil(B.ACTION, (s) => modeOf(s) === "COMMAND" && !!s?.battle, 60000, "→command");
startLog.push(atCmd ? "reached COMMAND (wave " + atCmd.battle.waveIndex + ", party " + atCmd.playerParty.length + ")" : "FAILED to reach COMMAND");
await shot("00-wave1-start.png");
writeFileSync(join(OUT, "start-log.txt"), startLog.join("\n"));

// ── Phase B: hand control to the bot ──
await page.evaluate(() => {
  const c = window.autoRibbon.config;
  c.dryRun = false; c.logLevel = "info";
  // NOTE: wall-clock per wave is fully game-loop-bound here (~85s/wave at the
  // headless ~5fps), NOT pacing-bound — measured identical wave times at 4x faster
  // pacing, just with wasted presses that steal CPU from rendering. So keep the
  // shipped human pacing; cranking it does not help and slightly hurts fps.
  window.autoRibbon.start();
});

const progression = [], samples = [];
let maxWave = atCmd?.battle?.waveIndex ?? 0, lastWave = maxWave, titleStreak = 0, idle = 0, result = "timeout";
const tStart = Date.now();
while (Date.now() - tStart < RUN_BUDGET_MS) {
  await sleep(2500);
  const s = await snap();
  const wave = s?.battle?.waveIndex ?? null;
  const mode = modeOf(s);
  const acts = await page.evaluate(() => window.autoRibbon.actions());
  const tele = await PHASE();
  const lead = s?.playerParty?.find((p) => p.onField) ?? s?.playerParty?.[0];
  const foe = s?.enemyParty?.find((p) => p.onField) ?? s?.enemyParty?.[0];
  samples.push(`t+${Math.round((Date.now() - tStart) / 1000)}s w${wave} ${mode} ph=${tele.phase} fps=${tele.fps} vis=${tele.vis} acts${acts} me ${lead?.name ?? "—"} ${lead?.hpRatio != null ? Math.round(lead.hpRatio * 100) + "%" : "?"} foe ${foe?.name ?? "—"} ${foe?.hpRatio != null ? Math.round(foe.hpRatio * 100) + "%" : "?"}`);

  if (wave && wave !== lastWave) {
    progression.push(`wave ${wave} | me ${lead?.name ?? "—"} ${lead?.hpRatio != null ? Math.round(lead.hpRatio * 100) + "%" : "?"} | foe ${foe?.name ?? "—"} | acts ${acts}`);
    await shot(`wave-${String(wave).padStart(2, "0")}.png`);
    lastWave = wave; idle = 0; if (wave > maxWave) maxWave = wave;
  } else idle++;

  // Robust terminal detection.
  titleStreak = (mode === "TITLE" && !s?.battle) ? titleStreak + 1 : 0;
  const allFainted = s?.playerParty?.length > 0 && s.playerParty.every((p) => p.fainted);
  if (titleStreak >= 3) { result = `game-over (back to title after wave ${maxWave})`; break; }
  if (allFainted) { result = `wiped at wave ${wave}`; break; }
  if (maxWave >= STOP_AT_WAVE) { result = `reached wave ${maxWave} (ceiling)`; break; }
  if (idle > 60) { result = `stalled at wave ${lastWave} (${mode})`; break; }
}

await shot("zz-final.png");
writeFileSync(join(OUT, "progression.txt"), progression.join("\n"));
writeFileSync(join(OUT, "samples.txt"), samples.join("\n"));
const trapped = await page.evaluate(() => window.__errs ?? []).catch(() => []);
writeFileSync(join(OUT, "errors.txt"), [...errors, ...trapped.map((e) => "TRAP " + e)].slice(-30).join("\n"));
console.log("=== BOT RUN RESULT ===");
console.log("start:", startLog.join(" / "));
console.log("result:", result, "| max wave:", maxWave);
console.log("progression:\n" + progression.join("\n"));
console.log("last samples:\n" + samples.slice(-8).join("\n"));
await browser.close();
