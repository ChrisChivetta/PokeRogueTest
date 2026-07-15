import { describe, it, expect, beforeEach } from "vitest";
import { shouldCatch, shouldSoftenBeforeCatch, noteSoftenTurn, pickBall, noteCatchAttempt, resetCatch, PokeballType, worthCatching, pickReleaseSlot } from "../src/catch";
import type { CatchContext } from "../src/catch";
import { config } from "../src/config";
import type { GameSnapshot } from "../src/state";

const foe = (o: any = {}) => ({
  name: "foe", speciesId: 25, fainted: false, hpRatio: 1, onField: true, types: [], moves: [],
  isBoss: false, bossSegmentIndex: null, speciesCaught: false, ...o,
});

// A wild battle on a normal wave with a single un-caught foe and a full bag, by default.
const s = (o: any = {}): GameSnapshot => ({
  ready: true, uiMode: "COMMAND", uiModeNumber: 2, cursor: 0, awaitingActionInput: false,
  battle: { waveIndex: 5, turn: 1, double: false, battleType: 0, isBossWave: false, isTrainer: false },
  playerParty: [], enemyParty: [foe()], biomeId: null, money: null,
  pokeballCounts: [5, 5, 5, 5, 1],
  ...o,
} as GameSnapshot);

beforeEach(() => {
  resetCatch();
  config.catchNewSpecies = true;
  config.catchAttemptsPerTarget = 3;
  config.softenBeforeCatch = true;
  config.catchHpThreshold = 0.35;
  config.catchSoftenTurns = 2;
});

describe("catch — when to throw", () => {
  it("throws at a NEW wild species", () => {
    expect(shouldCatch(s())).toBe(true);
  });

  it("skips an already-caught species", () => {
    expect(shouldCatch(s({ enemyParty: [foe({ speciesCaught: true })] }))).toBe(false);
  });

  it("skips when the dex status is unknown (null)", () => {
    expect(shouldCatch(s({ enemyParty: [foe({ speciesCaught: null })] }))).toBe(false);
  });

  it("never throws at trainers", () => {
    expect(shouldCatch(s({ battle: { waveIndex: 5, isTrainer: true } }))).toBe(false);
  });

  it("stops catching in the End Biome (wave 191+)", () => {
    expect(shouldCatch(s({ battle: { waveIndex: 191, isTrainer: false } }))).toBe(false);
  });

  it("skips doubles / multi-foe (the ball is blocked as multi-target)", () => {
    expect(shouldCatch(s({ enemyParty: [foe(), foe({ name: "foe2" })] }))).toBe(false);
  });

  it("won't throw a normal ball at a boss above its last segment", () => {
    expect(shouldCatch(s({ enemyParty: [foe({ isBoss: true, bossSegmentIndex: 2 })] }))).toBe(false);
  });

  it("throws at a boss ON its last segment", () => {
    expect(shouldCatch(s({ enemyParty: [foe({ isBoss: true, bossSegmentIndex: 0 })] }))).toBe(true);
  });

  it("needs at least one ball in the bag", () => {
    expect(shouldCatch(s({ pokeballCounts: [0, 0, 0, 0, 0] }))).toBe(false);
  });

  it("can be disabled by config", () => {
    config.catchNewSpecies = false;
    expect(shouldCatch(s())).toBe(false);
  });

  it("gives up after the per-target attempt cap, and resets for a new target", () => {
    const snap = s();
    expect(shouldCatch(snap)).toBe(true); noteCatchAttempt();
    expect(shouldCatch(snap)).toBe(true); noteCatchAttempt();
    expect(shouldCatch(snap)).toBe(true); noteCatchAttempt();
    expect(shouldCatch(snap)).toBe(false); // 3 throws spent → fall back to fighting

    // A different foe (new wave) gets a fresh budget.
    const next = s({ battle: { waveIndex: 6, isTrainer: false }, enemyParty: [foe({ speciesId: 4 })] });
    expect(shouldCatch(next)).toBe(true);
  });

  it("doesn't reset the attempt budget when waveIndex/speciesId read null mid-target (June regression)", () => {
    // A live June soak burned 141 balls on one Cascoon, "attempt 1" repeating forever — the old
    // key included foe.name (which falls back to "?" on a failed read) and re-keyed on ANY change,
    // so a single flaky tick (e.g. during the safety-halt/resume cycle) silently reset the budget.
    const snap = s();
    expect(shouldCatch(snap)).toBe(true); noteCatchAttempt();
    expect(shouldCatch(snap)).toBe(true); noteCatchAttempt();

    // A tick where the battle/foe read comes back unreadable (transient scene re-acquire) — must
    // NOT be treated as "a new target": the budget already spent (2 attempts) has to survive it,
    // so this still reads as "yes, keep going" rather than resetting back to a fresh "attempt 1".
    const flaky = s({ battle: { waveIndex: null, isTrainer: false }, enemyParty: [foe({ speciesId: null })] });
    expect(shouldCatch(flaky)).toBe(true);
    noteCatchAttempt(); // 3rd attempt recorded even though this tick's read was unreadable

    // Back to a clean read of the SAME target: the cap (3) is now hit — NOT reset to "attempt 1".
    expect(shouldCatch(snap)).toBe(false);
  });
});

describe("catch — ball selection", () => {
  it("uses the cheapest ball on an ordinary wild", () => {
    expect(pickBall(s())).toBe(PokeballType.POKE);
  });

  it("falls through to the next cheapest when out of Poké Balls", () => {
    expect(pickBall(s({ pokeballCounts: [0, 3, 0, 0, 0] }))).toBe(PokeballType.GREAT);
  });

  it("spends a stronger ball on a boss (Rogue preferred)", () => {
    expect(pickBall(s({ enemyParty: [foe({ isBoss: true, bossSegmentIndex: 0 })] }))).toBe(PokeballType.ROGUE);
  });

  it("only resorts to a Master Ball when nothing else is left", () => {
    expect(pickBall(s({ pokeballCounts: [0, 0, 0, 0, 1] }))).toBe(PokeballType.MASTER);
  });

  it("returns null with an empty bag", () => {
    expect(pickBall(s({ pokeballCounts: [0, 0, 0, 0, 0] }))).toBeNull();
  });
});

describe("shouldSoftenBeforeCatch — lower HP before throwing", () => {
  it("softens a full-HP catch target instead of throwing immediately", () => {
    expect(shouldSoftenBeforeCatch(s({ enemyParty: [foe({ hpRatio: 1 })] }))).toBe(true);
  });

  it("throws straight away once the target is at/below the HP threshold", () => {
    expect(shouldSoftenBeforeCatch(s({ enemyParty: [foe({ hpRatio: 0.3 })] }))).toBe(false);
    expect(shouldSoftenBeforeCatch(s({ enemyParty: [foe({ hpRatio: 0.35 })] }))).toBe(false);
  });

  it("stops softening (throws) after the soften-turns cap, even at full HP", () => {
    const snap = s({ enemyParty: [foe({ hpRatio: 1 })] });
    expect(shouldSoftenBeforeCatch(snap)).toBe(true); noteSoftenTurn();
    expect(shouldSoftenBeforeCatch(snap)).toBe(true); noteSoftenTurn();
    expect(shouldSoftenBeforeCatch(snap)).toBe(false); // 2 softens spent → throw now
  });

  it("never softens a boss (just throws on its catchable segment)", () => {
    expect(shouldSoftenBeforeCatch(s({ enemyParty: [foe({ isBoss: true, bossSegmentIndex: 0, hpRatio: 1 })] }))).toBe(false);
  });

  it("doesn't risk an extra turn when HP is unreadable", () => {
    expect(shouldSoftenBeforeCatch(s({ enemyParty: [foe({ hpRatio: null })] }))).toBe(false);
  });

  it("can be disabled by config", () => {
    config.softenBeforeCatch = false;
    expect(shouldSoftenBeforeCatch(s({ enemyParty: [foe({ hpRatio: 1 })] }))).toBe(false);
  });

  it("resets the soften budget when the target changes", () => {
    const snap = s({ enemyParty: [foe({ hpRatio: 1 })] });
    noteSoftenTurn(); noteSoftenTurn();
    expect(shouldSoftenBeforeCatch(snap)).toBe(false); // budget spent on this target
    // A new foe on a new wave → shouldCatch re-keys and clears the soften count.
    const next = s({ battle: { waveIndex: 6, isTrainer: false }, enemyParty: [foe({ speciesId: 4, hpRatio: 1 })] });
    expect(shouldCatch(next)).toBe(true); // re-keys the target (resets attempts + softenTurns)
    expect(shouldSoftenBeforeCatch(next)).toBe(true);
  });
});

describe("worthCatching — catch-for-ribbons value", () => {
  const ctx = (o: Partial<CatchContext> = {}): CatchContext =>
    ({ caught: false, ribboned: false, cost: 5, foeLevel: null, party: [], ...o });
  const member = (o: Partial<CatchContext["party"][number]> = {}) =>
    ({ ribboned: false, cost: 3, isCarry: false, level: null, ...o });
  // Pad a list of "interesting" members out to a FULL party (6) with already-ribboned passengers
  // (which the swap logic always skips) so a test exercises the full-party swap branch.
  const full = (...members: ReturnType<typeof member>[]) => {
    const pad = Array.from({ length: 6 - members.length }, () => member({ ribboned: true, cost: 1 }));
    return [...members, ...pad];
  };

  it("always worth a ball when the line is un-caught (unlock)", () => {
    expect(worthCatching(ctx({ caught: false }))).toBe(true);
  });

  it("never bothers with an already-ribboned line", () => {
    expect(worthCatching(ctx({ caught: true, ribboned: true }))).toBe(false);
  });

  it("catches any caught-but-un-ribboned mon while the party has room", () => {
    // Even a cheap one, and even if it doesn't out-cost anyone — room means a free ribbon candidate.
    expect(worthCatching(ctx({ caught: true, cost: 1, party: [member({ cost: 5 })] }))).toBe(true);
  });

  it("catches a high-cost un-ribboned mon over a cheaper un-ribboned passenger (full party)", () => {
    expect(worthCatching(ctx({ caught: true, cost: 6, party: full(member({ cost: 3 })) }))).toBe(true);
  });

  it("won't bother if it doesn't out-cost any swappable member (full party)", () => {
    expect(worthCatching(ctx({ caught: true, cost: 3, party: full(member({ cost: 3 }), member({ cost: 5 })) }))).toBe(false);
  });

  it("never swaps out the carry/sweeper, even if cheaper (full party)", () => {
    expect(worthCatching(ctx({ caught: true, cost: 6, party: full(member({ cost: 3, isCarry: true })) }))).toBe(false);
  });

  it("never swaps out an already-ribboned member (it's done) (full party)", () => {
    expect(worthCatching(ctx({ caught: true, cost: 6, party: full(member({ cost: 3, ribboned: true })) }))).toBe(false);
  });

  it("caught but full party of non-swappable members → not worth a ball", () => {
    expect(worthCatching(ctx({ caught: true, cost: 6, party: full() }))).toBe(false);
  });

  // ── Strength-aware (LEVEL) swap: build stronger teams, not catch-for-catch ──────────────────
  it("catches a HIGHER-level wild over a weaker replaceable member (full party)", () => {
    // Even though it's CHEAPER, the wild out-levels our weakest passenger → worth swapping up.
    const r = worthCatching(ctx({ caught: true, cost: 1, foeLevel: 30, party: full(member({ cost: 9, level: 10 })) }));
    expect(r).toBe(true);
  });

  it("won't swap when the wild is NOT stronger than any replaceable member (full party)", () => {
    // The wild is pricier but no higher-level than our bench → catching would only churn the team.
    const r = worthCatching(ctx({ caught: true, cost: 9, foeLevel: 10, party: full(member({ cost: 1, level: 20 })) }));
    expect(r).toBe(false);
  });

  it("ignores cost once levels are known (level dominates the full-party swap)", () => {
    const r = worthCatching(ctx({ caught: true, cost: 9, foeLevel: 15, party: full(member({ cost: 1, level: 15 })) }));
    expect(r).toBe(false); // equal level → not STRONGER → don't swap
  });

  it("falls back to the legacy cost bar when levels are unreadable (foeLevel null)", () => {
    const r = worthCatching(ctx({ caught: true, cost: 6, foeLevel: null, party: full(member({ cost: 3, level: 99 })) }));
    expect(r).toBe(true); // no foe level → out-costs a replaceable member → legacy yes
  });
});

describe("pickReleaseSlot — which passenger to give up (Part B)", () => {
  const pm = (o: any = {}) => ({ ribboned: false, cost: 3, isCarry: false, level: null, ...o });
  it("releases the WEAKEST (lowest-level) un-ribboned non-carry passenger", () => {
    expect(pickReleaseSlot([pm({ level: 20 }), pm({ level: 5 }), pm({ level: 12 })])).toBe(1);
  });
  it("breaks level ties by cheapest cost", () => {
    expect(pickReleaseSlot([pm({ level: 10, cost: 5 }), pm({ level: 10, cost: 2 }), pm({ level: 10, cost: 4 })])).toBe(1);
  });
  it("never releases the carry or an already-ribboned mon", () => {
    expect(pickReleaseSlot([pm({ level: 1, isCarry: true }), pm({ level: 1, ribboned: true }), pm({ level: 50 })])).toBe(2);
  });
  it("keeps a known-strong mon over an unknown-level one (null sorts last)", () => {
    expect(pickReleaseSlot([pm({ level: null }), pm({ level: 40 })])).toBe(1);
  });
  it("degrades to cheapest-first when no levels are readable", () => {
    expect(pickReleaseSlot([pm({ cost: 5 }), pm({ cost: 2 }), pm({ cost: 4 })])).toBe(1);
  });
  it("returns -1 when nothing is safe to release", () => {
    expect(pickReleaseSlot([pm({ isCarry: true }), pm({ ribboned: true })])).toBe(-1);
  });
});
