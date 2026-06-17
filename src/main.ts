// ── Entry point ──────────────────────────────────────────────────────────────
// Phase 0: OBSERVE-ONLY. Acquire the scene, sample state every tick, log a summary,
// and render a tiny on-screen HUD. Sends ZERO inputs (config.dryRun + no input layer
// wired yet). This proves the bridge/state reads are correct on the live site before
// any input code exists.
//
// Exposes window.autoRibbon for manual control from the console:
//   autoRibbon.snapshot()  → full state object, logged + returned
//   autoRibbon.stop()      → kill-switch (sets enabled=false)
//   autoRibbon.start()     → resume
//   autoRibbon.config      → live tunables

import { config } from "./config";
import { log } from "./log";
import { isSceneReady } from "./bridge";
import { readState, summarize, type GameSnapshot } from "./state";
import { mountHud, updateHud } from "./hud";

let timer: number | null = null;
let lastSummary = "";

function tick(): void {
  if (!config.enabled) return;

  const snap = readState();

  // Only log when the summary changes — avoids spamming the console every 500ms.
  const summary = summarize(snap);
  if (summary !== lastSummary) {
    log.info(summary);
    lastSummary = summary;
  }
  updateHud(snap);

  // Phase 0 ends here: no decision, no input. Later phases plug the policy in below.
}

function loop(): void {
  if (timer != null) return;
  timer = window.setInterval(tick, config.tickIntervalMs);
  log.banner(
    `started — OBSERVE-ONLY (dryRun=${config.dryRun}). ` +
      `Waiting for BattleScene… use autoRibbon.snapshot() to inspect.`,
  );
}

// Public console API.
const api = {
  config,
  start(): void {
    config.enabled = true;
    loop();
    log.banner("resumed");
  },
  stop(): void {
    config.enabled = false;
    log.banner("STOPPED (kill-switch). State reads paused.");
  },
  snapshot(): GameSnapshot {
    const s = readState();
    log.info("snapshot:", s);
    return s;
  },
  ready(): boolean {
    return isSceneReady();
  },
};

(window as any).autoRibbon = api;

mountHud();
loop();
log.banner("loaded. window.autoRibbon ready.");
