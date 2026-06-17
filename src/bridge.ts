// ── Scene bridge ─────────────────────────────────────────────────────────────
// The ONLY version-fragile seam. PokéRogue renders to a single <canvas> via
// Phaser 3 and exposes its BattleScene as a module-only export (`globalScene`),
// NOT on window. So we reach it by walking Phaser's CanvasPool to the live game,
// then locating the scene that owns `currentBattle` / `getPlayerParty`.
//
// Everything here returns RAW game objects typed as `any`. We never mutate them.
// Higher layers (state.ts) convert these into typed, read-only snapshots.
//
// If a game update changes the scene shape, this file is where it breaks — and it
// is designed to fail LOUD (clear diagnostic) rather than silently misread.

import { log } from "./log";

/** Opaque handle to the live BattleScene. Treat as read-only. */
export type RawScene = any; // game's BattleScene; we don't own its TS types.

interface PhaserLike {
  Display?: {
    Canvas?: {
      CanvasPool?: {
        pool?: Array<{ parent?: { game?: { scene?: { scenes?: RawScene[] } } } }>;
      };
    };
  };
}

let cached: RawScene | null = null;

/** Heuristic: a BattleScene exposes these. Kept loose so minor renames don't false-negative. */
function looksLikeBattleScene(s: any): boolean {
  return (
    !!s &&
    typeof s.getPlayerParty === "function" &&
    typeof s.getEnemyParty === "function" &&
    "currentBattle" in s &&
    !!s.ui &&
    typeof s.ui.getMode === "function"
  );
}

/** Walk every plausible path to the array of Phaser scenes. */
function findSceneArray(): RawScene[] {
  const out: RawScene[] = [];

  // Primary: Phaser global → CanvasPool → game → scenes (the documented-by-source path).
  const Phaser: PhaserLike | undefined = (globalThis as any).Phaser;
  const pool = Phaser?.Display?.Canvas?.CanvasPool?.pool;
  if (Array.isArray(pool)) {
    for (const entry of pool) {
      const scenes = entry?.parent?.game?.scene?.scenes;
      if (Array.isArray(scenes)) out.push(...scenes);
    }
  }

  // Fallback A: a real <canvas> often carries a back-reference to its Phaser game.
  if (out.length === 0) {
    for (const canvas of Array.from(document.querySelectorAll("canvas"))) {
      const game =
        (canvas as any).__phaserGame ??
        (canvas as any).game ??
        (canvas as any)._phaser?.game;
      const scenes = game?.scene?.scenes;
      if (Array.isArray(scenes)) out.push(...scenes);
    }
  }

  // Fallback B: some builds stash the game on window despite the module export.
  if (out.length === 0) {
    const g: any = globalThis as any;
    const scenes = g.game?.scene?.scenes ?? g.gameInstance?.scene?.scenes;
    if (Array.isArray(scenes)) out.push(...scenes);
  }

  return out;
}

/**
 * Acquire the live BattleScene. Caches once found; re-validates the cache each call
 * and re-acquires if the game was torn down/rebuilt (e.g. page-internal reload).
 * Returns null if the game isn't ready yet (caller should retry on the next tick).
 */
export function getScene(): RawScene | null {
  if (cached && looksLikeBattleScene(cached)) return cached;
  cached = null;

  const scenes = findSceneArray();
  if (scenes.length === 0) return null; // game not booted yet — normal during load.

  const scene = scenes.find(looksLikeBattleScene);
  if (!scene) {
    // We found Phaser scenes but none match the BattleScene shape. Either the game
    // is on the title screen with the battle scene not yet constructed, or — the
    // dangerous case — a game update renamed the accessors. Distinguish for the operator.
    log.debug(
      `[bridge] ${scenes.length} Phaser scene(s) present but none look like BattleScene yet`,
    );
    return null;
  }

  cached = scene;
  log.info("[bridge] BattleScene acquired");
  return scene;
}

/** True once the scene is reachable and battle-shaped. */
export function isSceneReady(): boolean {
  return getScene() !== null;
}

// ── Enum resolution ──────────────────────────────────────────────────────────
// UiMode has ~44 implicitly-numbered members, so its numeric values are NOT stable
// across versions. We therefore resolve modes by NAME wherever the game gives us a
// named handle, and only fall back to baked-in numbers as a last resort.
//
// Button is small (0..17) and stable; we bake it but expose a resolver for symmetry.

/** Button enum (verbatim from src/enums/buttons.ts @ main). Stable. */
export const Button = {
  UP: 0,
  DOWN: 1,
  LEFT: 2,
  RIGHT: 3,
  SUBMIT: 4,
  ACTION: 5,
  CANCEL: 6,
  MENU: 7,
  STATS: 8,
} as const;
export type ButtonName = keyof typeof Button;

/**
 * Names of the UiMode members we care about. We map the scene's *current* numeric
 * mode back to one of these names by reading the game's own UiMode enum object if it
 * is reachable, so we never depend on a hardcoded number matching the live build.
 */
export const UI_MODE_NAMES = [
  "MESSAGE",
  "TITLE",
  "COMMAND",
  "FIGHT",
  "BALL",
  "TARGET_SELECT",
  "MODIFIER_SELECT",
  "PARTY",
  "SUMMARY",
  "STARTER_SELECT",
  "CONFIRM",
  "OPTION_SELECT",
  "MENU",
  "SAVE_SLOT",
  "GAME_OVER",
] as const;
export type UiModeName = (typeof UI_MODE_NAMES)[number] | "UNKNOWN";

/**
 * Map the ACTIVE HANDLER's class name → our UiModeName. This is the primary, most
 * robust signal: the game indexes `ui.handlers[mode]` by mode, and each is a distinctly
 * named class. Far more stable than guessing the enum's implicit numeric values.
 *
 * Caveat: production builds may minify class names. We therefore ALSO keep the enum
 * translation as a fallback, and accept handler-name matching only on a recognized name.
 */
const HANDLER_NAME_TO_MODE: Record<string, UiModeName> = {
  CommandUiHandler: "COMMAND",
  FightUiHandler: "FIGHT",
  BallUiHandler: "BALL",
  ModifierSelectUiHandler: "MODIFIER_SELECT",
  PartyUiHandler: "PARTY",
  TargetSelectUiHandler: "TARGET_SELECT",
  TitleUiHandler: "TITLE",
  BattleMessageUiHandler: "MESSAGE",
  MessageUiHandler: "MESSAGE",
  SummaryUiHandler: "SUMMARY",
  StarterSelectUiHandler: "STARTER_SELECT",
  ConfirmUiHandler: "CONFIRM",
  OptionSelectUiHandler: "OPTION_SELECT",
  MenuUiHandler: "MENU",
  SaveSlotSelectUiHandler: "SAVE_SLOT",
  GameOverUiHandler: "GAME_OVER",
};

/**
 * Try to obtain the game's UiMode enum object (name→value map) to translate a numeric
 * mode into a name. Best-effort fallback; returns null if not reachable.
 */
function getUiModeEnum(): Record<string, number> | null {
  const ui = getScene()?.ui;
  if (!ui) return null;
  const candidate =
    (ui.constructor as any)?.UiMode ?? (ui as any).UiMode ?? (globalThis as any).UiMode;
  return candidate && typeof candidate === "object" ? candidate : null;
}

/**
 * Current UI mode as a stable NAME. Strategy, most→least robust:
 *   1. Match the active handler's constructor name (survives enum renumbering).
 *   2. Translate ui.getMode() via the game's UiMode enum object, if reachable.
 *   3. Give up → "UNKNOWN" (logged with the raw number). Callers treat UNKNOWN as
 *      "don't act" — the policy pauses on unrecognized modes rather than guessing.
 */
export function getUiModeName(): UiModeName {
  // 1) Handler class name.
  const handler = getScene()?.ui?.getHandler?.();
  const ctorName: string | undefined = handler?.constructor?.name;
  if (ctorName && HANDLER_NAME_TO_MODE[ctorName]) return HANDLER_NAME_TO_MODE[ctorName];

  // 2) Enum translation.
  const modeNum: number | undefined = getScene()?.ui?.getMode?.();
  if (typeof modeNum !== "number") return "UNKNOWN";
  const enumObj = getUiModeEnum();
  if (enumObj) {
    for (const name of UI_MODE_NAMES) {
      if (enumObj[name] === modeNum) return name;
    }
  }

  // 3) Unclassifiable — surface the number for the operator, refuse to guess.
  log.debug(
    `[bridge] unclassified UI mode: getMode()=${modeNum}, handler=${ctorName ?? "?"}`,
  );
  return "UNKNOWN";
}

/** Raw numeric mode, for diagnostics. */
export function getUiModeNumber(): number | null {
  const m = getScene()?.ui?.getMode?.();
  return typeof m === "number" ? m : null;
}

/** The active UI handler (its `cursor`, `awaitingActionInput`, etc. drive input pathing). */
export function getActiveHandler(): any | null {
  return getScene()?.ui?.getHandler?.() ?? null;
}

/** Reset the cached scene. Call if the bridge starts returning stale/dead handles. */
export function resetBridge(): void {
  cached = null;
}
