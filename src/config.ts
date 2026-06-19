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
   * Spend money in the post-wave shop on heals to survive deeper: revive fainted mons, then top up
   * any live mon below healHpThreshold. We buy the cheapest affordable option.
   */
  buyHealsWithMoney: boolean;
  /** A live mon below this HP fraction is "hurt" enough to spend a bought potion on. */
  healHpThreshold: number;

  /** Max ball throws at one catch target before giving up and KO-ing it. */
  catchAttemptsPerTarget: number;

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
  buyHealsWithMoney: true,
  healHpThreshold: 0.5,
  catchAttemptsPerTarget: 3,
  applyCandyReductions: false, // experimental — see note above
  maxRetriesPerWave: 3,
};
