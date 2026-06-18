import { describe, it, expect } from "vitest";
import { scoreReward, bestRewardIndex, REWARD_PRIORITY, type RewardOption } from "../src/rewards";

const opt = (o: Partial<RewardOption>): RewardOption => ({ id: null, tier: null, isTm: false, ...o });

describe("reward scoring", () => {
  it("ranks survival staples above progression above consumables above junk", () => {
    const reviver = scoreReward(opt({ id: "REVIVER_SEED" }));
    const leftovers = scoreReward(opt({ id: "LEFTOVERS" }));
    const expCharm = scoreReward(opt({ id: "EXP_CHARM" }));
    const potion = scoreReward(opt({ id: "POTION" }));
    const tm = scoreReward(opt({ isTm: true }));
    expect(reviver).toBeGreaterThan(leftovers);
    expect(leftovers).toBeGreaterThan(expCharm);
    expect(expCharm).toBeGreaterThan(potion);
    expect(potion).toBeGreaterThan(tm);
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

  it("picks the highest-scoring option's index", () => {
    const options = [opt({ id: "POTION" }), opt({ id: "REVIVER_SEED" }), opt({ id: "TM_COMMON" })];
    expect(bestRewardIndex(options)).toEqual({ index: 1, score: REWARD_PRIORITY.REVIVER_SEED });
  });

  it("reports a negative best when every option is harmful", () => {
    const res = bestRewardIndex([opt({ id: "TOXIC_ORB" }), opt({ id: "FLAME_ORB" })]);
    expect(res!.score).toBeLessThan(0);
  });
});
