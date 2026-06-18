// ── Roster reader ────────────────────────────────────────────────────────────
// Reads the player's owned starters — effective cost, Classic-ribbon status, carry rank —
// from the live gameData into the pure StarterInfo[] that team.ts consumes. Version-fragile
// (it touches gameData internals), so it's defensive: anything unreadable is skipped, never
// thrown. Selectable starters are exactly the keys of gameData.starterData that are owned
// (dexData[id].caughtAttr set).

import { getScene } from "./bridge";
import { CARRY_RANK, type StarterInfo } from "./team";
import type { CandyStarter } from "./candy";
import type { CatchContext } from "./catch";

/** RibbonData.CLASSIC (src/system/ribbons/ribbon-data.ts) — the bit a Classic clear awards. */
export const CLASSIC_RIBBON = 0x0008000000n;

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
  const gd: any = getScene()?.gameData;
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
    party.push({ ribboned: ribbonedOf(id), cost, isCarry: id in CARRY_RANK });
  }

  return { caught: !!gd.dexData[foeRoot]?.caughtAttr, ribboned: ribbonedOf(foeRoot), cost: foeCost, party };
}
