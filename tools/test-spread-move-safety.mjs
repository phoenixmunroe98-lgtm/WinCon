// WinCon — tools/test-spread-move-safety.mjs
//
// Milestone 38: Phoenix's Steelix/Wide-Guard doc framed "Staraptor/
// Charizard's Ground immunity permits unilateral Earthquake spamming" as
// a real Doubles synergy -- a spread move (WINCON_SPREAD_MOVES) also
// hits your own ally by default, so pairing it with a teammate immune to
// that move's type lets it be thrown every turn for free. This tests
// wcSpreadMoveSafetyMatch/wcSpreadMoveSafetyBonus (both directions,
// Singles-gated) and its wiring into wcDreamTeamCandidateScore.
//
// Run: node tools/test-spread-move-safety.mjs

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

const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");

// Real fixtures: Corviknight is Flying/Steel (immune to Ground), Kingambit
// really learns Earthquake (a real WINCON_SPREAD_MOVES entry, Ground-type
// per data/moves.json).
const CORVIKNIGHT = { name: "Corviknight", types: ["Flying", "Steel"], learnableNames: [] };
const KINGAMBIT_EQ = { name: "Kingambit", types: ["Dark", "Steel"], learnableNames: ["Earthquake"] };
const NON_IMMUNE = { name: "NonImmune", types: ["Normal"], learnableNames: [] };

check("wcSpreadMoveSafetyMatch finds the candidate-immune direction (Corviknight next to an Earthquake learner)", () => {
  const match = context.wcSpreadMoveSafetyMatch(CORVIKNIGHT, [KINGAMBIT_EQ], "doubles", movesData, typeChart);
  assert.notEqual(match, null);
  assert.equal(match.direction, "candidateSafeguards");
  assert.equal(match.moveName, "Earthquake");
  assert.equal(match.partnerName, "Kingambit");
});

check("wcSpreadMoveSafetyMatch finds the teammate-immune direction (an Earthquake learner joining Corviknight)", () => {
  const match = context.wcSpreadMoveSafetyMatch(KINGAMBIT_EQ, [CORVIKNIGHT], "doubles", movesData, typeChart);
  assert.notEqual(match, null);
  assert.equal(match.direction, "teammateSafeguards");
  assert.equal(match.moveName, "Earthquake");
  assert.equal(match.partnerName, "Corviknight");
});

check("wcSpreadMoveSafetyMatch is null when neither side is actually immune to a real spread move", () => {
  const match = context.wcSpreadMoveSafetyMatch(NON_IMMUNE, [KINGAMBIT_EQ], "doubles", movesData, typeChart);
  assert.equal(match, null);
});

check("wcSpreadMoveSafetyBonus fires the real bonus amount only when a match exists", () => {
  assert.equal(context.wcSpreadMoveSafetyBonus(CORVIKNIGHT, [KINGAMBIT_EQ], "doubles", movesData, typeChart), 0.75); // WC_SPREAD_SAFETY_BONUS in strategy.js
  assert.equal(context.wcSpreadMoveSafetyBonus(NON_IMMUNE, [KINGAMBIT_EQ], "doubles", movesData, typeChart), 0);
});

check("Singles gets nothing back even for an otherwise-qualifying pair -- a spread move never hits an ally there", () => {
  assert.equal(context.wcSpreadMoveSafetyBonus(CORVIKNIGHT, [KINGAMBIT_EQ], "singles", movesData, typeChart), 0);
  assert.equal(context.wcSpreadMoveSafetyMatch(CORVIKNIGHT, [KINGAMBIT_EQ], "singles", movesData, typeChart), null);
});

check("an empty team or missing movesData returns no match without throwing", () => {
  assert.equal(context.wcSpreadMoveSafetyMatch(CORVIKNIGHT, [], "doubles", movesData, typeChart), null);
  assert.equal(context.wcSpreadMoveSafetyMatch(CORVIKNIGHT, [KINGAMBIT_EQ], "doubles", null, typeChart), null);
});

// ---------------------------------------------------------------------------
// wcDreamTeamCandidateScore wiring -- true twins (identical types/baseStats,
// so every OTHER scoring term is identical), differing only in
// learnableNames so the ONLY thing that can separate them is the spread-
// safety bonus. natures/abilitiesData deliberately omitted so
// coverageGain falls back to the type-only branch (unaffected by
// learnableNames) and archetypeBonus/softPreferenceBonus stay 0 for both.
// ---------------------------------------------------------------------------

check("wcDreamTeamCandidateScore: a candidate that can learn a spread move a teammate is already immune to scores exactly WC_SPREAD_SAFETY_BONUS higher than an identical twin that can't", () => {
  const team = [CORVIKNIGHT]; // Flying/Steel, immune to Ground
  const twinWithEQ = { name: "TwinA", types: ["Dark", "Steel"], baseStats: { hp: 90, atk: 135, def: 80, spa: 60, spd: 85, spe: 50 }, learnableNames: ["Earthquake"] };
  const twinWithoutEQ = { name: "TwinB", types: ["Dark", "Steel"], baseStats: { hp: 90, atk: 135, def: 80, spa: 60, spd: 85, spe: 50 }, learnableNames: [] };
  const opts = { format: "doubles", movesData };
  const scoreA = context.wcDreamTeamCandidateScore(twinWithEQ, team, [], typeChart, typeChart.types, opts);
  const scoreB = context.wcDreamTeamCandidateScore(twinWithoutEQ, team, [], typeChart, typeChart.types, opts);
  assert.ok(Math.abs(scoreA - scoreB - 0.75) < 1e-9, `expected scoreA-scoreB (${scoreA - scoreB}) to equal 0.75`);
});

console.log("");
console.log(`All ${checks} spread-move safety checks passed.`);
