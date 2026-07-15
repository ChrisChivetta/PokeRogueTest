# PLAN V2 — Headless-first path to real-account ribbons

**Status: DRAFT for approval. No code has been changed.**
Supersedes the execution strategy of `docs/PLAN.md` (whose goal, ribbon math, and input-only
guardrails all still stand). Written 2026-07-14 after a full review of the June effort.

## 0. Why revise

Four days of soaking (Jun 18–21) produced: **87 runs, 78 wipes, 0 clears, 0 ribbons, median
death wave 8, all-time max 17.** Not one RESULTS.md entry was recorded. The post-mortem in one
paragraph: policy iteration ran through 4-hour real-time browser soaks (15–18 s/wave, and 74–91%
of that wall clock lost to a safety-halt/resume ping-pong — 3,145 halt events, once throwing 141
balls at a single Cascoon) while a working ~40–100×-faster evaluation path sat unused:
`tests/integration/_driver.ts` already runs the real policy inside PokéRogue's headless
`GameManager` at **~390 ms/wave** (measured: 10 waves in 3.7 s; the wave-200 Eternatus test in
2.8 s). Meanwhile ~70% of commits went to UI-wedge triage and infra instead of the play policy —
which is genuinely weak (no damage calc, no voluntary switching, status moves ranked last against
a status-move carry thesis) and never got past the deterministic wave-8 rival.

**The fix is structural, not heroic: develop and measure the policy headless; use the browser
tiers only to validate UI driving; deploy to pokerogue.net last.**

## 1. Goal (unchanged) and success criteria

Ribbon every owned starter line on the real pokerogue.net account. One Classic clear ribbons the
entire final party (verified in `game-over-phase.ts`), so ~⌈N/6⌉ clears with planned passenger
rotation. Constraints carried forward from PLAN.md, non-negotiable:

- **Input-only.** Never write save data, dex, or ribbon state. `ui.processInput(Button)` only.
- **Human-paced on the real site** (jittered delays, action caps, kill switch). Automation on a
  real account is inherently at-your-own-risk; input-only + human pacing is the mitigation and
  it stays.
- Local checkout (`../pokerogue-src`) and local machine (14 cores) only — no cloud box.

## 2. The tier ladder

Each tier answers one question. Work climbs the ladder; it never skips.

| Tier | What | Cost per data point | Question it answers |
|---|---|---|---|
| T1 | Pure unit tests (243 existing) | seconds | Is the logic internally correct? |
| T2 | **Headless GameManager soak** (new primary loop) | ~2–5 min per full seeded run; 100-run distribution in well under an hour on 14 workers | **Is the policy strong enough?** |
| T3 | Local live-browser soak (existing harness, repaired) | 5–27 runs/hour | Does UI driving faithfully execute the policy at real FPS? |
| T4 | pokerogue.net, real account | grind | Ribbons. |

Rule: **a change is evaluated at the lowest tier that can falsify it.** Policy changes never
touch T3 until they win at T2. T3/T4 work is exclusively about driving fidelity, never strategy.

## 3. Measurement gates (the process fix)

These are mechanical, not aspirational — June's failure was ignoring its own process docs.

1. Every policy change lands with an auto-generated RESULTS.md entry: 100-seed T2 A/B
   (median death wave, depth histogram, clear rate) vs. the current baseline, marked KEPT or
   REVERTED. A new `harness/results-append.mjs` writes the entry from the soak JSONL — the
   telemetry already emits every field the template asks for.
2. **No milestone may be claimed from a test that overrides past the failure surface.**
   `startingWave(200)` tests are scenario tools, not completion evidence. "Phase 2 done" in June
   rested on exactly this false signal while live runs died at wave 8.
3. KPI ladder, in order: median death wave 8 → 25 → 55 → 100 → first full clear → clear rate %.
   The current blocker is a single deterministic fight (the wave-8 rival); it is the first target.

## 4. Phase H0 — De-risk full-fidelity headless (~half a day)

The headless bridge works but has only ever run rigged short tests. Three unknowns to kill
before building on it: real-RNG determinism, mystery-encounter handling at scale, long-run cost.

Harness hygiene (all in `harness/integration.sh` unless noted):

- `rm -rf "$DEST"` before staging (stale files currently run silently; a deleted perf test still
  executes from the staging dir).
- Fix the stale copy list: it omits `learnmove.ts`, which `policy.ts` imports — staging fails
  from a clean checkout. Replace the hardcoded brace list with `src/*.ts` minus the browser-only
  modules (`main.ts`, `hud.ts`, hot-entry/seam-shim files).
- Default `POKEROGUE_SRC` to `../pokerogue-src` (currently `/home/user/pokerogue-src`, a cloud-box
  path).
- Commit the orphaned perf probe as `tests/integration/perf-waves.test.ts` (it exists only in the
  staging dir today).
- Diagnose the 3 red tests on current beta: `catch.test.ts` ("throws at and catches a new wild
  species" — `caughtAttr` stays 0n; beta drift vs. real regression, undiagnosed) and 2
  `rewards.test.ts` failures. Also note every file's post-teardown
  `localStorage.getItem is not a function` i18n noise (harmless, but silence if cheap).

The de-risk test (one new throwaway file, e.g. `tests/integration/fullrun-probe.test.ts`):

- **Restore real battle RNG.** `GameManager`'s constructor stubs
  `BattleScene.prototype.randBattleSeedInt` to always return the max roll
  (`pokerogue-src/test/framework/game-manager.ts:84`) — every headless result to date was
  measured with rigged RNG. Capture the original prototype method at module load (before any
  `new GameManager`), restore it after construction, and seed via `game.override.seed(...)`.
- **Re-enable mystery encounters** (`initDefaultOverrides` sets `mysteryEncounterChance(0)`;
  real runs roll MEs on waves ~10–180 and the policy has a curated table for all 30 types that
  has never run headless).
- Play waves 1–50 from a real starter via `withBotDriving` + the phase loop; record wall time
  per wave, RSS growth, and any wedge (wedges surface as the 20 s vitest timeout, not hangs).
- Silence the per-phase console whitelist and call `phaseInterceptor.clearLogs()` per wave —
  stdout volume is otherwise a real cost over thousands of games.

**Gate H0:** one seeded full-fidelity run reaches wave 50 or wipes honestly; the same seed run
twice produces the identical death wave (determinism); per-run cost and RSS growth are known.
If seeded determinism fails (the framework has a TODO admitting RNG-state setting is unvalidated),
fall back to unseeded runs + larger N — the distribution is what matters, determinism is a
nice-to-have for repro.

## 5. Phase H1 — The headless soak harness (1–2 days)

- `tests/integration/headless-soak.test.ts` (or a generated matrix): one test per seed, playing
  from wave 1 until `GameOverPhase`, writing one JSONL line per run:
  `{seed, deathWave, clear, durationMs, party, retriesUsed, lastPhase}` to
  `soak-headless-<ts>.jsonl`. Per-test timeout ~10 min (the existing Eternatus test already
  overrides to 60 s; a full run needs more).
- `harness/headless-soak.sh`: stage + run N seeds across vitest fork workers, then invoke
  `harness/results-append.mjs` to append the RESULTS.md block automatically.
- Root-cause two counter bugs while instrumenting, both of which poisoned June's telemetry:
  - the **catch-attempt cap failure** — `catch.ts` caps 3 throws/target yet telemetry shows
    `ballsThrown` pinned at 141 on one Cascoon with "attempt 1" (the counter is being reset,
    plausibly by the halt/resume cycle);
  - the **`retriesUsed` underflow** (negative values in every soak file — computed across
    counter resets).
- Establish the baseline: **100 seeded full-fidelity runs.** First-ever RESULTS.md entry.

**Gate H1:** baseline distribution recorded (median death wave, histogram, clear rate) with the
harness able to produce a fresh 100-run distribution in ≲1 hour unattended.

## 6. Phase H2 — Play strength (the actual work; open-ended, ~1–2 weeks of iterations)

Every item below is one hypothesis → 100-seed A/B → RESULTS.md verdict. Priority order chosen by
expected effect on the wave-8 wall first, deep-game second.

- **P1 — Real damage expectation** (highest expected value). Today
  `typechart.ts` scores moves as eff × power × STAB × accuracy: a special attacker's physical
  move vs. a physical wall scores the same as the reverse; ability immunities (Levitate, Flash
  Fire…) and stat stages are invisible. Build `src/damage.ts`: extend the `state.ts` snapshot
  with defensively-read stats, move category, and stat stages (same pattern as the existing PP
  reads), or call the live scene's own damage/stat functions where reachable — method names
  survive minification (the bridge already calls `scene.getPlayerParty()` etc. on the live
  build). Replace `moveScore` with expected damage; keep the pure type chart as the fallback
  when reads fail. T1 unit tests against known matchups.
- **P2 — Switching.** The bot never voluntarily switches (`policy.ts` COMMAND = fight-or-ball
  only; battle style deliberately "Set") and faint-replaces with the *healthiest* mon regardless
  of matchup (`pickPartyTarget`). Add: matchup-aware faint replacement, then voluntary switch at
  COMMAND when incoming-damage estimate says the lead is outmatched. `pickPartyTarget` is pure
  and already unit-tested — cheap to extend.
- **P3 — Status moves as win conditions.** `typechart.ts:81` ranks ALL status moves dead last,
  yet the carry shortlist is built around Salt Cure / Leech Seed / Dire Claw. Score strategic
  status (Salt Cure, Leech Seed, Toxic, Will-O-Wisp, sleep, setup) for real, including
  sleep/paralysis before ball throws in the catch-soften path (~20 LOC there). Align
  `learnmove.ts`'s STATUS_SCORE so the carries keep their signature moves.
- **P4 — Resource economy.** Buy Pokéballs in `shop.ts` (1,449 June samples read "no balls in
  stock" — catching is the unlock engine and it was starved), with the attempt-cap bug already
  fixed in H1.
- **P5 — Scenario regression battery.** `tests/integration/scenarios/`: the deterministic rival
  fights (waves 8/25/55/95/145/195), a gym leader, E4, and real-RNG Eternatus via
  `startingWave`/`startingBiome` overrides with representative parties. Seconds-fast inner loop
  for targeted work; the seed soak remains the outer judge. This is where the wave-8 rival gets
  beaten *first*, before distribution-level tuning.
- **P6 — Stretch (only if clear rate demands):** held-item transfer flow (currently skipped
  entirely — a large PokéRogue power source), doubles targeting (today: default target, no
  catches with 2 foes on field).

**Gate H2 (exit to live work): ≥50% clear rate over 100 full-fidelity seeded headless runs.**
Why 50%: the grind economics. A live 200-wave clear costs ~50–70 min at realistic pacing; at a
50% clear rate, ~⌈N/6⌉ ≈ 80–100 needed clears means roughly 160–200 live attempts ≈ 20–25
overnight (8 h) sessions. Every 10 points of clear rate below 50% adds nights; materially above
it, the grind shortens. If H2 plateaus at e.g. 30% after the P1–P5 program, we stop and decide:
grind longer, or invest in P6+.

## 7. Phase L1 — Local live-browser revalidation (2–4 days, only after Gate H2)

The policy is now known-good; this phase is purely "does the browser execute it faithfully."

- **Kill the halt ping-pong.** `soak.mjs` blindly re-enables the bot every 5 s after a safety
  halt and the condition immediately re-trips (2,345 cycles in one 4 h session). New rule: N
  halts on the same wave → forfeit the run and start fresh; never blind-resume.
- **Phase-transition-gated input.** All timing today is open-loop wall clock
  (`input.ts` pacing, 700 ms tick, the 3 s `SUBMIT_COOLDOWN_MS` hack) — this is the root cause
  of both the low-FPS "misbehavior" (stale-mode re-pressing) and the throughput floor. Rework:
  press → await an observed uiMode/phase/cursor change (with timeout) before the next press.
  This deletes most of the 13-flag anti-wedge apparatus in `policy.ts`, makes the bot
  FPS-independent, and unlocks `scene.gameSpeed` above the 5× UI cap for *local* soaks (it's a
  plain writable field; tween durations divide by it).
- **Boot-time drift verification.** Promote `modeProbe()` from diagnostic to resolver-check:
  verify `UI_MODE_ORDER` per boot and hard-stop on mismatch; resolve PartyOption rows by label
  (the technique `execution.ts` already uses for menus) instead of hardcoded indices.
- Keep and use the hot-swap seam — it's excellent — but pointed at driving fixes, not strategy.

**Gate L1:** overnight local soak achieves ≥80% of the headless clear rate, ≥80% of wall clock
in-run, zero recurring wedge classes.

## 8. Phase D1 — Real-account deployment (2–3 days setup, then the grind)

- **Version parity check first:** pokerogue.net runs the release build; `../pokerogue-src` is on
  beta. Re-run the smoke verification (`npm run smoke` flow) against the live site's version and
  re-pin the local checkout to match before trusting T3 results as predictive.
- Real login/session handling, shipped human pacing profile (300–850 ms jitter), in-game
  `gameSpeed` 5× max (a legitimate setting), hard caps + kill switch, stall screenshots on.
- Ribbon orchestration is already built (`orchestrator.ts` planRun, team budgeting, roster
  reads): nightly session = K attempts, morning report = ribbons gained, clears, median depth.
- **Gate D1:** first `ribbon-gained` event ever. Then it's a throughput grind with known math.

## 9. Effort summary

| Phase | Wall time | Output |
|---|---|---|
| H0 | ~½ day | full-fidelity headless proven, harness un-drifted |
| H1 | 1–2 days | 100-seed baseline, first RESULTS.md entry, counter bugs fixed |
| H2 | 1–2 weeks (iterative) | clear rate 0% → ≥50%; this is the research phase |
| L1 | 2–4 days | live driving matches headless strength |
| D1 | 2–3 days + ~20–25 overnight sessions | ribbons |

## 10. Risks

- **Seeded determinism headless is unvalidated** (framework TODO). Mitigation: H0 tests it
  directly; fallback is unseeded distributions with larger N.
- **MEs at scale may wedge headless runs.** Mitigation: wedges surface as visible test timeouts;
  P5 can force each ME type individually to harden the table.
- **Memory growth over 200-wave runs / thousands of games.** Mitigation: H0 measures RSS;
  vitest fork isolation resets between runs if needed.
- **Upstream drift** (already bit: red catch test, missing `learnmove.ts`). Mitigation: pin
  `pokerogue-src` to one commit for all of H1–H2; rebase once before L1; parity-check before D1.
- **Account risk on pokerogue.net** is accepted and mitigated (input-only, human pacing, kill
  switch), not eliminated. D1 volume can be throttled if desired.

## 11. What carries over untouched

The headless bridge (`_driver.ts`), the hot-swap seam, all 243 unit tests and the pure strategy
modules, the catch-legality logic, the ME preference table, the telemetry schema, and PLAN.md's
ribbon math. The June work's instruments were good; V2 exists to finally point them at the
right loop and read them.
