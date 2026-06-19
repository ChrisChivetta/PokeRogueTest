import { describe, it, expect, beforeEach } from "vitest";
import { planShopBuy, applyKind, type ShopHeal } from "../src/shop";
import { config } from "../src/config";

const heal = (o: Partial<ShopHeal> = {}): ShopHeal => ({ kind: "heal", cost: 100, rowCursor: 2, cursorIndex: 0, ...o });
const mon = (o: any = {}) => ({ name: "p", fainted: false, hpRatio: 1, onField: false, types: [], moves: [], ...o });

beforeEach(() => { config.buyHealsWithMoney = true; config.healHpThreshold = 0.5; });

describe("applyKind", () => {
  it("classifies revives, heals, and everything else", () => {
    expect(applyKind("REVIVE")).toBe("revive");
    expect(applyKind("MAX_REVIVE")).toBe("revive");
    expect(applyKind("MAX_POTION")).toBe("heal");
    expect(applyKind("FULL_RESTORE")).toBe("heal");
    expect(applyKind("LEFTOVERS")).toBe(null);
    expect(applyKind(null)).toBe(null);
  });
});

describe("planShopBuy", () => {
  it("buys a revive when a mon is fainted (over a heal)", () => {
    const r = planShopBuy([mon({ fainted: true })], 999, [heal({ kind: "heal", cost: 50 }), heal({ kind: "revive", cost: 300 })]);
    expect(r?.kind).toBe("revive");
  });

  it("buys the cheapest affordable option of the needed kind", () => {
    const r = planShopBuy([mon({ fainted: true })], 999,
      [heal({ kind: "revive", cost: 300 }), heal({ kind: "revive", cost: 100, cursorIndex: 1 })]);
    expect(r?.cost).toBe(100);
  });

  it("heals a hurt mon when nobody's fainted", () => {
    expect(planShopBuy([mon({ hpRatio: 0.3 })], 999, [heal({ kind: "heal" })])?.kind).toBe("heal");
  });

  it("does nothing when the party is healthy", () => {
    expect(planShopBuy([mon({ hpRatio: 1 })], 999, [heal()])).toBeNull();
  });

  it("won't buy what it can't afford", () => {
    expect(planShopBuy([mon({ fainted: true })], 50, [heal({ kind: "revive", cost: 300 })])).toBeNull();
  });

  it("respects the hurt threshold (strictly below)", () => {
    expect(planShopBuy([mon({ hpRatio: 0.5 })], 999, [heal()])).toBeNull();
    expect(planShopBuy([mon({ hpRatio: 0.49 })], 999, [heal()])?.kind).toBe("heal");
  });

  it("is disabled by config", () => {
    config.buyHealsWithMoney = false;
    expect(planShopBuy([mon({ fainted: true })], 999, [heal({ kind: "revive" })])).toBeNull();
  });
});
