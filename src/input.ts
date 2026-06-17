// Input driver — the ONLY place that sends input to the game. Everything routes
// through the game's own abstraction (ui.processInput(Button.*)), human-paced with
// jittered delays, gated by dryRun + the kill-switch, and counted against a cap.
//
// Phase 1: when config.dryRun is true, presses are LOGGED but not sent (observe).

import { config } from "./config";
import { log } from "./log";
import { getScene, Button } from "./bridge";

const NAME: Record<number, string> = Object.fromEntries(
  Object.entries(Button).map(([k, v]) => [v, k]),
);

let actionsSent = 0;
export function actionsSentCount(): number {
  return actionsSent;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Uniform jitter within the configured human-pacing bounds. */
function pacingDelay(): number {
  const { inputDelayMinMs: a, inputDelayMaxMs: b } = config;
  return a + Math.random() * Math.max(0, b - a);
}

/**
 * Send a single button through the game's input layer, then wait a human-paced beat.
 * Returns true if an input was actually dispatched (false under dryRun / disabled /
 * scene-not-ready). Never throws — input is best-effort.
 */
export async function press(button: number, why = ""): Promise<boolean> {
  if (!config.enabled) return false;
  const label = `${NAME[button] ?? button}${why ? ` (${why})` : ""}`;

  if (config.dryRun) {
    log.info(`[dryRun] would press ${label}`);
    await sleep(pacingDelay());
    return false;
  }

  const ui = getScene()?.ui;
  if (!ui || typeof ui.processInput !== "function") {
    log.debug(`[input] scene not ready; skipped ${label}`);
    return false;
  }

  try {
    ui.processInput(button);
    actionsSent++;
    log.debug(`[input] pressed ${label} (#${actionsSent})`);
  } catch (e) {
    log.warn("[input] processInput threw", e);
  }
  await sleep(pacingDelay());
  return true;
}

/**
 * Walk a 2×2 menu cursor (COMMAND, FIGHT) from `from` to `to` with discrete presses.
 * Layout: index = row*2 + col, so 0=TL 1=TR 2=BL 3=BR. Columns first, then rows.
 */
export async function moveCursor2x2(from: number, to: number): Promise<void> {
  let [fr, fc] = [from >> 1, from & 1];
  const [tr, tc] = [to >> 1, to & 1];
  while (fc < tc) { await press(Button.RIGHT, "nav"); fc++; }
  while (fc > tc) { await press(Button.LEFT, "nav"); fc--; }
  while (fr < tr) { await press(Button.DOWN, "nav"); fr++; }
  while (fr > tr) { await press(Button.UP, "nav"); fr--; }
}
