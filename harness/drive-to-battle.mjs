// Drive a local PokéRogue run into a wave-1 battle using the game's OWN input
// abstraction (scene.ui.processInput(Button.*)) — the same path Phase 1 will use —
// then dump the in-battle snapshot so we can validate state.ts party/HP/move reads.
//
// Usage: node harness/drive-to-battle.mjs

import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(__dirname, "out", "drive");
mkdirSync(OUT, { recursive: true });
const BUNDLE = readFileSync(join(ROOT, "dist", "pokerogue-auto-ribbon.user.js"), "utf8");

// Button enum (stable) — from src/enums/buttons.ts.
const B = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, SUBMIT: 4, ACTION: 5, CANCEL: 6, MENU: 7 };

// In-page: acquire scene via CanvasPool and press a button through the game's input.
const PRESS = (btn) => {
  const looks = (s) => !!s && typeof s.getPlayerParty === "function" && !!s.ui && typeof s.ui.processInput === "function";
  const pool = globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool ?? [];
  let scene = null;
  for (const e of pool) { const ss = e?.parent?.game?.scene?.scenes; if (Array.isArray(ss)) { const m = ss.find(looks); if (m) { scene = m; break; } } }
  if (!scene) return "no-scene";
  return scene.ui.processInput(btn);
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const lines = [];
page.on("console", (m) => { if (/error|warn/i.test(m.type())) lines.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => lines.push(`PAGEERROR: ${e.message}`));

await page.goto("http://localhost:8000", { waitUntil: "domcontentloaded", timeout: 60000 });

// Wait for battle-shaped scene, then inject our bundle for snapshot()/HUD.
const ready = async () => page.evaluate(() => {
  const looks = (s) => !!s && typeof s.getPlayerParty === "function" && !!s.ui && typeof s.ui.getMode === "function";
  const pool = globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool ?? [];
  for (const e of pool) { const ss = e?.parent?.game?.scene?.scenes; if (Array.isArray(ss) && ss.find(looks)) return true; }
  return false;
});
const t0 = Date.now();
while (Date.now() - t0 < 120000) { if (await ready()) break; await page.waitForTimeout(2000); }
await page.addScriptTag({ content: BUNDLE });
await page.waitForTimeout(1000);

const snap = () => page.evaluate(() => window.autoRibbon?.snapshot?.() ?? null);
const press = (btn) => page.evaluate(PRESS, btn);
const shot = (n) => page.screenshot({ path: join(OUT, n) }).catch(() => {});

const seq = [];
let reached = false, lastMode = "";
for (let step = 0; step < 80; step++) {
  const s = await snap();
  const mode = s?.uiMode ?? "?";
  const wave = s?.battle?.waveIndex ?? null;
  if (mode !== lastMode) { seq.push(`step ${step}: mode=${mode} wave=${wave} await=${s?.awaitingActionInput}`); lastMode = mode; }

  // Reached a battle command menu → done.
  if ((mode === "COMMAND" || mode === "FIGHT") && s?.battle) { reached = true; await shot(`reached-${mode}.png`); break; }

  let btn = B.ACTION;
  if (mode === "STARTER_SELECT") {
    // Add the cursored starter, then submit to start the run.
    await press(B.ACTION); await page.waitForTimeout(700);
    await shot(`starter-after-add-${step}.png`);
    btn = B.SUBMIT;
  } else if (mode === "TARGET_SELECT" || mode === "MENU") {
    btn = B.ACTION;
  }
  await press(btn);
  await page.waitForTimeout(650);
  if (step % 6 === 0) await shot(`step-${String(step).padStart(2, "0")}-${mode}.png`);
}

const finalSnap = await snap();
writeFileSync(join(OUT, "sequence.txt"), seq.join("\n"));
writeFileSync(join(OUT, "final-snapshot.json"), JSON.stringify(finalSnap, null, 2));
writeFileSync(join(OUT, "drive-console.log"), lines.slice(-40).join("\n"));
await shot("final.png");
console.log("[drive] reached battle:", reached);
console.log("[drive] mode sequence:\n" + seq.join("\n"));
console.log("[drive] final mode:", finalSnap?.uiMode, "wave:", finalSnap?.battle?.waveIndex,
  "party:", finalSnap?.playerParty?.length, "enemy:", finalSnap?.enemyParty?.length);
await browser.close();
