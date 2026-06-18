// Live smoke test: boot the REAL browser-rendered PokéRogue (local dev server), inject the
// built bot, and exercise the version-fragile bridge against a real Phaser scene — the Phase 0
// verification GameManager can't give us. Observe-only (the bot defaults to dryRun=true).
//
// Usage: node harness/smoke.mjs   (vite dev server must be up on http://127.0.0.1:8000)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const URL = process.env.SMOKE_URL ?? "http://127.0.0.1:8000/";
const BUNDLE = "dist/pokerogue-auto-ribbon.user.js";
const BOOT_TIMEOUT = 120_000;

const log = (...a) => console.log("[smoke]", ...a);

const browser = await chromium.launch({
  args: [
    "--enable-unsafe-swiftshader", // software WebGL (no GPU in the container)
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ],
});
const page = await browser.newPage();
page.on("console", (m) => log(`page> ${m.text()}`));
page.on("pageerror", (e) => log(`page!ERR ${e.message}`));

let failed = false;
try {
  log(`loading ${URL} …`);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: BOOT_TIMEOUT });

  // Wait for Phaser to boot and the BattleScene to exist (walk the same path the bridge uses).
  log("waiting for the Phaser game to boot…");
  await page.waitForFunction(
    () => {
      const pool = globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool;
      if (!Array.isArray(pool)) return false;
      for (const e of pool) {
        const scenes = e?.parent?.game?.scene?.scenes;
        if (Array.isArray(scenes) && scenes.some((s) => s && typeof s.getPlayerParty === "function")) {
          return true;
        }
      }
      return false;
    },
    { timeout: BOOT_TIMEOUT, polling: 500 },
  );
  log("game booted, BattleScene present (still loading assets) …");

  // Inject the built bot (IIFE userscript; banner is just comments). It sets window.autoRibbon.
  await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });
  await page.waitForFunction(() => !!globalThis.autoRibbon, { timeout: 15_000 });
  log("bot injected, window.autoRibbon present ✓");

  // PokéRogue waits for a pointer gesture to leave the splash; nudge the canvas, then give the
  // game time to finish loading + reach the title (software WebGL runs at a few FPS).
  const canvas = await page.$("canvas");
  if (canvas) {
    await canvas.click({ position: { x: 400, y: 300 } }).catch(() => {});
  }
  log("waiting for the bridge to report a ready BattleScene (assets are slow)…");
  let ready = false;
  for (let i = 0; i < 75; i++) {
    const p = await page.evaluate(() => globalThis.autoRibbon.sceneProbe());
    if (p.found && p.battleShaped) { ready = true; break; }
    if (i % 5 === 0) log(`  …not ready yet (t=${i * 2}s): scenes=[${p.sceneCtors}] battleShaped=${p.battleShaped}`);
    await page.waitForTimeout(2000);
  }
  log(ready ? "BattleScene ready ✓" : "BattleScene never became ready (reporting diagnostics anyway)");

  // ── Bridge validation: the two version-fragile assumptions ──────────────────
  const scene = await page.evaluate(() => globalThis.autoRibbon.sceneProbe());
  log("sceneProbe:", JSON.stringify(scene));
  const mode = await page.evaluate(() => globalThis.autoRibbon.modeProbe());
  log("modeProbe.current:", mode.currentNumber, "→", mode.currentResolved, `(${mode.currentHandlerCtor})`);
  log("modeProbe.handlerCount:", mode.handlerCount);
  // Definitive UI_MODE_ORDER check: every live handler index should map to the expected name.
  // We can corroborate the ones whose class names survive (dev build) by name; the rest by count.
  const NAME_TO_MODE = {
    CommandUiHandler: "COMMAND", FightUiHandler: "FIGHT", BallUiHandler: "BALL",
    ModifierSelectUiHandler: "MODIFIER_SELECT", PartyUiHandler: "PARTY",
    TargetSelectUiHandler: "TARGET_SELECT", TitleUiHandler: "TITLE",
    BattleMessageUiHandler: "MESSAGE", MessageUiHandler: "MESSAGE", SummaryUiHandler: "SUMMARY",
    StarterSelectUiHandler: "STARTER_SELECT", ConfirmUiHandler: "CONFIRM",
    SaveSlotSelectUiHandler: "SAVE_SLOT", MysteryEncounterUiHandler: "MYSTERY_ENCOUNTER",
  };
  let drift = 0;
  for (const h of mode.handlers) {
    const mapped = NAME_TO_MODE[h.ctor];
    if (mapped && mapped !== h.expected) {
      log(`  DRIFT @${h.index}: expected ${h.expected} but handler is ${h.ctor} (${mapped})`);
      drift++;
    }
  }
  log(`UI_MODE_ORDER cross-check: ${drift === 0 ? "no drift" : drift + " mismatches"} across ${mode.handlerCount} handlers`);

  const snap = await page.evaluate(() => {
    const s = globalThis.autoRibbon.snapshot();
    return { ready: s.ready, uiMode: s.uiMode, wave: s.battle?.waveIndex ?? null, party: s.playerParty.length };
  });
  log("snapshot:", JSON.stringify(snap));

  // ── Assertions ──────────────────────────────────────────────────────────────
  const checks = [
    ["scene acquired via CanvasPool", scene.found && scene.via === "phaser-canvaspool"],
    ["scene is battle-shaped", scene.battleShaped === true],
    ["Phaser global present", scene.phaserGlobalPresent === true],
    ["UI mode resolves to a known name", snap.uiMode && snap.uiMode !== "UNKNOWN"],
    ["snapshot is ready", snap.ready === true],
    ["handler array non-empty", mode.handlerCount > 0],
    ["UI_MODE_ORDER length matches live handlers (48)", mode.handlerCount === 48],
    ["no UI-mode drift on named handlers", drift === 0],
  ];
  log("───── results ─────");
  for (const [name, ok] of checks) {
    log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed = true;
  }
} catch (e) {
  log("ERROR:", e.message);
  failed = true;
} finally {
  await browser.close();
}

log(failed ? "SMOKE TEST FAILED" : "SMOKE TEST PASSED ✓");
process.exit(failed ? 1 : 0);
