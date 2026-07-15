// ── Candy routing ────────────────────────────────────────────────────────────
// Each starter earns its OWN candy (faints, catches, friendship, shinies). Spending a species'
// candy to REDUCE ITS COST is the highest-value use for the ribbon objective: every point
// shaved off a carry frees budget for one more un-ribboned passenger every future run. So the
// plan recommends each affordable value-reduction, carries first.
//
// Two reductions max per species. The candy cost of the next reduction depends on the species'
// BASE (unreduced) cost — table copied verbatim from data/balance/starters.ts (allStarterCandyCosts
// .costReduction, indexed by base cost 1..10). Applying a reduction is a starter-select-screen
// action (a later UI slice); this module only decides.

export const MAX_VALUE_REDUCTION = 2;

export interface CandyStarter {
  speciesId: number;
  /** Unreduced point cost (1..10) — indexes the candy table. */
  baseCost: number;
  candyCount: number;
  /** Reductions already applied (0..2). */
  valueReduction: number;
  /** Carries are prioritised (they're in every run). */
  isCarry: boolean;
}

export interface CandyAction {
  speciesId: number;
  spend: number;
  fromReduction: number;
  toReduction: number;
}

/** costReduction[baseCost] = [candy for 1st reduction, candy for 2nd], from data/balance/starters.ts. */
export const VALUE_REDUCTION_CANDY: Record<number, readonly [number, number]> = {
  1: [25, 60],
  2: [25, 60],
  3: [20, 50],
  4: [15, 40],
  5: [12, 35],
  6: [10, 30],
  7: [8, 20],
  8: [5, 15],
  9: [5, 15],
  10: [5, 15],
};

/** Candy needed for the NEXT reduction at this state, or null if maxed/unknown. */
export function nextReductionCost(baseCost: number, valueReduction: number): number | null {
  if (valueReduction >= MAX_VALUE_REDUCTION) return null;
  const row = VALUE_REDUCTION_CANDY[baseCost];
  return row ? row[valueReduction] : null;
}

/**
 * Recommend the value-reductions to apply now — carries first, then by id for determinism.
 * Each species spends only its own candy, so reductions are independent; we greedily take every
 * one a species can currently afford (each shaved point compounds over future runs).
 */
export function planCandy(starters: CandyStarter[]): CandyAction[] {
  const order = [...starters].sort(
    (a, b) => Number(b.isCarry) - Number(a.isCarry) || a.speciesId - b.speciesId,
  );

  const actions: CandyAction[] = [];
  for (const s of order) {
    let vr = s.valueReduction;
    let candy = s.candyCount;
    while (vr < MAX_VALUE_REDUCTION) {
      const cost = nextReductionCost(s.baseCost, vr);
      if (cost == null || candy < cost) break;
      candy -= cost;
      actions.push({ speciesId: s.speciesId, spend: cost, fromReduction: vr, toReduction: vr + 1 });
      vr++;
    }
  }
  return actions;
}
