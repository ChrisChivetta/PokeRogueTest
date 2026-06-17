// Tiny leveled logger. Prefixes everything so it's greppable in the browser console.
import { config, type LogLevel } from "./config";

const PREFIX = "%c[auto-ribbon]";
const STYLE = "color:#7c3aed;font-weight:bold";

const RANK: Record<LogLevel, number> = { silent: 0, info: 1, debug: 2 };

function enabled(level: Exclude<LogLevel, "silent">): boolean {
  return RANK[config.logLevel] >= RANK[level];
}

export const log = {
  info(...args: unknown[]): void {
    if (enabled("info")) console.log(PREFIX, STYLE, ...args);
  },
  debug(...args: unknown[]): void {
    if (enabled("debug")) console.log(PREFIX, STYLE, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, STYLE, ...args);
  },
  error(...args: unknown[]): void {
    console.error(PREFIX, STYLE, ...args);
  },
  /** Always prints, ignores level. For the operator-facing status line. */
  banner(...args: unknown[]): void {
    console.log(PREFIX, STYLE, ...args);
  },
};
