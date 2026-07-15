// ── Starter-select execution state ───────────────────────────────────────────
// The starter-select adapter (execution.ts) carries phase state ACROSS ticks: the cached team plan,
// whether the candy phase is done, the grid index it has settled on, the last SUBMIT time, etc.
// For the strategy bundle to be HOT-SWAPPABLE this state must survive a swap — so it lives here as a
// single live singleton published on globalThis.__hostSeam (mirroring retry/catch). The swapped
// strategy bundle reads/writes the SAME object through a seam shim, so an in-progress starter-select
// resumes in place rather than snapping back to a fresh plan.

export interface ExecState {
  /** The planned team's species ids, computed once per starter-select visit. Null = unplanned. */
  planIds: number[] | null;
  /** Candy-reduction phase finished (team-building may begin). */
  candyDone: boolean;
  /** Bounded attempt counter so a mis-navigation can't loop the candy phase forever. */
  candyAttempts: number;
  /** Grid index we've confirmed the cursor moved onto (so setSpecies has fired). -1 = none. */
  settledIdx: number;
  /** Timestamp of the last SUBMIT, to honor the post-submit message cooldown. */
  lastSubmitAt: number;
}

/** The live, mutable starter-select state shared with the hot strategy bundle via the seam. */
export const execState: ExecState = {
  planIds: null,
  candyDone: false,
  candyAttempts: 0,
  settledIdx: -1,
  lastSubmitAt: 0,
};

/** Drop the cached plan + phase state (call when leaving starter select / between runs). */
export function resetExecState(): void {
  execState.planIds = null;
  execState.candyDone = false;
  execState.candyAttempts = 0;
  execState.settledIdx = -1;
  execState.lastSubmitAt = 0;
}
