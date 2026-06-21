import { describe, it, expect } from "vitest";
import { decideScenePress } from "../src/policy";

// decideScenePress is the PURE core of the animation-scene anti-wedge. It decides whether to
// advance (ACTION), wait, or escalate to a CANCEL un-wedge, given whether the handler is awaiting
// input and how many consecutive ticks we've been stuck without a prompt.
describe("decideScenePress", () => {
  it("advances and resets the counter the moment the scene awaits input", () => {
    expect(decideScenePress(true, 0)).toEqual({ act: "advance", nextStuck: 0 });
    // …even with a high stuck count, an awaiting prompt wins (and clears the counter).
    expect(decideScenePress(true, 99)).toEqual({ act: "advance", nextStuck: 0 });
  });

  it("waits (no press) while the animation is still playing, counting the tick", () => {
    expect(decideScenePress(false, 0)).toEqual({ act: "wait", nextStuck: 1 });
    expect(decideScenePress(false, 1)).toEqual({ act: "wait", nextStuck: 2 });
  });

  it("never mashes ACTION mid-animation (advance requires awaiting input)", () => {
    for (let t = 0; t < 5; t++) {
      expect(decideScenePress(false, t).act).not.toBe("advance");
    }
  });

  it("escalates to a single CANCEL un-wedge once the stuck cap is reached", () => {
    // cap default is 6: the 6th consecutive stuck tick (count 5 → 6) triggers CANCEL.
    expect(decideScenePress(false, 4)).toEqual({ act: "wait", nextStuck: 5 });
    expect(decideScenePress(false, 5)).toEqual({ act: "cancel", nextStuck: 0 });
  });

  it("respects a custom cap", () => {
    expect(decideScenePress(false, 1, 2)).toEqual({ act: "cancel", nextStuck: 0 });
    expect(decideScenePress(false, 0, 2)).toEqual({ act: "wait", nextStuck: 1 });
  });

  it("resets to 0 after a cancel so we don't re-cancel every subsequent tick", () => {
    const first = decideScenePress(false, 5); // cancels
    expect(first).toEqual({ act: "cancel", nextStuck: 0 });
    // Next tick starts fresh: one CANCEL, then back to waiting (not a CANCEL storm).
    expect(decideScenePress(false, first.nextStuck)).toEqual({ act: "wait", nextStuck: 1 });
  });
});
