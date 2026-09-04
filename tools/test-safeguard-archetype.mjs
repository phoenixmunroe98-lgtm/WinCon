// WinCon — tools/test-safeguard-archetype.mjs
//
// Safeguard as a new archetype (Milestone 39: Phoenix's Status-move
// audit) -- same "no ability-based free case" shape as Wide Guard/Quick
// Guard, but purely protective (5-turn team-wide status/confusion
// immunity) rather than shielding a specific hard hitter, so its
// beneficiary score is always 0, the same honest precedent Misty Terrain
// and hazards already established (not every archetype needs a
// differentiated beneficiary).
//
// Run: node tools/test-safeguard-archetype.mjs

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

const clefable = { name: "Clefable", types: typesFor("Clefable"), baseStats: statsFor("Clefable"), learnableNames: learnsets["Clefable"] };
const kingambit = { name: "Kingambit", types: typesFor("Kingambit"), baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] };

check("Clefable (learns Safeguard) carries the safeguard archetype signal", () => {
  const signals = context.wcArchetypeSignalsFor(clefable, "doubles", abilitiesData);
  assert.ok(signals.includes("safeguard"), `expected "safeguard" in ${JSON.stringify(signals)}`);
});

check("a Pokemon that can't learn Safeguard does NOT carry the safeguard signal", () => {
  const signals = context.wcArchetypeSignalsFor(kingambit, "doubles", abilitiesData);
  assert.ok(!signals.includes("safeguard"));
});

check("safeguard's beneficiary score is always 0 -- purely protective, no type-matched power synergy", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(kingambit, "safeguard", abilitiesData), 0);
  assert.equal(context.wcArchetypeBeneficiaryScore(clefable, "safeguard", abilitiesData), 0);
});

check("WC_ARCHETYPE_DISPLAY_NAMES has a real Safeguard label (not a bare fallback to the raw key)", () => {
  assert.equal(context.wcArchetypeDisplayName("safeguard"), "Safeguard");
});

check("WINCON_NOTES_KEYWORDS safeguard boost/suppress behave like every other archetype (via wcApplyNotesBias)", () => {
  const candidates = [{ archetype: "safeguard", fitScore: 1, setterName: "Clefable" }];
  const boosted = context.wcApplyNotesBias(candidates, "I want safeguard on this team");
  assert.equal(boosted.length, 1);
  assert.equal(boosted[0].fitScore, 1 + 3);

  const suppressed = context.wcApplyNotesBias(candidates, "no safeguard please");
  assert.equal(suppressed.length, 0);
});

check("wcAnalyzeTeamStrategy proposes a safeguard amendment for a team with a learnable setter (synthetic fixtures, isolating just this mechanic)", () => {
  // Same rationale as test-helping-hand.mjs: real Safeguard learners in
  // data/learnsets.json also tend to learn other archetype moves, so
  // synthetic fixtures with an otherwise-empty movepool isolate this one
  // mechanic cleanly.
  const setterMon = { name: "SafeguardMon", types: ["Normal"], baseStats: { hp: 80, atk: 60, def: 80, spa: 60, spd: 80, spe: 80 }, learnableNames: ["Safeguard"] };
  const partnerMon = { name: "PartnerMon", types: ["Normal"], baseStats: { hp: 80, atk: 60, def: 80, spa: 60, spd: 80, spe: 80 }, learnableNames: [] };
  const members = [setterMon, partnerMon];
  const builds = {
    SafeguardMon: { nature: "Bold", item: "Leftovers", moves: ["Safeguard", "Protect", "Moonblast", "Wish"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
    PartnerMon: { nature: "Adamant", item: "Life Orb", moves: ["Return", "Protect", "Rock Slide", "Earthquake"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  const archetypes = [result.archetype, result.alternative && result.alternative.archetype].filter(Boolean);
  assert.ok(archetypes.includes("safeguard"), `expected "safeguard" among the proposed strategies, got ${JSON.stringify(archetypes)}`);
});

console.log("");
console.log(`All ${checks} Safeguard archetype checks passed.`);
