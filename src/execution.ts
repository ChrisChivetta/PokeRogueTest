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
import { config } from "./config";
import { readRoster, readCandyStarters } from "./roster";
import { selectTeam } from "./team";
import { planCandy } from "./candy";
import { execState, resetExecState } from "./exec-state";
import { log } from "./log";

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

// ── Starter select: enact the team plan ──────────────────────────────────────
// The StarterSelectPhase spans several UI sub-modes (the grid, the per-mon add-to-party
// OPTION_SELECT, the start CONFIRM, the SAVE_SLOT). We route ALL of them here (by phase name) and
// drive: scan the 9-col grid to each planned species (reading filteredStarterContainers[cursor]),
// add it, then SUBMIT to start. The grid is a flat list: DOWN/UP = ±9, LEFT/RIGHT = ±1.
//
// Two PHASES per visit: (1) spend candy to shave starter costs (planCandy) via each mon's
// "Use Candies" → "Reduce Cost" sub-menus — done first so the cheaper carry frees budget; then
// (2) build the team (computed AFTER reductions) and start.

// Starter-select phase state lives on the host seam (src/exec-state.ts) so it SURVIVES a strategy
// hot-swap — an in-progress starter-select resumes in place rather than re-planning from scratch.
//
// Bounds the candy phase so a mis-navigation can't loop forever before we move on to the team.
const MAX_CANDY_ATTEMPTS = 40;

// After SUBMIT, tryStart shows a "confirm start team?" message via the message handler WITHOUT
// changing getMode() (the starter handler isn't a MessageUiHandler) — so the screen still reads
// STARTER_SELECT for ~1s while the text types and its callback opens the CONFIRM. We must NOT
// re-SUBMIT during that window or we restart the message and the CONFIRM never appears.
const SUBMIT_COOLDOWN_MS = 3000;

/** Drop the cached plan + phase state (call when leaving starter select / between runs). */
export function resetStarterSelect(): void {
  resetExecState();
}

/** The planned team's species ids, computed once per starter-select visit from the live roster. */
function teamPlan(): number[] {
  if (!execState.planIds) {
    const plan = selectTeam(readRoster());
    execState.planIds = plan.team.map((s) => s.speciesId);
    log.info(`[starter] plan: [${execState.planIds.join(", ")}] (carry #${plan.carry?.speciesId ?? "?"})`);
  }
  return execState.planIds;
}

export async function driveStarterSelect(s: GameSnapshot): Promise<void> {
  const h = getActiveHandler();
  if (!h) return;

  // Sub-screens that pop over the grid while starting.
  if (s.uiMode === "CONFIRM") { await press(Button.ACTION, "starter:confirm-start"); return; }
  if (s.uiMode === "SAVE_SLOT") { await press(Button.ACTION, "starter:save-slot"); return; }
  if (s.uiMode === "OPTION_SELECT") {
    const labels: string[] = Array.isArray(h.config?.options)
      ? h.config.options.map((o: any) => (typeof o?.label === "string" ? o.label.toLowerCase() : ""))
      : [];
    const find = (needle: string) => labels.findIndex((l) => l.includes(needle));

    if (!execState.candyDone) {
      // Candy sub-flow: in the per-mon menu pick "Use Candies"; in the candy menu pick "Reduce
      // Cost". If the candy menu has no reduction left (maxed/unaffordable), back out to re-plan.
      const reduce = find("reduce cost");
      if (reduce >= 0) { await pickVerticalOption(s.cursor ?? 0, reduce, "starter:reduce-cost"); return; }
      const useCandies = find("use candies");
      if (useCandies >= 0) { await pickVerticalOption(s.cursor ?? 0, useCandies, "starter:use-candies"); return; }
      await press(Button.CANCEL, "starter:candy-back");
      return;
    }

    // Team phase: pick "Add to Party".
    let target = find("add to party");
    if (target < 0) target = find("add to the party");
    if (target < 0) target = 0;
    await pickVerticalOption(s.cursor ?? 0, target, "starter:addmenu");
    return;
  }
  if (s.uiMode !== "STARTER_SELECT") return; // transitional — wait

  const containers: any[] = Array.isArray(h.filteredStarterContainers) ? h.filteredStarterContainers : [];
  if (containers.length === 0) return; // grid not populated yet — wait (don't latch candyDone)
  const idxOf = (id: number) => containers.findIndex((c) => c?.species?.speciesId === id);

  if (h.filterMode === true) { await press(Button.CANCEL, "starter:exit-filter"); return; }

  // ── Phase 1: spend candy to shave starter costs (carries first), before planning the team so
  // the cheaper carry frees budget. Each affordable reduction is applied via that mon's menu;
  // gameData updates after each, so planCandy naturally shrinks until nothing's left.
  if (!execState.candyDone && !config.applyCandyReductions) {
    execState.candyDone = true; // candy application disabled (experimental) → straight to team building
  }
  if (!execState.candyDone) {
    const pending = planCandy(readCandyStarters());
    if (pending.length === 0 || execState.candyAttempts >= MAX_CANDY_ATTEMPTS) {
      execState.candyDone = true; // every reduction applied (or we've tried enough) → build the team
    } else {
      execState.candyAttempts++;
      const next = pending.find((a) => idxOf(a.speciesId) >= 0);
      if (!next) return; // pending but not reachable this tick — wait, don't latch candyDone
      await approachAndOpen(h, idxOf(next.speciesId), "starter:open-candy-menu");
      return;
    }
  }

  const teamIds: number[] = Array.isArray(h.starterSpecies)
    ? h.starterSpecies.map((sp: any) => sp?.speciesId).filter((x: any) => typeof x === "number")
    : [];

  // Planned species still to add that are actually present in the (filtered) grid.
  const remaining = teamPlan().filter((id) => !teamIds.includes(id) && idxOf(id) >= 0);

  // Team complete (or nothing addable) → start the run via SUBMIT, then wait out the confirm-start
  // message (which leaves getMode() on STARTER_SELECT) so we don't restart it. The CONFIRM it opens
  // is handled above; if it never appears we retry after the cooldown.
  if ((remaining.length === 0 && teamIds.length > 0) || teamIds.length >= 6) {
    if (Date.now() - execState.lastSubmitAt < SUBMIT_COOLDOWN_MS) return;
    execState.lastSubmitAt = Date.now();
    await press(Button.SUBMIT, "starter:start");
    return;
  }

  // Degenerate safety: nothing planned is addable and team is empty → add whatever's at the cursor.
  if (remaining.length === 0) { await press(Button.ACTION, "starter:add-fallback"); return; }

  await approachAndOpen(h, idxOf(remaining[0]), "starter:open-add");
}

/** Grid steps taken per approachAndOpen call (re-reading the cursor each step). */
const GRID_STEPS_PER_TICK = 8;

/**
 * Move the cursor onto the grid species at `idx` and ACTION to open its menu. Subtleties:
 *  • on entry the focus can default to the start/random button — step LEFT into the grid first;
 *  • the handler only sets its `lastSpecies`/dex entry on cursor MOVEMENT (setSpecies), so if we
 *    START already on the target, ACTION opens nothing — we nudge off-and-back so the arrival
 *    fires setSpecies before we press ACTION.
 */
async function approachAndOpen(h: any, idx: number, why: string): Promise<void> {
  if (h.startCursorObj?.visible === true || h.randomCursorObj?.visible === true) {
    execState.settledIdx = -1;
    await press(Button.LEFT, "starter:to-grid");
    return;
  }
  const cur = typeof h.cursor === "number" ? h.cursor : 0;
  if (cur !== idx) { execState.settledIdx = idx; await stepGridTo(h, idx); return; }
  if (execState.settledIdx !== idx) {
    // We started on the target without moving — nudge off so the return trip fires setSpecies.
    execState.settledIdx = idx;
    await press(idx % 9 === 8 ? Button.LEFT : Button.RIGHT, "starter:settle");
    return;
  }
  await press(Button.ACTION, why);
}

/**
 * Walk the starter grid cursor toward index `idx`, several steps per call (re-reading the live
 * cursor each step) so a team across the full grid doesn't take minutes. Flat 9-col layout:
 * DOWN/UP = ±9, LEFT/RIGHT = ±1.
 */
async function stepGridTo(h: any, idx: number): Promise<void> {
  const COLS = 9;
  for (let step = 0; step < GRID_STEPS_PER_TICK; step++) {
    const cur = typeof h.cursor === "number" ? h.cursor : 0;
    if (cur === idx) return;
    const [cr, cc] = [Math.floor(cur / COLS), cur % COLS];
    const [tr, tc] = [Math.floor(idx / COLS), idx % COLS];
    if (cr < tr) await press(Button.DOWN, "starter:nav-down");
    else if (cr > tr) await press(Button.UP, "starter:nav-up");
    else if (cc < tc) await press(Button.RIGHT, "starter:nav-right");
    else if (cc > tc) await press(Button.LEFT, "starter:nav-left");
    else return;
  }
}
