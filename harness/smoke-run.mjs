// Live smoke test #2: input DRIVING + the START_RUN execution adapter. Boots the real game,
// enables the bot for real (dryRun=false), and verifies its OWN loop drives the whole title flow
// (intro → gender prompt on a fresh save → New Game → Classic) to the STARTER_SELECT screen with
// no manual input. This is the live validation GameManager can't give us (upstream's starter-select
// UI test is disabled). Observe-only beyond inputs; no save is written by the bot itself.
//
// Usage: npm run smoke:run   (vite dev server up on http://127.0.0.1:8000)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const URL = process.env.SMOKE_URL ?? "http://127.0.0.1:8000/";
const BUNDLE = "dist/pokerogue-auto-ribbon.user.js";
const log = (...a) => console.log("[smoke:run]", ...a);

const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
let failed = false;
try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => {
    const pool = globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool;
    return Array.isArray(pool) && pool.some((e) => e?.parent?.game?.scene?.scenes?.some((s) => s && typeof s.getPlayerParty === "function"));
  }, { timeout: 120_000, polling: 500 });
  await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });
  await page.waitForFunction(() => !!globalThis.autoRibbon, { timeout: 15_000 });
  await (await page.$("canvas"))?.click({ position: { x: 400, y: 300 } }).catch(() => {});
  for (let i = 0; i < 60; i++) {
    const p = await page.evaluate(() => globalThis.autoRibbon.sceneProbe());
    if (p.found && p.battleShaped) break;
    await page.waitForTimeout(2000);
  }
  log("BattleScene ready ✓ — enabling the bot (dryRun=false) and watching its loop drive…");

  const info = () => page.evaluate(() => {
    const s = globalThis.autoRibbon.snapshot();
    return { mode: s.uiMode, actions: globalThis.autoRibbon.actions() };
  });
  await page.evaluate(() => { globalThis.autoRibbon.config.dryRun = false; });

  let last = "", reached = false, maxActions = 0;
  for (let i = 0; i < 90; i++) {
    const s = await info();
    maxActions = s.actions;
    if (s.mode !== last) { log(`t=${i}s mode=${s.mode} actions=${s.actions}`); last = s.mode; }
    if (s.mode === "STARTER_SELECT") { reached = true; break; }
    await page.waitForTimeout(1000);
  }

  log("───── results ─────");
  const checks = [
    ["bot sent real inputs (actions > 0)", maxActions > 0],
    ["bot autonomously reached STARTER_SELECT", reached],
  ];
  for (const [name, ok] of checks) { log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failed = true; }
} catch (e) {
  log("ERROR:", e.message);
  failed = true;
} finally {
  await browser.close();
}
log(failed ? "SMOKE:RUN FAILED" : "SMOKE:RUN PASSED ✓");
process.exit(failed ? 1 : 0);
