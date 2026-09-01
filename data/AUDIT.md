# Roster data audit — 26 Aug 2026

The original `pokemon.json` (258 entries) came from the open community dataset
([otterlyclueless/pokemon-champions-data](https://github.com/otterlyclueless/pokemon-champions-data)),
which was last updated 16 Apr 2026 — just after Champions launched (8 Apr 2026),
and before Regulation M-B shipped. It never got a Reg M-B refresh.

## What was checked

Cross-referenced the full roster against two independent, continuously-updated
sources:
- [Serebii.net's Champions Pokédex](https://www.serebii.net/pokemonchampions/pokemon.shtml)
  and individual per-species pages
- [Bulbapedia's List of Pokémon in Pokémon Champions](https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_in_Pok%C3%A9mon_Champions)

Everything up to dex #248 (Tyranitar) matched exactly. From there on, entries
matched wherever a Pokémon predated Reg M-B, but 36 specific entries were
missing — all of them Reg M-B additions:

- **22 base species** newly made available in Reg M-B (e.g. Sceptile,
  Blaziken, Swampert, Gholdengo, Vileplume, Qwilfish — several of these are
  long-standing Pokémon that simply weren't unlocked in Champions until this
  regulation)
- **14 new Mega Evolutions** added in the same update (on top of Mega Raichu
  X/Y, already added in the previous pass)

All 36 are now in `pokemon.json`, with typing double-checked against Serebii's
individual pages one by one — not just the summary list — since a couple of
third-party guide sites (used only to identify *what* was new, not for typing)
turned out to have errors (e.g. one had Mega Falinks as Fire-type; it's
Fighting-type, unchanged from base).

## What's still open

- Abilities and base stats aren't part of this tracker's data yet, so they
  weren't part of this audit. When the Custom Team Builder starts needing
  them, Mega Scrafty's ability in particular only has single-source
  confirmation and is worth re-checking then.
- This was a targeted audit (looking for what Reg M-B added), not an
  exhaustive re-check of all 296 entries against a third source. Treat the
  dataset as solid, not infallible — the [WinCon Blueprint](../README.md)
  covers why an ongoing verification step belongs in the data pipeline
  rather than a one-time fix.

## Learnset & base-stat gap closed — 26 Aug 2026 (Ranked Season M-5)

Season M-5 is confirmed to still run Regulation M-B rules (it's the third
ladder season to do so — a season name change, not a ruleset change), so the
roster itself didn't move. But the 22 base species + 16 Mega forms added by
Reg M-B (38 entries total, listed above and one more: Mega Raichu X/Y) had no
`learnsets.json` **or** `base-stats.json` entry at all. The learnset gap was
the visible one — the team builder was silently falling back to "show every
move in the game" for any of them — but the base-stat gap was the more
serious of the two: `team-builder.js`'s Auto-build team required both a
confirmed learnset and confirmed base stats before it would touch a Pokémon
at all, so all 38 were silently skipped by Auto-build/Auto-build strategy/
Generate Dream Team even after the learnset half was fixed, with no error —
they just never got built. Caught this by testing Auto-build directly
against a team of newly-learnset-fixed Pokémon and finding every field still
came back blank.

Filled in real base stats for all 38 the same way as the learnsets below —
Serebii's Champions Pokédex pages, cross-checked against a mainline source
(pokemondb.net/Bulbapedia) for the 22 real species, since Champions hasn't
touched base stats for any of them; for the 16 Champions-original Mega forms
(these don't exist in the mainline games, so there's nothing to cross-check
against), corroborated Serebii's own numbers against at least one other
Champions-specific VGC coverage site (pokemon-zone.com, rotomlabs.net, or
similar) before accepting them.

Researched and filled in all 38, species by species, from
[Serebii's Pokémon Champions Pokédex](https://www.serebii.net/pokedex-champions/)
(the per-species "Standard Moves" table is Champions' own curated learnset,
not a mainline movepool) — the 16 Mega forms reuse their base form's learnset
unchanged, matching this file's existing convention for every other Mega
entry (Mega Venusaur = Venusaur's list, etc. — Mega Evolution doesn't grant
new moves, it evolves mid-battle from a Pokémon that already knew them).

While cross-checking each species' moves against `moves.json`'s 494-move
pool, found 6 real, commonly-expected moves that were simply missing from
`moves.json` itself (not banned in Champions, just never added to this
dataset) — including two headline signature moves that made their Pokémon
look considerably weaker without them:
- **Rage Fist** (Annihilape's signature) and **Make It Rain** (Gholdengo's
  signature) — confirmed via
  [Serebii's Champions AttackDex](https://www.serebii.net/attackdex-champions/)
  with Champions-specific stats, which differ from the mainline games (see
  below)
- **No Retreat** (Falinks), **Topsy-Turvy** (Malamar), **Barb Barrage**
  (Qwilfish/Overqwil), **Spirit Break** (Grimmsnarl)

All 6 are now in `moves.json` and added back into the relevant species'
learnsets. Their power/accuracy/PP were pulled from Serebii's Champions
AttackDex rather than assumed from the mainline games, since Champions runs
its own PP scale (confirmed pattern: mainline 5 PP → 8 PP, 10 PP → 12 PP,
15 PP → 16 PP, anything higher → 20 PP, with occasional per-move balance
changes on top — e.g. Make It Rain's Sp. Atk drop is 2 stages in Champions
vs. 1 stage in the mainline games). Also caught and fixed one pre-existing
data bug while validating every learnset's moves against `moves.json`:
Politoed's learnset listed "Pound," which isn't a move Politoed actually has
in Champions per its Serebii dex page — removed.

## Mega Stone item gap closed — 26 Aug 2026

Found while wiring real tournament data into Auto-build (see
"Meta-informed auto-build" in README.md): Auto-build had no concept that a
"Mega X" roster entry must hold its own Mega Stone to be in that form at
all — every Mega Pokémon was instead getting an item from the generic
role/format pools (Choice Scarf, Life Orb, Leftovers, whatever the
heuristic would give any other Pokémon of its speed/bulk), which makes no
sense for something that's already Mega Evolved.

While building the species → Mega Stone lookup needed to fix this, found 9
Mega Stone items already in `items.json` by name but with a **blank
description** — `Golurkite`, `Meowsticite`, `Scovillainite`,
`Glimmoranite`, `Raichunite X`, `Raichunite Y`, `Staraptite`, `Chimechite`,
and `Crabominite` — the same "entry exists, content doesn't" pattern as the
Politoed move bug above, just in `items.json` instead of `learnsets.json`.
All 9 belong to Champions-original Mega forms (Golurk, Meowstic, Scovillain,
Glimmora, Raichu ×2, Staraptor, Chimecho, Crabominable all lack an official
mainline Mega Evolution, same as several of the Reg M-B Megas above), which
is presumably why they were left blank rather than filled from a mainline
source. Wrote real descriptions for all 9, matching this file's existing
"If held by a/an X, this item allows it to Mega Evolve in battle." phrasing
exactly (confirmed against `Charizardite X`/`Charizardite Y`, `Mewtwonite
X`/`Mewtwonite Y` for how this dataset phrases a species with two different
named stones for two different Mega forms).

With those 9 fixed, every one of the 75 "Mega X" roster entries resolves
to exactly one real stone item — verified programmatically by parsing each
stone's own "If held by..." text back against the roster rather than by
hand, so the mapping can't silently drift from `items.json` if either file
changes later (see the species → stone map at the top of `strategy.js`'s
"Milestone 10" section).

## Real tournament data sourced for auto-build — 26 Aug 2026

Requested: research the last 3 Pokémon Championships (strategies, teams,
movesets, synergies) and feed it into auto-build/auto-strategy. What's
actually true as of this writing: Play! Pokémon's own materials say VGC
only starts using the Pokémon Champions engine at the 2026 World
Championships (Aug 28–30, 2026) — a few days after this was written — and
every Regional/International Championship before that ran on the previous
mainline game. There is no "last 3 Pokémon Championships" played on this
game yet.

What exists instead, and what this used: aggregated Regulation M-B
tournament results and usage stats from
[Pikalytics](https://www.pikalytics.com/tournaments) and
[Pokémon Zone](https://www.pokemon-zone.com/champions/tournaments/) —
dozens of real, recent (mid-to-late August 2026) community tournaments run
on Limitless, plus their aggregate usage/best-teams pages, which is a
larger and more current sample than 3 individual events would give. Per-
Pokémon move/item/ability figures were cross-checked against a second
source (Pokémon Zone, or a WebSearch for community VGC coverage) before
being used, and exact move/item spelling was verified against `moves.json`
and `items.json` — this surfaced one soft disagreement worth flagging:
sources differed on Kingambit's most common item (Chople Berry vs. Black
Glasses) and part of Farigiraf's moveset (Helping Hand vs. Thunderbolt as
the 3rd slot); the higher-usage/more-thematically-explainable option was
used in each case, and the runner-up is noted in `strategy.js`'s own
comments for anyone who wants to try the alternative by hand.

This is real, current data, not the official Championship Series result
the request asked for — worth re-running this research once real Pokémon
Champions Regionals/Internationals/Worlds results start existing, since
those will be a stronger source than community tournaments once they do.

## Base ↔ Mega Pokémon relationship verified — 26 Aug 2026

Milestone 11 stopped treating the 75 "Mega X" roster entries as
independently obtainable/pickable Pokémon (see README.md) — a base
species' Mega form(s) are now derived, not separately tracked. That
derivation (`megas.js`) needed a reliable way to link each Mega entry back
to its base species, so this was checked programmatically rather than
assumed:

- `data/pokemon.json`'s `form` field takes 5 values: `Base` (208),
  `Mega` (73), `Regional` (13), and `Mega X`/`Mega Y` (1 each — a couple
  of species split their Mega Evolution the same way Charizard does).
  "Mega-like" (any of the three Mega variants) totals 75, matching the
  known count.
- Every Mega-like entry shares its `dexNumber` with **exactly one**
  `form: "Base"` entry — verified for all 75, zero exceptions. That
  `Base` entry is the one linked back to as its Mega form's base species.
- This mattered because a same-`dexNumber` match alone isn't always
  unique: Slowbro (dex #80) has three entries sharing that number —
  `Slowbro` (`Base`), `Galarian Slowbro` (`Regional`), and `Mega Slowbro`
  (`Mega`). Mega Slowbro's own typing (Water/Psychic) matches plain
  Slowbro, not Galarian Slowbro (Poison/Psychic) — confirming `form:
  "Base"` specifically (not just "not a Mega form") is the correct way to
  find a Mega's base species, which is what `wcBaseFormOf`/
  `wcEffectivePokemon` in `megas.js` do.

No new data gaps were found in this pass — the roster's existing
`dexNumber`/`form` fields were already sufficient once the "Base"-not-
"non-Mega" distinction above was made explicit.

## Ability data added — `data/abilities.json` — 26 Aug 2026

Every roster entry got a real ability for the first time (see README.md's
Milestone 13 section) — `pokemon.json`/`base-stats.json` have never carried
an `ability` field at all, so this was a from-scratch sourcing pass across
all 296 roster entries (221 base + 75 Mega), not an extension of an
existing field.

**Mega forms (75 of 75).** Sourced from two Champions-specific pages:
[Serebii's Mega Evolution abilities page](https://www.serebii.net/pokemonchampions/megaabilities.shtml)
(covers the Champions-exclusive/added Mega roster, including brand-new
signature abilities that don't exist in mainline games) and
[Beebom's Mega Evolution abilities guide](https://beebom.com/pokemon-champions-mega-evolution-abilities/)
(covers the classic mainline-style Megas). Together these two sources
named 69 of the 75. The remaining 6 — Mega Blaziken, Mega Mawile, Mega
Metagross, Mega Sceptile, Mega Swampert, and one further cross-check gap —
were filled from well-documented, unambiguous mainline-game precedent
(Speed Boost, Huge Power, Tough Claws, Lightning Rod, Swift Swim), since
these are long-established, extremely well-known competitive Mega
abilities, not a guess. Every Mega ability was matched by exact roster
name against `data/pokemon.json` and cross-checked for exactly 75/75
coverage with no duplicates — see the merge script's own validation pass.

A handful of Champions-exclusive signature abilities named by Serebii
(Mega Sol, Dragonize, Piercing Drill, Eelevate, Fire Mane, Spicy Spray —
all belonging to Champions-added Mega forms with no mainline equivalent)
had no further mechanical detail available from either source. Their
ability *names* are sourced and correct; their plain-English
*descriptions* in `abilities.json` are this project's own best inference
from the ability's name and the Pokémon's kit, flagged `"confidence":
"low"` so that distinction isn't lost — same honesty rule as everywhere
else in this file.

**Base-form Pokémon (221 of 221).** No single page covers all 221 at
once, so this was split into 3 batches of ~75 and researched in parallel
against Bulbapedia, Serebii, PokemonDB, and (for genuinely contested
picks, where a Pokémon has more than one plausible competitively-relevant
ability) Pikalytics' live usage-rate data — e.g. Sandaconda's Sand Spit
over Shed Skin (99.9% usage), Weavile's Pressure over Pickpocket (85.1%),
Tinkaton's Mold Breaker over Own Tempo (96.7%). 23 entries are flagged
`"confidence": "low"` — genuinely ambiguous cases where two real abilities
are both plausible and usage data didn't clearly settle it, or where
usage-rate tracking simply wasn't available for that Pokémon (e.g.
Roserade, Starmie, Steelix, Tauros). The full list of low-confidence
entries is enumerable directly from the data (`grep '"confidence"'
data/abilities.json`) rather than duplicated here, since the data file
itself is the source of truth and this list would otherwise go stale.

**How this feeds the strategist.** `strategy.js`'s Milestone 12
`WINCON_AUTO_WEATHER_ABILITY` was a hand-typed list covering only Mega
Charizard Y's Drought, because nothing else had been sourced yet at the
time. With every ability now sourced, that became a real, general lookup
by ability name (`WINCON_WEATHER_SETTING_ABILITIES`) — see README.md's
Milestone 13 section for the full list of what auto-build/auto-strategy
now does with this data (weather-setting abilities generalized to sand
and snow, type-converting abilities like Pixilate scored correctly,
Contrary's self-stat-drop bonus, Protean/Libero's guaranteed STAB). This
also caught and fixed a factual error already sitting in
`WINCON_META_KNOWN_SETS["Mega Staraptor"]`, which claimed its ability was
Intimidate — it's actually Contrary.
