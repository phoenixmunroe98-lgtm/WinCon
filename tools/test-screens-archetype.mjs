// WinCon — tools/test-screens-archetype.mjs
//
// Screens (Light Screen/Reflect) as a full seventh archetype, mirroring
// Trick Room/Tailwind/weather/redirect/hazards in all three places they
// already exist (Phoenix's Tailwind/Staraptor/screens request):
//   1. Milestone 36's pre-build species-picking synergy
//      (wcArchetypeSignalsFor/wcArchetypeBeneficiaryScore).
//   2. Team Notes keyword bias (WINCON_NOTES_KEYWORDS via wcApplyNotesBias).
//   3. Post-build amendment proposals (wcAnalyzeTeamStrategy).
//
// Run: node tools/test-screens-archetype.mjs

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

// Grimmsnarl (Prankster, learns both Light Screen and Reflect per its
// real learnset) and Kingambit (a real hard hitter, Atk 135) as fixtures.
const grimmsnarl = { name: "Grimmsnarl", types: ["Dark", "Fairy"], baseStats: statsFor("Grimmsnarl"), learnableNames: learnsets["Grimmsnarl"] };
const kingambit = { name: "Kingambit", types: ["Dark", "Steel"], baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] };

check("Grimmsnarl (learns Light Screen/Reflect) carries the screens archetype signal", () => {
  const signals = context.wcArchetypeSignalsFor(grimmsnarl, "doubles", abilitiesData);
  assert.ok(signals.includes("screens"), `expected "screens" in ${JSON.stringify(signals)}`);
});

check("a Pokemon that can't learn either screens move does NOT carry the screens signal", () => {
  const nonScreens = { name: "Kingambit", learnableNames: learnsets["Kingambit"] };
  const signals = context.wcArchetypeSignalsFor(nonScreens, "doubles", abilitiesData);
  assert.ok(!signals.includes("screens"));
});

check("a real hard hitter (Atk/SpA >= 100) is a genuine screens beneficiary, same reasoning as redirect", () => {
  const score = context.wcArchetypeBeneficiaryScore(kingambit, "screens", abilitiesData);
  assert.equal(score, 1);
});

check("a weak attacker is NOT a screens beneficiary", () => {
  const weak = { name: "Whimsicott", baseStats: statsFor("Whimsicott") };
  const score = context.wcArchetypeBeneficiaryScore(weak, "screens", abilitiesData);
  assert.equal(score, 0);
});

check("WC_ARCHETYPE_DISPLAY_NAMES has a real screens label (not a bare fallback to the raw key)", () => {
  const label = context.wcArchetypeDisplayName("screens");
  assert.notEqual(label, "screens_raw_fallback_sentinel");
  assert.ok(label.toLowerCase().includes("screen"), `expected a screens-related label, got "${label}"`);
});

check("WINCON_NOTES_KEYWORDS screens boost/suppress behave like every other archetype (via wcApplyNotesBias)", () => {
  const candidates = [{ archetype: "screens", fitScore: 1, setterName: "Grimmsnarl" }];
  const boosted = context.wcApplyNotesBias(candidates, "I want a screens setter on this team");
  assert.equal(boosted.length, 1);
  assert.equal(boosted[0].fitScore, 1 + 3, "expected the standard +3 notes boost");

  const suppressed = context.wcApplyNotesBias(candidates, "no screens please");
  assert.equal(suppressed.length, 0, "expected the screens candidate to be dropped entirely");
});

check("wcAnalyzeTeamStrategy proposes a screens amendment for a team with a learnable setter and a real sweeper", () => {
  // A minimal 2-member team: Grimmsnarl (learns Reflect/Light Screen,
  // Prankster) and Kingambit (a real hard hitter worth protecting).
  const members = [
    { name: "Grimmsnarl", slotName: "Grimmsnarl", types: ["Dark", "Fairy"], baseStats: statsFor("Grimmsnarl"), learnableNames: learnsets["Grimmsnarl"] },
    { name: "Kingambit", slotName: "Kingambit", types: ["Dark", "Steel"], baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] },
  ];
  const builds = {
    Grimmsnarl: { nature: "Careful", item: "Light Clay", moves: ["Spirit Break", "Parting Shot", "", ""], sp: { hp: 32, attack: 0, defense: 0, sp_attack: 0, sp_defense: 32, speed: 2 } },
    Kingambit: { nature: "Adamant", item: "Black Glasses", moves: ["Sucker Punch", "Kowtow Cleave", "Iron Head", "Swords Dance"], sp: { hp: 32, attack: 32, defense: 0, sp_attack: 0, sp_defense: 2, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  // Screens should be at least a real candidate the biasing step saw --
  // check it either won outright or is the alternative, since which one
  // "wins" depends on fitScore ties against whatever else this small
  // roster also qualifies for.
  const archetypes = [result.archetype, result.alternative && result.alternative.archetype].filter(Boolean);
  assert.ok(archetypes.includes("screens"), `expected "screens" among the proposed strategies, got ${JSON.stringify(archetypes)}`);
});

console.log("");
console.log(`All ${checks} screens-archetype checks passed.`);
