// ── Roster reader ────────────────────────────────────────────────────────────
// Reads the player's owned starters — effective cost, Classic-ribbon status, carry rank —
// from the live gameData into the pure StarterInfo[] that team.ts consumes. Version-fragile
// (it touches gameData internals), so it's defensive: anything unreadable is skipped, never
// thrown. Selectable starters are exactly the keys of gameData.starterData that are owned
// (dexData[id].caughtAttr set).

import { getScene } from "./bridge";
import { CARRY_RANK, type StarterInfo } from "./team";

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
