# PokéRogue "Ribbon Every Starter" — Automated Strategy Plan

Goal: earn a Classic-mode ribbon (200-wave clear, Eternatus defeated) for **every** starter species in the **fewest total runs**, run unattended by a bot. Optimize for (a) strong cheap carries, (b) a catch-and-swap unlock loop, (c) robustness to bad luck.

Each Classic clear ribbons **all 6 mons on the winning team**. So the math problem is: cover ~470+ unlockable starter lines with teams of 6, where every team must still be strong enough to clear. The whole strategy is "1 carry + up to 5 un-ribboned passengers per run."

---

## 0. Confirmed mechanics (load-bearing — all verified against sources)

| Mechanic | Detail | Source |
|---|---|---|
| **Catch = unlock as starter** | Catching/hatching any new species permanently adds its **whole evo line** to your starter roster for future runs. Also unlocks that individual's IVs (best-of), nature, ability, gender, form. | GameLeap; pokemoncoders; wiki new-player guide |
| **Starter budget** | Team cost ≤ **10 points**. Costs range **1–10**. Legendaries ~8; box legends 9–10; mid mons 3–5; bugs/early mons 1–2. | wiki starters; pokemoncoders |
| **Cost reduction via candy** | Up to **3 reductions** per line: **−10%, −25%, −50%** of base. Can drop **below 1 → 0.5 → 0.25**. (e.g., Cyndaquil 3→2→1.) | pokeroguewiki/candies; wiki starters |
| **Candy sources** | (1) faint enemies — count needed scales **with starter cost**; **Soothe Bell** (stackable ×3) speeds friendship→candy. (2) Catch a species = **+1 candy**. (3) Shiny catch/hatch = **+5/+10/+20** candy. | pokemoncoders; gameleap |
| **Boss every 10 waves** | Bosses have **segmented shields**; **uncatchable until last health segment**. | pokerogue-wiki; multiple |
| **Rival fights** | Waves **8, 25, 55, 95, 145, 195**. | DeepWiki (pagefaultgames source) |
| **Elite Four / Champion** | E4 at **182/184/186/188**, Champion **190**. | DeepWiki |
| **End Biome 191–200** | Paradox Pokémon every wave; **mostly uncatchable** (only previously-caught Paradox can be re-caught). | pokerogue-wiki; pokeroguewiki |
| **Wave 200 = Eternatus** | Eternatus → at last shield transforms into **Eternamax Eternatus**, heals to full. **Buffs its own stats** as you break segments. | gamerant; pokerogue-wiki |

Net: **catch-to-unlock is real and is the engine of the whole plan.** A single clear both ribbons 6 passengers AND unlocks every new species you caught en route as future starters/carries.

---

## A) Best carries (especially WITHOUT egg moves)

Egg moves matter most for *glass-cannon* setup sweepers. The bot should prefer carries that are strong on **base kit + ability + a common held item**, so missing egg moves doesn't break them.

### Tier S — signature-move solo carries (base kit, no egg moves needed) — STRONG CONSENSUS
- **Skeledirge** (Fuecoco line) — **Torch Song** (Fire/Ghost, raises SpA each use, 9 resistances). Repeatedly cited as a first-ribbon solo carry. Fuecoco is the single most-recommended base starter. Cheap (starter cost 3). **Top pick for a bot's first ribbons.** *(gamerant; pokemoncoders)*
- **Sneasler** — **Dire Claw**: 50% status (poison/para/sleep) every hit. Disrupts bosses, obtainable early, snowballs. Great unattended because status neuters threats the bot can't read. *(gameleap; serebii/PokeRogue move guide)*
- **Garganacl** — **Salt Cure** (1/8 max HP/turn chip, blocks healing) + **Purifying Salt** (status immunity) + Leftovers = extremely hard to kill. *(gamerant)*
- **Venusaur** (Bulbasaur) — **Leech Seed + bulk**, hard-counters Eternatus (tanks hits, chips via Leech). The canonical "beat Classic first time" pick. Cheap. *(pokemoncoders)*

### Tier S — fusion/item-enabled nukes (need a fusion or item, not an egg move)
- **Maushold + Skill Link (Shellder fusion) + Multi-Lens** → Population Bomb hits ~20×. One-move sweeper. *(gamerant)*
- **Duraludon / Tinkaton (Steel/Fairy)** → **fully immune** to Eternatus's STABs; super-effective back. Best dedicated Eternatus answer. *(gamerant)*
- **Malamar + Contrary + Topsy-Turvy** → flips Eternatus's self-buffs into debuffs at wave 200. The hard-tech anti-Eternatus button. *(gamerant; pokemoncoders)*

### Tier A — reliable stat-stick carries (fine without egg moves)
- **Dragonite** (Multiscale → survives any one hit from full → recover), **Garchomp** (speed+power, Rough Skin), **Slowbro** (Amnesia + Leftovers = "unkillable"), **Kingambit**, **Baxcalibur**. *(gamerant lists Slowbro; rest are community staples)*

### Box legends (note for the user's cost constraint)
- **Koraidon/Miraidon, Mewtwo, Kyogre/Groudon, Eternatus, Rayquaza** are the strongest raw carries **but cost ~8–10**, so they eat almost the whole 10-budget and leave **little/no room for passengers**. They're *unlockable mid-run* (see §B) and great as a **solo finisher**, but they're the **wrong tool for ribboning many cheap passengers** unless cost-reduced. **Decision rule: don't burn a run on a 10-cost legend if the objective is ribbon-coverage — use a ≤4-cost Tier-S carry instead and fill the other 6 slots with un-ribboned passengers.**

> Consensus vs. opinion: Fuecoco/Skeledirge as #1 budget carry, Venusaur as Eternatus counter, Steel/Fairy + Topsy-Turvy as the anti-Eternatus tech, and Skill-Link Maushold as a nuke are **repeated across multiple independent guides** = consensus. Specific Tier-A stat-sticks (Garchomp/Dragonite/Baxcalibur) are widely used but ranked more by general Pokémon knowledge than a single canonical PokéRogue list.

---

## B) The carry-and-swap loop (the core of minimizing runs)

### The unlock engine
1. A clear ribbons all 6 on the team.
2. Everything you **caught during that run** becomes a **future starter** (and a future carry candidate). Bosses are catchable **once at their last health segment** — so the bot should throw balls at every boss it can safely chip to the final segment.
3. Therefore the optimal first runs **double-dip**: clear with a cheap carry (ribbons 6) *and* stuff the run with new catches (unlocks N more future starters, including strong ones).

### Optimal sequencing
**Phase 1 — Bootstrap (1–3 runs): build a stable of cheap, cost-reduced carries.**
- Lead with the best available Tier-S cheap carry (Skeledirge / Sneasler / Venusaur).
- Catch **everything new**, especially bosses at last segment, to widen the starter pool fast.
- Prioritize candy onto your **main carry line** to cost-reduce it (3→2→1, then 0.5/0.25). A carry that drops from 3 → ~1 frees points for **more passengers per run**.

**Phase 2 — Ribbon-farming (the bulk of runs): 1 carry + 5 passengers.**
- Each run: **1 strong (ideally cost-reduced) carry + up to 5 un-ribboned starters** as passengers, staying ≤10 cost.
- Passengers do *not* need to be good — the carry wins; they just need to **survive to wave 200 on the bench** (they're ribboned as long as they're on the roster at clear, even if benched). So pick the **cheapest** un-ribboned lines to maximize passengers/run.
- **Coverage math:** with a ~0.5–1 cost carry, you can fit **5 passengers @ ~1.5–1.9 cost each**. Realistically **4–5 fresh ribbons per run.** Ribboning ~470 lines → on the order of **~100 runs**, front-loaded faster once carries are cheap. (This is the synthesis target; exact count depends on how cheap your carries get.)

**Phase 3 — Cleanup: expensive un-ribboned mons.**
- For pricey leftovers (legendaries you still need ribboned), **cost-reduce them first** with candy, or pair **one** expensive passenger with a cheap carry.

### Cost reduction → more passengers (direct lever)
Reducing your **carry's** cost is the highest-leverage action: every point shaved off the carry is a point spent on an extra passenger = faster ribboning. Funnel early candy (and Soothe Bells on the carry) into the 2–3 carries you'll reuse for hundreds of runs.

---

## C) Unattended reliability — concrete bot decision rules

A bot can't read a board, so bias toward **forgiving, self-sustaining** lines and **safe reward picks**.

### Carry-selection rules for a bot
1. **Prefer "win-by-default" carries** over setup sweepers: status spam (Sneasler), passive chip + heal-block (Garganacl/Salt Cure), bulk + recovery (Slowbro/Venusaur/Dragonite-Multiscale). These don't need a human to time a sweep.
2. **Avoid glass cannons** and anything reliant on egg-move setup the account lacks.
3. **Always carry an Eternatus answer** for the 190–200 stretch: either a **Steel/Fairy** (immune) on the bench, or **Topsy-Turvy Malamar**, or **Leech-Seed Venusaur**. Decision rule: *if no type-immune/anti-buff mon is alive at wave 190, prioritize defensive items over offense.*

### Held-item / reward priority (rank order for the bot)
1. **Reviver Seed** — auto-revive = single best insurance against one unlucky crit/OHKO. Put on the carry. **Highest priority pickup.**
2. **Leftovers / Shell Bell** — passive sustain; turns bulky carries into unkillable ones (Slowbro, Garganacl, Venusaur).
3. **Focus Sash** — survive-one-hit insurance for a less-bulky carry (one-time).
4. **Lucky Egg / EXP items** — accelerate levels so the carry out-levels the curve (prevents getting swept by being underleveled). Strong early.
5. **Amulet Coin** — more gold → buy heals/items in shop for the 180–200 push. Pick up early so it compounds.
6. **Type-resist berries** — situational safety vs. known threats.
7. **Multi-Lens / Wide Lens / King's Rock** — only on dedicated multi-hit nukes (Maushold).
8. **Soothe Bell** — on the carry during Phase 1 to farm candy faster (meta-progress), less needed once carry is cost-capped.

### Run-ending dangers to avoid / mitigate
- **Getting swept while underleveled** → prioritize EXP items + don't over-stuff weak passengers that steal XP from the carry early (bench them).
- **Bosses with shields** → expect a multi-turn slog every wave-10; carries need sustained damage or chip (Salt Cure/Leech/Torch Song scale well here).
- **Status on the carry** (sleep/freeze/para) → favor **status-immune abilities** (Purifying Salt) or hold **Lum/Cheri-type** safety; status is the main "bad luck" loss for bulky cores.
- **Wave 200 self-buffing Eternatus** → never try to out-stat it; **neutralize** (Topsy-Turvy), **outlast** (Leech/Salt Cure + recovery), or **type-wall** (Steel/Fairy). This is the one wave that punishes a dumb damage-race.
- **End Biome (191–200)** is mostly uncatchable — don't waste balls/turns trying to catch there; just push through.

---

## Bot algorithm (pseudocode summary)

```
PICK_TEAM():
  carry = best owned Tier-S carry, lowest effective cost (prefer cost-reduced)
  ensure team has an Eternatus answer (Steel/Fairy OR Malamar OR Venusaur)
  fill remaining slots with CHEAPEST un-ribboned lines until cost == 10
RUN():
  lead with carry (+ Eternatus-answer if it's also a fighter)
  every wave: pick highest-value SAFE move (status/chip/STAB); keep carry alive
  every boss: chip to last segment, THROW BALL if new species (unlock)
  rewards: ReviverSeed > Leftovers/ShellBell > FocusSash > EXP > AmuletCoin > resist berry
  waves 191-200: stop catching; switch to defensive items; deploy Eternatus answer at 200
POST_RUN():
  funnel candy -> reduce CARRY cost first; then reduce next-reused carry
PROGRESS():
  repeat; each clear = +up-to-5 ribbons + new unlocks; recompute cheapest un-ribboned set
```

---

## Sources
- PokéRogue Wiki — Classic Mode, Starters, New Player Guide: wiki.pokerogue.net
- DeepWiki (pagefaultgames/pokerogue source-derived) — game modes / wave structure: deepwiki.com/pagefaultgames/pokerogue/4.1-game-modes
- Game Rant — "7 Best Pokémon for Beating Eternatus": gamerant.com/pokerogue-best-pokemon-for-beating-eternatus
- PokemonCoders — "Best Starters in PokeRogue / Best Trio for Classic": pokemoncoders.com/best-starters-in-pokerogue
- pokeroguewiki.com — Candies, Classic Mode
- pokerogue-wiki.com — Classic Mode strategy
- GameLeap — Classic tips, candies/shinies/rare
- GitHub: pagefaultgames/pokerogue (issues #6765, PR #1147 — candy/egg-move cost mechanics)

### Confidence flags
- **High (sourced + consensus):** all §0 mechanics; Fuecoco/Skeledirge & Venusaur as cheap carries; Steel-Fairy/Topsy-Turvy/Maushold tech; wave structure; catch-to-unlock; candy cost reduction.
- **Synthesis (mine, built on confirmed primitives):** the exact ribbon-everything loop, "1 carry + 5 cheapest passengers" sequencing, the ~100-run estimate, and the reward-priority ordering. These follow logically from the confirmed mechanics but aren't a single canonical guide.
- **Could not directly fetch** the official wiki pages (403) or pull clean Reddit threads — used secondary guides + DeepWiki (which mirrors the repo). Worth spot-checking the loop on r/pokerogue / the PokéRogue Discord if you want a second opinion on run-count.
