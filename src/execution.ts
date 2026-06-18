// ── Execution adapters (the UI-driving glue) ─────────────────────────────────
// These enact the orchestration plan by driving the real title / starter-select screens —
// the version-fragile half of Phase 3 that GameManager can't test (validated on the live smoke
// harness instead). One paced action per call, mirroring the battle policy. The live title→run
// flow (mapped via harness/smoke):
//   MESSAGE intro → OPTION_SELECT gender (fresh save) → TITLE [New Game…] → OPTION_SELECT
//   [Classic…] → STARTER_SELECT.

import type { GameSnapshot } from "./state";
import { Button, getActiveHandler } from "./bridge";
import { press } from "./input";

/** Labels of the active option/title menu, lowercased; [] if unreadable. */
function menuLabels(): string[] {
  const opts = getActiveHandler()?.config?.options;
  if (!Array.isArray(opts)) return [];
  return opts.map((o: any) => (typeof o?.label === "string" ? o.label.toLowerCase() : ""));
}

/** Vertical option menus (OptionSelect / Title): step the cursor toward `target`, else select. */
async function pickVerticalOption(cursor: number, target: number, why: string): Promise<void> {
  if (cursor < target) { await press(Button.DOWN, `${why}:down`); return; }
  if (cursor > target) { await press(Button.UP, `${why}:up`); return; }
  await press(Button.ACTION, `${why}:select`);
}

/**
 * Navigate the title flow toward STARTER_SELECT. At each menu we target "New Game"/"Classic" by
 * label (locale-tolerant via substring), and fall back to the first option to step through
 * one-time setup prompts (e.g. the gender pick on a fresh save). Dialogue advances; confirms are
 * accepted (we always want to begin a run).
 */
export async function driveStartRun(s: GameSnapshot): Promise<void> {
  switch (s.uiMode) {
    case "MESSAGE":
      if (s.awaitingActionInput) await press(Button.ACTION, "start:advance");
      return;

    case "CONFIRM":
      // Pre-run confirms ("start a new run?") → accept.
      await press(Button.ACTION, "start:confirm");
      return;

    case "TITLE":
    case "OPTION_SELECT": {
      const labels = menuLabels();
      let target = labels.findIndex((l) => l.includes("new game") || l.includes("classic"));
      if (target < 0) target = 0; // setup prompt (gender, etc.) → first option to advance
      await pickVerticalOption(s.cursor ?? 0, target, "start");
      return;
    }
  }
  // Other screens (SAVE_SLOT, loading) → wait for the next tick.
}
