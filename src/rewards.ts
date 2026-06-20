// ── Reward priority (the modifier-select policy) ─────────────────────────────
// After each wave the game offers a row of FREE modifier choices. We pick the one most
// valuable to FINISHING a run, by a curated priority over the modifier-type registry id
// (`ModifierType.id`, e.g. "REVIVER_SEED"). Philosophy, survival-first:
//   1. HEALS & REVIVES — keeping the carry (and the bench) alive is what actually clears waves,
//      so revives rank highest, then full/strong heals, then weaker potions and berries.
//   2. permanent passive survival held items (Reviver Seed, Leftovers, Shell Bell, Focus Band)
//   3. permanent offense/utility held items that help the carry close games
//   4. permanent progression (EXP charms, Amulet Coin, Healing Charm)
//   5. low: move-altering / candy-farming utility (TMs, Memory Mushroom, Soothe Bell),
//      level candies, and LURES (only raise double-battle chance — a 2-foe field also blocks
//      catching, so they actively work against us).
//   6. NEGATIVE: items that hurt a generic carry if auto-applied (status orbs) → skip instead
// Anything not listed falls back to a modest tier-based score, so a good unlisted item still
// beats junk but never outranks the heals/survival staples above.

/** A single offered reward, distilled from the live ModifierOption for scoring. */
export interface RewardOption {
  /** ModifierType.id registry key (e.g. "LEFTOVERS"); null/"" for generated types (TMs). */
  id: string | null;
  /** ModifierTier (COMMON=0 … LUXURY=5); used as a fallback score when id is unlisted. */
  tier: number | null;
  /** True for TMs (generated, idless) — low value and they need a move-teach we avoid. */
  isTm: boolean;
}

export const REWARD_PRIORITY: Record<string, number> = {
  // 1 — HEALS & REVIVES (top priority: staying alive is what clears waves)
  // Revives first — a fainted carry loses the run; SACRED_ASH revives the WHOLE party.
  SACRED_ASH: 150,
  MAX_REVIVE: 145,
  REVIVE: 140,
  // Then strong→weak heals; berries last of the heal tier (one-shot, situational).
  FULL_RESTORE: 135,
  MAX_POTION: 130,
  HYPER_POTION: 125,
  SUPER_POTION: 120,
  POTION: 115,
  BERRY: 110,
  // 2 — permanent passive survival held items
  REVIVER_SEED: 100,
  LEFTOVERS: 92,
  SHELL_BELL: 88,
  FOCUS_BAND: 85,
  // 3 — permanent offense / utility held items
  MINI_BLACK_HOLE: 82,
  MULTI_LENS: 80,
  GOLDEN_PUNCH: 41,
  KINGS_ROCK: 70,
  SCOPE_LENS: 68,
  GRIP_CLAW: 66,
  QUICK_CLAW: 64,
  WIDE_LENS: 60,
  // 4 — permanent progression / economy
  GOLDEN_EXP_CHARM: 77,
  SUPER_EXP_CHARM: 74,
  HEALING_CHARM: 72,
  EXP_CHARM: 58,
  GOLDEN_EGG: 56,
  LUCKY_EGG: 54,
  AMULET_COIN: 52,
  BERRY_POUCH: 50,
  EXP_SHARE: 48,
  EXP_BALANCE: 20,
  // 5 — low value / move-altering / candy farming
  SOOTHE_BELL: 34,
  MEMORY_MUSHROOM: 6,
  TM_COMMON: 4,
  TM_GREAT: 4,
  TM_ULTRA: 4,
  // Level candies don't help clear waves (the carry already out-levels the curve), and LURES only
  // raise the double-battle chance — a 2-foe field also blocks catching, so they actively work
  // against the ribbon goal. Rank them dead last — below TMs — so we only ever take one when it's
  // the ONLY thing offered, never over a heal, held item, or TM. Kept just above 0 so they don't
  // trip the "skip whole reward" (negative-score) path: a free junk item still beats taking nothing.
  RARER_CANDY: 2,
  RARE_CANDY: 2,
  MAX_LURE: 3,
  SUPER_LURE: 3,
  LURE: 3,
  // 6 — harmful to a generic carry if auto-applied → negative so we skip the whole reward
  TOXIC_ORB: -10,
  FLAME_ORB: -10,
};

/** Fallback score by ModifierTier for items not in the table (COMMON … LUXURY). */
const TIER_FALLBACK = [18, 24, 30, 38, 46, 34];

/** Score a single offered reward (higher = better; negative = would rather skip it). */
export function scoreReward(o: RewardOption): number {
  if (o.isTm) return 4; // generated TMs are idless; rank them with the listed TMs
  if (o.id && o.id in REWARD_PRIORITY) return REWARD_PRIORITY[o.id];
  const t = o.tier;
  return t != null && t >= 0 && t < TIER_FALLBACK.length ? TIER_FALLBACK[t] : 20;
}

/**
 * The best reward to take from the offered row: its index and score. null if the row is
 * empty/unreadable (caller should then just take whatever's highlighted). A negative score
 * means every option is harmful — the caller should skip the reward entirely.
 */
export function bestRewardIndex(options: RewardOption[]): { index: number; score: number } | null {
  if (!options.length) return null;
  let index = 0;
  let score = Number.NEGATIVE_INFINITY;
  options.forEach((o, i) => {
    const sc = scoreReward(o);
    if (sc > score) {
      score = sc;
      index = i;
    }
  });
  return { index, score };
}
