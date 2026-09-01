# WinCon

A team-building assistant for Pokémon Champions. Three pages — no
backend, no login, no build step, just open the HTML files.

## What's in here

- `index.html` / `app.js` — the **Pokédex tracker**: check off every
  Pokémon you've obtained
- `singles-builder.html` / `doubles-builder.html` / `builder.js` — the
  **Singles Builder** and **Doubles Builder** (Milestone 14, replacing the
  old separate Team Builder and Matchup Score pages): one page per
  competitive format, each doing all of the following for whichever of
  your (shared, up to 5) teams is tagged for that format —
  - pick 6 obtained Pokémon and set each one's Nature, item, up to 4
    moves, and Stat Point spread, by hand, with **Auto-build team** and
    **Auto-build strategy** (two separate steps that fill in all 6 and
    then propose a shared team strategy), or with **Generate Dream
    Team**, which picks the 6 for you too and runs the whole flow in one
    click
  - a live **Matchup Score** against a reference list of strong Pokémon,
    your toughest matchups, a full matchup matrix, and a **team type
    coverage** breakdown against all 18 attacking types — all re-scored
    as you edit the team above, not a separately-selected saved team on
    another page
  - **Your Rival** — a hypothetical 6-Pokémon team synthesized from the
    *entire* Champions roster (not just what you've obtained), picked
    specifically to give your current team its hardest possible matchup,
    plus an estimated success rate
  - an **Open/Closed Team Sheet** toggle modeling the real difference
    between the online ladder (nobody's seen your set) and tournament
    play (your opponent has your full sheet ahead of time) — see the
    Milestone 14 section below
- `stats.js` / `type-utils.js` — small shared modules (stat-calculation
  math, type-effectiveness lookups) used by more than one page, so the
  formulas can't quietly drift apart between them
- `teams.js` — shared multi-team storage: up to 5 named teams (each with
  its own format tag, sheet-mode tag, free-text notes, and logged
  win/loss record) in one `localStorage` key, with automatic migration
  from the old single-draft format if you had one saved before this update
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
  both builder pages share
- `styles.css` — shared visual styling (colors are defined once, at the
  top, as variables — that's what makes light/dark mode work)
- `data/` — roster, moves, items, Natures, learnsets, base stats, and the
  type chart, trimmed from the open
  [Pokémon Champions Data](https://github.com/otterlyclueless/pokemon-champions-data)
  project (CC BY 4.0), plus `AUDIT.md` (36 entries added after an audit
  against Serebii/Bulbapedia), `starter-threats.json` (see below), and
  `sprites.json` + `sprites/` (296 sprite PNGs from PokeAPI, see Milestone
  4 below for the sourcing/cross-check methodology)

All three pages read and write the same `localStorage`, so checking off a
Pokémon on the tracker makes it available on both builder pages, and each
builder page's live sections all read the team you're actively editing on
it. Everything's saved to this browser only for now — it won't follow you
to another device yet. That's a later upgrade, once there's an account
system to sync to.

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

**The stat math is an approximation.** Champions replaced EVs with a
0–66 Stat Point pool, but the community dataset's own mechanics notes say
the exact SP-to-stat mapping is still community-unverified. This uses the
standard Pokémon stat formula with 1 SP ≈ 8 EVs (so 32 SP ≈ 252 EVs) — a
reasonable placeholder, not a confirmed-accurate one.

Neither of these makes the score useless — it still catches real type
weaknesses and rewards actually filling in a team's moves and Nature —
but both are worth fixing before leaning on the number too heavily.

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
   `data/` folder structure — GitHub's uploader can be finicky about this
   if you drag loose files instead of the folder itself. If a file lands
   at the repo root instead of inside `data/`, open it on GitHub, click
   the pencil (edit) icon, and change its filename at the top to include
   the `data/` prefix — that moves it without needing to re-upload.
3. Create a free account at [vercel.com](https://vercel.com) and connect
   it to that GitHub repository. Vercel will detect it's a static site and
   give you a live URL — and redeploy automatically every time you update
   the repository.

## What's next (see the WinCon Blueprint for the full roadmap)

- Swap `starter-threats.json` for real usage data from
  championsbattledata.com — the highest-value fix, see the honesty note above
- ~~An account (Supabase) so progress and saved teams sync across
  devices~~ — done as of Milestone 22: sign in on any device and your
  saved teams (including their logged win/loss record) show up there too.
  See teams.js's "Cloud sync" section and
  `supabase/migrations/0004_team_match_log.sql`.
