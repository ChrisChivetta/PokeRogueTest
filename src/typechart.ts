// Type-effectiveness chart (Gen 6+) for safe, type-aware move selection.
// Keyed by the lowercase type names produced by bridge.typeName(). Only non-1.0
// matchups are listed; anything unlisted defaults to 1.0 (neutral).

import type { MoveSnapshot, PokemonSnapshot } from "./state";

type Chart = Record<string, Record<string, number>>;

const EFF: Chart = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, fairy: 0.5, ghost: 0 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

/** Effectiveness multiplier of one attacking type vs the defender's type list. */
export function effectiveness(attackType: string, defenderTypes: string[]): number {
  const row = EFF[attackType];
  if (!row) return 1;
  let mult = 1;
  for (const d of defenderTypes) mult *= row[d] ?? 1;
  return mult;
}

/**
 * Damage-expectation score for one move vs the defender. type-effectiveness × power × STAB ×
 * accuracy. STAB (1.5×) when the move shares a type with the attacker; accuracy as a hit-chance
 * factor (treat unreadable/always-hit as 100). 0 if the move can't deal damage / is immune.
 */
function moveScore(m: MoveSnapshot, attackerTypes: string[], foeTypes: string[]): number {
  const power = m.power ?? 0;
  if (power <= 0) return 0;
  const eff = m.type ? effectiveness(m.type, foeTypes) : 1;
  const stab = m.type && attackerTypes.includes(m.type) ? 1.5 : 1;
  const acc = m.accuracy != null && m.accuracy > 0 ? Math.min(m.accuracy, 100) / 100 : 1;
  return eff * power * stab * acc;
}

/** A move we may NOT pick this turn (disabled / 0-PP / Taunt&c.). isUsable already covers PP. */
const isPickable = (m: MoveSnapshot): boolean => m.usable !== false && !(m.pp != null && m.pp <= 0);

/**
 * Choose the best move index for `lead` against `foe` (type × power × STAB × accuracy). Only
 * picks selectable moves (skips disabled / out-of-PP); status moves are a last resort. Returns
 * null if nothing is usable (caller backs out / lets the game force Struggle).
 */
export function bestMoveIndex(lead: PokemonSnapshot | undefined, foe: PokemonSnapshot | undefined): number | null {
  const ranked = rankedMoves(lead, foe);
  return ranked.length ? ranked[0] : null;
}

/**
 * All usable move indices ranked best-first (same scoring as bestMoveIndex). Damaging moves
 * (by effectiveness × power) come before status moves; 0-PP moves are dropped. Lets the retry
 * logic pick the Nth-best move to vary a losing line. Empty if nothing's usable.
 */
export function rankedMoves(lead: PokemonSnapshot | undefined, foe: PokemonSnapshot | undefined): number[] {
  if (!lead || lead.moves.length === 0) return [];
  const foeTypes = foe?.types ?? [];
  const myTypes = lead.types ?? [];

  const damaging: { index: number; score: number }[] = [];
  const status: number[] = [];
  for (const m of lead.moves as MoveSnapshot[]) {
    if (!isPickable(m)) continue; // disabled / 0-PP / Taunt&c. — can't select it
    const score = moveScore(m, myTypes, foeTypes);
    if (score <= 0) { status.push(m.index); continue; } // non-damaging / immune — last resort
    damaging.push({ index: m.index, score });
  }
  damaging.sort((a, b) => b.score - a.score || a.index - b.index);
  return [...damaging.map((d) => d.index), ...status];
}
