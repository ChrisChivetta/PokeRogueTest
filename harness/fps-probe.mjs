// Fast FPS probe — boot the local game, optionally apply a runtime TWEAK, and measure
// game.loop.actualFps over ~12s so we can compare rendering levers quickly.
//
// Env:
//   RENDER=headless  -> set localStorage so the game boots with Phaser.HEADLESS (no render)
//   TWEAK   = JS evaluated in-page with `g` (Phaser.Game) and `m` (BattleScene) in scope
//   GLFLAGS = extra chromium args, comma-separated
//   HEADED  = "1" to run non-headless browser
//
// Usage: RENDER=headless node harness/fps-probe.mjs

import { chromium } from "playwright";

const baseArgs = [
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist", "--no-sandbox",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling",
];
const extra = (process.env.GLFLAGS || "").split(",").map((s) => s.trim()).filter(Boolean);
const TWEAK = process.env.TWEAK || "";

const browser = await chromium.launch({ headless: process.env.HEADED !== "1", args: [...baseArgs, ...extra] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (process.env.RENDER === "headless") {
  await page.addInitScript(`try { localStorage.setItem("autoRibbonHeadless", "1"); } catch (e) {}`);
}
await page.goto("http://localhost:8000", { waitUntil: "domcontentloaded", timeout: 60000 });

// Scene/game finder that works for both WEBGL (CanvasPool) and HEADLESS (window.game).
const FINDER = `(() => {
  const looks=(s)=>!!s&&typeof s.getPlayerParty==="function"&&!!s.ui&&typeof s.ui.getMode==="function";
  let scenes = window.game?.scene?.scenes;
  if (Array.isArray(scenes)) { const m=scenes.find(looks); if(m) return { m, g: window.game }; }
  const pool=globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool??[];
  for(const e of pool){const ss=e?.parent?.game?.scene?.scenes; if(Array.isArray(ss)){const m=ss.find(looks); if(m) return { m, g: e.parent.game };}}
  return null;
})`;

const t0 = Date.now();
while (Date.now() - t0 < 120000) { if (await page.evaluate(`!!${FINDER}()`)) break; await page.waitForTimeout(2000); }
await page.waitForTimeout(3000); // settle past loading

const applied = await page.evaluate(`(() => {
  const r=${FINDER}(); if(!r) return "no scene"; const {m,g}=r;
  try { ${TWEAK ? TWEAK + ";" : ""} } catch(err){ return "TWEAK ERROR: "+err.message; }
  const cv=g.canvas; const gl=g.renderer?.gl;
  return { renderType: g.config?.renderType, headless: g.renderer?.constructor?.name,
    canvas: cv ? [cv.width, cv.height] : null,
    drawBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null };
})()`);
console.log("applied:", JSON.stringify(applied));

const fps = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  const f = await page.evaluate(`(() => { const r=${FINDER}(); return r ? Math.round(r.g.loop.actualFps) : 0; })()`);
  fps.push(f);
}
fps.sort((a, b) => a - b);
const avg = (fps.reduce((s, x) => s + x, 0) / fps.length).toFixed(1);
console.log(`fps samples: ${fps.join(" ")}`);
console.log(`fps min/avg/max: ${fps[0]} / ${avg} / ${fps[fps.length - 1]}`);
await browser.close();
