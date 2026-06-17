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
};
