// ── Catch policy (the unlock engine) ─────────────────────────────────────────
// Catching any NEW species permanently unlocks its whole evo line as a future starter,
// so the bot throws a ball at every un-caught foe it legally can. The rules below mirror
// PokéRogue's own `CommandPhase.checkCanUseBall`/`handleBallCommand` EXACTLY — we only
// throw when the game would accept it, because a rejected throw leaves the BALL menu open
// and would otherwise wedge the bot:
//   • wild battle only (trainers can't be caught; doubles block the ball as multi-target)
//   • NOT the End Biome (waves 191+ paradox mons are uncatchable in classic)
//   • a boss is catchable only on its LAST shield segment (bossSegmentIndex === 0) unless
//     you spend a Master Ball — which we never do automatically
//   • only NEW species (already-caught ones aren't worth a ball/turn)
// A per-target throw cap bounds ball/turn waste: after N misses we give up and KO it.

import type { GameSnapshot, PokemonSnapshot } from "./state";
import { config } from "./config";

/** PokeballType enum (src/enums/pokeball.ts @ main): index into scene.pokeballCounts. */
export const PokeballType = { POKE: 0, GREAT: 1, ULTRA: 2, ROGUE: 3, MASTER: 4 } as const;

/** Last wave that can still spawn catchable wilds in classic (End Biome = 191–200). */
const END_BIOME_FIRST_WAVE = 191;

// Per-target throw budget. Keyed so it resets when the foe (or wave) changes.
let attempts = 0;
let targetKey = "";

/** Reset catch bookkeeping (test seam; also called from resetPolicy). */
export function resetCatch(): void {
  attempts = 0;
  targetKey = "";
}

const onFieldFoes = (s: GameSnapshot): PokemonSnapshot[] => s.enemyParty.filter((p) => p.onField);
const ballCounts = (s: GameSnapshot): number[] => s.pokeballCounts ?? [];
const hasAnyBall = (s: GameSnapshot): boolean => ballCounts(s).some((c) => c > 0);

/**
 * Should we throw a ball at the active foe this turn (vs. just fighting)? Encapsulates the
 * full legality + worth-it check and the per-target attempt cap.
 */
export function shouldCatch(s: GameSnapshot): boolean {
  if (!config.catchNewSpecies) return false;
  const b = s.battle;
  if (!b) return false;
  if (b.isTrainer) return false; // trainers are uncatchable
  if ((b.waveIndex ?? 0) >= END_BIOME_FIRST_WAVE) return false; // End Biome: uncatchable paradox mons

  const foes = onFieldFoes(s);
  if (foes.length !== 1) return false; // ball is blocked when more than one foe is on the field
  const foe = foes[0];

  if (foe.speciesCaught !== false) return false; // only NEW species (false === confirmed un-caught)
  if (foe.isBoss && foe.bossSegmentIndex !== 0) return false; // bosses: only the last segment (non-Master)
  if (!hasAnyBall(s)) return false;

  // Reset the counter whenever the target changes (new wave / new foe).
  const key = `${b.waveIndex}:${foe.speciesId}:${foe.name}`;
  if (key !== targetKey) {
    targetKey = key;
    attempts = 0;
  }
  return attempts < config.catchAttemptsPerTarget;
}

/**
 * Which ball to throw, as an index into pokeballCounts, or null if none. Conserve premium
 * balls on ordinary wilds (cheapest first); spend up to Rogue on bosses (rarer unlocks).
 * Master Balls are only ever used as a last resort (when nothing else is in stock).
 */
export function pickBall(s: GameSnapshot): number | null {
  const c = ballCounts(s);
  const have = (i: number) => (c[i] ?? 0) > 0;
  const isBoss = !!onFieldFoes(s)[0]?.isBoss;

  const order = isBoss
    ? [PokeballType.ROGUE, PokeballType.ULTRA, PokeballType.GREAT, PokeballType.POKE]
    : [PokeballType.POKE, PokeballType.GREAT, PokeballType.ULTRA, PokeballType.ROGUE];
  for (const t of order) if (have(t)) return t;
  return have(PokeballType.MASTER) ? PokeballType.MASTER : null;
}

/** Record a throw at the current target (call when the ball is actually released). */
export function noteCatchAttempt(): void {
  attempts++;
}
