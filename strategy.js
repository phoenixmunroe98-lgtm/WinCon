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
const WINCON_DOUBLES_FAVORED_MOVES = new Set(["Wide Guard", "Quick Guard", "Tailwind", "Trick Room"]);

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

function wcPickNature(primaryOffenseKey, role) {
  if (role === "fast") {
    return primaryOffenseKey === "attack" ? "Jolly" : "Timid";
  }
  return primaryOffenseKey === "attack" ? "Adamant" : "Modest";
}

function wcPickSP(primaryOffenseKey, role, baseStats) {
  const sp = { hp: 2, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 };
  sp[primaryOffenseKey] = 32;
  if (role === "fast") {
    sp.speed = 32;
  } else {
    // Shore up whichever defensive stat is naturally weaker.
    const weakerDefense = baseStats.def <= baseStats.spd ? "defense" : "sp_defense";
    sp[weakerDefense] = 32;
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
 * each other, late Aug 2026). This is a deliberately short, high-confidence
 * list, not an attempt to hand-author a "real" set for all 296 Pokémon —
 * everything not listed here still goes through the general-purpose
 * heuristic above. `moves` are used as forced picks (same mechanism
 * wcProposeSetterAmendment already uses for strategy moves) and `item`, if
 * present, is preferred over the generic role/format pools as long as no
 * earlier teammate already holds it (Item Clause still applies). A Mega
 * Pokémon's own stone (see WINCON_MEGA_STONES) always wins over any `item`
 * here, since it isn't optional for them the way a regular item choice is.
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
    note: "the standout of the current Reg M-B meta — appears on nearly every top tournament team as a Dark-type cleanup sweeper",
  },
  Whimsicott: {
    moves: ["Tailwind", "Moonblast", "Encore", "Protect"],
    item: "Focus Sash",
    note: "the meta's most common Tailwind setter — Prankster guarantees the priority even against faster threats",
  },
  Farigiraf: {
    // One source's 3rd move was Thunderbolt instead of Helping Hand — both
    // are real, commonly-seen options behind Trick Room/Protect; Helping
    // Hand was picked as the more team-oriented (and higher-usage) pick.
    moves: ["Trick Room", "Psyshock", "Helping Hand", "Protect"],
    item: "Sitrus Berry",
    note: "a common Trick Room setter that also blocks priority moves and boosts a teammate's hit with Helping Hand",
  },
  Garchomp: {
    moves: ["Dragon Claw", "Earthquake", "Rock Slide", "Protect"],
    item: "Life Orb",
    note: "one of the meta's most-used Pokémon, usually as a fast dual-STAB physical attacker",
  },
  Basculegion: {
    moves: ["Last Respects", "Aqua Jet", "Wave Crash", "Protect"],
    item: "Choice Scarf",
    note: "a fast Adaptability attacker whose Last Respects snowballs as teammates faint",
  },
  Sylveon: {
    moves: ["Hyper Voice", "Quick Attack", "Protect", "Hyper Beam"],
    item: "Fairy Feather",
    note: "Pixilate turns its Normal-type moves into boosted Fairy-type damage, including priority Quick Attack",
  },
  Grimmsnarl: {
    moves: ["Light Screen", "Reflect", "Parting Shot", "Spirit Break"],
    item: "Light Clay",
    note: "the meta's main screens setter — Prankster guarantees Light Screen/Reflect go up before the opponent can punish it",
  },
  "Mega Charizard Y": {
    moves: ["Heat Wave", "Solar Beam", "Protect", "Weather Ball"],
    note: "Drought triggers sun the instant it Mega Evolves, boosting its own Fire/Grass coverage all by itself",
  },
  "Mega Floette": {
    moves: ["Dazzling Gleam", "Moonblast", "Calm Mind", "Protect"],
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
    note: "Contrary turns Close Combat's own Defense/Sp. Def drop into a boost instead, so it gets bulkier the more it attacks, backed up by Brave Bird for coverage and Roost to stay healthy",
  },
};

/**
 * Real tournament cores (2+ Pokémon that repeatedly show up together on
 * winning teams) — used to add a "matches a real synergy" note to the
 * strategy analysis when your team overlaps one, on top of (not instead of)
 * the mechanical archetype check below. Sourced the same way as
 * WINCON_META_KNOWN_SETS above.
 */
const WINCON_META_CORES = [
  {
    pokemon: ["Kingambit", "Whimsicott", "Basculegion", "Garchomp"],
    note: "Whimsicott's Tailwind and Basculegion's speed clear the way for Garchomp and Kingambit to attack freely — one of the most repeated cores across recent top-performing tournament teams.",
  },
  {
    pokemon: ["Mega Charizard Y", "Garchomp"],
    note: "one of the single most common two-Pokémon pairings in the current meta — Charizard's sun and Garchomp's Ground/Dragon coverage answer different halves of the field.",
  },
  {
    pokemon: ["Mega Charizard Y", "Mega Floette"],
    note: "a Fire/Fairy pairing seen on several recent winning teams — Floette's Fairy Aura and Charizard's sun each boost the other's coverage moves without stepping on each other's turf.",
  },
];

/** How many of `members` appear in each known meta core, returns the best-overlapping core (2+ shared members) with its note, or null if nothing matches well enough to be worth mentioning. */
function wcMetaSynergyNote(members) {
  const names = new Set(members.map((m) => m.name));
  let best = null;
  WINCON_META_CORES.forEach((core) => {
    const matched = core.pokemon.filter((p) => names.has(p));
    if (matched.length >= 2 && (!best || matched.length > best.matched.length)) {
      best = { matched, core };
    }
  });
  if (!best) return null;
  return {
    matchedPokemon: best.matched,
    note: `${best.matched.join(" + ")} on this team ${best.matched.length > 1 ? "match" : "matches"} a core seen in real Reg M-B tournament results: ${best.core.note}`,
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
function wcScoreMove(move, pokemonTypes, primaryCategory, threats, typeChart, format, ability, sheetMode) {
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
function wcPickMoves(pokemon, learnableNames, movesData, primaryCategory, threats, typeChart, forcedMoves, format, ability, sheetMode) {
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
    .map((m) => ({ move: m, score: wcScoreMove(m, pokemon.types, primaryCategory, threats, typeChart, format, ability, sheetMode) }));

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
function wcPickAutoMegaForm(megaForms, used) {
  if (!Array.isArray(megaForms)) return null;
  return (
    megaForms.find(
      (m) => WINCON_MEGA_STONES[m.name] && WINCON_META_KNOWN_SETS[m.name] && !used.has(WINCON_MEGA_STONES[m.name])
    ) || null
  );
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
    const autoMega = wcPickAutoMegaForm(opts.megaForms, used);
    if (autoMega) {
      effectivePokemon = autoMega;
      effectiveBaseStats = autoMega.baseStats;
      forcedStoneItem = WINCON_MEGA_STONES[autoMega.name];
    }
  }

  const primaryKey = wcPickPrimaryOffense(effectiveBaseStats);
  const role = opts.forceRole || wcPickRole(effectiveBaseStats);
  const nature = wcPickNature(primaryKey, role);
  const sp = wcPickSP(primaryKey, role, effectiveBaseStats);
  const primaryCategory = primaryKey === "attack" ? "Physical" : "Special";

  // Milestone 13: this Pokémon's own real ability (data/abilities.json),
  // looked up by its EFFECTIVE (Mega-aware) name — feeds wcPickMoves below
  // so a weather-setter/type-converter/Contrary's move picks actually
  // reflect what its own ability does, not just its base stats/typing.
  const ability = wcAbilityOf(opts.abilitiesData, effectivePokemon.name);

  const metaSet = WINCON_META_KNOWN_SETS[effectivePokemon.name];
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
  const forcedMoves = [...(opts.forcedMoves || []), ...((metaSet && metaSet.moves) || [])];
  // Milestone 14: opts.sheetMode ("open" | "closed") — under Open Team
  // Sheet, wcPickMoves' own filler picks (never the forced ones above,
  // which are already meta staples regardless) lean away from pure
  // surprise coverage — see wcScoreMove's sheetMode handling.
  const moves = wcPickMoves(effectivePokemon, learnableNames, movesData, primaryCategory, threats, typeChart, forcedMoves, format, ability, opts.sheetMode);
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
 */
function wcGenerateTeamBuilds(members, movesData, threats, typeChart, format, abilitiesData, sheetMode) {
  const fmt = wcNormalizeFormat(format);
  const builds = {};
  // Shared across every member below so wcPickItem never hands out the
  // same item twice for this team — see the Item Clause note above it.
  const usedItems = new Set();
  members.forEach((m) => {
    builds[m.name] = wcGenerateBuild(m, m.baseStats, m.learnableNames, movesData, threats, typeChart, {
      format: fmt,
      usedItems,
      megaForms: m.megaForms,
      abilitiesData,
      sheetMode,
    });
  });
  return { builds };
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
    const newNature = wcPickNature(primaryKey, wantRole);
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
 * WINCON_META_CORES) — always computed and returned alongside whichever
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
function wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, format, notes, abilitiesData) {
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

  const biasedCandidates = wcApplyNotesBias(candidates, notes);

  if (biasedCandidates.length === 0) {
    return {
      archetype: "balanced",
      setterName: null,
      note:
        candidates.length > 0
          ? `Your team notes ruled out every strategy that would otherwise fit here — playing as six independent attackers is the fallback while that's the case.`
          : `Your team's built roles are split (${fastMembers.length} fast / ${bulkyMembers.length} bulky), and no learnable Trick Room, Tailwind, weather, or ${fmt === "doubles" ? "redirection" : "hazard"}-setting ` +
            `move would clearly help more of the team than it'd cost — no single shared strategy stands out here, so playing as six independent attackers is the safer call.`,
      amendments: [],
      metaSynergy: wcMetaSynergyNote(members),
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
    metaSynergy: wcMetaSynergyNote(members),
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
/** A base species is "Mega-eligible" for this purpose only when auto-build would actually opt it into a real (not guessed) Mega set — see wcPickAutoMegaForm/WINCON_META_KNOWN_SETS. Same honesty bar as everywhere else in Milestone 10/11: this can't call every base species with a Mega form "Mega-eligible," since guessing a build for the ~60 with no real data behind them isn't something this project does. */
function wcHasKnownMegaOption(candidate) {
  return Array.isArray(candidate.megaForms) && candidate.megaForms.some((m) => WINCON_MEGA_STONES[m.name] && WINCON_META_KNOWN_SETS[m.name]);
}

function wcDreamTeamCandidateScore(candidate, teamTypesList, threats, typeChart, allTypes) {
  const offense = wcTeamOffenseScore(candidate.types, threats, typeChart);
  const defense = wcTeamDefenseScore(candidate.types, threats, typeChart);
  const coverage = wcDefenseCoverageBonus(candidate.types, teamTypesList, allTypes, typeChart);
  const dup = wcSameTypingPenalty(candidate.types, teamTypesList);
  const bst = wcBaseStatTotal(candidate.baseStats);
  return offense * 2 + defense * 1.5 + coverage * 1 + (bst / 600) * 0.5 - dup * 1.5;
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
function wcPickDreamTeam(pool, threats, typeChart, size, notes, alreadySelectedNames) {
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

  const remaining = [...usablePool];
  const team = [];
  const reasoning = [];

  forcedNames.forEach((name) => {
    const idx = remaining.findIndex((c) => c.name === name);
    if (idx === -1) return;
    const member = remaining[idx];
    team.push(member);
    remaining.splice(idx, 1);
    reasoning.push(
      forcedSource.get(name) === "selected"
        ? `${name} — already picked on this team, so Dream Team kept it and built the rest around it.`
        : `${name} — included because you named it in your team notes.`
    );
  });

  const bestFromRemaining = () => {
    const teamTypesList = team.map((m) => m.types);
    let best = null;
    let bestScore = -Infinity;
    remaining.forEach((candidate) => {
      const score = wcDreamTeamCandidateScore(candidate, teamTypesList, threats, typeChart, allTypes);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    });
    return best;
  };

  const bestMegaEligibleFromRemaining = () => {
    const teamTypesList = team.map((m) => m.types);
    let best = null;
    let bestScore = -Infinity;
    remaining.forEach((candidate) => {
      if (!wcHasKnownMegaOption(candidate)) return;
      const score = wcDreamTeamCandidateScore(candidate, teamTypesList, threats, typeChart, allTypes);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    });
    return best;
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
  const megaAlreadyOnTeam = team.filter(wcHasKnownMegaOption).length;
  const eligibleInPool = remaining.filter(wcHasKnownMegaOption);
  const guaranteedMegaCount = Math.max(0, Math.min(2 - megaAlreadyOnTeam, eligibleInPool.length, size - team.length));
  for (let g = 0; g < guaranteedMegaCount; g++) {
    const best = bestMegaEligibleFromRemaining();
    if (!best) break;
    team.push(best);
    remaining.splice(remaining.indexOf(best), 1);
    reasoning.push(
      `${best.name} — guaranteed a spot here specifically because it has a real, tournament-informed Mega build (see the "Meta-informed auto-build" note in README.md): this team should always have ${megaAlreadyOnTeam + guaranteedMegaCount >= 2 ? "a Mega option, and with a second one here, an actual choice of which to bring depending on the matchup" : "at least one real Mega option to build around"}.`
    );
  }

  for (let i = team.length; i < size && remaining.length > 0; i++) {
    const best = bestFromRemaining();
    if (!best) break;
    team.push(best);
    remaining.splice(remaining.indexOf(best), 1);

    reasoning.push(
      i === 0
        ? `${best.name} — the strongest starting point: the best average matchup against the reference threat list.`
        : `${best.name} — the best remaining fit alongside ${team.slice(0, -1).map((m) => m.name).join(", ")}, balancing matchup strength, type coverage, and raw stats.`
    );
  }

  const finalMegaCount = team.filter(wcHasKnownMegaOption).length;
  const megaNote =
    finalMegaCount >= 2
      ? `This team includes two Mega-capable picks — you can choose which one to actually Mega Evolve depending on the matchup, rather than being locked into one every game.`
      : finalMegaCount === 1
        ? `This team includes one Mega-capable pick — the only currently-obtained option with a real, tournament-informed Mega build (the others don't have confirmed data yet — see README.md).`
        : `None of your currently obtained, eligible Pokémon have a real, tournament-informed Mega build yet (only Mega Charizard Y, Mega Floette, and Mega Staraptor do right now), so this team has no guaranteed Mega option this time.`;

  return {
    chosen: team.map((m) => m.name),
    reasoning,
    megaNote,
    excludedNames,
    notesIncludedNames,
    keepSelectedNames,
    droppedForcedNames,
  };
}
