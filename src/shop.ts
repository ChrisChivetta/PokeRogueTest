// ── Shop / money healing ─────────────────────────────────────────────────────
// The post-wave reward screen also has a SHOP (rowCursor ≥ 2) of items you BUY with money. To
// survive deeper we spend money on heals: revive fainted mons first, then top up hurt ones.
// The PURE decision (planShopBuy) is testable; reading the live shop + driving the navigation
// lives in policy.ts (and needs live validation). Buying a consumable opens the PARTY target
// screen, so it reuses the same revive/heal targeting as a free reward.

import { config } from "./config";
import type { GameSnapshot } from "./state";

/** ModifierType.id registry keys (modifier/modifier-type.ts), shared with reward-apply targeting. */
export const REVIVE_IDS = new Set(["REVIVE", "MAX_REVIVE"]); // SACRED_ASH = whole-party (no target)
export const HEAL_IDS = new Set(["POTION", "SUPER_POTION", "HYPER_POTION", "MAX_POTION", "FULL_RESTORE"]);

/**
 * Heal POTENCY rank (higher = restores more HP), by id. Used to pick a STRONGER heal when a mon is
 * critically low — a single POTION (~20 HP) is wasted on a deeply-hurt high-HP carry, so we step up
 * to a Hyper/Max Potion if one is affordable. Unranked heal ids default to 0 (weakest).
 */
const HEAL_POTENCY: Record<string, number> = {
  POTION: 1,
  SUPER_POTION: 2,
  HYPER_POTION: 3,
  MAX_POTION: 4,
  FULL_RESTORE: 5,
};

/** Below this HP fraction a live mon is "critically" hurt — spend on the strongest heal we can. */
export const CRITICAL_HP_FRACTION = 0.33;

export type ApplyKind = "revive" | "heal" | null;

/** Classify a modifier id as the kind of PARTY target it needs (or null if it isn't a heal). */
export function applyKind(id: string | null | undefined): ApplyKind {
  if (id && REVIVE_IDS.has(id)) return "revive";
  if (id && HEAL_IDS.has(id)) return "heal";
  return null;
}

/** A buyable heal in the shop, with where it sits in the grid (rowCursor / cursor). */
export interface ShopHeal {
  kind: "revive" | "heal";
  /** Registry id (e.g. "HYPER_POTION") — drives potency-aware selection. Null if unread. */
  id?: string | null;
  cost: number;
  rowCursor: number;
  cursorIndex: number;
}

/**
 * Pick the next heal to BUY, or null. PURE. Revive fainted mons first, then top up any live mon
 * below the HP threshold. Buys one at a time — after it's applied the party state changes and we
 * re-decide, so this naturally stops when nobody needs it.
 *
 * Heal selection is NEED-AWARE: if any live mon is CRITICALLY low (< CRITICAL_HP_FRACTION) we buy
 * the STRONGEST affordable heal (a single Potion barely dents a deeply-hurt high-HP carry, wasting
 * the turn); otherwise the cheapest affordable heal is fine for a light top-up. Revives always take
 * the cheapest affordable option (a revive's job is just to bring the body back).
 */
export function planShopBuy(party: GameSnapshot["playerParty"], money: number, heals: ShopHeal[]): ShopHeal | null {
  if (!config.buyHealsWithMoney) return null;
  const affordable = (kind: "revive" | "heal") => heals.filter((h) => h.kind === kind && h.cost <= money);
  const cheapest = (kind: "revive" | "heal"): ShopHeal | null =>
    affordable(kind).sort((a, b) => a.cost - b.cost)[0] ?? null;
  const potency = (h: ShopHeal) => HEAL_POTENCY[h.id ?? ""] ?? 0;

  if (party.some((p) => p.fainted)) {
    const revive = cheapest("revive");
    if (revive) return revive;
  }
  if (party.some((p) => !p.fainted && (p.hpRatio ?? 1) < config.healHpThreshold)) {
    const critical = party.some((p) => !p.fainted && (p.hpRatio ?? 1) < CRITICAL_HP_FRACTION);
    const heals2 = affordable("heal");
    if (heals2.length) {
      // Critically hurt → strongest affordable (potency, then cheaper as a tie-break). Otherwise cheapest.
      return critical
        ? heals2.sort((a, b) => potency(b) - potency(a) || a.cost - b.cost)[0]
        : heals2.sort((a, b) => a.cost - b.cost)[0];
    }
  }
  return null;
}
