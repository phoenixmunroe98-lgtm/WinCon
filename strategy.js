// WinCon — Auto-generate (Milestone 3b, format-aware since Milestone 4)
//
// Turns a bare Pokémon into a full build (Nature, item, up to 4 moves,
// Stat Points), then looks across the whole team for a handful of
// well-known archetypes (Trick Room, Tailwind, weather, redirection or
// hazards) and swaps in the move/role a team member needs to actually run
// that strategy. This is a set of explainable heuristics, not a search over
// every possible build — see data/AUDIT.md-style honesty: it's meant to be
// a strong starting point you can hand-tune, not a claimed-optimal answer.
//
// Every function here is pure (no DOM, no fetch) so it can be tested with
// plain Node against the real data files before any UI touches it.
//
// Format-awareness: a team is tagged Doubles or Singles (teams.js). Moves
// and items are scored/picked with a bonus toward whichever format is
// tagged — never an outright ban except where the game itself bans it
// (redirection and other ally-targeting moves literally do nothing in
// singles; that's detected straight from each move's own description
// text, not a hand-typed list, so it stays correct if the move pool
// changes). Everything else stays available in both formats, just weighted.

const WINCON_STAT_KEYS = ["hp", "attack", "defense", "sp_attack", "sp_defense", "speed"];
const WINCON_BASE_TO_SP_KEY = { hp: "hp", atk: "attack", def: "defense", spa: "sp_attack", spd: "sp_defense", spe: "speed" };

const WINCON_STRATEGY_MOVES = {
  trickroom: ["Trick Room"],
  tailwind: ["Tailwind"],
  sun: ["Sunny Day"],
  rain: ["Rain Dance"],
  redirect: ["Follow Me", "Rage Powder"],
  hazards: ["Stealth Rock", "Spikes", "Toxic Spikes", "Sticky Web"],
  // Screens (Milestone: Phoenix's Tailwind/Staraptor/screens request) --
  // Light Screen and Reflect protect the whole side, not just one
  // Pokemon, so they get the same first-class archetype treatment
  // Trick Room/Tailwind already have rather than only ever showing up
  // because a specific curated Pokemon (Grimmsnarl) happens to run them.
  screens: ["Light Screen", "Reflect"],
};

// A move whose own description says it fails outside a Double Battle, or
// fails with no ally on the field, is genuinely dead weight in singles —
// not just "less optimal." Detected from the text itself (data/moves.json)
// rather than a hand-typed list, so a move pool update can't silently make
// this list stale.
function wcIsAllyDependentMove(move) {
  return /fails if it is not a double battle|no ally adjacent|only pokemon on its side/i.test(move.description || "");
}

// Hits every adjacent Pokémon at once — genuinely more valuable in Doubles
// (2-for-1) than Singles (where it just behaves like an ordinary
// single-target hit, no bonus and no penalty). Hand-picked and not
// exhaustive — same honesty note as starter-threats.json.
const WINCON_SPREAD_MOVES = new Set([
  "Rock Slide", "Earthquake", "Surf", "Muddy Water", "Heat Wave", "Icy Wind",
  "Discharge", "Blizzard", "Hyper Voice", "Dazzling Gleam", "Eruption",
  "Water Spout", "Lava Plume", "Sludge Wave", "Parabolic Charge",
  "Struggle Bug", "Snarl", "Bulldoze", "Electroweb", "Brutal Swing",
  "Boomburst", "Petal Blizzard", "Breaking Swipe",
]);

// Still fully functional solo, but built around having a teammate to
// protect/speed up — a mild Doubles-side bonus, no Singles penalty.
const WINCON_DOUBLES_FAVORED_MOVES = new Set(["Wide Guard", "Quick Guard", "Tailwind", "Trick Room", "Light Screen", "Reflect"]);

// Hazards / status / recovery / pivoting — the long-game tools that matter
// more in a 1-on-1 war of attrition than in Doubles' shorter, faster games.
const WINCON_SINGLES_UTILITY_MOVES = new Set([
  "Stealth Rock", "Spikes", "Toxic Spikes", "Sticky Web", "Toxic", "Will-O-Wisp",
  "Thunder Wave", "Recover", "Roost", "Slack Off", "Synthesis", "Moonlight",
  "Soft-Boiled", "Milk Drink", "Rest", "U-turn", "Volt Switch", "Flip Turn",
  "Rapid Spin", "Defog", "Knock Off", "Leech Seed",
]);

// Milestone 13: every roster entry (base and Mega) now has a real, sourced
// ability in data/abilities.json (see data/AUDIT.md for how it was
// gathered) — so which ABILITY sets a weather condition automatically the
// instant its Pokémon is on the field, no move slot spent unlike Sunny
// Day/Rain Dance, is a lookup BY ABILITY NAME rather than the old
// Milestone 12 hand-typed-per-Pokémon list (which only covered Mega
// Charizard Y because nothing else had been sourced yet). Any current or
// future roster entry whose sourced ability is one of these four
// automatically qualifies — no per-Pokémon hand-editing needed.
const WINCON_WEATHER_SETTING_ABILITIES = {
  Drought: "sun",
  Drizzle: "rain",
  "Sand Stream": "sand",
  "Snow Warning": "snow",
};

// Abilities that make their own Pokémon meaningfully better while a given
// weather is already up — almost always a Speed-doubling ability, which
// is a clean, mechanically real "this ability matters here" case, same
// sourcing bar as the rest of this file. Not every weather-synergy
// ability that exists is listed — same "small, high-confidence, not
// exhaustive" rule as WINCON_META_KNOWN_SETS.
const WINCON_WEATHER_BENEFIT_ABILITIES = {
  sun: ["Chlorophyll", "Solar Power", "Leaf Guard", "Flower Gift"],
  rain: ["Swift Swim", "Rain Dish", "Dry Skin", "Hydration"],
  sand: ["Sand Rush", "Sand Force", "Sand Veil"],
  snow: ["Slush Rush", "Snow Cloak", "Ice Body"],
};

// Sun/rain boost a matching move's raw power (handled below via
// benefitType), but sand/snow instead passively toughen up a whole TYPE's
// defensive stat on the field (Rock's Sp. Def in sand, Ice's Defense in
// snow) — a real teammate on that type is its own, separate reason sand
// or snow is worth having up, so it gets counted as a beneficiary too.
const WINCON_WEATHER_PASSIVE_BULK_TYPE = { sand: "Rock", snow: "Ice" };

// Abilities that turn a Normal-type move into a different type (and boost
// it) — the move's TRUE type for both STAB and threat-effectiveness
// scoring is the converted type, not Normal, so wcScoreMove needs to
// know this to score it correctly rather than as a neutral Normal move.
const WINCON_ABILITY_TYPE_CONVERSION = {
  Pixilate: "Fairy",
  Aerilate: "Flying",
  Refrigerate: "Ice",
};

// Guarantees same-type-attack-bonus on every move it uses, since its own
// type changes to match whatever move it's about to use — scoring should
// treat every move as STAB for these two, not just ones that happen to
// match its (irrelevant, for this purpose) starting typing.
const WINCON_ALWAYS_STAB_ABILITIES = new Set(["Protean", "Libero"]);

/**
 * True when this move's own description says it lowers/harshly lowers/
 * sharply lowers the USER's own stat(s) as a side effect (Close Combat,
 * Superpower, Leaf Storm, Overheat, and the like) — exactly the case
 * Contrary flips from a drawback into a real stat-boosting upside.
 * Detected from the text itself, same "don't hand-type a list that can
 * go stale" rule as wcIsAllyDependentMove above.
 */
function wcMoveHasOwnStatDrop(move) {
  return /(lowers|harshly lowers|sharply lowers) the user'?s (own )?(defense|special defense|attack|special attack|speed)/i.test(
    move.description || ""
  );
}

/**
 * This Pokémon's own real ability, looked up by its EFFECTIVE (Mega-aware)
 * name in data/abilities.json — null if `abilitiesData` wasn't supplied
 * (every call site that cares passes it; older/simpler callers, and every
 * existing test that predates Milestone 13, simply get no ability-aware
 * behavior rather than an error) or the name genuinely isn't in it.
 */
function wcAbilityOf(abilitiesData, name) {
  return (abilitiesData && abilitiesData[name] && abilitiesData[name].ability) || null;
}

// A setter that already knows one of these can immediately pivot out
// once its status move (Tailwind, hazards, etc.) is up, bringing in a
// teammate safely while the effect is still active — "Tailwind into a
// switch" is a real, well-known sequencing tactic, not just "have
// Tailwind." Baton Pass also passes along any of the setter's own stat
// boosts, not just the turn.
const WINCON_PIVOT_MOVES = new Set(["U-turn", "Volt Switch", "Flip Turn", "Baton Pass"]);

function wcNormalizeFormat(format) {
  return format === "singles" ? "singles" : "doubles";
}

/** How much a format lean should nudge this move's score, in either direction. */
function wcFormatBiasForMove(move, format) {
  const fmt = wcNormalizeFormat(format);
  if (wcIsAllyDependentMove(move)) return fmt === "singles" ? -6 : 1.5;
  if (WINCON_SPREAD_MOVES.has(move.name)) return fmt === "doubles" ? 1.5 : 0;
  if (WINCON_DOUBLES_FAVORED_MOVES.has(move.name)) return fmt === "doubles" ? 1 : 0;
  if (WINCON_SINGLES_UTILITY_MOVES.has(move.name)) return fmt === "singles" ? 1.5 : -0.3;
  return 0;
}

function wcPickPrimaryOffense(baseStats) {
  return baseStats.spa > baseStats.atk ? "sp_attack" : "attack";
}

function wcPickRole(baseStats) {
  return baseStats.spe >= 90 ? "fast" : "bulky";
}

/**
 * Beta-tester fix ("recommend Incineroar adamant full 32HP and 32 ATK...
 * when they are not good sets"): a "bulky" role used to ALWAYS get an
 * offense-boosting Nature (Adamant/Modest), even for a Pokemon whose real
 * strength is its bulk, not its offense -- exactly backwards for a
 * support/wall-style Pokemon like Incineroar. Now it's conditional: only
 * go offensive when the primary offense stat actually outclasses this
 * Pokemon's own bulk (the higher of its two defenses); otherwise go
 * defensive, boosting whichever defense is naturally stronger while only
 * ever lowering the SECONDARY offense stat (never the primary one this
 * Pokemon is actually built around). wcPickSP (below) makes the exact
 * same offense-vs-bulk comparison so Nature and Stat Points never end up
 * contradicting each other the way they used to (an offensive Nature
 * paired with defensively-split Stat Points, or vice versa -- the
 * tester's other example, Gholdengo "32 spa 32 SpD modest").
 */
function wcPickNature(primaryOffenseKey, role, baseStats) {
  if (role === "fast") {
    return primaryOffenseKey === "attack" ? "Jolly" : "Timid";
  }
  const offenseStat = primaryOffenseKey === "attack" ? baseStats.atk : baseStats.spa;
  const bulkierDefense = baseStats.def >= baseStats.spd ? "defense" : "sp_defense";
  if (offenseStat >= Math.max(baseStats.def, baseStats.spd)) {
    return primaryOffenseKey === "attack" ? "Adamant" : "Modest";
  }
  // Defensive branch: lower the SECONDARY offense stat (the one this
  // Pokemon isn't actually built around), not the primary one.
  if (bulkierDefense === "defense") {
    return primaryOffenseKey === "attack" ? "Impish" : "Bold";
  }
  return primaryOffenseKey === "attack" ? "Careful" : "Calm";
}

function wcPickSP(primaryOffenseKey, role, baseStats) {
  const sp = { hp: 2, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 };
  if (role === "fast") {
    sp[primaryOffenseKey] = 32;
    sp.speed = 32;
    return sp;
  }
  // Bulky role: max HP first -- real spreads nearly always do, since HP
  // is the most universally efficient bulk investment (it helps both
  // defenses at once) -- rather than the old "bare defensive stat"
  // choice. The second 32 follows the SAME offense-vs-bulk comparison
  // wcPickNature makes above, so the two never disagree; 2 leftover SP
  // (66 total cap) top up the other side a touch.
  sp.hp = 32;
  const offenseStat = primaryOffenseKey === "attack" ? baseStats.atk : baseStats.spa;
  const bulkierDefense = baseStats.def >= baseStats.spd ? "defense" : "sp_defense";
  const weakerDefense = bulkierDefense === "defense" ? "sp_defense" : "defense";
  if (offenseStat >= Math.max(baseStats.def, baseStats.spd)) {
    sp[primaryOffenseKey] = 32;
    sp[weakerDefense] = 2;
  } else {
    sp[bulkierDefense] = 32;
    sp.speed = 2;
  }
  return sp;
}

// Ordered candidate pools per role/format/offensive-category — best fit
// first. Pokémon Champions enforces the same Item Clause real VGC/Singles
// do: no two Pokémon on one team can hold the same item. Auto-generate
// walks the team in order and, for each member, hands out the first pool
// entry nobody earlier in the team already has (see wcPickItem) — so a
// full 6-member team never comes out of auto-generate with a clash.
const WINCON_ITEM_POOLS = {
  doubles: {
    fast: {
      // Choice Scarf's speed control is a long-running staple — safe even
      // when a teammate needs you unlocked less often than in a 1-on-1
      // game. Choice Band/Specs are the harder-hitting locked fallback.
      Physical: ["Choice Scarf", "Choice Band", "Life Orb", "Focus Sash", "Expert Belt", "Wide Lens"],
      Special: ["Choice Scarf", "Choice Specs", "Life Orb", "Focus Sash", "Expert Belt", "Wide Lens"],
    },
    // Sitrus Berry's one-time heal is cheap insurance for a short game;
    // Assault Vest/Rocky Helmet cover the next two most common bulky
    // Doubles roles (special sponge, physical punish-switch-ins).
    bulky: ["Sitrus Berry", "Assault Vest", "Rocky Helmet", "Leftovers", "Safety Goggles", "Weakness Policy"],
  },
  singles: {
    fast: {
      // Life Orb keeps you unlocked, useful over a longer match where you
      // may need to switch move choice turn to turn; Choice Band/Specs
      // trade that flexibility for more raw power once Life Orb is taken.
      Physical: ["Life Orb", "Choice Band", "Choice Scarf", "Expert Belt", "Focus Sash", "Muscle Band"],
      Special: ["Life Orb", "Choice Specs", "Choice Scarf", "Expert Belt", "Focus Sash", "Wise Glasses"],
    },
    // Leftovers' steady per-turn recovery pays off over a longer war of
    // attrition than Doubles usually allows for.
    bulky: ["Leftovers", "Assault Vest", "Rocky Helmet", "Sitrus Berry", "Safety Goggles", "Weakness Policy"],
  },
};

// Catch-all if a role/category pool ever runs dry before the team does —
// can't actually happen at the real 6-Pokémon team cap given the pools
// above, but keeps wcPickItem always returning something sane instead of
// undefined if this ever gets called with a larger roster.
const WINCON_ITEM_FALLBACK_POOL = [
  "Choice Scarf", "Choice Band", "Choice Specs", "Life Orb", "Leftovers", "Sitrus Berry",
  "Assault Vest", "Rocky Helmet", "Focus Sash", "Expert Belt", "Wide Lens", "Safety Goggles",
  "Weakness Policy", "Muscle Band", "Wise Glasses", "Metronome", "Shell Bell", "Air Balloon",
  "Heavy-Duty Boots", "Cell Battery", "Absorb Bulb", "Big Root",
];

/**
 * Picks an item for one Pokémon, skipping anything already claimed by an
 * earlier teammate this generation run. `usedItems` is a Set shared across
 * the whole team (see wcGenerateTeamBuilds) — every pick is added to it
 * before returning, so the Item Clause holds for the full 6 by construction
 * rather than needing a separate cleanup pass afterward.
 */
function wcPickItem(role, format, primaryCategory, usedItems) {
  const fmt = wcNormalizeFormat(format);
  const used = usedItems instanceof Set ? usedItems : new Set();
  const pool =
    role === "fast"
      ? WINCON_ITEM_POOLS[fmt].fast[primaryCategory] || WINCON_ITEM_POOLS[fmt].fast.Physical
      : WINCON_ITEM_POOLS[fmt].bulky;
  const pick = pool.find((item) => !used.has(item)) || WINCON_ITEM_FALLBACK_POOL.find((item) => !used.has(item)) || pool[0];
  used.add(pick);
  return pick;
}

// ---------------------------------------------------------------------------
// Milestone 10: real tournament data feeding auto-build/auto-strategy
// ---------------------------------------------------------------------------
//
// WINCON_MEGA_STONES (species -> its real Mega Stone) used to live here;
// as of Milestone 11 it lives in megas.js instead, since the Pokédex
// tracker and Team Builder's picker/slot rendering need it too, not just
// this file — see megas.js for the map itself and the base<->Mega
// derivation it's paired with. strategy.js still loads after megas.js
// (see every page's <script> order) and uses the same global.

/**
 * Known-good competitive sets for a handful of standout Pokémon, drawn from
 * real Regulation M-B tournament results and aggregate usage stats (see the
 * "Meta-informed auto-build" section of README.md for the full sourcing —
 * Pikalytics and Pokémon Zone tournament/usage pages, cross-checked against
 * each other). This is a deliberately short, high-confidence list, not an
 * attempt to hand-author a "real" set for all 296 Pokémon — everything not
 * listed here still goes through the general-purpose heuristic above.
 * `moves` are used as forced picks (same mechanism wcProposeSetterAmendment
 * already uses for strategy moves) and `item`, if present, is preferred
 * over the generic role/format pools as long as no earlier teammate already
 * holds it (Item Clause still applies). A Mega Pokémon's own stone (see
 * WINCON_MEGA_STONES) always wins over any `item` here, since it isn't
 * optional for them the way a regular item choice is.
 *
 * Last refreshed 2 Sep 2026 (the first run of the weekly meta-refresh
 * process set up after Milestone 28 -- see README.md): re-checked every
 * entry below against fresh post-Worlds-2026 usage data (Pikalytics'
 * Regulation M-B pages, cross-checked against Pokémon Zone and Limitless
 * VGC's own Worlds 2026 statistics) and confirmed all nine pre-existing
 * entries are still current and correctly built. Added Incineroar and
 * Sneasler, both newly confirmed top-tier by usage across all three
 * sources this pass — everything else on the roster is unchanged.
 *
 * Beta-tester fix: every entry below now also carries a real `nature` and
 * `sp` (Stat Points -- this app's own EV/8 abstraction, see stats.js's
 * wcSpToEv/wcEvToSp; a real "252 HP / 252 SpD Careful" spread is
 * `{hp:32, sp_defense:32, ...}` with 2 leftover SP going to the total-66
 * cap) matching each Pokémon's real competitive role -- a beta tester
 * flagged that even these curated, real-set Pokémon (Incineroar's own
 * example) were still getting the generic Adamant/Modest heuristic below,
 * since only moves/item were ever curated before. A support/wall-style
 * Pokémon (Incineroar, Whimsicott, Grimmsnarl) gets a bulk-boosting
 * Nature and HP + its stronger defense; a genuine sweeper/attacker
 * (Kingambit, Garchomp, Sneasler) keeps an offense-boosting Nature with
 * HP + its offense stat, matching how wcPickSP's own fixed fallback (see
 * the note above it) now reasons about every OTHER Pokémon too.
 */
const WINCON_META_KNOWN_SETS = {
  Kingambit: {
    moves: ["Sucker Punch", "Kowtow Cleave", "Iron Head", "Swords Dance"],
    // Sources split roughly evenly between this Life-Orb-ish Swords Dance
    // sweeper set and a bulkier Chople Berry / 3-attacks set that skips
    // Swords Dance for more immediate bulk — went with the more clearly
    // explainable, higher-usage-in-one-source pick; the Chople Berry
    // variant is a reasonable hand-edit if this one doesn't fit your team.
    item: "Black Glasses",
    // Atk 135 is clearly its best stat by a wide margin -- a real
    // offensive Adamant spread, just with HP (not Def) as the second
    // investment for maximum survivability going into a sweep.
    nature: "Adamant",
    sp: { hp: 32, attack: 32, defense: 0, sp_attack: 0, sp_defense: 2, speed: 0 },
    note: "the standout of the current Reg M-B meta — appears on nearly every top tournament team as a Dark-type cleanup sweeper",
  },
  Whimsicott: {
    moves: ["Tailwind", "Moonblast", "Encore", "Protect"],
    item: "Focus Sash",
    // Prankster already guarantees Tailwind/Encore go off first regardless
    // of raw Speed, so real sets lean into surviving to actually use them
    // instead -- Bold, HP/Def, with the last 2 SP as a small Speed buffer
    // for Moonblast's real damage.
    nature: "Bold",
    sp: { hp: 32, attack: 0, defense: 32, sp_attack: 0, sp_defense: 0, speed: 2 },
    note: "the meta's most common Tailwind setter — Prankster guarantees the priority even against faster threats",
  },
  Farigiraf: {
    // One source's 3rd move was Thunderbolt instead of Helping Hand — both
    // are real, commonly-seen options behind Trick Room/Protect; Helping
    // Hand was picked as the more team-oriented (and higher-usage) pick.
    moves: ["Trick Room", "Psyshock", "Helping Hand", "Protect"],
    item: "Sitrus Berry",
    // SpA 110 comfortably outclasses its bulk, so it stays offensive for
    // Psyshock's real damage -- Trick Room setters don't need Speed
    // investment either way, since Trick Room itself reverses turn order.
    nature: "Modest",
    sp: { hp: 32, attack: 0, defense: 0, sp_attack: 32, sp_defense: 2, speed: 0 },
    note: "a common Trick Room setter that also blocks priority moves and boosts a teammate's hit with Helping Hand",
  },
  Garchomp: {
    moves: ["Dragon Claw", "Earthquake", "Rock Slide", "Protect"],
    item: "Life Orb",
    // The meta's standard fast dual-STAB attacker spread -- max Atk/Spe.
    nature: "Jolly",
    sp: { hp: 2, attack: 32, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 },
    note: "one of the meta's most-used Pokémon, usually as a fast dual-STAB physical attacker",
  },
  Basculegion: {
    moves: ["Last Respects", "Aqua Jet", "Wave Crash", "Protect"],
    item: "Choice Scarf",
    // Base Speed (78) isn't naturally high enough to earn the generic
    // fallback's "fast" role, but a Choice Scarf revenge-killer wants
    // exactly the fast-role treatment regardless -- max Atk/Spe, Adamant
    // for the extra power since post-Scarf Speed already clears most of
    // the field.
    nature: "Adamant",
    sp: { hp: 2, attack: 32, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 },
    note: "a fast Adaptability attacker whose Last Respects snowballs as teammates faint",
  },
  Sylveon: {
    moves: ["Hyper Voice", "Quick Attack", "Protect", "Hyper Beam"],
    item: "Fairy Feather",
    // No Calm Mind on this set (Hyper Beam is a direct finisher instead),
    // so it needs real SpA now rather than a slow setup game -- Modest,
    // HP for bulk to actually get a hit in, 2 SP shoring up its weaker
    // physical Defense.
    nature: "Modest",
    sp: { hp: 32, attack: 0, defense: 2, sp_attack: 32, sp_defense: 0, speed: 0 },
    note: "Pixilate turns its Normal-type moves into boosted Fairy-type damage, including priority Quick Attack",
  },
  Grimmsnarl: {
    moves: ["Light Screen", "Reflect", "Parting Shot", "Spirit Break"],
    item: "Light Clay",
    // Only one attacking move on this set (Spirit Break) and it's meant
    // to survive to keep resetting screens, not to sweep -- Careful (its
    // SpA is unused either way), HP/SpD, with a couple SP left toward
    // Attack so Spirit Break still has some teeth.
    nature: "Careful",
    sp: { hp: 32, attack: 2, defense: 0, sp_attack: 0, sp_defense: 32, speed: 0 },
    note: "the meta's main screens setter — Prankster guarantees Light Screen/Reflect go up before the opponent can punish it",
  },
  Incineroar: {
    // Added in the 2 Sep 2026 weekly meta refresh: #7 in the Reg M-B
    // metagame per Pikalytics, 48.2% win rate, with Fake Out/Parting
    // Shot/Flare Blitz/Throat Chop and Intimidate + Sitrus Berry all
    // agreeing across Pikalytics and Pokémon Zone independently.
    moves: ["Fake Out", "Parting Shot", "Flare Blitz", "Throat Chop"],
    item: "Sitrus Berry",
    // The exact set a beta tester flagged as broken ("Incineroar adamant
    // full 32HP and 32 ATK... not a good set") -- Incineroar is support
    // (Fake Out/Parting Shot/Intimidate), not a sweeper, so real sets
    // favor surviving to keep pivoting over raw power. Careful, HP/SpD,
    // 2 SP into Def to round out both sides of its bulk.
    nature: "Careful",
    sp: { hp: 32, attack: 0, defense: 2, sp_attack: 0, sp_defense: 32, speed: 0 },
    note: "the meta's most reliable Intimidate support — Fake Out flinches while Parting Shot forces a switch with an Attack drop already in effect, buying its team a turn twice over before it starts chipping damage with Flare Blitz",
  },
  Sneasler: {
    // Added in the 2 Sep 2026 weekly meta refresh: Unburden (87-89%
    // usage) + White Herb (70-71%) is the dominant build across every
    // source checked, not a close split like Kingambit's two viable sets
    // above — White Herb cancels Close Combat's own stat drop and, once
    // consumed, immediately doubles Sneasler's Speed via Unburden.
    moves: ["Close Combat", "Fake Out", "Dire Claw", "Protect"],
    item: "White Herb",
    // Adamant over the generic fallback's Jolly -- once Unburden triggers,
    // its Speed already clears virtually every real threat even from a
    // neutral-natured base, so real sets take the extra power instead.
    nature: "Adamant",
    sp: { hp: 2, attack: 32, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 },
    note: "White Herb shrugs off Close Combat's own Defense/Sp. Def drop, and Unburden doubles its Speed the instant that berry is used up — one of the meta's fastest attackers once it's triggered",
  },
  "Mega Charizard Y": {
    moves: ["Heat Wave", "Solar Beam", "Protect", "Weather Ball"],
    // Max SpA/Spe -- a straightforward fast special attacker once
    // Mega-Evolved, its own Drought sun boosting Heat Wave/Weather Ball
    // further still.
    nature: "Timid",
    sp: { hp: 2, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 32 },
    note: "Drought triggers sun the instant it Mega Evolves, boosting its own Fire/Grass coverage all by itself",
  },
  "Mega Floette": {
    moves: ["Dazzling Gleam", "Moonblast", "Calm Mind", "Protect"],
    // A genuine Calm Mind sweeper (Def 87/SpD 148 already tanky enough to
    // set up safely) rather than a raw Speed race -- Modest, HP/SpA, 2 SP
    // toward its already-strong SpD for extra setup safety.
    nature: "Modest",
    sp: { hp: 32, attack: 0, defense: 0, sp_attack: 32, sp_defense: 2, speed: 0 },
    note: "Fairy Aura boosts every Fairy-type move on the field (not just its own), and it can set up Calm Mind for a late-game sweep",
  },
  "Mega Staraptor": {
    // Milestone 13 correction: Mega Staraptor's real ability is Contrary,
    // not Intimidate (see data/abilities.json, sourced from Serebii) —
    // that's a genuinely good pairing with Close Combat specifically,
    // since Contrary flips Close Combat's own Defense/Sp. Def drop into a
    // boost instead, so repeated Close Combats make it bulkier turn over
    // turn rather than more fragile (see wcScoreMove's Contrary bonus,
    // which now favors exactly this kind of move for it automatically).
    moves: ["Close Combat", "Protect", "Brave Bird", "Roost"],
    // Jolly to guarantee it lands the first hit safely -- Contrary's own
    // bulk-up payoff only starts AFTER it attacks, so outspeeding matters
    // more than the extra power Adamant would give.
    nature: "Jolly",
    sp: { hp: 2, attack: 32, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 },
    note: "Contrary turns Close Combat's own Defense/Sp. Def drop into a boost instead, so it gets bulkier the more it attacks, backed up by Brave Bird for coverage and Roost to stay healthy",
  },
  "Mega Sceptile": {
    // Added for Phoenix's Tailwind/Staraptor/screens request -- wanted
    // as an alternative Mega alongside Mega Charizard Y, compared
    // matchup-by-matchup rather than picking one outright (see
    // wcMegaMatchupAdvice). Lightning Rod redirects Electric moves aimed
    // at the whole side onto Sceptile and turns them into a free SpA
    // boost instead of damage -- real defensive utility a pure attacker
    // wouldn't otherwise have.
    moves: ["Dragon Pulse", "Giga Drain", "Focus Blast", "Protect"],
    // Giga Drain over the harder-hitting Leaf Storm: no self-inflicted
    // SpA drop to manage turn to turn, and the recovery lets it stay in
    // and keep threatening rather than nuke once and fold.
    nature: "Timid",
    sp: { hp: 2, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 32 },
    note: "SpA 145 and Speed 145 are both far and away its best stats once Mega Evolved, and Lightning Rod gives it a genuine defensive angle most pure special attackers don't get",
  },
};

/**
 * Real tournament cores (2+ Pokémon that repeatedly show up together on
 * winning teams) — used to add a "matches a real synergy" note to the
 * strategy analysis when your team overlaps one, on top of (not instead of)
 * the mechanical archetype check below. Sourced the same way as
 * WINCON_META_KNOWN_SETS above.
 */
/**
 * Simulated Win Rate feature: retired the old hand-typed WINCON_META_CORES
 * (3 static entries, display-only, never database-backed or queryable by
 * combination) in favor of data/meta-baseline.json — a strictly larger,
 * sourced dataset (real Worlds 2026 top-8 rosters plus WinCon-built
 * archetype recombinations of the same Worlds-caliber Pokémon — see that
 * file's own _readme) doing the same "matches a real synergy" display job,
 * now ALSO usable for real scoring (wcMetaBaselineArchetypeBonus/
 * wcAugmentThreatsWithMetaBaseline below), which the old constant never was.
 *
 * How many of `members` appear in any one data/meta-baseline.json reference
 * team for this format, returns the best-overlapping team (2+ shared
 * members) with a note, or null if nothing matches well enough to be worth
 * mentioning. Same shape ({ matchedPokemon, note }) the old
 * wcMetaSynergyNote returned, so wcAnalyzeTeamStrategy's own `metaSynergy`
 * field needs no consumer-side changes.
 */
function wcMetaBaselineSynergyNote(members, metaBaseline, format) {
  const referenceTeams = (metaBaseline && metaBaseline[format]) || [];
  if (referenceTeams.length === 0) return null;
  const names = new Set(members.map((m) => m.name));
  let best = null;
  referenceTeams.forEach((team) => {
    const teamNames = (team.members || []).map((m) => m.name);
    const matched = teamNames.filter((p) => names.has(p));
    if (matched.length >= 2 && (!best || matched.length > best.matched.length)) {
      best = { matched, team };
    }
  });
  if (!best) return null;
  const sourceLabel = best.team.source === "worlds2026-top8" ? "a real Worlds 2026 top-8 roster" : "a known competitive archetype";
  return {
    matchedPokemon: best.matched,
    note: `${best.matched.join(" + ")} on this team ${best.matched.length > 1 ? "match" : "matches"} ${sourceLabel}: ${best.team.label}.`,
  };
}

/**
 * This move's TRUE type once its user's ability is accounted for — a
 * type-converting ability (Pixilate/Aerilate/Refrigerate) turns a
 * Normal-type move into its own type, so that's what actually connects
 * on the field, not "Normal". Every other move's type is unaffected.
 * Shared by wcScoreMove and wcMoveIsExpected (Milestone 14) so the two
 * never quietly disagree about what type a move "really" is.
 */
function wcEffectiveMoveType(move, ability) {
  const convertedType = WINCON_ABILITY_TYPE_CONVERSION[ability];
  return convertedType && move.type === "Normal" ? convertedType : move.type;
}

/**
 * Milestone 13: `ability` (this Pokémon's own real ability, from
 * data/abilities.json — see wcAbilityOf) is optional and, when omitted,
 * scores exactly as before Milestone 13 — every pre-existing call site
 * and test keeps working unchanged. When supplied it does three things:
 * a type-converting ability (Pixilate/Aerilate/Refrigerate) scores a
 * Normal-type move as its TRUE (converted) type for both STAB and threat
 * coverage, since that's what actually happens on the field; Protean/
 * Libero score every move as STAB, since that's the whole point of the
 * ability; and a weather-setting ability gets a small bonus on its own
 * matching-type moves (it never needs a teammate or a turn spent on
 * Sunny Day/Rain Dance to get that boost — it's always up), while
 * Contrary gets a real bonus (not just "no penalty") on a move whose own
 * downside text is a self stat-drop, since Contrary turns that drawback
 * into a genuine upside.
 *
 * Milestone 14: `sheetMode` ("open" | "closed", also optional) — under
 * Open Team Sheet, every one of this Pokémon's 4 moves is visible to the
 * opponent before Game 1, so a move that only "works" as a surprise
 * (off-type coverage, no other reason to run it) is worth less: it gets
 * a small penalty here so auto-build leans toward sets that hold up on
 * their own merits even when fully known, rather than banking on tech
 * the opponent will simply play around. Forced moves (a known meta set,
 * a strategy amendment) never reach this scoring path at all — see
 * wcPickMoves — so this only ever nudges the PLAYER's own filler picks.
 */
function wcScoreMove(move, pokemonTypes, primaryCategory, threats, typeChart, format, ability, sheetMode, teamContext) {
  const effectiveType = wcEffectiveMoveType(move, ability);
  const threatEffectiveness =
    threats.reduce((sum, t) => sum + wcEffectivenessOf(typeChart, effectiveType, t.types), 0) / threats.length;
  const stab = WINCON_ALWAYS_STAB_ABILITIES.has(ability) || pokemonTypes.includes(effectiveType) ? 1 : 0;
  let categoryFit = 0;
  if (move.category === primaryCategory) categoryFit = 1;
  else if (move.category !== "Status") categoryFit = -1;
  const powerNorm = (move.power || 0) / 150;
  const formatBias = wcFormatBiasForMove(move, format);

  let abilityBonus = 0;
  const ownWeather = WINCON_WEATHER_SETTING_ABILITIES[ability];
  const weatherBoostType = { sun: "Fire", rain: "Water" }[ownWeather];
  if (weatherBoostType && effectiveType === weatherBoostType) abilityBonus += 1;
  if (ability === "Contrary" && wcMoveHasOwnStatDrop(move)) abilityBonus += 2;

  // Teammate move synergy (see wcGenerateBuild's opts.teamSoFar handling):
  // teamContext is only ever set once a REAL teammate build earlier in
  // this same team-generation pass already established something worth
  // reacting to.
  if (teamContext) {
    // A teammate's own ability is already setting real weather -- give
    // the same boosted-type bonus the OWN-ability case above gets,
    // unless this Pokemon is already getting it for its own ability
    // (avoids double-counting the same weather twice).
    if (!weatherBoostType && teamContext.weatherType && effectiveType === teamContext.weatherType) {
      abilityBonus += 1;
    }
    // The team already has real, built speed-control/redirection support
    // (Trick Room, Tailwind, or Follow Me/Rage Powder) and this Pokemon
    // is a genuine beneficiary of it (reuses wcArchetypeBeneficiaryScore's
    // existing bulky/fast/high-offense checks) -- lean into an aggressive
    // moveset rather than duplicate utility the team already has covered.
    const OFFENSE_FAVORING_ARCHETYPES = new Set(["trickroom", "tailwind", "redirect"]);
    if (teamContext.isBeneficiary && OFFENSE_FAVORING_ARCHETYPES.has(teamContext.archetypeType) && move.category !== "Status") {
      abilityBonus += 0.5;
    }
  }

  let otsPenalty = 0;
  if (sheetMode === "open" && stab === 0 && move.category !== "Status") otsPenalty -= 0.75;

  return threatEffectiveness * 2 + stab * 1.5 + categoryFit * 1.5 + powerNorm + formatBias + abilityBonus + otsPenalty;
}

/**
 * Milestone 14: whether an Open-Team-Sheet-aware opponent would already
 * expect this move from this Pokémon (so seeing it changes nothing) or
 * it's genuine "tech" — a coverage move that doesn't match its own type
 * and isn't part of a known tournament set (WINCON_META_KNOWN_SETS).
 * Status moves (Tailwind, Protect, and the like) count as expected too —
 * OTS is about surprise power/coverage, not whether a set carries
 * Protect. Used purely for the "Expected"/"Tech" tag shown on each move
 * field when a team's sheet is Open, so the player can see their own
 * OTS exposure at a glance — has no effect on scoring itself (that's
 * wcScoreMove's `sheetMode` param, applied only to the moves auto-build
 * picks on its own, same distinction as there).
 */
function wcMoveIsExpected(move, pokemonName, pokemonTypes, ability) {
  if (!move) return true;
  if (move.category === "Status") return true;
  const effectiveType = wcEffectiveMoveType(move, ability);
  if (pokemonTypes.includes(effectiveType)) return true;
  const metaSet = WINCON_META_KNOWN_SETS[pokemonName];
  return Boolean(metaSet && Array.isArray(metaSet.moves) && metaSet.moves.includes(move.name));
}

/**
 * Picks up to 4 moves for a Pokémon: any `forcedMoves` first (if it can
 * actually learn them), then fills the rest from its learnset, one slot
 * at a time.
 *
 * Milestone 12: each remaining slot re-ranks the still-available moves by
 * their real strength score (wcScoreMove — threat coverage, STAB,
 * category fit, power, format bias) MINUS a modest penalty for every move
 * of that same type already on the set so far. Status moves count in this
 * the exact same way an attacking move does — Tailwind (Flying) or Trick
 * Room (Psychic) fills a "type slot" just like a damaging move would, so
 * a status pick isn't free of the diversity accounting, and isn't
 * penalized for being a status move either.
 *
 * The penalty (0.6) is deliberately smaller than a typical real
 * strength gap, so a genuinely stronger same-type move still wins outright
 * over a weaker different-typed one — this only breaks a near-tie in
 * favor of type variety, never trades away real strength for it. That's
 * "keep type differences as common as able, without affecting strength":
 * variety happens whenever it's close to free, not at a cost.
 */
function wcPickMoves(pokemon, learnableNames, movesData, primaryCategory, threats, typeChart, forcedMoves, format, ability, sheetMode, teamContext) {
  const learnableSet = new Set(learnableNames);
  const candidates = learnableNames
    .map((name) => movesData.find((m) => m.name === name))
    .filter(Boolean);

  const picks = [];
  (forcedMoves || []).forEach((name) => {
    if (picks.length < 4 && learnableSet.has(name) && !picks.includes(name)) picks.push(name);
  });

  const remaining = candidates
    .filter((m) => !picks.includes(m.name))
    .map((m) => ({ move: m, score: wcScoreMove(m, pokemon.types, primaryCategory, threats, typeChart, format, ability, sheetMode, teamContext) }));

  const typeCounts = {};
  picks.forEach((name) => {
    const t = movesData.find((m) => m.name === name)?.type;
    if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  const REPEAT_TYPE_PENALTY = 0.6;
  while (picks.length < 4 && remaining.length > 0) {
    let bestIdx = 0;
    let bestAdjusted = -Infinity;
    remaining.forEach((c, idx) => {
      const repeats = typeCounts[c.move.type] || 0;
      const adjusted = c.score - repeats * REPEAT_TYPE_PENALTY;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIdx = idx;
      }
    });
    const pick = remaining.splice(bestIdx, 1)[0];
    picks.push(pick.move.name);
    typeCounts[pick.move.type] = (typeCounts[pick.move.type] || 0) + 1;
  }

  while (picks.length < 4) picks.push("");
  return picks;
}

/**
 * Milestone 11: a base-species Pokémon can now also be built AS one of its
 * own Mega forms, since Mega forms are no longer separately-picked roster
 * entries (see megas.js) — a slot's Mega-ness is purely a function of
 * which item it ends up holding. Auto-build only opts a base Pokémon into
 * a Mega form here when `opts.megaForms` (that species' own Mega-form
 * entries, passed by the caller — see team-builder.js) contains one with
 * BOTH a real Mega Stone (WINCON_MEGA_STONES) AND a real tournament-
 * informed set (WINCON_META_KNOWN_SETS) — same honesty rule as the rest
 * of Milestone 10: no guessed-good Mega build for the ~60 forms with no
 * real data behind them. Hand-typing any of this Pokémon's own Mega
 * Stones into its item field always makes it that Mega form regardless of
 * what auto-build would have picked — see wcEffectivePokemon in megas.js,
 * which every renderer/scorer re-derives from the build's current item
 * rather than trusting whatever auto-build last decided.
 */
/**
 * "Untapped gem" follow-up to Milestone 34: the live-data counterpart to
 * WINCON_META_KNOWN_SETS for Mega forms specifically. A real Champions
 * decklist names a Pokémon that Mega Evolves in-battle by its BASE
 * species (Mega Evolution isn't a separate team-sheet slot) with its
 * Mega Stone as the held item -- see api/cron-limitless-sync.js's own
 * header comment -- so live_meta_builds (wcFetchLiveMetaBuilds in
 * teams.js) is keyed by base species too, one entry per distinct real
 * build signature. This finds the entry (if any) whose item matches
 * `megaFormName`'s own stone, with enough real sample size to trust it
 * (same WC_META_USAGE_MIN_SAMPLE bar every other live-data layer uses),
 * and reshapes it to look exactly like a WINCON_META_KNOWN_SETS entry
 * ({ moves, item, note }) so every caller of that constant can accept
 * either without caring which one it got. Returns null (defer to
 * WINCON_META_KNOWN_SETS, or nothing) whenever there isn't a qualifying
 * one yet -- a brand new pipeline, too few real games, or this specific
 * Mega genuinely isn't being played. Always null for Singles, since
 * liveMetaBuilds is always {} there.
 */
function wcLiveMegaSetFor(megaFormName, baseSpeciesName, liveMetaBuilds) {
  const stoneItem = WINCON_MEGA_STONES[megaFormName];
  if (!stoneItem || !liveMetaBuilds) return null;
  const candidateBuilds = liveMetaBuilds[baseSpeciesName];
  if (!Array.isArray(candidateBuilds)) return null;
  const qualifying = candidateBuilds
    .filter((b) => b.item === stoneItem && b.timesUsed >= WC_META_USAGE_MIN_SAMPLE && Array.isArray(b.moves) && b.moves.length > 0)
    .sort((a, b) => b.timesUsed - a.timesUsed);
  if (qualifying.length === 0) return null;
  const best = qualifying[0];
  return {
    moves: best.moves,
    item: stoneItem,
    // Real Nature, when the live pipeline actually logged one for this
    // build (live_meta_builds.nature) -- see wcFetchLiveMetaBuilds in
    // teams.js. null (never a guess) when it wasn't captured, same
    // "silently defer" contract as every other optional live field here.
    nature: best.nature || null,
    note: `confirmed by real Regulation M-B tournament results — held ${stoneItem} in ${best.timesUsed} real tournament entries${best.winRate != null ? ` (${best.winRate}% wins)` : ""}`,
  };
}

/**
 * `notes` (Phoenix's Tailwind/Staraptor/screens request, optional,
 * trailing -- every existing call site is unaffected): when a species
 * has more than one qualifying Mega form (a real, curated-or-live-
 * confirmed X vs Y choice), a form mentioned by name in your team notes
 * (plain substring, same wcPreferredSetter convention used everywhere
 * else in this file) is tried FIRST, before falling back to today's
 * plain array order. Doesn't change anything for the common one-real-
 * Mega-form case, and doesn't help two DIFFERENT species each pick their
 * own Mega (that's not a same-species choice at all -- see
 * wcMegaMatchupAdvice for comparing across different species already on
 * the roster).
 */
function wcPickAutoMegaForm(megaForms, used, baseSpeciesName, liveMetaBuilds, notes) {
  if (!Array.isArray(megaForms)) return null;
  const qualifies = (m) =>
    WINCON_MEGA_STONES[m.name] &&
    !used.has(WINCON_MEGA_STONES[m.name]) &&
    (WINCON_META_KNOWN_SETS[m.name] || wcLiveMegaSetFor(m.name, baseSpeciesName, liveMetaBuilds));
  const text = (notes || "").toLowerCase();
  if (text.trim()) {
    const notesPreferred = megaForms.find((m) => qualifies(m) && text.includes(m.name.toLowerCase()));
    if (notesPreferred) return notesPreferred;
  }
  return megaForms.find(qualifies) || null;
}

function wcGenerateBuild(pokemon, baseStats, learnableNames, movesData, threats, typeChart, options) {
  const opts = options || {};
  const format = wcNormalizeFormat(opts.format);
  const used = opts.usedItems instanceof Set ? opts.usedItems : new Set();

  // `pokemon.name` itself being a Mega (a direct call, or a legacy/test
  // caller) always forces its own stone — unchanged from Milestone 10.
  // Otherwise, see if this base Pokémon should auto-opt into one of its
  // own Mega forms (Milestone 11) via wcPickAutoMegaForm above.
  let effectivePokemon = pokemon;
  let effectiveBaseStats = baseStats;
  let forcedStoneItem = WINCON_MEGA_STONES[pokemon.name] || null;
  if (!forcedStoneItem) {
    const autoMega = wcPickAutoMegaForm(opts.megaForms, used, pokemon.name, opts.liveMetaBuilds, opts.notes);
    if (autoMega) {
      effectivePokemon = autoMega;
      effectiveBaseStats = autoMega.baseStats;
      forcedStoneItem = WINCON_MEGA_STONES[autoMega.name];
    }
  }

  const primaryKey = wcPickPrimaryOffense(effectiveBaseStats);
  const role = opts.forceRole || wcPickRole(effectiveBaseStats);
  const isBaseForm = effectivePokemon === pokemon;
  const primaryCategory = primaryKey === "attack" ? "Physical" : "Special";

  // Milestone 13: this Pokémon's own real ability (data/abilities.json),
  // looked up by its EFFECTIVE (Mega-aware) name — feeds wcPickMoves below
  // so a weather-setter/type-converter/Contrary's move picks actually
  // reflect what its own ability does, not just its base stats/typing.
  const ability = wcAbilityOf(opts.abilitiesData, effectivePokemon.name);

  // "Untapped gem" follow-up: when this build ended up Mega (forcedStoneItem
  // set, whether via a direct call or the auto-mega branch just above) and
  // there's no hand-curated set for it, fall back to a live-tournament-
  // confirmed one (wcLiveMegaSetFor) before giving up on a real set
  // entirely -- never attempted for a non-Mega pick, since that's a
  // separate, bigger question this follow-up doesn't touch. Kept separate
  // from `metaSet` below (curatedSet is ONLY ever a real
  // WINCON_META_KNOWN_SETS entry) because a curated Nature/Stat Point
  // spread (see the beta-tester fix note above WINCON_META_KNOWN_SETS) is
  // static, hand-tuned data -- it's never something wcLiveMegaSetFor can
  // supply, since the Limitless pipeline has no EV/Stat Point field at
  // all (see 0007_live_limitless_meta.sql's own header comment).
  const curatedSet = WINCON_META_KNOWN_SETS[effectivePokemon.name];
  const metaSet = curatedSet || (forcedStoneItem ? wcLiveMegaSetFor(effectivePokemon.name, pokemon.name, opts.liveMetaBuilds) : null);

  // Locked builds: opts.lockedBuild ({nature, sp, moves}) is a permanent,
  // user-set build for this BASE species (see supabase/migrations/
  // 0008_locked_builds.sql) that this function should reuse verbatim
  // instead of picking one algorithmically. Nature and moves (below,
  // via forcedMoves) always apply, Mega or not -- but a locked Stat
  // Point spread was tuned against the base species' own stats, so it
  // only applies when this build is actually staying in base form
  // (effectivePokemon still === the passed-in pokemon, i.e. no auto-Mega
  // branch fired above); a slot that auto-opts into a very different
  // Mega stat line gets a freshly-picked spread for THAT stat line
  // instead of the base lock's numbers forced onto it.
  //
  // Beta-tester fix: a curated real set's own nature/sp (see the note
  // above WINCON_META_KNOWN_SETS) now wins over the generic heuristic the
  // same way its moves/item already did -- this is what actually fixes
  // "Incineroar adamant full 32HP and 32 ATK", which was happening
  // because Incineroar's real moves/item WERE curated but its Nature/Stat
  // Points silently were not, so it fell through to the heuristic anyway.
  // A live-tournament-sourced nature (metaSet.nature, Mega-only -- see
  // wcLiveMegaSetFor) is honored too, but never a live sp -- that field
  // genuinely doesn't exist in the live data.
  //
  // Note curatedSet.sp does NOT need the isBaseForm guard opts.lockedBuild
  // needs below: curatedSet is looked up by effectivePokemon.name (the
  // Mega-aware, already-resolved form), so a "Mega X" entry's own sp was
  // curated against THAT Mega's real base stats to begin with (see the
  // WINCON_META_KNOWN_SETS comments above) -- unlike a locked build,
  // which is always keyed by the BASE species and tuned against ITS
  // stats, so forcing it onto a very different auto-opted Mega form
  // would be wrong.
  const nature = opts.lockedBuild
    ? opts.lockedBuild.nature
    : (metaSet && metaSet.nature) || wcPickNature(primaryKey, role, effectiveBaseStats);
  const sp = opts.lockedBuild && isBaseForm
    ? { ...opts.lockedBuild.sp }
    : curatedSet && curatedSet.sp
      ? { ...curatedSet.sp }
      : wcPickSP(primaryKey, role, effectiveBaseStats);

  let item;
  if (forcedStoneItem) {
    // A Mega Pokémon isn't in its Mega form without holding its own stone —
    // that's not optional the way a regular item choice is, so this always
    // wins over both the meta known-sets item below and the generic pools.
    item = forcedStoneItem;
    used.add(item);
  } else if (metaSet && metaSet.item && !used.has(metaSet.item)) {
    item = metaSet.item;
    used.add(item);
  } else {
    item = wcPickItem(role, format, primaryCategory, used);
  }

  // Real-tournament forced moves (if any) fill in behind whatever the
  // caller already asked for (e.g. a strategy amendment's setter move),
  // never ahead of it — see wcPickMoves, which only takes the first 4 and
  // skips anything the Pokémon can't actually learn.
  const forcedMoves = [
    ...((opts.lockedBuild && opts.lockedBuild.moves.filter(Boolean)) || []),
    ...(opts.forcedMoves || []),
    ...((metaSet && metaSet.moves) || []),
  ];
  // Teammate move synergy: opts.teamSoFar ([{name, moves}], see
  // wcGenerateTeamBuilds below) is every teammate already built earlier
  // in this SAME team-generation pass. Reuses wcDetectInProgressArchetype/
  // wcArchetypeBeneficiaryScore (already shipped for Dream Team's
  // species-picking step) rather than duplicating that logic -- those
  // functions only ever read `member.learnableNames` (via .includes) and
  // a real ability, so handing them each teammate's REAL chosen moves in
  // place of a full learnset works unchanged, and is strictly more
  // precise (a real Trick Room already on the team beats merely being
  // ABLE to learn it). See wcScoreMove for what this actually changes.
  let teamContext = null;
  if (opts.teamSoFar && opts.teamSoFar.length > 0) {
    const teammatePseudoMembers = opts.teamSoFar.map((t) => ({ name: t.name, learnableNames: t.moves }));
    const inProgressArchetype = wcDetectInProgressArchetype(teammatePseudoMembers, format, opts.abilitiesData);
    if (inProgressArchetype) {
      const weatherType = { sun: "Fire", rain: "Water" }[inProgressArchetype.type] || null;
      const isBeneficiary =
        wcArchetypeBeneficiaryScore(
          { name: effectivePokemon.name, baseStats: effectiveBaseStats, types: effectivePokemon.types },
          inProgressArchetype.type,
          opts.abilitiesData
        ) > 0;
      teamContext = { weatherType, archetypeType: inProgressArchetype.type, isBeneficiary };
    }
  }
  // Milestone 14: opts.sheetMode ("open" | "closed") — under Open Team
  // Sheet, wcPickMoves' own filler picks (never the forced ones above,
  // which are already meta staples regardless) lean away from pure
  // surprise coverage — see wcScoreMove's sheetMode handling.
  const moves = wcPickMoves(effectivePokemon, learnableNames, movesData, primaryCategory, threats, typeChart, forcedMoves, format, ability, opts.sheetMode, teamContext);
  return { nature, item, moves, sp };
}

/**
 * Generates an independent build for every member of a team — no shared
 * team strategy applied. This is the "Auto-build team" step (Milestone 6):
 * it used to also force a strategy move/role onto one member here, but
 * that happened before any build existed to judge the team's actual
 * Speed/moveset balance against — see the note on wcAnalyzeTeamStrategy
 * for why that could recommend Trick Room even when it would hurt more
 * of the team than it helped. Strategy is now a deliberate second step,
 * run only once every field here is filled in.
 *
 * @param members [{ name, types, baseStats, learnableNames }]
 * @param format "doubles" | "singles" — leans move/item scoring toward
 *   this format without excluding the other, except where a move is
 *   genuinely non-functional (see wcIsAllyDependentMove).
 * @param abilitiesData optional data/abilities.json map (Milestone 13) —
 *   passed straight through to wcGenerateBuild so each member's own real
 *   ability can inform its moveset (see wcScoreMove); omitted entirely,
 *   every build generates exactly as it did before Milestone 13.
 * @param sheetMode optional "open" | "closed" (Milestone 14) — passed
 *   straight through to wcGenerateBuild's move scoring; omitted entirely,
 *   every build generates exactly as it did before Milestone 14.
 * @param liveMetaBuilds optional live_meta_builds lookup ("untapped gem"
 *   follow-up to Milestone 34, see wcFetchLiveMetaBuilds in teams.js) —
 *   passed straight through to wcGenerateBuild so a Mega form with real,
 *   sample-size-qualified tournament results can be auto-opted into even
 *   without a hand-curated WINCON_META_KNOWN_SETS entry; omitted
 *   entirely, every build generates exactly as it did before this.
 */
function wcGenerateTeamBuilds(members, movesData, threats, typeChart, format, abilitiesData, sheetMode, liveMetaBuilds, lockedBuildsLookup, notes) {
  const fmt = wcNormalizeFormat(format);
  const builds = {};
  // Shared across every member below so wcPickItem never hands out the
  // same item twice for this team — see the Item Clause note above it.
  const usedItems = new Set();
  // Teammate move synergy: grows as each member is built, in order, so
  // wcGenerateBuild can see every REAL build that already exists earlier
  // in this same pass (never a later one -- team-building is a strict
  // left-to-right sequence, same as Item Clause's `usedItems` above) --
  // see wcGenerateBuild's opts.teamSoFar handling and wcScoreMove's
  // teamContext param for what this actually feeds.
  const teamSoFar = [];
  members.forEach((m) => {
    const build = wcGenerateBuild(m, m.baseStats, m.learnableNames, movesData, threats, typeChart, {
      format: fmt,
      usedItems,
      megaForms: m.megaForms,
      abilitiesData,
      sheetMode,
      liveMetaBuilds,
      lockedBuild: lockedBuildsLookup && lockedBuildsLookup[m.name],
      teamSoFar,
      notes,
    });
    builds[m.name] = build;
    teamSoFar.push({ name: m.name, moves: build.moves });
  });
  return { builds };
}

/**
 * Locked builds: overlays ONE Auto-build-strategy amendment (see
 * wcAnalyzeTeamStrategy's return shape) onto a plain {nature, sp, moves}
 * triple and returns a NEW triple -- never mutates its input. Pure and
 * DOM-free so it's independently testable. Used by builder.js's
 * applyAmendmentsToBuilds to build up a "what would this locked
 * Pokémon's build look like with this recommendation applied" preview
 * (build.recommendedBuild) instead of ever touching the actual locked
 * fields directly. An `item`-only amendment has nothing to overlay here
 * -- item is never locked, so applyAmendmentsToBuilds applies it to the
 * real build directly and never calls this for it.
 */
function wcApplyAmendmentToFields(fields, amendment) {
  const next = { nature: fields.nature, sp: { ...fields.sp }, moves: [...fields.moves] };
  if (amendment.moves) next.moves[amendment.moves.slotIndex] = amendment.moves.to;
  if (amendment.role) {
    next.nature = amendment.role.natureTo;
    next.sp = { ...amendment.role.spTo };
  }
  return next;
}

/** "fast" if this build actually invested its Stat Points into Speed, "bulky" otherwise — reads the finished build, not just the Pokémon's raw base stats, since two builds of the same Pokémon can play very differently. */
function wcActualRole(build) {
  return build && build.sp && build.sp.speed >= 16 ? "fast" : "bulky";
}

/**
 * Works out what would actually need to change on the proposed setter to
 * run the recommended strategy — a move swap, a role/Nature/Stat Point
 * swap, and (if the role changes) an item swap — compared against its
 * current, already-completed build. Only returns the fields that truly
 * differ, so "Make changes" never re-applies something already true.
 */
function wcProposeSetterAmendment(member, build, wantMoves, wantRole, movesData, threats, typeChart, format, usedItemsExcludingSelf, abilitiesData) {
  // `member.name` may be an effective Mega-form display name (Milestone
  // 11 — see wcAnalyzeTeamStrategy); `member.slotName`, if present, is
  // the actual base-species name the build is stored under in the
  // caller's `builds` object, and is what this amendment must reference
  // so the caller can find and mutate the right build.
  const amendment = { pokemon: member.slotName || member.name, moves: null, role: null, item: null };
  const currentMoves = build.moves || ["", "", "", ""];
  const missing = (wantMoves || []).filter((mv) => !currentMoves.includes(mv));

  if (missing.length > 0) {
    const moveToAdd = missing[0];
    const primaryKey = wcPickPrimaryOffense(member.baseStats);
    const primaryCategory = primaryKey === "attack" ? "Physical" : "Special";
    const ability = wcAbilityOf(abilitiesData, member.name);
    let slotIndex = currentMoves.findIndex((mv) => !mv);
    if (slotIndex === -1) {
      let worstIdx = 0;
      let worstScore = Infinity;
      currentMoves.forEach((mvName, idx) => {
        const moveObj = movesData.find((mm) => mm.name === mvName);
        const score = moveObj ? wcScoreMove(moveObj, member.types, primaryCategory, threats, typeChart, format, ability) : -Infinity;
        if (score < worstScore) {
          worstScore = score;
          worstIdx = idx;
        }
      });
      slotIndex = worstIdx;
    }
    amendment.moves = { slotIndex, from: currentMoves[slotIndex] || "", to: moveToAdd };
  }

  if (wantRole && wcActualRole(build) !== wantRole) {
    const primaryKey = wcPickPrimaryOffense(member.baseStats);
    const primaryCategory = primaryKey === "attack" ? "Physical" : "Special";
    const newNature = wcPickNature(primaryKey, wantRole, member.baseStats);
    const newSp = wcPickSP(primaryKey, wantRole, member.baseStats);
    amendment.role = {
      from: wcActualRole(build),
      to: wantRole,
      natureFrom: build.nature,
      natureTo: newNature,
      spFrom: build.sp,
      spTo: newSp,
    };
    // If the current item is literally a Mega Stone, leave it alone even
    // if the role swap would otherwise suggest a different item — an item
    // swap here is meant to fit the new role better, not to silently
    // cancel a Mega Evolution as a side effect (see megas.js).
    const currentIsMegaStone = Object.values(WINCON_MEGA_STONES).some(
      (stone) => stone.toLowerCase() === (build.item || "").trim().toLowerCase()
    );
    if (!currentIsMegaStone) {
      const usedCopy = new Set(usedItemsExcludingSelf);
      const idealItem = wcPickItem(wantRole, format, primaryCategory, usedCopy);
      if (idealItem !== build.item) {
        amendment.item = { from: build.item, to: idealItem };
      }
    }
  }

  return amendment;
}

/**
 * Milestone 11: a handful of plain-English keywords/phrases a player might
 * write in a team's free-text notes field (see teams.js's `notes`), mapped
 * to the archetype they're about — `boost` nudges that archetype's
 * fitScore up so it's more likely to win/be offered; `suppress` drops the
 * candidate entirely (e.g. "no trick room" should mean no trick room, full
 * stop, not just a smaller nudge). This is a deliberately small, literal
 * keyword match — not language understanding — so it stays predictable
 * and explainable, consistent with the rest of auto-build/auto-strategy.
 */
const WINCON_NOTES_KEYWORDS = {
  trickroom: {
    boost: ["trick room", "trickroom", "slow team", "bulky team", "slow and bulky"],
    suppress: ["no trick room", "not trick room", "avoid trick room", "hate trick room", "don't want trick room", "dont want trick room"],
  },
  tailwind: {
    boost: ["tailwind", "outspeed", "speed team", "fast team"],
    suppress: ["no tailwind", "not tailwind", "avoid tailwind", "enough tailwind", "too much tailwind", "sick of tailwind"],
  },
  sun: {
    boost: ["sun team", "sunny day", "sun strategy"],
    suppress: ["no sun", "not sun", "avoid sun"],
  },
  rain: {
    boost: ["rain team", "rain dance", "rain strategy"],
    suppress: ["no rain", "not rain", "avoid rain"],
  },
  sand: {
    boost: ["sand team", "sandstorm", "sand strategy"],
    suppress: ["no sand", "not sand", "avoid sand"],
  },
  snow: {
    boost: ["snow team", "hail team", "snow strategy"],
    suppress: ["no snow", "not snow", "avoid snow"],
  },
  redirect: {
    boost: ["redirect", "follow me", "rage powder", "protect my sweeper", "protect my attacker"],
    suppress: ["no redirect", "not redirect", "avoid redirect"],
  },
  hazards: {
    boost: ["hazard", "stealth rock", "spikes", "stall"],
    suppress: ["no hazard", "not hazard", "avoid hazard"],
  },
  screens: {
    boost: ["screens", "light screen", "reflect", "dual screens"],
    suppress: ["no screens", "not screens", "avoid screens"],
  },
};

/** Applies the player's free-text team notes to a list of strategy candidates: drops any archetype the notes explicitly say to avoid, and boosts the fitScore of any archetype the notes ask for, tagging it with a `noteSuffix` so the note text can say so. A blank/whitespace-only `notes` leaves the candidates untouched. */
function wcApplyNotesBias(candidates, notes) {
  const text = (notes || "").toLowerCase();
  if (!text.trim()) return candidates;
  return candidates
    .map((c) => {
      const rules = WINCON_NOTES_KEYWORDS[c.archetype];
      if (!rules) return c;
      if (rules.suppress.some((kw) => text.includes(kw))) return null;
      if (rules.boost.some((kw) => text.includes(kw))) {
        return { ...c, fitScore: c.fitScore + 3, noteSuffix: " You mentioned this in your team notes, so it's weighted higher here." };
      }
      return c;
    })
    .filter(Boolean);
}

/**
 * Milestone 12: if the player's free-text notes mention one of the
 * Pokémon actually eligible to run this archetype by name, that's who
 * runs it — overriding whatever the default heuristic (fastest for
 * Tailwind, slowest for Trick Room, etc.) would otherwise have picked.
 * Falls back to `fallback(pool)` when notes are blank or don't mention
 * anyone in `pool`. Returns `{ setter, mentioned }` so the caller can
 * explain the pick when notes are the reason for it.
 */
function wcPreferredSetter(pool, notes, fallback) {
  const text = (notes || "").toLowerCase();
  if (text.trim()) {
    const mentioned = pool.find((m) => text.includes(m.name.toLowerCase()));
    if (mentioned) return { setter: mentioned, mentioned: true };
  }
  return { setter: fallback(pool), mentioned: false };
}

/** Builds one full strategy-option object (archetype/setterName/note/amendments) from a scored candidate — shared by the primary and alternative results below so they're computed identically. */
function wcBuildStrategyOption(candidate, builds, movesData, threats, typeChart, fmt, abilitiesData) {
  const slotName = candidate.setter.slotName || candidate.setter.name;
  const usedItemsExcludingSelf = new Set(
    Object.entries(builds)
      .filter(([name]) => name !== slotName)
      .map(([, b]) => b.item)
      .filter(Boolean)
  );
  const amendment = wcProposeSetterAmendment(
    candidate.setter,
    builds[slotName],
    candidate.wantMoves,
    candidate.wantRole,
    movesData,
    threats,
    typeChart,
    fmt,
    usedItemsExcludingSelf,
    abilitiesData
  );
  const hasChanges = Boolean(amendment.moves || amendment.role || amendment.item);
  return {
    archetype: candidate.archetype,
    setterName: candidate.setterName,
    note: candidate.note + (candidate.noteSuffix || ""),
    amendments: hasChanges ? [amendment] : [],
  };
}

/**
 * The "Auto-build strategy" step (Milestone 6) — run only once every
 * field on all 6 Pokémon is filled in, so this judges a real finished
 * team rather than blanks. Evaluates the same handful of archetypes as
 * before, but now against the team's actual built roles (fast vs. bulky,
 * read from each build's own Stat Point spread — see wcActualRole) and
 * actual chosen moves, not just raw learnability:
 *
 *   - Trick Room only scores as a net win if more of the team is already
 *     built bulky/slow than fast — otherwise it'd flip turn order against
 *     more teammates than it helps, which is exactly the failure mode
 *     this milestone exists to fix (the old version recommended it
 *     whenever anyone could merely learn the move).
 *   - Tailwind scores by how many teammates are already built fast
 *     enough to make use of doubled Speed.
 *   - Sun/Rain only score if a teammate's actual chosen moveset (not just
 *     its typing) includes a move that benefits from that weather.
 *   - Redirection (Doubles) / hazards (Singles) stay as lighter-weight
 *     fallbacks, same as before.
 *
 * Every candidate gets a fitScore; the highest-scoring one is the primary
 * recommendation. Milestone 11: the SECOND-highest-scoring candidate (if
 * any) is now also returned as `alternative`, in the same shape — players
 * kept seeing Tailwind recommended over and over with no other option
 * offered, so there's always a second, genuinely-viable strategy to
 * consider when the team supports more than one. `notes` (a team's
 * free-text notes field, Milestone 11) can boost or outright suppress
 * specific archetypes before this ranking happens — see wcApplyNotesBias.
 * If none clears zero (or notes suppressed everything), "balanced" (no
 * shared strategy) is returned with an explanation of why, and no
 * alternative. Each option's amendments (if any) come from
 * wcProposeSetterAmendment — empty means the team already fits as-is.
 *
 * Milestone 10: the result also carries `metaSynergy` — a note (or null)
 * on whether this team overlaps a known real-tournament core (see
 * data/meta-baseline.json via wcMetaBaselineSynergyNote) — always
 * computed and returned alongside whichever
 * mechanical archetype wins above, since the two are independent signals
 * rather than competing for the same recommendation.
 *
 * @param members [{ name, types, baseStats, learnableNames, slotName? }] —
 *   `name`/`types`/`baseStats` are the EFFECTIVE identity (a member's own
 *   Mega form, if its build currently holds that Mega's stone — see
 *   megas.js); `slotName`, when it differs from `name`, is the base
 *   species name `builds` is actually keyed by.
 * @param builds current, already-complete builds keyed by slot (base) name
 * @param notes optional free-text team notes (Milestone 11)
 * @param abilitiesData optional data/abilities.json map (Milestone 13) —
 *   drives the weather-setting-ability detection below (see
 *   WINCON_WEATHER_SETTING_ABILITIES) and is threaded into any move
 *   amendment scoring; omitted entirely, weather can still be
 *   recommended via a learnable Sunny Day/Rain Dance/etc. move, just not
 *   via an ability that sets it for free.
 */
function wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, format, notes, abilitiesData, metaBaseline) {
  const fmt = wcNormalizeFormat(format);
  const canLearn = (m, moveName) => m.learnableNames.includes(moveName);
  const roleOf = (m) => wcActualRole(builds[m.slotName || m.name]);
  const fastMembers = members.filter((m) => roleOf(m) === "fast");
  const bulkyMembers = members.filter((m) => roleOf(m) === "bulky");

  const candidates = [];

  const trCandidates = members.filter((m) => canLearn(m, "Trick Room"));
  if (trCandidates.length > 0) {
    const netBenefit = bulkyMembers.length - fastMembers.length;
    if (netBenefit > 0) {
      const { setter, mentioned } = wcPreferredSetter(trCandidates, notes, (pool) =>
        pool.reduce((a, b) => (b.baseStats.spe < a.baseStats.spe ? b : a))
      );
      candidates.push({
        archetype: "trickroom",
        setterName: setter.name,
        setter,
        wantMoves: ["Trick Room"],
        wantRole: "bulky",
        fitScore: netBenefit,
        note:
          `${bulkyMembers.length} of your 6 are already built bulky/slow and only ${fastMembers.length} ${fastMembers.length === 1 ? "is" : "are"} built for speed, so Trick Room ` +
          `(learnable by ${setter.name}) is a net win for this team — it flips turn order in their favor for five turns.` +
          (fastMembers.length > 0
            ? ` ${fastMembers.map((m) => m.name).join(", ")} ${fastMembers.length > 1 ? "are" : "is"} built fast and will lose that speed edge while it's up, so plan their turns around it.`
            : "") +
          (mentioned ? ` You mentioned ${setter.name} in your team notes, so it's the one set up to run this.` : ""),
      });
    }
  }

  const twCandidates = members.filter((m) => canLearn(m, "Tailwind"));
  if (twCandidates.length > 0 && fastMembers.length > 0) {
    const { setter, mentioned } = wcPreferredSetter(twCandidates, notes, (pool) =>
      pool.reduce((a, b) => (b.baseStats.spe > a.baseStats.spe ? b : a))
    );
    // Milestone 12: "Tailwind then a switch" is a real sequencing tactic —
    // set it up, then immediately pivot out so a teammate comes in with
    // Tailwind's Speed already active instead of burning a turn of it just
    // switching. Only ever descriptive here (it doesn't force a move swap
    // the way the Trick Room/Tailwind amendment itself does), since a
    // pivot move competing for one of the setter's own 4 slots is a real
    // trade-off the player should make by hand, not one this should quietly
    // impose.
    const setterBuild = builds[setter.slotName || setter.name];
    const currentPivot = setterBuild && (setterBuild.moves || []).find((mv) => WINCON_PIVOT_MOVES.has(mv));
    const learnablePivot = !currentPivot && [...WINCON_PIVOT_MOVES].find((mv) => canLearn(setter, mv));
    let pivotNote = "";
    if (currentPivot) {
      pivotNote = ` It already knows ${currentPivot}, so it can set Tailwind up one turn and pivot straight out the next, bringing in a teammate with that Speed boost already active instead of a teammate that has to switch in cold.`;
    } else if (learnablePivot) {
      pivotNote = ` It can also learn ${learnablePivot} — teaching it that instead of a weaker filler move would let it set Tailwind up and pivot out the very next turn, rather than staying in and risking the turn Tailwind bought.`;
    }
    candidates.push({
      archetype: "tailwind",
      setterName: setter.name,
      setter,
      wantMoves: ["Tailwind"],
      wantRole: null,
      fitScore: fastMembers.length,
      note:
        `${setter.name} can learn Tailwind — ${fastMembers.length} of your 6 are already built for speed, so doubling the team's Speed for a few turns lets them win even more Speed checks, at no cost to your bulkier members.` +
        pivotNote +
        (mentioned ? ` You mentioned ${setter.name} in your team notes, so it's the one set up to run this.` : ""),
    });
  }

  [
    ["sun", "Sunny Day", "Fire"],
    ["rain", "Rain Dance", "Water"],
  ].forEach(([key, moveName, benefitType]) => {
    // Milestone 13: an ABILITY that auto-sets the weather the instant its
    // Pokémon is on the field (see WINCON_WEATHER_SETTING_ABILITIES — now
    // a real lookup over every sourced ability in data/abilities.json,
    // not just Mega Charizard Y as in Milestone 12) costs no move slot at
    // all, unlike actually running Sunny Day/Rain Dance — so it's
    // preferred outright over a move-based setter when both are
    // available, and the amendment this produces (wantMoves: []) never
    // asks for a move swap, since none is needed.
    const abilitySetters = members.filter((m) => WINCON_WEATHER_SETTING_ABILITIES[wcAbilityOf(abilitiesData, m.name)] === key);
    const moveCandidates = members.filter((m) => canLearn(m, moveName));
    if (abilitySetters.length === 0 && moveCandidates.length === 0) return;
    const moveBeneficiaries = members.filter((m) => {
      const b = builds[m.slotName || m.name];
      return b && (b.moves || []).some((mvName) => movesData.find((mm) => mm.name === mvName)?.type === benefitType);
    });
    // Milestone 13: an ability like Chlorophyll or Swift Swim makes its
    // own Pokémon meaningfully better under this weather (almost always
    // a Speed double) independent of whatever moves it's actually
    // running — a second, ability-driven reason this weather is worth
    // having up, on top of (not instead of) the move-type check above.
    const abilityBeneficiaries = members.filter(
      (m) =>
        !moveBeneficiaries.includes(m) &&
        (WINCON_WEATHER_BENEFIT_ABILITIES[key] || []).includes(wcAbilityOf(abilitiesData, m.name))
    );
    const beneficiaries = [...moveBeneficiaries, ...abilityBeneficiaries];
    if (beneficiaries.length === 0) return;

    const beneficiaryPhrase = () => {
      const parts = [];
      if (moveBeneficiaries.length > 0) {
        parts.push(
          `${moveBeneficiaries.map((m) => m.name).join(", ")} already ${moveBeneficiaries.length > 1 ? "run" : "runs"} a ${benefitType}-type move that gets a real damage boost while it's active`
        );
      }
      if (abilityBeneficiaries.length > 0) {
        parts.push(
          `${abilityBeneficiaries.map((m) => `${m.name} (${wcAbilityOf(abilitiesData, m.name)})`).join(", ")} ${abilityBeneficiaries.length > 1 ? "get" : "gets"} a real edge from ${abilityBeneficiaries.length > 1 ? "their own abilities" : "its own ability"} while it's active`
        );
      }
      return parts.join(", and ");
    };

    if (abilitySetters.length > 0) {
      const { setter, mentioned } = wcPreferredSetter(abilitySetters, notes, (pool) => pool[0]);
      candidates.push({
        archetype: key,
        setterName: setter.name,
        setter,
        wantMoves: [],
        wantRole: null,
        fitScore: beneficiaries.length + 1, // a free weather setter beats a move-slot one, all else equal
        note:
          `${setter.name}'s own ability sets ${key === "sun" ? "Sun" : "Rain"} automatically the moment it's on the field — no move slot spent — and ${beneficiaryPhrase()}.` +
          (mentioned ? ` You mentioned ${setter.name} in your team notes.` : ""),
      });
      return;
    }

    const { setter, mentioned } = wcPreferredSetter(moveCandidates, notes, (pool) =>
      pool.find((m) => !beneficiaries.some((b) => b.name === m.name)) || pool[0]
    );
    candidates.push({
      archetype: key,
      setterName: setter.name,
      setter,
      wantMoves: [moveName],
      wantRole: null,
      fitScore: beneficiaries.length,
      note:
        `${setter.name} can set up ${key === "sun" ? "Sun (Sunny Day)" : "Rain (Rain Dance)"} — ${beneficiaryPhrase()}.` +
        (mentioned ? ` You mentioned ${setter.name} in your team notes, so it's the one set up to run this.` : ""),
    });
  });

  // Milestone 13: sand and snow get their own archetype now that
  // data/abilities.json makes Sand Stream/Snow Warning detectable —
  // these two weathers don't boost a move's raw power the way sun/rain
  // do, so "worth having up" here is judged by ability synergy (a real
  // Speed-doubling ability) and by a teammate on the type that passively
  // toughens up while it's active (Rock's Sp. Def in sand, Ice's Defense
  // in snow — see WINCON_WEATHER_PASSIVE_BULK_TYPE), not by a matching
  // move type. Ability-only, unlike sun/rain: this project hasn't sourced
  // a learnable-move fallback path for these two, so they only ever come
  // up when a real ability-setter is actually on the team.
  ["sand", "snow"].forEach((key) => {
    const abilitySetters = members.filter((m) => WINCON_WEATHER_SETTING_ABILITIES[wcAbilityOf(abilitiesData, m.name)] === key);
    if (abilitySetters.length === 0) return;
    const bulkType = WINCON_WEATHER_PASSIVE_BULK_TYPE[key];
    const bulkBeneficiaries = members.filter((m) => m.types.includes(bulkType));
    const abilityBeneficiaries = members.filter((m) =>
      (WINCON_WEATHER_BENEFIT_ABILITIES[key] || []).includes(wcAbilityOf(abilitiesData, m.name))
    );
    const beneficiaries = [...new Set([...bulkBeneficiaries, ...abilityBeneficiaries])];
    if (beneficiaries.length === 0) return;

    const { setter, mentioned } = wcPreferredSetter(abilitySetters, notes, (pool) => pool[0]);
    const parts = [];
    if (bulkBeneficiaries.length > 0) {
      parts.push(
        `${bulkBeneficiaries.map((m) => m.name).join(", ")} ${bulkBeneficiaries.length > 1 ? "are" : "is"} ${bulkType}-type, so its ${key === "sand" ? "Special Defense" : "Defense"} gets a passive boost the whole time it's up`
      );
    }
    if (abilityBeneficiaries.length > 0) {
      parts.push(
        `${abilityBeneficiaries.map((m) => `${m.name} (${wcAbilityOf(abilitiesData, m.name)})`).join(", ")} ${abilityBeneficiaries.length > 1 ? "get" : "gets"} a real edge from ${abilityBeneficiaries.length > 1 ? "their own abilities" : "its own ability"} while it's active`
      );
    }
    candidates.push({
      archetype: key,
      setterName: setter.name,
      setter,
      wantMoves: [],
      wantRole: null,
      fitScore: beneficiaries.length + 1,
      note:
        `${setter.name}'s own ability sets ${key === "sand" ? "a sandstorm" : "snow"} automatically the moment it's on the field — no move slot spent — and ${parts.join(", and ")}.` +
        (mentioned ? ` You mentioned ${setter.name} in your team notes.` : ""),
    });
  });

  if (fmt === "doubles") {
    const redirectCandidates = members.filter((m) => canLearn(m, "Follow Me") || canLearn(m, "Rage Powder"));
    if (redirectCandidates.length > 0) {
      const sweeper = members.reduce((a, b) =>
        Math.max(b.baseStats.atk, b.baseStats.spa) > Math.max(a.baseStats.atk, a.baseStats.spa) ? b : a
      );
      const { setter: redirector, mentioned } = wcPreferredSetter(redirectCandidates, notes, (pool) =>
        pool.find((m) => m.name !== sweeper.name) || pool[0]
      );
      const move = canLearn(redirector, "Follow Me") ? "Follow Me" : "Rage Powder";
      candidates.push({
        archetype: "redirect",
        setterName: redirector.name,
        setter: redirector,
        wantMoves: [move],
        wantRole: null,
        fitScore: 0.5,
        note:
          `${redirector.name} can learn ${move} — pairing it with ${sweeper.name} (your hardest hitter) lets it draw attacks away while ${sweeper.name} swings freely.` +
          (mentioned ? ` You mentioned ${redirector.name} in your team notes, so it's the one set up to run this.` : ""),
      });
    }
  } else {
    const hazardMoves = WINCON_STRATEGY_MOVES.hazards;
    const hazardCandidates = members.filter((m) => hazardMoves.some((hz) => canLearn(m, hz)));
    if (hazardCandidates.length > 0) {
      const learnCount = (m) => hazardMoves.filter((hz) => canLearn(m, hz)).length;
      const { setter, mentioned } = wcPreferredSetter(hazardCandidates, notes, (pool) =>
        pool.reduce((a, b) => (learnCount(b) > learnCount(a) ? b : a))
      );
      const learnableHazards = hazardMoves.filter((hz) => canLearn(setter, hz));
      candidates.push({
        archetype: "hazards",
        setterName: setter.name,
        setter,
        wantMoves: [learnableHazards[0]],
        wantRole: null,
        fitScore: 0.5,
        note:
          `${setter.name} can learn ${learnableHazards.join(" and ")} — in a Singles game, entry hazards chip away at anything that switches in over a longer match, so it's worth a moveslot on your best lead or pivot.` +
          (mentioned ? ` You mentioned ${setter.name} in your team notes, so it's the one set up to run this.` : ""),
      });
    }
  }

  // Screens (Milestone: Phoenix's Tailwind/Staraptor/screens request) --
  // same "find a candidate, prefer a free/no-cost angle first, fall back
  // to wcPreferredSetter" shape the weather block above already uses,
  // just with Prankster (guaranteed-priority screens) standing in for a
  // weather-setting ABILITY as the "no real cost" case, since screens
  // has no ability-only path the way weather does.
  const screensCandidates = members.filter((m) => canLearn(m, "Light Screen") || canLearn(m, "Reflect"));
  if (screensCandidates.length > 0) {
    const prankster = screensCandidates.filter((m) => wcAbilityOf(abilitiesData, m.name) === "Prankster");
    const pool = prankster.length > 0 ? prankster : screensCandidates;
    const { setter, mentioned } = wcPreferredSetter(pool, notes, (p) => p[0]);
    const learnableScreens = ["Light Screen", "Reflect"].filter((mv) => canLearn(setter, mv));
    const isPrankster = wcAbilityOf(abilitiesData, setter.name) === "Prankster";
    candidates.push({
      archetype: "screens",
      setterName: setter.name,
      setter,
      wantMoves: [learnableScreens[0]],
      wantRole: null,
      fitScore: isPrankster ? 1.5 : 1,
      note:
        `${setter.name} can learn ${learnableScreens.join(" and ")} — screens cut incoming damage for your whole side, buying time for a setup sweeper or a slower attacker to get going.` +
        (isPrankster ? ` Prankster guarantees it goes up before the opponent can punish it.` : "") +
        (mentioned ? ` You mentioned ${setter.name} in your team notes, so it's the one set up to run this.` : ""),
    });
  }

  const biasedCandidates = wcApplyNotesBias(candidates, notes);

  if (biasedCandidates.length === 0) {
    return {
      archetype: "balanced",
      setterName: null,
      note:
        candidates.length > 0
          ? `Your team notes ruled out every strategy that would otherwise fit here — playing as six independent attackers is the fallback while that's the case.`
          : `Your team's built roles are split (${fastMembers.length} fast / ${bulkyMembers.length} bulky), and no learnable Trick Room, Tailwind, weather, screens, or ${fmt === "doubles" ? "redirection" : "hazard"}-setting ` +
            `move would clearly help more of the team than it'd cost — no single shared strategy stands out here, so playing as six independent attackers is the safer call.`,
      amendments: [],
      metaSynergy: wcMetaBaselineSynergyNote(members, metaBaseline, fmt),
      alternative: null,
    };
  }

  biasedCandidates.sort((a, b) => b.fitScore - a.fitScore);
  const winnerOption = wcBuildStrategyOption(biasedCandidates[0], builds, movesData, threats, typeChart, fmt, abilitiesData);
  const alternativeOption =
    biasedCandidates.length > 1
      ? wcBuildStrategyOption(biasedCandidates[1], builds, movesData, threats, typeChart, fmt, abilitiesData)
      : null;

  return {
    ...winnerOption,
    metaSynergy: wcMetaBaselineSynergyNote(members, metaBaseline, fmt),
    alternative: alternativeOption,
  };
}

// ---------------------------------------------------------------------------
// Matchup scoring (Milestone 2a, moved here from matchup-score.js and
// generalized in Milestone 14) — shared by the Matchup Score section AND
// "Your Rival", since both are the exact same question ("how does my team
// answer this list of 6?"), just asked against a different list: a fixed
// reference-threat list for Matchup Score, a synthesized counter-team for
// Your Rival. One implementation means the two can never quietly drift
// apart the way two separate copies eventually would have.
// ---------------------------------------------------------------------------

/**
 * Scores one (my Pokémon, opposing Pokémon) pair — not a simulated battle
 * or a measured win rate, just three legible signals combined into a
 * small point total:
 *   - Offense: best type-effectiveness of my chosen moves (or my own
 *     types, if no moves are set yet) against their types.
 *   - Defense: worst-case effectiveness of their types against mine.
 *   - Speed: a rough same-formula comparison of my computed Speed
 *     (Stat Points + Nature) against their raw base Speed — the "other
 *     side" has no SP/Nature of its own here, whether that's a reference
 *     threat or a synthesized Rival build scored the same generic way.
 *
 * @param pokemon my EFFECTIVE (Mega-aware) identity — { name, types }
 * @param build my current build — { moves, sp, nature }
 * @param myBaseStats my base stats row, or null/undefined if unknown
 *   (Reg M-B additions without confirmed data yet) — offense/defense
 *   still score, Speed just can't.
 * @param threatPokemon the opposing Pokémon — { name, types }
 * @param threatBaseStats their base stats row, or null/undefined
 * @param natures data/natures.json
 * @param typeChart data/type-chart.json
 * @param movesData data/moves.json
 * @param opts.sheetMode "open" | "closed" (Milestone 14) — under "open"
 *   (Open Team Sheet), a "favorable" verdict earned specifically by a
 *   chosen MOVE (rather than by raw typing alone) is downgraded to
 *   "even": once an opponent has seen this exact sheet, they bring the
 *   right switch-in or play around a known coverage move, so this credits
 *   only the type-matchup edge that survives that. Omitted or "closed"
 *   scores exactly as this always has (the ladder default — no assumed
 *   foreknowledge of your set).
 */
function wcScoreMatchup(pokemon, build, myBaseStats, threatPokemon, threatBaseStats, natures, typeChart, movesData, opts) {
  const options = opts || {};
  const moveTypes = (build.moves || [])
    .filter(Boolean)
    .map((moveName) => movesData.find((m) => m.name === moveName)?.type)
    .filter(Boolean);
  const offensiveTypesWithMoves = moveTypes.length > 0 ? moveTypes : pokemon.types;

  const offense = wcBestEffectiveness(typeChart, offensiveTypesWithMoves, threatPokemon.types);
  const defense = wcBestEffectiveness(typeChart, threatPokemon.types, pokemon.types);

  let mySpeed = null;
  let outspeeds = null;
  if (myBaseStats) {
    mySpeed = wcCalcStat(myBaseStats.spe, "speed", build.sp?.speed, build.nature, natures);
    if (threatBaseStats) outspeeds = mySpeed > threatBaseStats.spe;
  }

  const pointsFor = (off) => {
    let points = 0;
    if (off >= 2) points += 2;
    else if (off <= 0.5) points -= 1;
    if (defense >= 2) points -= 2;
    else if (defense <= 0.5) points += 1;
    if (outspeeds === true) points += 1;
    let verdict = "even";
    if (points >= 2) verdict = "favorable";
    else if (points <= -2) verdict = "unfavorable";
    return { points, verdict };
  };

  const withMoves = pointsFor(offense);
  let { points, verdict } = withMoves;
  let otsDowngraded = false;

  if (options.sheetMode === "open" && withMoves.verdict === "favorable" && moveTypes.length > 0) {
    // Would raw typing alone (no specific move) already get here? If not,
    // the edge came from a move choice the opponent can now see coming
    // and play around — credit only what survives without it.
    const offenseTypesOnly = wcBestEffectiveness(typeChart, pokemon.types, threatPokemon.types);
    const typesOnly = pointsFor(offenseTypesOnly);
    if (typesOnly.verdict !== "favorable") {
      points = typesOnly.points;
      verdict = "even";
      otsDowngraded = true;
    }
  }

  return { points, verdict, offense, defense, outspeeds, statsKnown: Boolean(myBaseStats), otsDowngraded };
}

// ---------------------------------------------------------------------------
// "Generate Dream Team" (Milestone 8) — auto-picking the 6, not just
// building them
// ---------------------------------------------------------------------------

/** Average, across the reference threats, of this typing's best own-type effectiveness against each one — a proxy for "how hard can this Pokémon hit the field", without needing to know its actual moveset yet (this runs before any build exists). */
function wcTeamOffenseScore(types, threats, typeChart) {
  if (!threats || threats.length === 0) return 0;
  return threats.reduce((sum, t) => sum + wcBestEffectiveness(typeChart, types, t.types), 0) / threats.length;
}

/** Negative average, across the reference threats, of their best effectiveness against this typing — higher (closer to 0, or positive) means this typing takes less from the field on average. */
function wcTeamDefenseScore(types, threats, typeChart) {
  if (!threats || threats.length === 0) return 0;
  const avgIncoming = threats.reduce((sum, t) => sum + wcBestEffectiveness(typeChart, t.types, types), 0) / threats.length;
  return -avgIncoming;
}

/**
 * Mega matchup advisor (Phoenix's Tailwind/Staraptor/screens request):
 * "either Mega Charizard or Mega Sceptile ... whichever fits the
 * opponent." WinCon has never enforced "only one real Mega per roster" --
 * Mega Evolution itself is a once-per-battle choice a player makes at
 * Team Preview, not a per-slot restriction, so any number of team
 * members can already carry their own real Mega Stone at once (see
 * wcPickAutoMegaForm -- no cross-member exclusivity check exists or
 * needs to). What's missing is guidance on WHICH one to actually press
 * this game. This never touches the roster or a build -- purely an
 * explainable recommendation, reusing the exact same pure
 * offense/defense scoring Dream Team's own fallback candidate scoring
 * uses (wcTeamOffenseScore/wcTeamDefenseScore) when it has no fuller
 * coverage-gain data available either.
 *
 * `effectiveMembers` must already be Mega-resolved (see
 * effectiveMemberFor/wcSlotEffective in builder.js -- the same list
 * wcAnalyzeTeamStrategy itself is called with) so `.name`/`.types`
 * reflect each slot's REAL current Mega form, not its base species.
 * Returns null whenever there's nothing to compare (0 or 1 real Mega
 * built this generation -- the common case).
 */
function wcMegaMatchupAdvice(effectiveMembers, threats, typeChart) {
  const megaMembers = (effectiveMembers || []).filter((m) => WINCON_MEGA_STONES[m.name]);
  if (megaMembers.length < 2) return null;
  const ranked = megaMembers
    .map((m) => ({
      name: m.name,
      score: wcTeamOffenseScore(m.types, threats, typeChart) + wcTeamDefenseScore(m.types, threats, typeChart),
    }))
    .sort((a, b) => b.score - a.score);
  const [best, ...rest] = ranked;
  const note =
    `You have ${ranked.length} real Megas built this generation (${ranked.map((r) => r.name).join(", ")}) -- treating them as interchangeable, ` +
    `${best.name} looks like the stronger matchup call against your current threat list. ${rest.map((r) => r.name).join(", ")} ` +
    `${rest.length > 1 ? "are" : "is"} the safer pick if the threats you're actually facing shift. This is typing-based offense/defense fit against your ` +
    `threat list, not a full damage calc -- and it never drops either one from your roster on your behalf.`;
  return { ranked, note };
}

function wcBaseStatTotal(baseStats) {
  return baseStats.hp + baseStats.atk + baseStats.def + baseStats.spa + baseStats.spd + baseStats.spe;
}

/**
 * How many current-team members resist/are immune to `attackType` minus
 * how many are weak to it — the same "net score" idea the Matchup Score
 * page's type coverage panel uses. Zero or negative means the team so
 * far has no real answer to that attack type yet.
 */
function wcTeamNetScoreForType(attackType, teamTypesList, typeChart) {
  let net = 0;
  teamTypesList.forEach((types) => {
    const mult = wcEffectivenessOf(typeChart, attackType, types);
    if (mult < 1) net += 1;
    else if (mult > 1) net -= 1;
  });
  return net;
}

/**
 * Rewards a candidate for resisting/being immune to whichever attack
 * types the team-so-far doesn't already have a good answer for (net
 * score <= 0), and mildly penalizes it for being weak to those same
 * types — piling onto an existing liability makes it worse, not better.
 * Types the team already covers well don't add further bonus either
 * way, so this favors covering gaps over stacking redundant resists.
 */
function wcDefenseCoverageBonus(candidateTypes, teamTypesList, allTypes, typeChart) {
  let bonus = 0;
  allTypes.forEach((type) => {
    if (wcTeamNetScoreForType(type, teamTypesList, typeChart) > 0) return;
    const mult = wcEffectivenessOf(typeChart, type, candidateTypes);
    if (mult < 1) bonus += 1;
    else if (mult > 1) bonus -= 1;
  });
  return bonus;
}

/** How many current teammates share this candidate's exact type combination (order-independent) — a small penalty so a greedy pick doesn't pile up several near-identical typings when a different one would cover more ground. */
function wcSameTypingPenalty(candidateTypes, teamTypesList) {
  const key = [...candidateTypes].sort().join("/");
  return teamTypesList.filter((types) => [...types].sort().join("/") === key).length;
}

/**
 * Greedily builds a team of `size` from `pool` (each entry
 * { name, types, baseStats, learnableNames }) — one Pokémon at a time,
 * always taking whichever remaining candidate most improves the team's
 * combined score: how well its typing answers the reference threat list
 * both offensively and defensively (`data/starter-threats.json` — the
 * same reference the Matchup Score page and auto-build's move scoring
 * use), how much it patches whichever attack types the team-so-far has
 * no real answer to, its raw base-stat total as a lighter tiebreaker,
 * and a small penalty for exactly duplicating a teammate's typing.
 *
 * This is a greedy heuristic, not an exhaustive search over every
 * possible 6-Pokémon combination — checking every combination out of a
 * roster of any real size is computationally way out of reach (a roster
 * of just 50 already has over 15 million distinct 6-Pokémon teams), so
 * this builds one strong team one well-reasoned pick at a time instead.
 * Same "explainable rules, not claimed-optimal" honesty as the rest of
 * auto-build.
 */
/** A base species is "Mega-eligible" for this purpose only when auto-build would actually opt it into a real (not guessed) Mega set — see wcPickAutoMegaForm/WINCON_META_KNOWN_SETS. Same honesty bar as everywhere else in Milestone 10/11: this can't call every base species with a Mega form "Mega-eligible," since guessing a build for the ~60 with no real data behind them isn't something this project does. "Untapped gem" follow-up: `liveMetaBuilds` (optional, trailing) lets a live-tournament-confirmed Mega (wcLiveMegaSetFor) qualify here too, not just a hand-curated one -- omitted entirely, this behaves exactly as before. */
function wcHasKnownMegaOption(candidate, liveMetaBuilds) {
  return (
    Array.isArray(candidate.megaForms) &&
    candidate.megaForms.some(
      (m) => WINCON_MEGA_STONES[m.name] && (WINCON_META_KNOWN_SETS[m.name] || wcLiveMegaSetFor(m.name, candidate.name, liveMetaBuilds))
    )
  );
}

/**
 * Milestone 21: a per-pair matchup estimate for TEAM-PICKING purposes,
 * before any real build exists yet -- reuses the exact points/verdict
 * model wcScoreMatchup already applies to a BUILT Pokémon on the Matchup
 * Score page, just with no moves (falls back to raw types, same as an
 * unbuilt slot there) and a neutral-nature/0-SP Speed estimate from base
 * stats alone (also the same fallback the matrix already uses). This is
 * what candidate scoring below is built on, replacing the old flat
 * "average effectiveness across every threat" approach: an average
 * smooths away exactly the signal that matters for picking a TEAM rather
 * than rating one Pokémon in isolation -- see wcCandidateCoverageGain.
 */
function wcPreBuildMatchupPoints(candidate, threat, natures, typeChart, movesData) {
  return wcScoreMatchup(candidate, {}, candidate.baseStats, threat, threat.baseStats, natures, typeChart, movesData, {});
}

/**
 * For each threat, the best points any CURRENT team member already scores
 * against it (-Infinity when the team is still empty, so the very first
 * pick is judged purely on its own matchup quality). This is the
 * "coverage state" wcCandidateCoverageGain below measures improvement
 * against.
 */
function wcThreatCoverageState(teamMembers, threats, natures, typeChart, movesData) {
  return threats.map((threat) => {
    let bestPoints = -Infinity;
    teamMembers.forEach((member) => {
      const { points } = wcPreBuildMatchupPoints(member, threat, natures, typeChart, movesData);
      if (points > bestPoints) bestPoints = points;
    });
    return { threat, bestPoints };
  });
}

/**
 * Milestone 21: how much this ONE candidate would improve the team's
 * weakest matchups if added right now -- summed across every threat,
 * weighted so flipping a threat nothing on the team currently beats into
 * a genuinely favorable answer counts far more than shaving a point off
 * a matchup a teammate already handles fine. This is the fix for "the
 * rival team always has the same rotating Pokémon": the old scoring
 * averaged a candidate's matchup across every threat, so a Pokémon that's
 * merely decent against everything and great against nothing always beat
 * a Pokémon that's a genuine hard counter to one specific, otherwise-
 * unanswered threat -- and "merely decent against everything" tends to be
 * the SAME few high-stat, well-typed Pokémon regardless of which team
 * they're actually up against. Rewarding marginal, threat-specific
 * improvement instead means different opposing teams pull in different
 * answers: whichever Pokémon in the pool specifically beats whichever of
 * YOUR team's members nothing else on the rival roster beats yet (e.g.
 * Charizard is the pool's best answer to Venusaur, but Venusaur itself
 * might be the pool's best answer to a different teammate, and neither is
 * necessarily the right answer to a third) -- rather than the pool's one
 * "best on average" Pokémon winning every single time.
 */
function wcCandidateCoverageGain(candidate, coverageState, natures, typeChart, movesData) {
  let gain = 0;
  coverageState.forEach(({ threat, bestPoints }) => {
    const { points } = wcPreBuildMatchupPoints(candidate, threat, natures, typeChart, movesData);
    const improvement = points - bestPoints;
    if (improvement <= 0) return;
    let weight = 1;
    if (bestPoints < 2 && points >= 2) weight = 2.5; // flips an unanswered threat into a real answer
    else if (bestPoints <= -2) weight = 1.5; // the team was actively losing to this one
    gain += improvement * weight;
  });
  return gain;
}

/** Which threats this candidate specifically flips from "nothing on the team beats it yet" to a genuinely favorable answer -- used only to explain a pick in plain language (see the reasoning text in wcPickDreamTeam), not to score it. */
function wcCoverageWinsFor(candidate, coverageState, natures, typeChart, movesData) {
  const wins = [];
  coverageState.forEach(({ threat, bestPoints }) => {
    if (bestPoints >= 2) return;
    const { points } = wcPreBuildMatchupPoints(candidate, threat, natures, typeChart, movesData);
    if (points >= 2) wins.push(threat.name);
  });
  return wins;
}

/**
 * Milestone 21: does this threat list read as a real weather-abuse team --
 * not just "happens to be Water-heavy," but has an actual way to put the
 * weather up: a signature weather-setting ABILITY (Drizzle/Drought/Sand
 * Stream/Snow Warning) on one of the threats, or -- when a threat's real
 * moveset is known, e.g. Your Rival scoring the player's own built team --
 * a confirmed Rain Dance/Sunny Day in that moveset. Requires at least one
 * direct setter signal before flagging anything, on purpose: a team
 * that's merely Water-heavy without any way to start rain already gets
 * full credit from the ordinary per-threat matchup scoring above, and
 * flagging a weather archetype with no setter behind it would push picks
 * toward answering a threat that isn't actually there.
 */
function wcDetectWeatherArchetype(threats, abilitiesData) {
  const setterNames = { sun: [], rain: [], sand: [], snow: [] };
  threats.forEach((threat) => {
    const ability = threat.ability || wcAbilityOf(abilitiesData, threat.name);
    const abilityWeather = ability && WINCON_WEATHER_SETTING_ABILITIES[ability];
    if (abilityWeather) setterNames[abilityWeather].push(threat.name);
    const moves = (threat.build && threat.build.moves) || [];
    if (moves.includes("Sunny Day")) setterNames.sun.push(threat.name);
    if (moves.includes("Rain Dance")) setterNames.rain.push(threat.name);
  });
  let winner = null;
  let winnerCount = 0;
  Object.keys(setterNames).forEach((weather) => {
    const uniqueNames = [...new Set(setterNames[weather])];
    setterNames[weather] = uniqueNames;
    if (uniqueNames.length > winnerCount) {
      winner = weather;
      winnerCount = uniqueNames.length;
    }
  });
  return winner ? { weather: winner, setters: setterNames[winner] } : null;
}

/** The type that gets a same-weather power boost for STAB purposes (rain boosts Water, sun boosts Fire) -- sand and snow don't boost a specific attacking type this way, they instead toughen one type's own bulk (WINCON_WEATHER_PASSIVE_BULK_TYPE), so there's no entry for those two here. */
const WINCON_WEATHER_BOOSTED_ATTACK_TYPE = { rain: "Water", sun: "Fire" };

/** The weather that directly cancels this one when set -- sun and rain override each other outright; sand and snow don't have a canonical opposite, so any other weather taking over the field still stops their chip/boost. */
const WINCON_WEATHER_OPPOSITE = { rain: "sun", sun: "rain" };

/**
 * Milestone 21: rewards a candidate for being a genuine answer to a
 * detected weather archetype (see wcDetectWeatherArchetype) -- resisting
 * whatever type that weather boosts, or, for sand/snow, being immune to
 * its passive chip -- plus a further bonus for being able to shut the
 * weather off outright via a signature weather-setting ability of its
 * own (Drought/Drizzle/Sand Stream/Snow Warning). This is the "grass and
 * sunny day beat a rain team" idea generalized to every weather: not just
 * "is decent against a Water-type," but specifically built to survive the
 * weather's extra bite and, where possible, cancel it.
 *
 * Deliberately NOT counted: whether the candidate's learnset happens to
 * include Sunny Day/Rain Dance. Checked against the data, ~75% of the
 * entire roster can learn either move via TM -- it's one of the most
 * common TMs in the games, not a meaningful sign this specific Pokémon
 * would actually be built to use it. Crediting "knows the TM" would
 * reward nearly everyone equally and stop meaning anything, so only the
 * much rarer, always-on signature ABILITY counts here -- same "explain
 * real reasons, don't dress up a coin flip as insight" rule as the rest
 * of this file.
 */
function wcWeatherCounterBonus(candidate, weatherInfo, typeChart, abilitiesData) {
  if (!weatherInfo) return 0;
  const { weather } = weatherInfo;
  let bonus = 0;

  const boostedType = WINCON_WEATHER_BOOSTED_ATTACK_TYPE[weather];
  if (boostedType) {
    const mult = wcEffectivenessOf(typeChart, boostedType, candidate.types);
    if (mult < 1) bonus += 1.5;
    else if (mult > 1) bonus -= 1;
  } else {
    const bulkType = WINCON_WEATHER_PASSIVE_BULK_TYPE[weather];
    const chipImmuneTypes = weather === "sand" ? ["Steel", "Ground", "Rock"] : ["Ice"];
    if (bulkType && candidate.types.includes(bulkType)) bonus += 1;
    if (candidate.types.some((t) => chipImmuneTypes.includes(t))) bonus += 0.5;
  }

  const ownAbility = wcAbilityOf(abilitiesData, candidate.name);
  const ownWeather = ownAbility && WINCON_WEATHER_SETTING_ABILITIES[ownAbility];
  if (ownWeather === WINCON_WEATHER_OPPOSITE[weather]) bonus += 2;
  else if (ownWeather && ownWeather !== weather) bonus += 1;

  return bonus;
}

/**
 * Milestone 28: minimum number of REAL logged games (across every player
 * on the site, not just one person) a species needs before its
 * meta_usage_stats numbers are trusted enough to influence anything --
 * below this, a Pokémon that's 1-0 or 0-1 in the whole site's history
 * would otherwise swing scoring off a single data point. Early on, with
 * a brand new site, this means the real-data signal below will mostly
 * sit at 0 and every pick still comes from the existing curated
 * heuristics -- that's the correct, honest behavior until enough games
 * get logged, not a bug. See README.md's Milestone 28 section.
 */
const WC_META_USAGE_MIN_SAMPLE = 5;

/** How much weight a real, sample-size-qualified win rate gets in wcDreamTeamCandidateScore below -- deliberately modest next to the existing coverage/weather/stat terms, since this is a supplement to the explainable heuristics already there, not a replacement for them. */
const WC_META_USAGE_WEIGHT = 2;

/**
 * 0 when there isn't enough real logged data yet for this species (or
 * none was passed at all -- an un-migrated/offline call site, or nobody
 * signed in), otherwise a signed nudge: a species with a real win_rate_used
 * above 50% (across every player who's logged a game with it, not just
 * this one) scores up, below 50% scores down, scaled by how far from 50%
 * it sits.
 */
function wcMetaUsageCandidateBonus(name, metaUsage) {
  const stat = metaUsage && metaUsage[name];
  if (!stat || !(stat.timesUsed >= WC_META_USAGE_MIN_SAMPLE) || stat.winRateUsed == null) return 0;
  return ((stat.winRateUsed - 50) / 50) * WC_META_USAGE_WEIGHT;
}

/**
 * A short trailing clause naming the real, cross-user logged win rate
 * behind a pick, whenever it cleared the same sample-size bar
 * wcMetaUsageCandidateBonus uses and actually says something worth
 * surfacing (a real win rate at least 5 points off an even 50%) -- added
 * so a pick backed by real logged games reads that way in "Why these
 * six"/"Why this rival beats you," the same "explainable, not a black
 * box" standard every other scoring signal here (coverage wins, the
 * weather archetype, the Mega guarantee) already gets in that same
 * reasoning list. Returns "" when there's nothing worth saying yet -- no
 * data, too few games, or a real win rate too close to even to call out.
 */
function wcMetaUsageReasoningNote(name, metaUsage) {
  const stat = metaUsage && metaUsage[name];
  if (!stat || !(stat.timesUsed >= WC_META_USAGE_MIN_SAMPLE) || stat.winRateUsed == null) return "";
  if (Math.abs(stat.winRateUsed - 50) < 5) return "";
  return stat.winRateUsed >= 50
    ? ` It's also backed by a real edge in actual logged games: ${stat.winRateUsed}% wins across ${stat.timesUsed} real matches.`
    : ` Worth knowing: real logged games have it at a below-average ${stat.winRateUsed}% wins across ${stat.timesUsed} matches -- everything else about the pick still stands, but that's worth watching.`;
}

/**
 * Simulated Win Rate feature: the curated-data counterpart to
 * wcMetaUsageCandidateBonus above -- a small nudge toward a candidate
 * that appears on 2+ data/meta-baseline.json reference teams for this
 * format (Worlds 2026 rosters plus WinCon's own archetype
 * recombinations of the same Worlds-caliber Pokémon), same spirit as
 * WINCON_META_CORES used to provide for the (now-retired) metaSynergy
 * display note, but now feeding real scoring too. Deliberately a
 * smaller weight than WC_META_USAGE_WEIGHT -- this is curated/static
 * data standing in for a floor of global knowledge, not real evidence
 * from THIS site's own players, so it should never outrank a real
 * logged-battle signal once one exists.
 */
const WC_META_BASELINE_WEIGHT = 1.5;

function wcMetaBaselineArchetypeBonus(candidateName, metaBaseline, format) {
  const referenceTeams = (metaBaseline && metaBaseline[format]) || [];
  if (referenceTeams.length === 0) return 0;
  const appearances = referenceTeams.filter((team) => (team.members || []).some((m) => m.name === candidateName)).length;
  if (appearances === 0) return 0;
  return Math.min(1, appearances / 3) * WC_META_BASELINE_WEIGHT;
}

/** Reasoning-list counterpart to wcMetaBaselineArchetypeBonus, same "explainable, not a black box" standard as wcMetaUsageReasoningNote. Returns "" when the candidate doesn't appear on any reference team. */
function wcMetaBaselineReasoningNote(candidateName, metaBaseline, format) {
  const referenceTeams = (metaBaseline && metaBaseline[format]) || [];
  const matches = referenceTeams.filter((team) => (team.members || []).some((m) => m.name === candidateName));
  if (matches.length === 0) return "";
  const worldsMatch = matches.find((team) => team.source === "worlds2026-top8");
  return worldsMatch
    ? ` It's also part of a real Worlds 2026 top-8 roster (${worldsMatch.label}).`
    : ` It also appears on ${matches.length} known competitive-archetype reference team${matches.length > 1 ? "s" : ""} in the current meta.`;
}

/**
 * Milestone 34 follow-up: the live-data counterpart to
 * wcMetaUsageCandidateBonus/wcMetaBaselineArchetypeBonus above, at a
 * trust level between the two -- real Regulation M-B tournament results
 * (live_tier_stats, via wcFetchLiveTierStats in teams.js /
 * api/cron-limitless-sync.js) are more current than the static,
 * hand-curated meta-baseline field, but less trusted than this site's
 * own logged battles (nobody's actually played WITH or AGAINST this pick
 * on WinCon itself yet). Used by Dream Team's own candidate scoring and
 * Your Rival's (which reuses the same scorer "in reverse" -- see
 * wcDreamTeamCandidateScore's doc comment), so a species genuinely
 * winning right now in real tournaments nudges toward being picked
 * either way. Same "silently 0 until real data exists" contract as its
 * neighbors -- always 0 for Singles, since liveMeta is always {} there
 * (see wcFetchLiveTierStats's own comment on why).
 */
const WC_LIVE_META_CANDIDATE_WEIGHT = 1.75;

function wcLiveMetaCandidateBonus(name, liveMeta) {
  const stat = liveMeta && liveMeta[name];
  if (!stat || !(stat.timesUsed >= WC_META_USAGE_MIN_SAMPLE) || stat.winRate == null) return 0;
  return ((stat.winRate - 50) / 50) * WC_LIVE_META_CANDIDATE_WEIGHT;
}

/**
 * Milestone (Phoenix's Tailwind/Staraptor/screens request): a genuinely
 * SCORED preference, not a force. WINCON_INCLUDE_TRIGGERS/
 * wcNotesMentionedSpecies (a hard "must include X"/"built around X"
 * phrase) still guarantees a Pokemon a roster spot -- this is separate
 * and much smaller: just mentioning a Pokemon's name anywhere in your
 * notes ("I've landed on Staraptor...") nudges Dream Team toward it
 * without ever overriding a clearly better-fitting alternative. Reuses
 * wcPreferredSetter's exact plain-substring matching convention -- no
 * new trigger-phrase vocabulary. WC_SOFT_PREFERENCE_BONUS is
 * deliberately smaller than a real archetype-synergy weight (1/1.5, see
 * WC_ARCHETYPE_SETTER_WEIGHT/WC_ARCHETYPE_BENEFICIARY_WEIGHT below) so a
 * plain mention can only ever break a close tie, never beat a real
 * matchup/coverage edge -- which is exactly what makes it honest to flag
 * when the mentioned Pokemon still loses (see wcSoftPreferenceTradeoffNote).
 */
const WC_SOFT_PREFERENCE_BONUS = 0.5;

function wcNotesSoftPreferenceBonus(candidateName, notes) {
  const text = (notes || "").toLowerCase();
  if (!text.trim()) return 0;
  return text.includes(candidateName.toLowerCase()) ? WC_SOFT_PREFERENCE_BONUS : 0;
}

/**
 * Every name in `namesList` that appears anywhere in `notes` as a plain
 * substring -- the same permissive matching wcPreferredSetter/
 * wcNotesSoftPreferenceBonus use (no trigger phrase required), just
 * returning every match instead of only the first. Longer names checked
 * first so a two-word form name can't spuriously eat a shorter base name
 * sitting inside it (same precaution wcNotesMentionedSpecies already
 * takes for the hard-include case).
 */
function wcNotesPlainMentionedNames(notes, namesList) {
  const text = (notes || "").toLowerCase();
  if (!text.trim()) return [];
  const sortedNames = [...namesList].sort((a, b) => b.length - a.length);
  return sortedNames.filter((name) => text.includes(name.toLowerCase()));
}

/**
 * The honest flip side of wcNotesSoftPreferenceBonus: when a Pokemon
 * mentioned in your notes (plain mention, not necessarily a hard "must
 * include") carries a real archetype signal (wcArchetypeSignalsFor --
 * the same pre-build signals Milestone 36's Dream Team picking already
 * uses) but didn't make the final team, and another teammate ended up
 * running that same archetype with a DIFFERENT ability, this says so
 * plainly instead of staying silent about the trade-off. Returns null
 * whenever there's nothing worth saying: the mentioned Pokemon made the
 * team after all, it never carried an archetype signal to begin with,
 * nothing on the final team fills that role either, or the actual
 * setter's ability matches anyway (nothing was actually given up).
 */
function wcSoftPreferenceTradeoffNote(mentionedCandidate, finalTeamMembers, format, abilitiesData) {
  if (!mentionedCandidate) return null;
  if (finalTeamMembers.some((m) => m.name === mentionedCandidate.name)) return null;
  const signals = wcArchetypeSignalsFor(mentionedCandidate, format, abilitiesData);
  const mentionedAbility = wcAbilityOf(abilitiesData, mentionedCandidate.name);
  if (!mentionedAbility) return null;
  for (const archetypeType of signals) {
    const actualSetter = finalTeamMembers.find((m) => wcArchetypeSignalsFor(m, format, abilitiesData).includes(archetypeType));
    if (!actualSetter) continue;
    const actualAbility = wcAbilityOf(abilitiesData, actualSetter.name);
    if (actualAbility !== mentionedAbility) {
      return (
        `${mentionedCandidate.name} wasn't included -- ${actualSetter.name} is your ${wcArchetypeDisplayName(archetypeType)} setter instead ` +
        `(${actualAbility || "no notable ability"}, not ${mentionedAbility} -- if ${mentionedCandidate.name}'s ${mentionedAbility} mattered to you, this is worth a manual swap).`
      );
    }
  }
  return null;
}

/** Reasoning-list counterpart to wcLiveMetaCandidateBonus, same "explainable, not a black box" standard as its neighbors. Returns "" when there's nothing worth saying yet -- no data, too few tournament entries, or a real win rate too close to even to call out. */
function wcLiveMetaReasoningNote(name, liveMeta) {
  const stat = liveMeta && liveMeta[name];
  if (!stat || !(stat.timesUsed >= WC_META_USAGE_MIN_SAMPLE) || stat.winRate == null) return "";
  if (Math.abs(stat.winRate - 50) < 5) return "";
  return stat.winRate >= 50
    ? ` It's also winning big in real Regulation M-B tournaments right now: ${stat.winRate}% across ${stat.timesUsed} real entries.`
    : ` Worth knowing: real tournament results have it at a below-average ${stat.winRate}% wins across ${stat.timesUsed} entries -- everything else about the pick still stands, but that's worth watching.`;
}

/**
 * Simulated Win Rate feature: how much more or less often one of
 * data/meta-baseline.json's own hand-verified reference teams should be
 * sampled by the Monte Carlo engine, based on how its real members are
 * actually performing in live Regulation M-B tournaments right now
 * (live_tier_stats). This deliberately never lets a real, incomplete
 * Limitless decklist (no stat-spread data -- see
 * 0007_live_limitless_meta.sql's own header comment on
 * live_reference_teams) INTO the simulated battle pool itself: every
 * opponent actually battled is still one of the hand-verified teams
 * below, with a real, sourced stat spread. All this changes is how OFTEN
 * each already-trusted team gets battled, so a currently-thriving
 * archetype shows up more in the reported win rate and a fading one
 * shows up less -- a nudge toward "what's actually being played right
 * now," never a source of new, unverified opponents.
 *
 * Returns 1 (neutral -- exactly today's un-weighted behavior) whenever
 * there isn't enough live data for this team's own members yet, so this
 * is a silent no-op until the Limitless pipeline has real data to offer,
 * same contract as every other live-data layer in this file. Always 1
 * for Singles, since liveTierStats is always {} there.
 */
const WC_LIVE_WEIGHT_STRENGTH = 1;
const WC_LIVE_WEIGHT_MIN = 0.5;
const WC_LIVE_WEIGHT_MAX = 2;

function wcLiveUsageWeightForTeam(teamMembers, liveTierStats) {
  if (!liveTierStats) return 1;
  const qualifying = (teamMembers || [])
    .map((m) => liveTierStats[m.name])
    .filter((stat) => stat && stat.timesUsed >= WC_META_USAGE_MIN_SAMPLE && stat.winRate != null);
  if (qualifying.length === 0) return 1;
  const avgWinRate = qualifying.reduce((sum, stat) => sum + stat.winRate, 0) / qualifying.length;
  const raw = 1 + ((avgWinRate - 50) / 50) * WC_LIVE_WEIGHT_STRENGTH;
  return Math.min(WC_LIVE_WEIGHT_MAX, Math.max(WC_LIVE_WEIGHT_MIN, raw));
}

/**
 * Combo-level counterpart to wcMetaUsageCandidateBonus/wcMetaBaselineArchetypeBonus
 * -- Simulated Win Rate's own learning loop (see supabase/migrations/
 * 0006_lineup_scope_and_combo_synergy.sql's combo_synergy_stats table and
 * teams.js's wcFetchComboSynergyStats/wcComputeLineupKey). `comboLookup`
 * is that table's read, keyed by the same sorted/pipe-joined combo key.
 * Used by battle-sim-lineup.js's Phase 1 lineup ranking (a combo with a
 * real, sample-size-qualified logged win rate nudges toward being the
 * recommended bring-4/3) -- deliberately NOT wired into Dream Team's own
 * incremental 6-picking loop, since a partial team's eventual bring-4/3
 * isn't knowable while Dream Team is still choosing the other 2-3.
 */
const WC_COMBO_SYNERGY_MIN_SAMPLE = 3;
const WC_COMBO_SYNERGY_WEIGHT = 2;

function wcComboSynergyBonus(lineupNames, comboLookup) {
  if (!comboLookup) return 0;
  const key = [...lineupNames].filter(Boolean).sort().join("|");
  const stat = comboLookup[key];
  if (!stat || !(stat.timesUsed >= WC_COMBO_SYNERGY_MIN_SAMPLE) || stat.winRate == null) return 0;
  return ((stat.winRate - 50) / 50) * WC_COMBO_SYNERGY_WEIGHT;
}

/**
 * Milestone 36: "auto strategise when picking the team" -- look at
 * synergy between pairs/triples/groups while species are still being
 * PICKED, not just after the team is fully built (that's what
 * wcAnalyzeTeamStrategy already does, via WINCON_STRATEGY_MOVES/
 * WINCON_WEATHER_SETTING_ABILITIES/WINCON_WEATHER_BENEFIT_ABILITIES --
 * all reused here rather than re-defined). The catch: movesets don't
 * exist yet during picking (wcGenerateTeamBuilds always runs AFTER
 * wcPickDreamTeam finishes), so this reads the two signals that ARE
 * known this early -- a species' fixed real ability (abilitiesData) and
 * whether it CAN LEARN a strategy-defining move (candidate.learnableNames,
 * from data/learnsets.json) -- the same two kinds of evidence
 * wcAnalyzeTeamStrategy itself treats as sufficient for a real pick.
 */
function wcArchetypeSignalsFor(member, format, abilitiesData) {
  const signals = [];
  // Weather is ability-only here, deliberately -- Sunny Day/Rain Dance are
  // near-universal TM moves (roughly three-quarters of all species can
  // learn one or the other in data/learnsets.json), so "can learn it"
  // carries no real signal for them the way it does for Trick Room/
  // Tailwind/redirection/hazards below. A real weather team is set by
  // ability anyway (instant, costs no turn or moveslot) -- exactly what
  // WINCON_WEATHER_SETTING_ABILITIES/wcDetectWeatherArchetype already
  // assume for the THREAT side of this same distinction.
  const ability = wcAbilityOf(abilitiesData, member.name);
  const abilityWeather = ability && WINCON_WEATHER_SETTING_ABILITIES[ability];
  if (abilityWeather) signals.push(abilityWeather);
  const learnable = member.learnableNames || [];
  if (learnable.includes("Trick Room")) signals.push("trickroom");
  if (learnable.includes("Tailwind")) signals.push("tailwind");
  if (learnable.includes("Light Screen") || learnable.includes("Reflect")) signals.push("screens");
  if (format !== "singles" && (learnable.includes("Follow Me") || learnable.includes("Rage Powder"))) {
    signals.push("redirect");
  }
  if (format === "singles" && WINCON_STRATEGY_MOVES.hazards.some((mv) => learnable.includes(mv))) {
    signals.push("hazards");
  }
  return signals;
}

/**
 * Looks at the team as picked SO FAR and asks "is there already a shared
 * strategy forming?" -- the archetype with the most independent setters
 * wins (ties broken by whichever was detected first), mirroring
 * wcDetectWeatherArchetype's own "most setters wins" logic just applied
 * across all archetype types, not only weather.
 */
function wcDetectInProgressArchetype(team, format, abilitiesData) {
  const setterNames = {};
  team.forEach((m) => {
    wcArchetypeSignalsFor(m, format, abilitiesData).forEach((type) => {
      if (!setterNames[type]) setterNames[type] = [];
      if (!setterNames[type].includes(m.name)) setterNames[type].push(m.name);
    });
  });
  let winner = null;
  let winnerCount = 0;
  Object.keys(setterNames).forEach((type) => {
    if (setterNames[type].length > winnerCount) {
      winner = type;
      winnerCount = setterNames[type].length;
    }
  });
  return winner ? { type: winner, setters: setterNames[winner] } : null;
}

/** Does this candidate actually make good use of an archetype already forming on the team? */
function wcArchetypeBeneficiaryScore(candidate, archetypeType, abilitiesData) {
  if (!archetypeType) return 0;
  const ability = wcAbilityOf(abilitiesData, candidate.name);
  switch (archetypeType) {
    case "trickroom":
      return wcPickRole(candidate.baseStats) === "bulky" ? 1 : 0;
    case "tailwind":
      return wcPickRole(candidate.baseStats) === "fast" ? 1 : 0;
    case "sun":
    case "rain": {
      const boostedType = archetypeType === "sun" ? "Fire" : "Water";
      const abilityMatch = Boolean(ability && WINCON_WEATHER_BENEFIT_ABILITIES[archetypeType] && WINCON_WEATHER_BENEFIT_ABILITIES[archetypeType].includes(ability));
      const typeMatch = Boolean(candidate.types && candidate.types.includes(boostedType));
      return abilityMatch || typeMatch ? 1 : 0;
    }
    case "sand":
    case "snow": {
      const passiveType = WINCON_WEATHER_PASSIVE_BULK_TYPE[archetypeType];
      const abilityMatch = Boolean(ability && WINCON_WEATHER_BENEFIT_ABILITIES[archetypeType] && WINCON_WEATHER_BENEFIT_ABILITIES[archetypeType].includes(ability));
      const typeMatch = Boolean(passiveType && candidate.types && candidate.types.includes(passiveType));
      return abilityMatch || typeMatch ? 1 : 0;
    }
    case "redirect": {
      const atk = (candidate.baseStats && candidate.baseStats.atk) || 0;
      const spa = (candidate.baseStats && candidate.baseStats.spa) || 0;
      return Math.max(atk, spa) >= 100 ? 1 : 0;
    }
    case "screens": {
      // Same reasoning as redirect above: screens exist to keep a real
      // hard hitter alive long enough to matter, not to protect another
      // support Pokemon.
      const atk = (candidate.baseStats && candidate.baseStats.atk) || 0;
      const spa = (candidate.baseStats && candidate.baseStats.spa) || 0;
      return Math.max(atk, spa) >= 100 ? 1 : 0;
    }
    case "hazards":
      return 0;
    default:
      return 0;
  }
}

const WC_ARCHETYPE_SETTER_WEIGHT = 1;
const WC_ARCHETYPE_BENEFICIARY_WEIGHT = 1.5;

/**
 * The scoring hook wired into wcDreamTeamCandidateScore below: once a
 * shared strategy is already forming on the team, a candidate that
 * actually benefits from it outweighs one that's merely individually
 * strong (WC_ARCHETYPE_BENEFICIARY_WEIGHT > WC_ARCHETYPE_SETTER_WEIGHT) --
 * doubling down on a working game plan beats starting a second, competing
 * one. Before any strategy has formed, a candidate that COULD start one
 * gets a smaller nudge, so Dream Team leans toward a cohesive team from
 * the very first picks without ever overriding real matchup/coverage
 * scoring outright.
 */
function wcArchetypeSynergyBonus(candidate, team, format, abilitiesData) {
  const existing = wcDetectInProgressArchetype(team, format, abilitiesData);
  if (existing) {
    return wcArchetypeBeneficiaryScore(candidate, existing.type, abilitiesData) * WC_ARCHETYPE_BENEFICIARY_WEIGHT;
  }
  const ownSignals = wcArchetypeSignalsFor(candidate, format, abilitiesData);
  return ownSignals.length > 0 ? WC_ARCHETYPE_SETTER_WEIGHT : 0;
}

const WC_ARCHETYPE_DISPLAY_NAMES = {
  trickroom: "Trick Room",
  tailwind: "Tailwind",
  sun: "sun",
  rain: "rain",
  sand: "sandstorm",
  snow: "snow",
  redirect: "redirection (Follow Me / Rage Powder)",
  hazards: "entry hazards",
  screens: "screens (Light Screen / Reflect)",
};

function wcArchetypeDisplayName(type) {
  return WC_ARCHETYPE_DISPLAY_NAMES[type] || type;
}

/**
 * The reasoning-list line for the archetype-synergy bonus above, following
 * the same additive-string pattern as wcMetaUsageReasoningNote/
 * wcLiveMetaReasoningNote/wcMetaBaselineReasoningNote (a leading space,
 * empty string when there's nothing to say). `team` must be the team
 * BEFORE this candidate is added, so the detection reflects what was
 * already forming rather than trivially "detecting" this pick's own
 * signal as if it were already on the team.
 */
function wcArchetypeSynergyReasoningNote(candidate, team, format, abilitiesData) {
  const existing = wcDetectInProgressArchetype(team, format, abilitiesData);
  if (existing) {
    if (wcArchetypeBeneficiaryScore(candidate, existing.type, abilitiesData) > 0) {
      return ` This team is already leaning into ${wcArchetypeDisplayName(existing.type)} (via ${existing.setters.join(", ")}), and ${candidate.name} is a real fit for it, so this pick doubles down on a shared game plan instead of just being individually strong.`;
    }
    return "";
  }
  const ownSignals = wcArchetypeSignalsFor(candidate, format, abilitiesData);
  if (ownSignals.length > 0) {
    return ` ${candidate.name} can also set up ${ownSignals.map(wcArchetypeDisplayName).join("/")} for this team, giving the rest of the picks a real shared strategy to build around.`;
  }
  return "";
}

/**
 * Milestone 21: candidate scoring for team-picking, now built on marginal,
 * threat-specific coverage (wcCandidateCoverageGain) instead of a flat
 * average, plus a weather-archetype bonus (wcWeatherCounterBonus) when the
 * threat list reads as a real weather team. `natures`/`movesData` are
 * required for the new per-pair scoring; a caller that hasn't been
 * updated to pass them yet falls back to the old flat average rather than
 * throwing, so this never hard-breaks an un-migrated call site.
 *
 * Milestone 28: also folds in a real, cross-user win-rate signal (see
 * wcMetaUsageCandidateBonus above) when `opts.metaUsage` is given -- this
 * is what lets logged battles actually feed Dream Team's own picks (and
 * Your Rival's, which reuses this same scorer "in reverse" -- see
 * README.md's Milestone 14 section), not just the threat list they're
 * scored against (see wcAugmentThreatsWithMetaUsage below for that half).
 *
 * Simulated Win Rate feature: also folds in wcMetaBaselineArchetypeBonus
 * when `opts.metaBaseline`/`opts.format` are given -- the curated
 * Worlds-2026-grounded floor described on that function, additive to
 * (and independently weighted from) the real-logged-data metaBonus above.
 */
function wcDreamTeamCandidateScore(candidate, team, threats, typeChart, allTypes, opts) {
  const options = opts || {};
  const teamTypesList = team.map((m) => m.types);

  const coverageGain =
    options.natures && options.movesData
      ? wcCandidateCoverageGain(
          candidate,
          wcThreatCoverageState(team, threats, options.natures, typeChart, options.movesData),
          options.natures,
          typeChart,
          options.movesData
        )
      : wcTeamOffenseScore(candidate.types, threats, typeChart) * 2 + wcTeamDefenseScore(candidate.types, threats, typeChart) * 1.5;

  const weatherBonus = wcWeatherCounterBonus(candidate, options.weatherInfo, typeChart, options.abilitiesData);
  const coverage = wcDefenseCoverageBonus(candidate.types, teamTypesList, allTypes, typeChart);
  const dup = wcSameTypingPenalty(candidate.types, teamTypesList);
  const bst = wcBaseStatTotal(candidate.baseStats);
  const metaBonus = wcMetaUsageCandidateBonus(candidate.name, options.metaUsage);
  const liveMetaBonus = wcLiveMetaCandidateBonus(candidate.name, options.liveMeta);
  const metaBaselineBonus = options.metaBaseline
    ? wcMetaBaselineArchetypeBonus(candidate.name, options.metaBaseline, options.format || "doubles")
    : 0;
  const archetypeBonus = wcArchetypeSynergyBonus(candidate, team, options.format || "doubles", options.abilitiesData);
  const softPreferenceBonus = wcNotesSoftPreferenceBonus(candidate.name, options.notes);
  return coverageGain * 1.5 + weatherBonus * 1 + coverage * 0.5 + (bst / 600) * 0.5 - dup * 1.5 + metaBonus + liveMetaBonus + metaBaselineBonus + archetypeBonus + softPreferenceBonus;
}

/**
 * Milestone 28: folds real, cross-user logged-battle data
 * (meta_usage_stats) into a curated threats list -- any species
 * frequently FACED in real games (past the same WC_META_USAGE_MIN_SAMPLE
 * bar) with a real win rate against opponents worth calling out gets
 * added alongside the curated list, so Auto-build team/Auto-build
 * strategy/Generate Dream Team's move and matchup scoring (which all
 * read `threats`, via getThreatsWithTypes() in builder.js) gives real,
 * currently-scary Pokémon their due -- not just whatever
 * data/starter-threats.json happened to name when this project started.
 * Silently returns the original list, untouched, when there's no meta
 * usage data yet (a brand new site, or too few games logged) -- see
 * README.md's Milestone 28 section for the honesty note on how sparse
 * this will be at first. `allPokemonByName` supplies types for any
 * species this pulls in that isn't already in `threats`.
 */
function wcAugmentThreatsWithMetaUsage(threats, metaUsage, allPokemonByName) {
  if (!metaUsage) return threats;
  const existingNames = new Set(threats.map((t) => t.name));
  const additions = [];
  Object.keys(metaUsage).forEach((name) => {
    if (existingNames.has(name)) return;
    const stat = metaUsage[name];
    if (!stat || stat.timesFaced < WC_META_USAGE_MIN_SAMPLE) return;
    if (stat.winRateFaced == null || stat.winRateFaced < 55) return; // only genuinely-scary real opponents, not a coin flip
    const pokemon = allPokemonByName && allPokemonByName[name];
    if (!pokemon) return;
    additions.push({
      name,
      role: `Real-world threat — beat opponents ${stat.winRateFaced}% of the time across ${stat.timesFaced} logged games`,
      types: pokemon.types,
    });
  });
  return additions.length ? [...threats, ...additions] : threats;
}

/**
 * Milestone 34 (the Limitless pipeline): the live-data counterpart to
 * wcAugmentThreatsWithMetaUsage above, and the curated-data COUNTERPART's
 * own counterpart -- this project now layers threats by trust level three
 * deep: WinCon's own logged battles (wcAugmentThreatsWithMetaUsage, most
 * trusted -- real players, this site) first, then real Regulation M-B
 * tournament results from Limitless (this function, `liveMeta` from
 * wcFetchLiveTierStats in teams.js / live_tier_stats, kept fresh by
 * api/cron-limitless-sync.js) filling whatever gaps that leaves, then
 * data/meta-baseline.json's small hand-curated set
 * (wcAugmentThreatsWithMetaBaseline) as the final fallback floor. Same
 * "silently a no-op until there's real data" contract as its neighbors --
 * a name already added by the more-trusted layer above is never
 * duplicated or overwritten here.
 *
 * Doubles-only in practice: `liveMeta` is always {} for Singles (see
 * wcFetchLiveTierStats's own comment on why -- Limitless has no official
 * Singles tournament format to draw from), so this is a real no-op for
 * Singles calls, not a bug.
 */
function wcAugmentThreatsWithLiveMeta(threats, liveMeta, allPokemonByName) {
  if (!liveMeta) return threats;
  const existingNames = new Set(threats.map((t) => t.name));
  const additions = [];
  Object.keys(liveMeta).forEach((name) => {
    if (existingNames.has(name)) return;
    const stat = liveMeta[name];
    if (!stat || stat.timesUsed < WC_META_USAGE_MIN_SAMPLE) return;
    if (stat.winRate == null || stat.winRate < 55) return; // only genuinely-scary real opponents, not a coin flip -- same bar as wcAugmentThreatsWithMetaUsage
    const pokemon = allPokemonByName && allPokemonByName[name];
    if (!pokemon) return;
    additions.push({
      name,
      role: `Live tournament threat — won ${stat.winRate}% of the time across ${stat.timesUsed} real Regulation M-B entries`,
      types: pokemon.types,
    });
  });
  return additions.length ? [...threats, ...additions] : threats;
}

/**
 * Simulated Win Rate feature: the curated-data counterpart to
 * wcAugmentThreatsWithMetaUsage/wcAugmentThreatsWithLiveMeta above -- adds
 * any data/meta-baseline.json reference-team member (Worlds 2026 rosters +
 * WinCon's own archetype recombinations) not already in the curated/real-
 * data threat list, so Auto-build's defensive scoring has a real Worlds-
 * grounded floor even with ZERO logged battles AND zero live tournament
 * data on this site yet -- the "ground floor... base of global
 * information" Phoenix asked for. Called last of the three trust tiers
 * (see wcAugmentThreatsWithLiveMeta's own comment for the full three-deep
 * order) -- real logged data and real live tournament data both always
 * win when either exists, since both run first and this one skips any
 * name already present.
 */
function wcAugmentThreatsWithMetaBaseline(threats, metaBaseline, format, allPokemonByName) {
  const referenceTeams = (metaBaseline && metaBaseline[format]) || [];
  if (referenceTeams.length === 0) return threats;
  const existingNames = new Set(threats.map((t) => t.name));
  const appearanceCount = {};
  referenceTeams.forEach((team) => {
    (team.members || []).forEach((m) => {
      appearanceCount[m.name] = (appearanceCount[m.name] || 0) + 1;
    });
  });
  const additions = [];
  Object.keys(appearanceCount).forEach((name) => {
    if (existingNames.has(name)) return;
    if (appearanceCount[name] < 2) return; // only names repeated across 2+ reference teams, not a one-off
    const pokemon = allPokemonByName && allPokemonByName[name];
    if (!pokemon) return;
    additions.push({
      name,
      role: `Meta-baseline threat — appears on ${appearanceCount[name]} Worlds-2026-grounded reference teams`,
      types: pokemon.types,
    });
  });
  return additions.length ? [...threats, ...additions] : threats;
}

/**
 * Species Dream Team must never pick, parsed straight out of the team
 * notes text (e.g. "no Gholdengo", "don't want Absol") -- checked only
 * against Pokemon actually in the eligible pool, and only ever an exact
 * name match against something the player typed. This never guesses at
 * a Pokemon the player didn't name. The "don't/not/never include"/"remove"/
 * "keep out" phrasings exist specifically so a negated WINCON_INCLUDE_TRIGGERS
 * phrase (e.g. "don't include Tinkaton") reads as an exclusion rather than
 * an inclusion -- see wcNotesMentionedSpecies below, whose result always
 * gets filtered against this list so exclusion wins on a conflict.
 */
const WINCON_EXCLUDE_TRIGGERS = [
  "no ", "not ", "don't want ", "dont want ", "exclude ", "without ", "skip ", "leave out ", "hate ", "avoid ",
  "don't include ", "dont include ", "not include ", "never include ", "remove ", "keep out ",
];

function wcNotesExcludedSpecies(notes, pool) {
  const text = (notes || "").toLowerCase();
  const excluded = [];
  if (!text.trim()) return excluded;
  pool.forEach((candidate) => {
    const lowerName = candidate.name.toLowerCase();
    if (WINCON_EXCLUDE_TRIGGERS.some((trigger) => text.includes(trigger + lowerName))) {
      excluded.push(candidate.name);
    }
  });
  return excluded;
}

/**
 * Milestone 19: the flip side of exclusion -- phrases that mean "this
 * Pokemon MUST be on the team", parsed the same pragmatic, exact-name-only
 * way as WINCON_EXCLUDE_TRIGGERS above. Unlike exclusion (checked as
 * trigger-immediately-followed-by-name), inclusion is checked against a
 * whole "clause" -- everything from right after the trigger phrase up to
 * the next sentence-ending punctuation -- so a single phrase like "built
 * around Greninja and Feraligatr" pulls in every name mentioned in that
 * clause, not just whichever one happens to sit directly next to the
 * trigger word.
 */
const WINCON_INCLUDE_TRIGGERS = [
  "built around ", "build around ", "based around ", "centered around ", "centred around ", "centered on ", "centred on ",
  "must include ", "must have ", "always include ", "include ", "including ", "featuring ",
];

/**
 * Names (from `namesList`) mentioned inside an inclusion clause of
 * free-text `notes` -- see WINCON_INCLUDE_TRIGGERS above. Longer names are
 * matched first and their matched span blanked out before shorter names
 * are checked, so a single mention of a two-word regional/form name (e.g.
 * "Alolan Ninetales") can't also spuriously match the shorter base name
 * ("Ninetales") sitting inside it. Exact substring match only, same
 * "never guesses at a Pokemon the player didn't name" contract as
 * wcNotesExcludedSpecies -- callers that care about exclusion beating
 * inclusion on a conflict (wcPickDreamTeam does) are responsible for
 * filtering the result against wcNotesExcludedSpecies themselves.
 */
function wcNotesMentionedSpecies(notes, namesList) {
  const text = (notes || "").toLowerCase();
  const mentioned = [];
  if (!text.trim()) return mentioned;
  const sortedNames = [...namesList].sort((a, b) => b.length - a.length);
  WINCON_INCLUDE_TRIGGERS.forEach((trigger) => {
    let searchFrom = 0;
    let idx;
    while ((idx = text.indexOf(trigger, searchFrom)) !== -1) {
      const clauseStart = idx + trigger.length;
      const rest = text.slice(clauseStart);
      const stop = rest.search(/[.!?\n]/);
      let clause = stop === -1 ? rest : rest.slice(0, stop);
      sortedNames.forEach((name) => {
        const lowerName = name.toLowerCase();
        const pos = clause.indexOf(lowerName);
        if (pos !== -1 && !mentioned.includes(name)) {
          mentioned.push(name);
          clause = clause.slice(0, pos) + " ".repeat(lowerName.length) + clause.slice(pos + lowerName.length);
        }
      });
      searchFrom = idx + trigger.length;
    }
  });
  return mentioned;
}

function wcNotesIncludedSpecies(notes, pool) {
  return wcNotesMentionedSpecies(notes, pool.map((c) => c.name));
}

/**
 * `alreadySelectedNames` (Milestone 19): whatever's already picked in the
 * builder's own slots when Generate Dream Team is clicked, kept on the
 * team instead of the whole team being replaced -- the rest is still
 * picked/built fresh around it. Combined with notesIncludedNames (species
 * named in the team notes, e.g. "built around Greninja and Feraligatr")
 * into one forced list, already-selected first, both subject to
 * excludedNames winning on a conflict and both capped to `size` (anything
 * past that comes back as droppedForcedNames so the caller can explain
 * why it didn't all fit).
 */
/**
 * Milestone 21: `natures`/`movesData`/`abilitiesData` unlock the
 * threat-specific coverage scoring and weather-archetype awareness in
 * wcDreamTeamCandidateScore above (see that function and
 * wcCandidateCoverageGain/wcDetectWeatherArchetype for the reasoning) --
 * optional so an un-migrated caller still gets a working, if less sharp,
 * pick using the old flat-average fallback rather than an error.
 *
 * Milestone 28: `metaUsage` (optional, trailing so every existing call
 * site keeps working untouched) is the same real, cross-user usage
 * lookup `threats` may already have been augmented with (see
 * wcAugmentThreatsWithMetaUsage) -- passed through into scoreOpts so
 * wcDreamTeamCandidateScore's own win-rate nudge applies too.
 *
 * Simulated Win Rate feature: `metaBaseline`/`format` (both optional,
 * also trailing) are data/meta-baseline.json's parsed contents and this
 * pool's format ("singles"/"doubles") -- passed through the same way, so
 * wcMetaBaselineArchetypeBonus applies alongside the real-usage nudge.
 */
function wcPickDreamTeam(pool, threats, typeChart, size, notes, alreadySelectedNames, natures, movesData, abilitiesData, metaUsage, metaBaseline, format, liveMeta, liveMetaBuilds) {
  const allTypes = typeChart.types;
  const excludedNames = wcNotesExcludedSpecies(notes, pool);
  const usablePool = excludedNames.length ? pool.filter((c) => !excludedNames.includes(c.name)) : pool;

  const notesIncludedNames = wcNotesIncludedSpecies(notes, usablePool);
  const keepSelectedNames = (alreadySelectedNames || []).filter(
    (name) => usablePool.some((c) => c.name === name) && !notesIncludedNames.includes(name)
  );
  const forcedOrder = [...keepSelectedNames, ...notesIncludedNames];
  const forcedNames = forcedOrder.slice(0, size);
  const droppedForcedNames = forcedOrder.slice(size);
  const forcedSource = new Map();
  keepSelectedNames.forEach((name) => forcedSource.set(name, "selected"));
  notesIncludedNames.forEach((name) => {
    if (!forcedSource.has(name)) forcedSource.set(name, "notes");
  });

  const canScoreCoverage = Boolean(natures && movesData);
  const weatherInfo = canScoreCoverage ? wcDetectWeatherArchetype(threats, abilitiesData) : null;
  const scoreOpts = { natures, movesData, abilitiesData, weatherInfo, metaUsage, metaBaseline, format, liveMeta, notes };

  const remaining = [...usablePool];
  const team = [];
  const reasoning = [];

  forcedNames.forEach((name) => {
    const idx = remaining.findIndex((c) => c.name === name);
    if (idx === -1) return;
    const member = remaining[idx];
    const archetypeNote = wcArchetypeSynergyReasoningNote(member, team, format || "doubles", abilitiesData);
    team.push(member);
    remaining.splice(idx, 1);
    reasoning.push(
      (forcedSource.get(name) === "selected"
        ? `${name} — already picked on this team, so Dream Team kept it and built the rest around it.`
        : `${name} — included because you named it in your team notes.`) +
        wcMetaUsageReasoningNote(name, metaUsage) +
        wcLiveMetaReasoningNote(name, liveMeta) +
        wcMetaBaselineReasoningNote(name, metaBaseline, format || "doubles") +
        archetypeNote
    );
  });

  const bestFromRemaining = (filterFn) => {
    let best = null;
    let bestScore = -Infinity;
    remaining.forEach((candidate) => {
      if (filterFn && !filterFn(candidate)) return;
      const score = wcDreamTeamCandidateScore(candidate, team, threats, typeChart, allTypes, scoreOpts);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    });
    return best;
  };

  /**
   * Milestone 21: describes a pick by the SPECIFIC threats it newly
   * answers (via wcCoverageWinsFor) rather than a generic "balances
   * matchup strength, type coverage, and raw stats" line, whenever the
   * coverage-aware scoring is active and it actually flipped something --
   * this is the same per-threat reasoning the score itself is now based
   * on, made visible rather than left implicit.
   */
  const describePick = (candidate, isFirst) => {
    if (canScoreCoverage) {
      const coverageState = wcThreatCoverageState(team, threats, natures, typeChart, movesData);
      const wins = wcCoverageWinsFor(candidate, coverageState, natures, typeChart, movesData);
      if (wins.length > 0 && wins.length <= 3) {
        // Bug report (Phoenix): this used to omit the word "threats"
        // entirely -- "Corviknight -- specifically answers Grimmsnarl,
        // Archaludon, which nothing else on this team beats yet" reads
        // exactly like a suggestion to go add Grimmsnarl/Archaludon to
        // the roster too, when wins here are OPPONENT reference Pokemon
        // (real, currently-scary meta threats, via wcAugmentThreatsWith*)
        // this pick counters -- never a recommendation to obtain them.
        // Leading with "these threats" up front removes the ambiguity,
        // matching the >3 branch just below, which already said it.
        return `${candidate.name} — specifically answers these threats nothing else on this team beats yet: ${wins.join(", ")}.`;
      }
      if (wins.length > 3) {
        return `${candidate.name} — specifically answers ${wins.length} threats nothing else on this team beats yet, including ${wins.slice(0, 2).join(", ")}.`;
      }
    }
    return isFirst
      ? `${candidate.name} — the strongest starting point: the best overall matchup against the threat list.`
      : `${candidate.name} — the best remaining fit alongside ${team.map((m) => m.name).join(", ")}, balancing matchup strength, type coverage, and raw stats.`;
  };

  // Milestone 12: guarantee at least one Mega-capable pick — two, when
  // two genuinely fit — before the ordinary greedy loop runs, so the
  // finished team always has a real Mega option to build around rather
  // than however the type-coverage-driven picks happened to land. Two
  // matters specifically because Champions (like real VGC) only lets you
  // actually Mega Evolve one Pokémon per battle even if several hold
  // their own stone — so two Mega-capable teammates means a genuine
  // matchup-by-matchup choice of which one to bring out as this game's
  // Mega, not just a single fixed answer every game.
  // Milestone 19: a forced pick (already-selected or notes-included) can
  // itself be Mega-capable, so this now counts those in already, both to
  // avoid guaranteeing MORE than two total and to never try to guarantee
  // past however many slots the forced picks left open.
  // Milestone 21: which TWO Mega-capable picks win this guaranteed spot
  // now also depends on the coverage-aware score above -- so a rival (or
  // Dream Team) doesn't always reach for the same one or two "generically
  // best" Mega options regardless of what they're actually up against.
  const megaAlreadyOnTeam = team.filter((c) => wcHasKnownMegaOption(c, liveMetaBuilds)).length;
  const eligibleInPool = remaining.filter((c) => wcHasKnownMegaOption(c, liveMetaBuilds));
  const guaranteedMegaCount = Math.max(0, Math.min(2 - megaAlreadyOnTeam, eligibleInPool.length, size - team.length));
  for (let g = 0; g < guaranteedMegaCount; g++) {
    const best = bestFromRemaining((c) => wcHasKnownMegaOption(c, liveMetaBuilds));
    if (!best) break;
    const archetypeNote = wcArchetypeSynergyReasoningNote(best, team, format || "doubles", abilitiesData);
    team.push(best);
    remaining.splice(remaining.indexOf(best), 1);
    reasoning.push(
      `${best.name} — guaranteed a spot here specifically because it has a real, tournament-informed Mega build (see the "Meta-informed auto-build" note in README.md): this team should always have ${megaAlreadyOnTeam + guaranteedMegaCount >= 2 ? "a Mega option, and with a second one here, an actual choice of which to bring depending on the matchup" : "at least one real Mega option to build around"}.` +
        wcMetaUsageReasoningNote(best.name, metaUsage) +
        wcLiveMetaReasoningNote(best.name, liveMeta) +
        wcMetaBaselineReasoningNote(best.name, metaBaseline, format || "doubles") +
        archetypeNote
    );
  }

  for (let i = team.length; i < size && remaining.length > 0; i++) {
    const best = bestFromRemaining();
    if (!best) break;
    const reasonText =
      describePick(best, i === 0) +
      wcMetaUsageReasoningNote(best.name, metaUsage) +
      wcLiveMetaReasoningNote(best.name, liveMeta) +
      wcMetaBaselineReasoningNote(best.name, metaBaseline, format || "doubles") +
      wcArchetypeSynergyReasoningNote(best, team, format || "doubles", abilitiesData);
    team.push(best);
    remaining.splice(remaining.indexOf(best), 1);
    reasoning.push(reasonText);
  }

  // Milestone 21: name-check the weather archetype in the same reasoning
  // list, if wcDetectWeatherArchetype found one and the finished team
  // actually leans on it -- "grass and sunny day beat a rain team," made
  // explicit rather than left as an invisible scoring nudge.
  if (weatherInfo) {
    const weatherLabel = { rain: "rain", sun: "harsh sunlight", sand: "sandstorm", snow: "snow" }[weatherInfo.weather];
    const setterNote = weatherInfo.setters.length ? ` (via ${weatherInfo.setters.join(", ")})` : "";
    const contributors = team
      .map((m) => ({ name: m.name, bonus: wcWeatherCounterBonus(m, weatherInfo, typeChart, abilitiesData) }))
      .filter((c) => c.bonus > 0)
      .sort((a, b) => b.bonus - a.bonus);
    if (contributors.length > 0) {
      const names = contributors.slice(0, 3).map((c) => c.name).join(", ");
      reasoning.push(
        `This team also specifically answers the opponent's ${weatherLabel}${setterNote}: ${names} resist it or can shut it off outright, not just happen to have decent types.`
      );
    }
  }

  const finalMegaCount = team.filter((c) => wcHasKnownMegaOption(c, liveMetaBuilds)).length;
  const megaNote =
    finalMegaCount >= 2
      ? `This team includes two Mega-capable picks — you can choose which one to actually Mega Evolve depending on the matchup, rather than being locked into one every game.`
      : finalMegaCount === 1
        ? `This team includes one Mega-capable pick — the only currently-obtained option with a real, tournament-informed Mega build (the others don't have confirmed data yet — see README.md).`
        : `None of your currently obtained, eligible Pokémon have a real, tournament-informed Mega build yet — either hand-curated or confirmed by real Regulation M-B tournament results (see README.md) — so this team has no guaranteed Mega option this time.`;

  return {
    chosen: team.map((m) => m.name),
    reasoning,
    megaNote,
    excludedNames,
    notesIncludedNames,
    keepSelectedNames,
    droppedForcedNames,
    weatherInfo,
  };
}
