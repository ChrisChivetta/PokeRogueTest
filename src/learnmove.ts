// Learn-move decision logic — should a Pokémon learn an offered move, and if so, which
// of its four existing moves should it forget?
//
// This is PURE and unit-testable: it takes the candidate move + the current moveset and
// returns a decision. No live-scene access, no per-species hardcoding — the scoring is
// first-principles "what makes a good moveset for ANY Pokémon", drawn from standard
// team-building (PokéRogue uses mainline Gen 8/9 mechanics):
//
//   • STAB — a move matching the user's type does 1.5× damage, so same-type attackers
//     are worth more than off-type ones of equal power.
//   • Power × accuracy — expected damage. A 120-power/70-acc move (~84 eff.) ranks below
//     a 90-power/100-acc one (90 eff.); we fold accuracy into the score as a hit factor.
//   • Coverage — a moveset that can only hit one attacking type is easily walled. A
//     candidate that adds a NEW attacking type the set lacks gets a bonus; one that just
//     duplicates a type you already cover is worth less.
//   • Don't trash utility — status/setup moves have real value (they're how you survive
//     deep runs), so they get a modest floor rather than a zero, and we avoid forgetting
//     the user's ONLY move of a given attacking type.
//
// Decision rule: learn ONLY if the candidate clearly beats the WEAKEST current move (by a
// margin, so we don't thrash on ties), and then forget exactly that weakest slot. This
// makes the moveset improve monotonically and guarantees the learn-move flow terminates.

/** Minimal move shape this module scores — a candidate or an existing slot. */
export interface MoveLike {
  name: string;
  type: string | null;
  power: number | null;
  accuracy: number | null;
  /** True if this is a non-damaging status/setup move (power <= 0). Derived if omitted. */
  isStatus?: boolean;
}

/** A move offered to be learned. Alias of MoveLike for call-site readability. */
export type CandidateMove = MoveLike;

export interface LearnDecision {
  /** Whether to learn the move at all. */
  learn: boolean;
  /** Which existing slot (0-3) to forget if learning; -1 when declining. */
  replaceIndex: number;
  /** Human-readable reason, for the operator log. */
  reason: string;
}

/** Flat utility a status/setup move is worth, in the same units as a damaging move's score.
 *  Tuned to sit below a weak-but-real attacker (e.g. 40-power STAB ≈ 60) so we keep one or
 *  two utility moves but won't hoard them over coverage. */
const STATUS_SCORE = 35;

/** Minimum score advantage the candidate must have over the weakest current move to bother
 *  swapping. Prevents thrashing on near-ties and on re-offered moves. */
const SWAP_MARGIN = 1;

/** Bonus added to a damaging move's score when it brings an attacking type the rest of the
 *  moveset does NOT already have (coverage is scarce and valuable). */
const COVERAGE_BONUS = 25;

const isStatusMove = (m: { power: number | null; isStatus?: boolean }): boolean =>
  m.isStatus ?? !(typeof m.power === "number" && m.power > 0);

/** Intrinsic, foe-agnostic quality of a single move for THIS user (by its own type list).
 *  power × STAB × accuracy for attackers; a flat floor for status moves. */
function intrinsicScore(
  m: { type: string | null; power: number | null; accuracy: number | null; isStatus?: boolean },
  userTypes: string[],
): number {
  if (isStatusMove(m)) return STATUS_SCORE;
  const power = m.power ?? 0;
  const stab = m.type && userTypes.includes(m.type) ? 1.5 : 1;
  const acc = m.accuracy != null && m.accuracy > 0 ? Math.min(m.accuracy, 100) / 100 : 1;
  return power * stab * acc;
}

/** The set of distinct attacking types currently covered by the damaging moves in `moves`. */
function coveredTypes(moves: MoveLike[]): Set<string> {
  const s = new Set<string>();
  for (const m of moves) if (!isStatusMove(m) && m.type) s.add(m.type);
  return s;
}

/**
 * Decide whether `candidate` should be learned by a user with types `userTypes` and the
 * given `currentMoves` (its existing moveset; may be 0–4 entries). PURE.
 *
 * Behaviour:
 *   • Free slot (< 4 moves) → always learn (replaceIndex -1 means "no slot to forget").
 *   • Full moveset → score the candidate (with coverage bonus if it adds a new type) and
 *     compare to the WEAKEST current move. Learn + forget that slot only if the candidate
 *     wins by SWAP_MARGIN. We never forget the user's only move of a type if a redundant or
 *     status slot is a strictly worse alternative — that falls out of picking the min-score
 *     slot, which naturally prefers dropping duplicates/weakest moves.
 */
export function evaluateLearnMove(
  candidate: CandidateMove,
  currentMoves: MoveLike[],
  userTypes: string[] = [],
): LearnDecision {
  // Free slot: nothing to forget — learning is strictly additive.
  if (currentMoves.length < 4) {
    return { learn: true, replaceIndex: -1, reason: `free slot for ${candidate.name}` };
  }

  const covered = coveredTypes(currentMoves);
  let candScore = intrinsicScore(candidate, userTypes);
  // Reward a damaging candidate that adds a brand-new attacking type to the set.
  const addsCoverage =
    !isStatusMove(candidate) && !!candidate.type && !covered.has(candidate.type);
  if (addsCoverage) candScore += COVERAGE_BONUS;

  // Find the weakest current slot. When considering what we'd lose, penalize dropping the
  // ONLY move of an attacking type (losing coverage), so a redundant/weaker slot is chosen.
  let weakestIndex = -1;
  let weakestScore = Infinity;
  currentMoves.forEach((m, i) => {
    let s = intrinsicScore(m, userTypes);
    if (!isStatusMove(m) && m.type) {
      const sameType = currentMoves.filter((o) => !isStatusMove(o) && o.type === m.type).length;
      if (sameType === 1) s += COVERAGE_BONUS; // unique coverage → costlier to forget
    }
    if (s < weakestScore) { weakestScore = s; weakestIndex = i; }
  });

  if (weakestIndex < 0) {
    return { learn: false, replaceIndex: -1, reason: "no readable current moves" };
  }

  if (candScore >= weakestScore + SWAP_MARGIN) {
    const verb = addsCoverage ? "adds coverage" : "out-scores weakest";
    return {
      learn: true,
      replaceIndex: weakestIndex,
      reason: `${candidate.name} (${candScore.toFixed(0)}) ${verb} vs slot ${weakestIndex} (${weakestScore.toFixed(0)})`,
    };
  }
  return {
    learn: false,
    replaceIndex: -1,
    reason: `${candidate.name} (${candScore.toFixed(0)}) ≤ weakest slot (${weakestScore.toFixed(0)}) — keep moveset`,
  };
}
