// Battle policy (Phase 1) — minimal, safe, hands-off play.
//
// One decision per call, driven by the current UI mode + snapshot. Guiding rule from
// live runs: DON'T mash. Acting on every MESSAGE frame races the phase/animation system
// into a stuck state. So we only advance dialogue when the handler is genuinely waiting
// (awaitingActionInput), handle actionable modes explicitly, and otherwise wait.
//
//   • COMMAND          → choose FIGHT
//   • FIGHT            → best PP-aware, type-effective move
//   • TARGET_SELECT    → default target
//   • MODIFIER_SELECT  → take the highlighted reward (free items keep the run alive)
//   • PARTY            → bring in / apply to a usable mon (faint-switch + reward target)
//   • CONFIRM          → decline optional prompts (learn-move) to keep moveset stable
//   • awaiting input   → advance dialogue
//   • everything else  → wait

import type { GameSnapshot } from "./state";
import { Button, getActiveHandler } from "./bridge";
import { press, moveCursor2x2 } from "./input";
import { bestMoveIndex } from "./typechart";

const onField = (party: GameSnapshot["playerParty"]) => party.find((p) => p.onField) ?? party[0];

/** Perform at most one paced action appropriate to the current state. */
export async function step(s: GameSnapshot): Promise<void> {
  if (!s.ready) return;

  switch (s.uiMode) {
    case "COMMAND": {
      const cur = s.cursor ?? 0;
      if (cur !== 0) await moveCursor2x2(cur, 0); // 0 = FIGHT
      await press(Button.ACTION, "command:fight");
      return;
    }

    case "FIGHT": {
      const idx = bestMoveIndex(onField(s.playerParty), onField(s.enemyParty));
      if (idx == null) {
        await press(Button.CANCEL, "fight:no-move");
        return;
      }
      const cur = s.cursor ?? 0;
      if (cur !== idx) await moveCursor2x2(cur, idx);
      await press(Button.ACTION, `fight:move${idx}`);
      return;
    }

    case "TARGET_SELECT":
      await press(Button.ACTION, "target");
      return;

    case "MODIFIER_SELECT":
      // Take the highlighted reward. ACTION selects it; if it needs a target the game
      // opens PARTY (handled below). Free items (heals/berries/held) keep the run alive.
      await press(Button.ACTION, "reward:take");
      return;

    case "PARTY":
      await handleParty(s);
      return;

    case "CONFIRM":
      await press(Button.CANCEL, "confirm:decline");
      return;

    case "SUMMARY":
      // Not part of normal battle flow — back out so a stray summary screen can't
      // wedge the bot (also makes it resilient to unexpected UI states generally).
      await press(Button.CANCEL, "summary:back");
      return;
  }

  // Dialogue / message prompts: advance ONLY when the handler is actually waiting.
  if (s.awaitingActionInput) {
    await press(Button.ACTION, "advance");
    return;
  }

  // Plain MESSAGE / transitions / out-of-scope modes → let the game settle.
}

/**
 * PARTY covers faint-switch (FAINT_SWITCH/SWITCH) and reward targeting (MODIFIER).
 * Flow: pick a usable member (lowest-HP non-fainted), open its option menu, then confirm
 * the primary option — which is SEND_OUT for a switch and APPLY for a reward (both first).
 * If every member is fainted, back out (the game-over will follow).
 */
async function handleParty(s: GameSnapshot): Promise<void> {
  const h = getActiveHandler();

  // The Send-Out / Apply / Summary / Cancel sub-menu is open → confirm the first option.
  if (h?.optionsMode === true) {
    await press(Button.ACTION, "party:confirm");
    return;
  }

  const party = s.playerParty;
  // Target the lowest-HP member that can still battle (good for both healing and switching).
  let target = -1;
  let bestHp = Infinity;
  party.forEach((p, i) => {
    if (!p.fainted) {
      const hp = p.hpRatio ?? 1;
      if (hp < bestHp) { bestHp = hp; target = i; }
    }
  });

  if (target < 0) {
    await press(Button.CANCEL, "party:none-usable");
    return;
  }

  const cur = s.cursor ?? 0;
  if (cur < target) { await press(Button.DOWN, "party:nav"); return; }
  if (cur > target) { await press(Button.UP, "party:nav"); return; }
  await press(Button.ACTION, "party:select"); // open option menu for this member
}
