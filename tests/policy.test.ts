import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture intended presses instead of sending them.
const rec = vi.hoisted(() => ({ presses: [] as string[] }));
vi.mock("../src/input", () => ({
  press: vi.fn(async (btn: number, why?: string) => { rec.presses.push(`${btn}:${why ?? ""}`); return true; }),
  moveCursor2x2: vi.fn(async (from: number, to: number) => { rec.presses.push(`nav:${from}->${to}`); }),
  sleep: vi.fn(async () => {}),
}));

// Control the live handler (PARTY / ME internals) while keeping the real Button values.
const hRef = vi.hoisted(() => ({ current: null as any }));
const meRef = vi.hoisted(() => ({ current: null as any }));
vi.mock("../src/bridge", async (orig) => {
  const actual = await orig<typeof import("../src/bridge")>();
  return {
    ...actual,
    getActiveHandler: () => hRef.current,
    getMysteryEncounter: () => meRef.current,
    inMysteryEncounter: () => meRef.current != null,
  };
});

// Control the party-value reader (Part B release decision) without a live scene.
const partyVal = vi.hoisted(() => ({ current: [] as any[] }));
vi.mock("../src/roster", () => ({
  readPartyValue: () => partyVal.current,
  readCatchContext: () => null,
  readRoster: () => [],
  readCandyStarters: () => [],
}));

import { resetPolicy, step, pickPartyTarget } from "../src/policy";
import { resetRetry, noteRetry } from "../src/retry";
import type { GameSnapshot } from "../src/state";

const snap = (o: Partial<GameSnapshot>): GameSnapshot =>
  ({ ready: true, uiMode: "MESSAGE", uiModeNumber: 0, cursor: 0, awaitingActionInput: false,
     battle: null, playerParty: [], enemyParty: [], biomeType: null, money: null, pokeballCounts: null,
     ...o } as GameSnapshot);
const p = (o: any) => ({ name: "p", fainted: false, hpRatio: 1, onField: false, types: [], moves: [], ...o });

// Button values (from bridge): UP0 DOWN1 LEFT2 RIGHT3 SUBMIT4 ACTION5 CANCEL6
beforeEach(() => { rec.presses = []; hRef.current = null; meRef.current = null; resetPolicy(); resetRetry(); });

// Build a fake MysteryEncounterUiHandler. `modes`/`reqs` describe each option; cursor is
// the current grid position. Mirrors the real handler's getCursor()/encounterOptions/
// optionsMeetsReqs shape (see src/ui/handlers/mystery-encounter-ui-handler.ts).
const meHandler = (modes: number[], reqs: boolean[], cursor = 0) => ({
  encounterOptions: modes.map((optionMode) => ({ optionMode })),
  optionsMeetsReqs: reqs,
  getCursor: () => cursor,
});

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

  it("COMMAND opens the BALL menu when a new species is catchable", async () => {
    const wildFoe = p({ onField: true, speciesId: 25, speciesCaught: false, isBoss: false, bossSegmentIndex: null });
    await step(snap({
      uiMode: "COMMAND", cursor: 0, enemyParty: [wildFoe], pokeballCounts: [5, 0, 0, 0, 0],
      battle: { waveIndex: 5, isTrainer: false } as any,
    }));
    expect(rec.presses).toEqual(["nav:0->1", "5:command:ball"]); // 1 = BALL
  });

  it("BALL walks to the chosen tier and throws", async () => {
    // Cheapest available is Great (index 1) since Poké is empty; from cursor 0 → DOWN, then throw.
    await step(snap({ uiMode: "BALL", cursor: 0, enemyParty: [p({ onField: true })],
      pokeballCounts: [0, 2, 0, 0, 0] }));
    expect(rec.presses).toEqual(["1:ball:down"]);
    rec.presses = [];
    await step(snap({ uiMode: "BALL", cursor: 1, enemyParty: [p({ onField: true })],
      pokeballCounts: [0, 2, 0, 0, 0] }));
    expect(rec.presses).toEqual(["5:ball:throw1"]);
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

  it("FIGHT varies the move on a retry (picks the 2nd-best after a loss)", async () => {
    const lead = p({ onField: true, types: ["grass"], moves: [
      { index: 0, type: "normal", power: 40, pp: 10 },
      { index: 1, type: "water", power: 55, pp: 10 }, // best vs ground
    ]});
    const foe = p({ onField: true, types: ["ground"] });
    noteRetry(); // generation 1 → take the 2nd-best move instead of replaying the best
    await step(snap({ uiMode: "FIGHT", cursor: 0, playerParty: [lead], enemyParty: [foe] }));
    expect(rec.presses).toEqual(["5:fight:move0"]); // 2nd-best is move 0; cursor already there
  });

  it("MODIFIER_SELECT takes the reward when the row is unreadable", async () => {
    await step(snap({ uiMode: "MODIFIER_SELECT" }));
    expect(rec.presses).toEqual(["5:reward:take"]); // no handler options → take highlighted
  });

  const rewardHandler = (ids: string[], rowCursor = 1) => ({
    rowCursor,
    options: ids.map((id) => ({ modifierTypeOption: { type: { id, tier: 1 } } })),
  });

  it("MODIFIER_SELECT navigates to the highest-priority reward and takes it", async () => {
    hRef.current = rewardHandler(["POTION", "REVIVER_SEED", "TM_COMMON"]); // best = index 1
    await step(snap({ uiMode: "MODIFIER_SELECT", cursor: 0 }));
    expect(rec.presses).toEqual(["3:reward:nav-right"]); // RIGHT toward column 1
    rec.presses = [];
    await step(snap({ uiMode: "MODIFIER_SELECT", cursor: 1 }));
    expect(rec.presses).toEqual(["5:reward:take-best"]);
  });

  it("MODIFIER_SELECT climbs from the button row to the rewards row first", async () => {
    hRef.current = rewardHandler(["LEFTOVERS"], 0); // cursor parked on the bottom button row
    await step(snap({ uiMode: "MODIFIER_SELECT", cursor: 0 }));
    expect(rec.presses).toEqual(["0:reward:to-rewards-row"]); // UP to reach the rewards row
  });

  it("MODIFIER_SELECT skips a row of only-harmful items", async () => {
    hRef.current = rewardHandler(["TOXIC_ORB", "FLAME_ORB"]);
    await step(snap({ uiMode: "MODIFIER_SELECT", cursor: 0 }));
    expect(rec.presses).toEqual(["6:reward:skip-bad"]);
    rec.presses = [];
    await step(snap({ uiMode: "CONFIRM" })); // the skip confirmation is accepted, not declined
    expect(rec.presses).toEqual(["5:confirm:accept-skip"]);
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

  it("selects the chosen member for a mystery-encounter secondary pick (SELECT, not abandon)", async () => {
    meRef.current = { encounterType: 8 }; // inside an encounter (Field Trip)
    // PartyUiMode.SELECT menu: [SELECT(13), SUMMARY(6), CANCEL(-1)], cursor on SELECT.
    hRef.current = { optionsMode: true, options: [13, 6, -1], optionsCursor: 0 };
    await step(snap({ uiMode: "PARTY" }));
    expect(rec.presses).toEqual(["5:party:select-option"]);
  });
});

describe("mystery encounters", () => {
  // Button values: UP0 DOWN1 LEFT2 RIGHT3 ACTION5
  it("leaves the Mysterious Chest (navigates to the safe option and confirms)", async () => {
    meRef.current = { encounterType: 1 }; // MYSTERIOUS_CHEST → leave = option index 1
    hRef.current = meHandler([0, 0], [true, true], 0); // 2 plain options, cursor at TL(0)
    await step(snap({ uiMode: "MYSTERY_ENCOUNTER" }));
    expect(rec.presses).toEqual(["3:me:nav-right"]); // RIGHT toward index 1

    rec.presses = [];
    hRef.current = meHandler([0, 0], [true, true], 1); // now on index 1
    await step(snap({ uiMode: "MYSTERY_ENCOUNTER" }));
    expect(rec.presses).toEqual(["5:me:option1"]);
  });

  it("takes the free full-heal refusal at A Trainer's Test", async () => {
    meRef.current = { encounterType: 17 }; // A_TRAINERS_TEST → refuse (full heal) = index 1
    hRef.current = meHandler([0, 0], [true, true], 0);
    await step(snap({ uiMode: "MYSTERY_ENCOUNTER" }));
    expect(rec.presses).toEqual(["3:me:nav-right"]);
  });

  it("never sacrifices a party member at Dark Deal (declines)", async () => {
    meRef.current = { encounterType: 2 }; // DARK_DEAL → refuse = index 1 (NOT index 0 = accept)
    hRef.current = meHandler([0, 0], [true, true], 0);
    await step(snap({ uiMode: "MYSTERY_ENCOUNTER" }));
    expect(rec.presses).toEqual(["3:me:nav-right"]); // moving AWAY from the accept option
  });

  it("falls back past a requirement-gated option to the next favorable one", async () => {
    // AN_OFFER_YOU_CANT_REFUSE → prefs [1 (extort, special), 2 (leave)]. With the extort
    // requirement unmet (DISABLED_OR_SPECIAL), it must skip to Leave at index 2.
    meRef.current = { encounterType: 14 };
    hRef.current = meHandler([0, 3, 0], [false, false, true], 0); // option 1 disabled+unmet
    await step(snap({ uiMode: "MYSTERY_ENCOUNTER" }));
    expect(rec.presses).toEqual(["1:me:nav-down"]); // DOWN toward index 2 (bottom-left)
  });

  it("uses a requirement-gated option when its requirement IS met", async () => {
    meRef.current = { encounterType: 14 };
    hRef.current = meHandler([0, 3, 0], [false, true, true], 0); // extort now available
    await step(snap({ uiMode: "MYSTERY_ENCOUNTER" }));
    expect(rec.presses).toEqual(["3:me:nav-right"]); // RIGHT toward index 1 (extort)
  });

  it("steps off the view-party button instead of opening the party screen", async () => {
    meRef.current = { encounterType: 1 };
    hRef.current = meHandler([0, 0], [true, true], 2); // cursor parked on view-party (index === n)
    await step(snap({ uiMode: "MYSTERY_ENCOUNTER" }));
    expect(rec.presses).toEqual(["1:me:leave-party-button"]);
  });

  it("accepts an encounter sub-choice (OPTION_SELECT) only while inside an encounter", async () => {
    meRef.current = { encounterType: 8 };
    await step(snap({ uiMode: "OPTION_SELECT" }));
    expect(rec.presses).toEqual(["5:me:suboption"]);

    rec.presses = [];
    meRef.current = null; // outside an encounter, don't touch option menus
    await step(snap({ uiMode: "OPTION_SELECT" }));
    expect(rec.presses).toEqual([]);
  });
});

describe("pickPartyTarget", () => {
  const party = [
    p({ fainted: false, hpRatio: 1.0 }), // 0 — healthiest live
    p({ fainted: true, hpRatio: 0 }), //    1 — fainted
    p({ fainted: false, hpRatio: 0.3 }), // 2 — most-hurt live
  ];
  it("revive → first fainted slot", () => expect(pickPartyTarget(party, "revive")).toBe(1));
  it("heal → most-hurt live slot", () => expect(pickPartyTarget(party, "heal")).toBe(2));
  it("switch → healthiest live slot", () => expect(pickPartyTarget(party, "switch")).toBe(0));
  it("revive with nobody fainted → -1 (no valid target)", () =>
    expect(pickPartyTarget([p({ fainted: false, hpRatio: 0.5 })], "revive")).toBe(-1));
});

describe("reward apply targeting (the revive-loop fix)", () => {
  it("a Revive reward aims PARTY at the fainted mon, not the healthiest", async () => {
    // Take a Revive on the reward screen → records the apply intent.
    hRef.current = { options: [{ modifierTypeOption: { type: { id: "REVIVE", tier: 1 } } }], rowCursor: 1 };
    await step(snap({ uiMode: "MODIFIER_SELECT", cursor: 0 }));
    expect(rec.presses.at(-1)).toBe("5:reward:take-best");
    // Now in PARTY: slot 0 healthy, slot 1 fainted → head DOWN toward the fainted slot.
    rec.presses = [];
    hRef.current = { optionsMode: false };
    await step(snap({ uiMode: "PARTY", cursor: 0, playerParty: [p({ hpRatio: 1 }), p({ fainted: true, hpRatio: 0 })] }));
    expect(rec.presses).toEqual(["1:party:nav"]);
  });

  it("without a heal/revive pending, PARTY still switches to the healthiest", async () => {
    hRef.current = { optionsMode: false };
    await step(snap({ uiMode: "PARTY", cursor: 0, playerParty: [p({ hpRatio: 0.2 }), p({ hpRatio: 0.9 })] }));
    expect(rec.presses).toEqual(["1:party:nav"]); // slot 1 is healthiest
  });
});

describe("shop / money healing", () => {
  it("navigates to the shop, buys a revive, then aims PARTY at the fainted mon", async () => {
    const party = [p({ fainted: true, hpRatio: 0 })];
    const h: any = {
      rowCursor: 1,
      options: [{ modifierTypeOption: { type: { id: "LEFTOVERS", tier: 2 } } }],
      shopOptionsRows: [[{ modifierTypeOption: { cost: 300, type: { id: "REVIVE" } } }]],
    };
    hRef.current = h;
    const mod = () => snap({ uiMode: "MODIFIER_SELECT", cursor: 0, money: 999, playerParty: party });

    // On the rewards row (1); the revive sits at rowCursor 2 → press UP toward it.
    await step(mod());
    expect(rec.presses.at(-1)).toBe("0:shop:to-row"); // UP=0

    // Now on the shop row, cursor already on the item → buy it.
    rec.presses = []; h.rowCursor = 2;
    await step(mod());
    expect(rec.presses.at(-1)).toBe("5:shop:buy-revive"); // ACTION=5

    // The buy opened PARTY; with a revive pending it heads to the fainted mon (slot 0 → ACTION).
    rec.presses = []; hRef.current = { optionsMode: false };
    await step(snap({ uiMode: "PARTY", cursor: 0, playerParty: party }));
    expect(rec.presses.at(-1)).toBe("5:party:open-options");
  });

  it("skips the shop and takes the free reward when the party is healthy", async () => {
    hRef.current = {
      rowCursor: 1,
      options: [{ modifierTypeOption: { type: { id: "LEFTOVERS", tier: 2 } } }],
      shopOptionsRows: [[{ modifierTypeOption: { cost: 300, type: { id: "REVIVE" } } }]],
    };
    await step(snap({ uiMode: "MODIFIER_SELECT", cursor: 0, money: 999, playerParty: [p({ hpRatio: 1 })] }));
    expect(rec.presses.at(-1)).toBe("5:reward:take-best"); // straight to the free reward
  });
});

describe("full-party catch confirm (Part B)", () => {
  const pm = (o: any = {}) => ({ ribboned: false, cost: 3, isCarry: false, ...o });
  beforeEach(() => { partyVal.current = []; });

  it("boxes the catch (picks No) when no passenger is safe to release", async () => {
    partyVal.current = [pm({ isCarry: true }), pm({ ribboned: true })]; // nothing releasable
    hRef.current = { config: { options: [0, 0, 0, 0] }, cursor: 0 }; // 4-option fullParty confirm
    await step(snap({ uiMode: "CONFIRM" }));
    expect(rec.presses.at(-1)).toBe("1:fullparty:down"); // DOWN toward "No" (index 3)
  });

  it("swaps: picks Yes, then releases the cheapest passenger on the RELEASE screen", async () => {
    partyVal.current = [pm({ cost: 9 }), pm({ cost: 2 }), pm({ cost: 5 })]; // cheapest releasable = slot 1
    hRef.current = { config: { options: [0, 0, 0, 0] }, cursor: 2 }; // cursor already on "Yes" (index 2)
    await step(snap({ uiMode: "CONFIRM" }));
    expect(rec.presses.at(-1)).toBe("5:fullparty:swap"); // ACTION on "Yes"

    // Now in PARTY RELEASE: head to the release slot (1).
    rec.presses = []; hRef.current = { optionsMode: false };
    await step(snap({ uiMode: "PARTY", cursor: 0, playerParty: [pm(), pm(), pm()] }));
    expect(rec.presses.at(-1)).toBe("1:party:nav"); // DOWN toward slot 1

    // On the slot, its option menu offers RELEASE (11) → navigate to it.
    rec.presses = []; hRef.current = { optionsMode: true, options: [6, 11, -1], optionsCursor: 0 };
    await step(snap({ uiMode: "PARTY", cursor: 1, playerParty: [pm(), pm(), pm()] }));
    expect(rec.presses.at(-1)).toBe("1:party:opt-down"); // DOWN toward RELEASE at index 1
  });

  it("a normal 2-option confirm is still declined", async () => {
    hRef.current = { config: { options: [0, 0] }, cursor: 0 };
    await step(snap({ uiMode: "CONFIRM" }));
    expect(rec.presses).toEqual(["6:confirm:decline"]);
  });
});
