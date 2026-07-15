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
import { Button, getActiveHandler, getMysteryEncounter, inMysteryEncounter, getLearnMoveCandidate, getCurrentPhaseName } from "./bridge";
import { press, moveCursor2x2 } from "./input";
import { evaluateLearnMove } from "./learnmove";
import { log } from "./log";
import { shouldCatch, shouldSoftenBeforeCatch, noteSoftenTurn, pickBall, noteCatchAttempt, resetCatch, pickReleaseSlot } from "./catch";
import { readPartyValue } from "./roster";
import { config } from "./config";
import { bestRewardIndex, type RewardOption } from "./rewards";
import { rankedMoves } from "./typechart";
import { retryGeneration } from "./retry";
import { applyKind, planShopBuy, type ApplyKind, type ShopHeal } from "./shop";

const onField = (party: GameSnapshot["playerParty"]) => party.find((p) => p.onField) ?? party[0];

/** Perform at most one paced action appropriate to the current state. */
export async function step(s: GameSnapshot): Promise<void> {
  if (!s.ready) return;

  // Clear any stale learn-move decision once we've left the phase, so the NEXT learn-move
  // interaction (different mon / different move) recomputes from scratch. Cheap: only probes
  // the phase name when we actually have leftover state to clear.
  if (learnDecision != null || learnDeclined || learnMoveSteps > 0) {
    if (getCurrentPhaseName() !== "LearnMovePhase") {
      learnDecision = null; learnDeclined = false; learnMoveSteps = 0; learnMoveCursor = null;
    }
  }

  // Clear the animation-scene stuck counter the moment we leave a scene mode. Without this, a SECOND
  // evolution (re-entering EVOLUTION_SCENE after we left to MESSAGE) would keep a stale high tick
  // count and could fire a spurious CANCEL on its very first frame, aborting the evolution.
  if (sceneStuckMode !== null && s.uiMode !== "EVOLUTION_SCENE" && s.uiMode !== "EGG_HATCH_SCENE") {
    sceneStuckMode = null; sceneStuckTicks = 0;
  }

  // The game has actually left PARTY (the async post-apply transition we were waiting out landed)
  // — safe to act on a fresh PARTY session again next time it opens.
  if (awaitingPartyExit && s.uiMode !== "PARTY") awaitingPartyExit = false;

  switch (s.uiMode) {
    case "COMMAND": {
      pendingApply = null; // a new turn began; any reward-apply is finished
      shopBuys = 0; // fresh shop budget next reward screen
      releasingForSwap = false; releaseSlot = -1;
      fightLastIdx = -1; fightRepeat = 0; // turn advanced → forget the previous move's reject streak
      // Wait for the handler to initialize (cursor becomes non-null).
      if (s.cursor == null) return;
      const cur = s.cursor;
      // Catch a new species when we legally can (the unlock engine) — otherwise fight. But first
      // SOFTEN a healthy catch target: a lower-HP wild catches far more reliably, so we attack it a
      // couple of times (FIGHT) before throwing. shouldSoftenBeforeCatch caps this so we never chip
      // it to a KO and waste the catch.
      if (shouldCatch(s)) {
        if (shouldSoftenBeforeCatch(s)) {
          noteSoftenTurn();
          if (cur !== 0) await moveCursor2x2(cur, 0); // 0 = FIGHT (soften the catch target)
          await press(Button.ACTION, "command:fight-soften");
          return;
        }
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
      // Wait for the handler to initialize (cursor becomes non-null).
      if (s.cursor == null) return;
      const lead = onField(s.playerParty);
      // Pick the best move — but on a retry, vary it: the Nth-best move on the Nth retry, so we
      // don't replay the exact line that just lost. Out of PP on everything → first slot (Struggle).
      const ranked = rankedMoves(lead, onField(s.enemyParty));
      const gen = retryGeneration();
      // Anti-wedge: if we've pressed the SAME index FIGHT_REJECT_LIMIT+ ticks running and the turn
      // hasn't advanced, that move is being REJECTED (disabled/0-PP that ranking missed). Step past
      // it in the ranked list by however many rejections we've racked up, wrapping around; the worst
      // case lands on slot 0 / Struggle, which is always selectable, so we can never stay pinned.
      const skip = fightRepeat >= FIGHT_REJECT_LIMIT ? fightRepeat - FIGHT_REJECT_LIMIT + 1 : 0;
      const idx = ranked.length ? ranked[(gen + skip) % ranked.length] : (lead?.moves[0]?.index ?? 0);
      // Track consecutive presses of the same index (reset when the chosen move changes).
      if (idx === fightLastIdx) fightRepeat++;
      else { fightLastIdx = idx; fightRepeat = 1; }
      const cur = s.cursor;
      if (cur !== idx) await moveCursor2x2(cur, idx);
      await press(Button.ACTION, `fight:move${idx}${skip ? `(skip${skip})` : ""}`);
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

    case "CONFIRM": {
      // A learn-move replacement prompt is also a CONFIRM, but we drive it with an actual
      // moveset decision (handleLearnMove), not the generic decline. Route it there first.
      if (getCurrentPhaseName() === "LearnMovePhase") { await handleLearnMove(s); return; }
      // Wait for the handler to initialize (cursor becomes non-null). awaitingActionInput
      // is coerced to a strict boolean upstream (state.ts), so cursor is the real signal.
      if (s.cursor == null) return;
      // The post-catch "party is full" prompt is a 4-option confirm [Summary, Pokédex, Yes, No];
      // handle it specially (Part B) before the generic accept/decline.
      const ch = getActiveHandler();
      if (Array.isArray(ch?.config?.options) && ch.config.options.length === 4) {
        await handleFullPartyConfirm(ch);
        return;
      }
      // Accept our own skip confirmation; decline everything else.
      if (acceptNextConfirm) {
        acceptNextConfirm = false;
        await press(Button.ACTION, "confirm:accept-skip");
        return;
      }
      await press(Button.CANCEL, "confirm:decline");
      return;
    }

    case "SUMMARY":
      // The learn-move flow opens SUMMARY (SummaryUiMode.LEARN_MOVE) to pick which of the
      // four moves to forget — drive that deliberately. Any OTHER summary is out-of-band, so
      // back out (keeps a stray summary screen from wedging the bot).
      if (getCurrentPhaseName() === "LearnMovePhase") { await handleLearnMove(s); return; }
      await press(Button.CANCEL, "summary:back");
      return;

    case "EVOLUTION_SCENE":
      // Passive animation scene (EvolutionPhase). Its handler (evolution-scene-ui-handler.ts:58-74)
      // accepts ACTION *only* at the trailing "…evolved!" prompt (awaitingActionInput && onActionInput);
      // during the animation only CANCEL is accepted. The old code mashed ACTION every tick, which
      // no-ops mid-animation and can race/consume the one-shot completion prompt → the wave-9 wedge
      // (1494/1510 wave-9 frames were ACTION-mash). DON'T mash: advance only when awaiting, else wait,
      // and escalate to a single CANCEL (which the animation sub-state honours) on a genuine hang.
      await advanceAnimationScene("EVOLUTION_SCENE", s.awaitingActionInput, "evolution");
      return;

    case "EGG_HATCH_SCENE":
      // Sibling animation scene (EggHatchPhase). egg-hatch trySkip() accepts ACTION *or* CANCEL but
      // briefly disables skip mid-hatch; same anti-mash + CANCEL-escalation handling keeps it moving
      // without racing the skip window.
      await advanceAnimationScene("EGG_HATCH_SCENE", s.awaitingActionInput, "egg-hatch");
      return;

    case "EGG_HATCH_SUMMARY":
      // The post-hatch summary (EggSummaryUiHandler) only exits on CANCEL, and it guards against
      // an early exit with a 1–2s blockExit window (an early CANCEL just no-ops), so it is safe
      // to press every step until it accepts and ends the phase.
      await press(Button.CANCEL, "egg-summary:exit");
      return;
  }

  // Learn-move dialogue also surfaces as plain MESSAGE before the CONFIRM — advance it.
  if (getCurrentPhaseName() === "LearnMovePhase") { await handleLearnMove(s); return; }

  // Dialogue / message prompts: advance only when the handler is genuinely waiting.
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
const PARTY_REVIVE = 2; // apply a Revive to this (fainted) mon — distinct from APPLY
const PARTY_APPLY = 3; // apply a heal/held item to this mon
const PARTY_RELEASE = 11; // release this mon (Part B: free a slot for a full-party catch)
const PARTY_SELECT = 13; // choose this mon for a mystery-encounter option (PartyUiMode.SELECT)

// Set when a reward's target menu offers neither SEND_OUT nor APPLY (a TM / move-
// replacement we won't handle in Phase 1). We then back out of the party and skip the
// reward at MODIFIER_SELECT rather than oscillating forever in the option menu.
let skipNextReward = false;
// Set when CANCEL on MODIFIER_SELECT opens a "skip this reward?" confirm — that one CONFIRM
// should be accepted (ACTION), unlike learn-move confirms which we decline.
let acceptNextConfirm = false;
// What we're currently applying via the PARTY screen, set when we take/buy a heal or revive, so
// handleParty picks a VALID target: a Revive can ONLY target a fainted mon (selecting a live one
// loops); a heal should go to the most-hurt mon, not the healthiest (which wastes it).
let pendingApply: ApplyKind = null;
// Heals bought from the shop this reward screen — bounds the buy loop if an apply ever no-ops.
let shopBuys = 0;
const MAX_SHOP_BUYS = 8;
// Part B: we chose to keep a full-party catch and are releasing a passenger; releaseSlot is which.
let releasingForSwap = false;
let releaseSlot = -1;
// Set right after pressing ACTION to confirm a per-mon option (SEND_OUT/APPLY/REVIVE/RELEASE):
// the terminal action for this PARTY session is done, and we're waiting for the game's async
// transition out of PARTY to actually land. Blocks handleParty from re-deriving a target and
// pressing again in the meantime (see the awaitingPartyExit check above).
let awaitingPartyExit = false;
// FORCED-SWITCH slot exclusion. The game only offers SEND_OUT for party slots that are NOT
// already on the field (updateOptions: `cursor >= getBattlerCount()`). If we open the per-mon
// menu on a slot the game won't let us send out, SEND_OUT is absent and the old code set
// skipNextReward + CANCELled — but the SwitchPhase guard clears skipNextReward every tick, so we
// just re-opened the menu forever (the "2:PARTY:SwitchPhase" open/abandon oscillation). Instead we
// remember that slot here, back out, and pickPartyTarget skips it so we try the NEXT eligible mon.
let switchAvoidSlots = new Set<number>();
// APPLY-target slot exclusion (heal/revive). If we open a slot's per-mon menu for a bought/free
// heal or revive and it offers NO usable APPLY/REVIVE action (e.g. a heal landed on a fainted mon,
// or a revive on a slot the game won't revive), the OLD code abandoned the whole item (skipNext
// reward + CANCEL) — wasting it. Instead we blacklist that slot here, back out, and pickPartyTarget
// re-routes to the NEXT valid mon (next-most-hurt for heal, next fainted for revive). Only when
// EVERY candidate is exhausted do we abandon. Reset per reward screen (cleared on a clean apply).
let applyAvoidSlots = new Set<number>();
// Bound the apply-retarget so a heal/revive that the game won't let us place ANYWHERE (or a misread
// where pickPartyTarget keeps re-selecting the same illegal slot) can never loop forever. Each
// apply-slot-illegal back-out increments this; past the cap we abandon the item (skipNextReward +
// CANCEL) rather than re-open the same slot endlessly — the apply analogue of fightRepeat. Reset on
// a clean apply or when leaving the reward screen.
let applyIllegalCount = 0;
const APPLY_ILLEGAL_LIMIT = 3; // after this many illegal back-outs, give the item up (anti-wedge)

// ── FIGHT-menu anti-wedge ────────────────────────────────────────────────────
// We pick the best-ranked move and press ACTION. If that move is actually UN-selectable right now
// (disabled by the foe, out of PP, Taunt/Torment, a charge move mid-charge), the game REJECTS the
// press: it pops a brief "can't use that" MESSAGE and bounces straight back to the FIGHT menu on
// the SAME CommandPhase — so we re-pick the SAME index and loop forever (the FIGHT↔MESSAGE wedge
// seen in soak telemetry). rankedMoves() tries to drop un-pickable moves via isUsable(), but that
// read DEFAULTS TO USABLE on any failure/version-drift, so a genuinely-disabled move can survive
// ranking and pin us. Guard: count how many ticks we've pressed the SAME move without the
// CommandPhase advancing; after a couple of rejections, SKIP that index and try the next-ranked
// move (ultimately slot 0 / Struggle), so a mis-classified move can never trap the bot.
let fightLastIdx = -1; // the move index we pressed on the previous FIGHT tick
let fightRepeat = 0; // consecutive FIGHT ticks pressing that same index (turn not advancing)
const FIGHT_REJECT_LIMIT = 2; // after this many same-index presses, rotate off it as un-selectable

// ── Animation-scene anti-wedge ───────────────────────────────────────────────
// EVOLUTION_SCENE / EGG_HATCH_SCENE are passive animation phases. Their UI handlers accept
// ACTION *only* at the trailing "…evolved/hatched!" prompt (awaitingActionInput); during the
// multi-second animation ACTION is a no-op and mashing it can race/consume the one-shot
// completion prompt (onActionInput) and WEDGE the scene forever — exactly the wave-9
// EVOLUTION_SCENE stall seen in soak telemetry (1494/1510 wave-9 frames were ACTION-mash).
// So we DON'T mash: advance only when the handler is genuinely waiting. As a last-resort
// escape hatch, if we sit in the scene for STUCK_TICKS_ESCALATE consecutive ticks without
// ever seeing awaitingActionInput, we press CANCEL once — CANCEL is accepted in the animation
// sub-state (evolution-scene-ui-handler line 59: cancels the evolution → EndEvolutionPhase →
// MESSAGE; egg-hatch trySkip also accepts CANCEL), trading one skipped evolution for a live run.
let sceneStuckMode: string | null = null; // which scene mode we're counting stuck ticks for
let sceneStuckTicks = 0;
const STUCK_TICKS_ESCALATE = 6; // ~4s at the 700ms tick — well past a normal animation+prompt

// ── Learn-move state ─────────────────────────────────────────────────────────
// The learn-move flow spans MESSAGE → CONFIRM → SUMMARY. We compute the decision once
// (at the CONFIRM/SUMMARY point, when the candidate + moveset are readable) and remember
// it: whether to learn and which slot (0-3) to forget. learnMoveSteps bounds the whole
// interaction so a misread can never loop forever — past the cap we cleanly decline.
let learnDecision: { learn: boolean; replaceIndex: number } | null = null;
let learnMoveSteps = 0;
// True after we've declined the replacement: the next CONFIRM is the "stop teaching?" prompt,
// which we ACCEPT (yes, stop) so the decline terminates instead of looping back to the question.
let learnDeclined = false;
const MAX_LEARN_MOVE_STEPS = 24;
// The SUMMARY (SummaryUiMode.LEARN_MOVE) move-row selector is the handler's `moveCursor`
// (0-3 = forget that slot, 4 = don't learn). The bridge only exposes `cursor` = the summary
// PAGE (Page.MOVES === 2), NOT `moveCursor`, so we CANNOT read the live row — reading
// s.cursor there gives a constant 2 and any "walk to target" loop spins forever (the old
// "DOWN (learn:slot-down)" wedge). Instead we TRACK moveCursor locally: it starts at 4 on
// entry (showMoveSelect → setCursor(4)) and the game wraps DOWN as c<4?c+1:0, UP as c?c-1:4.
// We mirror that math so our counter stays in lockstep, then ACTION when we reach the target.
let learnMoveCursor: number | null = null;

/**
 * Which party slot to act on, given the intent. PURE so it's unit-testable. A revive targets the
 * first FAINTED mon; a heal the MOST-HURT live mon (skipping full-HP mons — the game's own
 * selectFilter rejects a heal item on a full-HP, non-statused mon as "no effect" and refuses the
 * target, which otherwise wedges PARTY open: the per-mon menu closes with no transition and our
 * caller never sees anywhere else to go); a switch the HEALTHIEST live mon. Returns -1 if there's
 * no valid target (e.g. a revive with nobody fainted, or a heal with nobody actually hurt).
 */
export function pickPartyTarget(
  party: GameSnapshot["playerParty"],
  intent: "revive" | "heal" | "switch",
  avoid?: Set<number>,
): number {
  const skip = (i: number) => (avoid?.has(i) ?? false);
  if (intent === "revive") return party.findIndex((p, i) => p.fainted && !skip(i));
  let target = -1;
  if (intent === "heal") {
    let worst = Infinity;
    party.forEach((p, i) => {
      if (p.fainted || skip(i)) return;
      const hp = p.hpRatio ?? 1;
      if (hp >= 1) return; // full HP — the game refuses a heal item here (no status-heal modeling)
      if (hp < worst) { worst = hp; target = i; }
    });
  } else {
    // switch: prefer the healthiest live mon the game will actually let us send out (avoid set
    // holds slots where SEND_OUT wasn't offered — typically the on-field mon at index < battlerCount).
    let best = -1;
    party.forEach((p, i) => { if (!p.fainted && !skip(i)) { const hp = p.hpRatio ?? 1; if (hp > best) { best = hp; target = i; } } });
  }
  return target;
}

/**
 * Decide how to handle a passive animation scene (EVOLUTION_SCENE / EGG_HATCH_SCENE) this tick.
 * PURE so it's unit-testable. Returns the action plus the next stuck-tick count.
 *
 *  • awaiting === true  → the trailing "…evolved/hatched!" prompt is up: "advance" (ACTION).
 *  • else, stuck < cap  → animation still playing: "wait" (do nothing — DON'T mash).
 *  • else (stuck ≥ cap) → genuine wedge: "cancel" once (CANCEL escapes the animation sub-state),
 *                          then reset the counter so we don't spam CANCEL.
 *
 * `stuckTicks` is how many consecutive prior ticks we've been in this scene WITHOUT awaiting input.
 */
export function decideScenePress(
  awaiting: boolean,
  stuckTicks: number,
  cap = STUCK_TICKS_ESCALATE,
): { act: "advance" | "wait" | "cancel"; nextStuck: number } {
  if (awaiting) return { act: "advance", nextStuck: 0 };
  if (stuckTicks + 1 >= cap) return { act: "cancel", nextStuck: 0 };
  return { act: "wait", nextStuck: stuckTicks + 1 };
}

/**
 * Drive a passive animation scene without mashing. Tracks consecutive stuck ticks per mode and
 * escalates to CANCEL only on a genuine wedge. `why` tags the press for telemetry.
 */
async function advanceAnimationScene(mode: string, awaiting: boolean, tag: string): Promise<void> {
  if (sceneStuckMode !== mode) { sceneStuckMode = mode; sceneStuckTicks = 0; }
  const { act, nextStuck } = decideScenePress(awaiting, sceneStuckTicks);
  sceneStuckTicks = nextStuck;
  if (act === "advance") { await press(Button.ACTION, `${tag}:advance`); return; }
  if (act === "cancel") { await press(Button.CANCEL, `${tag}:unwedge`); return; }
  // act === "wait": let the animation settle; the watchdog escalation handles a true hang.
}

/** Reset internal policy state (test seam). */
export function resetPolicy(): void {
  skipNextReward = false;
  acceptNextConfirm = false;
  pendingApply = null;
  shopBuys = 0;
  releasingForSwap = false;
  releaseSlot = -1;
  awaitingPartyExit = false;
  switchAvoidSlots = new Set<number>();
  applyAvoidSlots = new Set<number>();
  applyIllegalCount = 0;
  fightLastIdx = -1;
  fightRepeat = 0;
  learnDecision = null;
  learnMoveSteps = 0;
  learnDeclined = false;
  learnMoveCursor = null;
  sceneStuckMode = null;
  sceneStuckTicks = 0;
  resetCatch();
}

/** Distill the live ModifierSelect SHOP rows into buyable heals (with their grid positions). */
function readShopHeals(h: any): ShopHeal[] {
  const rows: any[] = Array.isArray(h?.shopOptionsRows) ? h.shopOptionsRows : [];
  const out: ShopHeal[] = [];
  rows.forEach((row: any, ri: number) => {
    if (!Array.isArray(row)) return;
    row.forEach((opt: any, ci: number) => {
      const mto = opt?.modifierTypeOption;
      const id = typeof mto?.type?.id === "string" ? mto.type.id : null;
      const kind = applyKind(id);
      const cost = Number(mto?.cost);
      if (!kind || !Number.isFinite(cost) || cost <= 0) return;
      // shopOptionsRows is bottom-anchored: rowCursor = options(2..len+1) = at(-(rowCursor-1)).
      // id is carried so planShopBuy can rank by heal POTENCY when a mon is critically hurt.
      out.push({ kind, id, cost, rowCursor: rows.length - ri + 1, cursorIndex: ci });
    });
  });
  return out;
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

  // Spend money on heals FIRST (survive deeper): revive fainted mons, then top up hurt ones.
  // Buying a heal opens the PARTY target screen, handled like a free-reward apply (pendingApply).
  // PRE-RIVAL: the next fight is a deterministic, unforgiving scripted rival (waves 8/25/55/95/
  // 145/195) — enter at FULL strength. We force a full revive+heal-to-100% (preRival mode) and
  // lift the normal per-screen buy cap so banking money on heals isn't truncated mid-prep.
  // CRITICAL: the shop screen shows BEFORE the wave counter advances, so the upcoming rival is
  // isPreRivalWave (waveIndex+1 ∈ RIVAL_WAVES), NOT isRivalWave. Gate on either so prep fires on
  // the reward screen right before the rival AND if we ever sample mid-rival with a shop open.
  const preRival = (s.battle?.isPreRivalWave ?? false) || (s.battle?.isRivalWave ?? false);
  if (preRival || shopBuys < MAX_SHOP_BUYS) {
    const buy = planShopBuy(s.playerParty, s.money ?? 0, readShopHeals(h), preRival);
    if (buy) {
      const row = typeof h?.rowCursor === "number" ? h.rowCursor : 1;
      if (row !== buy.rowCursor) { await press(row < buy.rowCursor ? Button.UP : Button.DOWN, "shop:to-row"); return; }
      const cur = s.cursor ?? 0;
      if (cur < buy.cursorIndex) { await press(Button.RIGHT, "shop:nav-right"); return; }
      if (cur > buy.cursorIndex) { await press(Button.LEFT, "shop:nav-left"); return; }
      shopBuys++;
      pendingApply = buy.kind; // the bought heal opens PARTY → target it (revive→fainted, heal→hurt)
      await press(Button.ACTION, `shop:buy-${buy.kind}`);
      return;
    }
  }

  const opts = readRewardOptions(h);
  const best = bestRewardIndex(opts);

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
  // Remember if this reward needs a PARTY target so handleParty aims it correctly.
  pendingApply = applyKind(opts[best.index]?.id);
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

  // FORCED SWITCH: when a mon faints, SwitchPhase opens the party screen and REQUIRES a
  // replacement — it cannot be cancelled. Stale reward-flow flags (skipNextReward / pendingApply /
  // releasingForSwap) from an earlier reward must not leak in here, or we'd spam an ineffective
  // CANCEL and wedge (the "2:PARTY:SwitchPhase" loop). Clear them so we fall through to picking the
  // healthiest live mon below. A faint-switch is a plain switch: pendingApply stays null.
  if (getCurrentPhaseName() === "SwitchPhase") {
    skipNextReward = false;
    pendingApply = null;
    releasingForSwap = false;
    releaseSlot = -1;
    awaitingPartyExit = false;
  }

  if (h.optionsMode === true && Array.isArray(h.options)) {
    const opts: number[] = h.options;
    // Choose the per-mon action: revive → REVIVE; heal → APPLY; releasing a passenger → RELEASE;
    // otherwise (a switch) → SEND_OUT. Fall back across the others if the first isn't offered.
    const prefer = releasingForSwap ? [PARTY_RELEASE]
      : pendingApply === "revive" ? [PARTY_REVIVE, PARTY_APPLY]
      : pendingApply === "heal" ? [PARTY_APPLY]
      : [PARTY_SEND_OUT, PARTY_APPLY];
    let target = -1;
    for (const o of prefer) { const i = opts.indexOf(o); if (i >= 0) { target = i; break; } }
    // Inside an encounter the per-mon menu offers SELECT (PartyUiMode.SELECT) instead —
    // that's the "choose this Pokémon" action the encounter is waiting on.
    if (target < 0 && inMysteryEncounter()) target = opts.indexOf(PARTY_SELECT);
    if (target < 0) {
      // The open slot's menu offers no usable action. TWO very different situations land here:
      //
      //   (a) FORCED SWITCH on a slot the game won't send out. The game only offers SEND_OUT for
      //       party slots NOT already on the field (updateOptions: cursor >= battlerCount), so the
      //       on-field mon's menu lacks it. We must blacklist this slot and back out so
      //       pickPartyTarget advances to the NEXT eligible (bench) mon — NOT abandon (a forced
      //       switch can't be skipped; the SwitchPhase guard clears skipNextReward every tick, so
      //       abandoning just re-opens the SAME slot forever → the "2:PARTY:SwitchPhase" wedge).
      //
      //   (b) A REWARD target that's simply unusable (e.g. a TM's TEACH-only menu) → abandon it.
      //
      // Detecting a forced switch via getCurrentPhaseName()==="SwitchPhase" alone proved unreliable
      // in the live wedge (it didn't read "SwitchPhase" at this point, so we fell through to abandon
      // and oscillated). Treat it as a forced switch if EITHER the phase reads SwitchPhase OR we're
      // in a plain switch with a fainted mon forcing it (no reward apply/release context, and the
      // party has a downed body — the only reason PARTY force-opens like this). A genuine TM reward
      // sets neither: it has no fainted-forced context distinct from a real switch, so we lean on
      // the fainted-mon signal to disambiguate.
      const forcedSwitch =
        getCurrentPhaseName() === "SwitchPhase" ||
        (pendingApply === null && !releasingForSwap && s.playerParty.some((pp) => pp.fainted));
      if (forcedSwitch) {
        if (typeof s.cursor === "number" && s.cursor >= 0) switchAvoidSlots.add(s.cursor);
        await press(Button.CANCEL, "party:switch-slot-illegal");
        return;
      }
      // APPLY (heal/revive) landed on a slot whose menu offers no APPLY/REVIVE — e.g. a potion on a
      // fainted mon, or a revive the game won't apply here. DON'T abandon the item: blacklist this
      // slot, back out, and let pickPartyTarget re-route to the NEXT valid mon (next-most-hurt for a
      // heal, next fainted for a revive). Only once every candidate is exhausted (handled below at
      // the target<0 check, which still sets skipNextReward) do we give the item up.
      if (pendingApply === "heal" || pendingApply === "revive") {
        if (typeof s.cursor === "number" && s.cursor >= 0) applyAvoidSlots.add(s.cursor);
        applyIllegalCount += 1;
        // Anti-wedge bound: if back-out + re-pick keeps landing on an un-appliable slot (the game
        // offers APPLY nowhere, or a misread re-selects the same slot), don't loop forever — give the
        // item up after a few tries (matches the fightRepeat / learnMoveSteps caps elsewhere).
        if (applyIllegalCount > APPLY_ILLEGAL_LIMIT) {
          skipNextReward = true;
          await press(Button.CANCEL, "party:apply-give-up");
          return;
        }
        await press(Button.CANCEL, "party:apply-slot-illegal");
        return;
      }
      // No clean action for a reward (e.g. a TM's TEACH-only menu) → abandon this reward.
      skipNextReward = true;
      await press(Button.CANCEL, "party:abandon-options");
      return;
    }
    const oc = typeof h.optionsCursor === "number" ? h.optionsCursor : 0;
    if (oc < target) { await press(Button.DOWN, "party:opt-down"); return; }
    if (oc > target) { await press(Button.UP, "party:opt-up"); return; }
    // A clean action landed — the forced-switch / apply blacklists have served their purpose; clear
    // them so a later switch/apply this run starts fresh (slot identities can shift after a swap).
    if (switchAvoidSlots.size > 0) switchAvoidSlots = new Set<number>();
    if (applyAvoidSlots.size > 0) applyAvoidSlots = new Set<number>();
    applyIllegalCount = 0;
    // The target intent (switch/heal/revive/release/select) is now fulfilled — clear it so the
    // NEXT time PARTY opens (a later reward, a later forced switch) starts from a clean intent.
    // Leaving pendingApply/releasingForSwap set here was a real wedge: once optionsMode closes,
    // handleParty falls through to the "no option menu yet" branch, re-derives `intent` from the
    // stale flag, and — if the stale intent still resolves to the SAME already-acted-on slot —
    // re-opens the identical options menu forever (never observed as a "stall" because the mode
    // and cursor keep oscillating true/false, so the stall-detector's unchanged-key check never
    // fires). Confirmed live: a Leftovers reward (pendingApply stays null → falls back to the
    // "switch" intent) looped PARTY open/close indefinitely and the item was never held.
    pendingApply = null;
    releasingForSwap = false;
    releaseSlot = -1;
    awaitingPartyExit = true;
    await press(Button.ACTION, "party:select-option");
    return;
  }

  // Decided to abandon this reward target → exit the party (back to MODIFIER_SELECT).
  if (skipNextReward) {
    await press(Button.CANCEL, "party:exit-to-skip");
    return;
  }

  // Wait for the handler to initialize (cursor becomes non-null).
  if (s.cursor == null) return;

  // We already fired the terminal ACTION for an apply/release/switch THIS PARTY session and are
  // waiting for the game to leave PARTY (e.g. applyModifier()'s setMode(MODIFIER_SELECT).then(...)
  // hasn't resolved yet). Do nothing and let the next tick re-check — don't re-derive a target and
  // press again: on a single-live-mon party that re-picks the SAME slot we just acted on, reopening
  // its options menu (showOptions() resets optionsCursor to 0) and wedging PARTY open indefinitely.
  // Confirmed live: a Leftovers reward looped open/close forever and the item was never held.
  if (awaitingPartyExit) return;

  // Pick the target: releasing a passenger (Part B) → that exact slot; revive → a FAINTED mon;
  // heal → the MOST-HURT live mon; otherwise (a switch) → the HEALTHIEST live mon. The avoid set
  // skips slots already rejected this screen: switch → no SEND_OUT (the on-field mon); apply →
  // no usable APPLY/REVIVE (e.g. a potion that couldn't target a fainted mon — we re-route, not skip).
  const intent = pendingApply ?? "switch";
  const avoid = intent === "switch" ? switchAvoidSlots : applyAvoidSlots;
  let target = releasingForSwap
    ? releaseSlot
    : pickPartyTarget(s.playerParty, intent, avoid);

  // Forced switch with every live slot blacklisted means our blacklist over-excluded (a misread).
  // The game guarantees a sendable mon exists, so clear it and retry rather than wedge on CANCEL.
  if (target < 0 && intent === "switch" && switchAvoidSlots.size > 0) {
    switchAvoidSlots = new Set<number>();
    target = pickPartyTarget(s.playerParty, "switch");
  }

  if (target < 0) {
    // No valid target LEFT to apply to — every eligible mon was tried and rejected (or none qualified,
    // e.g. a revive with nobody fainted, a heal with nobody hurt). NOW abandon the item and back out.
    if (pendingApply) skipNextReward = true;
    await press(Button.CANCEL, "party:none-usable");
    return;
  }

  const cur = s.cursor;
  if (cur < target) { await press(Button.DOWN, "party:nav"); return; }
  if (cur > target) { await press(Button.UP, "party:nav"); return; }
  await press(Button.ACTION, "party:open-options");
}

/**
 * The "party is full" confirm after a catch — a 4-option vertical menu [0 Summary, 1 Pokédex,
 * 2 Yes(release-to-swap), 3 No(box it)]. Part B: if there's a passenger worth giving up
 * (pickReleaseSlot), pick Yes and remember the slot for the RELEASE screen; otherwise box it.
 */
async function handleFullPartyConfirm(h: any): Promise<void> {
  const slot = config.swapWhenPartyFull ? pickReleaseSlot(readPartyValue()) : -1;
  const target = slot >= 0 ? 2 : 3; // 2 = Yes (swap), 3 = No (box)
  if (slot >= 0) { releasingForSwap = true; releaseSlot = slot; }
  const cur = typeof h?.cursor === "number" ? h.cursor : 0;
  if (cur < target) { await press(Button.DOWN, "fullparty:down"); return; }
  if (cur > target) { await press(Button.UP, "fullparty:up"); return; }
  await press(Button.ACTION, slot >= 0 ? "fullparty:swap" : "fullparty:box");
}

/**
 * Drive the whole LearnMovePhase coherently across its three UI modes, using a real moveset
 * decision instead of blind always-accept/always-decline (which fought itself and looped).
 *
 * Flow (PokéRogue source): MESSAGE "Should a move be forgotten…?" → CONFIRM (yes→SUMMARY move
 * pick / no→stop-teaching CONFIRM) → SUMMARY (SummaryUiMode.LEARN_MOVE, moveCursor 0-3 = forget
 * that slot, 4 = don't learn) → MESSAGE.
 *
 * We compute the decision ONCE (cached in learnDecision) the first time we can read the
 * candidate + moveset, then:
 *   • MESSAGE  → ACTION to advance dialogue toward the CONFIRM.
 *   • CONFIRM  → learn? ACTION (yes) : CANCEL (no). After a decline, the next CONFIRM is the
 *                "stop teaching?" prompt — ACCEPT it (ACTION) so the decline actually ends.
 *   • SUMMARY  → walk moveCursor to replaceIndex (0-3) and ACTION; on a decline that reached
 *                SUMMARY, go to 4 (don't-learn) and ACTION.
 * A hard step cap defaults to a clean decline if anything is unreadable, so we can't wedge.
 */
async function handleLearnMove(s: GameSnapshot): Promise<void> {
  // Compute (and cache) the decision as soon as the candidate is readable.
  if (learnDecision == null) {
    const info = getLearnMoveCandidate();
    if (info) {
      const d = evaluateLearnMove(info.candidate, info.currentMoves, info.userTypes);
      learnDecision = { learn: d.learn, replaceIndex: d.replaceIndex };
      log.info(`[learn-move] ${d.reason} → ${d.learn ? `replace slot ${d.replaceIndex}` : "decline"}`);
    }
  }
  // Safety: bound the interaction. If we somehow can't progress, decline cleanly.
  if (++learnMoveSteps > MAX_LEARN_MOVE_STEPS) {
    learnDecision = { learn: false, replaceIndex: -1 };
  }
  // Default to a safe decline until we can read a decision (never accept on a blind guess).
  const decision = learnDecision ?? { learn: false, replaceIndex: -1 };

  // We are NOT on the SUMMARY move-picker. Drop any tracked moveCursor so the NEXT time we enter
  // SUMMARY we re-seed at 4 (the game's showMoveSelect always resets the highlight to 4 on entry).
  // Without this, a stale counter from an earlier learn-move interaction this run would be out of
  // sync with the on-screen cursor and our shortest-wrap stepping could never land on the target —
  // re-wedging on DOWN/UP spam (the "SUMMARY:LearnMovePhase" stall). The cap still backstops it,
  // but keeping the counter honest avoids 24 wasted ticks every time.
  if (s.uiMode !== "SUMMARY") learnMoveCursor = null;

  switch (s.uiMode) {
    case "CONFIRM": {
      if (s.cursor == null && !learnDeclined) return; // wait for the confirm to initialize
      if (learnDeclined) {
        // The "stop teaching this move?" follow-up to our decline — say yes (ACTION) to end it.
        await press(Button.ACTION, "learn:stop-teaching");
        return;
      }
      if (decision.learn && decision.replaceIndex >= 0) {
        await press(Button.ACTION, "learn:replace-yes"); // → SUMMARY move-pick
      } else {
        learnDeclined = true;
        await press(Button.CANCEL, "learn:replace-no"); // → stop-teaching confirm
      }
      return;
    }

    case "SUMMARY": {
      // SummaryUiMode.LEARN_MOVE: moveCursor 0-3 picks the slot to forget; 4 = don't learn.
      // The bridge's s.cursor is the summary PAGE (always 2 = Page.MOVES here), NOT the move
      // row — so we track the real moveCursor ourselves. It starts at 4 on entry; the game
      // wraps DOWN as c<4?c+1:0 and UP as c?c-1:4. We mirror that exactly so our counter
      // stays in lockstep with the on-screen highlight, then ACTION once we land on target.
      const target = decision.learn && decision.replaceIndex >= 0 ? decision.replaceIndex : 4;
      if (learnMoveCursor == null) learnMoveCursor = 4; // showMoveSelect() → setCursor(4)
      if (learnMoveCursor === target) {
        learnMoveCursor = null; // selection consumed; reset for any future SUMMARY
        await press(Button.ACTION, target === 4 ? "learn:slot-skip" : `learn:forget-slot${target}`);
        return;
      }
      // Step one row toward the target along the shorter wrap direction, mirroring the game.
      const downSteps = (target - learnMoveCursor + 5) % 5; // forward distance (DOWN wraps 4→0)
      if (downSteps <= 5 - downSteps) {
        learnMoveCursor = learnMoveCursor < 4 ? learnMoveCursor + 1 : 0;
        await press(Button.DOWN, "learn:slot-down");
      } else {
        learnMoveCursor = learnMoveCursor ? learnMoveCursor - 1 : 4;
        await press(Button.UP, "learn:slot-up");
      }
      return;
    }

    default:
      // MESSAGE / transitions — advance the dialogue toward the decision point.
      await press(Button.ACTION, "learn:advance");
      return;
  }
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
