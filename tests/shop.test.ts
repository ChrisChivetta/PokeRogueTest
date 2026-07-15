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

  it("buys the STRONGEST affordable heal when a mon is critically hurt (< 0.33)", () => {
    // A single POTION barely dents a deeply-hurt carry, so step up to the strongest affordable.
    const shelf = [
      heal({ id: "POTION", cost: 50 }),
      heal({ id: "HYPER_POTION", cost: 100, cursorIndex: 1 }),
      heal({ id: "FULL_RESTORE", cost: 200, cursorIndex: 2 }),
    ];
    const r = planShopBuy([mon({ hpRatio: 0.2 })], 999, shelf);
    expect(r?.id).toBe("FULL_RESTORE");
  });

  it("steps up only as far as money allows when critically hurt", () => {
    const shelf = [
      heal({ id: "POTION", cost: 50 }),
      heal({ id: "HYPER_POTION", cost: 100, cursorIndex: 1 }),
      heal({ id: "FULL_RESTORE", cost: 200, cursorIndex: 2 }),
    ];
    const r = planShopBuy([mon({ hpRatio: 0.2 })], 120, shelf); // can't afford FULL_RESTORE
    expect(r?.id).toBe("HYPER_POTION");
  });

  it("buys the CHEAPEST heal for a light top-up (hurt but not critical)", () => {
    config.healHpThreshold = 0.66;
    const shelf = [
      heal({ id: "POTION", cost: 50 }),
      heal({ id: "FULL_RESTORE", cost: 200, cursorIndex: 1 }),
    ];
    const r = planShopBuy([mon({ hpRatio: 0.5 })], 999, shelf); // below 0.66 but above 0.33
    expect(r?.id).toBe("POTION");
  });

  it("still revives first even when another mon is critically hurt", () => {
    const shelf = [heal({ kind: "revive", id: "REVIVE", cost: 300 }), heal({ id: "FULL_RESTORE", cost: 200, cursorIndex: 1 })];
    const r = planShopBuy([mon({ fainted: true }), mon({ hpRatio: 0.1 })], 999, shelf);
    expect(r?.kind).toBe("revive");
  });
});

describe("planShopBuy pre-rival prep", () => {
  // Pre-rival: enter the deterministic scripted rival at FULL strength — revive every body, then
  // heal ANYONE below 100% (not just below the normal threshold) with the STRONGEST affordable heal.

  it("heals a mon that the NORMAL threshold would leave alone (just below full)", () => {
    // 0.9 is above healHpThreshold (0.5) → normal mode buys nothing; pre-rival tops it off.
    const shelf = [heal({ id: "POTION", cost: 50 })];
    expect(planShopBuy([mon({ hpRatio: 0.9 })], 999, shelf, false)).toBeNull();
    expect(planShopBuy([mon({ hpRatio: 0.9 })], 999, shelf, true)?.kind).toBe("heal");
  });

  it("buys the STRONGEST affordable heal even for a light top-off", () => {
    const shelf = [
      heal({ id: "POTION", cost: 50 }),
      heal({ id: "HYPER_POTION", cost: 100, cursorIndex: 1 }),
      heal({ id: "FULL_RESTORE", cost: 200, cursorIndex: 2 }),
    ];
    // Only lightly hurt (0.8), but pre-rival still steps up to the strongest it can afford.
    expect(planShopBuy([mon({ hpRatio: 0.8 })], 999, shelf, true)?.id).toBe("FULL_RESTORE");
  });

  it("still revives fainted bodies before topping up", () => {
    const shelf = [heal({ kind: "revive", id: "REVIVE", cost: 300 }), heal({ id: "FULL_RESTORE", cost: 200, cursorIndex: 1 })];
    const r = planShopBuy([mon({ fainted: true }), mon({ hpRatio: 0.9 })], 999, shelf, true);
    expect(r?.kind).toBe("revive");
  });

  it("is still money-bounded (steps down to the affordable heal)", () => {
    const shelf = [
      heal({ id: "POTION", cost: 50 }),
      heal({ id: "FULL_RESTORE", cost: 200, cursorIndex: 1 }),
    ];
    expect(planShopBuy([mon({ hpRatio: 0.9 })], 120, shelf, true)?.id).toBe("POTION");
  });

  it("buys nothing when the party is already at full HP", () => {
    expect(planShopBuy([mon({ hpRatio: 1 })], 999, [heal()], true)).toBeNull();
  });
});
