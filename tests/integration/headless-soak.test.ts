import { BattleScene } from "#app/battle-scene";
import { activeOverrides } from "#app/overrides";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { appendFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { attachBot, detachBot, withBotDriving } from "./_driver";

// Phase H1 (docs/PLAN-V2.md §5): the primary policy-evaluation loop. One test per seed, full
// fidelity (real battle RNG + real mystery encounters — see fullrun-probe.test.ts, which proved
// this survives sustained play without wedging), playing from wave 1 until the run actually ends
// (a wipe) rather than a fixed wave cap. Each run appends one JSONL line so
// harness/headless-soak.sh can collect an N-seed distribution and harness/results-append.mjs can
// turn it into a RESULTS.md entry.
//
// Seed count + output path are read from the environment so the shell driver controls scale
// without editing this file:
//   SOAK_SEED_COUNT   number of seeds to run this invocation (default 5 — small so a bare
//                     `vitest run` isn't accidentally a 10-minute-per-test soak)
//   SOAK_SEED_PREFIX  seed name prefix (default "headless-soak"); seeds are "<prefix>-<i>"
//   SOAK_OUTPUT       JSONL file to append records to (default "soak-headless-<n>.jsonl" in cwd,
//                     which — staged — is the pokerogue-src checkout root; the shell driver
//                     copies it back out)
const SEED_COUNT = Number(process.env.SOAK_SEED_COUNT ?? 5);
const SEED_PREFIX = process.env.SOAK_SEED_PREFIX ?? "headless-soak";
const OUTPUT_PATH = process.env.SOAK_OUTPUT ?? `soak-headless-${SEED_COUNT}.jsonl`;
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => `${SEED_PREFIX}-${i}`);

// A hard ceiling on iterations so a genuinely wedged run fails fast via assertion instead of
// silently looping until the vitest timeout (same lesson as fullrun-probe.test.ts): 200 waves is
// a full Classic clear, so 200*3 gives headroom for MEs/multi-step phases without being unbounded.
const MAX_LOOP_ITERS = 600;

interface SoakRecord {
  seed: string;
  deathWave: number | null; // null if the run somehow neither cleared nor wiped (loop cap hit)
  clear: boolean; // reached wave 200 and won (a full Classic clear)
  durationMs: number;
  party: string[]; // final party species names, for post-hoc "what carried/failed" analysis
  retriesUsed: number; // always 0 here — retry-on-defeat is a main.ts (browser tick loop) concern
  // this headless driver never exercises (see the note in the file header); kept in the schema
  // for parity with the plan's spec and so results-append.mjs's field list doesn't have to branch.
  lastPhase: string | null;
}

describe("auto-ribbon — headless soak (Phase H1)", () => {
  let phaserGame: Phaser.Game;
  let originalRandBattleSeedInt: typeof BattleScene.prototype.randBattleSeedInt;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    originalRandBattleSeedInt = BattleScene.prototype.randBattleSeedInt;
  });

  afterEach(() => detachBot());

  it.each(SEEDS)(
    "seed %s: plays to a wipe or a clear, full fidelity",
    async (seed) => {
      const game = new GameManager(phaserGame);
      // Undo GameManager's rig for a representative run — see fullrun-probe.test.ts for why both
      // of these matter (every OTHER integration test runs under max-roll RNG + MEs disabled).
      BattleScene.prototype.randBattleSeedInt = originalRandBattleSeedInt;
      vi.spyOn(activeOverrides, "MYSTERY_ENCOUNTER_RATE_OVERRIDE", "get").mockReturnValue(null);
      game.override
        .ability(AbilityId.BALL_FETCH) // neutralize ability RNG; not what H1 is measuring
        .seed(seed)
        .moveset([MoveId.WATER_GUN, MoveId.TACKLE]); // see fullrun-probe.test.ts: an unset
      // moveset can leave the starter with nothing usable ("has no moves left") and it Struggles
      // itself to death turn one — that's a test-fixture artifact, not a policy result, and would
      // corrupt every seed's distribution the same way. Fixed across seeds so the SEED is what
      // varies (wild encounters, crits, catch RNG), not the starter's moves.
      await game.classicMode.startBattle(SpeciesId.SQUIRTLE);
      attachBot(game.scene);

      const startedAt = Date.now();
      const isWipedOut = () => game.scene.getPlayerParty().every((p) => p.isFainted());
      let clear = false;

      await withBotDriving(async () => {
        for (let i = 0; i < MAX_LOOP_ITERS; i++) {
          const wave = game.scene.currentBattle?.waveIndex ?? 0;
          if (wave >= 200 && game.scene.gameData.gameStats.sessionsWon > 0) {
            clear = true;
            break;
          }
          if (isWipedOut()) break;
          // See fullrun-probe.test.ts: phaseInterceptor.to() has its own internal wait
          // (TEST_TIMEOUT, ~20s) before rejecting, so a wipe/clear that lands us somewhere with
          // no more FaintPhase/CommandPhase coming still costs one such wait here before the
          // .catch() lets the loop re-check state below — inherent to the framework, not a wedge.
          await game.phaseInterceptor.to("FaintPhase").catch(() => {});
          if (isWipedOut()) break;
          await game.phaseInterceptor.to("CommandPhase").catch(() => {});
        }
      });

      const durationMs = Date.now() - startedAt;
      const finalWave = game.scene.currentBattle?.waveIndex ?? null;
      const party = game.scene.getPlayerParty().map((p) => p.species.getName());
      const lastPhase = game.scene.phaseManager.getCurrentPhase()?.phaseName ?? null;

      const record: SoakRecord = {
        seed,
        deathWave: clear ? null : finalWave,
        clear,
        durationMs,
        party,
        retriesUsed: 0,
        lastPhase,
      };
      appendFileSync(OUTPUT_PATH, `${JSON.stringify(record)}\n`);

      // The bar here is the same as Gate H0's, generalized: the run must actually END (a wipe or
      // a clear) within the loop cap — not hang, not silently stop making progress. A run that
      // hits MAX_LOOP_ITERS without either is exactly the "silent stall" Gate H0's own loop logic
      // was built to avoid; fail loudly so it shows up as a red test, not a missing JSONL line.
      expect(clear || isWipedOut()).toBe(true);
    },
    10 * 60 * 1000, // 10 minutes per seed — generous for a real (unrigged), unbounded-wave run
  );
});
