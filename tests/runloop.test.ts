import { describe, it, expect } from "vitest";
import { decideLoopAction, type LoopContext } from "../src/runloop";

const ctx = (o: Partial<LoopContext>): LoopContext =>
  ({ uiMode: "MESSAGE", objectiveDone: false, enabled: true, ...o });

describe("decideLoopAction", () => {
  it("defers in-battle / reward / encounter / dialogue screens to the battle policy", () => {
    for (const m of ["COMMAND", "FIGHT", "BALL", "MODIFIER_SELECT", "PARTY", "MYSTERY_ENCOUNTER", "MESSAGE"]) {
      expect(decideLoopAction(ctx({ uiMode: m }))).toBe("PLAY");
    }
  });

  it("starts a new run from the title while ribbons remain", () => {
    expect(decideLoopAction(ctx({ uiMode: "TITLE", objectiveDone: false }))).toBe("START_RUN");
  });

  it("stops at the title once every owned line is ribboned", () => {
    expect(decideLoopAction(ctx({ uiMode: "TITLE", objectiveDone: true }))).toBe("STOP_DONE");
  });

  it("enacts the team plan at the starter-select screen", () => {
    expect(decideLoopAction(ctx({ uiMode: "STARTER_SELECT" }))).toBe("SELECT_TEAM");
  });

  it("waits on unrecognized / transitional screens rather than mashing", () => {
    expect(decideLoopAction(ctx({ uiMode: "SAVE_SLOT" }))).toBe("WAIT");
    expect(decideLoopAction(ctx({ uiMode: "SETTINGS" }))).toBe("WAIT");
    expect(decideLoopAction(ctx({ uiMode: "UNKNOWN" }))).toBe("WAIT");
  });

  it("does nothing anywhere when the kill-switch is off", () => {
    expect(decideLoopAction(ctx({ uiMode: "TITLE", enabled: false }))).toBe("WAIT");
    expect(decideLoopAction(ctx({ uiMode: "COMMAND", enabled: false }))).toBe("WAIT");
  });
});
