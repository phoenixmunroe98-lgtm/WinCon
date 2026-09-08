// WinCon — tools/test-team-style-archetypes.mjs (Milestone 51)
//
// Regression test for the six macro Team Style archetypes Phoenix named
// (Balance, Weather, Hyper Offense, Tailwind, Trick Room, and a fast/slow
// hybrid she called "Tail room", built here as "Dual Room"). This is a
// deliberately SEPARATE layer from the existing WINCON_STRATEGY_MOVES/
// wcArchetypeSignalsFor system, which only ever detects one TACTICAL TOOL
// at a time (does anyone know Trick Room) -- wcClassifyTeamStyle instead
// looks at the team's overall SHAPE. Every fixture below uses real species
// straight from data/base-stats.json/data/abilities.json/data/learnsets.json
// (independently verified before writing these assertions, values quoted
// in each check's own comment), not synthetic numbers.
//
// Run: node tools/test-team-style-archetypes.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

const SCRIPT_FILES = ["type-utils.js", "stats.js", "megas.js", "strategy.js"];
const context = vm.createContext({ console });
SCRIPT_FILES.forEach((file) => {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  vm.runInContext(code, context, { filename: file });
});

const baseStatsData = loadJSON("data/base-stats.json");
const abilitiesData = loadJSON("data/abilities.json");
const learnsets = loadJSON("data/learnsets.json");
const pokemonList = loadJSON("data/pokemon.json");

let checksRun = 0;
function check(description, fn) {
  fn();
  checksRun += 1;
  console.log(`OK  ${description}`);
}

// Builds a member object in the same shape wcClassifyTeamStyle/
// wcArchetypeSignalsFor already expect (name/baseStats/types/learnableNames),
// pulled straight from the real data files -- no hand-typed stat blocks.
function member(name) {
  const baseStats = baseStatsData.find((b) => b.name === name);
  const pokemon = pokemonList.find((p) => p.name === name);
  const learnableNames = learnsets[name] || [];
  if (!baseStats) throw new Error(`no base-stats entry for ${name}`);
  return { name, baseStats, types: pokemon ? pokemon.types : [], learnableNames };
}

// ---------------------------------------------------------------------------
// 1. Dual Room -- both a real Tailwind setter and a real Trick Room setter
// present is rare and deliberate on its own; checked first in precedence,
// no payoff-count gate needed.
// ---------------------------------------------------------------------------

check("Dual Room: a real Trick Room setter (Slowbro) plus a real Tailwind setter (Pidgeot) triggers dualroom, the highest-precedence style", () => {
  const team = [member("Slowbro"), member("Pidgeot")];
  const result = JSON.parse(JSON.stringify(context.wcClassifyTeamStyle(team, abilitiesData)));
  assert.ok(result, "expected a real team style, got null");
  assert.equal(result.style, "dualroom");
});

// ---------------------------------------------------------------------------
// 2. Weather -- a real setting ABILITY (Ninetales: Drought) plus a real,
// different teammate that genuinely benefits (Charizard: Solar Power, a
// real sun-benefit ability, confirmed in data/abilities.json).
// ---------------------------------------------------------------------------

check("Weather: Ninetales' real Drought plus Charizard's real Solar Power (a genuine sun-benefit ability, not the setter itself) triggers weather", () => {
  const team = [member("Ninetales"), member("Charizard")];
  const result = JSON.parse(JSON.stringify(context.wcClassifyTeamStyle(team, abilitiesData)));
  assert.ok(result, "expected a real team style, got null");
  assert.equal(result.style, "weather");
  assert.equal(result.weather, "sun");
});

check("Weather: a setter with no real abuser on the team does NOT trigger weather (an ability alone isn't a coherent weather core)", () => {
  const team = [member("Ninetales"), member("Tauros")]; // Tauros: Intimidate, no sun benefit, no boosted/bulk type match
  const result = context.wcClassifyTeamStyle(team, abilitiesData);
  assert.notEqual(result && JSON.parse(JSON.stringify(result)).style, "weather");
});

// ---------------------------------------------------------------------------
// 3. Trick Room -- a real setter (Slowbro) AND >=2 real Trick-Room-payoff
// members (Machamp atk130/spe55, Snorlax atk110/spe30 -- both hard hitters
// genuinely slower than the real 70 Speed threshold).
// ---------------------------------------------------------------------------

check("Trick Room: a real setter plus 2 real slow hard-hitters triggers trickroom, naming the real payoff members", () => {
  const team = [member("Slowbro"), member("Machamp"), member("Snorlax")];
  const result = JSON.parse(JSON.stringify(context.wcClassifyTeamStyle(team, abilitiesData)));
  assert.ok(result, "expected a real team style, got null");
  assert.equal(result.style, "trickroom");
  assert.ok(result.note.includes("Machamp") && result.note.includes("Snorlax"), "note should name the real payoff members");
});

check("Trick Room: real Trick-Room-LEARNING attackers that are themselves genuinely fast (Alakazam spe=120, Gengar spe=110) do NOT count as payoff and do NOT trigger trickroom", () => {
  // Both Alakazam and Gengar can genuinely learn Trick Room, but neither is
  // a real trickroom-payoff member (payoff requires spe<70) -- confirms the
  // classifier isn't fooled by a fast attacker that merely knows the move.
  const team = [member("Alakazam"), member("Gengar"), member("Jolteon")];
  const result = context.wcClassifyTeamStyle(team, abilitiesData);
  assert.notEqual(result && JSON.parse(JSON.stringify(result)).style, "trickroom");
});

// ---------------------------------------------------------------------------
// 4. Tailwind -- a real setter (Pidgeot) AND >=2 real Tailwind-payoff
// members (Snorlax, Machamp -- hard hitters genuinely too slow, <90, to
// reliably move first without the speed double).
// ---------------------------------------------------------------------------

check("Tailwind: a real setter plus 2 real hard-hitters that are too slow on their own triggers tailwind", () => {
  const team = [member("Pidgeot"), member("Snorlax"), member("Machamp")];
  const result = JSON.parse(JSON.stringify(context.wcClassifyTeamStyle(team, abilitiesData)));
  assert.ok(result, "expected a real team style, got null");
  assert.equal(result.style, "tailwind");
});

// ---------------------------------------------------------------------------
// 5. Hyper Offense -- zero genuine walls AND at least 2/3 of the team are
// real glass-cannon sweepers (Alakazam, Gengar, Jolteon -- all hard
// hitters, all genuinely fast (spe>=100), all genuinely fragile bulk<6150).
// ---------------------------------------------------------------------------

check("Hyper Offense: 3 real fast, hard-hitting, fragile sweepers with zero genuine walls triggers hyperoffense", () => {
  const team = [member("Alakazam"), member("Gengar"), member("Jolteon")];
  const result = JSON.parse(JSON.stringify(context.wcClassifyTeamStyle(team, abilitiesData)));
  assert.ok(result, "expected a real team style, got null");
  assert.equal(result.style, "hyperoffense");
  assert.ok(result.note.includes("Alakazam") && result.note.includes("Gengar") && result.note.includes("Jolteon"));
});

// ---------------------------------------------------------------------------
// 6. Balance -- a real genuine wall (Blastoise, bulk=7900) alongside >=2
// real hard hitters (Charizard, Tauros) with no sharper style claiming it.
// ---------------------------------------------------------------------------

check("Balance: a real wall plus 2 real hard hitters, with no Tailwind/Trick Room/weather setter present, triggers balance", () => {
  const team = [member("Blastoise"), member("Charizard"), member("Tauros")];
  const result = JSON.parse(JSON.stringify(context.wcClassifyTeamStyle(team, abilitiesData)));
  assert.ok(result, "expected a real team style, got null");
  assert.equal(result.style, "balance");
});

check("Precedence: a team that qualifies for BOTH Tailwind and Balance's raw conditions picks Tailwind, since it's checked first", () => {
  // Adding a real wall (Blastoise) to the tailwind fixture above makes the
  // team also satisfy Balance's own conditions (>=1 wall, >=2 hard
  // hitters) -- Tailwind must still win since it's the higher-precedence
  // branch in wcClassifyTeamStyle.
  const team = [member("Pidgeot"), member("Snorlax"), member("Machamp"), member("Blastoise")];
  const result = JSON.parse(JSON.stringify(context.wcClassifyTeamStyle(team, abilitiesData)));
  assert.equal(result.style, "tailwind");
});

check("An early/mixed team with no real setter or shape signal returns null, honestly", () => {
  const team = [member("Blastoise")];
  const result = context.wcClassifyTeamStyle(team, abilitiesData);
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// 7. Team notes can name a target style directly, overriding organic
// detection -- wcRequestedTeamStyleFromNotes / wcTeamStyleSynergyBonus.
// ---------------------------------------------------------------------------

check("wcRequestedTeamStyleFromNotes recognizes each of the six styles from real free-text phrasing, and returns null for unrelated notes", () => {
  assert.equal(context.wcRequestedTeamStyleFromNotes("let's build hyper offense this time"), "hyperoffense");
  assert.equal(context.wcRequestedTeamStyleFromNotes("go for a balance team"), "balance");
  assert.equal(context.wcRequestedTeamStyleFromNotes("want a weather team built around sun"), "weather");
  assert.equal(context.wcRequestedTeamStyleFromNotes("speed team please"), "tailwind");
  assert.equal(context.wcRequestedTeamStyleFromNotes("slow team, trick room team"), "trickroom");
  assert.equal(context.wcRequestedTeamStyleFromNotes("try a dual room build"), "dualroom");
  assert.equal(context.wcRequestedTeamStyleFromNotes("no Gholdengo please"), null);
  assert.equal(context.wcRequestedTeamStyleFromNotes(""), null);
});

check("wcTeamStyleSynergyBonus rewards a real glass-cannon candidate and PENALIZES a real wall candidate once Hyper Offense is the effective style", () => {
  const team = [member("Alakazam"), member("Gengar")]; // organically forming hyperoffense already (2 of 2 glass-cannon, 0 walls)
  const glassCannonCandidate = member("Jolteon");
  const wallCandidate = member("Blastoise");
  const glassCannonBonus = context.wcTeamStyleSynergyBonus(glassCannonCandidate, team, "", abilitiesData);
  const wallBonus = context.wcTeamStyleSynergyBonus(wallCandidate, team, "", abilitiesData);
  assert.equal(glassCannonBonus, 1.5);
  assert.equal(wallBonus, -1.5);
});

check("wcTeamStyleSynergyBonus rewards BOTH a real wall and a real hard hitter once Balance is the effective style", () => {
  // Slowbro is genuinely BOTH a wall (bulk=7600) and a hard hitter
  // (max(atk,spa)=100) on its own, so this 2-member team already
  // organically classifies as balance (1 wall, 2 hard hitters counting
  // Slowbro itself and Charizard) without needing a 3rd member.
  const team = [member("Slowbro"), member("Charizard")];
  assert.equal(JSON.parse(JSON.stringify(context.wcClassifyTeamStyle(team, abilitiesData))).style, "balance");
  const wallCandidate = member("Blastoise");
  const hardHitterCandidate = member("Tauros");
  assert.equal(context.wcTeamStyleSynergyBonus(wallCandidate, team, "", abilitiesData), 1.5);
  assert.equal(context.wcTeamStyleSynergyBonus(hardHitterCandidate, team, "", abilitiesData), 1);
});

check("wcTeamStyleSynergyBonus lets team notes REQUEST a style directly, overriding what the team-so-far would otherwise classify as", () => {
  // This team alone classifies as nothing yet (just Blastoise, a wall with
  // no other signal -- confirmed null earlier) -- notes naming "hyper
  // offense" should still apply the Hyper Offense reward/penalty rather
  // than fall back to null/balance.
  const team = [member("Blastoise")];
  const glassCannonCandidate = member("Jolteon");
  const realWallCandidate = member("Blastoise");
  assert.equal(context.wcTeamStyleSynergyBonus(glassCannonCandidate, team, "let's go hyper offense", abilitiesData), 1.5);
  assert.equal(context.wcTeamStyleSynergyBonus(realWallCandidate, team, "let's go hyper offense", abilitiesData), -1.5);
});

check("wcTeamStyleSynergyBonus returns 0 for Weather -- the existing wcWeatherCounterBonus/archetype-synergy system already scores that, and double-counting it here would be dishonest", () => {
  const team = [member("Ninetales"), member("Charizard")];
  const anyCandidate = member("Tauros");
  assert.equal(context.wcTeamStyleSynergyBonus(anyCandidate, team, "", abilitiesData), 0);
});

console.log(`\nAll ${checksRun} checks passed.`);
