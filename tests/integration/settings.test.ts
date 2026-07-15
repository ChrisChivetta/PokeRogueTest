import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { SettingKeys } from "#system/settings";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __setSceneForTest } from "./bot/bridge";
import { applyGameSettings, resetSettingsApplied, DESIRED_SETTINGS } from "./bot/settings";
import { config } from "./bot/config";

// Validates the bot's settings preset against a REAL (headless) gameData: every key is a real
// game setting, and applying it produces the expected effects (Battle Style "Set", retries on).
// Catches drift in the SettingKeys the preset hard-codes.
describe("auto-ribbon — game settings preset", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    resetSettingsApplied();
    config.applyGameSettings = true;
  });

  afterEach(() => __setSceneForTest(null));

  it("every preset key is a real game setting", () => {
    const valid = new Set(Object.values(SettingKeys));
    for (const key of Object.keys(DESIRED_SETTINGS)) {
      expect(valid.has(key), key).toBe(true);
    }
  });

  it("applies the preset via the bot — Battle Style = Set, retries on", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    __setSceneForTest(game.scene);

    applyGameSettings();

    expect(game.scene.battleStyle).toBe(1); // BATTLE_STYLE index 1 = "Set"
    expect(game.scene.enableRetries).toBe(true); // ENABLE_RETRIES index 1 = "On"
  });
});
