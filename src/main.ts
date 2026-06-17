// ── Entry point ──────────────────────────────────────────────────────────────
// Phase 1: an async drive loop. Each iteration samples state, logs/HUDs it, then asks
// the policy to take at most one human-paced action. ALL input is gated by config.dryRun
// (when true, the policy "runs" but the input driver only logs intended presses — so the
// loop is observe-only and identical to Phase 0). Flip dryRun=false to actually play.
//
// Console API on window.autoRibbon:
//   snapshot()    → full state object, logged + returned
//   sceneProbe()  → how/whether the BattleScene was acquired
//   modeProbe()   → dump ui.handlers to verify the UI-mode mapping
//   actions()     → count of inputs actually dispatched
//   stop()/start()→ kill-switch / resume
//   config        → live tunables (e.g. autoRibbon.config.dryRun = false)

import { config } from "./config";
import { log } from "./log";
import { isSceneReady, sceneProbe, modeProbe, type SceneProbe, type ModeProbe } from "./bridge";
import { readState, summarize, type GameSnapshot } from "./state";
import { mountHud, updateHud } from "./hud";
import { sleep, actionsSentCount } from "./input";
import { step as policyStep } from "./policy";

let looping = false;
let lastSummary = "";

async function driveLoop(): Promise<void> {
  if (looping) return;
  looping = true;
  log.banner(
    `loop started — ${config.dryRun ? "OBSERVE (dryRun)" : "ACTIVE — sending inputs"}. ` +
      `Use autoRibbon.stop() to halt.`,
  );

  while (config.enabled) {
    try {
      const snap = readState();

      const summary = summarize(snap);
      if (summary !== lastSummary) {
        log.info(summary);
        lastSummary = summary;
      }
      updateHud(snap);

      await policyStep(snap); // no-op presses under dryRun
    } catch (e) {
      log.error("[loop]", e);
    }
    await sleep(config.tickIntervalMs);
  }

  looping = false;
  log.banner("loop stopped.");
}

// Public console API.
const api = {
  config,
  start(): void {
    config.enabled = true;
    void driveLoop();
    log.banner(`resumed (dryRun=${config.dryRun})`);
  },
  stop(): void {
    config.enabled = false;
    log.banner("STOPPED (kill-switch).");
  },
  snapshot(): GameSnapshot {
    const s = readState();
    log.info("snapshot:", s);
    return s;
  },
  ready(): boolean {
    return isSceneReady();
  },
  actions(): number {
    return actionsSentCount();
  },
  sceneProbe(): SceneProbe {
    const p = sceneProbe();
    log.info("sceneProbe:", p);
    return p;
  },
  modeProbe(): ModeProbe {
    const p = modeProbe();
    log.info("modeProbe:", p);
    return p;
  },
};

(window as any).autoRibbon = api;

mountHud();
void driveLoop();
log.banner(`loaded. window.autoRibbon ready (dryRun=${config.dryRun}).`);
