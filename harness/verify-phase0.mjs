// Phase-0 verification harness (local instance).
//
// Boots headless Chromium against a LOCAL PokéRogue dev server (login bypassed, no
// credentials), discovers how the BattleScene is actually reachable, injects our built
// userscript, and dumps sceneProbe()/modeProbe()/snapshot() + a screenshot.
//
// Goal: empirically confirm — against a real (unminified) BattleScene — that
//   1. the bridge can ACQUIRE the scene (the riskiest, browser-only assumption), and
//   2. UI_MODE_ORDER matches the real ui.handlers array (validates the mode-map fix).
//
// Usage: node harness/verify-phase0.mjs  [url]   (default http://localhost:8000)

import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(__dirname, "out");
mkdirSync(OUT, { recursive: true });

const URL = process.argv[2] ?? "http://localhost:8000";
const BUNDLE = readFileSync(join(ROOT, "dist", "pokerogue-auto-ribbon.user.js"), "utf8");
const BOOT_TIMEOUT_MS = 120_000;

// Candidate scene-acquisition strategies, evaluated IN-PAGE. Each returns a scene-like
// object or null. We report which ones succeed so we can harden bridge.ts to match
// reality instead of guessing. Kept as a stringified function for page.evaluate.
const DISCOVERY = `() => {
  const looksLikeScene = (s) => !!s && typeof s.getPlayerParty === "function"
    && typeof s.getEnemyParty === "function" && "currentBattle" in s
    && !!s.ui && typeof s.ui.getMode === "function";
  const fromScenes = (scenes) => Array.isArray(scenes) ? scenes.find(looksLikeScene) : null;

  const strategies = {
    "globalThis.Phaser.CanvasPool": () => {
      const pool = globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool;
      if (!Array.isArray(pool)) return null;
      for (const e of pool) { const s = fromScenes(e?.parent?.game?.scene?.scenes); if (s) return s; }
      return null;
    },
    "canvas.__phaserGame/backref": () => {
      for (const c of document.querySelectorAll("canvas")) {
        const g = c.__phaserGame ?? c.game ?? c._phaser?.game;
        const s = fromScenes(g?.scene?.scenes); if (s) return s;
      }
      return null;
    },
    "window.game/gameInstance": () => fromScenes(
      (window.game ?? window.gameInstance)?.scene?.scenes),
    "scan window for Phaser.Game": () => {
      for (const k of Object.getOwnPropertyNames(window)) {
        let v; try { v = window[k]; } catch { continue; }
        const s = fromScenes(v?.scene?.scenes); if (s) return s;
      }
      return null;
    },
  };

  const results = {};
  let found = null, foundVia = null;
  for (const [name, fn] of Object.entries(strategies)) {
    let ok = false;
    try { const s = fn(); ok = !!s; if (s && !found) { found = s; foundVia = name; } } catch (e) { ok = "err:" + e.message; }
    results[name] = ok;
  }

  // Environment fingerprint to guide a fix if every strategy fails.
  const canvases = [...document.querySelectorAll("canvas")];
  return {
    found: !!found,
    foundVia,
    strategies: results,
    env: {
      hasWindowPhaser: typeof window.Phaser !== "undefined",
      phaserPoolLen: globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool?.length ?? null,
      canvasCount: canvases.length,
      appExists: !!document.getElementById("app"),
      // window keys that look game/phaser related — clue hunting if nothing worked.
      suspiciousWindowKeys: Object.getOwnPropertyNames(window).filter(
        (k) => /phaser|game|scene|battle|rogue/i.test(k)).slice(0, 40),
      // own (non-standard) property names on the first canvas — Phaser sometimes tags it.
      canvasOwnKeys: canvases[0]
        ? Object.getOwnPropertyNames(canvases[0]).filter((k) => !(k in HTMLCanvasElement.prototype)).slice(0, 40)
        : [],
    },
  };
}`;

const log = (...a) => console.log("[harness]", ...a);

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    "--no-sandbox",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleLines = [];
page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => consoleLines.push(`PAGEERROR: ${e.message}`));

log("navigating to", URL);
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

// Poll discovery until a battle-shaped scene appears or we time out.
const start = Date.now();
let disc = null;
while (Date.now() - start < BOOT_TIMEOUT_MS) {
  disc = await page.evaluate(`(${DISCOVERY})()`);
  if (disc.found) { log(`scene acquired via "${disc.foundVia}" after ${((Date.now() - start) / 1000).toFixed(0)}s`); break; }
  log(`booting… canvases=${disc.env.canvasCount} windowPhaser=${disc.env.hasWindowPhaser} found=false`);
  await page.waitForTimeout(2500);
}

writeFileSync(join(OUT, "discovery.json"), JSON.stringify(disc, null, 2));
await page.screenshot({ path: join(OUT, "01-boot.png") }).catch(() => {});

let probes = null;
if (disc?.found) {
  // Inject our built userscript and exercise the public API against the real scene.
  await page.addScriptTag({ content: BUNDLE });
  await page.waitForTimeout(1500);
  probes = await page.evaluate(() => {
    const a = window.autoRibbon;
    if (!a) return { error: "window.autoRibbon missing after injection" };
    return { ready: a.ready(), sceneProbe: a.sceneProbe(), modeProbe: a.modeProbe(), snapshot: a.snapshot() };
  });
  writeFileSync(join(OUT, "probes.json"), JSON.stringify(probes, null, 2));
  await page.screenshot({ path: join(OUT, "02-injected.png") }).catch(() => {});
}

writeFileSync(join(OUT, "console.log"), consoleLines.join("\n"));
log("done. found =", disc?.found, "| via =", disc?.foundVia);
if (probes?.sceneProbe) log("bridge sceneProbe.found =", probes.sceneProbe.found, "via", probes.sceneProbe.via);
if (probes?.modeProbe) log("bridge handlerCount =", probes.modeProbe.handlerCount, "current =", probes.modeProbe.currentResolved);
await browser.close();
