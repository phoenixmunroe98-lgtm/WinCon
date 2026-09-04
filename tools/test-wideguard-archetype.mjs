// WinCon — tools/test-wideguard-archetype.mjs
//
// Wide Guard as an eighth archetype (Milestone 38: Phoenix's Steelix/
// Wide-Guard doc), mirroring Trick Room/Tailwind/weather/redirect/
// hazards/screens in all three places they already exist:
//   1. Milestone 36's pre-build species-picking synergy
//      (wcArchetypeSignalsFor/wcArchetypeBeneficiaryScore).
//   2. Team Notes keyword bias (WINCON_NOTES_KEYWORDS via wcApplyNotesBias).
//   3. Post-build amendment proposals (wcAnalyzeTeamStrategy).
//
// Run: node tools/test-wideguard-archetype.mjs

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

function statsFor(name) {
  return baseStatsData.find((b) => b.name === name);
}

// Steelix (the doc's own Wide Guard example, real learner per its actual
// learnset) and Kingambit (a real hard hitter worth protecting, Atk 135)
// as fixtures.
const steelix = { name: "Steelix", types: ["Steel", "Ground"], baseStats: statsFor("Steelix"), learnableNames: learnsets["Steelix"] };
const kingambit = { name: "Kingambit", types: ["Dark", "Steel"], baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] };

check("Steelix (learns Wide Guard) carries the wideguard archetype signal", () => {
  const signals = context.wcArchetypeSignalsFor(steelix, "doubles", abilitiesData);
  assert.ok(signals.includes("wideguard"), `expected "wideguard" in ${JSON.stringify(signals)}`);
});

check("a Pokemon that can't learn Wide Guard does NOT carry the wideguard signal", () => {
  const nonWideGuard = { name: "Kingambit", learnableNames: learnsets["Kingambit"] };
  const signals = context.wcArchetypeSignalsFor(nonWideGuard, "doubles", abilitiesData);
  assert.ok(!signals.includes("wideguard"));
});

check("a real hard hitter (Atk/SpA >= 100) is a genuine wideguard beneficiary, same reasoning as screens/redirect", () => {
  const score = context.wcArchetypeBeneficiaryScore(kingambit, "wideguard", abilitiesData);
  assert.equal(score, 1);
});

check("a weak attacker is NOT a wideguard beneficiary", () => {
  const weak = { name: "Whimsicott", baseStats: statsFor("Whimsicott") };
  const score = context.wcArchetypeBeneficiaryScore(weak, "wideguard", abilitiesData);
  assert.equal(score, 0);
});

check("WC_ARCHETYPE_DISPLAY_NAMES has a real Wide Guard label (not a bare fallback to the raw key)", () => {
  const label = context.wcArchetypeDisplayName("wideguard");
  assert.equal(label, "Wide Guard");
});

check("WINCON_NOTES_KEYWORDS wideguard boost/suppress behave like every other archetype (via wcApplyNotesBias)", () => {
  const candidates = [{ archetype: "wideguard", fitScore: 1, setterName: "Steelix" }];
  const boosted = context.wcApplyNotesBias(candidates, "I want a wide guard user on this team");
  assert.equal(boosted.length, 1);
  assert.equal(boosted[0].fitScore, 1 + 3, "expected the standard +3 notes boost");

  const suppressed = context.wcApplyNotesBias(candidates, "no wide guard please");
  assert.equal(suppressed.length, 0, "expected the wideguard candidate to be dropped entirely");
});

check("wcAnalyzeTeamStrategy proposes a wideguard amendment for a team with a learnable setter and a real sweeper", () => {
  // A minimal 2-member team: Steelix (learns Wide Guard) and Kingambit (a
  // real hard hitter worth protecting).
  const members = [
    { name: "Steelix", slotName: "Steelix", types: ["Steel", "Ground"], baseStats: statsFor("Steelix"), learnableNames: learnsets["Steelix"] },
    { name: "Kingambit", slotName: "Kingambit", types: ["Dark", "Steel"], baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] },
  ];
  const builds = {
    Steelix: { nature: "Impish", item: "Sitrus Berry", moves: ["Heavy Slam", "Earthquake", "Wide Guard", "Stealth Rock"], sp: { hp: 32, attack: 0, defense: 32, sp_attack: 0, sp_defense: 0, speed: 2 } },
    Kingambit: { nature: "Adamant", item: "Black Glasses", moves: ["Sucker Punch", "Kowtow Cleave", "Iron Head", "Swords Dance"], sp: { hp: 32, attack: 32, defense: 0, sp_attack: 0, sp_defense: 2, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  // Wide Guard should be at least a real candidate the biasing step saw --
  // check it either won outright or is the alternative, since which one
  // "wins" depends on fitScore ties against whatever else this small
  // roster also qualifies for.
  const archetypes = [result.archetype, result.alternative && result.alternative.archetype].filter(Boolean);
  assert.ok(archetypes.includes("wideguard"), `expected "wideguard" among the proposed strategies, got ${JSON.stringify(archetypes)}`);
});

console.log("");
console.log(`All ${checks} Wide Guard archetype checks passed.`);
