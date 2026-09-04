// WinCon — tools/test-helping-hand.mjs
//
// Helping Hand (Milestone 39: Phoenix's Status-move audit) is learnable
// by ~68.5% of all species (204/298 in data/learnsets.json) -- nowhere
// near a real "setter signal" the way Trick Room (~17.8%) or Wide Guard
// (~8.1%) are. Unlike every other archetype in this file, it deliberately
// has NO entry in wcArchetypeSignalsFor/wcArchetypeBeneficiaryScore --
// giving it one would fire the Dream-Team-picking bonus for most
// candidates regardless of team composition, the exact fake-signal
// problem weather's ability-only design already exists to avoid. It only
// ever gets proposed post-build, in wcAnalyzeTeamStrategy, and only when
// there's a real hard hitter (Atk/SpA >= 100) already on the roster
// worth amplifying. Doubles-only.
//
// Run: node tools/test-helping-hand.mjs

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

let checks = 0;
function check(description, fn) {
  fn();
  checks += 1;
  console.log(`OK  ${description}`);
}

const baseStatsData = loadJSON("data/base-stats.json");
const learnsets = loadJSON("data/learnsets.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const pokemonData = loadJSON("data/pokemon.json");

function statsFor(name) {
  return baseStatsData.find((b) => b.name === name);
}
function typesFor(name) {
  return pokemonData.find((p) => p.name === name).types;
}

// Whimsicott (real Helping Hand learner, Atk 67/SpA 77 -- NOT a hard
// hitter itself), Kingambit (real hard hitter, Atk 135, does NOT learn
// Helping Hand), and Blastoise (a second real, weak, non-Helping-Hand
// species for the "no hard hitter on the team" fixture).
const whimsicott = { name: "Whimsicott", types: typesFor("Whimsicott"), baseStats: statsFor("Whimsicott"), learnableNames: learnsets["Whimsicott"] };
const kingambit = { name: "Kingambit", types: typesFor("Kingambit"), baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] };
const blastoise = { name: "Blastoise", types: typesFor("Blastoise"), baseStats: statsFor("Blastoise"), learnableNames: learnsets["Blastoise"] };

check("wcArchetypeSignalsFor never returns \"helpinghand\" for anyone -- confirms it's intentionally excluded from the pick-time signal system", () => {
  [whimsicott, kingambit, blastoise].forEach((m) => {
    const signals = context.wcArchetypeSignalsFor(m, "doubles", abilitiesData);
    assert.ok(!signals.includes("helpinghand"), `${m.name}: ${JSON.stringify(signals)}`);
  });
});

check("wcArchetypeBeneficiaryScore(\"helpinghand\") is always 0 -- no beneficiary case exists for it, by design", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(kingambit, "helpinghand", abilitiesData), 0);
});

// Milestone 39: every real hard hitter (Atk/SpA >= 100) and every real
// Helping Hand learner in data/learnsets.json also happens to learn at
// least one OTHER archetype move (confirmed by direct search -- with a
// combined movepool this size, that's simply always true), so a
// real-species 2-member team can never isolate Helping Hand as the
// single winning candidate. Synthetic fixtures (same established pattern
// as test-soft-preference.mjs's SyntheticMentioned/SyntheticActual and
// test-anti-synergy-auditor.mjs's TwinA/TwinB) isolate just this one
// mechanic instead: a plain hard hitter with an empty movepool (nothing
// else could ever fire for it) and a plain support Pokemon that can
// ONLY learn Helping Hand.
const bigHitter = { name: "BigHitterMon", types: ["Normal"], baseStats: { hp: 80, atk: 135, def: 80, spa: 60, spd: 80, spe: 80 }, learnableNames: [] };
const helperMon = { name: "HelperMon", types: ["Normal"], baseStats: { hp: 80, atk: 60, def: 80, spa: 60, spd: 80, spe: 80 }, learnableNames: ["Helping Hand"] };
const weakMon = { name: "WeakMon", types: ["Normal"], baseStats: { hp: 80, atk: 60, def: 80, spa: 60, spd: 80, spe: 80 }, learnableNames: [] };

check("wcAnalyzeTeamStrategy proposes Helping Hand when a real hard hitter AND a learner are both on the team (Doubles)", () => {
  const members = [helperMon, bigHitter];
  const builds = {
    HelperMon: { nature: "Timid", item: "Focus Sash", moves: ["Helping Hand", "Protect", "Encore", "Taunt"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
    BigHitterMon: { nature: "Adamant", item: "Life Orb", moves: ["Return", "Protect", "Rock Slide", "Earthquake"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  const archetypes = [result.archetype, result.alternative && result.alternative.archetype].filter(Boolean);
  assert.ok(archetypes.includes("helpinghand"), `expected "helpinghand" among the proposed strategies, got ${JSON.stringify(archetypes)}`);
});

check("wcAnalyzeTeamStrategy never proposes Helping Hand when no real hard hitter is on the team", () => {
  const members = [helperMon, weakMon];
  const builds = {
    HelperMon: { nature: "Timid", item: "Focus Sash", moves: ["Helping Hand", "Protect", "Encore", "Taunt"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
    WeakMon: { nature: "Bold", item: "Leftovers", moves: ["Toxic", "Protect", "Rest", "Sleep Talk"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Electric"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  const archetypes = [result.archetype, result.alternative && result.alternative.archetype].filter(Boolean);
  assert.ok(!archetypes.includes("helpinghand"), `did not expect "helpinghand", got ${JSON.stringify(archetypes)}`);
});

check("wcAnalyzeTeamStrategy never proposes Helping Hand in Singles, even with a hard hitter and a learner present", () => {
  const members = [helperMon, bigHitter];
  const builds = {
    HelperMon: { nature: "Timid", item: "Focus Sash", moves: ["Helping Hand", "Protect", "Encore", "Taunt"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
    BigHitterMon: { nature: "Adamant", item: "Life Orb", moves: ["Return", "Protect", "Rock Slide", "Earthquake"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "singles", "", abilitiesData, null);
  const archetypes = [result.archetype, result.alternative && result.alternative.archetype].filter(Boolean);
  assert.ok(!archetypes.includes("helpinghand"), `did not expect "helpinghand" in Singles, got ${JSON.stringify(archetypes)}`);
});

check("WINCON_NOTES_KEYWORDS helpinghand boost/suppress behave like every other archetype (via wcApplyNotesBias)", () => {
  const candidates = [{ archetype: "helpinghand", fitScore: 1, setterName: "Whimsicott" }];
  const boosted = context.wcApplyNotesBias(candidates, "I want helping hand on this team");
  assert.equal(boosted.length, 1);
  assert.equal(boosted[0].fitScore, 1 + 3);

  const suppressed = context.wcApplyNotesBias(candidates, "no helping hand please");
  assert.equal(suppressed.length, 0);
});

console.log("");
console.log(`All ${checks} Helping Hand checks passed.`);
