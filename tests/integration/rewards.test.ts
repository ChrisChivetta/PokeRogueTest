import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { attachBot, detachBot, withBotDriving } from "./_driver";

// The reward screen — the exact place the bot stalled on the live game (a reward that
// needed a party target opened PARTY and wedged it).
describe("auto-ribbon — rewards", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single").criticalHits(false)
      .ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(50).enemyLevel(1)
      .enemySpecies(SpeciesId.MAGIKARP).enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.VINE_WHIP]);
  });

  afterEach(() => detachBot());

  it("takes the wave reward and advances to the next wave (no stall)", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);

    await withBotDriving(async () => {
      await game.phaseInterceptor.to("SelectModifierPhase"); // win wave 1 → reward screen
      await game.phaseInterceptor.to("CommandPhase"); // bot takes the reward → next wave
    });

    expect(game.scene.currentBattle.waveIndex).toBe(2);
  }, 30000);

  it("picks the higher-priority reward (Leftovers over Potions)", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);
    const lead = game.scene.getPlayerParty()[0];

    // Offer a survival held item alongside two consumable potions; the bot must choose
    // Leftovers (priority) and apply it, not just grab whatever's highlighted.
    game.scene.phaseManager.overridePhase(
      new SelectModifierPhase(0, undefined, {
        guaranteedModifierTypeFuncs: [modifierTypes.POTION, modifierTypes.LEFTOVERS, modifierTypes.SUPER_POTION],
        fillRemaining: false,
      }),
    );

    await withBotDriving(async () => {
      await game.phaseInterceptor.to("SelectModifierPhase").catch(() => {});
      await vi.waitUntil(() => lead.getHeldItems().some((m: any) => m.type?.id === "LEFTOVERS"),
        { timeout: 12000, interval: 50 });
    });

    expect(lead.getHeldItems().some((m: any) => m.type?.id === "LEFTOVERS")).toBe(true);
  }, 25000);

  it("skips a reward that would only harm the team (a lone status orb)", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);
    const lead = game.scene.getPlayerParty()[0];
    const heldBefore = lead.getHeldItems().length;

    // The only offer is a Toxic Orb (negative score) — the bot should skip the whole reward
    // (CANCEL → accept the "skip?" confirm) rather than self-inflict it on the carry.
    game.scene.phaseManager.overridePhase(
      new SelectModifierPhase(0, undefined, {
        guaranteedModifierTypeFuncs: [modifierTypes.TOXIC_ORB],
        fillRemaining: false,
      }),
    );

    await withBotDriving(async () => {
      await game.phaseInterceptor.to("SelectModifierPhase").catch(() => {});
      await vi.waitUntil(() => !game.isCurrentPhase("SelectModifierPhase"),
        { timeout: 12000, interval: 50 });
    });

    expect(lead.getHeldItems().length).toBe(heldBefore); // nothing applied — the orb was skipped
  }, 25000);

  it("resolves a reward that needs a party target (PARTY → APPLY)", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    attachBot(game.scene);
    const lead = game.scene.getPlayerParty()[0];
    const heldBefore = lead.getHeldItems().length;

    // Jump straight to a reward screen that offers Leftovers — a held item that must be
    // applied to a chosen party member (PARTY → APPLY).
    game.scene.phaseManager.overridePhase(
      new SelectModifierPhase(0, undefined, {
        guaranteedModifierTypeFuncs: [modifierTypes.LEFTOVERS],
        fillRemaining: false,
      }),
    );

    // Start the reward phase and drive the bot through it; wait until the item lands.
    await withBotDriving(async () => {
      await game.phaseInterceptor.to("SelectModifierPhase").catch(() => {});
      await vi.waitUntil(() => lead.getHeldItems().length > heldBefore, { timeout: 12000, interval: 50 });
    });

    expect(lead.getHeldItems().length).toBeGreaterThan(heldBefore);
  }, 25000);
});
