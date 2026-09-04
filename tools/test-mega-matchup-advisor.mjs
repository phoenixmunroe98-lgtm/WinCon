// WinCon — tools/test-mega-matchup-advisor.mjs
//
// Phoenix's Tailwind/Staraptor/screens request: "im wanting to use either
// mega charizard or mega sceptile as my megas ... allow for both megas to
// be in the team and be seen as interchangeable (dependant on the
// opponents team)". WinCon never enforced "only one real Mega per
// roster" -- Mega Evolution is a once-per-battle choice made at Team
// Preview, not a per-slot restriction (see wcPickAutoMegaForm), so both
// being built onto the same roster already worked with zero new code.
// What was missing was the actual "which one this game" guidance --
// wcMegaMatchupAdvice, tested here.
//
// Run: node tools/test-mega-matchup-advisor.mjs

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

const typeChart = loadJSON("data/type-chart.json");

// Real fixtures, confirmed directly against data/pokemon.json /
// data/base-stats.json: Mega Charizard Y is Fire/Flying, Mega Sceptile is
// Grass/Dragon -- both real WINCON_MEGA_STONES keys (Charizardite Y /
// Sceptilite), so wcMegaMatchupAdvice recognizes them as real Megas.
const CHARIZARD_Y = { name: "Mega Charizard Y", types: ["Fire", "Flying"], baseStats: { hp: 78, atk: 104, def: 78, spa: 159, spd: 115, spe: 100 } };
const SCEPTILE = { name: "Mega Sceptile", types: ["Grass", "Dragon"], baseStats: { hp: 70, atk: 110, def: 75, spa: 145, spd: 85, spe: 145 } };
const PLAIN_NON_MEGA = { name: "Whimsicott", types: ["Grass", "Fairy"], baseStats: { hp: 60, atk: 59, def: 67, spa: 85, spd: 77, spe: 116 } };

check("wcMegaMatchupAdvice returns null with zero real Megas built", () => {
  const threats = [{ name: "Threat1", types: ["Rock"] }];
  assert.equal(context.wcMegaMatchupAdvice([PLAIN_NON_MEGA], threats, typeChart), null);
});

check("wcMegaMatchupAdvice returns null with only one real Mega built (nothing to compare)", () => {
  const threats = [{ name: "Threat1", types: ["Rock"] }];
  assert.equal(context.wcMegaMatchupAdvice([CHARIZARD_Y, PLAIN_NON_MEGA], threats, typeChart), null);
});

check("wcMegaMatchupAdvice ranks two real Megas against a threat list weighted toward one side, and names the stronger fit first", () => {
  // A Rock-heavy threat list: Mega Charizard Y (Fire/Flying) is 4x weak
  // to Rock and doesn't hit it hard; Mega Sceptile (Grass/Dragon)
  // resists Rock and hits it super effectively -- a real, unambiguous
  // matchup edge for Sceptile here.
  const threats = [{ name: "RockThreat1", types: ["Rock"] }, { name: "RockThreat2", types: ["Rock"] }];
  const advice = context.wcMegaMatchupAdvice([CHARIZARD_Y, SCEPTILE], threats, typeChart);
  assert.notEqual(advice, null);
  assert.equal(advice.ranked.length, 2);
  assert.equal(advice.ranked[0].name, "Mega Sceptile");
  assert.ok(advice.ranked[0].score > advice.ranked[1].score);
  assert.match(advice.note, /Mega Sceptile/);
  assert.match(advice.note, /Mega Charizard Y/);
  assert.match(advice.note, /interchangeable/);
  assert.match(advice.note, /not a full damage calc/);
});

check("wcMegaMatchupAdvice's ranking flips when the threat list favors the other Mega instead", () => {
  // Flip the scenario: an Ice-heavy threat list. Mega Sceptile (Grass/
  // Dragon) is 4x weak to Ice; Mega Charizard Y (Fire/Flying) only takes
  // a normal hit and threatens back neutrally -- confirms this reacts to
  // the actual threat list rather than always favoring the same Mega.
  const threats = [{ name: "IceThreat1", types: ["Ice"] }, { name: "IceThreat2", types: ["Ice"] }];
  const advice = context.wcMegaMatchupAdvice([CHARIZARD_Y, SCEPTILE], threats, typeChart);
  assert.notEqual(advice, null);
  assert.equal(advice.ranked[0].name, "Mega Charizard Y");
});

check("wcMegaMatchupAdvice never drops or mutates either roster member", () => {
  const threats = [{ name: "RockThreat1", types: ["Rock"] }];
  const before = [CHARIZARD_Y, SCEPTILE].map((m) => JSON.stringify(m));
  context.wcMegaMatchupAdvice([CHARIZARD_Y, SCEPTILE], threats, typeChart);
  const after = [CHARIZARD_Y, SCEPTILE].map((m) => JSON.stringify(m));
  assert.deepEqual(before, after);
});

console.log("");
console.log(`All ${checks} Mega matchup advisor checks passed.`);
