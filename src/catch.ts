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
import { readCatchContext } from "./roster";

/** PokeballType enum (src/enums/pokeball.ts @ main): index into scene.pokeballCounts. */
export const PokeballType = { POKE: 0, GREAT: 1, ULTRA: 2, ROGUE: 3, MASTER: 4 } as const;

/** Last wave that can still spawn catchable wilds in classic (End Biome = 191–200). */
const END_BIOME_FIRST_WAVE = 191;

// Per-target throw budget. Keyed so it resets when the foe (or wave) changes.
let attempts = 0;
let targetKey = "";
// Cumulative diagnostics (NOT reset per run) so telemetry can answer "is it actually catching?":
// total balls released this session + the reason the last shouldCatch() call decided as it did.
let ballsThrown = 0;
let lastDecision = "init";

/** Total balls the bot has thrown this session (telemetry: confirms catching is happening). */
export function ballsThrownCount(): number {
  return ballsThrown;
}
/** Why the most recent shouldCatch() returned what it did (telemetry/diagnostic). */
export function lastCatchDecision(): string {
  return lastDecision;
}

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
  const no = (reason: string): false => { lastDecision = `no: ${reason}`; return false; };
  if (!config.catchNewSpecies) return no("catchNewSpecies disabled");
  const b = s.battle;
  if (!b) return no("no battle");
  if (b.isTrainer) return no("trainer battle (uncatchable)");
  if ((b.waveIndex ?? 0) >= END_BIOME_FIRST_WAVE) return no("End Biome (uncatchable)");

  const foes = onFieldFoes(s);
  if (foes.length !== 1) return no(`${foes.length} foes on field (ball blocked)`);
  const foe = foes[0];

  if (foe.isBoss && foe.bossSegmentIndex !== 0) return no("boss not on last shield segment");
  if (!hasAnyBall(s)) return no("no balls in stock");

  // Decide WHAT's worth a ball. A NEW species is always worth it (unlocks the line even if the
  // party's full and it gets boxed). A caught-but-un-ribboned mon is worth it if there's room to
  // keep it OR it out-costs a swappable member — see worthCatching.
  if (foe.speciesCaught === false) {
    // new species → always worth a ball
  } else if (foe.speciesCaught == null) {
    // Pokédex unreadable (version drift) → don't risk wedging the BALL menu; just fight.
    return no("speciesCaught unreadable");
  } else {
    if (!config.catchUnribboned) return no("already caught; catchUnribboned disabled");
    // Need somewhere to keep it: open room, OR Part B will release a passenger to make room.
    if (!config.swapWhenPartyFull && s.playerParty.length >= 6) return no("caught + party full (no swap)");
    const ctx = readCatchContext();
    if (!ctx) return no("catch context unreadable");
    if (!worthCatching(ctx)) return no("caught + not worth a swap");
  }

  // Reset the counter whenever the target changes (new wave / new foe).
  const key = `${b.waveIndex}:${foe.speciesId}:${foe.name}`;
  if (key !== targetKey) {
    targetKey = key;
    attempts = 0;
  }
  if (attempts >= config.catchAttemptsPerTarget) return no(`hit attempt cap (${attempts})`);
  lastDecision = `yes: ${foe.name} (${foe.speciesCaught === false ? "new species" : "un-ribboned"}), attempt ${attempts + 1}`;
  return true;
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
  ballsThrown++;
}

// ── Catch-for-ribbons value ──────────────────────────────────────────────────
// Beyond unlocking new species, we catch caught-but-UN-ribboned mons to carry them to the
// wave-200 clear and ribbon them — but only the EXPENSIVE ones, because cheap un-ribboned
// starters already get ribboned via the budget team at starter-select. So a caught mon is worth
// a ball only if it out-costs a party member we'd happily swap out (un-ribboned, and NOT the
// carry/sweeper — losing the carry loses the run).

/** One party member, reduced to what the catch-value decision needs (root-species cost/ribbon). */
export interface PartyMon {
  ribboned: boolean;
  cost: number;
  isCarry: boolean;
}

/** The on-field wild + our party, by starter (root) species, for the catch-value decision. */
export interface CatchContext {
  caught: boolean; // is the wild's starter line already owned?
  ribboned: boolean; // does it already hold the Classic ribbon?
  cost: number; // its starter cost
  party: PartyMon[];
}

/**
 * Is this wild worth a ball for the ribbon objective? PURE. Uncaught → always (unlock + a future
 * ribbon). Already-ribboned → never. Caught-but-un-ribboned → grab it whenever there's open room
 * to keep it (more un-ribboned candidates on the team is strictly good early), or — when full — if
 * it out-costs a replaceable (un-ribboned, non-carry) member, i.e. worth swapping a passenger out.
 */
export function worthCatching(ctx: CatchContext): boolean {
  if (!ctx.caught) return true;
  if (ctx.ribboned) return false;
  if (ctx.party.length < 6) return true; // room to keep another un-ribboned ribbon candidate
  return ctx.party.some((p) => !p.ribboned && !p.isCarry && p.cost < ctx.cost);
}

/**
 * When a catch fills the party, which slot to RELEASE to keep it (Part B)? PURE. The cheapest
 * un-ribboned, non-carry passenger — those are the easiest to re-ribbon later via the budget team,
 * so they're the right thing to give up for a pricier catch. -1 if there's nothing safe to release.
 */
export function pickReleaseSlot(party: PartyMon[]): number {
  let slot = -1;
  let cheapest = Infinity;
  party.forEach((p, i) => {
    if (!p.ribboned && !p.isCarry && p.cost < cheapest) { cheapest = p.cost; slot = i; }
  });
  return slot;
}
