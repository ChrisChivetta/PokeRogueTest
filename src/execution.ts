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
import { readRoster } from "./roster";
import { selectTeam } from "./team";
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
// (Candy value-reductions are a later refinement — selecting + starting is the core.)

let planIds: number[] | null = null;

let lastSubmitAt = 0;
// After SUBMIT, tryStart shows a "confirm start team?" message via the message handler WITHOUT
// changing getMode() (the starter handler isn't a MessageUiHandler) — so the screen still reads
// STARTER_SELECT for ~1s while the text types and its callback opens the CONFIRM. We must NOT
// re-SUBMIT during that window or we restart the message and the CONFIRM never appears.
const SUBMIT_COOLDOWN_MS = 3000;

/** Drop the cached team plan (call when leaving starter select / between runs). */
export function resetStarterSelect(): void {
  planIds = null;
  lastSubmitAt = 0;
}

/** The planned team's species ids, computed once per starter-select visit from the live roster. */
function teamPlan(): number[] {
  if (!planIds) {
    const plan = selectTeam(readRoster());
    planIds = plan.team.map((s) => s.speciesId);
    log.info(`[starter] plan: [${planIds.join(", ")}] (carry #${plan.carry?.speciesId ?? "?"})`);
  }
  return planIds;
}

export async function driveStarterSelect(s: GameSnapshot): Promise<void> {
  const h = getActiveHandler();
  if (!h) return;

  // Sub-screens that pop over the grid while starting.
  if (s.uiMode === "CONFIRM") { await press(Button.ACTION, "starter:confirm-start"); return; }
  if (s.uiMode === "SAVE_SLOT") { await press(Button.ACTION, "starter:save-slot"); return; }
  if (s.uiMode === "OPTION_SELECT") {
    // The per-mon menu — pick "Add to Party" (first option), navigating to it if needed.
    const labels: string[] = Array.isArray(h.config?.options)
      ? h.config.options.map((o: any) => (typeof o?.label === "string" ? o.label.toLowerCase() : ""))
      : [];
    let target = labels.findIndex((l) => l.includes("add to party") || l.includes("add to the party"));
    if (target < 0) target = 0;
    await pickVerticalOption(s.cursor ?? 0, target, "starter:addmenu");
    return;
  }
  if (s.uiMode !== "STARTER_SELECT") return; // transitional — wait

  const containers: any[] = Array.isArray(h.filteredStarterContainers) ? h.filteredStarterContainers : [];
  const teamIds: number[] = Array.isArray(h.starterSpecies)
    ? h.starterSpecies.map((sp: any) => sp?.speciesId).filter((x: any) => typeof x === "number")
    : [];
  const idxOf = (id: number) => containers.findIndex((c) => c?.species?.speciesId === id);

  // Planned species still to add that are actually present in the (filtered) grid.
  const remaining = teamPlan().filter((id) => !teamIds.includes(id) && idxOf(id) >= 0);

  // If somehow on the start/random/filter context, step back into the grid first.
  if (h.filterMode === true) { await press(Button.CANCEL, "starter:exit-filter"); return; }
  const onStartBtn = h.startCursorObj?.visible === true || h.randomCursorObj?.visible === true;

  // Team complete (or nothing addable) → start the run via SUBMIT, then wait out the confirm-start
  // message (which leaves getMode() on STARTER_SELECT) so we don't restart it. The CONFIRM it opens
  // is handled above; if it never appears we retry after the cooldown.
  if ((remaining.length === 0 && teamIds.length > 0) || teamIds.length >= 6) {
    if (Date.now() - lastSubmitAt < SUBMIT_COOLDOWN_MS) return;
    lastSubmitAt = Date.now();
    await press(Button.SUBMIT, "starter:start");
    return;
  }
  if (onStartBtn) { await press(Button.LEFT, "starter:to-grid"); return; }

  // Degenerate safety: nothing planned is addable and team is empty → add whatever's at the cursor.
  if (remaining.length === 0) { await press(Button.ACTION, "starter:add-fallback"); return; }

  // Navigate the grid toward the next target species, then ACTION to open its add menu. The grid
  // can be large (every owned starter across gens), so we take several steps per call — re-reading
  // the live cursor between each — rather than one per tick, or a 6-mon team would take minutes.
  const target = remaining[0];
  const idx = idxOf(target);
  const COLS = 9;
  for (let step = 0; step < GRID_STEPS_PER_TICK; step++) {
    const cur = typeof h.cursor === "number" ? h.cursor : 0;
    if (cur === idx) { await press(Button.ACTION, "starter:open-add"); return; }
    const [cr, cc] = [Math.floor(cur / COLS), cur % COLS];
    const [tr, tc] = [Math.floor(idx / COLS), idx % COLS];
    if (cr < tr) await press(Button.DOWN, "starter:nav-down");
    else if (cr > tr) await press(Button.UP, "starter:nav-up");
    else if (cc < tc) await press(Button.RIGHT, "starter:nav-right");
    else if (cc > tc) await press(Button.LEFT, "starter:nav-left");
    else break;
  }
}

/** Grid steps taken per driveStarterSelect call (re-reading the cursor each step). */
const GRID_STEPS_PER_TICK = 8;
