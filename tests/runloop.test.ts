import { describe, it, expect } from "vitest";
import { decideLoopAction, type LoopContext } from "../src/runloop";

const ctx = (o: Partial<LoopContext>): LoopContext =>
  ({ uiMode: "MESSAGE", objectiveDone: false, enabled: true, inRun: true, ...o });

describe("decideLoopAction", () => {
  it("defers battle-only screens to the battle policy", () => {
    for (const m of ["COMMAND", "FIGHT", "BALL", "MODIFIER_SELECT", "PARTY", "MYSTERY_ENCOUNTER"]) {
      expect(decideLoopAction(ctx({ uiMode: m }))).toBe("PLAY");
    }
  });

  it("routes shared modes by whether a run is in progress", () => {
    // In a run: dialogue / confirm / encounter sub-option → battle policy.
    for (const m of ["MESSAGE", "CONFIRM", "OPTION_SELECT"]) {
      expect(decideLoopAction(ctx({ uiMode: m, inRun: true }))).toBe("PLAY");
    }
    // Pre-run (title flow): the same modes are intro / gender / game-mode submenu → title driver.
    for (const m of ["MESSAGE", "CONFIRM", "OPTION_SELECT"]) {
      expect(decideLoopAction(ctx({ uiMode: m, inRun: false }))).toBe("START_RUN");
    }
  });

  it("starts a new run from the title while ribbons remain", () => {
    expect(decideLoopAction(ctx({ uiMode: "TITLE", inRun: false, objectiveDone: false }))).toBe("START_RUN");
  });

  it("stops at the title once every owned line is ribboned", () => {
    expect(decideLoopAction(ctx({ uiMode: "TITLE", inRun: false, objectiveDone: true }))).toBe("STOP_DONE");
  });

  it("enacts the team plan at the starter-select screen (even mid-transition)", () => {
    expect(decideLoopAction(ctx({ uiMode: "STARTER_SELECT", inRun: false }))).toBe("SELECT_TEAM");
  });

  it("waits on unrecognized / transitional screens rather than mashing", () => {
    expect(decideLoopAction(ctx({ uiMode: "SAVE_SLOT", inRun: false }))).toBe("WAIT");
    expect(decideLoopAction(ctx({ uiMode: "SETTINGS", inRun: false }))).toBe("WAIT");
    expect(decideLoopAction(ctx({ uiMode: "UNKNOWN", inRun: false }))).toBe("WAIT");
  });

  it("does nothing anywhere when the kill-switch is off", () => {
    expect(decideLoopAction(ctx({ uiMode: "TITLE", enabled: false }))).toBe("WAIT");
    expect(decideLoopAction(ctx({ uiMode: "COMMAND", enabled: false }))).toBe("WAIT");
  });
});
