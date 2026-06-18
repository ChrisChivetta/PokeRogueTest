// Live test of candy routing during starter select: grant the carry (Bulbasaur, #1) a candy
// stash, enable the bot, and verify it spends the candy to REDUCE the starter's cost (valueReduction
// goes up) AND still goes on to start the run. Validates driveStarterSelect's candy phase.
//
// Usage: node harness/smoke-candy.mjs   (vite dev server up on http://127.0.0.1:8000)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const URL = process.env.SMOKE_URL ?? "http://127.0.0.1:8000/";
const BUNDLE = "dist/pokerogue-auto-ribbon.user.js";
const log = (...a) => console.log("[smoke:candy]", ...a);

const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("[starter] candy")) log("BOT:", t.replace(/%c|color:[^ ]+|font-weight:bold/g, "").trim());
});
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
  await page.evaluate(() => {
    const pool = globalThis.Phaser.Display.Canvas.CanvasPool.pool;
    for (const e of pool) { const sc = e?.parent?.game?.scene?.scenes?.find((s) => s && typeof s.getPlayerParty === "function"); if (sc) globalThis.__sc = sc; }
  });

  // Grant Bulbasaur (#1) a big candy stash, reset its reduction, and record its base cost.
  const before = await page.evaluate(() => {
    const gd = globalThis.__sc.gameData;
    gd.starterData[1].candyCount = 999;
    gd.starterData[1].valueReduction = 0;
    return { baseCost: gd.getSpeciesStarterValue(1, 0), vr: gd.starterData[1].valueReduction };
  });
  log(`Bulbasaur base cost ${before.baseCost}, valueReduction ${before.vr}, candy 999 — enabling bot…`);

  await page.evaluate(() => { const c = globalThis.autoRibbon.config; c.dryRun = false; c.inputDelayMinMs = 40; c.inputDelayMaxMs = 90; c.tickIntervalMs = 60; });

  const info = () => page.evaluate(() => {
    const gd = globalThis.__sc.gameData;
    const s = globalThis.autoRibbon.snapshot();
    return { vr: gd.starterData[1].valueReduction, candy: gd.starterData[1].candyCount, wave: s.battle?.waveIndex ?? null, party: s.playerParty.length, ph: globalThis.__sc?.phaseManager?.getCurrentPhase?.()?.phaseName };
  });

  let reduced = false, started = false, last = "";
  for (let i = 0; i < 300; i++) {
    const s = await info();
    const tag = `vr${s.vr}/candy${s.candy}/${s.ph}/wave${s.wave}`;
    if (tag !== last) { log(`t=${i}s ${tag} party=${s.party}`); last = tag; }
    if (s.vr > 0) reduced = true;
    if (s.wave != null && s.party > 0) { started = true; break; }
    await page.waitForTimeout(1000);
  }

  log("───── results ─────");
  for (const [name, ok] of [["candy spent → cost reduced (valueReduction > 0)", reduced], ["run still started", started]]) {
    log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failed = true;
  }
} catch (e) {
  log("ERROR:", e.message);
  failed = true;
} finally {
  await browser.close();
}
log(failed ? "SMOKE:CANDY FAILED" : "SMOKE:CANDY PASSED ✓");
process.exit(failed ? 1 : 0);
