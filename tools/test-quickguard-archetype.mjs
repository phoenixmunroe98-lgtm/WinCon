// WinCon — tools/test-quickguard-archetype.mjs
//
// Quick Guard as a new archetype (Milestone 39: Phoenix's Status-move
// audit), Wide Guard's direct sibling -- same fixed +3 priority, same
// "protect the team's real hard hitter" role, just blocking priority
// moves instead of spread moves. Mirrors tools/test-wideguard-archetype.mjs
// exactly.
//
// Run: node tools/test-quickguard-archetype.mjs

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

// Lucario (a real Quick Guard learner) and Kingambit (a real hard hitter
// worth protecting, Atk 135) as fixtures.
const machamp = { name: "Lucario", types: typesFor("Lucario"), baseStats: statsFor("Lucario"), learnableNames: learnsets["Lucario"] };
const kingambit = { name: "Kingambit", types: typesFor("Kingambit"), baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] };

check("Lucario (learns Quick Guard) carries the quickguard archetype signal", () => {
  const signals = context.wcArchetypeSignalsFor(machamp, "doubles", abilitiesData);
  assert.ok(signals.includes("quickguard"), `expected "quickguard" in ${JSON.stringify(signals)}`);
});

check("a Pokemon that can't learn Quick Guard does NOT carry the quickguard signal", () => {
  const nonQuickGuard = { name: "Whimsicott", learnableNames: learnsets["Whimsicott"] };
  const signals = context.wcArchetypeSignalsFor(nonQuickGuard, "doubles", abilitiesData);
  assert.ok(!signals.includes("quickguard"));
});

check("a real hard hitter (Atk/SpA >= 100) is a genuine quickguard beneficiary, same reasoning as screens/redirect/Wide Guard", () => {
  const score = context.wcArchetypeBeneficiaryScore(kingambit, "quickguard", abilitiesData);
  assert.equal(score, 1);
});

check("a weak attacker is NOT a quickguard beneficiary", () => {
  const weak = { name: "Whimsicott", baseStats: statsFor("Whimsicott") };
  const score = context.wcArchetypeBeneficiaryScore(weak, "quickguard", abilitiesData);
  assert.equal(score, 0);
});

check("WC_ARCHETYPE_DISPLAY_NAMES has a real Quick Guard label (not a bare fallback to the raw key)", () => {
  const label = context.wcArchetypeDisplayName("quickguard");
  assert.equal(label, "Quick Guard");
});

check("WINCON_NOTES_KEYWORDS quickguard boost/suppress behave like every other archetype (via wcApplyNotesBias)", () => {
  const candidates = [{ archetype: "quickguard", fitScore: 1, setterName: "Lucario" }];
  const boosted = context.wcApplyNotesBias(candidates, "I want a quick guard user on this team");
  assert.equal(boosted.length, 1);
  assert.equal(boosted[0].fitScore, 1 + 3, "expected the standard +3 notes boost");

  const suppressed = context.wcApplyNotesBias(candidates, "no quick guard please");
  assert.equal(suppressed.length, 0, "expected the quickguard candidate to be dropped entirely");
});

check("wcAnalyzeTeamStrategy proposes a quickguard amendment for a team with a learnable setter and a real sweeper", () => {
  const members = [
    { name: "Lucario", slotName: "Lucario", types: typesFor("Lucario"), baseStats: statsFor("Lucario"), learnableNames: learnsets["Lucario"] },
    { name: "Kingambit", slotName: "Kingambit", types: typesFor("Kingambit"), baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] },
  ];
  const builds = {
    Lucario: { nature: "Adamant", item: "Sitrus Berry", moves: ["Close Combat", "Ice Punch", "Quick Guard", "Bullet Punch"], sp: { hp: 32, attack: 32, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
    Kingambit: { nature: "Adamant", item: "Black Glasses", moves: ["Sucker Punch", "Kowtow Cleave", "Iron Head", "Swords Dance"], sp: { hp: 32, attack: 32, defense: 0, sp_attack: 0, sp_defense: 2, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  const archetypes = [result.archetype, result.alternative && result.alternative.archetype].filter(Boolean);
  assert.ok(archetypes.includes("quickguard"), `expected "quickguard" among the proposed strategies, got ${JSON.stringify(archetypes)}`);
});

console.log("");
console.log(`All ${checks} Quick Guard archetype checks passed.`);
