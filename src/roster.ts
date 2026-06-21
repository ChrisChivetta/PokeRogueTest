// ── Roster reader ────────────────────────────────────────────────────────────
// Reads the player's owned starters — effective cost, Classic-ribbon status, carry rank —
// from the live gameData into the pure StarterInfo[] that team.ts consumes. Version-fragile
// (it touches gameData internals), so it's defensive: anything unreadable is skipped, never
// thrown. Selectable starters are exactly the keys of gameData.starterData that are owned
// (dexData[id].caughtAttr set).

import { getScene, typeName } from "./bridge";
import { CARRY_RANK, type StarterInfo } from "./team";
import type { CandyStarter } from "./candy";
import type { CatchContext, PartyMon } from "./catch";

/** RibbonData.CLASSIC (src/system/ribbons/ribbon-data.ts) — the bit a Classic clear awards. */
export const CLASSIC_RIBBON = 0x0008000000n;

/**
 * Read a starter species' base type name(s) defensively, lowercased (e.g. ["fire"],
 * ["grass","poison"]). Used to diversify the bench (team.ts). PokemonSpecies carries type1 +
 * (nullable) type2. We resolve the species via the scene's getPokemonSpecies if present, else the
 * global allSpecies table; either lookup is version-fragile, so any failure yields [] (selection
 * then degrades to pure cheapest-first). NEVER throws.
 */
function readSpeciesTypes(scene: any, speciesId: number): string[] {
  try {
    const sp =
      typeof scene?.getPokemonSpecies === "function"
        ? scene.getPokemonSpecies(speciesId)
        : (globalThis as any).allSpecies?.[speciesId] ??
          (globalThis as any).allSpecies?.find?.((s: any) => s?.speciesId === speciesId);
    if (!sp) return [];
    const out: string[] = [];
    const t1 = typeName(sp.type1);
    if (t1 && t1 !== "unknown") out.push(t1);
    const t2 = sp.type2 != null ? typeName(sp.type2) : null;
    if (t2 && t2 !== "unknown" && t2 !== t1) out.push(t2);
    return out;
  } catch {
    return [];
  }
}

/** Read a dex entry's ribbon bitmask defensively (RibbonData exposes getRibbons()). */
function readRibbons(dex: any): bigint {
  const r = dex?.ribbons;
  if (r && typeof r.getRibbons === "function") {
    try {
      const v = r.getRibbons();
      return typeof v === "bigint" ? v : 0n;
    } catch {
      /* version drift */
    }
  }
  return 0n;
}

/** Snapshot the owned starter roster from gameData. Empty if the scene isn't ready. */
export function readRoster(): StarterInfo[] {
  const scene: any = getScene();
  const gd: any = scene?.gameData;
  if (!gd || !gd.dexData || !gd.starterData || typeof gd.getSpeciesStarterValue !== "function") {
    return [];
  }

  const out: StarterInfo[] = [];
  for (const key of Object.keys(gd.starterData)) {
    const speciesId = Number(key);
    if (!Number.isInteger(speciesId)) continue;
    const dex = gd.dexData[speciesId];
    if (!dex?.caughtAttr) continue; // not owned → can't be selected as a starter

    let cost: number;
    try {
      cost = gd.getSpeciesStarterValue(speciesId);
    } catch {
      continue;
    }
    if (typeof cost !== "number" || !Number.isFinite(cost)) continue;

    out.push({
      speciesId,
      cost,
      ribboned: (readRibbons(dex) & CLASSIC_RIBBON) !== 0n,
      carryRank: CARRY_RANK[speciesId] ?? null,
      types: readSpeciesTypes(scene, speciesId), // [] if unreadable → diversity is a no-op
    });
  }
  return out;
}

/**
 * Snapshot owned starters with the candy state needed for candy routing: base (unreduced) cost
 * — read via getSpeciesStarterValue(id, 0) — plus the species' candy count and reductions used.
 */
export function readCandyStarters(): CandyStarter[] {
  const gd: any = getScene()?.gameData;
  if (!gd || !gd.dexData || !gd.starterData || typeof gd.getSpeciesStarterValue !== "function") {
    return [];
  }

  const out: CandyStarter[] = [];
  for (const key of Object.keys(gd.starterData)) {
    const speciesId = Number(key);
    if (!Number.isInteger(speciesId)) continue;
    if (!gd.dexData[speciesId]?.caughtAttr) continue;

    let baseCost: number;
    try {
      baseCost = gd.getSpeciesStarterValue(speciesId, 0); // reduction 0 → unreduced cost
    } catch {
      continue;
    }
    if (!Number.isFinite(baseCost)) continue;

    const sd = gd.starterData[speciesId];
    out.push({
      speciesId,
      baseCost,
      candyCount: Number(sd?.candyCount) || 0,
      valueReduction: Number(sd?.valueReduction) || 0,
      isCarry: speciesId in CARRY_RANK,
    });
  }
  return out;
}

/**
 * Read the on-field wild + our party by STARTER (root) species — cost, Classic-ribbon status, and
 * caught/carry flags — for the catch-for-ribbons decision (catch.ts/worthCatching). Cost + ribbon
 * are tracked at the base-species level, so each mon resolves via `species.getRootSpeciesId()`.
 * Defensive: returns null if the scene/foe isn't readable. Version-fragile (touches live objects).
 */
export function readCatchContext(): CatchContext | null {
  let scene: any;
  try {
    scene = getScene();
  } catch {
    return null; // no live scene (e.g. unit-test env) → caller falls back to fighting
  }
  const gd: any = scene?.gameData;
  if (!gd?.dexData || typeof gd.getSpeciesStarterValue !== "function") return null;

  const root = (p: any): number | null => {
    try {
      const id = p?.species?.getRootSpeciesId?.();
      return typeof id === "number" ? id : null;
    } catch {
      return null;
    }
  };
  const costOf = (id: number): number | null => {
    try {
      const c = gd.getSpeciesStarterValue(id);
      return Number.isFinite(c) ? c : null;
    } catch {
      return null;
    }
  };
  const ribbonedOf = (id: number): boolean => (readRibbons(gd.dexData[id]) & CLASSIC_RIBBON) !== 0n;
  const levelOf = (p: any): number | null => {
    const lvl = p?.level;
    return typeof lvl === "number" && Number.isFinite(lvl) ? lvl : null;
  };

  const foe = (scene.getEnemyField?.() ?? []).find((p: any) => p?.isOnField?.()) ?? scene.getEnemyField?.()?.[0];
  const foeRoot = foe ? root(foe) : null;
  if (foeRoot == null) return null;
  const foeCost = costOf(foeRoot);
  if (foeCost == null) return null;

  const party: CatchContext["party"] = [];
  for (const p of scene.getPlayerParty?.() ?? []) {
    const id = root(p);
    if (id == null) continue;
    const cost = costOf(id);
    if (cost == null) continue;
    party.push({ ribboned: ribbonedOf(id), cost, isCarry: id in CARRY_RANK, level: levelOf(p) });
  }

  return {
    caught: !!gd.dexData[foeRoot]?.caughtAttr,
    ribboned: ribbonedOf(foeRoot),
    cost: foeCost,
    foeLevel: levelOf(foe),
    party,
  };
}

/**
 * The current party by STARTER (root) species — cost, ribbon, carry flag — indexed by SLOT. Used
 * by Part B to choose which passenger to release when a full-party catch needs room. Defensive.
 */
export function readPartyValue(): PartyMon[] {
  let scene: any;
  try {
    scene = getScene();
  } catch {
    return [];
  }
  const gd: any = scene?.gameData;
  if (!gd?.dexData || typeof gd.getSpeciesStarterValue !== "function") return [];

  const out: PartyMon[] = [];
  for (const p of scene.getPlayerParty?.() ?? []) {
    let id: number | null = null;
    try {
      const r = p?.species?.getRootSpeciesId?.();
      if (typeof r === "number") id = r;
    } catch {
      /* version drift */
    }
    if (id == null) continue;
    let cost: number | null = null;
    try {
      const c = gd.getSpeciesStarterValue(id);
      if (Number.isFinite(c)) cost = c;
    } catch {
      /* version drift */
    }
    if (cost == null) continue;
    const lvl = typeof p?.level === "number" && Number.isFinite(p.level) ? p.level : null;
    out.push({ ribboned: (readRibbons(gd.dexData[id]) & CLASSIC_RIBBON) !== 0n, cost, isCarry: id in CARRY_RANK, level: lvl });
  }
  return out;
}
