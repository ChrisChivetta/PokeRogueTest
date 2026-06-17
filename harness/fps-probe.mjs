// Fast FPS probe — boot the local game, optionally apply a runtime TWEAK, and measure
// game.loop.actualFps over ~12s so we can compare rendering levers quickly.
//
// Env:
//   TWEAK   = JS evaluated in-page with `g` (Phaser.Game) and `m` (BattleScene) in scope
//   GLFLAGS = extra chromium args, comma-separated
//   HEADED  = "1" to run non-headless
//
// Usage: TWEAK='g.scale.setZoom(0.5)' node harness/fps-probe.mjs

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
await page.goto("http://localhost:8000", { waitUntil: "domcontentloaded", timeout: 60000 });

// Walk to the BattleScene + its game.
const FIND = `(() => {
  const looks=(s)=>!!s&&typeof s.getPlayerParty==="function"&&!!s.ui&&typeof s.ui.getMode==="function";
  const pool=globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool??[];
  for(const e of pool){const ss=e?.parent?.game?.scene?.scenes; if(Array.isArray(ss)){const m=ss.find(looks); if(m) return true;}}
  return false;
})()`;
const t0 = Date.now();
while (Date.now() - t0 < 120000) { if (await page.evaluate(FIND)) break; await page.waitForTimeout(2000); }
await page.waitForTimeout(3000); // let it settle past loading

// Apply tweak (with g = game, m = scene in scope).
const applied = await page.evaluate(`(() => {
  const looks=(s)=>!!s&&typeof s.getPlayerParty==="function"&&!!s.ui;
  const pool=globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool??[];
  for(const e of pool){const ss=e?.parent?.game?.scene?.scenes; if(Array.isArray(ss)){const m=ss.find(looks); if(m){
    const g=e.parent.game;
    try { ${TWEAK ? TWEAK + ";" : ""} } catch(err){ return "TWEAK ERROR: "+err.message; }
    const cv=g.canvas; const gl=g.renderer?.gl;
    return { tweak: ${JSON.stringify(TWEAK || "(none)")},
      canvas:[cv?.width, cv?.height],
      drawBuffer:[gl?.drawingBufferWidth, gl?.drawingBufferHeight],
      gameSize:[g.scale?.gameSize?.width, g.scale?.gameSize?.height] };
  }}}
  return "no scene";
})()`);
console.log("applied:", JSON.stringify(applied));

// Sample fps over 12s.
const fps = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  const f = await page.evaluate(`(() => { const pool=globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool??[]; for(const e of pool){const g=e?.parent?.game; if(g?.loop) return Math.round(g.loop.actualFps);} return 0; })()`);
  fps.push(f);
}
fps.sort((a, b) => a - b);
const avg = (fps.reduce((s, x) => s + x, 0) / fps.length).toFixed(1);
console.log(`fps samples: ${fps.join(" ")}`);
console.log(`fps min/avg/max: ${fps[0]} / ${avg} / ${fps[fps.length - 1]}`);
await browser.close();
