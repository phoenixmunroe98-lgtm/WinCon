// WinCon — tools/test-pool-scope-toggle.mjs
//
// Milestone 40: "My Pokédex" vs. "Full Pokédex" toggle for Generate Dream
// Team. The new pure logic lives in two places: wcGetPoolScope/wcEmptyTeam
// in teams.js (the per-team field, saved/loaded exactly the way
// sheetMode/format already are — tested directly below), and the "full"
// branch of eligibleObtainedMembers() in builder.js (drops the obtained-
// only filter and returns every Base-form species with confirmed
// base-stat/learnset data, excluding Mega forms the same way
// buildRivalPool() already does).
//
// builder.js itself has never been unit-tested in this project — every
// existing test file loads only the pure, DOM-free modules (type-utils.js/
// stats.js/megas.js/strategy.js, and now teams.js), because builder.js's
// top-level code reaches for real DOM elements (document.getElementById)
// the instant it's loaded, and reads/writes localStorage/sessionStorage
// through getObtainedNames(). Rather than fake up a DOM to load it, this
// file mirrors eligibleObtainedMembers()'s exact "full" predicate — not a
// Mega form, has real baseStats, has a real learnset — directly against
// the real data files (the same honest boundary strategy.js's own tests
// already draw), and checks it behaves the way the feature promises:
// Mega forms excluded, real species included, and genuinely different
// (much bigger) than a small "obtained" list would ever produce.
//
// Run: node tools/test-pool-scope-toggle.mjs

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

const SCRIPT_FILES = ["type-utils.js", "stats.js", "megas.js", "strategy.js", "teams.js"];
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

const pokemonData = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const learnsets = loadJSON("data/learnsets.json");
const baseStatsNames = new Set(baseStatsData.map((b) => b.name));

// ---------------------------------------------------------------------------
// wcEmptyTeam / wcGetPoolScope (teams.js)
// ---------------------------------------------------------------------------

check("wcEmptyTeam defaults poolScope to \"obtained\"", () => {
  const team = context.wcEmptyTeam("Team 1");
  assert.equal(team.poolScope, "obtained");
});

check("wcGetPoolScope defaults to \"obtained\" for a team saved before this milestone (no poolScope field)", () => {
  assert.equal(context.wcGetPoolScope({ id: "x", name: "Legacy Team" }), "obtained");
});

check("wcGetPoolScope defaults to \"obtained\" for null/undefined", () => {
  assert.equal(context.wcGetPoolScope(null), "obtained");
  assert.equal(context.wcGetPoolScope(undefined), "obtained");
});

check("wcGetPoolScope returns \"full\" when the team's field says so", () => {
  assert.equal(context.wcGetPoolScope({ poolScope: "full" }), "full");
});

check("wcGetPoolScope falls back to \"obtained\" for any unexpected value (defensive, same pattern as wcGetTeamFormat/wcGetSheetMode)", () => {
  assert.equal(context.wcGetPoolScope({ poolScope: "everything" }), "obtained");
  assert.equal(context.wcGetPoolScope({ poolScope: 1 }), "obtained");
});

check("a real wcEmptyTeam team round-trips through wcGetPoolScope as \"obtained\"", () => {
  const team = context.wcEmptyTeam("Team 1");
  assert.equal(context.wcGetPoolScope(team), "obtained");
});

// ---------------------------------------------------------------------------
// eligibleObtainedMembers()'s "full" branch, mirrored against real data
// (see the file header for why this is checked at the data layer rather
// than by loading builder.js).
// ---------------------------------------------------------------------------

function buildFullPokedexPool() {
  const eligible = [];
  pokemonData.forEach((pokemon) => {
    if (context.wcIsMegaForm(pokemon)) return;
    if (!baseStatsNames.has(pokemon.name)) return;
    if (!learnsets[pokemon.name]) return;
    eligible.push(pokemon.name);
  });
  return eligible;
}

check("the full-Pokédex pool excludes every Mega form", () => {
  const pool = new Set(buildFullPokedexPool());
  const megaNames = pokemonData.filter((p) => context.wcIsMegaForm(p)).map((p) => p.name);
  assert.ok(megaNames.length > 0, "sanity: the roster actually has Mega form entries to test against");
  megaNames.forEach((name) => {
    assert.ok(!pool.has(name), `expected Mega form "${name}" to be excluded from the full-Pokédex pool`);
  });
});

check("the full-Pokédex pool includes real Base-form species with confirmed data (Phoenix's own reference-team roster)", () => {
  const pool = new Set(buildFullPokedexPool());
  ["Staraptor", "Primarina", "Sneasler", "Sceptile", "Steelix", "Charizard"].forEach((name) => {
    assert.ok(pool.has(name), `expected "${name}" to be in the full-Pokédex pool`);
  });
});

check("every species in the full-Pokédex pool genuinely has base stats and a non-empty learnset (never a half-confirmed entry)", () => {
  const pool = buildFullPokedexPool();
  assert.ok(pool.length > 0);
  pool.forEach((name) => {
    assert.ok(baseStatsNames.has(name), `${name} is missing base stats`);
    assert.ok(Array.isArray(learnsets[name]) && learnsets[name].length > 0, `${name} has no real learnset`);
  });
});

check("the full-Pokédex pool is dramatically bigger than a small \"obtained\" list -- the whole point of the toggle", () => {
  const fullPool = buildFullPokedexPool();
  const smallObtainedExample = ["Pikachu", "Charizard", "Greninja"];
  assert.ok(fullPool.length > smallObtainedExample.length * 20, `expected the full pool (${fullPool.length}) to dwarf a small obtained list (${smallObtainedExample.length})`);
  assert.ok(fullPool.length >= 6, "Generate Dream Team needs at least 6 -- Full Pokédex mode should never itself be the bottleneck");
});

console.log("");
console.log(`All ${checks} pool-scope-toggle checks passed.`);
