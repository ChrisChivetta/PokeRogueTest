// Shared helpers for the auto-ribbon integration tests: configure the bot for
// synchronous test driving and run our real policy against the live (headless) scene.
// Imported by the *.test.ts files after staging into the PokéRogue checkout.
import { __setSceneForTest, getActiveHandler } from "./bot/bridge";
import { config } from "./bot/config";
import { step } from "./bot/policy";
import { readState } from "./bot/state";

// UI modes where our policy takes an action (vs. waiting on dialogue/transitions).
const ACTIONABLE = new Set([
  "COMMAND", "FIGHT", "BALL", "TARGET_SELECT", "MODIFIER_SELECT", "PARTY", "CONFIRM", "SUMMARY",
  "MYSTERY_ENCOUNTER", "OPTION_SELECT",
]);

/** Point the bridge at the test scene and make input synchronous (processInput is sync; drop pacing). */
export function attachBot(scene: unknown): void {
  __setSceneForTest(scene);
  config.enabled = true;
  config.dryRun = false;
  config.inputDelayMinMs = 0;
  config.inputDelayMaxMs = 0;
}

export function detachBot(): void {
  __setSceneForTest(null);
  config.dryRun = true;
}

/**
 * Drive our policy synchronously while the UI sits in an actionable mode. processInput is
 * synchronous, so each step() advances the real handler one action; we stop when the UI
 * leaves the actionable modes (turn queued / dialogue / transition) or hit the cap.
 * Returns the number of steps taken (for sanity assertions).
 */
let __lastMode = "";
export function driveBot(maxSteps = 40): number {
  let i = 0;
  for (; i < maxSteps; i++) {
    const s = readState();
    if (process.env.BOT_TRACE) {
      const tag = `${s.uiMode}:${s.cursor}`;
      if (tag !== __lastMode) {
        __lastMode = tag;
        const extra = s.uiMode === "BALL" ? ` balls=[${s.pokeballCounts}]` : "";
        process.stderr.write(`MODE ${s.uiMode} (cursor=${s.cursor})${extra}\n`);
      }
    }
    if (!s.ready || !ACTIONABLE.has(s.uiMode)) break;
    if (process.env.BOT_TRACE && s.uiMode === "PARTY") {
      const h: any = getActiveHandler();
      process.stderr.write(`PARTY om=${h?.optionsMode} opts=[${h?.options}] oc=${h?.optionsCursor} cur=${h?.cursor} pum=${h?.partyUiMode}\n`);
    }
    void step(s);
  }
  return i;
}

// A battle turn passes through many async decision phases (commands, target selects,
// switches, rewards, learn-move) that interleave unpredictably. PokéRogue's onNextPrompt
// queue is FIFO/head-only, so pre-registering handlers can't match the real ordering.
// Instead we mirror the live bot's timer loop: poll on an interval and drive whenever the
// UI is actionable, while an async `advance()` walks the phase system forward.
export async function withBotDriving(advance: () => Promise<void>): Promise<void> {
  const id = setInterval(() => { try { driveBot(4); } catch { /* between phases */ } }, 0);
  try {
    await advance();
  } finally {
    clearInterval(id);
  }
}
