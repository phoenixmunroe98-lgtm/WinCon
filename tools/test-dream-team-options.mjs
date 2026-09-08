// WinCon — tools/test-dream-team-options.mjs
//
// Milestone 45: "give me multiple team options" for Generate Dream Team.
// Depends on two earlier-phase primitives already being in place --
// topCandidatesFromRemaining/wcWeightedPickFromTop (Milestone 42) and
// wcAssignTeamSynergy's baked-in strategy assignment (Milestone 43) --
// confirmed present below before anything else runs. Tests the
// wcPickDreamTeamOptions wrapper: Option 1 built normally, Option 2 built
// from a pool with Option 1's mechanism-defining pick (wcAssignTeamSynergy's
// chosen setter for its primary archetype) excluded entirely.
//
// Milestone 55 removed wcPickDreamTeam's old guaranteed-Mega-slot
// mechanism (see strategy.js's own comment on wcPickDreamTeam) -- this
// file used to also test a guaranteedMegaNames field and a Mega-core half
// of the exclusion set; both are gone now, and mechanismDefiningNames is
// just the real setter (or empty, for an "independent" archetype with no
// setter -- see the new option2:null guard this exposed, tested below).
//
// Run: node tools/test-dream-team-options.mjs

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

// ---------------------------------------------------------------------------
// Dependency confirmation: this feature is built entirely on top of two
// earlier-phase primitives -- fail loudly and immediately if either is
// somehow missing, rather than producing confusing failures below.
// ---------------------------------------------------------------------------

check("dependency check: topCandidatesFromRemaining/wcWeightedPickFromTop (Milestone 42) exist", () => {
  assert.equal(typeof context.topCandidatesFromRemaining, "function");
  assert.equal(typeof context.wcWeightedPickFromTop, "function");
});

check("dependency check: wcAssignTeamSynergy (Milestone 43's baked-in strategy assignment) exists", () => {
  assert.equal(typeof context.wcAssignTeamSynergy, "function");
  assert.equal(typeof context.wcBuildStrategyCandidates, "function");
});

check("dependency check: wcPickDreamTeamOptions exists", () => {
  assert.equal(typeof context.wcPickDreamTeamOptions, "function");
});

const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const baseStatsData = loadJSON("data/base-stats.json");
const learnsets = loadJSON("data/learnsets.json");
const abilitiesData = loadJSON("data/abilities.json");
const pokemonData = loadJSON("data/pokemon.json");

function statsFor(name) {
  return baseStatsData.find((b) => b.name === name);
}

function megaFormsFor(baseName) {
  return context
    .wcMegaFormsOf(pokemonData, baseName)
    .map((m) => ({ name: m.name, types: m.types, baseStats: statsFor(m.name) }))
    .filter((m) => m.baseStats);
}

function poolMember(name) {
  return { name, types: pokemonData.find((p) => p.name === name).types, baseStats: statsFor(name), learnableNames: learnsets[name], megaForms: megaFormsFor(name) };
}

const THREATS = [{ name: "Grass Threat", types: ["Grass"] }, { name: "Steel Threat", types: ["Steel"] }];

// ---------------------------------------------------------------------------
// wcPickDreamTeamOptions: the real, full-roster integration test. Fully
// deterministic (no diversify sampling anywhere in this call chain), so
// this is a genuine regression-safe check, not a flaky one.
// ---------------------------------------------------------------------------

function buildFullPool() {
  const pool = [];
  pokemonData.forEach((pokemon) => {
    if (context.wcIsMegaForm(pokemon)) return;
    const baseStats = statsFor(pokemon.name);
    const learnableNames = learnsets[pokemon.name];
    if (baseStats && learnableNames) {
      pool.push({ name: pokemon.name, types: pokemon.types, baseStats, learnableNames, megaForms: megaFormsFor(pokemon.name) });
    }
  });
  return pool;
}

const FULL_POOL = buildFullPool();

check("the full real-data pool has plenty of eligible species to work with", () => {
  assert.ok(FULL_POOL.length > 100, `expected a large real pool, got ${FULL_POOL.length}`);
});

check("wcPickDreamTeamOptions produces two full, real, genuinely different 6-member teams from the full pool", () => {
  const result = context.wcPickDreamTeamOptions(
    FULL_POOL, THREATS, typeChart, 6, "", [], null, movesData, abilitiesData, null, null, "doubles", null, null, null, "closed", null
  );
  assert.ok(result.option1, "Option 1 must always be populated");
  assert.equal(result.option1.pick.chosen.length, 6);
  assert.ok(result.option2, "the full pool is huge -- Option 2 must be buildable");
  assert.equal(result.option2.pick.chosen.length, 6);

  assert.notDeepEqual(
    JSON.parse(JSON.stringify([...result.option1.pick.chosen].sort())),
    JSON.parse(JSON.stringify([...result.option2.pick.chosen].sort())),
    "Option 2 must be a genuinely different roster, not a copy of Option 1"
  );
});

check("Option 2's roster is built from a pool with NONE of Option 1's mechanism-defining pick in it -- the core disjointness guarantee", () => {
  const result = context.wcPickDreamTeamOptions(
    FULL_POOL, THREATS, typeChart, 6, "", [], null, movesData, abilitiesData, null, null, "doubles", null, null, null, "closed", null
  );
  assert.ok(result.mechanismDefiningNames.length > 0, "a real full-pool team against a real threat list should have a real strategy setter");

  const option2Names = new Set(result.option2.pick.chosen);
  result.mechanismDefiningNames.forEach((name) => {
    assert.ok(!option2Names.has(name), `Option 2 must never re-include Option 1's mechanism-defining pick "${name}"`);
  });

  // And the mechanism-defining set is itself exactly Option 1's real
  // strategy setter -- not some unrelated list (Milestone 55 removed the
  // old guaranteed-Mega-picks half of this set entirely).
  const expected = new Set();
  if (result.option1.strategy && result.option1.strategy.setterName) expected.add(result.option1.strategy.setterName);
  assert.deepEqual(new Set(result.mechanismDefiningNames), expected);
});

check("Option 1 and Option 2 genuinely differ in mechanism -- a different primary strategy setter", () => {
  const result = context.wcPickDreamTeamOptions(
    FULL_POOL, THREATS, typeChart, 6, "", [], null, movesData, abilitiesData, null, null, "doubles", null, null, null, "closed", null
  );
  const setter1 = result.option1.strategy && result.option1.strategy.setterName;
  const setter2 = result.option2.strategy && result.option2.strategy.setterName;
  if (setter1 && setter2) {
    assert.notEqual(setter1, setter2, "the two options' primary strategy setters must be different Pokemon");
  }
});

check("both options come with a real, already-baked-in strategy (Milestone 43) and a full 4-move build for every member", () => {
  const result = context.wcPickDreamTeamOptions(
    FULL_POOL, THREATS, typeChart, 6, "", [], null, movesData, abilitiesData, null, null, "doubles", null, null, null, "closed", null
  );
  [result.option1, result.option2].forEach((option) => {
    assert.ok(option.strategy && typeof option.strategy.archetype === "string");
    option.pick.chosen.forEach((name) => {
      assert.ok(option.builds[name], `expected a real build for ${name}`);
      assert.equal(option.builds[name].moves.length, 4);
    });
  });
});

// ---------------------------------------------------------------------------
// The honest null case #1: not enough remaining eligible Pokemon after
// excluding Option 1's real strategy setter to build a genuinely
// different second team. Deterministic by construction: with `size`
// (6) real species in the pool, Option 1 must use every single one of
// them, so excluding even just its one setter always leaves 5 -- below
// the 6 needed -- regardless of which archetype happens to win the
// strategy analysis. (Confirmed empirically against this exact fixture
// during Milestone 55's implementation, not assumed: option1 here picks
// Steelix as its real setter.)
// ---------------------------------------------------------------------------

check("wcPickDreamTeamOptions returns option2: null (not a worse, incomplete option) when the pool is too small after excluding the real setter", () => {
  const smallPool = [
    poolMember("Staraptor"), poolMember("Charizard"), poolMember("Slowbro"),
    poolMember("Gengar"), poolMember("Kingambit"), poolMember("Steelix"),
  ];
  const result = context.wcPickDreamTeamOptions(
    smallPool, THREATS, typeChart, 6, "", [], null, movesData, abilitiesData, null, null, "doubles", null, null, null, "closed", null
  );
  assert.ok(result.option1, "Option 1 should still build fine from exactly 6 real species");
  assert.equal(result.option1.pick.chosen.length, 6);
  assert.equal(result.option2, null, "only 5 species would remain after excluding the 1 real setter -- below the 6 needed for a real Option 2");
  assert.ok(result.mechanismDefiningNames.length >= 1);
});

// ---------------------------------------------------------------------------
// The honest null case #2 (Milestone 55, new): an "independent" Option 1
// with no real strategy setter at all -- since the old guaranteed-Mega
// exclusion is gone, there's nothing left to exclude, so re-running the
// exact same, unexcluded pool would just silently return an identical
// team rather than a real second option. wcPickDreamTeamOptions must
// return option2: null here instead, same honest-null philosophy as
// case #1 above. A neutral fixture (identical stats/typing, no threats --
// same convention test-archetype-synergy-picking.mjs already
// established) reliably produces "independent" with no setterName.
// ---------------------------------------------------------------------------

check("wcPickDreamTeamOptions returns option2: null when Option 1 has no real strategy setter to exclude (an 'independent' archetype)", () => {
  const stats = { hp: 70, atk: 70, def: 70, spa: 70, spd: 70, spe: 70 };
  const neutralPool = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"].map((name) => ({
    name,
    types: ["Normal"],
    baseStats: stats,
    learnableNames: [],
  }));
  const result = context.wcPickDreamTeamOptions(
    neutralPool, [], typeChart, 6, "", [], null, movesData, abilitiesData, null, null, "doubles", null, null, null, "closed", null
  );
  assert.ok(result.option1, "Option 1 should still build fine from 8 real (synthetic) species");
  assert.equal(result.option1.pick.chosen.length, 6);
  assert.equal(result.option1.strategy.archetype, "independent", "this neutral fixture should produce no shared win condition");
  assert.equal(result.option1.strategy.setterName, null);
  assert.deepEqual(JSON.parse(JSON.stringify(result.mechanismDefiningNames)), []);
  assert.equal(result.option2, null, "nothing real to exclude means no genuinely different Option 2 -- must be an honest null, not a silent duplicate of Option 1");
});

console.log("");
console.log(`All ${checks} dream-team-options checks passed.`);
