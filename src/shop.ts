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
  cost: number;
  rowCursor: number;
  cursorIndex: number;
}

/**
 * Pick the next heal to BUY, or null. PURE. Revive fainted mons first, then top up any live mon
 * below the HP threshold; cheapest affordable option of that kind. Buys one at a time — after it's
 * applied the party state changes and we re-decide, so this naturally stops when nobody needs it.
 */
export function planShopBuy(party: GameSnapshot["playerParty"], money: number, heals: ShopHeal[]): ShopHeal | null {
  if (!config.buyHealsWithMoney) return null;
  const cheapest = (kind: "revive" | "heal"): ShopHeal | null =>
    heals.filter((h) => h.kind === kind && h.cost <= money).sort((a, b) => a.cost - b.cost)[0] ?? null;

  if (party.some((p) => p.fainted)) {
    const revive = cheapest("revive");
    if (revive) return revive;
  }
  if (party.some((p) => !p.fainted && (p.hpRatio ?? 1) < config.healHpThreshold)) {
    const heal = cheapest("heal");
    if (heal) return heal;
  }
  return null;
}
