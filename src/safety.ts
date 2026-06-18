// ── Safety caps ──────────────────────────────────────────────────────────────
// Unattended operation needs a dead-man's switch: if a run wedges (two mons that can't damage
// each other, an unhandled screen mid-battle, a softlock), the bot must HALT rather than spin
// forever. We watch two bounds during a run — turns on a single wave and total wall-clock — and
// return a halt verdict when either is exceeded. The caller stops the bot (kill-switch) so an
// operator can look. Pure given the clock, so it's unit-testable.

import { config } from "./config";
import type { GameSnapshot } from "./state";

let runStartMs = 0;
let currentWave = -1;
let wavePeakTurn = 0;

/** Reset the per-run trackers (call between runs / at the title). */
export function resetSafety(): void {
  runStartMs = 0;
  currentWave = -1;
  wavePeakTurn = 0;
}

export interface SafetyVerdict {
  halt: boolean;
  reason?: string;
}

/**
 * Check the active run against the safety caps. Lazily starts the wall-clock on the first call
 * after a reset. No-op (never halts) when not in a battle.
 */
export function checkRunSafety(s: GameSnapshot, now: number = Date.now()): SafetyVerdict {
  const b = s.battle;
  if (!b) return { halt: false };

  if (runStartMs === 0) runStartMs = now;
  if (now - runStartMs > config.maxWallClockPerRunMs) {
    return { halt: true, reason: `run exceeded ${Math.round(config.maxWallClockPerRunMs / 1000)}s wall-clock` };
  }

  const wave = b.waveIndex ?? 0;
  if (wave !== currentWave) {
    currentWave = wave;
    wavePeakTurn = 0;
  }
  const turn = b.turn ?? 0;
  if (turn > wavePeakTurn) wavePeakTurn = turn;
  if (wavePeakTurn > config.maxTurnsPerWave) {
    return { halt: true, reason: `wave ${wave} ran ${wavePeakTurn} turns (> ${config.maxTurnsPerWave}) — likely stuck` };
  }

  return { halt: false };
}
