# WinCon

A team-building assistant for Pokémon Champions. Still no build step —
open the HTML files (or point a static host at the folder) — but as of
Milestone 15 onward it's backed by a real account system and a Supabase
database, not just `localStorage`. Five pages now, not three; see below.

## What's in here

- `index.html` / `home.js` — the **Home** dashboard (added between
  Milestones 16 and 17): your overall win/loss record, your best Singles
  and Doubles team, your 5 most-used Pokémon across every saved team, an
  auto-advancing carousel of the Pokémon you've obtained, and a Wishlist
  carousel suggesting what to obtain next (ranked by how much it'd improve
  your best team's type coverage, or a rotating set of Mega Pokémon if you
  don't have a team yet)
- `pokedex.html` / `app.js` — the **Pokédex tracker**: check off every
  Pokémon you've obtained (this used to be `index.html` itself, before the
  Home dashboard above took that slot)
- `singles-builder.html` / `doubles-builder.html` / `builder.js` — the
  **Singles Builder** and **Doubles Builder** (Milestone 14, replacing the
  old separate Team Builder and Matchup Score pages): one page per
  competitive format, each doing all of the following for whichever of
  your (shared, up to 5) teams is tagged for that format —
  - pick 6 obtained Pokémon and set each one's Nature, item, ability, up
    to 4 moves, and Stat Point spread, by hand, with **Auto-build team**
    and **Auto-build strategy** (two separate steps that fill in all 6 and
    then propose a shared team strategy), or with **Generate Dream
    Team**, which picks the 6 for you too and runs the whole flow in one
    click
  - a live **Matchup Score** against every Pokémon on the full roster,
    your toughest matchups, a full matchup matrix, and a **team type
    coverage** breakdown against all 18 attacking types — all re-scored
    as you edit the team above, not a separately-selected saved team on
    another page
  - **Your Rival** — a hypothetical 6-Pokémon team synthesized from the
    *entire* Champions roster (not just what you've obtained), picked
    specifically to give your current team its hardest possible matchup,
    plus an estimated success rate, with individual members swappable
  - an **Open/Closed Team Sheet** toggle modeling the real difference
    between the online ladder (nobody's seen your set) and tournament
    play (your opponent has your full sheet ahead of time) — see the
    Milestone 14 section below
  - a compact win/loss percentage for the active team, reading the same
    logged record as Battle Tracker below (Milestone 28 moved the actual
    log-a-result form and history off this page and onto its own)
- `battle-tracker.html` / `battle-tracker.js` — the **Battle Tracker**
  page (Milestone 28): log a real game's win or loss for any of your
  saved teams, with an optional note and opponent lineup, and see a
  combined summary across every team plus that one team's own record,
  streak, and full history
- `stats.js` / `type-utils.js` — small shared modules (stat-calculation
  math, type-effectiveness lookups) used by more than one page, so the
  formulas can't quietly drift apart between them
- `auth.js` — accounts: sign up (name, 16+ age, username, starting
  avatar) and sign in with email + password, a forgot-password flow, the
  account-info popup, and the shared sign-in-required prompt every locked
  feature reuses (Milestones 15/16/24/25)
- `theme.js` — the color-theme picker (default, Charizard, Fairy, Water,
  Grass, Electric); saved to your account, not just the browser
- `teams.js` — shared multi-team storage: up to 5 named teams (each with
  its own format tag, sheet-mode tag, free-text notes, and logged
  win/loss record). Synced to your Supabase account across every device
  signed into it (Milestone 22), with a `localStorage` fallback if you're
  signed out or the network's unavailable. Every individual logged result
  also gets pushed, fire-and-forget, into a shared `match_results` table
  (Milestone 28) that feeds `meta_usage_stats` — see below
- `megas.js` — the base-species ↔ Mega-form relationship every page
  shares (Milestone 11): which Mega form(s) a base Pokémon has, which Mega
  Stone belongs to which Mega form, and which of the two a build slot
  should currently be treated as
- `strategy.js` — the auto-build engine: a set of explainable rules (not
  a search over every possible build) that picks a build for one
  Pokémon, then — as a separate step, once every field is filled in —
  analyzes the finished team for a shared strategy; also the Dream Team
  picker (a greedy heuristic for choosing which 6 to build in the first
  place, reused in reverse by Your Rival) and the Matchup Score formula
  both builder pages share. As of Milestone 28, its picks can also be
  nudged by real, anonymized, cross-user battle results once enough have
  been logged — see that section below
- `styles.css` — shared visual styling (colors are defined once, at the
  top, as variables — that's what makes light/dark mode, and every color
  theme, work)
- `supabase-config.js` and `supabase/migrations/*.sql` — the Supabase
  project URL/anon key and the full database schema, in the order it was
  built: `0001_init.sql` (Milestone 15's foundation — profiles, teams,
  match_results, meta_usage_stats, friend requests, notifications, push
  subscriptions), `0002_profile_details.sql` (Milestone 16's username/
  name/age/avatar fields), `0003_color_theme.sql` (the account-level color
  theme), `0004_team_match_log.sql` (Milestone 22's `teams.match_log`
  mirror column), and `0005_meta_usage_stats.sql` (Milestone 28's
  cross-user aggregation trigger). Each one needs to be pasted into
  Supabase's own SQL Editor and run once, in order, on a fresh project —
  see "Putting it on the internet" below
- `data/` — roster, moves, items, Natures, learnsets, base stats, and the
  type chart, trimmed from the open
  [Pokémon Champions Data](https://github.com/otterlyclueless/pokemon-champions-data)
  project (CC BY 4.0), plus `AUDIT.md` (36 entries added after an audit
  against Serebii/Bulbapedia), `starter-threats.json` (see below),
  `ability-options.json` + `ability-dex.json` (Milestone 17's real
  per-species ability choices), and `sprites.json` + `sprites/` (296
  sprite PNGs from PokeAPI, see Milestone 4 below for the sourcing/
  cross-check methodology)

Every page reads and writes the same account-synced team/Pokédex state
once you're signed in, so checking off a Pokémon on the Pokédex makes it
available on both builder pages, and each builder page's live sections
all read the team you're actively editing on it. **Most of the real
functionality here requires a free account (16+)** — Milestones 24/25
locked saving, auto-generation, build details, Matchup Score, Your Rival,
and Battle Tracker behind sign-in, since none of it had anywhere durable
to persist without one anyway. Picking Pokémon on the Pokédex and up to 6
onto a team still works while signed out, capped at 6, and — since
Milestones 26/27 fixed an earlier privacy gap — that signed-out preview is
forgotten the moment the tab closes rather than saved to the browser
indefinitely.

## Multi-team saves (Milestone 3)

Team Builder now keeps up to **5 named teams** instead of one draft. Tabs
at the top of the page switch between them; "+ New team" adds one (grayed
out once you're at 5); "Rename" saves whatever's in the name field; and
"Delete this team" removes the currently open one (always keeps at least
one team around). Switching or adding a team auto-saves whatever you were
editing on the one you're leaving, but it's still worth clicking **Save
team** after any changes you want to keep. Matchup Score gets a "Viewing
team" dropdown once you have more than one saved team, so you can check
the score and type coverage for any of them, not just whichever is active
on the builder page.

## Auto-build team (Milestone 3, split from strategy in Milestone 6)

Once all 6 slots are picked, **Auto-build team** picks a build for each
Pokémon independently — no shared team strategy involved yet. For each
one: a primary offensive stat (Attack or Sp. Atk, whichever is higher), a
fast/bulky role (based on base Speed), a Nature and Stat Point spread
that support that role, an item (see the Item Clause section below for
how it avoids repeats), and up to 4 moves — scored by how well they hit
the reference threat list (`data/starter-threats.json`),
same-type-attack-bonus, whether they match the Pokémon's offensive
category, and raw power, with a soft cap of 2 moves per type so a set
isn't all one type.

This is a strong starting point built from explainable rules — not a
claimed-optimal build from every possible combination — and everything it
fills in can still be hand-edited afterward. (Auto-build used to skip any
of your 6 that were part of the 36 Reg M-B roster additions missing
learnset/base-stat data — see "Learnset & base-stat gap closed" below,
that gap's closed now and all 296 Pokémon build normally.)

## Team type coverage (Milestone 3)

On the Matchup Score page, below the reference-threat score, "Team type
coverage" checks your six Pokémon's own types against all 18 attacking
types (independent of the reference threat list) and shows the top 3
shared strengths (types most of your team resists or is immune to) and
top 3 shared weaknesses (types most of your team is weak to), each with
the specific members responsible. "Show full 18-type breakdown" expands
into every type, every member, with the exact multiplier.

## Competitive format tag & sprites (Milestone 4)

Each saved team is now tagged **Doubles** or **Singles** (Doubles by
default) via a toggle at the top of the Team Builder, right under the
team tabs. It saves the moment you click it — no need to hit "Save team"
first. This tag feeds Auto-generate (see below); it isn't used anywhere
else yet, so Matchup Score doesn't change based on it.

Every Pokémon you can pick — in the picker grid, and again on its build
card once picked — now shows its sprite. The tracker's Pokédex cards got
one too, for consistency. Sprites come from
[PokeAPI](https://pokeapi.co)'s community-maintained sprite set (accessed
through its GitHub mirror), which turned out to already include the
handful of Champions-exclusive new Mega Evolutions on this roster. Every
one of the 296 roster entries was resolved and **cross-checked twice**
against its own name before being accepted, not just matched by a
best-guess slug:

1. The species record's own official English display name (a field in
   the data itself, not just the URL/slug used to fetch it) has to match
   the roster's base Pokémon name.
2. For prefixed forms — Mega, Mega X/Y, Alolan, Galarian, Hisuian,
   Paldean — the specific variant actually chosen has to be confirmed a
   second way: its own official English form name has to match (or
   contain) the roster's full name, and where a prefix is ambiguous
   between more than one variant (e.g. Paldean Tauros' three breeds),
   its listed types are compared against the roster's types to pick the
   right one.

All 296 passed both checks; none were force-matched or left as a guess.
If a sprite is ever missing or fails to load, it just doesn't render —
nothing else on the page depends on it.

## Format-aware auto-generate (Milestone 4)

Auto-generate still considers tools from **both** formats — it never
hard-filters based on the tag — but leans its choices toward whichever
format the active team is tagged as:

- **Items:** Doubles favors Choice Scarf (fast attackers) and Sitrus
  Berry (bulky ones); Singles favors Life Orb and Leftovers instead.
- **Moves:** spread moves (hit both opposing Pokémon) and Doubles-support
  moves (Wide Guard, Quick Guard, Tailwind, Trick Room) score higher for
  Doubles; entry hazards and single-target utility (recovery, pivot
  moves, status) score higher for Singles.
- **Ally-dependent moves** (Follow Me, Rage Powder, Helping Hand, and a
  few others that are detected automatically from each move's own
  description text rather than a hand-typed list — see `strategy.js`)
  are heavily deprioritized for Singles, since they do nothing without
  an ally on the field, but still favored for Doubles.
- **Team strategy detection** checks the same Trick Room / Tailwind /
  weather archetypes either way, but only offers Follow Me / Rage Powder
  redirection as the team's strategy for Doubles (it's non-functional in
  Singles); Singles instead checks for a shared **entry hazards**
  archetype (Stealth Rock, Spikes, Toxic Spikes, Sticky Web).

None of this is an exclusive filter — a Doubles team can still end up
with Leftovers if that scores highest overall, and vice versa — it's a
weighted lean, same "explainable rules, not claimed-optimal" approach as
the rest of Auto-generate.

## Item Clause (Milestone 5)

Pokémon Champions runs the same Item Clause real VGC and Singles do: no
two Pokémon on **one team** can hold the same item. This is now enforced
two ways:

- **Auto-generate never produces a clash.** It hands each Pokémon the
  best-fitting item from an ordered, role/format-specific list (e.g. a
  Doubles fast attacker tries Choice Scarf, then Choice Band, then Life
  Orb, and so on down the list) and skips anything an earlier teammate
  on the same team already has — so a full 6-member auto-generated team
  always comes out with 6 different items, never a repeat.
- **Hand-typed items are checked live.** Item is still a free-text field
  (so you can type anything in the dataset), so every item field on the
  page is re-checked against every other one — case- and
  whitespace-insensitive, so "choice scarf " and "Choice Scarf" still
  count as a clash — the moment any of them changes. A clash gets a red
  border and an inline "Also held by ..." note on both fields involved,
  and **Save team** refuses to save while any clash exists.

## Auto-build strategy & "Make changes" (Milestone 6)

Auto-generate used to fill in every field *and* apply a team strategy in
one pass — which meant it could force one member into a Trick Room role
just because it could learn the move, even when most of the rest of the
team was already built for speed and would only get worse under Trick
Room's reversed turn order. Judging "is this strategy good for this
team" needs a finished team to judge, not blanks being filled in at the
same moment — so this is now two deliberate steps:

- **Auto-build team** fills in all 6 independently (see above).
- **Auto-build strategy** only unlocks once every field on all 6 is
  filled in — Nature, item, all 4 moves, all 66 Stat Points, and no
  duplicate items — and any hand-edit afterward (a move, a Nature, an
  item, a Stat Point) re-locks it until the team is complete again,
  since a stale recommendation could point at fields that no longer
  exist. Once unlocked, it reads each Pokémon's **actual** built role
  (fast vs. bulky — from its real Stat Point spread, not just its base
  Speed) and **actual** chosen moves, and only recommends:
  - **Trick Room**, if more of the team is already built bulky/slow
    than fast (otherwise it'd hurt more teammates than it helps — this
    is the specific fix for the problem above);
  - **Tailwind**, weighted by how many teammates are already built fast
    enough to benefit from doubled Speed;
  - **Sun or Rain**, only if a teammate's actual chosen moveset (not
    just its typing) includes a move that benefits from that weather;
  - **Redirection** (Doubles) or **entry hazards** (Singles), as lighter
    fallbacks, same as before.

  Whichever scores best gets recommended; if nothing clears a net
  positive for the team, it says so and recommends independent
  attackers instead — same as before, but now backed by an actual
  reason rather than "well, someone could learn it."

If running the recommended strategy needs an actual change (a move,
role/Nature/Stat Point swap, or item swap on the one member it affects),
a **Make changes** button appears in the strategy note; if the build
already fits as-is, that button is skipped in favor of a one-line "no
changes needed" note. Clicking it asks whether to apply the change to
**this team** or save it into an **open team slot** instead, leaving the
original untouched — and if there's no open slot (all 5 are already
saved), it warns first that applying will overwrite this team's current
build, and asks for confirmation before doing so.

## Move type & category display (Milestone 7)

Every move field on a build card now shows a small "Type · Category"
line underneath it once it holds a move the app recognizes — e.g.
"Fire · Physical" for Flamethrower, "Electric · Status" for Thunder
Wave. The field's own border also picks up that type's color, using the
exact same 19 type colors used everywhere else on the site (the Pokédex
type tags, the type coverage table) — one set of color variables feeds
both, so they can't drift into two different shades of "fire orange."
Clearing a move field or typing something that isn't a recognized move
name clears both the line and the border color rather than showing
stale information.

## Generate Dream Team (Milestone 8)

A single button, above the picker, that runs the whole Team Builder flow
in one click: picks the best 6 from your obtained Pokémon, builds all 6
(same as Auto-build team), analyzes a shared strategy (same as Auto-build
strategy), and applies any amendments straight away — no "Make changes"
prompt, since this is building a team from scratch rather than tweaking
one you already have work in. It overwrites whatever's currently picked
and built on the active team, so make a new team tab first (the existing
"+ New team" button) if you want to keep what's there.

**How it picks the 6:** greedily, one Pokémon at a time — not an
exhaustive search over every possible 6-Pokémon combination, which is
computationally out of reach for a roster of any real size (a pool of
just 50 already has over 15 million distinct 6-Pokémon teams). At each
step it scores every remaining eligible Pokémon (obtained, with confirmed
base-stat/learnset data — same bar as auto-build) on: how well its typing
answers `data/starter-threats.json` both offensively and defensively (the
same reference list the Matchup Score page and auto-build's move scoring
use), how much it patches whichever attack types the team-so-far has no
real answer to yet (the same "net score" idea behind the Matchup Score
page's type coverage panel), its raw base-stat total as a lighter
tiebreaker, and a small penalty for exactly duplicating a teammate's
typing so the six don't collapse into near-copies of each other — then
takes whichever candidate scores highest and repeats. A "Why these six"
note explains each pick afterward. Needs at least 6 obtained Pokémon with
confirmed data to run at all; it says so (and how many you currently
have) if you're short.

Same honesty note as the rest of auto-build: this is a strong, explained
starting point from a greedy heuristic, not a claimed-optimal team out of
every possible combination — everything it fills in can still be
hand-edited afterward.

## Two honesty notes on the Matchup Score

**It's not live usage data.** The 16 Pokémon it checks your team against
(`data/starter-threats.json`) are a hand-picked reference set — strong,
recognizable Pokémon spanning different types and roles — not the actual
current Reg M-B Doubles meta. There's a free, no-auth API
([championsbattledata.com](https://championsbattledata.com/api_guide))
that has the real thing, but fetching it hit a fetch-tool permission
timeout in the environment this was built in rather than a real dead end
— it's worth another attempt (or a plain browser fetch) before assuming
it doesn't work, and swapping the starter list for it is the highest-value
next change to this feature specifically.

**The stat math is a well-corroborated approximation, not an officially
sourced one.** Champions replaced EVs and IVs entirely with its own 0–66
Stat Point pool (32/stat cap, IVs fixed at 31 for everyone) — this was
still described as "community-unverified" through Milestone 28. Milestone
29's Showdown-format import/export work re-checked it against two
independent Pokémon Champions mechanics guides, both of which describe
exactly this system (66 total, 32/stat cap, fixed 31 IVs) and confirm 1 SP
≈ 8 EVs (so 32 SP ≈ 252 EVs) under the hood, which is the standard
Pokémon stat formula this always used. Corroborated by two independent
sources now, not just one community dataset's own notes — but still
nothing from an official Game Freak/Pokémon Company document, so kept
here as "well-corroborated" rather than "confirmed."

Neither of these makes the score useless — it still catches real type
weaknesses and rewards actually filling in a team's moves and Nature —
and the second is on considerably firmer ground now than when this was
first written.

## Hover tooltips for Item & Move fields (Milestone 9)

Hovering a filled-in Item field on a build card shows that item's effect
(from `data/items.json`) in a small floating box; hovering a filled-in Move
field shows that move's type, category, power, accuracy, PP, and effect
text (from `data/moves.json`), with the box's own accent color matching the
move's type — the same color the field's border already uses. It's a dark,
semi-transparent panel by design (readable regardless of the site's own
light/dark theme) and it's mouse-hover only, on purpose, so it never
competes with the browser's own suggestion dropdown on these fields. It
disappears the instant the cursor leaves the field, and follows the field
rather than vanishing if the page scrolls while it's showing.

## Learnset & base-stat gap closed (26 Aug 2026)

The 38 Pokémon added during the roster audit (`data/AUDIT.md`) — the 22 Reg
M-B base species plus their Mega forms — had no `learnsets.json` or
`base-stats.json` entries at all, which silently gated them out of
Auto-build team/strategy and Generate Dream Team (both require confirmed
base-stat and learnset data), and made the Matchup Score fall back to
typing-only matchups for them. Researched and filled in all 38 for both
files, cross-checked against multiple independent sources per entry —
see `data/AUDIT.md` for the full writeup, including 6 real moves (two of
them signature moves, Annihilape's Rage Fist and Gholdengo's Make It Rain)
that turned out to be missing from `data/moves.json` entirely and got added
with their Pokémon Champions-specific (not mainline) power/accuracy/PP.
All 296 Pokémon now have complete data across every file this app uses.

## Meta-informed auto-build (Milestone 10)

Auto-build team/strategy and Generate Dream Team were, until now, running
entirely on explainable general-purpose rules (type coverage, STAB, raw
power, fast-vs-bulky role) with no awareness of what's actually winning
real games right now. This milestone feeds in real Regulation M-B
tournament results on top of those rules — it doesn't replace them.

**What was researched.** There's no "Pokémon Champions World Championship"
to look back on yet — Play! Pokémon's own materials say Worlds only moves
to the Pokémon Champions engine for the first time on August 28–30, 2026,
a few days after this was written, and every Regional/International before
that ran on the previous mainline game. So instead of the last 3 official
Championship Series events, this pulls from aggregated recent Regulation
M-B tournament results and usage stats — [Pikalytics' Reg M-B tournament
and usage pages](https://www.pikalytics.com/tournaments) and
[Pokémon Zone's Champions tournament, team, and metagame
pages](https://www.pokemon-zone.com/champions/tournaments/) — a genuinely
bigger and more current sample than 3 events would give (dozens of
tournaments, hundreds of games), cross-checked against each other and
against Serebii's Champions AttackDex/Pokédex for exact move/item names.
That's a real, worthwhile substitute for "the last 3 championships," not a
shortcut around the request — but it's community tournament data, not an
official Play! Pokémon result, and it's a snapshot of late August 2026 that
will drift as the metagame does.

**What changed as a result:**
- **Standout Pokémon get their real set.** Ten Pokémon that show up
  constantly on winning teams right now — Kingambit, Whimsicott, Farigiraf,
  Garchomp, Basculegion, Sylveon, Grimmsnarl, and the Mega forms of
  Charizard (Y), Floette, and Staraptor — get their actual commonly-used
  moves and item on Auto-build/Dream Team instead of the generic
  heuristic's guess, whenever that move is legal for them and the item
  isn't already taken by an earlier teammate (Item Clause still applies).
  Everything else on the roster still goes through the general-purpose
  rules — this is a short, high-confidence list, not a claim that all 296
  Pokémon now have a "real" competitive set.
- **A "real tournament synergy" note.** After Auto-build strategy runs, if
  your team overlaps a known real-tournament core by 2 or more Pokémon
  (e.g. Kingambit + Whimsicott + Basculegion + Garchomp, or Mega Charizard
  Y + Garchomp), a second note appears alongside the main strategy
  recommendation explaining the real-world synergy — this is additive, not
  a replacement for the existing Trick Room/Tailwind/weather/redirection/
  hazards check, since a team can have both a real-world core and a
  detected mechanical archetype at once (as it does in the example above:
  Whimsicott's Tailwind is both).
- **Every Mega Pokémon now holds its own Mega Stone.** Researching real
  sets surfaced a real, pre-existing gap this fix depended on: Auto-build
  had no concept that a "Mega X" Pokémon must hold its own stone to be in
  that form at all, so it was handing Mega Pokémon an item from the
  generic pools instead (a Mega Charizard Y coming out of Auto-build with
  a Choice Scarf, say). Fixed for all 75 Mega entries on the roster, not
  just the 3 in the list above — see `data/AUDIT.md` for the mega-stone
  item data bug this also caught and fixed along the way.

Same honesty note as the rest of auto-build: everything here can still be
hand-edited afterward, and none of it is presented as an unbeatable,
optimal answer — just a stronger starting point, now informed by what's
actually being played.

## Two strategy options, team notes, item-triggered Mega Evolution, and a win/loss tracker (Milestone 11)

Four changes, all from the same round of feedback:

**Auto-build strategy now offers up to two options.** Players kept seeing
Tailwind recommended over and over with nothing else to consider. The
underlying engine already scored every archetype it checks (Trick Room,
Tailwind, Sun, Rain, redirection/hazards) — it just only ever surfaced the
single highest-scoring one. Now, whenever the team genuinely supports a
second one too, an **Alternative strategy** box appears underneath the
primary recommendation with its own "Use this instead" button, which swaps
which option is primary (and which becomes the alternative) rather than
juggling two "Make changes" flows side by side.

**A free-text "Team notes" field**, above the format toggle, for what you
actually want out of a team — e.g. "no trick room" or "I want a fast
offense team." Auto-build strategy reads it before ranking archetypes: a
strategy explicitly asked for gets weighted up (and is more likely to win
or show up as the alternative); one explicitly ruled out is dropped
outright, not just deprioritized. This is deliberate keyword matching on a
short, documented list of phrases (see `WINCON_NOTES_KEYWORDS` in
`strategy.js`) — not language understanding — so it stays predictable and
inspectable, the same "explainable rules" standard as the rest of
auto-build. It won't catch every way of phrasing a preference; it's meant
to catch the obvious, common ones.

**Mega Pokémon are no longer separately tracked or picked.** Until now,
all 75 Mega entries were independent roster entries with their own
Pokédex checkbox and Team Builder picker chip — which isn't how Mega
Evolution actually works: you obtain the base species, and it becomes its
Mega form only by holding that exact species' own Mega Stone mid-battle.
So now:
- The Pokédex tracker only lists the 221 base/regional-form Pokémon — a
  base Pokémon with a Mega form says so right on its card, and once it's
  checked off, its Mega form(s) become usable in the Team Builder with no
  separate checkbox needed.
- The Team Builder picker only offers base species too. Pick Charizard,
  and its single build slot is what can become Mega Charizard X or Y —
  not a second, separate slot.
- **The item field is the trigger.** A slot displays and builds as its
  base form for any item except its own Mega Stone(s) — hold Charizardite
  Y and that slot becomes Mega Charizard Y (its own types, base stats,
  and sprite) right away; change the item to anything else (or clear it)
  and it reverts to Charizard. A small "Mega Evolved" badge shows on a
  slot while this is active.
- **Auto-build will opt a Pokémon into a Mega form on its own** — but
  only where Milestone 10 already established a real, tournament-informed
  set for that specific Mega (Mega Charizard Y, Mega Floette, Mega
  Staraptor). It won't guess a good build for the other ~60 Mega forms
  with no real data behind them; those stay in base form under
  Auto-build unless you hand-assign one of their stones yourself.
- Every base ↔ Mega pairing (and, for the one edge case — Slowbro,
  Galarian Slowbro, and Mega Slowbro all share a Pokédex number — which
  of the two non-Mega forms is the real "base") was derived from
  `data/pokemon.json`'s own `dexNumber`/`form` fields and verified
  programmatically, not hand-typed — see `data/AUDIT.md`.

**A real-time win/loss tracker on the Matchup Score page.** "Track your
results," above the matchup score itself, lets you log a win or a loss
(with an optional short note, e.g. "vs Trick Room") for whichever team
you're viewing. It's a running count stored with the team — not a
simulation, and it doesn't know anything about the opponent's actual
team — so it's there for you to reference, not something the app
reasons about on its own. The same record shows next to that team's notes
field on the Team Builder page, since that's where you're actually
deciding its strategy; if a team's record suggests something specific is
going wrong, that's exactly the kind of thing worth writing into its notes
field above so Auto-build strategy can act on it.

## Milestone 11 follow-up fixes (26 Aug 2026)

Four fixes from a round of feedback on Milestone 11 itself:

**Pokédex card readability.** A card's name could get clipped mid-word
(e.g. "Alolan Ninet…") and, on any card with two type tags, the second tag
could spill past the card's own right edge into its neighbor's space.
Both were CSS sizing bugs — names now wrap onto a second line instead of
truncating, and type tags wrap onto their own row inside the card instead
of overflowing it.

**The strategy box now only appears when you ask for it.** Generate Dream
Team used to run Auto-build strategy automatically as its last step, so
the "Recommended strategy" box showed up whether you wanted it yet or not.
It now stops at picking and building the 6, exactly like Auto-build team
does — click **Auto-build strategy** when you're ready to see it, same
button, same step, for every path through the page. If the Team notes
field is left empty either way, Auto-build strategy still runs and falls
back to whichever recommendation scores best on its own merits — leaving
notes blank was already supported, this didn't need a change.

**Opponent's team is now optional on the win/loss tracker.** Logging a
result never required anything about the opponent, and still doesn't —
but there's now an optional, collapsed-by-default "+ Add opponent's team"
section on the Matchup Score page if you want to jot down what they
brought. Every field in it can stay blank; when filled in, it's stored
alongside that logged result and shown next to it on both the Matchup
Score and Team Builder pages, but — same honesty rule as the win/loss
count itself — it's not fed into any scoring or strategy recommendation.

**A themed background.** Every page has a faint scattering of Mega
Pokémon behind its content — the same fixed set of 8 on all three pages:
Mega Charizard X and Y, Mega Raichu X and Y, Mega Greninja, Mega Gengar,
Mega Steelix, and Mega Tyranitar. (There's no Mega Pikachu in this
roster, or in the mainline games — Raichu is the one with Mega forms
here, so that's what's used.) This started as a color-shifted, rotating
set of the 9 Mega Evolutions unique to Champions, then was swapped, by
request, for this fixed fan-favorite lineup at true color — no hue-shift
filter, just low opacity, so each one's real palette shows through
without fighting the site's own teal accent.

## Strategy guide improvements, and a real move dropdown (Milestone 12)

Five changes, all from the same round of feedback:

**Generate Dream Team now guarantees a Mega-capable pick — two, when two
genuinely fit.** Before this, whether a Dream Team ended up with a Mega
at all was just whatever fell out of the type-coverage-driven picks.
Now, before that greedy process runs, it first locks in up to 2 spots for
whichever of your obtained Pokémon have a real, tournament-informed Mega
build (currently Mega Charizard Y, Mega Floette, and Mega Staraptor — see
"Meta-informed auto-build" above; this deliberately doesn't guess at the
other ~60 Mega forms with no real data behind them). Two matters
specifically because Champions, like real VGC, only lets you actually
Mega Evolve one Pokémon per battle even if several hold their own
stone — so two Mega-capable teammates means an actual matchup-by-matchup
choice of which one to bring, not a fixed answer every game. A note under
"Why these six" always says where this landed: two guaranteed, one, or
(honestly) none, when nothing in your obtained roster currently qualifies.
Auto-build team (the version that builds your own hand-picked 6, rather
than picking for you) can't swap in a different Pokémon to force this —
it just reports how many of your 6 ended up Mega after building, so you
know either way.

**Two more signals feed the strategy recommendation.** An ability that
sets weather automatically — right now, specifically Mega Charizard Y's
Drought — is now recognized as a weather-setting option in its own right,
and preferred over a move-based setter when both exist, since it costs no
move slot at all (the note says so explicitly). And when a Tailwind
recommendation's setter also knows (or can learn) a pivot move — U-turn,
Volt Switch, Flip Turn, Baton Pass — the note calls out the "Tailwind,
then pivot out" sequencing: set it up, then immediately swap in a
teammate with that Speed boost already active rather than burning a turn
switching in cold.

**Team notes can name a specific Pokémon, not just a strategy.** Writing
something like "I want Skarmory to run this" or "have Whimsicott handle
speed control" in the Team notes field now makes that Pokémon the setter
for whichever archetype it's eligible for — overriding the usual
heuristic (fastest for Tailwind, slowest for Trick Room, and so on) — and
the recommendation's note says so, on top of the existing keyword-based
boost/suppress behavior (e.g. "no trick room") from Milestone 11.

**Move picks lean harder into type variety, without trading away real
strength for it.** Each of a build's 4 moves used to fill in from a
strength-sorted list with a flat "no more than 2 of one type" rule. Now
every remaining slot re-ranks the still-available moves by their real
strength score minus a small penalty for each move of that type already
on the set — status moves count in this exactly the same way an attacking
move does, so Tailwind or Trick Room fills a "type slot" too. The penalty
is deliberately smaller than a normal strength gap, so a genuinely
stronger same-type move still wins outright; this only breaks a near-tie
in favor of variety, never costs the set real power to get it.

**The move field is now a real dropdown, not a datalist.** Clicking (or
tabbing into) a Move field now always opens the full list of that
Pokémon's learnable moves immediately — no typing required first, unlike
a native `<datalist>`, which only ever suggests as you type and can't
show more than plain text per option. Every row shows the move's type
(color-tagged, same palette as everywhere else on the site), category,
and power, and typing narrows the list live rather than hiding it.
Clicking a row (or typing a full valid name and tabbing away) commits the
value the same way either path always has.

## Real abilities, shown and used by the strategist (Milestone 13)

Every one of the 296 roster entries (221 base-form Pokémon + all 75 Mega
forms) now has a real, sourced ability — see `data/AUDIT.md` for exactly
how it was gathered and which entries are lower-confidence. This didn't
exist as a data field at all before now.

**Every build slot shows its ability, with a hover tooltip explaining
it.** Right under a Pokémon's typing on its Team Builder card, a small
"Ability: X" tag now shows its real ability; hovering it explains what
that ability actually does, the same hover-tooltip style already used for
the Item and Move fields. A Mega-Evolved slot shows its **Mega's own**
ability, not its base form's — Charizard shows Solar Power until it's
holding Charizardite Y, at which point the card (and its ability tag)
switches to Mega Charizard Y's Drought.

**Auto-build and Auto-build strategy are ability-aware now, not just
typing/stat-aware.** Several concrete changes in `strategy.js`:
- The Milestone 12 weather-setting-ability check covered only Mega
  Charizard Y's Drought by name, because nothing else had been sourced
  yet. It's now a real lookup by ability name over the full sourced list
  (`WINCON_WEATHER_SETTING_ABILITIES`), so any current or future roster
  entry whose ability is Drought/Drizzle/Sand Stream/Snow Warning
  qualifies automatically — no hand-editing needed per Pokémon.
- **Sand and snow are new strategy archetypes**, alongside sun/rain —
  Sand Stream/Snow Warning are recognized the same free, no-move-slot way
  Drought already was. Since sand/snow don't boost a move's raw power the
  way sun/rain do, "worth having up" here is judged by real ability
  synergy (Sand Rush/Sand Force/Sand Veil; Slush Rush/Snow Cloak/Ice
  Body — genuine Speed-doubling or defensive abilities) and by a teammate
  on the type that passively toughens up while it's active (Rock's
  Sp. Def in sand, Ice's Defense in snow).
- **Move scoring accounts for what a Pokémon's own ability actually
  does**, not just its typing: a type-converting ability (Pixilate,
  Aerilate, Refrigerate) now scores a Normal-type move as its true
  converted type, both for same-type-bonus and threat coverage, since
  that's what actually happens on the field; Protean/Libero score every
  move as same-type, since that's the entire point of the ability; and
  **Contrary gets a real bonus** — not just "no penalty" — on a move
  whose own downside is a self stat-drop (Close Combat, Superpower, Leaf
  Storm, Overheat), since Contrary turns that drawback into a genuine
  upside.
- This surfaced (and fixed) a factual error already sitting in
  `WINCON_META_KNOWN_SETS`: Mega Staraptor's known-good set claimed its
  ability was Intimidate. It's actually **Contrary** — which turns out to
  be a great fit for the Close Combat this set already ran, since Contrary
  flips Close Combat's own Defense/Sp. Def drop into a boost instead, so
  it gets bulkier the more it attacks rather than more fragile.

## Singles/Doubles Builder, Your Rival, and Open Team Sheet (Milestone 14)

Prompted by research into what actually separates casual play from
competitive play — summarized below, this milestone made four changes.

**The Team Builder and Matchup Score pages are merged, one page per
format.** `team-builder.html`/`team-builder.js` and
`matchup-score.html`/`matchup-score.js` are gone; `singles-builder.html`
and `doubles-builder.html` (both running the same shared `builder.js`)
replace them. Each page does the full flow for its own format: pick and
build a team, then see its Matchup Score, team type coverage, results
tracker, and Your Rival, all on one page, all live against whatever
you're currently editing — no more switching pages to see how a change
affected your score. Your up-to-5 shared teams are filtered by format:
Singles Builder only shows/edits teams tagged Singles, Doubles Builder
only Doubles. A "Move to Singles/Doubles builder" button re-tags a team
and moves it to the other page instead of duplicating it — deleting a
team no longer requires keeping at least one around either; a fresh blank
team for that page appears automatically if you delete your last one.

**Your Rival.** Instead of scoring your team against a small hand-picked
reference list, this synthesizes a hypothetical opposing 6-Pokémon team
from the **entire roster** (all 296 base-and-Mega entries, not just what
you've obtained) — picked specifically to counter YOUR team's typing and
stats. Mechanically, this reuses Generate Dream Team's own greedy pick
logic (`wcPickDreamTeam` in `strategy.js`) in reverse: instead of picking
your best 6 against a reference list, it picks the pool's best 6 against
*your team itself*, using your team's own types as the "threats" list.
The result gets a synthesized build too (Auto-build's own logic,
`wcGenerateTeamBuilds`) for narrative/display, plus an estimated success
rate: `100 − (your Matchup Score against them)`, using the exact same
scoring formula (`wcScoreMatchup`) the main Matchup Score section uses,
just with the rival's roster standing in as the "threats." This is a
heuristic, not an unbeatable optimal counter-team — same honesty rule as
Dream Team's own picks.

**Open Team Sheet (OTS) mode.** A real competitive-play distinction: on
the online ladder, nobody's seen your set before Game 1, so an off-type
"tech" move can win purely on surprise. In tournament play, your opponent
has your full team sheet — species, items, abilities, moves — ahead of
time, so that same tech move can't surprise anyone. Each team has its own
Closed/Open Sheet toggle (defaults to Closed, the ladder default), and it
affects two separate things, deliberately reusing one shared idea rather
than two disconnected mechanics:
- **Matchup Score and Your Rival** (`wcScoreMatchup` in `strategy.js`): a
  "favorable" verdict against a given opponent is downgraded to "even"
  under Open Sheet specifically when it depends on a move you've chosen,
  rather than surviving on your Pokémon's raw typing alone — checked by
  re-running the same scoring formula with typing-only offense and seeing
  if it's still favorable. Raw-typing edges (a genuine type advantage no
  set change can undo) are never touched.
- **Move recommendations** (`wcScoreMove`/`wcPickMoves` in `strategy.js`):
  Auto-build now applies a small scoring penalty to a non-STAB,
  non-Status filler move under Open Sheet, since a pure "tech" pick isn't
  worth as much once an opponent can see it coming. Separately, every
  filled-in move field on a build slot gets an **Expected** or **Tech**
  tag once Open Sheet is on (`wcMoveIsExpected`) — Expected covers a
  Status move, a move matching the Pokémon's own (ability-aware) typing,
  or a move that's part of a real known tournament set
  (`WINCON_META_KNOWN_SETS`); anything else is tagged Tech. The tag is
  hidden entirely under Closed Sheet, since a tech move only matters once
  someone can actually see it coming.

**A note on "study the meta."** The research that prompted this milestone
also called out following top VGC creators, analytical sites like Victory
Road, and tournament usage statistics. That's real, ongoing research this
static, offline site can't automate for you — no live network access, no
scraper. What it *can* do is give that research somewhere concrete to
land: `data/starter-threats.json` (the reference threat list both the
Matchup Score and Dream Team's picks are built against) and
`WINCON_META_KNOWN_SETS` in `strategy.js` (the real, sourced sets Auto-
build reaches for) are exactly the two places Milestone 10's tournament
research went in, and where updated meta reads should go as they come in.

## Accounts and cloud sync: Supabase foundation (Milestone 15)

Everything from here through Milestone 28 rests on this milestone, so it's
worth calling out even though it shipped no user-visible feature on its
own. `supabase/migrations/0001_init.sql` created the whole database schema
up front — including several tables nothing would actually use until
milestones later on:

- `profiles` — the private account record (email, and later name/age/
  username/avatar/color theme), readable only by its own owner.
- `profile_public` — a small, deliberately separate table holding just
  the fields a friend should ever see (username, favourite team, avatar
  species). This is the real mechanism, not just a UI convention, behind
  "friends only see your public info" — the database's own row-level
  security enforces it, so a bug in a page's JavaScript can't leak a
  private field the same way it could if there were only one `profiles`
  table with a filtered `SELECT`.
- `teams` — one row per saved team (format, sheet mode, chosen Pokémon,
  builds, notes), the eventual sync target for `teams.js`'s local state
  (Milestone 22 is what actually wires this up).
- `match_results` and `meta_usage_stats` — created here anticipating a
  normalized, cross-user battle-log feature, explicitly commented at the
  time as "rebuilt by a scheduled Edge Function from match_results across
  every user (anonymized aggregate) — this is what eventually replaces
  `starter-threats.json`'s hand-picked list." Nothing wrote to either
  table until Milestone 28 finally built that feature.
- `friend_requests`, `notifications`, and `push_subscriptions` — schema
  for social features and notifications that, as of Milestone 28, still
  have no client-side UI anywhere in the app. They exist in the database
  and nowhere else yet — a genuine gap, not a hidden feature.

Every table has row-level security from the start; nothing is readable or
writable by default. `supabase-config.js` (added right after, wiring the
project URL and anon key into every page) is the only thing any page
needs to start talking to this database — the admin/service-role key
that would bypass these RLS policies is explicitly never meant to reach
client-side code at all.

## Real accounts: sign-up, sign-in, and the 16+ age gate (Milestone 16)

Three commits, each refining the one before it. The first shipped
magic-link sign-in (click a link in your email, no password) plus a
mandatory 16+ age-confirmation modal that gates the rest of the site
until you confirm — chosen because Pokémon Champions itself carries an
age requirement. The second swapped magic-link for a real email +
password form (Log In and Sign Up as tabs of the same modal), plus a
proper forgot-password flow (a reset email, then a "set new password"
modal opened automatically when Supabase reports you've followed that
link) — worth noting plainly: **nothing in this app ever sees or stores a
raw password**; Supabase's own auth handles that end entirely. The third
added real sign-up detail collection: first/last name, age (under 16
blocks sign-up outright now, not just a checkbox), a username (typed by
hand or generated as a random "{Adjective} {Pokémon}" pairing, checked
live — and re-checked right before the account is actually created, to
close a race where two people could grab the same name in the same
instant), and a starting avatar (matched to a Pokémon named in the
username, or a random non-Mega pick otherwise). `supabase/migrations/
0002_profile_details.sql` renames the account's display name to
`username` (now unique) and adds `first_name`/`last_name`/`age`/
`avatar_species` — with an explicit privacy rule in the migration itself:
**first/last name and age never reach `profile_public`** — a friend sees
a username and an avatar, never a real name or an age.

A same-day follow-up fixed avatar sprites 404ing (a raw `sprites/x.png`
path was used as an `<img src>` instead of the `data/` prefix every other
sprite lookup on the site already used) and added an actual image-load
check to the test suite specifically so a broken sprite path "fails
loudly next time" instead of silently rendering a blank box.

## Header redesign, five color themes, and a dashboard homepage (between Milestones 16 and 17)

A run of same-day commits, none individually tagged with a milestone
number in code, that together shipped three visible features:

**A redesigned header and account-level color themes.** The header
became a centered WinCon logo/tagline with a theme toggle, and a banner
row with the account widget on the left and page navigation centered.
The account dropdown gained a real "Account information" panel
(username, avatar, email, first/last name, age — the private fields).
Five color themes shipped in total: **Charizard** (red/gold in light
mode, black/blue in dark, with Charizard/Mega Charizard X/Mega Charizard
Y background art), **Fairy** (pink/white, Fairy-type art), **Water**
(blue, the 8 highest-base-stat Water types), **Grass** (green, the 8
highest-base-stat Grass types), and **Electric** (yellow, specifically
the Pikachu family rather than every Electric type, with dark text since
white text read poorly against yellow). Whichever theme you pick is
saved to your account (`supabase/migrations/0003_color_theme.sql` adds
a `color_theme` column to `profiles`), not just the browser, so it
follows you to any device signed into the same account — `localStorage`
still keeps a copy too, purely so the very first paint of a new page load
can apply it before the account data has had a chance to arrive.

**A dashboard homepage.** `index.html` (with the Pokédex tracker itself
moving to `pokedex.html` to make room) became a real dashboard: your
overall win/loss record, your best Singles and Doubles team by win rate
(falling back to whichever's newest if neither has a logged record yet),
your 5 most-used Pokémon across every saved team, an auto-advancing
carousel of Pokémon you've already obtained with an inline add-to-
Pokédex search, and a Wishlist carousel suggesting what to obtain next —
ranked by how much each candidate would improve your best team's type
coverage, reusing Dream Team's own scoring function, or a rotating set of
Mega Pokémon if you don't have a team built yet.

**Win/loss stat pills, refined twice.** Both Your Rival's own projected
result and the Matchup Score section's win/loss figures got dedicated
green/yellow/red stat-pill treatment (win rate, loss rate, and a
simplified win:loss ratio like "4 : 1"), which then went through two
rounds of polish: first, explicit thresholds (above 80% green, 35–80%
yellow, below 35% red, replacing an earlier three-tier split whose middle
color read too close to both ends), then a switch from those discrete
bands to a single continuous red-to-yellow-to-green gradient via CSS
`color-mix()`, so a win rate crossing a boundary like 80% shades smoothly
instead of snapping between colors. (This gradient work is what
Milestone 18, immediately after, then had to fix for theme-independence —
see above.) The Pokédex progress bar also picked up a small marker of
your own account avatar riding along its leading edge as you check off
more Pokémon.

## Real per-Pokémon ability selection (Milestone 17)

Every roster entry used to show only the site's single best-guess ability
(Milestone 13) with no way to change it. This sources the real Ability
1/Ability 2/Hidden Ability options for all 221 non-Mega roster entries
(Mega forms are excluded on purpose — every Mega form locks to one fixed
ability with no alternates in any game), landing in two new files:
`data/ability-options.json` (per-species option lists) and `data/
ability-dex.json` (a shared ability-name-to-description pool, the same
pattern `moves.json` already uses). The "Ability: X" tag on a build slot
becomes a real dropdown wherever a species has more than one option,
defaulting to the site's recommended pick and saving with the rest of
that team's build.

Researching this surfaced a real data bug already sitting in the
roster: **Falinks was listed with No Guard**, an ability it has never had
in any official game — corrected to Defiant (flagged as lower-confidence,
same convention the audit already uses for ambiguous entries, pending a
usage-data cross-check). The picked ability also now feeds the Open Team
Sheet's Expected/Tech tagging from Milestone 14 (e.g. whether Sylveon's
Cute Charm vs. Pixilate changes how a Normal-type move should read).
Deliberately unchanged: Auto-build, Auto-build strategy, and Matchup
Score still score against the site's one recommended ability per
species — this is a per-slot reference/planning tool, not a retroactive
rescore of everything auto-generation already does.

## Theme-independent win/loss colors, and a Matchup Score/Your Rival layout pass (Milestone 18)

Two fixes. First, a real color bug: the win/loss stat pills' green end
read the shared `--positive` variable, but every color theme re-picks
`--positive` as its own brand color (Charizard's dark mode makes it
blue) — so a genuinely high win rate could render blue instead of green.
Fixed by adding `--stat-positive`, a copy of the original green no theme
is allowed to touch, and pointing the win/loss gradient helper at that
instead. Second, a layout reorganization: the old single Matchup Score
section split into its own win/loss block and its own full-matrix block,
with Your Rival's section moved up alongside the win/loss block — final
page order became header row → Your Rival's own result → Matchup Score's
win/loss block → full matrix → team type coverage. (The immediately
preceding handful of commits — the win/loss pill color-gradient rework
and the `.score-rival-header-row` side-by-side layout it built on — are
the groundwork this milestone's fixes describe cumulatively; only this
final commit's own code comments carry the number 18.)

## Dream Team: include/exclude Pokémon by name, and keep what's already picked (Milestone 19)

Team notes could already exclude a Pokémon by name ("no Gholdengo",
"don't want Whimsicott" — a same-day precursor to this milestone). This
adds the inclusion half: phrases like "built around Greninja and
Feraligatr" or "must include Gholdengo" now force those specific Pokémon
onto the team instead of just nudging the greedy search toward them;
negated phrasing still reads as exclusion, and exclusion always wins if
the same Pokémon is named both ways. Whatever's already picked in the
builder's own slots when Generate Dream Team is clicked is now **kept**,
with the rest of the team built around it, rather than the whole team
being overwritten from scratch. The guaranteed-Mega-slot logic from
Milestone 12 was updated to account for forced/kept picks that are
themselves Mega-capable, so it never tries to guarantee more Mega slots
than there's actually room for. The "Why these six" note explains kept
and included picks by name, and separately flags when your team notes
name a real Pokémon that isn't obtained or eligible yet, or ask for more
inclusions than fit in 6.

## Your Rival gets individually swappable Pokémon; Matchup Score compares against the full roster (Milestone 20)

Three changes. Your Rival's roster cards gain a species dropdown per
slot — swapping a member recomputes the win/loss tiles, score ring, and
roster live, duplicate species across slots are prevented, and a note
appears once you've edited anything so "Why this rival beats you" never
claims to explain a matchup it didn't actually pick. Separately, Matchup
Score's own default win/loss figures (the ring, Toughest matchups, and
the full matrix) now compare your team against **every** Pokémon in the
dataset — all 296 base-and-Mega entries — instead of the old 16-entry
curated `starter-threats.json` list, which turned out to be 13 of 16
Mega forms and too narrow a picture of "your actual win rate." Generate
Dream Team, Auto-build team, and Auto-build strategy deliberately keep
scoring against the curated list — they're about picking or building a
team's *shape* (archetype, coverage), not displaying a win-rate figure,
and widening what they score against would silently change already-
explained behavior nobody asked to change. Third, since the matchup
matrix now has a row per roster Pokémon instead of a fixed 16, it's
collapsed behind a "Show full matchup matrix" toggle by default, the same
pattern the type-coverage breakdown already used.

## Fixing Dream Team and Your Rival always picking the same few Pokémon (Milestone 21)

The actual bug: candidate scoring averaged type effectiveness across
every threat in the reference list, which smooths away the exact signal
that should reward countering one specific dangerous matchup — so a
handful of generically-strong Pokémon (Charizard and Floette turned up in
8 of 8 sampled rival rosters, checked directly) kept winning regardless
of what they were actually up against. The fix replaces that flat average
with a marginal-coverage-gain model: a candidate is scored by how much it
improves the team's *worst currently-unanswered* matchup, weighting
turning a losing matchup into a winning one far above padding an
already-comfortable one — the "chain-counter" idea (Charizard answers
Venusaur, Venusaur answers Feraligatr, Archaludon answers Mega
Feraligatr) made concrete. The same change also adds real weather-
archetype detection: a team is only credited with a genuine Sun/Rain/
Sand/Snow strategy if it has a real setter (an innate ability, or an
actual chosen move) — deliberately **not** "can this species learn Rain
Dance via TM," since roughly three-quarters of the entire roster can
learn one weather move or another via TM, which would make that signal
"nearly meaningless as a discriminator." Both fixes live in the one
scoring function Dream Team and Your Rival already shared, so a single
change improved both features at once.

Honesty note carried over from Milestone 12: the guaranteed-Mega slots
still lean on Charizard, Floette, and Staraptor specifically, because
those remain the only three Mega forms with a real, tournament-informed
set behind them — that recurrence is a data-honesty constraint, not a
sign the fix didn't work.

## Syncing saved teams to your account across devices (Milestone 22)

The actual gap: Supabase accounts, profiles, and color themes already
existed, and the `teams` table from Milestone 15 had been sitting there
unused this whole time — but nothing in any page had ever read or
written it. Every saved team still lived only in one browser's
`localStorage`, so signing into the same account on a second device
showed nothing. This wires up real two-way sync through the same two
functions every page already called: `wcLoadAndSyncTeamState()` pulls
your cloud teams on load and merges them with whatever's local by id
(nothing gets deleted by the merge itself); `wcPushTeamsToCloudIfSignedIn()`,
called from inside the existing save path, upserts every local team and
removes any cloud team no longer present locally — so roughly 20 existing
call sites across the builder pages get cloud sync for free, with no
per-call-site changes needed. Both fall back cleanly to local-only
storage if you're signed out, the Supabase script didn't load, or the
network doesn't respond within 5 seconds — cloud sync is treated as an
enhancement layer over local storage, never a hard requirement, the same
pattern every other Supabase-backed feature on this site follows. Team
ids became real UUIDs to match the `teams` table's own id column; a team
saved before this milestone gets one assigned the next time it's saved.
`supabase/migrations/0004_team_match_log.sql` adds a `match_log` JSON
column mirroring each team's local win/loss log, so a logged result
travels with the team across devices too — while explicitly deferring
the bigger, separate feature of a normalized, cross-user match log
(that's Milestone 28).

This also fixed a real crash the cloud-sync prerequisite work had
introduced on the homepage: the Wishlist section's scoring call had been
passing bare type-arrays where the underlying scorer (rewritten by
Milestone 21) now expected full team-member objects, which threw for
anyone with a real saved team. Wrapped correctly, it stopped crashing.

## Vercel Web Analytics (Milestone 23)

Adds the standard `<script defer src="/_vercel/insights/script.js">` tag
to every page. Since this is a static site with no build step, there's no
npm package to install — Vercel serves that script itself for any hosted
project, and it just 404s harmlessly (confirmed no page errors either
way) when running locally or somewhere other than Vercel. One thing this
change can't do on its own: **Web Analytics still needs to be switched on
for this project in the Vercel dashboard** (Project → Analytics → Enable)
after it's deployed — a one-time toggle only the account owner can make.

## Requiring an account to save or auto-generate (Milestone 24)

Save team, Generate Dream Team, Auto-build team, and Auto-build strategy
now require a signed-in account, gated through one shared
`wcRequireAccount()` check reused across all four. The reasoning is
straightforward: without an account there was never anywhere for a save
to persist beyond the current browser tab anyway (see Milestone 22's
cloud sync), so this just makes that limitation visible up front, with a
clear message and a one-click path straight into the sign-up modal. At
this point Find Your Rival and Matchup Score/coverage were still
explicitly left open to everyone, as "read-only exploration of a team
already on screen" — Milestone 25, immediately after, removed that
carve-out.

## Locking the full toolkit behind sign-in, and a homepage welcome banner (Milestone 25)

Widens Milestone 24's gate substantially. Signed out, you can now *only*
mark Pokémon obtained on the Pokédex and pick/unpick up to 6 onto a team.
Everything past that — every build-detail field (Nature, item, ability,
all 4 moves, Stat Points), every team-management action (rename, new,
delete, move between Singles/Doubles, Open/Closed toggle, notes, the
results tracker as it existed then), and the entire Matchup Score/
coverage/Your Rival analysis — now requires an account, on the reasoning
that none of it had anywhere to persist without one regardless. The
UX changed too: a shared, dismissible popup (bottom-right, auto-dismisses
after 7 seconds) now explains the lock and links to sign-up, replacing
the previous behavior of force-opening the sign-up modal on every single
blocked click, which read as an interruption rather than a notification.
Locked controls are visually dimmed, and everything unlocks live the
moment you sign in mid-session — no reload needed. Separately, the
homepage gained a one-time welcome banner explaining what WinCon does,
dismissed (and remembered) per browser.

## Closing a read-side privacy gap: team data no longer lingers while signed out (Milestone 26)

Milestone 25 locked down every path that could *write* team data while
signed out, but never touched the *read* side — the builder pages' own
page-load logic, and the homepage's overview/top-teams/most-used/wishlist
sections, kept displaying whatever `localStorage` already held, which
could be leftover data from an earlier signed-in session on the same
computer, or from a different account entirely on a shared machine. The
fix is `wcHasRealSession()`: a direct Supabase session check, deliberately
kept separate from the existing "am I signed in" flag because that flag
can briefly read "signed out" while auth.js is still finishing its own
async startup, even for someone who genuinely is signed in — a race that
would have made this fix intermittently wrong in exactly the case it
exists to catch. Both builder pages and the homepage now render a
completely blank state until a real session is confirmed one way or the
other, re-checking live on every sign-in/sign-out. One deliberate
carve-out survives: Pokémon picked while signed out aren't discarded the
instant you sign in mid-session, as long as there's no existing saved
team for them to conflict with — only reloading the page while still
signed out clears them.

## Closing the same privacy gap for the Pokédex's "obtained" list (Milestone 27)

The same class of bug Milestone 26 fixed, left unaddressed on the
Pokédex tracker and the homepage's owned-Pokémon carousel — both still
read and wrote the real, permanent "obtained" set in `localStorage`
regardless of whether anyone was actually signed in. The fix: while
signed out, marking a Pokémon obtained now lives in `sessionStorage`
instead — capped at 6 (matching the Team Builder's own signed-out
preview limit) and forgotten the moment the tab closes, rather than kept
indefinitely. `sessionStorage` specifically, not just an in-memory
variable, so that marking something obtained on the Pokédex still hands
off correctly to the Team Builder's picker within that same visit.
Signing in merges any signed-out marks into the real account and lifts
the 6-Pokémon cap.

## Battle Tracker: its own page, a 250-character note, a delete confirmation, and real cross-user battle data (Milestone 28)

Four related changes, all from the same round of feedback.

**Notes can now run up to 250 characters,** not 80 — the cap lives in one
place (`WC_MATCH_NOTE_MAX_LEN` in `teams.js`) that both the input field's
own `maxlength` and the underlying save function enforce, so a note can't
get truncated by one without the other agreeing.

**Deleting a logged result now asks for confirmation first**, so a stray
click on the small "×" next to an old entry can't silently erase a real
result. Its wording matches what was asked for exactly: "Delete log (I
made a mistake)" as the heading, "Confirm:" as the body, and Yes/No as
the two buttons — Yes deletes, No dismisses with nothing changed.

**Logging and reviewing results moved off the Builder pages onto their
own page, Battle Tracker** (`battle-tracker.html`/`battle-tracker.js`).
The full log form, opponent-team entry, running history, and delete
button used to live in a "Track your results" section on the Singles and
Doubles Builder pages; as more got added there over Milestones 11 and
27, it started crowding out the actual team-building work those pages
exist for. Battle Tracker is that entire feature pulled out on its own:
pick any one of your saved teams, either format, log a win or a loss with
an optional note and opponent lineup, and see that team's own record,
current streak, and up to its 25 most recent games, plus a summary
combined across every team you have. The Builder pages now keep only a
single compact line — the team's win/loss percentage — linking over to
Battle Tracker for the detail, exactly as asked ("the only thing that
should stay on the team builder page is the percentages for real team
win loss").

**Every logged battle now also feeds a real, cross-user pool of usage
data, not just that one player's own team.** This is the deferred feature
Milestone 15's schema anticipated and Milestone 22 explicitly set aside
in favor of a simpler per-team mirror column — completed here. Every
logged result is still saved to that team's own record exactly as
before, and now also pushed (fire-and-forget, same shape as every other
cloud call in this app, and only ever while signed in) to a normalized
`match_results` table, with a snapshot of the team's roster *at the exact
moment it was logged* — needed because a team's roster can change later,
and without that snapshot the aggregate would silently attribute a game
to whatever the team looks like today rather than what was actually
played. A database trigger (`supabase/migrations/0005_meta_usage_stats.sql`)
re-aggregates `match_results` into `meta_usage_stats` — an anonymized,
cross-user table of how often each species gets used and faced, and how
often it wins, with no user identity anywhere in it — the moment a row is
inserted or deleted. Generate Dream Team, Auto-build team, and Auto-build
strategy all read this as a supplement to the existing curated matchup
data (`data/starter-threats.json`): a species needs at least 5 real
logged games, site-wide, before its numbers are trusted enough to nudge
anything, so a Pokémon that's 1–0 in the whole site's history so far
doesn't swing a recommendation off a single game. **Honesty note, same
spirit as the one on the Matchup Score above:** on a small or brand-new
site, this will mostly sit quiet at first and defer entirely to the
existing curated heuristics — that's the correct, intended behavior until
enough games get logged by enough players, not a bug. It gets more useful
the more anyone logs, not just you.

One deployment step this milestone can't do on its own: `supabase/
migrations/0005_meta_usage_stats.sql` needs to be pasted into Supabase's
SQL Editor and run once, the same way every earlier migration was,
before the cross-user data actually starts flowing.

## Your Rival explains its real-usage-data influence too, and a recurring weekly meta-refresh (Milestone 29)

**Your Rival was already using Milestone 28's real cross-user battle data —
it just never said so.** Both Generate Dream Team and Find Your Rival pick
through the same function (`wcPickDreamTeam` in `strategy.js`), so the
`meta_usage_stats` bonus Milestone 28 added already applied to a rival's
picks, same as your own Dream Team's. The gap was purely in the
explanation text: Dream Team's "Why these six" note never mentioned this
signal when it mattered for a rival's pick either. `wcMetaUsageReasoningNote()`
closes that — a rival's reasoning now says so explicitly whenever a pick's
real logged win rate clears the same 5-game minimum sample and 50%
threshold Milestone 28 already used, matching the "explainable, not a
black box" rule every other scoring signal here follows.

**A recurring weekly research pass now keeps `WINCON_META_KNOWN_SETS`
current**, per your own request to have WinCon check real tournament
results and Pokémon blogs on an ongoing basis rather than only when
someone happens to ask. Every Monday, a scheduled session re-checks the
curated real-world-set list (`WINCON_META_KNOWN_SETS` in `strategy.js` —
Dream Team/Auto-build/Auto-build strategy's forced-move-and-item picks for
a short list of high-confidence, currently-dominant Pokémon) against fresh
Pikalytics Reg-M-B usage data, cross-checked against Pokémon Zone and
Limitless VGC, and pushes any changes straight to the live site — this is
the lower-stakes half of the two-tier system you asked for (the other
half, a monthly legal-roster check, is intentionally not built yet — see
"What's next" below for why). `data/starter-threats.json` is explicitly
excluded from this process, per Milestone 20's own decision to keep that
list static.

The first run (2 September 2026) re-verified all nine existing entries as
still correct, and added two newly-dominant Pokémon: **Incineroar**
(Fake Out/Parting Shot/Flare Blitz/Throat Chop, Sitrus Berry) and
**Sneasler** (Close Combat/Fake Out/Dire Claw/Protect, White Herb).

## Showdown-format Import/Export, and confirming the Stat Points math (Milestone 30)

**A WinCon team can now leave the site, and a team from anywhere else can
come in.** Every set shared anywhere in the competitive community — a
streamer's team, a tournament report, a Discord message, a Pikalytics or
Limitless page, a PokePaste link — is written in Pokémon Showdown's plain
-text format. Until now a WinCon team couldn't be exported to it or
imported from it, so WinCon was an island relative to the rest of the
community's tools. Both Builder pages now have **Export** (turns the
active team into that text, in a copyable box) and **Import** (parses
pasted text into a preview — species, item, ability, Nature, Stat Points,
moves, plus a plain-language list of anything it couldn't match or had to
adjust — and only replaces the active team's picks once you confirm
"Replace team"). `wcExportTeamText`/`wcParseShowdownTeam` (`builder.js`)
do the translation.

**This intentionally did not mean replacing Stat Points with real EVs/
IVs** — the original plan going in, before checking. Champions itself has
no EVs or IVs; the SP system WinCon already uses (66 total, 32/stat cap,
IVs fixed at 31) turned out to be Champions' actual training mechanic, not
an approximation of one, confirmed against two independent Champions
mechanics guides while researching this feature (see the updated honesty
note in "Two honesty notes on the Matchup Score" above). So Export/Import
translate at the boundary only — a build's real EVs/IVs on the way out,
Stat Points on the way in (`wcSpToEv`/`wcEvToSp`, `stats.js`) — while Stat
Points stay the one source of truth everywhere inside WinCon itself,
matching how the game actually works.

A few things worth knowing about how Import handles an imperfect paste,
rather than either crashing or silently guessing: a species Import can't
match to WinCon's roster is skipped (reported, not fatal to the rest of
the paste); a Mega Pokémon's own name in the header (rather than its base
species + Mega Stone, which is how Showdown format normally writes it) is
still recognized and converted back to base-species-plus-stone; a pasted
Tera Type is dropped with a note that Terastallization isn't legal in the
current regulation; pasted IVs that aren't all 31 are dropped with a note
that Champions doesn't have a variable there to set; and an unrecognized
move, ability, or Nature is skipped with a note rather than blocking the
rest of that Pokémon's import. Importing a Pokémon that isn't marked
obtained yet automatically marks it so — without that, there'd be no way
to remove it again afterward, since Step 1's picker only shows/toggles
already-obtained Pokémon.

**Small polish alongside this:** each build's Stat Points section now
shows the actual Level 50 stat each input works out to, live, right next
to it (using the exact same `wcCalcStat` formula Matchup Score itself
reads) — previously the numbers you typed were the only feedback you got.

## Auto-fill just one Pokémon, without touching the other five (Milestone 31)

**"Auto-build team" and "Auto-build strategy" only ever worked on all 6
slots at once** — useful for starting a team from scratch, but overkill
for the common case of already having 5 slots you're happy with and just
wanting a real starting point for the 6th. Every slot card on both
Builder pages now has its own **Auto-fill this Pokémon** button, next to
its name and types, that fills in just that one slot — real Nature, item,
all 4 moves, and the full 66 Stat Points, from the same tournament-
informed engine ("`wcGenerateBuild`") "Auto-build team" already uses per
member. The other five slots are left completely alone: nothing else on
the team is re-rolled, re-ordered, or even re-read except to check their
items.

That last part matters for **Item Clause** — no two Pokémon on a real
Champions team can hold the same item. A single-slot fill checks this
slot's item choice against what every *other* slot on the team is
currently holding (not a fresh empty pool the way a whole-team generation
starts), so it won't hand out an item one of your other Pokémon already
has, even if that's not what this Pokémon's own real-tournament set would
normally carry. Like every other write action in the Builder, it's gated
behind being signed in.

## A Paldean Tauros breed dropdown, and a Base/Mega stat toggle (Milestone 32)

**Paldean Tauros breed switcher.** The Sept 3 roster audit added Blaze
Breed and Aqua Breed as their own roster entries alongside the existing
(unlabeled) Combat Breed — accurate to how Champions treats them, but
inconvenient if you picked one and realize partway through building that
you meant a different breed you've also got. Any Tauros slot with more
than one breed marked obtained on the Pokédex now shows a small dropdown
right under its name to switch between them in place — Nature, item,
moves, and Stat Points all carry over untouched (the three breeds share
identical base stats, ability options, and learnset; only the typing
changes), so switching breeds isn't a fresh pick, just a relabel. Only
breeds you've actually checked off as obtained are offered, same rule as
everywhere else a Pokémon gets onto a team.

**Base/Mega stat toggle.** Mega Evolution has always been entirely
item-driven — hold a species' own Mega Stone and the slot automatically
shows the Mega form's stats/typing; hold anything else and it's the base
form. That's still true, but a Pokémon actually starts a battle in its
base form and only Mega Evolves mid-battle as an action, so planning
sometimes calls for seeing (or building around) both stat blocks without
losing the item. Once a slot's item matches one of its own Mega Stones, a
small Base/Mega toggle now appears right under its name — flipping it
changes which stat block that slot is currently viewed and built against
(typing, ability, base stats, the SP allocator's live final-stat readout)
without touching the item field at all. It defaults to Mega, matching the
old always-on-item-match behavior, so nothing changes unless you actually
click it. Matchup Score, team type coverage, and Auto-build strategy all
read the toggle too, so they never disagree with what the slot card
itself is showing. Changing the item away from the stone still wins
outright — the toggle disappears and the slot reverts to base, the same
as it always has.

## Running it

**Easiest — no install:** double-click `index.html` and it opens in your
browser. Some browsers block a page from loading files under `data/` when
opened directly as a file (a security restriction) — if the Pokémon list
looks empty, use the option below instead.

**More reliable — a tiny local server:** if you have Node.js installed:
```
npx serve .
```
Then open the URL it prints (something like `http://localhost:3000`).

## Putting it on the internet

Already done — see the live deploy notes below if you're setting this up
somewhere new:

1. Create a free account at [github.com](https://github.com) and a new
   repository (call it `wincon`).
2. Upload this folder's contents to that repository, preserving the
   `data/` and `supabase/` folder structures — GitHub's uploader can be
   finicky about this if you drag loose files instead of the folder
   itself. If a file lands at the repo root instead of inside `data/`,
   open it on GitHub, click the pencil (edit) icon, and change its
   filename at the top to include the `data/` prefix — that moves it
   without needing to re-upload.
3. Create a free account at [vercel.com](https://vercel.com) and connect
   it to that GitHub repository. Vercel will detect it's a static site and
   give you a live URL — and redeploy automatically every time you update
   the repository.
4. Create a free project at [supabase.com](https://supabase.com) (needed
   since Milestone 15 — accounts, saved teams, and Battle Tracker all
   depend on it; the site still runs without one, but only in its
   signed-out, 6-Pokémon-preview mode). In that project's SQL Editor,
   paste in and run each file under `supabase/migrations/`, **in order**
   (`0001_init.sql` through `0005_meta_usage_stats.sql`) — each one only
   adds to what the last one created, so running them out of order or
   skipping one will fail partway through with a clear "relation/column
   does not exist" error telling you which one you missed. Then copy that
   project's URL and anon (public) key from Project Settings → API into
   `supabase-config.js` — see that file's own header comment for why the
   anon key is safe to commit and what must never go anywhere near it.

## What's next (see the WinCon Blueprint for the full roadmap)

- Swap `starter-threats.json`'s hand-picked reference list for real usage
  data — Milestone 28 made a start on this from the inside (real, logged,
  cross-user battle results now nudge Dream Team/Auto-build/Auto-build
  strategy once enough games exist per species — see that section above),
  but it's a supplement, not the swap itself, and stays quiet until real
  usage accumulates. Pulling in an external source like
  championsbattledata.com remains the faster way to get a genuinely
  current picture from day one; see the honesty note earlier in this
  file for why that attempt didn't land yet.
- ~~An account (Supabase) so progress and saved teams sync across
  devices~~ — done as of Milestone 22: sign in on any device and your
  saved teams (including their logged win/loss record) show up there too.
  See teams.js's "Cloud sync" section and
  `supabase/migrations/0004_team_match_log.sql`.
- Friend requests, notifications, and push subscriptions have had their
  database tables sitting ready since Milestone 15's foundation schema
  (`friend_requests`, `notifications`, `push_subscriptions`) but no
  client-side page has ever used them — a real, open gap, not a hidden
  feature.
- A monthly "check the new legal roster" automation, the other half of
  the two-tier research system alongside Milestone 29's weekly meta-
  refresh, is deliberately not built yet: WinCon's Pokémon data
  (`data/pokemon.json`) has no concept of "legal this regulation" at all
  today — every one of the 296 roster entries is always available, with
  no rotation/legality field to check a monthly change against. Building
  that properly (a real legality/rotation system: new data fields, and
  filtering wired into the Pokédex and both Builder pickers) is a
  separate, non-trivial feature that needs to exist before a monthly
  check can do anything meaningful — on hold until that's worth taking on.
  Timing note for whenever it does happen: Regulation M-B runs through
  September 9, 2026; Regulation M-C follows immediately after, so that's
  the next real rotation to watch for.
