// ── Retry strategy ───────────────────────────────────────────────────────────
// With the game's "retry on defeat" setting ON, a loss offers to replay the wave from the last
// save. Repeating the same losing line would just lose again, so each retry bumps a GENERATION
// the battle policy uses to VARY its play (a different move ordering — see typechart.rankedMoves).
// We retry up to config.maxRetriesPerWave, then take the game over. The budget resets whenever we
// make progress to a new wave, so every fresh wall of a run gets its own retry allotment.

import { config } from "./config";

let generation = 0;
let lastWave = -1;

/** Reset all retry state (new run / leaving a run). */
export function resetRetry(): void {
  generation = 0;
  lastWave = -1;
}

/**
 * Note the current wave each tick during a run. Advancing to a NEW wave means the previous one was
 * cleared (or we reloaded forward), so the retry budget + variation reset for the new challenge.
 */
export function noteWave(waveIndex: number | null | undefined): void {
  if (typeof waveIndex !== "number") return;
  if (waveIndex !== lastWave) {
    if (waveIndex > lastWave) generation = 0; // progressed → fresh budget
    lastWave = waveIndex;
  }
}

/** Should we accept a retry prompt (vs. give up)? True while we still have retries left. */
export function shouldRetry(): boolean {
  return generation < config.maxRetriesPerWave;
}

/** Record that we've taken a retry — bumps the variation generation. */
export function noteRetry(): void {
  generation++;
}

/** Current strategy-variation generation (0 = first attempt; N = Nth retry). */
export function retryGeneration(): number {
  return generation;
}
