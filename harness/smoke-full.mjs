// Live smoke test #3: the FULL autonomous start — title → starter-select (enact the team plan
// on the real grid) → a battle begins. Validates driveStarterSelect, the part GameManager can't
// test. The bot runs its own loop (dryRun=false); we only observe.
//
// Usage: npm run smoke:full   (vite dev server up on http://127.0.0.1:8000)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const URL = process.env.SMOKE_URL ?? "http://127.0.0.1:8000/";
const BUNDLE = "dist/pokerogue-auto-ribbon.user.js";
const log = (...a) => console.log("[smoke:full]", ...a);

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
  // Expose the scene so we can read team state during starter select.
  await page.evaluate(() => {
    const pool = globalThis.Phaser.Display.Canvas.CanvasPool.pool;
    for (const e of pool) { const sc = e?.parent?.game?.scene?.scenes?.find((s) => s && typeof s.getPlayerParty === "function"); if (sc) globalThis.__sc = sc; }
  });
  log("BattleScene ready ✓ — enabling the bot and watching for a run to start…");

  const info = () => page.evaluate(() => {
    const s = globalThis.autoRibbon.snapshot();
    const ph = globalThis.__sc?.phaseManager?.getCurrentPhase?.()?.phaseName ?? null;
    const team = globalThis.__sc?.ui?.getHandler?.()?.starterSpecies?.map((x) => x.speciesId) ?? null;
    return { mode: s.uiMode, wave: s.battle?.waveIndex ?? null, party: s.playerParty.length, actions: globalThis.autoRibbon.actions(), phase: ph, team };
  });
  // Enable for real, and drop the human pacing so the slow software-render harness can finish the
  // multi-species grid navigation in a reasonable time (shipped config keeps human pacing).
  await page.evaluate(() => {
    const c = globalThis.autoRibbon.config;
    // Moderate pacing: fast enough to finish on the slow harness, slow enough not to race the
    // starter handler's per-input tweens (0ms pacing spams dropped inputs).
    c.dryRun = false; c.inputDelayMinMs = 40; c.inputDelayMaxMs = 90; c.tickIntervalMs = 60;
  });

  let last = "", started = false;
  for (let i = 0; i < 300; i++) {
    const s = await info();
    const tag = `${s.phase}/${s.mode}/team${JSON.stringify(s.team)}/wave${s.wave}`;
    if (tag !== last) { log(`t=${i}s phase=${s.phase} mode=${s.mode} team=${JSON.stringify(s.team)} wave=${s.wave} party=${s.party} act=${s.actions}`); last = tag; }
    if (s.wave != null && s.party > 0) { started = true; break; } // a run is underway with a real party
    await page.waitForTimeout(1000);
  }

  log("───── results ─────");
  for (const [name, ok] of [["a run started with a non-empty party", started]]) {
    log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failed = true;
  }
} catch (e) {
  log("ERROR:", e.message);
  failed = true;
} finally {
  await browser.close();
}
log(failed ? "SMOKE:FULL FAILED" : "SMOKE:FULL PASSED ✓");
process.exit(failed ? 1 : 0);
