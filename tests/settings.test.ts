import { describe, it, expect } from "vitest";
import { DESIRED_SETTINGS, applyGameSettings, resetSettingsApplied } from "../src/settings";
import { config } from "../src/config";

describe("DESIRED_SETTINGS preset", () => {
  it("encodes exactly the requested unattended-play choices", () => {
    expect(DESIRED_SETTINGS.BATTLE_STYLE).toBe(1); // Set, not Switch
    expect(DESIRED_SETTINGS.ENABLE_RETRIES).toBe(1); // On
    expect(DESIRED_SETTINGS.TUTORIALS).toBe(0); // Off
    expect(DESIRED_SETTINGS.MOVE_ANIMATIONS).toBe(0); // Off
  });

  it("is a safe no-op when there's no live scene (doesn't throw)", () => {
    resetSettingsApplied();
    config.applyGameSettings = true;
    expect(() => applyGameSettings()).not.toThrow();
  });
});
