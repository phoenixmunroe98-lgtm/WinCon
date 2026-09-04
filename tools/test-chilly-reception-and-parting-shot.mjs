// WinCon — tools/test-chilly-reception-and-parting-shot.mjs
//
// Two small refinements (Milestone 39: Phoenix's Status-move audit):
//   1. Chilly Reception (Slowking/Galarian Slowking only, 2/298 species
//      -- genuinely rare and deliberate, unlike Sunny Day/Rain Dance)
//      folds into the existing snow archetype as a second, move-based
//      setter path alongside Snow Warning, which stays preferred (no
//      move slot spent) when both exist.
//   2. Parting Shot (lowers Atk/SpA by 1, then switches out) is added to
//      WINCON_PIVOT_MOVES, the same pivot-sequencing set Tailwind's own
//      amendment note already reads from.
//
// Run: node tools/test-chilly-reception-and-parting-shot.mjs

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

// Slowking: real Chilly Reception learner, real ability is Regenerator
// (NOT Snow Warning) -- confirms the move-based path fires with no
// snow-setting ability anywhere on the team.
const slowking = { name: "Slowking", types: typesFor("Slowking"), baseStats: statsFor("Slowking"), learnableNames: learnsets["Slowking"] };

check("Slowking (learns Chilly Reception, Regenerator -- not Snow Warning) carries the snow archetype signal", () => {
  const signals = context.wcArchetypeSignalsFor(slowking, "doubles", abilitiesData);
  assert.ok(signals.includes("snow"), `expected "snow" in ${JSON.stringify(signals)}`);
});

check("wcAnalyzeTeamStrategy proposes a snow amendment via Chilly Reception when no Snow Warning setter is on the team (synthetic fixtures, isolating just this mechanic)", () => {
  // Same rationale as test-helping-hand.mjs/test-safeguard-archetype.mjs:
  // the two real Chilly Reception learners also carry many other
  // archetype moves, so synthetic fixtures isolate this one mechanic.
  const chillyMon = { name: "ChillyMon", types: ["Ice"], baseStats: { hp: 80, atk: 60, def: 80, spa: 60, spd: 80, spe: 80 }, learnableNames: ["Chilly Reception"] };
  const iceBeneficiary = { name: "IceBeneficiary", types: ["Ice"], baseStats: { hp: 80, atk: 60, def: 80, spa: 60, spd: 80, spe: 80 }, learnableNames: [] };
  const members = [chillyMon, iceBeneficiary];
  const builds = {
    ChillyMon: { nature: "Bold", item: "Leftovers", moves: ["Chilly Reception", "Scald", "Yawn", "Fling"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
    IceBeneficiary: { nature: "Impish", item: "Sitrus Berry", moves: ["Icicle Spear", "Protect", "Rest", "Sleep Talk"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  const winner = result.archetype === "snow" ? result : result.alternative && result.alternative.archetype === "snow" ? result.alternative : null;
  assert.ok(winner, `expected "snow" among the proposed strategies, got ${JSON.stringify([result.archetype, result.alternative && result.alternative.archetype])}`);
  assert.match(winner.note, /Chilly Reception/, `expected the Chilly Reception path, got: ${winner.note}`);
});

check("a real Snow Warning ability setter is still preferred over Chilly Reception when both exist on the team", () => {
  const abilityMon = { name: "AbilityMon", types: ["Ice"], baseStats: { hp: 80, atk: 60, def: 80, spa: 60, spd: 80, spe: 80 }, learnableNames: [] };
  const chillyMon = { name: "ChillyMon", types: ["Normal"], baseStats: { hp: 80, atk: 60, def: 80, spa: 60, spd: 80, spe: 80 }, learnableNames: ["Chilly Reception"] };
  const members = [chillyMon, abilityMon];
  const builds = {
    ChillyMon: { nature: "Bold", item: "Leftovers", moves: ["Chilly Reception", "Toxic", "Protect", "Fling"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
    AbilityMon: { nature: "Impish", item: "Sitrus Berry", moves: ["Icicle Spear", "Protect", "Rest", "Sleep Talk"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } },
  };
  const abilities = Object.assign({}, abilitiesData, { AbilityMon: { ability: "Snow Warning" } });
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilities, null);
  const winner = result.archetype === "snow" ? result : result.alternative && result.alternative.archetype === "snow" ? result.alternative : null;
  assert.ok(winner, `expected "snow" among the proposed strategies, got ${JSON.stringify([result.archetype, result.alternative && result.alternative.archetype])}`);
  assert.match(winner.note, /AbilityMon/, `expected AbilityMon (the ability setter) to be preferred, got: ${winner.note}`);
  assert.doesNotMatch(winner.note, /Chilly Reception/, `expected the ability path, NOT Chilly Reception, got: ${winner.note}`);
});

check("WINCON_PIVOT_MOVES now includes Parting Shot", () => {
  // vm.createContext doesn't expose top-level `const` declarations as own
  // properties on the sandbox object (only `function`/`var` do), so
  // WINCON_PIVOT_MOVES itself isn't reachable via context.* here -- same
  // known gotcha worked around elsewhere in this test suite. Exercise it
  // indirectly instead, through the one place it's actually read: the
  // Tailwind amendment's pivot-sequencing note in wcAnalyzeTeamStrategy.
  const partingShotMon = { name: "PartingShotMon", types: ["Dark"], baseStats: { hp: 80, atk: 90, def: 80, spa: 60, spd: 80, spe: 130 }, learnableNames: ["Tailwind", "Parting Shot"] };
  const fastPartner = { name: "FastPartner", types: ["Normal"], baseStats: { hp: 80, atk: 100, def: 80, spa: 60, spd: 80, spe: 110 }, learnableNames: [] };
  const members = [partingShotMon, fastPartner];
  const builds = {
    PartingShotMon: { nature: "Jolly", item: "Focus Sash", moves: ["Sucker Punch", "Knock Off", "Protect", "Fake Out"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 } },
    FastPartner: { nature: "Jolly", item: "Life Orb", moves: ["Return", "Protect", "Rock Slide", "Earthquake"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  const winner = result.archetype === "tailwind" ? result : result.alternative && result.alternative.archetype === "tailwind" ? result.alternative : null;
  assert.ok(winner, `expected "tailwind" among the proposed strategies, got ${JSON.stringify([result.archetype, result.alternative && result.alternative.archetype])}`);
  assert.match(winner.note, /Parting Shot/, `expected the pivot-sequencing note to recognize Parting Shot, got: ${winner.note}`);
});

console.log("");
console.log(`All ${checks} Chilly Reception / Parting Shot checks passed.`);
