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

## Milestone 34: the Limitless pipeline

WinCon's competitive grounding before this milestone was two things:
`meta_usage_stats` (real, but only as good as how many games WinCon's own
users have logged) and `data/meta-baseline.json` (a small, hand-curated,
point-in-time set of reference teams). This milestone adds a third, live
tier in between: real Regulation M-B tournament results pulled straight
from [Limitless](https://play.limitlesstcg.com)'s public tournaments API,
refreshed automatically once a day by a new Vercel Cron job
(`api/cron-limitless-sync.js`) — the first thing in WinCon that runs on a
schedule instead of only when someone has the site open.

**What it pulls, and what it doesn't.** Limitless's `game=VGC` tournaments
are Doubles only — Champions Singles has no official tournament format, it's
ladder-only, so there's nothing there to pull for Singles. Every table this
milestone adds only ever gets Doubles rows; Singles keeps relying entirely
on `data/meta-baseline.json` and WinCon's own logged battles, exactly as
before. A Limitless decklist entry is also confirmed (by hand, against the
live API) to stop at species/item/ability/moves/nature/tera — there's no
Stat Points/EV-equivalent field anywhere in it. That means the real teams
this pulls in can't be turned into battle-ready Simulated Win Rate opponents
(the engine needs a full Stat Points allocation per member) — they're
stored (`live_reference_teams`) for a possible future use, but are not wired
into Simulated Win Rate's opponent pool in this milestone.

**Four new tables** (`supabase/migrations/0007_live_limitless_meta.sql`),
same read-only-to-signed-in, written-only-by-the-service-role shape as
`meta_usage_stats`: `live_tier_stats` (per-species usage/win rate),
`live_meta_builds` (the real ability/item/nature/move combinations actually
played, with how often and how well each did), `live_reference_teams` (full
real tournament teams, see the caveat above), and `live_pipeline_runs` (one
row per pipeline run, so a failed or partial run is visible instead of
silent).

**One new trust tier.** `strategy.js`'s existing threat-layering (WinCon's
own logged battles first, most trusted, then a curated fallback) now has a
real middle layer: `wcAugmentThreatsWithLiveMeta` reads `live_tier_stats`
(via `wcFetchLiveTierStats` in `teams.js`) and adds any real, genuinely-
scary tournament species not already named by the more-trusted logged-battle
layer, before the curated baseline gets its turn. Same "silently a no-op
until there's real data" contract every layer here has always had — a brand
new deployment (or one that hasn't run the cron job yet) behaves exactly as
it did before this milestone.

**The pipeline job itself** is plain Node with zero npm dependencies (no
`package.json` needed) — it calls Limitless's API and Supabase's own REST
API (PostgREST) directly with `fetch`, using a service-role key that's never
committed anywhere. It's idempotent (safe to re-run — upserts, not inserts),
fails soft per-tournament (one bad response is logged and skipped, never
aborts the whole run), processes a bounded batch per run (any backlog just
gets picked up over the next few days rather than risking one run timing
out), and has a `?dryRun=1` mode that computes and reports exactly what it
would write without writing anything — safe to try from a plain browser tab
before ever trusting the real schedule.

**One thing this milestone deliberately did NOT do:** email Limitless about
their terms of service for automated polling, redistribution, or
attribution (their docs don't say either way — see the Milestone 34 planning
notes). It builds against their public, keyless tier, at a conservative
once-a-day schedule, on the assumption that's reasonable for a small
community tool — worth revisiting if that assumption ever turns out wrong.

### Setting it up (in addition to the steps below)

1. Run `supabase/migrations/0007_live_limitless_meta.sql` in Supabase's SQL
   Editor, same as every migration before it (after `0001` through `0006`).
2. In your Vercel project's Settings → Environment Variables, add:
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase's Project Settings → API
     (the **service_role** key, NOT the anon key already in
     `supabase-config.js` — this one is powerful and must never be
     committed to git or shipped in any client-side file).
   - `CRON_SECRET` — any long random string you generate yourself (a
     password manager's "generate password" button works fine). Vercel
     automatically sends this as the job's own Authorization header on its
     scheduled runs, which is what stops anyone else from triggering it.
3. Redeploy (pushing to GitHub triggers this automatically). Vercel reads
   `vercel.json`'s `crons` entry and starts running the job daily from then
   on — check Vercel's dashboard under your project's "Cron Jobs" tab to
   confirm it's scheduled, and its "Logs" to see each run's result once one
   has actually fired.
4. To check everything's wired correctly before waiting for the schedule,
   visit `https://<your-site>.vercel.app/api/cron-limitless-sync?dryRun=1`
   in a browser — it computes and returns exactly what a real run would
   write (as JSON), without writing anything or needing any secret.

## Milestone 34 follow-up: live data also informs Your Rival and Simulated Win Rate

Milestone 34 originally only fed `live_tier_stats` into the Builder's
threats list (`wcAugmentThreatsWithLiveMeta`). Two more places asked for
the same real, current data, and got it in two different ways depending
on what was actually possible:

- **Your Rival and Auto-build's Dream Team** now both get a genuine
  candidate-scoring nudge (`wcLiveMetaCandidateBonus` in strategy.js,
  folded into `wcDreamTeamCandidateScore` — the same scorer both features
  share) toward a species that's winning a lot in real Regulation M-B
  tournaments right now, same trust-tier idea as the existing real-usage
  (`wcMetaUsageCandidateBonus`) and curated-baseline
  (`wcMetaBaselineArchetypeBonus`) bonuses it sits alongside. Zero effect
  when there's no live data yet — same "silent no-op" contract as every
  other live-data layer in this project.

- **Simulated Win Rate** deliberately does NOT let a real Limitless
  decklist into the actual battle pool — Limitless's tournament data has
  no stat-spread (EV/Stat Points) field at all (see
  `0007_live_limitless_meta.sql`'s own header comment), and guessing one
  would mean part of a reported win-rate percentage was invented,
  dressed up as real tournament fact. Instead, `wcLiveUsageWeightForTeam`
  (strategy.js) changes how OFTEN each of `data/meta-baseline.json`'s own
  hand-verified reference teams gets sampled by the Monte Carlo engine,
  based on how well its real members are currently doing in live
  tournaments (0.5x-2x the normal sample, capped both ways, neutral 1x
  with no live data). Every opponent actually battled is still a
  real, sourced team — this only shifts how much attention each one
  gets, toward whatever's actually being played right now.

Both are Doubles-only in effect (not just in principle) — Limitless has
no official Singles tournament to draw from, so `live_tier_stats` is
always `{}` for Singles and every bonus/weight above stays at its neutral
default there, same as the original Milestone 34 threats-list nudge.

## Milestone 34 follow-up #2: an "untapped gem" Mega can now get discovered from live data

The "Meta-informed auto-build" section above locks Dream Team, Auto-build,
and the per-slot Autofill button to only ever opt a base Pokémon into one
of its own Mega forms when there's a real, verified set behind it
(`WINCON_META_KNOWN_SETS`) — deliberately, so nothing ever gets a guessed
"good" Mega build. The cost of that honesty was that the list was
hand-curated and small (originally just Mega Charizard Y, Mega Floette,
and Mega Staraptor), so a genuinely strong Mega nobody had gotten around
to researching yet — an "untapped gem" sitting in someone's own box —
could never get proactively recommended or guaranteed a team slot, no
matter how good it actually was.

`wcLiveMegaSetFor` (strategy.js) closes that gap the same way the rest of
this project prefers: with more real data, not a lowered bar. A real
Champions decklist names a Pokémon that Mega Evolves in-battle by its
BASE species holding its Mega Stone as the item (Mega Evolution isn't a
separate team-sheet slot) — so `live_meta_builds` (read by the new
`wcFetchLiveMetaBuilds` in teams.js) already captures real Mega usage,
just keyed by base species rather than the Mega form's own name.
`wcLiveMegaSetFor` looks up a base species' real builds, finds the one
(if any) holding the right Mega Stone with enough real sample size to
trust it (same bar as every other live-data layer in this project), and
hands back a `{ moves, item, note }` set shaped exactly like a
`WINCON_META_KNOWN_SETS` entry — so `wcHasKnownMegaOption`,
`wcPickAutoMegaForm`, and `wcGenerateBuild` all accept either source
without caring which one it came from.

In practice: once a Mega genuinely starts seeing real Regulation M-B
tournament play — any Mega, not just the three hand-curated ones — Dream
Team can guarantee it a slot, Auto-build can opt into it, and Autofill
can give it a real moveset, automatically, the moment the Limitless
pipeline has seen enough real games with it. Nothing is invented for a
Mega no one's actually playing; it just doesn't have to wait for someone
to hand-research it anymore. Doubles-only, same as every other live-data
feature — Limitless has no Singles tournament to draw from.

## Milestone 36: Dream Team now auto-strategises while it picks, not just after it builds

Every earlier version of Dream Team scored candidates purely on matchup
strength, type coverage, raw stats, and real-data usage bonuses — it had
no sense of how the picks it was making might work TOGETHER as a pair,
trio, or foursome. A team-wide strategy (Trick Room, Tailwind, a weather
core, redirection) only ever got looked at afterward, and only if you
clicked the separate "Auto-build strategy" button once the whole team
was already fully built.

Two things changed:

**Picking now leans toward a cohesive team as it goes.** `strategy.js`
adds `wcArchetypeSignalsFor`, which reads the two signals that actually
exist DURING picking — before any moveset is built, since
`wcGenerateTeamBuilds` always runs after `wcPickDreamTeam` finishes — a
species' fixed real ability, and whether it can LEARN a strategy-defining
move (`data/learnsets.json`). Weather is read from ability only
(`WINCON_WEATHER_SETTING_ABILITIES`, the same signal
`wcDetectWeatherArchetype` already trusts for the threat side of this):
Sunny Day and Rain Dance turned out to be near-universal TM moves (about
three-quarters of all species can learn one or the other), so "can learn
it" carries no real signal for weather the way it does for Trick Room,
Tailwind, redirection, and hazards, which stay genuinely restricted move
pools. `wcDetectInProgressArchetype` looks at the team as picked so far
and finds whichever archetype already has the most independent setters
on it; `wcArchetypeBeneficiaryScore` asks whether a given candidate is a
real fit for that archetype (bulky for Trick Room, fast for Tailwind,
Fire-typed or sun-boosted for sun, a real 100+ Atk/SpA hitter for
redirection, and so on). `wcArchetypeSynergyBonus` folds both into
`wcDreamTeamCandidateScore`: once a strategy is forming, a real
beneficiary of it outweighs a pick that's merely individually strong
(doubling down on a working game plan beats starting a second, competing
one); before anything has formed, a candidate that could start one gets a
smaller nudge. None of this overrides real matchup/coverage/meta-data
scoring outright — it's additive, the same way every other scoring bonus
in this project is. The "why these six" reasoning list now names it too,
via a new `wcArchetypeSynergyReasoningNote` line alongside the existing
meta-usage/live-data/meta-baseline notes.

**The finished team's strategy is now applied automatically.** Clicking
Generate Dream Team used to leave you with "picked and built — click
Auto-build strategy below to see a recommended strategy." Now
`generateDreamTeam()` (builder.js) runs the exact same
`wcAnalyzeTeamStrategy` analysis immediately afterward and applies its
recommended move/role change with `applyAmendmentsToBuilds` right away —
no second click needed. The strategy panel shows the same recommended
strategy exactly as before, just with an "Applied automatically as part
of Dream Team" note in place of the manual "Make changes" button. The
standalone "Auto-build strategy" button (for a team you built by hand, or
to re-check a Dream Team you've since edited) works exactly as it always
has — this only changes what happens automatically right after Dream
Team finishes.

In short: one click now produces a complete, already-strategized team —
Dream Team leans toward a real shared game plan as it picks, and that
plan's build changes are already in place by the time you see the
result, exactly as asked for ("Look at synergy between pairs, tripples
and groups of 4 pokemon... the dream team is providing a full
strategised team for the user to try out").

## Locked builds: a permanent, per-species Nature/Stat Points/moveset

Every build-generating flow in this project — per-slot Autofill, Auto-build
team, Dream Team, and Auto-build strategy's amendments — could previously
overwrite a Pokémon's Nature, Stat Point spread, and moveset at any time.
There was no way to say "this is Charizard's build, permanently, stop
regenerating it." Locked builds are exactly that.

**Locking is global and per-format, not per-team.** Lock Charizard's build
once from the "🔒 Lock this build" button on its slot card, and every team
that picks Charizard — Dream Team, Auto-build team, Autofill, a fresh manual
pick — reuses that exact Nature/Stat Points/moveset from then on, in every
team, for as long as you're signed in. Doubles and Singles keep separate
locks for the same species, since a real build for one format often doesn't
suit the other. A new `locked_builds` Supabase table (migration `0008`)
stores one row per `(you, species, format)`, read by `wcGenerateBuild`
(strategy.js) to short-circuit its own Nature/Stat-Point/move-picking logic
via a new `opts.lockedBuild` input, and written directly from the Builder
page via `wcSaveLockedBuild`/`wcDeleteLockedBuild` (teams.js) — the same
user-owned, user-writable table shape `teams` itself already uses.

**Only Nature, Stat Points, and moves are locked.** Item and Ability stay
free — Autofill still picks a fresh item for a locked Pokémon, a Mega Stone
swap still works normally, and the ability field is untouched exactly as
before (it was already a pure display default/manual override, never
touched by the build generator in the first place). One deliberate edge
case: if a locked species auto-opts into a Mega form, its locked Nature and
moves still apply, but its Stat Point spread is freshly picked against the
Mega's own (often very different) base stats rather than blindly forcing a
spread tuned for the base line onto it.

**A recommended change never silently overwrites a lock — it shows up as a
toggle, exactly like the Mega/Base toggle already does for Mega Evolution.**
When "Auto-build strategy" (or Dream Team's own auto-apply step) would
normally change a locked Pokémon's moves or Nature/Stat Points, that change
is computed exactly as before, but instead of applying it directly,
`applyAmendmentsToBuilds` (builder.js) overlays it onto a
`build.recommendedBuild` preview via the new `wcApplyAmendmentToFields`
(strategy.js) — the locked build itself is never touched. A "Current /
Recommended" pill appears on the slot card (`buildLockedBuildViewToggle`,
structurally identical to the existing Mega/Base pill): switching to
Recommended previews the suggested Nature/Stat Points/moves — read-only,
same as viewing a lock — and feeds them live into Matchup Score, Speed
tiers, and Simulated Win Rate (`wcEffectiveBuildFields`, the same resolver
role `wcSlotEffective` already plays for Mega/base), while Team type
coverage is untouched since it's type-chart-only. Switching back to Current
restores the real locked build with zero changes. A separate "Adopt this
build" button is the only way a preview actually becomes the new permanent
lock.

Your Rival's own synthesized opponent roster deliberately never reads your
locked builds — Rival is a hypothetical enemy team, and your own tuned
personal builds have no business leaking onto a simulated opponent.

## Better Doubles builds: real Nature/Stat Point spreads, and teammates that build around each other

A beta tester's feedback: WinCon's auto-generated Doubles builds looked
unrealistic — their examples were Incineroar getting an Adamant offensive
spread and Gholdengo getting a Modest Nature paired with a defensively-split
Stat Point spread, neither of which is a real, sensible set for either
Pokémon. They also asked for teammates to actually build around each other's
offensive/defensive synergy, the way a real player (or a damage calculator
like Showdown's) would.

**Every curated real set now carries a real Nature and Stat Point spread,
not just moves/item.** `WINCON_META_KNOWN_SETS` (strategy.js) previously only
stored `moves`/`item`/`note` for its dozen standout Doubles Pokémon — Nature
and Stat Points silently fell through to the generic heuristic below even
for these hand-curated, real-tournament Pokémon. That's exactly the bug
behind the tester's own Incineroar example: its moves/item were curated, but
its Nature/Stat Points weren't, so it still got the generic offensive
default. Every entry now also carries a real `nature` and `sp` (this app's
existing Stat-Points-as-EV/8 abstraction — see `wcSpToEv`/`wcEvToSp` in
stats.js), matched to that Pokémon's actual competitive role: a genuine
sweeper (Kingambit, Garchomp, Sneasler) keeps an offense-boosting Nature with
Stat Points split between HP and its offense stat, while a support/wall-style
Pokémon (Incineroar, Whimsicott, Grimmsnarl) now gets a bulk-boosting Nature
with Stat Points split between HP and its stronger defense instead.
`wcGenerateBuild` reads these the same way it already read curated
moves/item, falling back to a live-tournament-sourced Nature
(`wcLiveMegaSetFor`, now also reading the `nature` column
`live_meta_builds` always had but `wcFetchLiveMetaBuilds` never selected)
and then the generic heuristic below, in that order — the same
real-data-first trust order every other "meta-informed" feature in this
project already follows.

**The generic fallback heuristic (every non-curated Pokémon) no longer
always assumes an offensive build.** `wcPickNature`/`wcPickSP` used to give
every "bulky"-role Pokémon an offense-boosting Nature (Adamant/Modest) and
split its Stat Points between offense and whichever defense was numerically
weaker — regardless of whether that Pokémon's own offense was actually any
good. That's precisely backwards for a support/wall Pokémon, and it's also
how Nature and Stat Points could end up flatly contradicting each other (an
offensive Nature paired with a defensively-split spread, or vice versa — the
tester's Gholdengo example). Now the two make the exact same comparison
first: does this Pokémon's primary offense stat actually outclass its own
bulk (the higher of its two defenses)? If so, it stays offensive, but Stat
Points now max HP alongside offense rather than a bare defensive stat — real
bulky-attacker spreads nearly always do, since HP is the most universally
efficient investment. If not, both flip to a defensive Nature (boosting
whichever defense is naturally stronger, only ever lowering the *secondary*
offense stat so this Pokémon can still use its own real STAB) with Stat
Points maxing HP and that same stronger defense. Nature and Stat Points can
no longer disagree about which kind of set this is.

**Teammate synergy now reaches the actual moveset, not just Dream Team's
species picks.** Milestone 36 taught Dream Team's species-*picking* step to
notice a forming Trick Room/Tailwind/weather/redirection strategy and lean
into it — but the actual moveset-*building* step (`wcPickMoves`/
`wcScoreMove`, used by every build flow: Autofill, Auto-build team, and
Dream Team's own build generation) had no idea a team was even being built
around it. `wcGenerateTeamBuilds` now threads a `teamSoFar` accumulator
(each already-built teammate's name and REAL chosen moves) into every
subsequent member's build, reusing Milestone 36's own
`wcDetectInProgressArchetype`/`wcArchetypeBeneficiaryScore` unchanged — the
trick being that those functions only ever read `learnableNames` and a real
ability, so handing them a teammate's actual finished moveset in place of
its full learnset works without any new detection logic, and is strictly
more precise (a real Trick Room already on the team beats merely being able
to learn one). `wcScoreMove` picks up two new, purely additive bonuses from
this: a Fire/Water move gets the same weather-boost bonus its own ability
would give it when a *teammate's* real ability already set that weather, and
a non-Status move gets a modest bonus when this Pokémon is a genuine
beneficiary of a teammate's already-built Trick Room, Tailwind, or
Follow Me/Rage Powder redirection — leaning into an aggressive moveset once
the team's speed control or protection is already covered elsewhere, instead
of duplicating utility that's already there.

**Honesty note, matching this project's existing trust-tier philosophy:**
this remains curated data plus a smarter heuristic, not a full damage-calc
optimizer (Showdown's calculator, bulk/speed breakpoint tuning) — that was a
deliberate scope decision, not an oversight. It's scoped to Doubles, per the
beta tester's own comment ("I don't play singles so I won't comment on
that"); the fallback-heuristic fix happens to be format-agnostic so it
improves Singles too, but no Doubles-specific work was ported over on
purpose.

## Screens, a softer kind of species preference, and a Mega matchup advisor (Milestone 37)

Phoenix shared a Gemini research chat about a real Doubles archetype
question: a Tailwind team built around Staraptor (Intimidate, but
defensively fragile), wanting either Mega Charizard Y or Mega Sceptile as
the team's Mega depending on the opponent, and wanting a dedicated screens
setter (Light Screen/Reflect) too — with an explicit ask that if Staraptor
ever got replaced, the replacement should carry equivalent value, not just
win on a raw score. All three pieces are now real, and all three are built
as extensions to the existing Team Notes system already covered above — no
new UI, no LLM integration, just teaching Team Notes to understand a few
more things.

**Screens is now a full seventh archetype, recognized everywhere Trick
Room/Tailwind/weather/redirection/hazards already are.** Milestone 36's
pre-build synergy detection (`wcArchetypeSignalsFor`/
`wcArchetypeBeneficiaryScore`) now recognizes a Pokémon that can learn
Light Screen or Reflect, and treats a real hard hitter (Attack or Sp. Atk
100+) as a genuine beneficiary — the same reasoning already used for
redirection, since screens and redirection both exist to keep a real
sweeper alive. Team Notes' keyword bias (`WINCON_NOTES_KEYWORDS`) picks up
"screens"/"light screen"/"reflect"/"dual screens" the same way every other
archetype's keywords already work. And Auto-build strategy's post-build
amendment system (`wcAnalyzeTeamStrategy`) can now propose a screens setter
outright — preferring a Prankster holder when one's on the team (priority
screens are strictly better, so this mirrors the weather block's own
preference for a free/no-cost setter), and falling back to whichever
member you've named in your notes otherwise.

**A genuinely scored, softer kind of preference — separate from the
existing hard "must include" system, and able to lose.** Team Notes'
existing include-triggers ("must include X", "built around X") still
force a Pokémon onto the roster unconditionally, exactly as before — this
doesn't touch that. But just mentioning a Pokémon's name in passing ("I've
landed on Staraptor...") used to do nothing at all during Dream Team's
picking step. Now it does: `wcNotesSoftPreferenceBonus` gives a plainly
mentioned Pokémon a small, fixed nudge (worth roughly a third of a real
archetype-synergy bonus) in Dream Team's scoring — enough to win a genuine
toss-up, never enough to beat a clearly better-fitting alternative. When a
mentioned, archetype-relevant Pokémon still loses out to a real
alternative, `wcSoftPreferenceTradeoffNote` says so plainly rather than
silently swapping it out: *"Staraptor wasn't included — Whimsicott is your
Tailwind setter instead (Prankster, not Reckless — if Staraptor's Reckless
mattered to you, this is worth a manual swap)."* It only ever speaks up
when there's something real to flag — a different-ability teammate
actually took over that exact role — and stays silent otherwise.

**Mega Sceptile now has a real curated set** (`WINCON_META_KNOWN_SETS`),
matching the existing convention: a Lightning Rod special attacker (base
Sp. Atk and Speed both 145, clearly its best stats), running Dragon Pulse/
Giga Drain/Focus Blast/Protect on a Timid Nature with Stat Points split
between Sp. Atk and Speed. Giga Drain over the harder-hitting Leaf Storm —
no self-inflicted Sp. Atk drop to manage turn to turn, plus real recovery,
a better fit for a Pokémon meant to threaten repeatedly rather than nuke
once.

**Multiple real Megas on one roster, treated as interchangeable, already
worked — WinCon just never had anything comparing them.** Real Champions/
VGC rules only limit Mega Evolution to one *use* per battle, a choice made
at Team Preview — not one held stone per roster — so `wcPickAutoMegaForm`
never enforced "only one Mega" in the first place, and both Mega Charizard
Y and Mega Sceptile can already sit on the same team, each fully built.
What was missing was the "which one this game" guidance itself: a new
`wcMegaMatchupAdvice` finds every team member that's currently built into
a real Mega form, and — with two or more — reuses the exact same
offense/defense typing scores Dream Team's own fallback picking already
falls back on (`wcTeamOffenseScore`/`wcTeamDefenseScore`) to rank them
against your current threats list, surfacing an explainable note in
Auto-build strategy's reasoning panel (*"Mega Sceptile looks like the
stronger matchup call against your current threat list. Mega Charizard Y
is the safer pick if the threats you're actually facing shift."*). It says
nothing when you have zero or one real Mega built, which is most teams.

**Same-species Mega-form preference, for the rare case a species has more
than one Mega form to choose between:** `wcPickAutoMegaForm` now also
checks whether a specific form's name is mentioned in your notes before
falling back to its existing default order.

**Honesty note, matching every other advisory feature in this project:**
the Mega matchup advisor is typing-based offense/defense fit against your
current threats list, not a full damage calculator — and, like the soft
preference nudge above, it never removes a Pokémon from your roster or
drops a build on your behalf. It only ever explains what the numbers
suggest and, when a preference didn't win out, what was traded away.

## Wide Guard, an anti-synergy auditor, and spread-move immunity safety (Milestone 38)

Phoenix shared a second research chat -- a full team architecture (a
Staraptor/Primarina Tailwind-and-screens core, a Dual-Mega Charizard-Y/
Sceptile pairing, Steelix as a Wide-Guard/Ground-immune anchor) -- and
asked WinCon to absorb the *thought process* behind it, not just that one
team. Checking it against the existing code found real depth already
there (Sneasler's curated set already encodes the doc's own White Herb +
Unburden trigger chain from real tournament usage, and screens already
covers its Primarina role from the milestone above) plus three genuine
gaps, now closed.

**Wide Guard is now a full eighth archetype**, exactly mirroring how
Trick Room/Tailwind/weather/redirect/hazards/screens already work:
`wcArchetypeSignalsFor`/`wcArchetypeBeneficiaryScore` recognize a real
Wide Guard learner and treat a genuine hard hitter (Attack or Sp. Atk
100+) as the beneficiary it exists to protect, Team Notes' keyword bias
picks up "wide guard"/"wideguard"/"spread protection", and Auto-build
strategy's amendment system can propose a Wide Guard setter outright.
Unlike screens, Wide Guard's +3 priority is baked into the move itself,
so there's no ability-based branching -- just a learner, optionally the
one you named in your notes.

**A new anti-synergy auditor (`wcAntiSynergyWarnings`) flags real,
current conflicts a team's own build can quietly have with itself** --
the first version of exactly what the shared doc's own framing asked for
("identify hidden anti-synergies"). It starts with two real, well-
understood Doubles/Champions conflicts, checked directly against your
actual builds after Generate Dream Team or Auto-build strategy runs: a
teammate's own Sandstorm (Sand Stream) chipping a same-team Focus Sash
holder that isn't Rock/Ground/Steel-typed for 1/16 max HP a turn -- Focus
Sash only triggers from full HP, so even one turn of that residual damage
first quietly breaks it (Snow no longer deals residual damage in the
current generation, so only sand is checked, matching how this app
already models weather elsewhere); and a teammate holding Choice Scarf
while another teammate's real, built moveset runs Trick Room -- Scarf's
Speed boost works directly against Trick Room's reversed turn order for
that Pokémon specifically. Honesty note, matching `WINCON_SPREAD_MOVES`'s
own comment: this is a hand-picked starting set, not an exhaustive
conflict-detection engine -- more real, well-understood conflicts can be
added the same way later.

**Immunity-enabled spread-move safety** rewards the exact synergy the
doc's Steelix/Earthquake framing described: in Doubles, a spread move
(`WINCON_SPREAD_MOVES`) also hits your own ally by default, so pairing
one with a teammate immune to that move's type lets it be thrown every
turn for free. `wcSpreadMoveSafetyBonus` checks both directions during
Dream Team's picking (a candidate immune to a teammate's already-learnable
spread move, or a candidate that can learn one a teammate is already
immune to) and is genuinely general-purpose, not hardcoded to Ground --
a Water-immune ally next to Surf, an Electric-immune ally next to
Discharge, and so on, all count the same way. Singles-only teams get
nothing from it, since a spread move never hits an ally there in the
first place.

**A chatbot layer is being scoped separately and is intentionally not
part of this milestone.** The doc's own Section 3 sketched a system
prompt for wrapping WinCon in a conversational LLM assistant -- a real
architectural departure from everything above, which is deliberately
curated data plus explainable, non-LLM heuristics. That needs its own
backend (a new Vercel serverless function, following the same pattern
`api/cron-limitless-sync.js` already established) and a real, billed
Anthropic API key, which only Phoenix can create -- tracked as a
follow-up once that's set up, not folded into this milestone's scoring
changes.

## Terrain, Quick Guard, Aurora Veil, Helping Hand, Safeguard, and two small refinements (Milestone 39)

Phoenix asked for a full audit of "Special" move category moves and how
they affect battles the same way Light Screen/Reflect/Wide Guard already
do -- turned out she meant **Status**-category moves (Light Screen/
Reflect/Wide Guard are all Status, not the separate 120-move Special
damage-dealing category, confirmed and clarified before starting). Every
one of the 176 real Status moves in `data/moves.json` got checked against
the archetype-synergy system from Milestones 36-38. Her call on what to
build: all of it, terrain first.

**Terrain is a new archetype family -- four of them.** Electric/Grassy/
Misty/Psychic Terrain are learned by 20/27/30/30 of the 298 species in
`data/learnsets.json` (6.7%-10.1%), squarely the same "genuine minority,
real signal" range as Trick Room (17.8%) and Wide Guard (8.1%) --
terrain-setting *abilities*, unlike weather's, are essentially absent
from this dataset (only one curated Pokemon holds one), so terrain is
**move-signaled** like Trick Room/Tailwind/Wide Guard, not ability-only
like weather. Electric/Grassy/Psychic Terrain each get a real
`wcArchetypeBeneficiaryScore` case (a 1.3x STAB boost for a grounded
attacker of the matching type, confirmed against each move's actual
in-game description); Misty Terrain is whole-side defensive utility
(halves incoming Dragon damage, blocks status/confusion) with no single
power-matched beneficiary, so it honestly scores 0 there -- the same
precedent entry hazards already set.

**Quick Guard is Wide Guard's direct sibling**, protecting the team's
real hard hitter from priority moves instead of spread moves, in exactly
the same five places (signal detection, beneficiary scoring, notes
keywords, display name, Auto-build strategy amendment).

**Aurora Veil extends the existing screens archetype, rather than
becoming a ninth one.** It's strictly better than Light Screen + Reflect
combined -- one move covers both physical and special damage reduction --
but only works while Snow is active, so it only ever counts as a real
signal for a Pokemon that sets its *own* Snow. Notably, Alolan Ninetales
holds Snow Warning **and** learns Aurora Veil -- a genuinely
self-sufficient setter, confirmed directly against the data. Auto-build
strategy now prefers that path over Light Screen/Reflect (even over
Prankster) when it's real, and falls back to the existing behavior
otherwise -- Milestone 37's Whimsicott/Prankster case is untouched.

**Helping Hand took a deliberately different shape.** It's learned by
204 of 298 species (68.5%) -- nowhere near a real "setter signal" the way
an 8-18% move is. Giving it the same `wcArchetypeSignalsFor` treatment as
everything above would mean the Dream-Team-picking bonus firing for most
candidates regardless of team composition -- a fake signal, not a real
one, exactly the failure mode weather's ability-only design already
exists to avoid (its own move pair sits at ~95% learnability, which is
why weather is detected by ability alone). So Helping Hand deliberately
has no entry in the pick-time archetype system at all. It only ever gets
proposed by Auto-build strategy, after the team is built, and only when
there's a real hard hitter (Attack or Sp. Atk 100+) already on the roster
worth amplifying -- the reason to run it isn't "something can learn it",
it's "something on this team is worth spending a teammate's move slot
boosting." Doubles-only, since Helping Hand needs an adjacent ally.

**Safeguard is a tenth simple archetype** -- 5-turn team-wide immunity to
status conditions and confusion, learned by 22.8% of all species (the
same healthy range as Stealth Rock/Trick Room). Like Misty Terrain, it's
whole-team protection with no type-matched power beneficiary, so its
beneficiary score is honestly 0 too.

**Two small refinements closed out the audit.** Chilly Reception
(Slowking/Galarian Slowking only -- 2 of 298 species, genuinely rare and
deliberate, nothing like Sunny Day/Rain Dance's near-universal rate)
folds into the existing snow archetype as a second, move-based setter
path -- a real Snow Warning ability setter still wins when both exist,
since it costs no move slot, but Chilly Reception is now a real fallback
when that's all a team has. And Parting Shot (lowers Attack/Sp. Atk by 1,
then switches out -- a real pivot move by the same mechanic as U-turn/
Volt Switch/Flip Turn/Baton Pass) was simply missing from
`WINCON_PIVOT_MOVES`, so Tailwind's own pivot-sequencing note now
recognizes it too.

Six new test files (`tools/test-terrain-archetypes.mjs`,
`tools/test-quickguard-archetype.mjs`, `tools/test-aurora-veil-screens.mjs`,
`tools/test-helping-hand.mjs`, `tools/test-safeguard-archetype.mjs`,
`tools/test-chilly-reception-and-parting-shot.mjs`), 42 checks total, all
green alongside the full existing suite (24 files, zero regressions).


## "My Pokédex" vs. "Full Pokédex" -- a candidate-pool toggle for Generate Dream Team (Milestone 40)

The first phase of a larger diversity/explainability roadmap (the rest is
tracked outside this repo, not built yet). Generate Dream Team has always
picked its 6 from `eligibleObtainedMembers()` -- whatever's marked
obtained on the Pokédex tracker, and only that. Right for "build me a team
from what I actually own," but it meant a newer player with a thin
Pokédex could never see what a genuinely good team looks like, and there
was no way to theorycraft with the full roster. WinCon's whole point is
helping beginners learn to build a competitive team -- gating that behind
"catch a bunch of Pokémon first" got in the way of the very thing it's
supposed to teach.

**The fix is a single toggle, not a new picking system.** A new
`poolScope` field on each saved team -- `"obtained"` (default, today's
exact behavior, and what a team saved before this milestone gets since it
has no field for it at all) or `"full"` -- saved/loaded through
`wcGetPoolScope()`/`wcEmptyTeam()` in teams.js, exactly the way
`format`/`sheetMode` already are. `eligibleObtainedMembers()` in
builder.js becomes a thin branch: `"obtained"` is untouched, byte-for-byte
the same code as before; `"full"` drops the ownership filter and returns
every Base-form species in `data/pokemon.json` with confirmed
base-stat/learnset data, excluding Mega forms the same way `buildRivalPool()`
(Your Rival's own full-roster pool) already does -- they're never
independently picked, only opted into per-slot.

Nothing downstream had to change. `wcPickDreamTeam` and every
scoring/archetype function it calls are handed the exact same shape of
pool either way and have no idea which mode built it -- this was a clean,
single-chokepoint change plus a UI toggle and a per-team field, exactly as
scoped. When Full Pokédex is active, Dream Team's own note says plainly
that some of these six may still need catching or training in-game --
never presented as if they're already on the roster. Auto-build team
didn't need this: it builds movesets for whatever's already in your 6
chosen slots, it never selects the pool itself, so there was nothing there
for this toggle to change.

One new test file (`tools/test-pool-scope-toggle.mjs`, 10 checks): direct
coverage of `wcGetPoolScope`'s defensive fallbacks (legacy team, null,
garbage value, real "full"), plus a mirror of `eligibleObtainedMembers()`'s
"full" predicate checked straight against the real data files -- every
Mega form excluded, Phoenix's own reference-team roster (Staraptor,
Primarina, Sneasler, Sceptile, Steelix, Charizard) included, and the full
pool genuinely dwarfing a small hand-picked "obtained" list. (Builder.js
itself has never been unit-tested in this project -- its top-level code
reaches for real DOM elements the instant it loads, so every test file,
this one included, tests the pure logic underneath rather than loading
the page glue.) All 25 files green, zero regressions.

## A genuine shared-weakness audit, computed rather than hand-picked (Milestone 41)

Phase 2 of the same diversity/explainability roadmap. `wcAntiSynergyWarnings`
(Milestone 38) only ever checked two specific, hand-picked conflicts --
a teammate's own Sandstorm chipping an unprotected Focus Sash holder, and
a Choice Scarf holder fighting a real Trick Room build. Both real, both
worth flagging -- but neither is the more general case the methodology
review actually asked about: two team members with genuinely DIFFERENT
typings that still both take a real hit from the same attacking type.
`wcSameTypingPenalty` (used during Dream Team picking) only ever catches
an exact type-combo duplicate; nothing said anything when, say, a
Grass/Poison and a Dragon/Flying Pokémon both turned out to be sitting on
a real Ice weakness.

**`wcSharedWeaknessWarnings(members, typeChart)`** (strategy.js) closes
that gap, and it's a genuinely different kind of check from the two it
sits alongside: it needs no curated list at all. It's pure type-chart
math -- every unordered pair on the team, checked against every real
attacking type in `typeChart.types` via the same `wcEffectivenessOf`
helper `wcDefenseCoverageBonus`/`wcTeamNetScoreForType` already use (19
types x 15 pairs for a full 6-member team, nothing that needs memoizing).
Any type that deals 2x or more to BOTH members gets named in plain
English, calling out a 4x hit explicitly since that's a materially worse
number than a plain 2x. Because it's fully computable rather than
hand-picked, it can honestly claim to catch *every* shared weakness on
the finished team -- worth stating plainly, since every other advisory
note in this file up to now (`WINCON_SPREAD_MOVES`, `data/starter-threats.json`,
both of `wcAntiSynergyWarnings`' own checks) is deliberately "hand-picked,
not exhaustive," and this one just isn't.

Its output renders in the exact same slot the existing anti-synergy
warnings already had in builder.js (`renderDreamTeamNote`/`renderStrategyNote`)
-- both call sites (`generateDreamTeam()`, `autoBuildStrategy()`) now just
concatenate `wcAntiSynergyWarnings`' and `wcSharedWeaknessWarnings`' output
into one combined list before it's rendered; neither render function's
own signature had to change.

New test file (`tools/test-shared-weakness-warnings.mjs`, real fixtures
pulled straight from `data/pokemon.json`): Venusaur (Grass/Poison) and
Beedrill (Bug/Poison) -- two genuinely different typings that both take a
real 2x hit from Fire, Flying, and Psychic; Venusaur and Dragonite
(Dragon/Flying) for the 4x case (Ice hits Dragonite for a full 4x);
Venusaur and Charizard (Fire/Flying) as the honest negative case -- no
shared 2x-or-worse weakness between them, so no warning fires. 12 checks
total, all green alongside the full existing suite (26 files, zero
regressions).

## The root cause of Dream Team collapsing onto the same names, and an experience-based diversity nudge (Milestone 42)

Phase 3 of the same roadmap. Traced two real, concrete mechanisms behind
"Dream Team keeps suggesting the same 6-8 Pokémon":

1. `wcPickDreamTeam`'s guaranteed-Mega step always forced up to 2 picks
   from the small pool of Mega-eligible species (curated or live-
   confirmed sets only, maybe 20-40 of 298 species), via a `bestFromRemaining`
   closure that always took the single top-scoring candidate from that
   pool -- deterministically, every single run.
2. `WC_META_USAGE_WEIGHT` (2) and `WC_LIVE_META_CANDIDATE_WEIGHT` (1.75)
   are large enough, relative to `coverageGain * 1.5`, to keep pulling
   even the ordinary greedy loop back toward the same "confirmed good,
   real logged win rate" names.

Neither mechanism is wrong to have -- every team should get a real Mega
option, and a real logged win rate is genuinely useful signal -- so
neither was removed. What changed is how a tie among several
legitimately strong candidates gets broken.

**`topCandidatesFromRemaining(remaining, scoreFn, filterFn, n)`** (strategy.js)
is the refactor of the old `bestFromRemaining` closure into a real,
standalone, independently-testable primitive: pull the top `n` distinct
candidates by score instead of just #1. **`wcWeightedPickFromTop(tier, randomFn)`**
picks one candidate from that small tier, weighted by rank (1st most
likely, tapering off fast) rather than raw score, since
`wcDreamTeamCandidateScore`'s output can be negative or wildly scaled
depending on the team so far. `wcPickDreamTeam` gained two new trailing,
optional parameters: `experienceLookup` (below) and `diversify` -- with
`diversify` unset, which is every existing call site today, the tier size
is forced to 1, and both new functions collapse straight back to the
exact old deterministic "always take #1" behavior (proven directly: with
`Array.prototype.sort` stable in this runtime, an exact tie still
resolves to whichever candidate appeared first, byte-identical to the old
strict `score > bestScore` scan). `diversify: true` isn't wired into any
button yet -- it's built and fully tested end-to-end so the later "give
me multiple team options" feature can flip it on for a second candidate
team without duplicating any of this scoring logic.

**`wcExperienceDiversityBonus(name, experienceLookup)`** is the separate,
smaller half of this milestone: a real nudge away from species the
player has personally used a lot already. There's no per-species
usage-frequency field anywhere in this app, so `buildExperienceLookup()`
(builder.js) derives one from what's already real: every saved team
(any format) that includes species X contributes that team's own logged
win+loss count (`wcMatchRecordSummary`, the same number `renderMatchRecord()`
already shows) to X's running total. The bonus itself saturates at 10
logged matches so a prolific player's most-used species can't spiral into
an ever-growing penalty, and its full weight (0.5) is deliberately the
same order as `WC_SOFT_PREFERENCE_BONUS` -- a nudge toward trying
something new, never enough on its own to beat a real matchup/coverage
edge. Threaded into `wcPickDreamTeam`/`wcDreamTeamCandidateScore` as a new
opts field the same way `metaUsage`/`liveMeta` already are, wired into
Generate Dream Team only -- Your Rival's pool is an adversarial pick meant
to challenge the player, not a "help this player try something new" one.

New test file (`tools/test-dream-team-diversity.mjs`, 20 checks): the two
new primitives in isolation (including a `diversify: true` end-to-end
Dream Team run with `Math.random` forced to a controlled value, proving
the sampling genuinely wires through the guaranteed-Mega step rather than
just existing as unused helpers), `wcExperienceDiversityBonus`'s bounds
and saturation, and a real-matchup regression guard (same established
"two real Water-type threats, Grass genuinely favored over Fire" fixture
`test-soft-preference.mjs` already uses) proving a real coverage edge
still beats even a maximally-saturated experience penalty. All 27 test
files green, zero regressions.

## Auto-build strategy now bakes multiple compatible archetypes straight into the first build (Milestone 43)

Phase 4 of the Team Diversity Roadmap. Before this, Auto-build strategy
(`wcAnalyzeTeamStrategy`) only ever surfaced a single winning archetype
plus one alternative, and neither ever touched a real build until the
player clicked "Make changes" by hand — even when a team genuinely
supported two or three non-conflicting strategies at once (a Trick Room
setter AND a Wide Guard user AND a screens user, say). This milestone
makes that automatic, for all three of `wcGenerateTeamBuilds`'s real call
sites (Dream Team, Auto-build team, Your Rival) at once, with zero
call-site changes.

**`wcBuildStrategyCandidates`** is `wcAnalyzeTeamStrategy`'s own
candidate-construction logic (all ~15 archetype blocks — Trick Room,
Tailwind, weather, redirect/hazards, screens, Wide Guard, Quick Guard,
terrain, Safeguard, Helping Hand), pulled out into its own function that
returns the FULL list instead of just the top 2.
`wcAnalyzeTeamStrategy` itself calls this helper and is otherwise
byte-identical to before the split — same single winner, same one
alternative, same "balanced" fallback text, verified directly in the new
test file.

**`wcAssignTeamSynergy`** resolves that full list into a set of
non-conflicting assignments: walk candidates from highest `fitScore`
down, accept one per still-open "conflict group," and cap any one setter
at a single forced role. Speed control (Trick Room and Tailwind flip turn
order in opposite directions) and the four terrains (only one can ever be
active) are real either/or groups; every other archetype — screens, Wide
Guard, Quick Guard, Safeguard, redirect, hazards, Helping Hand, and each
weather — is independent and stackable, so a team can genuinely end up
with a Tailwind setter, a Wide Guard user, and a Safeguard user all baked
in from one generate.

**Setter selection also got smarter.** Every archetype block that used to
default to "first eligible learner" when the team notes didn't name
anyone (`(pool) => pool[0]`) now falls back to `wcStrongestPick` — a
composite of BST, best offensive stat, and physical+special bulk — so a
genuinely strong attacker or wall wins the tie over whichever species
happened to be built first. Blocks that already had a real criterion
(Trick Room's slowest, Tailwind's fastest, hazards' most-hazard-moves-
learnable) are untouched; only the "no real reason, just took #1" cases
changed.

**Applying an accepted assignment reuses the existing machinery**, not
new code: `wcProposeSetterAmendment` diffs the wanted moves/role against
the setter's current build exactly as it already does for the manual
"Make changes" flow, and the new `wcApplyAmendmentToBuild` mutates the
real build in place (the automatic counterpart to the read-only
`wcApplyAmendmentToFields` builder.js's locked-build preview already
used), keeping the shared Item Clause set in sync.

**Auto-Mega suppression fixes a real bug**: a Tailwind lead could
auto-evolve into a Mega form that changes its ability — the concrete case
that surfaced this was Staraptor (base ability Reckless, real Tailwind
learner, real curated Mega Staraptor set) auto-evolving into Mega
Staraptor (Contrary) the moment it was picked, even when the team actually
wanted it running support, not its Mega. Since `wcGenerateBuild`'s
auto-Mega decision happens during the very first build pass — before any
synergy assignment can even be computed, since that assignment needs a
real, finished build to read roles from — this needed two passes: build
everyone once as before, compute the assignment, then re-generate (with
a new `opts.skipAutoMega` flag) just the build of any member whose first
pass auto-Mega'd and who ended up assigned a forced role. A build now
reports `autoMegaApplied` so the second pass knows who actually needs it;
a slot that's a direct Mega already (its own name IS the Mega form) is
never touched, since there's no base form to fall back to.

**A deliberate, honestly-documented scope limit**: teammates built
*before* an amended member in `wcGenerateTeamBuilds`'s left-to-right pass
already scored their own moves against that member's pre-amendment build
(see `teamSoFar`/`teamContext`). Retroactively re-scoring every earlier
teammate against every later automatic amendment would be a much bigger
re-optimization pass than this milestone is — the amendment still lands
correctly on the assigned member itself, just without cascading back
through teammates that were already finished.

New test file (`tools/test-strategy-synergy-assignment.mjs`, 18 checks):
`wcStrongestPick`/`wcAttackerOrWallScore` in isolation; `wcAssignTeamSynergy`
against hand-built candidates covering the speed-control conflict, the
terrain conflict, independent stacking, the same-setter cap, a combined
realistic pass, and purity (never mutates its input); `wcApplyAmendmentToBuild`'s
real mutation (moves/nature/sp/item, Item Clause bookkeeping); `wcBuildStrategyCandidates`
returning 3+ real archetypes for one team (Farigiraf/Steelix/Slowbro) where
`wcAnalyzeTeamStrategy` itself still only surfaces one winner + one
alternative; `wcGenerateBuild`'s new `skipAutoMega`/`autoMegaApplied`
in isolation (including the direct-Mega-slot edge case); and two real
end-to-end `wcGenerateTeamBuilds` runs — Staraptor gets Tailwind baked in
and loses its Mega Stone automatically, and (with tailwind/sun/rain
suppressed via notes) both Staraptor and Charizard keep their real Mega
sets when neither ends up assigned anything. The existing
`tools/test-team-move-synergy.mjs` regression case (Slowbro/Gengar, no
forming archetype) still passes unchanged. All 28 test files green, zero
regressions.

## "How to pilot this team" explainer bubble, and a stated counter for every strategy (Milestone 44)

Phase 5 of the Team Diversity Roadmap. Dream Team and Auto-build strategy
already computed four genuinely useful pieces of advice about a team's
strategy -- its primary mechanism and setter (`wcAnalyzeTeamStrategy`,
now actually *applied* to the build since Milestone 43, not just
suggested), which Mega to bring (`wcMegaMatchupAdvice`), and two
different anti-synergy warning sources (`wcAntiSynergyWarnings`,
`wcSharedWeaknessWarnings`) -- but they rendered as separate pieces in
the existing strategy callout, with nothing tying them into one
"here's how to actually play this team" read, and nothing about how an
opponent might beat it back.

**`WINCON_ARCHETYPE_COUNTERS`** (strategy.js) is the one genuinely new
piece of content: a hand-picked, real, well-known counter-mechanism and
the reason it works for every archetype key this app can surface as a
team's strategy (Trick Room, Tailwind, all four weathers, screens, Wide
Guard, Quick Guard, Safeguard, redirection, hazards, all four terrains,
and Helping Hand) -- 17 entries, same "hand-picked, not exhaustive"
honesty convention as `WINCON_SPREAD_MOVES`/`starter-threats.json`/
`wcAntiSynergyWarnings`' two checks, and said so directly in the code
comment. A few examples: Trick Room's real answer is a priority Taunt
(silences the setter before Trick Room even goes up); the four terrains
all share the same real answer (anything ungrounded is untouched by any
of them); Helping Hand's is Protect on the boosted target (wastes the
one-turn boost outright). `wcStatedCounterNote(archetypeType)` returns
that line, or `null` for `"balanced"` -- there's nothing specific to
counter when no single mechanism won out.

**`wcAssemblePilotGuide(strategy, megaAdvice, antiSynergyWarnings)`**
(strategy.js) is the actual synthesis: a small, pure, DOM-free function
that pulls the primary archetype's display label and setter, its
mechanism note, the Mega matchup note, the combined warnings list, and
the new stated-counter line into one plain object. It's deliberately
*just* assembly -- every field already existed somewhere else in this
file, reused as-is rather than recomputed. (One small real gap fixed
along the way: `WC_ARCHETYPE_DISPLAY_NAMES` never had a `helpinghand`
entry, since Milestone 36 deliberately excluded Helping Hand from the
pick-time archetype-signals system -- but it can still win as
`wcAnalyzeTeamStrategy`'s own top candidate, so it needed a real label
too.)

**The new panel itself** (builder.js's `renderPilotGuideNote`, a new
`#pilot-guide-note` callout below the existing strategy note in both
Builder pages) is a thin DOM renderer over that object -- a heading
("How to pilot this team"), the mechanism + setter, "Which Mega to
bring," "Watch for" (the combined warnings), and a visually distinct
"How an opponent might counter this" line, styled with the same
caution-colored accent used elsewhere for mixed/moderate signals. It's
called as the very last step of the existing `renderStrategyNote`, so it
renders right after Dream Team generation, right after Auto-build
strategy, and stays in sync automatically if the player switches to the
alternative strategy -- no new call sites needed anywhere.

New test file (`tools/test-pilot-guide.mjs`, 13 checks): every real
archetype key gets a genuine, non-empty stated counter;
`"balanced"`/an invalid key correctly return `null`;
`wcAssemblePilotGuide`'s handling of a `"balanced"` strategy, a real
archetype (label/setter/mega-advice/warnings/counter all present and
correct), the `helpinghand` display-name fix, safe defaults when
`megaAdvice`/warnings are omitted, and that it never mutates the
caller's own warnings array. All 29 test files green, zero regressions.

## Generate Dream Team now produces two genuinely different options (Milestone 45)

Phase 6 of the Team Diversity Roadmap, and its capstone: Generate Dream
Team used to hand back exactly one team, full stop. This milestone makes
it hand back two genuinely different ones -- a different Mega core and a
different primary mechanism, not just a reshuffled flex slot or two --
with a small UI control to compare them side by side before committing
either one to your saved team.

**The core idea is exclusion, not randomness.** `wcPickDreamTeam` has no
randomness at all unless `diversify: true` is explicitly passed (see
Milestone 42), and this feature deliberately never passes it -- rerolling
with randomness could easily hand back a team that's 90% the same six
names in a different order. Instead, the new `wcPickDreamTeamOptions`
(strategy.js) runs `wcPickDreamTeam` once, completely normally, to get
Option 1. It then identifies Option 1's own *mechanism-defining* picks --
the specific Pokemon that made it the team it is, not just whoever
happened to fill a flex slot -- and excludes exactly those names from the
pool before running `wcPickDreamTeam` a second time for Option 2. With
the team's actual backbone gone from the pool, Option 2 is structurally
forced to build around a different Mega and a different strategy, not
just rearrange what's left.

"Mechanism-defining" means two things, unioned together: `wcPickDreamTeam`'s
own guaranteed-Mega picks (the up-to-two Mega-capable species its closing
loop specifically chose, now surfaced via a new `guaranteedMegaNames`
field on its return value -- previously computed internally and
discarded) and whichever setter Milestone 43's `wcAssignTeamSynergy`
picked for Option 1's primary archetype (read from `wcAnalyzeTeamStrategy`'s
own `setterName`, since its winning candidate is always
`wcAssignTeamSynergy`'s first accepted one -- calling `wcAssignTeamSynergy`
a second time directly would just recompute the same answer). If Option 2's
pool doesn't leave at least six eligible Pokemon after that exclusion, it
honestly returns `option2: null` rather than forcing a worse, incomplete
team on the player -- confirmed with a dedicated deterministic test using
a small controlled 7-member pool where excluding 2-3 mechanism names
always leaves fewer than six, regardless of which archetype wins.

**Both options are fully real, not previews**: each gets its own complete
`wcGenerateTeamBuilds` run (so Milestone 43's baked-in synergy assignment
and auto-Mega suppression both apply independently to each) and its own
`wcAnalyzeTeamStrategy` pass, exactly like a normal single-option Dream
Team always has.

**builder.js wiring**: `generateDreamTeam` now calls
`wcPickDreamTeamOptions` instead of `wcPickDreamTeam` directly, and a new
`buildDreamTeamOptionRenderData` factors out everything that used to
happen inline for the single result (team-notes trade-off/exclusion
notes, converting to each member's actual Mega form via
`effectiveMemberFor` so strategy analysis and Mega-matchup advice see
what the build really is, Milestone 44's pilot-guide assembly) so it can
run once per option. A new `#dream-team-options` control at the top of
the generated team card -- a two-card segmented layout, hidden entirely
when there's no real Option 2 -- shows each option's mechanism, setter,
and a condensed stated-counter preview (built from the same
`wcAssemblePilotGuide` Milestone 44 introduced) so the two are genuinely
comparable before committing. Clicking a card (`selectDreamTeamOption`)
swaps the working `chosen`/`builds` over to that option and renders it
through the exact same `renderDreamTeamNote`/`renderStrategyNote` pipeline
a single-option Dream Team always has -- including Milestone 44's full
"how to pilot this team" bubble -- so switching options is genuinely a
full swap, not a partial one. One real implementation wrinkle worth
documenting honestly: `applyAmendmentsToBuilds` mutates the module-level
`builds` global directly rather than taking one as a parameter, so
amendments for a given option are only ever applied *after* `builds` has
actually been pointed at that option's own build set (inside
`selectDreamTeamOption`), never during the earlier per-option
data-assembly pass -- applying them at the wrong time would either mutate
the wrong object or silently no-op.

New test file (`tools/test-dream-team-options.mjs`, 10 checks), run
against real game data (moves/type chart/base stats/learnsets/abilities/
species, the same real full ~290+ species pool `eligibleObtainedMembers`'s
"Full Pokédex" mode itself builds from) rather than small hand-built
fixtures, since `wcPickDreamTeam`'s determinism (no `diversify`) makes a
full-pool integration test fully reproducible, not flaky: confirms the
Milestone 42 (`topCandidatesFromRemaining`/`wcWeightedPickFromTop`) and
Milestone 43 (`wcAssignTeamSynergy`/`wcBuildStrategyCandidates`) dependencies
this phase builds on both actually exist; `wcPickDreamTeam`'s new
`guaranteedMegaNames` field; two full, genuinely different 6-member
rosters from the real full pool; the core disjointness guarantee (Option
2's roster contains none of Option 1's `guaranteedMegaNames`/`setterName`
union, and that union is computed exactly as documented); Option 1 and
Option 2 never share a guaranteed-Mega pick and differ in primary setter
when both exist; both options carry a real strategy and a full build for
every member; and the `option2: null` honest-failure edge case. All 30
test files green, zero regressions.

This closes out the Team Diversity Roadmap's six phases: real diversity
in Dream Team's own scoring (Phase 3/Milestone 42), automatic multi-
archetype synergy baked into the first build instead of a single manual
suggestion (Phase 4/Milestone 43), a "how to pilot this team" explainer
with a stated counter (Phase 5/Milestone 44), and now two genuinely
different Dream Team options to choose between before ever committing
one (Phase 6/Milestone 45).

## The "WinCon Meta Analyst" -- a deterministic team critique engine (Milestone 46)

Phoenix brought in two things she'd sourced elsewhere to compare against WinCon: a team another AI (Gemini) had generated for this exact game -- "Mega Sceptile & Charizard Y Dual-Core" -- and a system-prompt draft for an "LLM chatbot" that would critique pasted teams against four checks (archetype/synergy conflicts, physical/special move-vs-stat mismatches, a Trick Room defense audit, and utility item value). WinCon has no backend and holds no API key -- there's nowhere safe for a static, client-side page to call a real LLM from -- so instead of wiring up a chatbot, this milestone builds the same four checks as new, deterministic, rule-based logic, following every other analysis feature in this file's own explainable, no-guessing convention.

**`wcMoveStatMismatchWarnings`** flags a move whose category doesn't match which offensive stat a Pokemon actually invests in -- the sourced prompt's own example was a Special attacker (like Mega Sceptile) running a Physical move it'd be better off swapping for a same-type Special one -- but only when a genuinely better, same-type, opposite-category alternative actually exists in its real learnset and isn't already sitting in another slot. A 20-point Atk/SpA gap is the bar for "notably better stat"; smaller gaps are normal coverage tradeoffs and stay quiet, and a mon with no real alternative to switch to (like Mega Sceptile's Rock Slide, which has no learnable Rock-type Special move at all) is never flagged just for looking suspicious.

**`wcTrickRoomDependencyWarnings`** catches a real logical gap the Gemini team actually had: Steelix was built with a Brave nature and 0 Speed Stat Points -- a genuine "Trick Room sweeper" spread meant to move last and hit hard -- but nothing on that team actually knows Trick Room, so it would just be slow, not advantaged. This checks Stat Points, not IVs: Pokemon Champions fixes every Pokemon's IVs at 31 (see `wcParseShowdownTeam`'s own IV-line warning), so there's no 0-Speed-IV trick in this game at all -- 0 Stat Points is the real, only lever, and the only genuine signal. A member that itself knows Trick Room is exempt, and a Sassy/Relaxed 0-Speed build (a "doesn't care about Speed order either way" support pivot, not a sweeper) never triggers this check at all -- that pattern is a different, healthy one, covered by the next check instead.

**`wcAntiTrickRoomAudit`** is the "Trick Room defense audit" the sourced prompt asked for, for any team that isn't itself running Trick Room as its own strategy: does the team have a Taunt user (silences an incoming setter before it moves), a Fake Out user (its fixed +3 priority still goes before a slower Trick-Roomed opponent, since Trick Room never reverses priority brackets, only turn order within one), a genuine minimum-Speed utility pivot (0 Stat Points -- unbothered either way Speed order runs), and a Safety Goggles holder (bypasses Spore/Rage Powder-style redirection and status). Each either confirms a real tool the team already has or names a real gap -- Incineroar alone (Fake Out, Taunt, Sassy nature, Safety Goggles) covers all four in the Gemini team.

**`wcItemValueAudit`** is the "utility item value checks" the prompt asked for: a small, hand-picked (not exhaustive, said so directly in the code comment) set of high-variance RNG items -- Quick Claw, King's Rock, Lax Incense, Bright Powder -- gets flagged wherever held, and two concrete, always-correct upgrades get a real `suggestedFix`: Light Clay for a member already setting up both Reflect and Light Screen (or Aurora Veil) without holding it, and Focus Sash for a Tailwind lead holding no item at all. Both are conservative on purpose -- neither ever suggests replacing a real Mega Stone or an item a build already has a reason to hold, only filling a genuinely empty or clearly-worse slot. Every real item choice on the Gemini team (Staraptor's Focus Sash, Primarina's Light Clay, Incineroar's Safety Goggles) was already correct -- a real, honest "nothing to fix here" pass, not a forced finding.

**`wcMetaAnalystReport`** is the single entry point combining all four new checks with the strategy/Mega-matchup/anti-synergy analysis this file already had, plus a `modes` breakdown matching the sourced prompt's own requested "Team Modes" response shape (a team's primary archetype as one mode, its anti-Trick-Room posture as another). `wcApplyMetaAnalystFixes` is a small, pure fix-applier (never mutates its input, same purity contract as `wcAssignTeamSynergy`) that turns every concrete `suggestedFix` the report found into a real, optimized build -- what actually powers the copy-pasteable Showdown export at the end of the panel.

**The new "Run Meta Analyst" button** (both Builder pages, next to Auto-build strategy) runs this on whatever's currently in the team slots -- built via Dream Team, Auto-build team, Auto-build strategy, or a pasted Import, it doesn't matter which -- and renders a new, distinct `#meta-analyst-note` panel: a "Team Modes" heading with each detected mode, then headed sections for the physical/special synergy checks, Trick Room dependency, item value checks, and any other anti-synergy warnings, ending in a real Showdown-format export block (with a Copy button) that reflects every concrete fix found -- an "optimized, copy-pasteable Showdown block," exactly as the sourced prompt's response format asked for.

New test file (`tools/test-meta-analyst.mjs`, 25 checks): each of the four new checks in isolation against real species/stats/learnsets/items (including the exact real-data edge cases -- Mega Sceptile's genuine Dragon Rush/Dragon Pulse mismatch, Steelix's real Trick Room dependency, the Mega Stone exemption, the "already correct" quiet passes); the pure fix-applier's purity and correctness; and a full integration test running `wcMetaAnalystReport` against the actual Gemini-generated team (with its one illegal move -- Staraptor can't really learn Taunt in this game's data, confirmed separately and exactly the kind of thing `wcParseShowdownTeam`'s own movepool-legality warning already catches for a real paste -- swapped for the real, legal Protect so the strategy layer has something valid to run end to end), confirming it catches the one real issue that team actually had (Steelix's Trick Room dependency) while correctly passing everything it already got right (zero move mismatches, a clean anti-Trick-Room audit, a clean item audit). All 31 test files green, zero regressions.

## UI polish pass: Meta Analyst cleanup, best-matchup analysis, and trimmed reasoning app-wide (Milestone 47)

Phoenix reviewed the Meta Analyst screen (Milestone 46) and asked for a batch of visual and content edits, several of which turned out to apply more broadly than that one panel.

**Showdown export is now a button that opens an editable modal**, not an inline read-only block. Clicking "View Showdown export" (or "View optimized Showdown export" when the Meta Analyst found real fixes) opens `#meta-analyst-export-modal` -- the same modal shape as the existing (read-only) Export team modal, but its textarea has no `readonly` attribute, so the text can be hand-edited before copying it out; the Copy button reads the textarea's live value at click time, so any edits made in the popup are exactly what gets copied.

**"Other Anti-Synergy Warnings" is renamed "Anti-Synergy Warnings" and collapses behind a native `<details>`/`<summary>`**, closed by default -- this section can run long (shared-weakness pairs, ability/item conflicts), so it no longer pushes the rest of the panel down by default.

**The Trick-Room-specific audit is gone, replaced by a general best-matchup analysis.** The old "Anti-Trick-Room Mode" (from `wcAntiTrickRoomAudit`) and the separate "Trick Room Dependency" section are both removed from this screen. In their place, `wcActiveArchetypesForBuiltTeam` (strategy.js) reads every archetype genuinely active on the real, already-built team -- a move-signaled archetype (`WINCON_STRATEGY_MOVES`) is active if any member's actual build knows one of its defining moves, and the two ability-only weathers (Sand Stream/Snow Warning) are active if any member holds that ability -- and `wcBestMatchupAnalysis` pairs each one with a single terse, named best-matchup answer from a new `WINCON_BEST_MATCHUP_COUNTERS` table (Tailwind's real answer is Trick Room, Sun's is Rain Dance, Sand's is Blizzard/Snow, Screens' is Brick Break, and so on for all 17 archetype keys) -- deliberately just a named move/strategy, not a justifying paragraph, matching the reasoning-trim below. A team can genuinely have more than one archetype active at once (the real "Mega Sceptile & Charizard Y Dual-Core" team from Milestone 46's tests turns out to have four: Tailwind, Screens, Wide Guard, and Sun via Mega Charizard Y's Drought) -- all of their counters get listed together: "Best matchup against Tailwind + Screens + Wide Guard + Sun: Trick Room, Brick Break, Single-target attacks, Rain Dance." `wcTrickRoomDependencyWarnings`/`wcAntiTrickRoomAudit` themselves are untouched and still fully tested (they're legitimate, useful checks) -- they're just no longer wired into this particular report.

**The Simulated Win Rate's "How this is simulated" methodology paragraph is removed** from both Builder pages -- the win rate results, scenarios, and re-run button are unaffected; only the explanatory description box is gone.

**Reasoning text is trimmed app-wide, everywhere a pick is justified with a "why" note** -- not just on the Meta Analyst screen. Dream Team's "Why these six" list now shows only each pick's short lead sentence (`wcLeadSentence`, builder.js) instead of the full concatenation of tacked-on meta-usage/live-meta/baseline/synergy sentences that used to follow it. The Recommended/Auto-build/Alternative strategy boxes (`renderStrategyOption`) now show just the archetype name -- the long reasoning paragraph and the "Real tournament synergy" note are both gone from the screen. None of this touches strategy.js's actual return values (`option.note`, the `reasoning` array, etc. are computed exactly as before and still fully exercised by the existing test suite) -- it's a presentation-layer trim, not a change to the underlying analysis.

Updated `tools/test-meta-analyst.mjs` (now 27 checks) for the new report shape: `wcActiveArchetypesForBuiltTeam` and `wcBestMatchupAnalysis` are tested directly (including the real four-archetype Gemini-team case and an ability-only Sand Stream detection), and the report-shape checks confirm `report.bestMatchup`/the new "Best Matchup Against This Strategy" mode are present while the old "Anti-Trick-Room Mode" is gone.

**A bottom-left popup now links the official WinCon subreddit** (`wcMaybeShowRedditPopup`, builder.js), mirroring the existing bottom-right "sign in required" popup (`wcShowAccountPopup`) in look and feel but built as a fully independent component so the two never fight for the same corner or interfere with each other's dismiss state. It uses the canonical `https://www.reddit.com/r/WinCon/` URL rather than the specific post link Phoenix pasted, on the reasoning that "the official WinCon reddit" means the subreddit itself -- a link that stays valid however that one post's life plays out -- rather than one post in it. Unlike the account popup it never auto-dismisses on a timer (there's no urgency to a community link), but it does remember a manual dismissal in `localStorage` (`wc_reddit_popup_dismissed`) so closing it once means it stays gone on that browser for good; it shows again on a fresh browser/profile with nothing stored yet. All 31 test files green.

## The Simulated Win Rate now recognizes a team's real strategy instead of running one generic-AI battle (Milestone 48)

Phoenix pointed out something real about the Simulated Win Rate: it was reporting one blended percentage for a team's "own best bring-4-of-6 lineup" without ever asking how that team actually intends to be played. Her own example team (Staraptor/Primarina/Incineroar/Steelix/Mega Sceptile/Mega Charizard Y) has at least three distinct real game plans -- lead Tailwind (Staraptor) and screens (Primarina) into Mega Sceptile, or into Mega Charizard Y instead, or lean on Incineroar's Taunt and Primarina's screens as a Trick-Room defense -- and the simulator had no way to tell any of those apart from a team with no plan at all.

**`wcBuildGamePlans` (battle-sim-lineup.js) detects every real game plan a built team can run**, reusing the exact same archetype detection already trusted for the Meta Analyst (`wcActiveArchetypesForBuiltTeam`) and the anti-Trick-Room audit (`wcAntiTrickRoomAudit`, Milestone 46) rather than inventing new detection logic. A Tailwind or Trick Room archetype with a real setter gets one plan per real carry candidate on the team (every Mega-eligible member, or every hard hitter -- Atk/SpA >= 100 -- if there's no Mega at all) -- Phoenix's team gets a genuinely separate "Tailwind (carry: Sceptile)" and "Tailwind (carry: Charizard)" plan, not one plan that arbitrarily picks a single carry. A "Trick Room defence" plan appears only when the team has at least two of the four real anti-Trick-Room tools the audit already checks for (Taunt, Fake Out, a real 0-Speed pivot, Safety Goggles) -- one alone is a single move on a single set, not a coherent defensive game plan. A team with no real archetype and no real defensive tooling still gets exactly one plan back ("Standard"), never a fabricated one -- the same honesty convention every archetype feature in this project follows.

**Each plan gets its own lineup search and its own win rate, not a shared blended number.** `wcSimulateTeamWinRate` now runs the existing real-engine successive-halving search (Milestone 35) and Mega-scenario branching separately per plan, filtered to only the candidate lineups that actually contain that plan's required pieces (a real efficiency win too -- with a setter and carry already fixed, a Doubles search is 6 candidate lineups instead of the full 15). The Builder now shows one labeled section per plan whenever a team has more than one real plan, each with its own best lineup and its own win-rate ring; a typical team with no detected identity still renders exactly like before, no meaningless "Standard" label added to the screen.

**Two real, concrete changes make a plan's role actually show up in how a battle is played**, not just in which pieces get chosen. `wcOrderLineupForPlan` reorders the plan's lineup so its setter and screener actually lead (Tailwind/screens have to happen turn 1 to matter), with the carry only entering once a lead has fainted -- the engine's only real switch mechanism today. `wcRoleWeightsFor` attaches a small, hand-picked AI weight override to each role (a setter's own priority on casting its archetype's move goes from the generic default to a real "this is my job" number, a screener's on screens, a carry's on its own setup moves) via a new optional `roleWeights` field threaded through `wcMakeBattler`/`wcChooseAiMove` (battle-sim-engine.js/battle-sim-ai.js) -- undefined and inert for every battler outside this feature (every reference/baseline opponent, every existing Team-vs-Team or self-play-harness battler), so this is a strictly additive change, never a behavior change for anyone not using it.

**Deliberately not built (Phoenix's own scope choice):** the simulator still never switches "on purpose" mid-battle -- no scripted U-turn pivot to bring in a specific teammate, no mid-battle Mega-evolve timing decision. A plan's carry only ever enters through the engine's existing forced-replacement-on-faint mechanic, same as before. Building genuine voluntary mid-battle decisions is a substantially bigger rebuild of the simulator's core turn logic than this milestone -- see the "What's next" note this section adds below.

**Two real engine-correctness fixes turned out to be necessary groundwork, not scope creep.** First: Light Screen, Reflect, and Aurora Veil had no mechanical implementation at all -- move-effects.json already carried real `fieldEffect` metadata for the first two, but the engine's fieldEffect-application switch never read it, and the damage formula had no concept of a screen at all, so casting one used to do literally nothing in a simulated battle. Rewarding an AI for "using screens" on top of that would have taught it to waste a turn for zero effect -- the opposite of honest -- so this milestone adds the real thing: a `field.screens` per-side turn counter (Light Screen halves Special, Reflect halves Physical, Aurora Veil both at once, all real move text respected including "critical hits ignore this effect"), the real 0.5x Singles / 0.66x Doubles multiplier, and a genuine AI scoring rule (`screensUpScore`) in place of screens previously falling through to the same generic score as any uncovered status move. Second: Tailwind's own turn counter was being decremented inside `wcApplyEndOfTurn`, which runs once per *active battler* on a side rather than once per side -- meaning in Doubles (2 active battlers/side) it was silently halved, expiring in ~2 turns instead of its real 4. Fixed by moving that decrement (and the new screens decrement) to run exactly once per side per turn, alongside weather/Trick Room's counters, which were already correct.

New `tools/test-game-plan-simulation.mjs` (13 checks) covers `wcBuildGamePlans`'s detection and role assignment against Phoenix's own real team (confirmed real, learnable moves/items throughout, same discipline as every other fixture in this project), the new `{ format, plans }` shape end to end, the screens damage mechanic (including the crit exemption and the Doubles/Singles multiplier split), and a direct regression check that `wcApplyEndOfTurn` no longer touches `tailwindTurns`. `tools/test-lineup-search.mjs` was updated for the new return shape (its fixture team has no detected archetype, so it now reads through `result.plans[0]` instead of the old flat `result.lineup`/`result.scenarios`) rather than rewritten, since the property it actually tests -- does the real-engine search beat the cheap heuristic -- is unchanged. All 32 test files green.


## Real carry-synergy in the game-plan search, team notes wired in, and the Simulated Win Rate demoted to the least important signal (Milestone 49)

Phoenix caught a real gap in Milestone 48's game-plan search: every plan's two free lineup slots kept converging on the same two hardest hitters (Sceptile, Charizard) regardless of which plan was asking, rather than recruiting a teammate that actually supports that specific carry -- her own real examples were Steelix's Ground/Steel typing genuinely resisting/blocking Mega Charizard Y's real weaknesses (plus Wide Guard against spread Rock Slide), and Incineroar's real Intimidate offsetting Mega Sceptile's genuinely weak physical Defense.

**`wcTypeCoverBonus`/`wcStatCoverBonus` (strategy.js) add a real, computed synergy nudge to the free-slot search** -- never a hardcoded pairing. `wcTypeCoverBonus` is the exact mirror of the shared-weakness audit (Milestone 41) run in reverse: for every real type the carry is genuinely weak to, does the candidate genuinely resist or block that same type? `wcStatCoverBonus` credits Intimidate specifically when the carry's own real base stats are genuinely lopsided toward a weak physical side. `wcCarryPlanBonus` (battle-sim-lineup.js) sums these per candidate against the plan's carry, resolved to its real EFFECTIVE identity (a Mega form's real types/stats, which can differ substantially from its base form -- Mega Sceptile gains a real second Dragon type over base Sceptile's pure Grass, for instance) and threaded into `wcSelectBestLineupBySuccessiveHalving` as a new optional `planBonusFn` parameter, small relative to win rate's own 0..1 scale so it nudges close calls without overriding a lineup that's genuinely much stronger in simulated battle. Verified this actually fixed two of Phoenix's three real examples (Steelix now gets picked for the Trick Room defence plan and the Sceptile-carry plan); the third (Charizard-carry) turns out to be a genuine near-tie in computed terms, since Mega Sceptile's own Grass typing happens to cover a comparable set of Mega Charizard Y's real weaknesses -- a real, honest result of computed (not hand-picked) scoring, not a bug, and it's the same class of gap the next paragraph's change is meant to make less consequential over time.

**Team notes now genuinely influence which real setter candidate gets a plan's role.** `wcBuildGamePlans` was hardcoding empty notes into `wcPreferredSetter` -- a real gap where the existing, trusted notes-override mechanism (already used elsewhere, e.g. Auto-build strategy) had zero effect on the new game-plan simulation specifically. `buildSimulatedWinRatePayload` (builder.js) now sends the team's real notes through to the Worker, and `wcBuildGamePlans` passes them to `wcPreferredSetter` exactly like every other feature that already trusts that mechanism.

**The Simulated Win Rate section moved to the bottom of the analysis stack on both Builder pages, with an explicit "least important signal for now" note.** Phoenix's own reasoning: it's WinCon's own small in-house Monte Carlo simulation against a hand-picked reference field (`data/meta-baseline.json`), not real community-tournament-scale data -- exactly the kind of gap that shows up above (a real defensive tool like Wide Guard blocking Rock Slide only shows up in the simulated win rate if a reference team in that small field actually carries Rock Slide). The Meta Analyst, Threats to this team, and Your Rival are worth weighing more heavily until the live Limitless pipeline (Milestone 34) has logged enough real community battles for this to be genuinely representative at that larger scale.

New checks in `tools/test-game-plan-simulation.mjs` (now 17) cover `wcTypeCoverBonus`/`wcStatCoverBonus` against real, independently-verified type-chart/base-stat values, `wcCarryPlanBonus`'s Mega-identity resolution, and the notes-override fix end to end. All 32 test files green.


## Fixing a real double-Mega bug in the game-plan search (Milestone 50)

Phoenix caught a genuine, pre-existing bug in Milestone 49's report-back: "using sceptile and charizard in a team would mean only one is a mega, this means you should take into account sceptiles base stats not its mega evolved and vice versa." She was right, and it traced back further than Milestone 49 -- it was present since Milestone 35, when the lineup search itself was first written.

**The bug:** `wcBuildMegaScenarios` (used for the final reported result) has always correctly tried exactly one Mega candidate per scenario -- real Doubles rules only allow one Mega per battle, and that function respects that. But the lineup *search* phase that runs before it (`wcSelectBestLineupBySuccessiveHalving`, via `wcSimulatePlan`'s `specsByName` construction) built every member's battle spec with no Mega/base override at all. Since `wcBattlerSpecForSlot` resolves a Pokemon's Mega form automatically whenever its build holds a matching Mega Stone, any candidate lineup carrying two real Mega Stone holders at once -- Sceptile (Sceptilite) and Charizard (Charizardite Y) in Phoenix's own team -- got simulated during search as though *both* were simultaneously Mega-evolved. That's an impossible real-game state, and it meant the search was scoring exactly the "bring your two biggest hitters together" lineups Milestone 49's whole carry-synergy change was built to stop rewarding by default, using inflated double-Mega stats and the wrong (Mega, not base) typing for whichever member wasn't actually meant to Mega Evolve in that plan.

**The fix:** a new `wcMegaOverridesForSearch` (battle-sim-lineup.js) decides, once per plan, which single Mega-eligible member gets to resolve as its real Mega form for the whole search -- the plan's own designated carry when one exists (a plan already specifies who's meant to Mega Evolve; simulating anyone else during *that* plan's search would just be simulating a different plan), or the first Mega-eligible member in roster order for the carry-less "Standard" fallback plan. Every other Mega-eligible member is forced to its real base form. `wcSimulatePlan` now threads this into `wcBattlerSpecForSlot`'s existing `forcedMegaView` parameter (the same mechanism `wcBuildMegaScenarios` already used) instead of leaving it unset. This doesn't touch the final reported numbers at all -- `wcBuildMegaScenarios` was already correct -- it only fixes which lineup the search picks as "best," and by extension the type/stat-cover synergy scoring (`wcCarryPlanBonus`) that reads from the same specs.

Re-verified against a live (non-stubbed) run of Phoenix's own team afterward: the Charizard-carry plan still picks Sceptile for its free slot even with this fixed, so Milestone 49's "genuine near-tie" conclusion holds -- it wasn't an artifact of the double-Mega bug, just a real close call in computed type-coverage terms that happens to survive fixing Sceptile's stats back down to its real base form.

Six new checks added to `tools/test-game-plan-simulation.mjs` (now 22): `wcMegaOverridesForSearch`'s carry-preferring and roster-order-fallback behavior, its `{}` result for a team with no real Mega-eligible member, `wcBattlerSpecForSlot`'s forced base vs. mega typing resolution for Sceptile specifically (confirming forcing "base" doesn't leak Mega Sceptile's real second Dragon type), and an end-to-end spy check confirming `wcSimulatePlan` never resolves two Mega-eligible members as Mega simultaneously in its search-phase spec build, across every one of Phoenix's three real detected plans. All 32 test files green.


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
   (`0001_init.sql` through `0007_live_limitless_meta.sql`) — each one only
   adds to what the last one created, so running them out of order or
   skipping one will fail partway through with a clear "relation/column
   does not exist" error telling you which one you missed. Then copy that
   project's URL and anon (public) key from Project Settings → API into
   `supabase-config.js` — see that file's own header comment for why the
   anon key is safe to commit and what must never go anywhere near it.
5. Set up the Limitless pipeline's two Vercel environment variables and
   confirm its scheduled job — see the "Setting it up" steps under
   Milestone 34 above for the exact walkthrough. The site works fully
   without this step too (the live tier is an enhancement, same as
   everything above it in that layered fallback), it just won't have any
   real Limitless tournament data until it's done.

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
