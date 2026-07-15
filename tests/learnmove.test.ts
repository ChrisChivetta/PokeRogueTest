import { describe, it, expect } from "vitest";
import { evaluateLearnMove } from "../src/learnmove";
import type { MoveLike } from "../src/learnmove";

// Minimal move builder — only the fields the scorer reads.
const m = (o: Partial<MoveLike> & { name: string }): MoveLike =>
  ({ type: null, power: null, accuracy: 100, ...o });

// A "full" 4-move set of unremarkable normal attackers, easy to beat.
const weakNormalSet = (): MoveLike[] => [
  m({ name: "Tackle", type: "normal", power: 40 }),
  m({ name: "Scratch", type: "normal", power: 40 }),
  m({ name: "Pound", type: "normal", power: 40 }),
  m({ name: "Bite", type: "dark", power: 60 }),
];

describe("evaluateLearnMove — free slots", () => {
  it("always learns when there is an open slot (0 moves)", () => {
    const d = evaluateLearnMove(m({ name: "Ember", type: "fire", power: 40 }), []);
    expect(d.learn).toBe(true);
    expect(d.replaceIndex).toBe(-1);
  });

  it("always learns with 1-3 moves (no slot to forget)", () => {
    const set = [m({ name: "Tackle", type: "normal", power: 40 })];
    const d = evaluateLearnMove(m({ name: "Growl", type: "normal", power: null }), set);
    expect(d.learn).toBe(true);
    expect(d.replaceIndex).toBe(-1);
  });
});

describe("evaluateLearnMove — full moveset scoring", () => {
  it("learns a strong STAB candidate, forgetting the weakest slot", () => {
    // Charmander (fire): Flamethrower is STAB 90 power → 135 score, far above 40-power normals.
    const d = evaluateLearnMove(
      m({ name: "Flamethrower", type: "fire", power: 90 }),
      weakNormalSet(),
      ["fire"],
    );
    expect(d.learn).toBe(true);
    // Weakest is one of the three 40-power normals (score 40), not the 60-power dark move.
    expect([0, 1, 2]).toContain(d.replaceIndex);
  });

  it("declines a weak candidate that loses to every current move", () => {
    const set: MoveLike[] = [
      m({ name: "Flamethrower", type: "fire", power: 90 }),
      m({ name: "Surf", type: "water", power: 90 }),
      m({ name: "Thunderbolt", type: "electric", power: 90 }),
      m({ name: "Ice Beam", type: "ice", power: 90 }),
    ];
    const d = evaluateLearnMove(m({ name: "Tackle", type: "normal", power: 40 }), set, ["fire"]);
    expect(d.learn).toBe(false);
    expect(d.replaceIndex).toBe(-1);
  });

  it("accepts a coverage move over a redundant-type slot", () => {
    // Three normal attackers + one dark. A water move adds a brand-new attacking type and
    // should be picked up, replacing one of the redundant normals.
    const d = evaluateLearnMove(
      m({ name: "Water Gun", type: "water", power: 40 }),
      weakNormalSet(),
      [],
    );
    expect(d.learn).toBe(true);
    // It should not forget the unique dark slot (index 3); a redundant normal is cheaper.
    expect([0, 1, 2]).toContain(d.replaceIndex);
  });

  it("does not drop a unique-type coverage slot for an equal off-type move", () => {
    // Set: fire(STAB), water, grass, electric — all unique types. An off-type normal of equal
    // raw power shouldn't displace any unique coverage move.
    const set: MoveLike[] = [
      m({ name: "Flamethrower", type: "fire", power: 90 }),
      m({ name: "Surf", type: "water", power: 90 }),
      m({ name: "Energy Ball", type: "grass", power: 90 }),
      m({ name: "Thunderbolt", type: "electric", power: 90 }),
    ];
    const d = evaluateLearnMove(m({ name: "Hyper Beam", type: "normal", power: 90 }), set, ["fire"]);
    // 90-power off-type (no STAB, no new coverage = 90) vs each slot (90 + 25 unique = 115) → decline.
    expect(d.learn).toBe(false);
  });

  it("prefers forgetting a status move over a real attacker when both are low", () => {
    // STATUS_SCORE (35) sits below a 40-power attacker (40), so a decent candidate that beats
    // the status floor but not the attackers replaces the status slot.
    const set: MoveLike[] = [
      m({ name: "Growl", type: "normal", power: null, isStatus: true }), // 35
      m({ name: "Ember", type: "fire", power: 40 }),  // 40 (+25 unique = 65)
      m({ name: "Vine Whip", type: "grass", power: 45 }), // 45 (+25 unique = 70)
      m({ name: "Water Gun", type: "water", power: 40 }), // 40 (+25 unique = 65)
    ];
    // Candidate scores above 35 but the weakest slot is the status move (35).
    const d = evaluateLearnMove(m({ name: "Quick Attack", type: "normal", power: 40 }), set, []);
    expect(d.learn).toBe(true);
    expect(d.replaceIndex).toBe(0); // forget Growl
  });

  it("keeps a single status move when the candidate is also weak status", () => {
    const set: MoveLike[] = [
      m({ name: "Flamethrower", type: "fire", power: 90 }),
      m({ name: "Surf", type: "water", power: 90 }),
      m({ name: "Energy Ball", type: "grass", power: 90 }),
      m({ name: "Toxic", type: "poison", power: null, isStatus: true }),
    ];
    const d = evaluateLearnMove(m({ name: "Leer", type: "normal", power: null, isStatus: true }), set, ["fire"]);
    // status vs status is a tie (35 vs 35); SWAP_MARGIN prevents thrashing → decline.
    expect(d.learn).toBe(false);
  });

  it("folds accuracy into the score (a wildly inaccurate move can lose)", () => {
    const set: MoveLike[] = [
      m({ name: "Flamethrower", type: "fire", power: 90, accuracy: 100 }),
      m({ name: "Surf", type: "water", power: 90, accuracy: 100 }),
      m({ name: "Thunderbolt", type: "electric", power: 90, accuracy: 100 }),
      m({ name: "Ice Beam", type: "ice", power: 90, accuracy: 100 }),
    ];
    // 120 power but 30% accuracy → effective 36, below every 90-power slot.
    const d = evaluateLearnMove(
      m({ name: "Inferno", type: "fire", power: 120, accuracy: 30 }),
      set,
      ["fire"],
    );
    expect(d.learn).toBe(false);
  });
});
