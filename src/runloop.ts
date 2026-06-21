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
  /** Is a run in progress (snapshot.battle != null)? Disambiguates the shared menu modes. */
  inRun: boolean;
}

// Modes that only ever appear DURING a battle → always the battle policy's job. EVOLUTION_SCENE,
// EGG_HATCH_SCENE and EGG_HATCH_SUMMARY are passive post-battle/transition animation screens that
// only set awaitingActionInput on their FINAL prompt — without routing them to the policy (which
// presses to skip/dismiss) the loop WAITs forever and the wave never ends, tripping the turn-cap
// safety halt over and over. Route them to PLAY so step() drives them to completion.
const BATTLE_MODES = new Set([
  "COMMAND", "FIGHT", "BALL", "TARGET_SELECT", "MODIFIER_SELECT", "PARTY", "SUMMARY",
  "MYSTERY_ENCOUNTER", "EVOLUTION_SCENE", "EGG_HATCH_SCENE", "EGG_HATCH_SUMMARY",
]);
// Modes that appear BOTH in a battle (dialogue / learn-move confirm / encounter sub-option) AND
// during title navigation (gender prompt, game-mode submenu, intro). `inRun` picks which.
const SHARED_MODES = new Set(["OPTION_SELECT", "CONFIRM", "MESSAGE"]);

// Server / connection-trouble screens. On the live site the backend drops out often; the game
// shows one of these and AUTO-reconnects (the Unavailable modal backs off exponentially), so the
// bot must WAIT — never mash an input — and let it recover. Also covers being bounced to login if
// the session drops, and the mid-run session reload.
const SERVER_TROUBLE_MODES = new Set([
  "UNAVAILABLE", "SESSION_RELOAD", "LOGIN_OR_REGISTER", "LOGIN_FORM", "REGISTRATION_FORM",
]);

/** True on a server/connection-trouble screen — the bot should idle and let the game reconnect. */
export function isServerTrouble(uiMode: string): boolean {
  return SERVER_TROUBLE_MODES.has(uiMode);
}

/**
 * Route the current screen to a high-level action. Deterministic and side-effect free. The run
 * lifecycle falls out naturally: a finished run (win OR wipe) returns to the TITLE, where — unless
 * the objective is complete — we START_RUN again, so there's no explicit "restart" state. The
 * shared menu/dialogue modes route to the battle policy mid-run and to the title driver otherwise.
 */
export function decideLoopAction(ctx: LoopContext): LoopAction {
  if (!ctx.enabled) return "WAIT"; // kill-switch: do nothing, anywhere

  if (ctx.uiMode === "STARTER_SELECT") return "SELECT_TEAM";
  if (BATTLE_MODES.has(ctx.uiMode)) return "PLAY";
  if (SHARED_MODES.has(ctx.uiMode)) return ctx.inRun ? "PLAY" : "START_RUN";
  if (ctx.uiMode === "TITLE") return ctx.objectiveDone ? "STOP_DONE" : "START_RUN";

  // SAVE_SLOT, SETTINGS, loading/transition screens, anything unrecognized → wait, never mash.
  return "WAIT";
}
