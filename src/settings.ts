// ── Game settings (unattended-play preset) ───────────────────────────────────
// Sets the game's OPTIONS once, the same way a human would via the settings menu — through the
// game's own gameData.saveSetting(key, index) API (which applies + persists to localStorage). These
// are PREFERENCES (battle style, speed, retries, tutorials), NOT run/dex/ribbon state, so this is
// orthogonal to the input-only "earn every ribbon" guardrail. Idempotent: we set each to a target
// index, never toggle. Indices are into each setting's option list (src/system/settings/settings.ts).

import { getScene } from "./bridge";
import { config } from "./config";
import { log } from "./log";

/** key → option index. Curated for a fast, prompt-free unattended bot. */
export const DESIRED_SETTINGS: Record<string, number> = {
  BATTLE_STYLE: 1, // "Set" (not "Switch") — kills the "switch Pokémon?" prompt entirely
  ENABLE_RETRIES: 1, // On — the retry-on-defeat the policy varies and relies on
  TUTORIALS: 0, // Off — no tutorial popups to dismiss
  MOVE_ANIMATIONS: 0, // Off — skip move animations
  GAME_SPEED: 3, // Turbo (5×)
  HP_BAR_SPEED: 3, // Skip (instant)
  EXP_GAINS_SPEED: 3, // Skip (instant)
  SKIP_SEEN_DIALOGUES: 1, // On — don't replay dialogue we've already seen
};

let applied = false;

/** Reset the once-guard (test seam). */
export function resetSettingsApplied(): void {
  applied = false;
}

/**
 * Apply the preset once, when the scene/gameData is ready. Safe to call every tick — it no-ops
 * until gameData.saveSetting exists, then runs exactly once. Each key is best-effort (an unknown
 * key on a future game version is skipped, not thrown).
 */
export function applyGameSettings(): void {
  if (applied || !config.applyGameSettings) return;
  let gd: any;
  try {
    gd = getScene()?.gameData;
  } catch {
    return;
  }
  if (typeof gd?.saveSetting !== "function") return; // not ready yet — retry next tick

  let ok = 0;
  for (const [key, idx] of Object.entries(DESIRED_SETTINGS)) {
    try {
      if (gd.saveSetting(key, idx)) ok++;
    } catch {
      /* unknown key / version drift */
    }
  }
  applied = true;
  log.info(`[settings] applied ${ok}/${Object.keys(DESIRED_SETTINGS).length} unattended-play settings ` +
    `(Set battle style, retries on, animations/tutorials off, max speed).`);
}
