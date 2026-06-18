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
import { sleep, actionsSentCount, press } from "./input";
import { Button, type ButtonName } from "./bridge";
import { step as policyStep } from "./policy";
import { decideLoopAction } from "./runloop";
import { driveStartRun, driveStarterSelect, resetStarterSelect } from "./execution";
import { getCurrentPhaseName } from "./bridge";
import { planRun, summarizeProgress } from "./orchestrator";
import { readRoster } from "./roster";
import { checkRunSafety, resetSafety } from "./safety";

let looping = false;
let lastSummary = "";
let lastProgress = "";
let announcedDone = false;

/**
 * Top-level meta-loop tick: route the current screen to a high-level action (runloop.ts) and
 * dispatch — battle screens to the policy, the title flow to the start-run driver, the
 * starter-select screen to the team driver. Composes the whole bot.
 */
async function tick(snap: GameSnapshot): Promise<void> {
  // The starter-select phase spans several UI sub-modes (grid, add-to-party menu, start confirm,
  // save-slot) that decideLoopAction can't tell apart by mode alone — route the whole phase to the
  // team driver. Outside it, drop the cached plan so the next run re-plans from fresh ribbons.
  const phase = getCurrentPhaseName();
  if (phase === "SelectStarterPhase") {
    if (config.enabled) await driveStarterSelect(snap);
    return;
  }
  resetStarterSelect();

  const inRun = snap.battle != null;

  // Dead-man's switch: halt a wedged run (stuck wave / blown wall-clock) instead of spinning.
  if (inRun) {
    const verdict = checkRunSafety(snap);
    if (verdict.halt) {
      log.banner(`SAFETY HALT — ${verdict.reason}. Stopping (autoRibbon.start() to resume).`);
      config.enabled = false;
      return;
    }
  } else {
    resetSafety(); // fresh caps for the next run
  }

  // At the title, log ribbon progress (deduped) and decide whether the objective is complete.
  let objectiveDone = false;
  if (snap.uiMode === "TITLE") {
    const plan = planRun(readRoster());
    objectiveDone = plan.done;
    const progress = summarizeProgress(plan);
    if (progress !== lastProgress) {
      lastProgress = progress;
      log.info(`[progress] ${progress}`);
    }
  }

  const action = decideLoopAction({ uiMode: snap.uiMode, enabled: config.enabled, inRun, objectiveDone });
  switch (action) {
    case "PLAY":
      await policyStep(snap);
      return;
    case "START_RUN":
      await driveStartRun(snap);
      return;
    case "SELECT_TEAM":
      await driveStarterSelect(snap); // fallback if the phase name was unreadable
      return;
    case "STOP_DONE":
      if (!announcedDone) {
        announcedDone = true;
        log.banner("OBJECTIVE COMPLETE — every owned starter line is ribboned. Idling.");
      }
      return;
    case "WAIT":
      return;
  }
}

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

      await tick(snap); // routes to policy / start-run / team driver (no-op presses under dryRun)
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
  /**
   * Diagnostic: send ONE button through the bot's real input layer (same path the policy
   * uses — honors config.dryRun/enabled/pacing). Lets the live harness validate input
   * DRIVING (does ui.processInput actually move a real handler?). e.g. autoRibbon.tap("DOWN").
   */
  tap(name: ButtonName): Promise<boolean> {
    return press(Button[name], `diag:${name}`);
  },
};

(window as any).autoRibbon = api;

mountHud();
void driveLoop();
log.banner(`loaded. window.autoRibbon ready (dryRun=${config.dryRun}).`);
