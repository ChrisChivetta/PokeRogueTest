// ── Orchestrator planning ────────────────────────────────────────────────────
// The meta-loop's decision surface, kept PURE so it's exhaustively testable. Given the owned
// roster it answers the three questions the run loop needs each cycle:
//   • is the objective complete? (every owned line already holds the Classic ribbon)
//   • how much progress have we made? (ribboned / owned / remaining)
//   • what team should the next run use? (team.ts)
// Reading the roster (roster.ts) and driving the title/starter-select UI to enact the plan are
// separate slices; this module never touches the live game.

import { selectTeam, type StarterInfo, type TeamPlan, type TeamOptions } from "./team";

export interface RunPlan {
  /** The team to take into the next run. */
  team: TeamPlan;
  /** True once every owned starter line has the Classic ribbon — nothing left to ribbon. */
  done: boolean;
  ownedCount: number;
  ribbonedCount: number;
  /** Owned starters still missing the Classic ribbon. */
  remaining: number;
  /** Whether the planned team would actually award any new ribbons (else the run is wasted). */
  productive: boolean;
}

/** Compute progress + the next team from the current roster. */
export function planRun(roster: StarterInfo[], options?: Partial<TeamOptions>): RunPlan {
  const ownedCount = roster.length;
  const ribbonedCount = roster.reduce((n, s) => n + (s.ribboned ? 1 : 0), 0);
  const remaining = ownedCount - ribbonedCount;
  const team = selectTeam(roster, options);
  return {
    team,
    done: ownedCount > 0 && remaining === 0,
    ownedCount,
    ribbonedCount,
    remaining,
    productive: team.newRibbons > 0,
  };
}

/** One-line progress summary for the operator log. */
export function summarizeProgress(plan: RunPlan): string {
  const carry = plan.team.carry ? `#${plan.team.carry.speciesId}` : "none";
  return (
    `ribboned ${plan.ribbonedCount}/${plan.ownedCount} (${plan.remaining} left) | ` +
    `next: carry ${carry}, ${plan.team.team.length} mon, cost ${plan.team.totalCost}, ` +
    `+${plan.team.newRibbons} ribbons${plan.done ? " | DONE" : ""}`
  );
}
