// WinCon — tools/test-aurora-veil-screens.mjs
//
// Aurora Veil (Milestone 39: Phoenix's Status-move audit) extends the
// existing screens archetype rather than becoming a ninth one -- it's
// strictly better than Light Screen + Reflect combined (one move covers
// both physical and special) but only works while Snow is active, so it
// only ever counts as a real screens signal for a Pokemon that sets its
// OWN Snow (e.g. Alolan Ninetales, Snow Warning). This tests that gate,
// plus that wcAnalyzeTeamStrategy prefers the Aurora Veil path when it's
// genuinely available and falls back to the pre-existing Prankster/plain
// screens behavior (a real regression guard on Milestone 37's own code)
// otherwise.
//
// Run: node tools/test-aurora-veil-screens.mjs

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

// Real fixtures, confirmed against the actual data files:
//  - Alolan Ninetales: Snow Warning (sets its own Snow) AND learns Aurora
//    Veil -- the genuinely self-sufficient case this whole feature exists
//    for. Doesn't learn Light Screen or Reflect at all.
//  - Ninetales (Kantonian): Drought (NOT snow), also learns Aurora Veil
//    but can never actually use it without a teammate's snow -- a real
//    negative case, not a contrived one.
//  - Whimsicott: Prankster, learns Light Screen/Reflect but not Aurora
//    Veil -- the pre-existing Milestone 37 case, must be untouched.
const alolanNinetales = { name: "Alolan Ninetales", types: typesFor("Alolan Ninetales"), baseStats: statsFor("Alolan Ninetales"), learnableNames: learnsets["Alolan Ninetales"] };
const ninetales = { name: "Ninetales", types: typesFor("Ninetales"), baseStats: statsFor("Ninetales"), learnableNames: learnsets["Ninetales"] };
const whimsicott = { name: "Whimsicott", types: typesFor("Whimsicott"), baseStats: statsFor("Whimsicott"), learnableNames: learnsets["Whimsicott"] };
const kingambit = { name: "Kingambit", types: typesFor("Kingambit"), baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] };

check("Alolan Ninetales (Snow Warning + learns Aurora Veil) carries the screens signal", () => {
  const signals = context.wcArchetypeSignalsFor(alolanNinetales, "doubles", abilitiesData);
  assert.ok(signals.includes("screens"), JSON.stringify(signals));
});

check("Ninetales (Drought, NOT snow -- learns Aurora Veil but can't use it self-sufficiently) does NOT carry the screens signal", () => {
  const signals = context.wcArchetypeSignalsFor(ninetales, "doubles", abilitiesData);
  assert.ok(!signals.includes("screens"), JSON.stringify(signals));
});

check("regression guard: Whimsicott (Prankster, Light Screen/Reflect, no Aurora Veil) still carries the screens signal exactly as before", () => {
  const signals = context.wcArchetypeSignalsFor(whimsicott, "doubles", abilitiesData);
  assert.ok(signals.includes("screens"), JSON.stringify(signals));
});

check("wcAnalyzeTeamStrategy prefers Aurora Veil over Light Screen/Reflect when a self-sufficient snow setter is on the team", () => {
  const members = [
    { name: "Alolan Ninetales", slotName: "Alolan Ninetales", types: typesFor("Alolan Ninetales"), baseStats: statsFor("Alolan Ninetales"), learnableNames: learnsets["Alolan Ninetales"] },
    { name: "Kingambit", slotName: "Kingambit", types: typesFor("Kingambit"), baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] },
  ];
  const builds = {
    "Alolan Ninetales": { nature: "Timid", item: "Light Clay", moves: ["Blizzard", "Moonblast", "Aurora Veil", "Encore"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 32 } },
    Kingambit: { nature: "Adamant", item: "Black Glasses", moves: ["Sucker Punch", "Kowtow Cleave", "Iron Head", "Swords Dance"], sp: { hp: 32, attack: 32, defense: 0, sp_attack: 0, sp_defense: 2, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  const winner = result.archetype === "screens" ? result : result.alternative && result.alternative.archetype === "screens" ? result.alternative : null;
  assert.ok(winner, `expected "screens" among the proposed strategies, got ${JSON.stringify([result.archetype, result.alternative && result.alternative.archetype])}`);
  assert.match(winner.note, /Aurora Veil/, `expected the Aurora Veil path to win, got: ${winner.note}`);
});

check("regression guard: wcAnalyzeTeamStrategy still proposes the plain Light Screen/Reflect screens path when no self-sufficient Aurora Veil setter is present", () => {
  const members = [
    { name: "Whimsicott", slotName: "Whimsicott", types: typesFor("Whimsicott"), baseStats: statsFor("Whimsicott"), learnableNames: learnsets["Whimsicott"] },
    { name: "Kingambit", slotName: "Kingambit", types: typesFor("Kingambit"), baseStats: statsFor("Kingambit"), learnableNames: learnsets["Kingambit"] },
  ];
  const builds = {
    Whimsicott: { nature: "Timid", item: "Light Clay", moves: ["Moonblast", "Light Screen", "Reflect", "Tailwind"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 32 } },
    Kingambit: { nature: "Adamant", item: "Black Glasses", moves: ["Sucker Punch", "Kowtow Cleave", "Iron Head", "Swords Dance"], sp: { hp: 32, attack: 32, defense: 0, sp_attack: 0, sp_defense: 2, speed: 0 } },
  };
  const threats = [{ name: "T1", types: ["Grass"] }, { name: "T2", types: ["Water"] }];
  const result = context.wcAnalyzeTeamStrategy(members, builds, movesData, threats, typeChart, "doubles", "", abilitiesData, null);
  const winner = result.archetype === "screens" ? result : result.alternative && result.alternative.archetype === "screens" ? result.alternative : null;
  assert.ok(winner, `expected "screens" among the proposed strategies, got ${JSON.stringify([result.archetype, result.alternative && result.alternative.archetype])}`);
  assert.match(winner.note, /Light Screen/, `expected the plain screens path, got: ${winner.note}`);
  assert.doesNotMatch(winner.note, /Aurora Veil/, `expected the plain screens path, NOT Aurora Veil, got: ${winner.note}`);
});

check("WINCON_NOTES_KEYWORDS screens boost now also recognizes \"aurora veil\"", () => {
  const candidates = [{ archetype: "screens", fitScore: 1, setterName: "Alolan Ninetales" }];
  const boosted = context.wcApplyNotesBias(candidates, "I really want aurora veil up");
  assert.equal(boosted.length, 1);
  assert.equal(boosted[0].fitScore, 1 + 3);
});

console.log("");
console.log(`All ${checks} Aurora Veil / screens checks passed.`);
