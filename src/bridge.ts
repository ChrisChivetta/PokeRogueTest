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

// Test-only injection: lets the deterministic GameManager suite point the bridge at
// its headless `game.scene` instead of walking the (nonexistent) CanvasPool. Production
// never calls this; getScene() falls through to the real acquisition path when unset.
let testScene: RawScene | null = null;
export function __setSceneForTest(scene: RawScene | null): void {
  testScene = scene;
  cached = null;
}

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
  if (testScene) return testScene; // deterministic test hook (see __setSceneForTest)
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
// UiMode is an implicit (auto-numbered) enum. Its numbers CAN shift across versions
// when upstream inserts a member, but for any single build the number is exact and —
// crucially — readable on the minified pokerogue.net bundle, where class names are
// mangled and so handler-name matching is useless. We therefore resolve modes by
// NUMBER (against a source-accurate order table) as the primary signal, and use the
// handler's class name only as a corroborating cross-check that flags version drift.
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
 * PokemonType enum → lowercase name (verbatim from `src/enums/pokemon-type.ts` @ main).
 * Index = enum value (NORMAL=0 … STELLAR=18); UNKNOWN is -1. The game returns numeric
 * types from `getTypes()` and `move.type`, so resolve them here into readable strings.
 */
export const TYPE_NAMES = [
  "normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel",
  "fire", "water", "grass", "electric", "psychic", "ice", "dragon", "dark", "fairy", "stellar",
] as const;

/** Resolve a type value (enum number, string, or {name}) to a lowercase name, else null. */
export function typeName(v: unknown): string | null {
  if (typeof v === "number") {
    if (v === -1) return "unknown";
    return v >= 0 && v < TYPE_NAMES.length ? TYPE_NAMES[v] : null;
  }
  if (typeof v === "string") return v.length > 0 ? v.toLowerCase() : null;
  if (v && typeof v === "object") {
    const n = (v as any).name;
    return typeof n === "string" && n.length > 0 ? n.toLowerCase() : null;
  }
  return null;
}

/**
 * Authoritative UiMode order, copied verbatim from `src/enums/ui-mode.ts` @ main.
 * The index of each name IS its numeric enum value: UiMode is auto-numbered and the
 * game builds `ui.handlers` in this exact order, so `ui.getMode()` returns an index
 * into this list. Resolving by number therefore works on the minified pokerogue.net
 * build too (unlike class-name matching). Re-verify against upstream on major patches;
 * `modeProbe()` flags drift empirically from a live screen.
 *
 * NOTE: there is intentionally no GAME_OVER member — game-over is a *phase*, not a UI
 * mode, and renders through the message handler.
 */
export const UI_MODE_ORDER = [
  "MESSAGE", // 0
  "TITLE", // 1
  "COMMAND", // 2
  "FIGHT", // 3
  "BALL", // 4
  "TARGET_SELECT", // 5
  "MODIFIER_SELECT", // 6
  "SAVE_SLOT", // 7
  "PARTY", // 8
  "SUMMARY", // 9
  "STARTER_SELECT", // 10
  "EVOLUTION_SCENE", // 11
  "EGG_HATCH_SCENE", // 12
  "EGG_HATCH_SUMMARY", // 13
  "CONFIRM", // 14
  "OPTION_SELECT", // 15
  "MENU", // 16
  "MENU_OPTION_SELECT", // 17
  "SETTINGS", // 18
  "SETTINGS_DISPLAY", // 19
  "SETTINGS_AUDIO", // 20
  "SETTINGS_GAMEPAD", // 21
  "GAMEPAD_BINDING", // 22
  "SETTINGS_KEYBOARD", // 23
  "KEYBOARD_BINDING", // 24
  "ACHIEVEMENTS", // 25
  "GAME_STATS", // 26
  "EGG_LIST", // 27
  "EGG_GACHA", // 28
  "POKEDEX", // 29
  "POKEDEX_SCAN", // 30
  "POKEDEX_PAGE", // 31
  "LOGIN_OR_REGISTER", // 32
  "LOGIN_FORM", // 33
  "REGISTRATION_FORM", // 34
  "LOADING", // 35
  "SESSION_RELOAD", // 36
  "UNAVAILABLE", // 37
  "CHALLENGE_SELECT", // 38
  "RENAME_POKEMON", // 39
  "RENAME_RUN", // 40
  "RUN_HISTORY", // 41
  "RUN_INFO", // 42
  "TEST_DIALOGUE", // 43
  "AUTO_COMPLETE", // 44
  "ADMIN", // 45
  "MYSTERY_ENCOUNTER", // 46
  "CHANGE_PASSWORD_FORM", // 47
] as const;
export type UiModeName = (typeof UI_MODE_ORDER)[number] | "UNKNOWN";

/**
 * Map the ACTIVE HANDLER's class name → our UiModeName. This is a CORROBORATING signal
 * only: it works on unminified/dev builds (where class names survive) and is used to
 * cross-check the numeric resolver and surface version drift. On the minified
 * pokerogue.net bundle these names are mangled, so this map simply yields nothing and
 * the numeric resolver carries the load.
 *
 * `OptionSelectUiHandler` backs both OPTION_SELECT and MENU_OPTION_SELECT, so a number↔
 * name disagreement between those two is an expected alias, not drift (see isModeAlias).
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
  MysteryEncounterUiHandler: "MYSTERY_ENCOUNTER",
};

/** OPTION_SELECT and MENU_OPTION_SELECT share one handler class — treat as equivalent. */
function isModeAlias(a: UiModeName, b: UiModeName): boolean {
  const set = new Set([a, b]);
  return set.has("OPTION_SELECT") && set.has("MENU_OPTION_SELECT");
}

/**
 * Current UI mode as a stable NAME. Strategy:
 *   1. PRIMARY — `ui.getMode()` indexed into the source-accurate UI_MODE_ORDER. Works on
 *      the minified live build; this is what carries the load on pokerogue.net.
 *   2. CROSS-CHECK — the handler's class name (dev/unminified only). If it disagrees with
 *      the numeric result (and isn't the OptionSelect alias), log a drift warning so we
 *      know UI_MODE_ORDER has gone stale vs the running build. We still trust the number,
 *      since on the real target the name is mangled and the number is exact.
 *   3. FALLBACK — if the number is unreadable/out of range, use the handler name if we
 *      have one; otherwise "UNKNOWN" (logged). Callers treat UNKNOWN as "don't act".
 */
export function getUiModeName(): UiModeName {
  const modeNum = getUiModeNumber();
  const byNumber =
    modeNum != null && modeNum >= 0 && modeNum < UI_MODE_ORDER.length
      ? UI_MODE_ORDER[modeNum]
      : undefined;

  const ctorName: string | undefined = getActiveHandler()?.constructor?.name;
  const byHandler = ctorName ? HANDLER_NAME_TO_MODE[ctorName] : undefined;

  if (byNumber) {
    if (byHandler && byHandler !== byNumber && !isModeAlias(byNumber, byHandler)) {
      log.warn(
        `[bridge] UI mode drift: getMode()=${modeNum} → "${byNumber}", but handler ` +
          `"${ctorName}" → "${byHandler}". If the live screen is "${byHandler}", ` +
          `UI_MODE_ORDER is stale for this build — run autoRibbon.modeProbe() to re-map.`,
      );
    }
    return byNumber;
  }

  if (byHandler) return byHandler;

  log.debug(`[bridge] unclassified UI mode: getMode()=${modeNum}, handler=${ctorName ?? "?"}`);
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

/**
 * The mystery encounter active on the current wave, or null. PokéRogue parks the
 * encounter definition on `currentBattle.mysteryEncounter` for the whole wave (it
 * persists through the option screen and any secondary party/sub-option selects), so
 * this doubles as "are we resolving an encounter right now?" — see inMysteryEncounter.
 */
export function getMysteryEncounter(): any | null {
  return getScene()?.currentBattle?.mysteryEncounter ?? null;
}

/** True while a mystery encounter is being resolved on the current wave. */
export function inMysteryEncounter(): boolean {
  return getMysteryEncounter() != null;
}

/**
 * Name of the phase currently running, or null. Phases expose a `phaseName` string literal that
 * survives minification (unlike the class name), so this is reliable on the live build. Used to
 * scope the starter-select driver (the SelectStarterPhase spans several UI sub-modes).
 */
export function getCurrentPhaseName(): string | null {
  const p = getScene()?.phaseManager?.getCurrentPhase?.();
  return (typeof p?.phaseName === "string" ? p.phaseName : p?.constructor?.name) ?? null;
}

/** One move's quality-relevant fields (the candidate, or an existing slot). */
export interface LearnMoveData {
  name: string;
  /** Lowercased type string (e.g. "fire"); null if unreadable. */
  type: string | null;
  power: number | null;
  accuracy: number | null;
}

/** What a LearnMovePhase is offering, plus the learner's current moveset + types. */
export interface LearnMoveCandidate {
  candidate: LearnMoveData;
  /** The learning Pokémon's existing moves (0–4), in slot order. */
  currentMoves: LearnMoveData[];
  /** The learning Pokémon's types (lowercased) — for STAB scoring. */
  userTypes: string[];
}

/** Resolve a raw move object (static data or PokemonMove wrapper) to LearnMoveData. */
function readMoveData(raw: any): LearnMoveData {
  const md = (typeof raw?.getMove === "function" ? raw.getMove() : raw?.move) ?? raw;
  const power = typeof md?.power === "number" ? md.power : null;
  const accuracy = typeof md?.accuracy === "number" ? md.accuracy : null;
  return {
    name: typeof md?.name === "string" && md.name.length > 0 ? md.name : "?",
    type: typeName(md?.type),
    power,
    accuracy,
  };
}

/**
 * If the current phase is a LearnMovePhase, read the move it's offering, the learning mon's
 * current moveset, and that mon's types — everything needed to decide whether/which to swap.
 * The phase holds the move by id (`moveId`) and the learner by `partyMemberIndex`; the static
 * move table is reached defensively (phase-local accessor, then a global `allMoves`). Returns
 * null on any drift so the caller falls back to a safe decline.
 */
export function getLearnMoveCandidate(): LearnMoveCandidate | null {
  const scene: any = getScene();
  const phase: any = scene?.phaseManager?.getCurrentPhase?.();
  if (!phase) return null;
  const name = (typeof phase.phaseName === "string" ? phase.phaseName : phase?.constructor?.name) ?? "";
  if (name !== "LearnMovePhase") return null;

  const moveId = phase.moveId;
  if (typeof moveId !== "number") return null;

  // Resolve the static Move record. Prefer a phase-local accessor; fall back to a global table.
  const all: any =
    (typeof phase.getMove === "function" ? undefined : phase.allMoves) ??
    (globalThis as any).allMoves ??
    scene?.allMoves;
  const move: any =
    (typeof phase.getMove === "function" ? phase.getMove() : undefined) ??
    (all && (Array.isArray(all) || typeof all === "object") ? all[moveId] : undefined);
  if (!move) return null;

  // Identify the learning Pokémon: the phase's party member, else the on-field lead.
  const party: any[] =
    (typeof scene?.getPlayerParty === "function" ? scene.getPlayerParty() : undefined) ?? [];
  const idx = typeof phase.partyMemberIndex === "number" ? phase.partyMemberIndex : 0;
  const learner: any = party[idx] ?? party[0];

  const moveset: any[] = Array.isArray(learner?.moveset) ? learner.moveset : [];
  const currentMoves = moveset.filter(Boolean).map(readMoveData);

  const typesRaw =
    (typeof learner?.getTypes === "function" ? learner.getTypes() : undefined) ??
    [learner?.type1, learner?.type2];
  const userTypes: string[] = [];
  for (const t of Array.isArray(typesRaw) ? typesRaw : []) {
    const s = typeName(t);
    if (s && s !== "unknown") userTypes.push(s);
  }

  return { candidate: readMoveData(move), currentMoves, userTypes };
}

/** Reset the cached scene. Call if the bridge starts returning stale/dead handles. */
export function resetBridge(): void {
  cached = null;
}

// ── Live diagnostics ─────────────────────────────────────────────────────────
// These exist so the first live session can verify (and, if needed, repair) the two
// version-fragile assumptions in this file — scene acquisition and UI-mode mapping —
// from a single console call per concern, instead of the handoff's "log raw numbers
// per screen" loop. Read-only; safe to call anytime.

export interface SceneProbe {
  found: boolean;
  /** Which acquisition strategy yielded scenes (see findSceneArray). */
  via: "phaser-canvaspool" | "canvas-backref" | "window-game" | "none";
  phaserGlobalPresent: boolean;
  canvasPoolLen: number;
  canvasCount: number;
  sceneCount: number;
  /** Constructor names of every Phaser scene found (mangled on prod, but counts/shape help). */
  sceneCtors: string[];
  /** Does the acquired scene expose the battle-shaped accessors we depend on? */
  battleShaped: boolean;
}

/** Report how (and whether) the live BattleScene is reachable, and by which path. */
export function sceneProbe(): SceneProbe {
  const Phaser: PhaserLike | undefined = (globalThis as any).Phaser;
  const pool = Phaser?.Display?.Canvas?.CanvasPool?.pool;
  const canvasPoolLen = Array.isArray(pool) ? pool.length : 0;
  const canvases =
    typeof document !== "undefined" ? Array.from(document.querySelectorAll("canvas")) : [];

  let via: SceneProbe["via"] = "none";
  if (canvasPoolLen > 0) via = "phaser-canvaspool";
  else if (canvases.some((c) => (c as any).__phaserGame ?? (c as any).game ?? (c as any)._phaser?.game))
    via = "canvas-backref";
  else if ((globalThis as any).game?.scene?.scenes ?? (globalThis as any).gameInstance?.scene?.scenes)
    via = "window-game";

  const scenes = findSceneArray();
  const scene = getScene();
  return {
    found: scene !== null,
    via,
    phaserGlobalPresent: !!Phaser,
    canvasPoolLen,
    canvasCount: canvases.length,
    sceneCount: scenes.length,
    sceneCtors: scenes.map((s) => s?.constructor?.name ?? "?"),
    battleShaped: looksLikeBattleScene(scene),
  };
}

export interface HandlerProbe {
  index: number;
  /** Expected name from UI_MODE_ORDER (source-accurate). */
  expected: UiModeName | "(out of range)";
  /** Live class name — mangled on prod, real in dev. */
  ctor: string;
  /** A few own-property keys — preserved by esbuild even when class names are mangled,
   *  so these fingerprint a handler (e.g. FIGHT vs MODIFIER_SELECT) on the live build. */
  ownKeys: string[];
}

export interface ModeProbe {
  currentNumber: number | null;
  currentResolved: UiModeName;
  currentHandlerCtor: string | null;
  handlerCount: number;
  handlers: HandlerProbe[];
}

/**
 * Dump the full `ui.handlers` array with each entry's index, expected name, live class
 * name, and own-property fingerprint. One call confirms whether UI_MODE_ORDER matches
 * the running build — and gives the fingerprints to fix it if not.
 */
export function modeProbe(): ModeProbe {
  const ui = getScene()?.ui;
  const handlers: any[] = Array.isArray(ui?.handlers) ? ui.handlers : [];
  return {
    currentNumber: getUiModeNumber(),
    currentResolved: getUiModeName(),
    currentHandlerCtor: getActiveHandler()?.constructor?.name ?? null,
    handlerCount: handlers.length,
    handlers: handlers.map((h, index) => ({
      index,
      expected: index < UI_MODE_ORDER.length ? UI_MODE_ORDER[index] : "(out of range)",
      ctor: h?.constructor?.name ?? "?",
      ownKeys: h ? Object.keys(h).slice(0, 14) : [],
    })),
  };
}
