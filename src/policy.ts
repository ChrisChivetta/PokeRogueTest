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
      const lead = onField(s.playerParty);
      // Out of PP on every move → don't back out (that loops COMMAND↔FIGHT); select the
      // first slot and let the game force Struggle.
      const idx = bestMoveIndex(lead, onField(s.enemyParty)) ?? lead?.moves[0]?.index ?? 0;
      const cur = s.cursor ?? 0;
      if (cur !== idx) await moveCursor2x2(cur, idx);
      await press(Button.ACTION, `fight:move${idx}`);
      return;
    }

    case "TARGET_SELECT":
      await press(Button.ACTION, "target");
      return;

    case "MODIFIER_SELECT":
      // Take the highlighted reward (ACTION). If a previous attempt opened a target menu
      // we can't handle (a TM/move-replacement), skip this reward instead: CANCEL opens a
      // "skip?" confirm we then accept. Free items (heals/berries/held) keep the run alive.
      if (skipNextReward) {
        skipNextReward = false;
        acceptNextConfirm = true; // the skip confirmation should be accepted, not declined
        await press(Button.CANCEL, "reward:skip");
        return;
      }
      await press(Button.ACTION, "reward:take");
      return;

    case "PARTY":
      await handleParty(s);
      return;

    case "CONFIRM":
      // Accept our own skip confirmation; decline everything else (e.g. learn-a-move).
      if (acceptNextConfirm) {
        acceptNextConfirm = false;
        await press(Button.ACTION, "confirm:accept-skip");
        return;
      }
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

// PartyOption enum values (src/ui/handlers/party-ui-handler.ts). The per-member option
// list order varies by mode and the default cursor is NOT always the useful action, so
// we locate the option we want and navigate to it explicitly.
const PARTY_SEND_OUT = 0; // switch this mon in (faint-switch / switch)
const PARTY_APPLY = 3; // apply the reward item to this mon

// Set when a reward's target menu offers neither SEND_OUT nor APPLY (a TM / move-
// replacement we won't handle in Phase 1). We then back out of the party and skip the
// reward at MODIFIER_SELECT rather than oscillating forever in the option menu.
let skipNextReward = false;
// Set when CANCEL on MODIFIER_SELECT opens a "skip this reward?" confirm — that one CONFIRM
// should be accepted (ACTION), unlike learn-move confirms which we decline.
let acceptNextConfirm = false;
/** Reset internal policy state (test seam). */
export function resetPolicy(): void {
  skipNextReward = false;
  acceptNextConfirm = false;
}

/**
 * PARTY covers faint-switch and reward targeting. Two stages:
 *   1. No option menu yet → move the party cursor to the healthiest usable member and
 *      press ACTION to open its option menu (unless we've decided to abandon — then exit).
 *   2. Option menu open (handler.optionsMode) → navigate to SEND_OUT (switch) or APPLY
 *      (reward) and confirm. If neither is offered (a TM/move-replacement reward, or a
 *      check-team screen), abandon: flag the reward to skip and back out of the party.
 */
async function handleParty(s: GameSnapshot): Promise<void> {
  const h = getActiveHandler();
  if (!h) return;

  if (h.optionsMode === true && Array.isArray(h.options)) {
    const opts: number[] = h.options;
    let target = opts.indexOf(PARTY_SEND_OUT);
    if (target < 0) target = opts.indexOf(PARTY_APPLY);
    if (target < 0) {
      // No clean action (e.g. a TM's TEACH-only menu) → abandon this reward.
      skipNextReward = true;
      await press(Button.CANCEL, "party:abandon-options");
      return;
    }
    const oc = typeof h.optionsCursor === "number" ? h.optionsCursor : 0;
    if (oc < target) { await press(Button.DOWN, "party:opt-down"); return; }
    if (oc > target) { await press(Button.UP, "party:opt-up"); return; }
    await press(Button.ACTION, "party:select-option");
    return;
  }

  // Decided to abandon this reward target → exit the party (back to MODIFIER_SELECT).
  if (skipNextReward) {
    await press(Button.CANCEL, "party:exit-to-skip");
    return;
  }

  // Pick the HEALTHIEST member that can still battle (best switch-in; harmless for rewards).
  const party = s.playerParty;
  let target = -1;
  let bestHp = -1;
  party.forEach((p, i) => {
    if (!p.fainted) {
      const hp = p.hpRatio ?? 1;
      if (hp > bestHp) { bestHp = hp; target = i; }
    }
  });

  if (target < 0) {
    await press(Button.CANCEL, "party:none-usable");
    return;
  }

  const cur = s.cursor ?? 0;
  if (cur < target) { await press(Button.DOWN, "party:nav"); return; }
  if (cur > target) { await press(Button.UP, "party:nav"); return; }
  await press(Button.ACTION, "party:open-options");
}
