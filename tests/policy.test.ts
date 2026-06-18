import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture intended presses instead of sending them.
const rec = vi.hoisted(() => ({ presses: [] as string[] }));
vi.mock("../src/input", () => ({
  press: vi.fn(async (btn: number, why?: string) => { rec.presses.push(`${btn}:${why ?? ""}`); return true; }),
  moveCursor2x2: vi.fn(async (from: number, to: number) => { rec.presses.push(`nav:${from}->${to}`); }),
  sleep: vi.fn(async () => {}),
}));

// Control the live handler (PARTY internals) while keeping the real Button values.
const hRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("../src/bridge", async (orig) => {
  const actual = await orig<typeof import("../src/bridge")>();
  return { ...actual, getActiveHandler: () => hRef.current };
});

import { resetPolicy, step } from "../src/policy";
import type { GameSnapshot } from "../src/state";

const snap = (o: Partial<GameSnapshot>): GameSnapshot =>
  ({ ready: true, uiMode: "MESSAGE", uiModeNumber: 0, cursor: 0, awaitingActionInput: false,
     battle: null, playerParty: [], enemyParty: [], biomeType: null, money: null, pokeballCounts: null,
     ...o } as GameSnapshot);
const p = (o: any) => ({ name: "p", fainted: false, hpRatio: 1, onField: false, types: [], moves: [], ...o });

// Button values (from bridge): UP0 DOWN1 LEFT2 RIGHT3 SUBMIT4 ACTION5 CANCEL6
beforeEach(() => { rec.presses = []; hRef.current = null; resetPolicy(); });

describe("policy routing", () => {
  it("does nothing when not ready", async () => {
    await step(snap({ ready: false }));
    expect(rec.presses).toEqual([]);
  });

  it("COMMAND with cursor on FIGHT just confirms", async () => {
    await step(snap({ uiMode: "COMMAND", cursor: 0 }));
    expect(rec.presses).toEqual(["5:command:fight"]);
  });

  it("COMMAND moves the cursor to FIGHT first", async () => {
    await step(snap({ uiMode: "COMMAND", cursor: 2 }));
    expect(rec.presses).toEqual(["nav:2->0", "5:command:fight"]);
  });

  it("FIGHT navigates to and selects the best move", async () => {
    const lead = p({ onField: true, types: ["grass"], moves: [
      { index: 0, type: "normal", power: 40, pp: 10 },
      { index: 1, type: "water", power: 55, pp: 10 }, // 2x vs ground
    ]});
    const foe = p({ onField: true, types: ["ground"] });
    await step(snap({ uiMode: "FIGHT", cursor: 0, playerParty: [lead], enemyParty: [foe] }));
    expect(rec.presses).toEqual(["nav:0->1", "5:fight:move1"]);
  });

  it("MODIFIER_SELECT takes the reward", async () => {
    await step(snap({ uiMode: "MODIFIER_SELECT" }));
    expect(rec.presses).toEqual(["5:reward:take"]);
  });

  it("advances dialogue only when awaiting input", async () => {
    await step(snap({ uiMode: "MESSAGE", awaitingActionInput: true }));
    expect(rec.presses).toEqual(["5:advance"]);
    rec.presses = [];
    await step(snap({ uiMode: "MESSAGE", awaitingActionInput: false }));
    expect(rec.presses).toEqual([]); // don't mash plain messages
  });

  it("declines CONFIRM and backs out of a stray SUMMARY", async () => {
    await step(snap({ uiMode: "CONFIRM" }));
    expect(rec.presses).toEqual(["6:confirm:decline"]);
    rec.presses = [];
    await step(snap({ uiMode: "SUMMARY" }));
    expect(rec.presses).toEqual(["6:summary:back"]);
  });
});

describe("PARTY option targeting (the previously-buggy path)", () => {
  it("navigates the option cursor to SEND_OUT, not the first option (SUMMARY)", async () => {
    hRef.current = { optionsMode: true, options: [6, 0, -1], optionsCursor: 0 }; // [SUMMARY, SEND_OUT, CANCEL]
    await step(snap({ uiMode: "PARTY" }));
    expect(rec.presses).toEqual(["1:party:opt-down"]); // DOWN toward SEND_OUT at index 1
  });

  it("confirms when the option cursor is already on SEND_OUT", async () => {
    hRef.current = { optionsMode: true, options: [0, 6, -1], optionsCursor: 0 };
    await step(snap({ uiMode: "PARTY" }));
    expect(rec.presses).toEqual(["5:party:select-option"]);
  });

  it("targets APPLY for a reward when SEND_OUT is absent", async () => {
    hRef.current = { optionsMode: true, options: [6, 3], optionsCursor: 1 }; // [SUMMARY, APPLY]
    await step(snap({ uiMode: "PARTY" }));
    expect(rec.presses).toEqual(["5:party:select-option"]); // already on APPLY (index 1)
  });

  it("abandons a reward whose target menu offers neither SEND_OUT nor APPLY (e.g. a TM)", async () => {
    hRef.current = { optionsMode: true, options: [4, 6, -1], optionsCursor: 0 }; // [TEACH, SUMMARY, CANCEL]
    await step(snap({ uiMode: "PARTY" }));
    expect(rec.presses).toEqual(["6:party:abandon-options"]);
  });

  it("after abandoning, skips the reward at MODIFIER_SELECT (CANCEL then accept the confirm)", async () => {
    // 1) abandon the TM target menu → sets the skip flag
    hRef.current = { optionsMode: true, options: [4, -1], optionsCursor: 0 };
    await step(snap({ uiMode: "PARTY" }));
    rec.presses = [];
    // 2) at the reward screen we now CANCEL (open "skip?")
    await step(snap({ uiMode: "MODIFIER_SELECT" }));
    expect(rec.presses).toEqual(["6:reward:skip"]);
    rec.presses = [];
    // 3) the skip confirmation is ACCEPTED (not declined like a learn-move confirm)
    await step(snap({ uiMode: "CONFIRM" }));
    expect(rec.presses).toEqual(["5:confirm:accept-skip"]);
  });

  it("opens options on the healthiest usable member", async () => {
    hRef.current = { optionsMode: false };
    const party = [p({ fainted: true, hpRatio: 0 }), p({ hpRatio: 0.8 })];
    await step(snap({ uiMode: "PARTY", cursor: 0, playerParty: party }));
    // healthiest non-fainted is index 1 → move DOWN toward it
    expect(rec.presses).toEqual(["1:party:nav"]);
  });

  it("opens the option menu once the cursor is on the chosen member", async () => {
    hRef.current = { optionsMode: false };
    const party = [p({ hpRatio: 1 }), p({ hpRatio: 0.3 })];
    await step(snap({ uiMode: "PARTY", cursor: 0, playerParty: party }));
    expect(rec.presses).toEqual(["5:party:open-options"]); // index 0 is healthiest, cursor already there
  });
});
