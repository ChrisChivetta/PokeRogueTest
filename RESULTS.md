# RESULTS — soak iterations

Running log of strategy changes and what they did to how deep runs get. **Newest at the top.**
One entry per change (kept or reverted). Numbers come from the soak `FINAL` block.

<!-- TEMPLATE — copy this block to the top for each iteration:
## YYYY-MM-DD — <one-line change>   [KEPT | REVERTED]
- **hypothesis:** <where/why runs were dying>
- **median death wave:** <before> → <after>   ·   **clears/wipes:** <c>/<w> → <c>/<w>   ·   **max wave:** <m>
- **depth histogram (after):** 1-10:_ 11-25:_ 26-50:_ 51-100:_ 101-150:_ 151-199:_ 200+:_
- **soak:** <hours>h, <runs> runs   ·   **commit:** <sha>
- **note:** <why kept/reverted; next idea>
-->

## 2026-07-15 — baseline (no change yet)
- **hypothesis:** establish where unmodified play dies.
- **median death wave:** 6   ·   **clears/wipes:** 0/82   ·   **max wave:** 15
- **depth histogram:** 1-10:78 11-25:1 26-50:0 51-100:0 101-150:0 151-199:0 200+(clear):0
- **soak:** headless, 82 seeded runs   ·   **commit:** 7734869
- **note:** 82/100 seeds completed; batch 9 (seeds 90-99) was killed after 8+ min of CPU-bound looping on a caught-Pokemon party-full-release CONFIRM cycle (repeated PARTY<->CONFIRM UI-mode oscillation with no progress) — a real, newly-found wedge distinct from the PARTY-apply wedge fixed earlier this session, likely in the release-to-swap flow. Worth a Phase H2 investigation. This entry reflects the 82 seeds that completed cleanly.
