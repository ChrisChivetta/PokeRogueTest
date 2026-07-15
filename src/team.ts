// ── Team selection (Phase 3 orchestration brain) ─────────────────────────────
// Picks the 6-mon Classic team for the next run to ribbon as many NEW species as possible
// per clear, within the starter point budget (10). Strategy (docs/research-strategy.md):
//   1 strong CARRY (so the run actually clears) + the cheapest UN-RIBBONED passengers that fit,
// because one Classic clear ribbons every eligible mon on the final party at once — so each
// run should carry as many un-ribboned lines to wave 200 as the budget allows.
//
// This module is PURE: it takes already-read starter info and returns a plan. Reading the live
// roster (costs/ribbons/ownership) from gameData lives in roster.ts; driving the starter-select
// UI is a later slice. Keeping the optimiser pure makes it exhaustively unit-testable.

export interface StarterInfo {
  speciesId: number;
  /** Effective starter cost AFTER candy value-reduction (gameData.getSpeciesStarterValue). */
  cost: number;
  /** Already holds the Classic ribbon — riding it again earns nothing new. */
  ribboned: boolean;
  /** Carry priority: null = not a viable carry; otherwise lower = stronger pick. */
  carryRank: number | null;
  /**
   * The species' base type name(s), lowercased (e.g. ["fire"], ["grass","poison"]). Used to
   * DIVERSIFY the bench so the team isn't three of the same type (the carry is the only mon that
   * fights, but a same-type bench gives no coverage when it faints and a passenger must lead).
   * Defaults to [] when unreadable — selection then degrades gracefully to pure cheapest-first.
   */
  types?: string[];
}

export interface TeamPlan {
  carry: StarterInfo | null;
  passengers: StarterInfo[];
  /** carry + passengers, in selection order. */
  team: StarterInfo[];
  totalCost: number;
  /** How many team members are un-ribboned — i.e. fresh ribbons this run would award. */
  newRibbons: number;
}

export interface TeamOptions {
  /** Starter point budget (Classic default is 10). */
  budget: number;
  /** Max team size (6). */
  teamSize: number;
  /** Use leftover budget/slots on already-ribboned bodies for resilience (no ribbon gain). */
  fillWithRibboned: boolean;
}

const DEFAULTS: TeamOptions = { budget: 10, teamSize: 6, fillWithRibboned: true };

/**
 * Carry shortlist → priority (lower = stronger). Keyed by the ROOT/base starter SpeciesId you
 * actually select (it evolves into the carry during the run). These are strong WITHOUT egg
 * moves (base kits carry them). Tunable heuristic; the selector always prefers the cheapest
 * OWNED carry, so a cost-reduced one wins.
 */
export const CARRY_RANK: Record<number, number> = {
  909: 0, // Fuecoco → Skeledirge (Torch Song) — top budget pick
  932: 1, // Nacli → Garganacl (Salt Cure + Purifying Salt) — near-unkillable
  215: 2, // Sneasel → Sneasler (Dire Claw) — status spam
  1: 3, //   Bulbasaur → Venusaur (Leech Seed) — canonical Eternatus counter
  924: 4, // Tandemaus → Maushold (Skill Link + Multi-Lens) — nuke
};

/** Cheapest-first; stable tie-breaks so selection is deterministic. */
function byCheapest(a: StarterInfo, b: StarterInfo): number {
  return a.cost - b.cost || (a.carryRank ?? 99) - (b.carryRank ?? 99) || a.speciesId - b.speciesId;
}

/** Lowercased base types of a starter (empty if unread). */
const typesOf = (s: StarterInfo): string[] => s.types ?? [];

/** True if `s` shares a type with anyone already on `team` — i.e. it adds no new coverage. */
function sharesTypeWith(s: StarterInfo, team: StarterInfo[]): boolean {
  const have = new Set(team.flatMap(typesOf));
  return typesOf(s).some((t) => have.has(t));
}

/**
 * From the cheapest tranche of `candidates`, pick the one that best DIVERSIFIES the team's types
 * (prefers a body sharing no type with the current team), tie-broken by the normal cheapest order.
 * PURE. `candidates` must already be byCheapest-sorted. Returns undefined if none are eligible.
 * Only looks within the cheapest cost bucket so diversity never overrides the budget-packing goal.
 */
function pickDiverse(candidates: StarterInfo[], team: StarterInfo[]): StarterInfo | undefined {
  if (!candidates.length) return undefined;
  const minCost = candidates[0].cost;
  const tranche = candidates.filter((s) => s.cost <= minCost + 1e-9);
  return tranche.find((s) => !sharesTypeWith(s, team)) ?? tranche[0];
}

/**
 * Choose the team. Greedy and optimal for the objective "maximise un-ribboned bodies under
 * budget": a strong carry first, then cheapest un-ribboned passengers (cheapest-first packs the
 * most bodies), then — if enabled and room remains — cheapest leftover bodies for resilience.
 */
export function selectTeam(owned: StarterInfo[], options: Partial<TeamOptions> = {}): TeamPlan {
  const opts = { ...DEFAULTS, ...options };
  const empty: TeamPlan = { carry: null, passengers: [], team: [], totalCost: 0, newRibbons: 0 };
  if (!owned.length) return empty;

  // Carry: cheapest owned shortlist carry; tie-break prefers un-ribboned then better rank.
  // Fall back to the cheapest owned mon as a lead if we own no shortlisted carry at all.
  const carries = owned
    .filter((s) => s.carryRank != null)
    .sort((a, b) => a.cost - b.cost || Number(a.ribboned) - Number(b.ribboned) || a.carryRank! - b.carryRank!);
  const carry = carries[0] ?? [...owned].sort(byCheapest)[0];
  if (!carry) return empty;

  const team: StarterInfo[] = [carry];
  let spent = carry.cost;
  const fits = (s: StarterInfo) => spent + s.cost <= opts.budget + 1e-9 && team.length < opts.teamSize;

  const rest = owned.filter((s) => s.speciesId !== carry.speciesId).sort(byCheapest);
  const chosen = new Set<number>();

  // Greedily fill from a pool: each step take the cheapest body that fits, breaking cost-ties toward
  // TYPE DIVERSITY (pickDiverse) so the bench isn't three of the same type. Picking from the cheapest
  // tranche keeps the budget-packing ("most bodies per budget") behaviour identical when types tie or
  // are unread — it only reorders equal-cost candidates. Re-evaluates after each pick so "diverse"
  // is measured against the team built so far.
  const fillFrom = (pool: StarterInfo[]): void => {
    let avail = pool.filter((s) => !chosen.has(s.speciesId) && fits(s));
    while (avail.length) {
      const pick = pickDiverse(avail, team);
      if (!pick) break;
      team.push(pick);
      spent += pick.cost;
      chosen.add(pick.speciesId);
      avail = pool.filter((s) => !chosen.has(s.speciesId) && fits(s));
    }
  };

  // 1) un-ribboned passengers (the ribbon-earning slots), cheapest-first with diversity tie-break
  fillFrom(rest.filter((s) => !s.ribboned));
  // 2) optional filler: remaining bodies for a more resilient run (no ribbon gain)
  if (opts.fillWithRibboned) fillFrom(rest);

  const passengers = team.slice(1);
  return {
    carry,
    passengers,
    team,
    totalCost: Number(spent.toFixed(4)),
    newRibbons: team.filter((s) => !s.ribboned).length,
  };
}
