// Central tunables. Everything risky defaults to the safe setting.

export interface Config {
  /**
   * When true the input driver LOGS intended inputs but never sends them.
   * Phase 0/1 run with this true. Flip to false only after reads are verified.
   */
  dryRun: boolean;

  /** Master enable. The kill-switch sets this false; nothing acts while false. */
  enabled: boolean;

  /** Verbosity: "silent" | "info" | "debug". */
  logLevel: LogLevel;

  /** How often the main loop samples game state, ms. */
  tickIntervalMs: number;

  /** Human-pacing bounds for a single input action, ms (uniform jitter). */
  inputDelayMinMs: number;
  inputDelayMaxMs: number;

  /** Hard safety caps (Phase 3 enforces; declared here so the knob exists early). */
  maxTurnsPerWave: number;
  maxWallClockPerRunMs: number;

  /** Throw balls at new (un-caught) species to unlock them as future starters. */
  catchNewSpecies: boolean;
  /**
   * Also catch caught-but-un-ribboned mons to carry them to the clear and ribbon them — but only
   * the expensive ones (cheap un-ribboned lines get ribboned via the budget team), and only while
   * the party has room to keep them. See catch.ts/worthCatching.
   */
  catchUnribboned: boolean;
  /**
   * When the party is full and we catch a valuable un-ribboned mon, release the cheapest
   * un-ribboned non-carry passenger to keep it (Part B). Off → a full-party catch is just boxed.
   */
  swapWhenPartyFull: boolean;
  /**
   * Spend money in the post-wave shop on heals to survive deeper: revive fainted mons, then top up
   * any live mon below healHpThreshold. We buy the cheapest affordable option.
   */
  buyHealsWithMoney: boolean;
  /** A live mon below this HP fraction is "hurt" enough to spend a bought potion on. */
  healHpThreshold: number;

  /**
   * On startup, set the game's options for fast unattended play (battle style "Set", retries on,
   * animations + tutorials off, max speed) via the game's own saveSetting API. Changes the
   * account's saved preferences (not run/dex state).
   */
  applyGameSettings: boolean;

  /** Max ball throws at one catch target before giving up and KO-ing it. */
  catchAttemptsPerTarget: number;

  /**
   * Soften (attack) a catchable wild to lower its HP before throwing — a lower-HP target has a far
   * higher catch rate. We FIGHT while the foe is above catchHpThreshold, up to catchSoftenTurns
   * times, then throw regardless. Bounded + capped because the carry usually out-levels wilds and a
   * single hit can KO the target (wasting the catch); these knobs keep softening to a light tap.
   */
  softenBeforeCatch: boolean;
  /** Throw once the catch target is at/below this HP fraction (above it we soften first). */
  catchHpThreshold: number;
  /** Max soften (attack) turns spent on one catch target before we throw no matter the HP. */
  catchSoftenTurns: number;

  /**
   * Spend candy to reduce starter costs during select (the planCandy decisions). EXPERIMENTAL:
   * the decision logic is tested, but reliably driving the "Use Candies" sub-menus on the live
   * grid still needs work, so it's off by default. The loop runs fine without it.
   */
  applyCandyReductions: boolean;

  /**
   * With the game's retry-on-defeat setting ON, retry a lost wave this many times — each retry
   * VARIES the bot's play (a different move ordering) so it isn't the same losing line. 0 = never
   * retry (just take the game over). Only matters if the player has retries enabled.
   */
  maxRetriesPerWave: number;
}

export type LogLevel = "silent" | "info" | "debug";

export const config: Config = {
  dryRun: true, // Phase 0: observe only.
  enabled: true,
  logLevel: "info",
  tickIntervalMs: 700,
  inputDelayMinMs: 300,
  inputDelayMaxMs: 850,
  maxTurnsPerWave: 80,
  maxWallClockPerRunMs: 60 * 60 * 1000, // 1h per run ceiling
  catchNewSpecies: true,
  catchUnribboned: true,
  swapWhenPartyFull: true,
  buyHealsWithMoney: true,
  healHpThreshold: 0.66, // top up any mon below 2/3 HP (was 0.5 — too timid; we wiped at the wave-8 trainer)
  applyGameSettings: true,
  catchAttemptsPerTarget: 3,
  softenBeforeCatch: true,
  catchHpThreshold: 0.35, // throw at ≤35% HP; above that, soften first
  catchSoftenTurns: 2, // …but never spend more than 2 attacks softening (KO risk)
  applyCandyReductions: false, // experimental — see note above
  maxRetriesPerWave: 3,
};
