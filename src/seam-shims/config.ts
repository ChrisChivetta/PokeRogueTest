// HOT-BUNDLE SHIM for ./config — exposes the HOST's live config object, so a swapped policy reads
// the exact same tunables (dryRun, pacing, thresholds) the running engine is using.
export const config = (globalThis as any).__hostSeam.config as typeof import("../config").config;
export type Config = import("../config").Config;
export type LogLevel = import("../config").LogLevel;
