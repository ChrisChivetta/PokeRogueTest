// Battle policy (Phase 1) — minimal, safe, hands-off play through early waves.
//
// One decision per call, driven by the current UI mode + snapshot. The guiding rule
// learned from live runs: DON'T mash. Acting on every MESSAGE frame races the game's
// phase/animation system into a stuck/crashed state. So we only advance dialogue when
// the handler is genuinely waiting (awaitingActionInput), handle the few actionable
// modes explicitly, and otherwise wait for the game to settle.
//
//   • COMMAND          → choose FIGHT
//   • FIGHT            → best PP-aware, type-effective move
//   • TARGET_SELECT    → default target
//   • MODIFIER_SELECT  → skip the reward (CANCEL → onActionInput(-1,-1) → next wave)
//   • CONFIRM / PARTY  → back out (decline learn-move prompts, etc.)
//   • awaiting input   → advance dialogue
//   • everything else  → wait (do nothing)

import type { GameSnapshot } from "./state";
import { Button } from "./bridge";
import { press, moveCursor2x2 } from "./input";
import { bestMoveIndex } from "./typechart";

const onField = (party: GameSnapshot["playerParty"]) => party.find((p) => p.onField) ?? party[0];

/** Perform at most one paced action appropriate to the current state. */
export async function step(s: GameSnapshot): Promise<void> {
  if (!s.ready) return;

  // Actionable modes take priority over the generic dialogue-advance, so e.g. a
  // MODIFIER_SELECT that is awaiting input is SKIPPED (CANCEL), not accepted (ACTION).
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
      await press(Button.CANCEL, "reward:skip");
      return;

    case "CONFIRM":
      // Decline optional prompts (e.g. learn-a-new-move) to keep the moveset stable.
      await press(Button.CANCEL, "confirm:decline");
      return;

    case "PARTY":
      await press(Button.CANCEL, "party:back");
      return;
  }

  // Dialogue / message prompts: advance ONLY when the handler is actually waiting.
  // Non-waiting messages auto-advance; pressing into them races the game and can crash.
  if (s.awaitingActionInput) {
    await press(Button.ACTION, "advance");
    return;
  }

  // Anything else (plain MESSAGE, transitions, STARTER_SELECT/TITLE) → let it settle.
}
