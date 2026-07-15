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
import { sleep, actionsSentCount, press, recentPresses } from "./input";
import { Button, type ButtonName } from "./bridge";
import { getPolicy, applyPolicyModule, policyVersion } from "./policy-registry";
import { getStrategy, applyStrategyModule, strategyVersion } from "./strategy-registry";
import { publishHostSeam } from "./host-seam";
import { decideLoopAction, isServerTrouble } from "./runloop";
import { resetStarterSelect } from "./execution";
import { getCurrentPhaseName } from "./bridge";
import { summarizeProgress } from "./orchestrator";
import { readRoster } from "./roster";
import { checkRunSafety, resetSafety } from "./safety";
import { shouldRetry, noteRetry, retryGeneration, resetRetry, noteWave, retriesTaken } from "./retry";
import { applyGameSettings } from "./settings";
import { ballsThrownCount, lastCatchDecision } from "./catch";

let looping = false;
let lastSummary = "";
let lastProgress = "";
let lastTrouble = 0;
let announcedDone = false;

/**
 * Top-level meta-loop tick: route the current screen to a high-level action (runloop.ts) and
 * dispatch — battle screens to the policy, the title flow to the start-run driver, the
 * starter-select screen to the team driver. Composes the whole bot.
 */
async function tick(snap: GameSnapshot): Promise<void> {
  // Server/connection trouble (live site backend drops out often): the game auto-reconnects, so
  // idle and let it recover — never mash. Log at most once every 15s so it's visible but quiet.
  if (isServerTrouble(snap.uiMode)) {
    if (Date.now() - lastTrouble > 15_000) {
      lastTrouble = Date.now();
      log.warn(`[net] ${snap.uiMode} — server/connection trouble; waiting for the game to reconnect.`);
    }
    return;
  }

  const phase = getCurrentPhaseName();

  // Game over with the retry setting on: the game offers to replay the wave. Retry — the battle
  // policy varies its line each generation (see retry.ts / FIGHT) — up to the cap, else give up.
  if (phase === "GameOverPhase" && snap.uiMode === "CONFIRM") {
    if (shouldRetry()) {
      noteRetry();
      log.info(`[retry] lost — retrying the wave (attempt ${retryGeneration()}, varied strategy).`);
      await press(Button.ACTION, "retry");
    } else {
      log.info("[retry] out of retries — taking the game over and re-planning.");
      await press(Button.CANCEL, "retry:give-up");
    }
    return;
  }

  // The starter-select phase spans several UI sub-modes (grid, add-to-party menu, start confirm,
  // save-slot) that decideLoopAction can't tell apart by mode alone — route the whole phase to the
  // team driver. Outside it, drop the cached plan so the next run re-plans from fresh ribbons.
  if (phase === "SelectStarterPhase") {
    // Route through the hot-swappable strategy registry, not a static import: a live strategy patch
    // (autoRibbon.reloadStrategy) takes effect on the next tick and resumes the in-flight
    // starter-select in place (its phase state lives on the host seam — see exec-state.ts).
    if (config.enabled) await getStrategy().driveStarterSelect(snap);
    return;
  }
  resetStarterSelect();

  const inRun = snap.battle != null;

  // Dead-man's switch + retry budget tracking, scoped to an active run.
  if (inRun) {
    noteWave(snap.battle?.waveIndex); // resets the retry budget when we progress to a new wave
    const verdict = checkRunSafety(snap);
    if (verdict.halt) {
      log.banner(`SAFETY HALT — ${verdict.reason}. Stopping (autoRibbon.start() to resume).`);
      config.enabled = false;
      return;
    }
  } else {
    resetSafety(); // fresh caps for the next run
    resetRetry(); // fresh retry budget for the next run
  }

  // At the title, log ribbon progress (deduped) and decide whether the objective is complete.
  let objectiveDone = false;
  if (snap.uiMode === "TITLE") {
    const plan = getStrategy().planRun(readRoster());
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
      // Route through the hot-swappable registry, not a static import: a live policy patch
      // (autoRibbon.reloadPolicy) takes effect on the very next tick, resuming in place.
      await getPolicy()(snap);
      return;
    case "START_RUN":
      await getStrategy().driveStartRun(snap);
      return;
    case "SELECT_TEAM":
      await getStrategy().driveStarterSelect(snap); // fallback if the phase name was unreadable
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
      if (snap.ready) applyGameSettings(); // once: Set battle style, retries on, fast, no tutorials

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
  /** Compact ribbon progress for telemetry/soak: {owned, ribboned, remaining, done}. */
  progress(): { owned: number; ribboned: number; remaining: number; done: boolean } {
    const plan = getStrategy().planRun(readRoster());
    return { owned: plan.ownedCount, ribboned: plan.ribbonedCount, remaining: plan.remaining, done: plan.done };
  },
  /**
   * One-call rich telemetry for the soak harness — battle/party health + cumulative counters, so a
   * sample is atomic (no multi-round-trip races). All defensively read; never throws.
   */
  telemetry(): Record<string, unknown> {
    const s = readState();
    const party = s.playerParty ?? [];
    const alive = party.filter((p) => !p.fainted);
    const hpFrac = alive.length
      ? alive.reduce((a, p) => a + (p.hpRatio ?? 0), 0) / alive.length
      : 0;
    const levels = party.map((p) => p.level ?? 0);
    const foe = (s.enemyParty ?? []).find((p) => p.onField) ?? (s.enemyParty ?? [])[0];
    return {
      ready: s.ready,
      uiMode: s.uiMode,
      // Engine-side facts the harness needs to detect loops and that I "see" the screen from:
      phase: getCurrentPhaseName(),
      cursor: s.cursor ?? null,
      awaitingActionInput: s.awaitingActionInput ?? null,
      policyVersion: policyVersion(),
      strategyVersion: strategyVersion(),
      recentPresses: recentPresses().slice(-12),
      wave: s.battle?.waveIndex ?? null,
      isBossWave: s.battle?.isBossWave ?? false,
      partySize: party.length,
      partyAlive: alive.length,
      partyFainted: party.length - alive.length,
      hpFrac: Math.round(hpFrac * 100) / 100,
      topLevel: levels.length ? Math.max(...levels) : 0,
      foeLevel: foe?.level ?? null,
      foeBoss: foe?.isBoss ?? false,
      foeCaught: foe?.speciesCaught ?? null,
      retries: retriesTaken(),
      ballsThrown: ballsThrownCount(),
      catchDecision: lastCatchDecision(),
      ...this.progress(),
    };
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

  /**
   * Hot-swap the decision policy WITHOUT reloading the page. `src` is a freshly-built policy
   * bundle (dist/policy.hot.js) that sets globalThis.__policyModule = { step }. The Phaser scene
   * keeps running, so the next tick resumes from the current wave/phase with the new logic. A bad
   * patch is rejected and the previous policy keeps driving — see policy-registry.applyPolicyModule.
   */
  reloadPolicy(src: string): { ok: boolean; version: number; error?: string } {
    const res = applyPolicyModule(src);
    if (res.ok && !config.enabled) {
      // If we'd paused on the stall, come back to life with the patched policy.
      config.enabled = true;
      void driveLoop();
    }
    return res;
  },
  /** Current policy version (0 = the built-in policy that shipped in the bundle). */
  policyVersion(): number {
    return policyVersion();
  },

  /**
   * Hot-swap the UI-driving + planning STRATEGY WITHOUT reloading the page. `src` is a freshly-built
   * strategy bundle (dist/strategy.hot.js) that sets globalThis.__strategyModule =
   * { driveStartRun, driveStarterSelect, planRun }. An in-flight starter-select resumes in place
   * (its phase state lives on the host seam). A bad patch is rejected and the previous strategy keeps
   * driving — see strategy-registry.applyStrategyModule.
   */
  reloadStrategy(src: string): { ok: boolean; version: number; error?: string } {
    const res = applyStrategyModule(src);
    if (res.ok && !config.enabled) {
      // If we'd paused on the stall, come back to life with the patched strategy.
      config.enabled = true;
      void driveLoop();
    }
    return res;
  },
  /** Current strategy version (0 = the built-in strategy that shipped in the bundle). */
  strategyVersion(): number {
    return strategyVersion();
  },
};

(window as any).autoRibbon = api;

// Expose the live seam singletons so a hot-swapped policy/strategy bundle shares this bundle's exact
// config/input/bridge/catch/retry/roster/exec-state (see host-seam.ts + seam-shims/). Must run
// before any reloadPolicy/reloadStrategy call.
publishHostSeam();

mountHud();
void driveLoop();
log.banner(`loaded. window.autoRibbon ready (dryRun=${config.dryRun}).`);
