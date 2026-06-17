// ── On-screen HUD ────────────────────────────────────────────────────────────
// A small fixed overlay so the operator can watch what the bot perceives without
// opening the console. Read-only mirror of the latest snapshot. Purely cosmetic;
// never interacts with the game canvas.

import { config } from "./config";
import { summarize, type GameSnapshot } from "./state";

let el: HTMLDivElement | null = null;

export function mountHud(): void {
  if (el || typeof document === "undefined") return;
  el = document.createElement("div");
  el.id = "auto-ribbon-hud";
  Object.assign(el.style, {
    position: "fixed",
    top: "8px",
    left: "8px",
    zIndex: "999999",
    font: "12px/1.4 ui-monospace, Menlo, Consolas, monospace",
    color: "#e9d5ff",
    background: "rgba(24,16,40,0.82)",
    border: "1px solid #7c3aed",
    borderRadius: "6px",
    padding: "6px 9px",
    maxWidth: "360px",
    pointerEvents: "none",
    whiteSpace: "pre-wrap",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
}

export function updateHud(s: GameSnapshot): void {
  if (!el) return;
  const mode = config.dryRun ? "OBSERVE (dryRun)" : config.enabled ? "ACTIVE" : "STOPPED";
  const header = `auto-ribbon · ${mode}`;
  el.textContent = `${header}\n${summarize(s)}`;
  el.style.borderColor = !s.ready ? "#f59e0b" : config.enabled ? "#7c3aed" : "#ef4444";
}
