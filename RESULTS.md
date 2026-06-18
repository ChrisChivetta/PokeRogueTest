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

## YYYY-MM-DD — baseline (no change yet)
- **hypothesis:** establish where unmodified play dies.
- **median death wave:** _ · **clears/wipes:** _/_ · **max wave:** _
- **depth histogram:** 1-10:_ 11-25:_ 26-50:_ 51-100:_ 101-150:_ 151-199:_ 200+:_
- **soak:** _h, _ runs · **commit:** (HEAD at soak start)
- **note:** first real-FPS soak; baseline for everything below.
