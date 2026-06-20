// ── Game-state reader ────────────────────────────────────────────────────────
// Converts the raw BattleScene into a typed, READ-ONLY snapshot. Every field is
// read defensively: the game's internal API shifts between versions, so a missing
// accessor yields a safe default (null / []) instead of throwing. The snapshot is
// what the whole policy layer consumes — nothing above this file touches raw game
// objects, so version drift is contained to here + bridge.ts.

import { getScene, getUiModeName, getUiModeNumber, typeName, type UiModeName, type RawScene } from "./bridge";

export interface MoveSnapshot {
  name: string;
  /** Remaining PP; null if unreadable. */
  pp: number | null;
  ppMax: number | null;
  /** Move type as a lowercased string (e.g. "fire"); null if unreadable. */
  type: string | null;
  power: number | null;
  accuracy: number | null;
  /** Index of this move in the Pokémon's moveset (the value FIGHT cursor selects). */
  index: number;
  /** False if the move can't be selected right now (disabled, out of PP, Taunt/Torment, etc.). */
  usable: boolean;
}

export interface PokemonSnapshot {
  name: string;
  speciesId: number | null;
  /** Whole evolution-line root id — the unit ribbons are tracked against. */
  rootSpeciesId: number | null;
  level: number | null;
  hp: number | null;
  maxHp: number | null;
  /** hp/maxHp in [0,1]; null if unreadable. */
  hpRatio: number | null;
  fainted: boolean;
  /** Lowercased type strings, 1–2 entries. */
  types: string[];
  /** Non-volatile status (e.g. "par","slp","brn") or null. */
  status: string | null;
  ability: string | null;
  moves: MoveSnapshot[];
  /** True if this mon is currently on the field (not benched). */
  onField: boolean;
  /** True if this is a boss (segmented shield bar). Enemy-only signal; false otherwise. */
  isBoss: boolean;
  /** Remaining boss shield index: 0 === last segment (the only catchable one). null if not a boss. */
  bossSegmentIndex: number | null;
  /**
   * Whether this SPECIES is already recorded in the Pokédex (caughtAttr set). Enemy-only;
   * null on the player side / when unreadable. `false` => catching it unlocks a new starter.
   */
  speciesCaught: boolean | null;
}

export interface BattleSnapshot {
  waveIndex: number | null;
  turn: number | null;
  double: boolean;
  /** Raw battleType enum number (0 wild / 1 trainer / 2 etc.); meaning resolved in policy. */
  battleType: number | null;
  /** True on a boss wave (waveIndex % 10 === 0). Convenience. */
  isBossWave: boolean;
  /** True if a trainer object is present (trainer battle). */
  isTrainer: boolean;
}

export interface GameSnapshot {
  ready: boolean;
  uiMode: UiModeName;
  uiModeNumber: number | null;
  /** Active handler's cursor index, if any (drives input pathing). */
  cursor: number | null;
  /**
   * True when a dialogue/message handler is waiting for a press-to-continue.
   * Only AwaitableUiHandler subclasses (message screens) carry this flag; it is
   * false for COMMAND/FIGHT/etc. — i.e. it specifically signals "advance the dialogue".
   */
  awaitingActionInput: boolean;
  battle: BattleSnapshot | null;
  playerParty: PokemonSnapshot[];
  enemyParty: PokemonSnapshot[];
  /** Current biome as a BiomeId enum number (from arena.biomeId); null if unreadable. */
  biomeId: number | null;
  money: number | null;
  /** Pokéball counts by ball-tier index, if readable. */
  pokeballCounts: number[] | null;
}

// ── Defensive readers ────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
/** Call a zero-arg method if present, swallowing errors. */
function tryCall<T>(obj: any, method: string): T | undefined {
  try {
    if (obj && typeof obj[method] === "function") return obj[method]();
  } catch {
    /* ignore — version drift */
  }
  return undefined;
}

/** Resolve a Pokémon's display name across the several shapes the game has used. */
function readName(p: any): string {
  return (
    str(tryCall<string>(p, "getName")) ??
    str(p?.name) ??
    str(p?.species?.name) ??
    str(p?.species?.getName && tryCall(p.species, "getName")) ??
    "?"
  );
}

/** Lowercased type strings. The game exposes types via getTypes() (PokemonType enum
 *  numbers) or .type1/.type2. typeName() maps the numbers to readable names. */
function readTypes(p: any): string[] {
  const viaGetter = tryCall<any[]>(p, "getTypes");
  const raw = Array.isArray(viaGetter) ? viaGetter : [p?.type1, p?.type2];
  const out: string[] = [];
  for (const t of raw) {
    if (t == null) continue;
    const s = typeName(t);
    if (s && s !== "unknown") out.push(s);
  }
  return out;
}

function readMoves(p: any): MoveSnapshot[] {
  const set: any[] = Array.isArray(p?.moveset) ? p.moveset : [];
  const out: MoveSnapshot[] = [];
  set.forEach((m, index) => {
    if (!m) return;
    // A PokemonMove wraps the static move data, reachable via getMove() or .getMove.
    const md = tryCall<any>(m, "getMove") ?? m?.move ?? m;
    const type = typeName(md?.type);
    // Remaining PP: a PokemonMove tracks `ppUsed`; base PP lives on the move data
    // (`md.pp`) or as an explicit cap on the wrapper. Remaining = max - used.
    const ppMax = num(md?.pp) ?? num(m?.ppMax);
    const ppUsed = num(m?.ppUsed);
    const ppRemaining =
      ppMax != null && ppUsed != null ? ppMax - ppUsed : num(m?.pp); // fallback: explicit pp field
    // Can this move be picked right now? PokemonMove.isUsable(pokemon, ignorePp, forSelection)
    // returns [usable, reason] — false for disabled / 0-PP / Taunt/Torment, exactly what the FIGHT
    // menu greys out. Default to usable if it can't be read (don't hide a valid move).
    let usable = true;
    try {
      if (typeof m.isUsable === "function") {
        const res = m.isUsable(p, false, true);
        if (Array.isArray(res)) usable = res[0] !== false;
      }
    } catch {
      /* version drift */
    }
    out.push({
      name: str(md?.name) ?? str(tryCall<string>(md, "getName")) ?? "?",
      pp: ppRemaining,
      ppMax,
      type,
      power: num(md?.power),
      accuracy: num(md?.accuracy),
      index,
      usable,
    });
  });
  return out;
}

function readPokemon(p: any, onField: boolean, speciesCaught: boolean | null = null): PokemonSnapshot {
  const maxHp = num(tryCall<number>(p, "getMaxHp")) ?? num(p?.getMaxHp ? undefined : p?.stats?.[0]) ?? num(p?.maxHp);
  const hp = num(p?.hp);
  const ratioViaGetter = num(tryCall<number>(p, "getHpRatio"));
  const hpRatio = ratioViaGetter ?? (hp != null && maxHp ? hp / maxHp : null);
  const statusObj = p?.status;
  const status =
    str(statusObj?.effect && (str(statusObj.effect?.name) ?? String(statusObj.effect))) ??
    str(statusObj?.lapse ? undefined : undefined) ??
    (statusObj ? str(statusObj?.toString?.()) : null);

  return {
    name: readName(p),
    speciesId: num(p?.species?.speciesId) ?? num(tryCall<number>(p?.species, "getRootSpeciesId")),
    rootSpeciesId: num(tryCall<number>(p?.species, "getRootSpeciesId")) ?? num(p?.species?.speciesId),
    level: num(p?.level),
    hp,
    maxHp,
    hpRatio,
    fainted: tryCall<boolean>(p, "isFainted") === true || hp === 0,
    types: readTypes(p),
    status,
    ability: str(tryCall<any>(p, "getAbility")?.name) ?? str(p?.getAbility ? undefined : p?.ability?.name),
    moves: readMoves(p),
    onField,
    isBoss: tryCall<boolean>(p, "isBoss") === true,
    bossSegmentIndex: tryCall<boolean>(p, "isBoss") === true ? num(p?.bossSegmentIndex) : null,
    speciesCaught,
  };
}

/**
 * Normalize the game's `pokeballCounts` into a dense number[] indexed by PokeballType
 * (POKE=0, GREAT=1, ULTRA=2, ROGUE=3, MASTER=4). The game stores it as a `Record<PokeballType,
 * number>` — a plain object keyed by the numeric enum value ({0:5,1:0,…}) — so a naive
 * `Array.isArray` check misses it and the bot thinks it has no balls. Accept the object form
 * (the real shape), an actual array (defensive), and null (pre-init). Exported for unit tests.
 */
export function readPokeballCounts(raw: unknown): number[] | null {
  if (raw == null || typeof raw !== "object") return null;
  // Both arrays and the keyed object are read positionally 0..4; arrays already index that way,
  // and the object's numeric keys ("0".."4") are read via bracket access.
  const src = raw as Record<string | number, unknown>;
  const out: number[] = [];
  for (let i = 0; i <= 4; i++) out[i] = num(src[i]) ?? 0;
  return out;
}

function readParty(scene: RawScene, side: "player" | "enemy"): PokemonSnapshot[] {
  const party: any[] =
    side === "player"
      ? tryCall<any[]>(scene, "getPlayerParty") ?? scene?.getPlayerParty?.() ?? []
      : tryCall<any[]>(scene, "getEnemyParty") ?? scene?.getEnemyParty?.() ?? [];
  const field: any[] =
    side === "player"
      ? tryCall<any[]>(scene, "getPlayerField") ?? []
      : tryCall<any[]>(scene, "getEnemyField") ?? [];
  const fieldSet = new Set(field.filter(Boolean));
  // Pokédex lookup (enemy side only): has this species been caught before? Drives the
  // "catch new species to unlock a starter" policy. caughtAttr is a bigint (0n => never caught).
  const dex: any = side === "enemy" ? scene?.gameData?.dexData : null;
  const caughtOf = (p: any): boolean | null => {
    if (!dex) return null;
    const id = p?.species?.speciesId;
    if (typeof id !== "number") return null;
    return !!dex[id]?.caughtAttr;
  };
  return (Array.isArray(party) ? party : [])
    .filter(Boolean)
    .map((p) => readPokemon(p, fieldSet.has(p), caughtOf(p)));
}

function readBattle(scene: RawScene): BattleSnapshot | null {
  const b = scene?.currentBattle;
  if (!b) return null;
  const waveIndex = num(b?.waveIndex);
  return {
    waveIndex,
    turn: num(b?.turn),
    double: b?.double === true,
    battleType: num(b?.battleType),
    isBossWave: waveIndex != null && waveIndex % 10 === 0,
    isTrainer: !!b?.trainer,
  };
}

/**
 * Build a full read-only snapshot of the current game state. Cheap enough to call
 * every tick. Returns {ready:false} if the scene isn't reachable yet.
 */
export function readState(): GameSnapshot {
  const scene = getScene();
  if (!scene) {
    return {
      ready: false,
      uiMode: "UNKNOWN",
      uiModeNumber: null,
      cursor: null,
      awaitingActionInput: false,
      battle: null,
      playerParty: [],
      enemyParty: [],
      biomeId: null,
      money: null,
      pokeballCounts: null,
    };
  }

  const handler = tryCall<any>(scene?.ui, "getHandler");
  // pokeballCounts is a `Record<PokeballType, number>` at runtime — a PLAIN OBJECT keyed by the
  // enum index ({0:5,1:0,2:0,3:0,4:0}), NOT an array. The old `Array.isArray` read returned null,
  // so the bot believed it had zero balls and never threw one ("no balls in stock"). Normalize
  // either shape into a dense number[] indexed POKE(0)…MASTER(4) for catch.ts to scan.
  const pokeballCounts = readPokeballCounts(scene?.pokeballCounts);

  return {
    ready: true,
    uiMode: getUiModeName(),
    uiModeNumber: getUiModeNumber(),
    cursor: num(handler?.cursor),
    awaitingActionInput: handler?.awaitingActionInput === true,
    battle: readBattle(scene),
    playerParty: readParty(scene, "player"),
    enemyParty: readParty(scene, "enemy"),
    biomeId: num(scene?.arena?.biomeId) ?? num(scene?.arena?.biomeType),
    money: num(scene?.money),
    pokeballCounts,
  };
}

/** Compact one-line summary for the operator console. */
export function summarize(s: GameSnapshot): string {
  if (!s.ready) return "scene: not ready";
  const w = s.battle?.waveIndex ?? "?";
  const lead = s.playerParty.find((p) => p.onField) ?? s.playerParty[0];
  const foe = s.enemyParty.find((p) => p.onField) ?? s.enemyParty[0];
  const hp = (p?: PokemonSnapshot) =>
    p ? `${p.name} ${p.hpRatio != null ? Math.round(p.hpRatio * 100) + "%" : "?"}` : "—";
  return `wave ${w} | mode ${s.uiMode} | me: ${hp(lead)} | foe: ${hp(foe)} | party ${s.playerParty.length}`;
}
