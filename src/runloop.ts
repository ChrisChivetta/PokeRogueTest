// ── Cross-run loop (orchestration backbone) ──────────────────────────────────
// The unattended meta-loop is event-driven: every tick the bot reads the current UI mode and
// decides ONE high-level action. This module is the PURE router for that decision — it composes
// the planning brain (orchestrator/team/candy) with the battle policy and the run lifecycle, and
// is exhaustively unit-testable. The thin, version-fragile UI ADAPTERS it implies (navigating the
// title screen, driving the starter-select grid to enact a team/candy plan) are a separate slice
// that must be validated on the live harness — GameManager can't drive those screens reliably
// (upstream's own starter-select UI test is disabled for "state corruption").

/** The one high-level action to take this tick. */
export type LoopAction =
  | "PLAY" //        a battle / reward / encounter / message screen → run the battle policy step()
  | "START_RUN" //   at the title with ribbons left → begin a new Classic run (→ starter select)
  | "SELECT_TEAM" // at the starter-select screen → enact the planned team + candy reductions
  | "STOP_DONE" //   every owned line is ribboned → objective complete, halt
  | "WAIT"; //       transitional / unrecognized screen → idle (don't act blindly)

export interface LoopContext {
  /** Resolved UI mode name (bridge.getUiModeName()). */
  uiMode: string;
  /** planRun().done — every owned starter line already holds the Classic ribbon. */
  objectiveDone: boolean;
  /** Kill-switch / master enable (config.enabled). */
  enabled: boolean;
}

// Screens the battle policy (policy.step) already owns — in-battle, rewards, encounters, dialogue.
// On any of these the loop simply defers to the existing, well-tested policy.
const PLAY_MODES = new Set([
  "COMMAND", "FIGHT", "BALL", "TARGET_SELECT", "MODIFIER_SELECT", "PARTY", "CONFIRM", "SUMMARY",
  "MYSTERY_ENCOUNTER", "OPTION_SELECT", "MESSAGE",
]);

/**
 * Route the current screen to a high-level action. Deterministic and side-effect free. The run
 * lifecycle falls out naturally: a finished run (win OR wipe) returns to the TITLE, where — unless
 * the objective is complete — we START_RUN again, so there's no explicit "restart" state.
 */
export function decideLoopAction(ctx: LoopContext): LoopAction {
  if (!ctx.enabled) return "WAIT"; // kill-switch: do nothing, anywhere

  if (PLAY_MODES.has(ctx.uiMode)) return "PLAY";

  switch (ctx.uiMode) {
    case "TITLE":
      return ctx.objectiveDone ? "STOP_DONE" : "START_RUN";
    case "STARTER_SELECT":
      return "SELECT_TEAM";
    default:
      // SAVE_SLOT, SETTINGS, loading/transition screens, anything unrecognized → wait, never
      // mash. (The live adapters resolve SAVE_SLOT/CONFIRM that appear mid-START_RUN inline.)
      return "WAIT";
  }
}
