# BOX.md — task brief for an on-box Claude session

You're running on a cloud box with **real FPS** (unlike the dev container at 3–7 FPS). Your job is
to **soak-test the bot against the local PokéRogue build and improve how deep it gets** — measure,
change one thing, re-measure. Read `HANDOFF.md` first for full context; this file is the leash.

## The loop
1. **Soak.** Start the dev server + run the soak in the background:
   `SOAK_HOURS=4 bash harness/soak-run.sh` (add `SOAK_GL=egl` only on a GPU box). It writes
   `soak-*.jsonl` + a console `FINAL` block.
2. **Diagnose.** From the FINAL block + jsonl, read: the **depth histogram**, **median death wave**,
   clears vs wipes, and per-run `minHpFrac` / `maxFainted` / `topLevel` vs `foeLevel`. Form ONE
   concrete hypothesis about where and *why* runs die (e.g. "underleveled by wave ~30", "no
   switching into bad matchups", "boss waves wipe us").
3. **Change one thing.** Make a focused strategy edit targeting that hypothesis.
4. **Prove it green:** `npm run typecheck && npm test && bash harness/integration.sh` must all pass.
5. **Re-soak and compare** the histogram / median death wave before vs after. Keep the change only
   if it measurably helps; otherwise revert and try another hypothesis.
6. **Commit** to branch `claude/vibrant-newton-iv3zlw` with the measured delta in the message
   (e.g. "median death wave 24 → 41"). Push. Repeat.

## Iterate freely (the "brain")
`src/policy.ts` (move/switch/lead choices), `src/typechart.ts`, `src/team.ts` (composition),
`src/retry.ts` (retry variation), `src/catch.ts`, `src/rewards.ts`, `src/orchestrator.ts`,
`harness/soak.mjs` (add telemetry if you need more signal).

## Handle with care — these are live-validated and version-fragile
`src/bridge.ts` (scene acquisition + UI-mode map), `src/state.ts` (defensive reads),
`src/execution.ts` (title/starter-select UI driving). Don't refactor these to chase a strategy win;
only touch them for a small, surgical fix, and re-run the smoke harness (`npm run smoke`,
`smoke:full`) after if you do.

## Guardrails (do NOT regress — see HANDOFF "Guardrails")
- **Input-only.** The bot only sends button presses. Never write saves, call game mutators, or
  modify `gameData` (reading it is fine). Test-only candy grants live in `harness/smoke-candy.mjs`,
  never in `src/`.
- The kill-switch (`config.enabled`) and safety halt (`src/safety.ts`) must keep working.
- Never commit with a red `typecheck` / unit / integration suite.
- Don't enable `config.applyCandyReductions` (known-flaky) as part of a strategy change.

## Stop and ask the user before
- any large refactor, or touching `bridge.ts` / `execution.ts` beyond a surgical fix;
- anything that would weaken the input-only / no-save-tampering guardrail;
- spending real money/time scaling up (bigger box, etc.);
- results plateauing — report what you found and your best next idea instead of thrashing.

## Reporting
Keep it tight. After each soak, post: the before→after histogram + median death wave, what you
changed, and the next hypothesis. Append a one-line result to the commit message so the branch
history reads as a measurable progression.
