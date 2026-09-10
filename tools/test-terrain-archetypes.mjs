// WinCon — tools/test-terrain-archetypes.mjs
//
// Terrain as four new archetypes (Milestone 39: Phoenix's Status-move
// audit, "terrain first"), mirroring Trick Room/Tailwind/Wide Guard's
// move-signaled pattern (NOT weather's ability-only pattern -- terrain-
// setting abilities are essentially absent from this dataset) in the
// same places those archetypes already exist:
//   1. Milestone 36's pre-build species-picking synergy
//      (wcArchetypeSignalsFor/wcArchetypeBeneficiaryScore).
//   2. Team Notes keyword bias (WINCON_NOTES_KEYWORDS via wcApplyNotesBias).
//   3. Post-build amendment proposals (wcAnalyzeTeamStrategy).
//
// Run: node tools/test-terrain-archetypes.mjs

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

// Real fixtures, confirmed against the actual data files: Pikachu/Ampharos
// (both Electric-type, both learn Electric Terrain), Whimsicott (Grass/
// Fairy, learns Grassy Terrain), Gardevoir/Alakazam (both Psychic-typed,
// both learn Psychic Terrain), Alolan Ninetales (learns Misty Terrain).
const pikachu = { name: "Pikachu", types: typesFor("Pikachu"), baseStats: statsFor("Pikachu"), learnableNames: learnsets["Pikachu"] };
const ampharos = { name: "Ampharos", types: typesFor("Ampharos"), baseStats: statsFor("Ampharos"), learnableNames: learnsets["Ampharos"] };
const whimsicott = { name: "Whimsicott", types: typesFor("Whimsicott"), baseStats: statsFor("Whimsicott"), learnableNames: learnsets["Whimsicott"] };
const gardevoir = { name: "Gardevoir", types: typesFor("Gardevoir"), baseStats: statsFor("Gardevoir"), learnableNames: learnsets["Gardevoir"] };
const alakazam = { name: "Alakazam", types: typesFor("Alakazam"), baseStats: statsFor("Alakazam"), learnableNames: learnsets["Alakazam"] };
const alolanNinetales = { name: "Alolan Ninetales", types: typesFor("Alolan Ninetales"), baseStats: statsFor("Alolan Ninetales"), learnableNames: learnsets["Alolan Ninetales"] };
const kingambit = { name: "Kingambit", types: typesFor("Kingambit"), baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] };

// ---------------------------------------------------------------------------
// Signal detection
// ---------------------------------------------------------------------------

check("Pikachu (learns Electric Terrain) carries the electricterrain signal", () => {
  const signals = context.wcArchetypeSignalsFor(pikachu, "doubles", abilitiesData);
  assert.ok(signals.includes("electricterrain"), JSON.stringify(signals));
});

check("Whimsicott (learns Grassy Terrain) carries the grassyterrain signal", () => {
  const signals = context.wcArchetypeSignalsFor(whimsicott, "doubles", abilitiesData);
  assert.ok(signals.includes("grassyterrain"), JSON.stringify(signals));
});

check("Alolan Ninetales (learns Misty Terrain) carries the mistyterrain signal", () => {
  const signals = context.wcArchetypeSignalsFor(alolanNinetales, "doubles", abilitiesData);
  assert.ok(signals.includes("mistyterrain"), JSON.stringify(signals));
});

check("Alakazam (learns Psychic Terrain) carries the psychicterrain signal", () => {
  const signals = context.wcArchetypeSignalsFor(alakazam, "doubles", abilitiesData);
  assert.ok(signals.includes("psychicterrain"), JSON.stringify(signals));
});

check("a Pokemon that learns none of the terrain moves carries no terrain signal", () => {
  const signals = context.wcArchetypeSignalsFor(kingambit, "doubles", abilitiesData);
  ["electricterrain", "grassyterrain", "mistyterrain", "psychicterrain"].forEach((t) => assert.ok(!signals.includes(t), t));
});

// ---------------------------------------------------------------------------
// Beneficiary scoring
// ---------------------------------------------------------------------------

check("an Electric-type candidate is a real electricterrain beneficiary (1.3x STAB boost)", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(ampharos, "electricterrain", abilitiesData), 1);
});

check("a non-Electric candidate is NOT an electricterrain beneficiary", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(whimsicott, "electricterrain", abilitiesData), 0);
});

check("a Grass-type candidate is a real grassyterrain beneficiary", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(whimsicott, "grassyterrain", abilitiesData), 1);
});

check("a Psychic-type candidate is a real psychicterrain beneficiary", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(gardevoir, "psychicterrain", abilitiesData), 1);
});

check("mistyterrain's beneficiary score is always 0 -- it's whole-team defensive utility, not a type-matched power boost, same honest precedent as hazards", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(gardevoir, "mistyterrain", abilitiesData), 0);
  assert.equal(context.wcArchetypeBeneficiaryScore(kingambit, "mistyterrain", abilitiesData), 0);
});

// ---------------------------------------------------------------------------
// Display names
// ---------------------------------------------------------------------------

check("all four terrains have real display-name labels, not bare fallbacks to the raw key", () => {
  assert.equal(context.wcArchetypeDisplayName("electricterrain"), "Electric Terrain");
  assert.equal(context.wcArchetypeDisplayName("grassyterrain"), "Grassy Terrain");
  assert.equal(context.wcArchetypeDisplayName("mistyterrain"), "Misty Terrain");
  assert.equal(context.wcArchetypeDisplayName("psychicterrain"), "Psychic Terrain");
});

// ---------------------------------------------------------------------------
// Notes bias
// ---------------------------------------------------------------------------

check("WINCON_NOTES_KEYWORDS electricterrain boost/suppress behave like every other archetype", () => {
  const candidates = [{ archetype: "electricterrain", fitScore: 1, setterName: "Pikachu" }];
  const boosted = context.wcApplyNotesBias(candidates, "I want electric terrain up on this team");
  assert.equal(boosted.length, 1);
  assert.equal(boosted[0].fitScore, 1 + 3);

  const suppressed = context.wcApplyNotesBias(candidates, "no electric terrain please");
  assert.equal(suppressed.length, 0);
});

// ---------------------------------------------------------------------------
// wcAnalyzeTeamStrategy integration
// ---------------------------------------------------------------------------

// Milestone 67: Phoenix caught wcAnalyzeTeamStrategy's Win Condition
// presenting a MERELY learnable move as if it were this battle's real,
// executable plan -- "Win condition: Electric Terrain, set by Ampharos"
// when Ampharos's actual build didn't have Electric Terrain selected at
// all, and there's no changing a moveset mid-battle. The two checks
// below are the fix's real before/after: a genuinely-built terrain setup
// (Pikachu's own moveset actually running Electric Terrain) IS still
// proposed as the win condition end-to-end; a merely-learnable one that
// nobody's real build has selected is NOT -- reproducing Phoenix's exact
// fixture (this file's own Pikachu/Ampharos builds, unchanged from
// before this milestone except Pikachu's own moveset) confirms the old
// bug is gone.

check("wcAnalyzeTeamStrategy proposes electricterrain when a member's REAL build already runs Electric Terrain, and phrases it as already-active fact, not a suggestion", () => {
  const members = [
    { name: "Pikachu", slotName: "Pikachu", types: typesFor("Pikachu"), baseStats: statsFor("Pikachu"), learnableNames: learnsets["Pikachu"] },
    { name: "Ampharos", slotName: "Ampharos", types: typesFor("Ampharos"), baseStats: statsFor("Ampharos"), learnableNames: learnsets["Ampharos"] },
  ];
  const builds = {
    Pikachu: { nature: "Timid", item: "Light Ball", moves: ["Thunderbolt", "Volt Switch", "Electric Terrain", "Protect"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 32 } },
    Ampharos: { nature: "Modest", item: "Assault Vest", moves: ["Discharge", "Focus Blast", "Dragon Pulse", "Volt Switch"], sp: { hp: 32, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Water"] }, { name: "T2", types: ["Ground"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  const archetypes = [result.archetype, result.alternative && result.alternative.archetype].filter(Boolean);
  assert.ok(archetypes.includes("electricterrain"), `expected "electricterrain" among the proposed strategies, got ${JSON.stringify(archetypes)}`);
  const winning = result.archetype === "electricterrain" ? result : result.alternative;
  assert.equal(winning.setterName, "Pikachu");
  assert.ok(winning.note.includes("Pikachu already knows Electric Terrain"), winning.note);
  assert.ok(!winning.note.includes("can learn"), `note should no longer say "can learn" once it's really built: ${winning.note}`);
});

check("Milestone 67 fix: wcAnalyzeTeamStrategy does NOT propose electricterrain when it's only learnable, not actually selected on any real build -- Phoenix's exact bug (Ampharos could learn it, but her real build didn't run it)", () => {
  const members = [
    { name: "Pikachu", slotName: "Pikachu", types: typesFor("Pikachu"), baseStats: statsFor("Pikachu"), learnableNames: learnsets["Pikachu"] },
    { name: "Ampharos", slotName: "Ampharos", types: typesFor("Ampharos"), baseStats: statsFor("Ampharos"), learnableNames: learnsets["Ampharos"] },
  ];
  // Same fixture as the check above, except NEITHER build actually runs
  // Electric Terrain (both merely CAN learn it) -- this is Phoenix's
  // exact real scenario.
  const builds = {
    Pikachu: { nature: "Timid", item: "Light Ball", moves: ["Thunderbolt", "Volt Switch", "Nasty Plot", "Protect"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 32 } },
    Ampharos: { nature: "Modest", item: "Assault Vest", moves: ["Discharge", "Focus Blast", "Dragon Pulse", "Volt Switch"], sp: { hp: 32, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Water"] }, { name: "T2", types: ["Ground"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  const archetypes = [result.archetype, result.alternative && result.alternative.archetype].filter(Boolean);
  assert.ok(!archetypes.includes("electricterrain"), `electricterrain should not be proposed when nobody's real build has it -- got ${JSON.stringify(archetypes)}`);
  assert.equal(result.archetype, "independent");
  assert.ok(result.note.includes("learnable somewhere on this roster"), result.note);
});

console.log("");
console.log(`All ${checks} terrain archetype checks passed.`);
