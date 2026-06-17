# PokéRogue Classic Mode + Ribbon System — Verified Mechanics (research only)

Source basis: pagefaultgames/pokerogue `main` branch source (read via authenticated `gh` API),
DeepWiki, third-party wikis. Verified against code as of 2026-06-16.

## KEY FACT (all-six ribbons): CONFIRMED by source
`src/phases/game-over-phase.ts` victory handler loops over ENTIRE current party:
`for (const pokemon of globalScene.getPlayerParty()) { this.awardFirstClassicCompletion(pokemon); ... }`
then `awardRibbons()` also loops the whole party. So every eligible party member at wave 200
earns its ribbon in ONE win. => ceil(total_starters / 6) wins minimum.

Caveats:
- It is the CURRENT party at victory (getPlayerParty), NOT "starters chosen at run start".
  Mid-run caught Pokémon that are in the final party DO get ribboned.
- Fainted members still in party DO get the ribbon (no faint filter; only
  checkSpeciesValidForChallenge gates it, irrelevant in vanilla Classic).
- Ribbon propagates down evolution line (pre-evos flagged too).
- Victory condition: `isClassic && waveIndex > 200` (must beat wave 200 Eternatus).
- First ribbon for a species => +1 Egg Voucher Plus. First-ever Classic win => Voucher Premium.

## Structure (from source)
- Final wave = 200 (`isWaveFinal => waveIndex === 200`).
- Boss every 10 waves (`isBoss => waveIndex % 10 === 0`).
- Biome changes every 10 waves; party recalled + healed on biome change.
- Waves 191-200 = End biome.
- Wave 200 = Eternatus, 2-phase -> Eternamax (restores HP/shields, +shield, Mini Black Hole,
  becomes double battle). `initFinalBossPhaseTwo`.

## Fixed battle waves (src/enums/fixed-boss-waves.ts)
5 youngster; Rivals 8/25/55/95/145/195; Evil grunts 35/62/64/112; admins 66/114/164;
evil bosses 115/165; Elite Four 182/184/186/188; Champion 190.
No special "gauntlet" uniquely at 50/100/150 — those are just normal boss-10 waves.

## Starter cost (src/data/challenge.ts)
`DEFAULT_PARTY_MAX_COST = 10`. Cost 1-10/species. valueReduction lowers cost (candy upgrades).
