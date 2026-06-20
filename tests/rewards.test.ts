import { describe, it, expect } from "vitest";
import { scoreReward, bestRewardIndex, REWARD_PRIORITY, type RewardOption } from "../src/rewards";

const opt = (o: Partial<RewardOption>): RewardOption => ({ id: null, tier: null, isTm: false, ...o });

describe("reward scoring", () => {
  it("ranks heals above survival staples above progression above junk", () => {
    const potion = scoreReward(opt({ id: "POTION" }));
    const reviver = scoreReward(opt({ id: "REVIVER_SEED" }));
    const leftovers = scoreReward(opt({ id: "LEFTOVERS" }));
    const expCharm = scoreReward(opt({ id: "EXP_CHARM" }));
    const tm = scoreReward(opt({ isTm: true }));
    // Heals now top the table (staying alive clears waves) — even a plain Potion beats held items.
    expect(potion).toBeGreaterThan(reviver);
    expect(reviver).toBeGreaterThan(leftovers);
    expect(leftovers).toBeGreaterThan(expCharm);
    expect(expCharm).toBeGreaterThan(tm);
  });

  it("ranks revives at the very top, with stronger heals above weaker ones", () => {
    const sacredAsh = scoreReward(opt({ id: "SACRED_ASH" }));
    const maxRevive = scoreReward(opt({ id: "MAX_REVIVE" }));
    const revive = scoreReward(opt({ id: "REVIVE" }));
    const fullRestore = scoreReward(opt({ id: "FULL_RESTORE" }));
    const potion = scoreReward(opt({ id: "POTION" }));
    const reviver = scoreReward(opt({ id: "REVIVER_SEED" }));
    // Revives beat every other reward, including the best held items.
    expect(revive).toBeGreaterThan(reviver);
    // Whole-party > single-target revive > strong heal, and strong > weak heal.
    expect(sacredAsh).toBeGreaterThan(maxRevive);
    expect(maxRevive).toBeGreaterThan(revive);
    expect(revive).toBeGreaterThan(fullRestore);
    expect(fullRestore).toBeGreaterThan(potion);
  });

  it("demotes lures below TMs (double-battle chance hurts the catch goal)", () => {
    const tm = scoreReward(opt({ isTm: true }));
    for (const id of ["LURE", "SUPER_LURE", "MAX_LURE"]) {
      const lure = scoreReward(opt({ id }));
      expect(lure).toBeLessThan(tm);
      expect(lure).toBeGreaterThan(0); // still positive so it doesn't trip the whole-reward skip
    }
  });

  it("demotes rare candies below TMs (don't help clear waves)", () => {
    const tm = scoreReward(opt({ isTm: true }));
    expect(scoreReward(opt({ id: "RARE_CANDY" }))).toBeLessThan(tm);
    expect(scoreReward(opt({ id: "RARER_CANDY" }))).toBeLessThan(tm);
    // …but never preferred over a real heal or held item.
    expect(scoreReward(opt({ id: "RARE_CANDY" }))).toBeLessThan(scoreReward(opt({ id: "POTION" })));
  });

  it("scores status orbs negative (would rather skip than self-inflict)", () => {
    expect(scoreReward(opt({ id: "TOXIC_ORB" }))).toBeLessThan(0);
    expect(scoreReward(opt({ id: "FLAME_ORB" }))).toBeLessThan(0);
  });

  it("treats generated (idless) TMs as low value", () => {
    expect(scoreReward(opt({ id: null, isTm: true, tier: 2 }))).toBeLessThan(scoreReward(opt({ id: "POTION" })));
  });

  it("falls back to a tier-based score for unlisted items (higher tier ranks higher)", () => {
    const common = scoreReward(opt({ id: "SOME_UNKNOWN_ITEM", tier: 0 }));
    const rogue = scoreReward(opt({ id: "ANOTHER_UNKNOWN", tier: 3 }));
    expect(rogue).toBeGreaterThan(common);
    // …but an unlisted item never outranks a known survival staple.
    expect(rogue).toBeLessThan(REWARD_PRIORITY.REVIVER_SEED);
  });
});

describe("bestRewardIndex", () => {
  it("returns null for an empty/unreadable row", () => {
    expect(bestRewardIndex([])).toBeNull();
  });

  it("picks the highest-scoring option's index (a heal beats a held item)", () => {
    const options = [opt({ id: "REVIVER_SEED" }), opt({ id: "MAX_REVIVE" }), opt({ id: "TM_COMMON" })];
    expect(bestRewardIndex(options)).toEqual({ index: 1, score: REWARD_PRIORITY.MAX_REVIVE });
  });

  it("prefers a revive over a candy or lure when both are offered", () => {
    const options = [opt({ id: "RARE_CANDY" }), opt({ id: "SUPER_LURE" }), opt({ id: "REVIVE" })];
    expect(bestRewardIndex(options)!.index).toBe(2);
  });

  it("reports a negative best when every option is harmful", () => {
    const res = bestRewardIndex([opt({ id: "TOXIC_ORB" }), opt({ id: "FLAME_ORB" })]);
    expect(res!.score).toBeLessThan(0);
  });
});
