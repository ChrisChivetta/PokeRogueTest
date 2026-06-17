// Battle policy (Phase 1) — minimal, safe, hands-off play through early waves.
//
// One decision per call, driven entirely by the current UI mode + snapshot:
//   • dialogue/messages   → advance
//   • COMMAND             → choose FIGHT
//   • FIGHT               → pick the best PP-aware, type-effective move
//   • MODIFIER_SELECT     → skip the reward (CANCEL → onActionInput(-1,-1) → next wave)
//   • CONFIRM / PARTY     → back out (decline learn-move prompts, etc.)
// Unknown modes are left alone (we don't guess), except a gentle dialogue nudge.

import type { GameSnapshot } from "./state";
import { Button } from "./bridge";
import { press, moveCursor2x2 } from "./input";
import { bestMoveIndex } from "./typechart";

const onField = (party: GameSnapshot["playerParty"]) => party.find((p) => p.onField) ?? party[0];

/** Perform at most one paced action appropriate to the current state. */
export async function step(s: GameSnapshot): Promise<void> {
  if (!s.ready) return;

  // A handler waiting for press-to-continue (dialogue, prompts) — advance it.
  if (s.awaitingActionInput) {
    await press(Button.ACTION, "advance");
    return;
  }

  switch (s.uiMode) {
    case "MESSAGE":
      // Non-blocking battle text; a nudge advances it without harm.
      await press(Button.ACTION, "message");
      return;

    case "COMMAND": {
      const cur = s.cursor ?? 0;
      if (cur !== 0) await moveCursor2x2(cur, 0); // 0 = FIGHT
      await press(Button.ACTION, "command:fight");
      return;
    }

    case "FIGHT": {
      const lead = onField(s.playerParty);
      const foe = onField(s.enemyParty);
      const idx = bestMoveIndex(lead, foe);
      if (idx == null) {
        // No usable move — back out so we don't stall on FIGHT.
        await press(Button.CANCEL, "fight:no-move");
        return;
      }
      const cur = s.cursor ?? 0;
      if (cur !== idx) await moveCursor2x2(cur, idx);
      await press(Button.ACTION, `fight:move${idx}`);
      return;
    }

    case "TARGET_SELECT":
      // Singles rarely hit this; default target is fine.
      await press(Button.ACTION, "target");
      return;

    case "MODIFIER_SELECT":
      // Skip the reward and advance to the next wave.
      await press(Button.CANCEL, "reward:skip");
      return;

    case "CONFIRM":
      // Decline optional prompts (e.g. learn-a-new-move) to keep the moveset stable.
      await press(Button.CANCEL, "confirm:decline");
      return;

    case "PARTY":
      await press(Button.CANCEL, "party:back");
      return;

    default:
      // STARTER_SELECT/TITLE/etc. are out of Phase-1 scope; don't act.
      return;
  }
}
