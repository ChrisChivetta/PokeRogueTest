// Battle policy (Phase 1) — minimal, safe, hands-off play.
//
// One decision per call, driven by the current UI mode + snapshot. Guiding rule from
// live runs: DON'T mash. Acting on every MESSAGE frame races the phase/animation system
// into a stuck state. So we only advance dialogue when the handler is genuinely waiting
// (awaitingActionInput), handle actionable modes explicitly, and otherwise wait.
//
//   • COMMAND            → choose FIGHT
//   • FIGHT              → best PP-aware, type-effective move
//   • TARGET_SELECT      → default target
//   • MODIFIER_SELECT    → take the highlighted reward (free items keep the run alive)
//   • PARTY              → bring in / apply to a usable mon (faint-switch + reward target)
//   • CONFIRM            → decline optional prompts (learn-move) to keep moveset stable
//   • MYSTERY_ENCOUNTER  → pick the run-safest curated option (heal > free reward > leave)
//   • OPTION_SELECT (ME) → accept a secondary sub-choice inside an encounter
//   • awaiting input     → advance dialogue
//   • everything else    → wait

import type { GameSnapshot } from "./state";
import { Button, getActiveHandler, getMysteryEncounter, inMysteryEncounter } from "./bridge";
import { press, moveCursor2x2 } from "./input";
import { shouldCatch, pickBall, noteCatchAttempt, resetCatch } from "./catch";
import { bestRewardIndex, type RewardOption } from "./rewards";
import { rankedMoves } from "./typechart";
import { retryGeneration } from "./retry";

const onField = (party: GameSnapshot["playerParty"]) => party.find((p) => p.onField) ?? party[0];

/** Perform at most one paced action appropriate to the current state. */
export async function step(s: GameSnapshot): Promise<void> {
  if (!s.ready) return;

  switch (s.uiMode) {
    case "COMMAND": {
      const cur = s.cursor ?? 0;
      // Catch a new species when we legally can (the unlock engine) — otherwise fight.
      if (shouldCatch(s)) {
        if (cur !== 1) await moveCursor2x2(cur, 1); // 1 = BALL (top-right)
        await press(Button.ACTION, "command:ball");
        return;
      }
      if (cur !== 0) await moveCursor2x2(cur, 0); // 0 = FIGHT
      await press(Button.ACTION, "command:fight");
      return;
    }

    case "BALL": {
      // Vertical list: ball tiers 0..4 then a trailing Cancel. Pick a tier, walk to it, throw.
      const tier = pickBall(s);
      if (tier == null) { await press(Button.CANCEL, "ball:none"); return; } // shouldn't happen
      const cur = s.cursor ?? 0;
      if (cur < tier) { await press(Button.DOWN, "ball:down"); return; }
      if (cur > tier) { await press(Button.UP, "ball:up"); return; }
      noteCatchAttempt();
      await press(Button.ACTION, `ball:throw${tier}`);
      return;
    }

    case "FIGHT": {
      const lead = onField(s.playerParty);
      // Pick the best move — but on a retry, vary it: the Nth-best move on the Nth retry, so we
      // don't replay the exact line that just lost. Out of PP on everything → first slot (Struggle).
      const ranked = rankedMoves(lead, onField(s.enemyParty));
      const gen = retryGeneration();
      const idx = ranked.length ? ranked[gen % ranked.length] : (lead?.moves[0]?.index ?? 0);
      const cur = s.cursor ?? 0;
      if (cur !== idx) await moveCursor2x2(cur, idx);
      await press(Button.ACTION, `fight:move${idx}`);
      return;
    }

    case "TARGET_SELECT":
      await press(Button.ACTION, "target");
      return;

    case "MODIFIER_SELECT":
      await handleReward(s);
      return;

    case "PARTY":
      await handleParty(s);
      return;

    case "MYSTERY_ENCOUNTER":
      await handleMysteryEncounter(s);
      return;

    case "OPTION_SELECT":
      // A secondary sub-choice spawned inside a mystery encounter (e.g. Field Trip's
      // move list). The encounters we opt into make every sub-choice safe, so accept the
      // highlighted one. Outside an encounter we never open option menus, so leave them be.
      if (inMysteryEncounter()) {
        await press(Button.ACTION, "me:suboption");
        return;
      }
      break;

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
const PARTY_SELECT = 13; // choose this mon for a mystery-encounter option (PartyUiMode.SELECT)

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
  resetCatch();
}

/** Distill the live ModifierSelect handler's offered reward row into scoreable options. */
function readRewardOptions(h: any): RewardOption[] {
  const opts: any[] = Array.isArray(h?.options) ? h.options : [];
  return opts.map((o) => {
    const type = o?.modifierTypeOption?.type;
    const localeKey: string = typeof type?.localeKey === "string" ? type.localeKey : "";
    return {
      id: typeof type?.id === "string" && type.id.length > 0 ? type.id : null,
      tier: typeof type?.tier === "number" ? type.tier : null,
      // Generated TMs carry no registry id; spot them by their move handle / locale key.
      isTm: typeof type?.moveId === "number" || localeKey.startsWith("tm_"),
    };
  });
}

/**
 * MODIFIER_SELECT — the post-wave reward screen. Pick the option most valuable to finishing
 * the run (see rewards.ts), navigating the handler's 2-D grid: rowCursor 1 is the free-reward
 * row, cursor is the column. We climb to that row, slide to the best column, then take it.
 *   • skipNextReward — a prior APPLY target menu was unusable (a TM): CANCEL → accept the skip.
 *   • everything offered is harmful (negative score) — skip the reward the same way.
 */
async function handleReward(s: GameSnapshot): Promise<void> {
  if (skipNextReward) {
    skipNextReward = false;
    acceptNextConfirm = true; // the skip confirmation should be accepted, not declined
    await press(Button.CANCEL, "reward:skip");
    return;
  }

  const h = getActiveHandler();
  const best = bestRewardIndex(readRewardOptions(h));

  // Row unreadable (still animating / shop-only) → just take whatever's highlighted.
  if (!best) {
    await press(Button.ACTION, "reward:take");
    return;
  }
  // Every option would hurt a generic carry → skip the whole reward (CANCEL → accept confirm).
  if (best.score < 0) {
    acceptNextConfirm = true;
    await press(Button.CANCEL, "reward:skip-bad");
    return;
  }

  // Navigate to the rewards row (1), then to the chosen column, then take it.
  const row = typeof h?.rowCursor === "number" ? h.rowCursor : 1;
  if (row !== 1) { await press(row < 1 ? Button.UP : Button.DOWN, "reward:to-rewards-row"); return; }
  const cur = s.cursor ?? 0;
  if (cur < best.index) { await press(Button.RIGHT, "reward:nav-right"); return; }
  if (cur > best.index) { await press(Button.LEFT, "reward:nav-left"); return; }
  await press(Button.ACTION, "reward:take-best");
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
    // Inside an encounter the per-mon menu offers SELECT (PartyUiMode.SELECT) instead —
    // that's the "choose this Pokémon" action the encounter is waiting on.
    if (target < 0 && inMysteryEncounter()) target = opts.indexOf(PARTY_SELECT);
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

// ── Mystery encounters ───────────────────────────────────────────────────────
// Detection is free: the bridge resolves the MYSTERY_ENCOUNTER UI mode and parks the
// encounter on currentBattle.mysteryEncounter. Resolution picks the option MOST FAVORABLE
// TO COMPLETING A RUN, curated from the game source. The unattended priorities are, in
// order: (1) a free FULL HEAL, (2) a free reward with no battle/secondary, (3) a safe
// LEAVE/REFUSE, (4) the easiest winnable BATTLE when there's no safe exit. We never pick
// an option that sacrifices, trades away, or transforms a party member (those can end a
// ribbon run), and we avoid gambles.
//
// MysteryEncounterOptionMode (src/enums/mystery-encounter-option-mode.ts): DEFAULT=0,
// DISABLED_OR_DEFAULT=1, DEFAULT_OR_SPECIAL=2, DISABLED_OR_SPECIAL=3. Modes 1 & 3 are
// UNSELECTABLE when their requirement isn't met — so each entry below is an ORDERED list
// of fallbacks and we take the first option that's actually selectable.
const ME_DISABLED_MODES = new Set([1, 3]); // DISABLED_OR_DEFAULT, DISABLED_OR_SPECIAL

// MysteryEncounterType (0-indexed, src/enums/mystery-encounter-type.ts) → preferred
// 0-indexed option(s). Comments name the chosen option and why it favors finishing a run.
const FAVORABLE_ME_OPTION: Record<number, number[]> = {
  0: [0], // MYSTERIOUS_CHALLENGERS — no exit; take the easiest (standard) battle
  1: [1], // MYSTERIOUS_CHEST — leave (the "open" gamble can KO a party member)
  2: [1], // DARK_DEAL — refuse (accepting removes a party member)
  3: [2], // FIGHT_OR_FLIGHT — leave (skip the tough optional battle)
  4: [1], // SLUMBERING_SNORLAX — wait → full party heal
  5: [3], // TRAINING_SESSION — leave
  6: [1, 0, 2, 3], // DEPARTMENT_STORE_SALE — free shop (vitamins first)
  7: [2], // SHADY_VITAMIN_DEALER — leave
  8: [0, 1, 2], // FIELD_TRIP — no exit, but zero-risk; resolved via the secondary select
  9: [1], // SAFARI_ZONE — leave
  10: [0, 1, 2], // LOST_AT_SEA — a Water/Flying mon escorts you out free (else wander)
  11: [2, 1, 0], // FIERY_FALLOUT — fire-resist mons end it free; else hunker; else battle
  12: [0, 1], // THE_STRONG_STUFF — approach (no battle)
  13: [1], // THE_POKEMON_SALESMAN — refuse (don't drain money)
  14: [1, 2], // AN_OFFER_YOU_CANT_REFUSE — extort (free) if able, else leave (never option 1: it costs your strongest mon)
  15: [0, 1, 2], // DELIBIRDY — give money for a gift held item (cheapest trade)
  16: [1, 0], // ABSOLUTE_AVARICE — reason with it (no battle)
  17: [1], // A_TRAINERS_TEST — refuse → full heal party + egg
  18: [1, 0], // TRASH_TO_TREASURE — dig for items (no battle)
  19: [2], // BERRIES_ABOUND — leave (skip the tough battle)
  20: [1], // CLOWNING_AROUND — remain unprovoked (no battle)
  21: [0, 1, 2], // PART_TIMER — make deliveries (earn money, no battle)
  22: [1, 0], // DANCING_LESSONS — learn the dance (no battle)
  23: [2], // WEIRD_DREAM — leave (option 1 permanently transforms your whole team; option 2 is a tough battle)
  24: [1], // THE_WINSTRATE_CHALLENGE — refuse → full heal party + rarer candy
  25: [2, 0, 1], // TELEPORTING_HIJINKS — inspect → a normal (winnable) battle
  26: [1, 0], // BUG_TYPE_SUPERFAN — show bug-types for a free gift if able, else battle
  27: [1], // FUN_AND_GAMES — leave
  28: [1, 2, 0], // UNCOMMON_BREED — befriend with food if able, else battle
  29: [3], // GLOBAL_TRADE_SYSTEM — leave (never trade away the starter being ribboned)
  30: [0], // THE_EXPERT_POKEMON_BREEDER — no exit; battle with the first option
};

/**
 * Resolve a mystery encounter. The ME option grid is the same 2×2 layout as COMMAND/FIGHT
 * (0=TL, 1=TR, 2=BL, 3=BR) plus a trailing "view party" button at index === option count,
 * which we never want. Navigation (UP/DOWN/LEFT/RIGHT) is NOT subject to the encounter's
 * ~1s input block — only ACTION is — so we walk the cursor to the chosen option with
 * RIGHT/DOWN one step per call, then press ACTION (which simply no-ops and is retried by
 * the next tick until the block lifts).
 */
async function handleMysteryEncounter(s: GameSnapshot): Promise<void> {
  const h = getActiveHandler();
  const opts: any[] = Array.isArray(h?.encounterOptions) ? h.encounterOptions : [];
  const n = opts.length;
  if (n === 0) return; // handler not populated yet — wait a tick

  const reqs: boolean[] = Array.isArray(h.optionsMeetsReqs) ? h.optionsMeetsReqs : [];
  const selectable = (i: number): boolean => {
    if (i < 0 || i >= n) return false;
    if (reqs[i]) return true; // requirement met → always selectable
    return !ME_DISABLED_MODES.has(opts[i]?.optionMode); // unmet req only blocks the DISABLED_* modes
  };

  const type = getMysteryEncounter()?.encounterType;
  const prefs = (typeof type === "number" && FAVORABLE_ME_OPTION[type]) || [];
  let target = prefs.find(selectable);
  if (target == null) for (let i = 0; i < n && target == null; i++) if (selectable(i)) target = i;
  if (target == null) target = 0; // nothing selectable (shouldn't happen) — fall back to first

  const cur = typeof h.getCursor === "function" ? h.getCursor() : (s.cursor ?? 0);
  // Defensive: if the cursor is parked on the trailing view-party button, step back into
  // the grid (DOWN lands on option 1) rather than pressing ACTION and opening the party.
  if (cur >= n) { await press(Button.DOWN, "me:leave-party-button"); return; }

  const col = (i: number) => i % 2;
  const row = (i: number) => (i < 2 ? 0 : 1);
  if (col(cur) < col(target)) { await press(Button.RIGHT, "me:nav-right"); return; }
  if (row(cur) < row(target)) { await press(Button.DOWN, "me:nav-down"); return; }
  await press(Button.ACTION, `me:option${target}`);
}
