// WinCon — tools/test-full-lineup-sweep.mjs (Milestone 57)
//
// Regression test for Milestone 57's full-lineup-sweep rewrite of the
// Builder's Simulated Win Rate (Phoenix: her own two real, tournament-
// successful lineups -- "Whimsicott, Primarina, Tyranitar, Steelix" and
// "Whimsicott, Tyranitar, Primarina, Garchomp" -- never showed up in the
// old results, because a cheap successive-halving search narrowed every
// real C(6,4)/C(6,3) candidate down to one lineup per detected game plan
// before ever running a full simulation on the rest). This file replaces
// tools/test-lineup-search.mjs, which tested that now-deleted search --
// its adversarial-stub technique (a stub deliberately contradicting a
// cheap ranking) is adapted below to prove the NEW, stronger property:
// nothing is narrowed or eliminated at all, every real combo gets its
// own full, real simulated result.
//
// Run: node tools/test-full-lineup-sweep.mjs

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

// Same files, same order, as battle-sim-worker.js's importScripts list --
// these are the DOM-free modules the real Worker loads.
const SCRIPT_FILES = [
  "type-utils.js",
  "stats.js",
  "megas.js",
  "strategy.js",
  "battle-stages.js",
  "battle-damage.js",
  "battle-turn-order.js",
  "battle-sim-baseline.js",
  "battle-sim-engine.js",
  "battle-sim-ai.js",
  "battle-sim-lineup.js",
];

const context = vm.createContext({ console });
SCRIPT_FILES.forEach((file) => {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  vm.runInContext(code, context, { filename: file });
});

const pokemonList = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const natures = loadJSON("data/natures.json");
const moveEffects = loadJSON("data/move-effects.json");
const abilityEffects = loadJSON("data/ability-effects.json");
const itemEffects = loadJSON("data/item-effects.json");

let checksRun = 0;
function check(description, fn) {
  fn();
  checksRun += 1;
  console.log(`OK  ${description}`);
}

const keyOf = (names) => [...names].sort().join(",");

// ---------------------------------------------------------------------------
// Fixture A: a real 6-Pokemon Doubles team with no Mega-eligible member and
// no detected archetype (same fixture tools/test-lineup-search.mjs used) --
// keeps sections 1-2 fast and free of Mega-scenario branching, since those
// sections are about combo completeness/ordering, not archetype detection.
// ---------------------------------------------------------------------------

const FIXTURE_A_SIX = ["Kingambit", "Sneasler", "Basculegion", "Garchomp", "Incineroar", "Dragonite"];

function emptyBuild() {
  return {
    nature: "Adamant",
    item: "",
    moves: ["Protect", "Protect", "Protect", "Protect"],
    sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 },
  };
}

const FIXTURE_A_BUILD_OVERRIDES = {
  Kingambit: { item: "Life Orb", moves: ["Kowtow Cleave", "Sucker Punch", "Swords Dance", "Protect"] },
  Sneasler: { item: "Focus Sash", moves: ["Close Combat", "Dire Claw", "Protect", "Fake Out"] },
  Basculegion: { item: "Choice Band", moves: ["Wave Crash", "Flip Turn", "Aqua Jet", "Liquidation"] },
  Garchomp: { item: "Rocky Helmet", moves: ["Earthquake", "Stone Edge", "Scale Shot", "Protect"] },
  Incineroar: { item: "Sitrus Berry", moves: ["Flare Blitz", "Fake Out", "Parting Shot", "Protect"] },
  Dragonite: { item: "Choice Band", moves: ["Scale Shot", "Extreme Speed", "Protect", "Dragon Dance"] },
};

const fixtureABuilds = {};
FIXTURE_A_SIX.forEach((name) => {
  fixtureABuilds[name] = { ...emptyBuild(), ...FIXTURE_A_BUILD_OVERRIDES[name] };
});

// A tiny but real reference field -- one team, trimmed to 3 members, which
// is all wcResolveBaselineTeam needs to produce a valid opponent-pool
// entry. None of these are Mega-eligible for Fixture A's six, so every
// candidate combo resolves to exactly one Mega scenario (no Mega branching
// to worry about in sections 1-2).
const fixtureAMetaBaseline = {
  doubles: [
    {
      id: "test-reference-a",
      label: "Test reference A",
      members: [
        { name: "Gholdengo", item: "Choice Specs", role: "fast-special", moves: ["Make It Rain", "Shadow Ball", "Trick", "Protect"] },
        { name: "Whimsicott", item: "Focus Sash", role: "fast-special", moves: ["Tailwind", "Moonblast", "Encore", "Protect"] },
        { name: "Torkoal", item: "Charcoal", role: "bulky-special", moves: ["Eruption", "Protect", "Rock Slide", "Yawn"] },
      ],
    },
  ],
  singles: [],
};

const fixtureAPayload = {
  chosenSix: FIXTURE_A_SIX,
  builds: fixtureABuilds,
  format: "doubles",
  sheetMode: "open",
  pokemonList,
  baseStatsData,
  abilitiesData,
  movesData,
  moveEffects,
  abilityEffects,
  itemEffects,
  typeChart,
  natures,
  metaBaseline: fixtureAMetaBaseline,
  liveTierStats: null,
};

const realLineups = context.wcEnumerateLineups(FIXTURE_A_SIX, 4);
assert.equal(realLineups.length, 15, "expected C(6,4) = 15 candidate lineups for a 6-Pokemon Doubles team");
const realLineupKeys = new Set(realLineups.map((names) => keyOf(names)));

// ---------------------------------------------------------------------------
// 1. Every real combo is present, simulated with the real engine, and the
// result is genuinely complete -- no narrowing, no exclusion.
// ---------------------------------------------------------------------------

const realResult = context.wcSimulateTeamWinRate(fixtureAPayload);

check("wcSimulateTeamWinRate returns { format, n, combos, averageWinRate } with exactly one entry per real C(6,4) combination", () => {
  assert.equal(realResult.format, "doubles");
  assert.equal(realResult.n, 4);
  assert.equal(realResult.combos.length, 15);
});

check("every real C(6,4) combination is present exactly once -- nothing narrowed or excluded for not fitting a detected plan", () => {
  const resultKeys = realResult.combos.map((c) => keyOf(c.lineup));
  assert.equal(new Set(resultKeys).size, 15, "expected 15 distinct combos, found a duplicate");
  resultKeys.forEach((k) => assert.ok(realLineupKeys.has(k), `combo [${k}] is not a real C(6,4) combination of the fixture's six`));
  realLineupKeys.forEach((k) => assert.ok(resultKeys.includes(k), `real combination [${k}] is missing from the result entirely`));
});

check("combos are sorted by real win rate, most successful first", () => {
  for (let i = 1; i < realResult.combos.length; i += 1) {
    assert.ok(
      realResult.combos[i - 1].winRate >= realResult.combos[i].winRate,
      `combos[${i - 1}] (${realResult.combos[i - 1].winRate}) should be >= combos[${i}] (${realResult.combos[i].winRate})`
    );
  }
});

check("averageWinRate is the real plain mean across every combo, not a weighted or partial figure", () => {
  const expectedMean = realResult.combos.reduce((sum, c) => sum + c.winRate, 0) / realResult.combos.length;
  assert.ok(Math.abs(realResult.averageWinRate - expectedMean) < 1e-9, `expected averageWinRate ${expectedMean}, got ${realResult.averageWinRate}`);
});

// ---------------------------------------------------------------------------
// 2. Adversarial stub (adapted from the deleted tools/test-lineup-search.mjs):
// stub wcRunMonteCarlo with a controlled "ground truth" win rate per combo,
// deliberately NOT the enumeration order's first or last entry, so there's
// no way to pass this by accident from iteration order alone. Proves the
// true best combo (per the stub) genuinely sorts to combos[0], AND -- the
// property that actually matters post-Milestone-57 -- that this took
// exactly one wcRunMonteCarlo call per combo, never more. The old test
// asserted `monteCarloCallCount > lineups.length` (proof a multi-round
// search ran); the new, correct invariant is the opposite: no search
// rounds at all, just one real simulation per real combo.
// ---------------------------------------------------------------------------

const trueBestKey = keyOf(realLineups[7]); // an arbitrary middle entry, not first or last
const trueWorstKey = keyOf(realLineups[0]);

let monteCarloCallCount = 0;
const realMonteCarlo = context.wcRunMonteCarlo;
context.wcRunMonteCarlo = function fakeMonteCarlo(myLineupSpecs, oppLineupPool, runsPerOpponent, format, simData) {
  monteCarloCallCount += 1;
  const key = keyOf(myLineupSpecs.map((s) => s.name));
  let winRate;
  if (key === trueBestKey) winRate = 0.95;
  else if (key === trueWorstKey) winRate = 0.05;
  else winRate = 0.5;

  const totalRuns = oppLineupPool.length * runsPerOpponent;
  const wins = Math.round(winRate * totalRuns);
  return {
    winRate,
    wins,
    losses: totalRuns - wins,
    draws: 0,
    totalRuns,
    perOpponent: oppLineupPool.map((opp) => ({ id: opp.id, label: opp.label, winRate })),
  };
};

try {
  check("with a stubbed real engine, the true-best combo (per the stub, not enumeration order) correctly sorts to combos[0]", () => {
    monteCarloCallCount = 0;
    const stubbedResult = context.wcSimulateTeamWinRate(fixtureAPayload);
    const topKey = keyOf(stubbedResult.combos[0].lineup);
    assert.equal(topKey, trueBestKey, `expected combos[0] to be the stubbed true-best [${trueBestKey}], got [${topKey}]`);
    assert.ok(Math.abs(stubbedResult.combos[0].winRate - 0.95) < 1e-9);
  });

  check("exactly one wcRunMonteCarlo call happens per real combo -- no elimination round, no re-simulation, nothing narrowed", () => {
    monteCarloCallCount = 0;
    context.wcSimulateTeamWinRate(fixtureAPayload);
    // Fixture A has no Mega-eligible member, so wcBuildMegaScenarios
    // returns exactly one scenario per combo -- 15 combos, 15 calls.
    assert.equal(monteCarloCallCount, realLineups.length, `expected exactly ${realLineups.length} wcRunMonteCarlo calls (one per real combo), got ${monteCarloCallCount}`);
  });
} finally {
  context.wcRunMonteCarlo = realMonteCarlo;
}

// ---------------------------------------------------------------------------
// Fixture B: Phoenix's real "Mega Sceptile & Charizard Y Dual-Core" team
// (same fixture tools/test-game-plan-simulation.mjs uses) -- two real
// Mega-eligible members on one team, and a real detected Tailwind plan, so
// sections 3-4 can test wcPlanForCombo's per-combo role assignment and the
// never-simultaneous-Mega invariant against real Mega-scenario branching.
// ---------------------------------------------------------------------------

const FIXTURE_B_SIX = ["Staraptor", "Primarina", "Incineroar", "Steelix", "Sceptile", "Charizard"];

const FIXTURE_B_BUILDS = {
  Staraptor: {
    nature: "Jolly",
    item: "Focus Sash",
    moves: ["Tailwind", "Protect", "Brave Bird", "Close Combat"],
    sp: { hp: 0, attack: 20, defense: 0, sp_attack: 0, sp_defense: 4, speed: 32 },
  },
  Primarina: {
    nature: "Modest",
    item: "Light Clay",
    moves: ["Reflect", "Light Screen", "Hyper Voice", "Dazzling Gleam"],
    sp: { hp: 16, attack: 0, defense: 4, sp_attack: 32, sp_defense: 0, speed: 12 },
  },
  Incineroar: {
    nature: "Sassy",
    item: "Safety Goggles",
    moves: ["Fake Out", "Taunt", "Parting Shot", "Throat Chop"],
    sp: { hp: 32, attack: 20, defense: 0, sp_attack: 0, sp_defense: 12, speed: 0 },
  },
  Steelix: {
    nature: "Brave",
    item: "Leftovers",
    moves: ["Heavy Slam", "Earthquake", "Wide Guard", "Rock Slide"],
    sp: { hp: 20, attack: 32, defense: 12, sp_attack: 0, sp_defense: 0, speed: 0 },
  },
  Sceptile: {
    nature: "Timid",
    item: "Sceptilite",
    moves: ["Leaf Storm", "Dragon Pulse", "Earth Power", "Focus Blast"],
    sp: { hp: 0, attack: 0, defense: 0, sp_attack: 32, sp_defense: 4, speed: 28 },
  },
  Charizard: {
    nature: "Timid",
    item: "Charizardite Y",
    moves: ["Heat Wave", "Solar Beam", "Focus Blast", "Protect"],
    sp: { hp: 4, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 28 },
  },
};

const fixtureBPlans = JSON.parse(
  JSON.stringify(context.wcBuildGamePlans(FIXTURE_B_SIX, FIXTURE_B_BUILDS, pokemonList, baseStatsData, abilitiesData))
);
const fixtureBLineups = context.wcEnumerateLineups(FIXTURE_B_SIX, 4);

// ---------------------------------------------------------------------------
// 3. wcPlanForCombo -- role-weighted AI/lead order is applied only to the
// specific real combos that genuinely satisfy a detected plan's required
// pieces, never to every combo indiscriminately and never withheld from a
// combo that does qualify.
// ---------------------------------------------------------------------------

check("wcPlanForCombo returns the matching plan for every real combo containing that plan's required pieces, and null for every combo that doesn't fit any detected plan", () => {
  fixtureBLineups.forEach((names) => {
    const plan = context.wcPlanForCombo(names, fixtureBPlans);
    const expectedPlan = fixtureBPlans.find((p) => p.requiredNames.every((req) => names.includes(req))) || null;
    if (expectedPlan === null) {
      assert.equal(plan, null, `combo [${names}] should not match any real detected plan`);
    } else {
      assert.ok(plan, `combo [${names}] should match plan ${expectedPlan.key}`);
      assert.equal(plan.key, expectedPlan.key);
    }
  });
});

check("a combo containing both a plan's real setter and carry is treated differently from one missing either piece -- confirmed against the real Sceptile Tailwind plan", () => {
  const sceptilePlan = fixtureBPlans.find((p) => p.key === "tailwind__Sceptile");
  assert.ok(sceptilePlan, "expected a real tailwind__Sceptile plan for this fixture");

  const qualifyingCombo = fixtureBLineups.find((names) => sceptilePlan.requiredNames.every((req) => names.includes(req)));
  const nonQualifyingCombo = fixtureBLineups.find((names) => !sceptilePlan.requiredNames.every((req) => names.includes(req)));
  assert.ok(qualifyingCombo, "expected at least one real combo containing the Sceptile Tailwind plan's required pieces");
  assert.ok(nonQualifyingCombo, "expected at least one real combo missing at least one required piece");

  assert.ok(context.wcPlanForCombo(qualifyingCombo, fixtureBPlans), "a combo with all required pieces must resolve to a real plan, not null");
  const nonMatch = context.wcPlanForCombo(nonQualifyingCombo, fixtureBPlans);
  if (nonMatch) {
    assert.notEqual(nonMatch.key, sceptilePlan.key, "a combo missing the Sceptile plan's required pieces must not resolve to that same plan");
  }
});

// ---------------------------------------------------------------------------
// 4. Never-simultaneous-Mega invariant against the new pipeline (Phoenix:
// "using sceptile and charizard in a team would mean only one is a mega").
// wcBuildMegaScenarios already guarantees this structurally (each scenario
// forces exactly one Mega-eligible member to "mega", every other eligible
// member to "base"), but this is a direct regression test proving it holds
// for real combos containing BOTH of this fixture's Mega-eligible members,
// run through the actual new entry point (wcSimulateOneCombo), not just
// asserted against wcBuildMegaScenarios in isolation.
// ---------------------------------------------------------------------------

const dualMegaCombos = fixtureBLineups.filter((names) => names.includes("Sceptile") && names.includes("Charizard"));

check("Fixture B has at least one real combo containing both Sceptile and Charizard (the scenario this invariant is actually about)", () => {
  assert.ok(dualMegaCombos.length > 0, "expected at least one real C(6,4) combo with both Mega-eligible members");
});

check("wcSimulateOneCombo never resolves both Sceptile and Charizard to \"mega\" in the same scenario's spec build, for every real combo containing both", () => {
  const capturedForcedViews = [];
  const realBattlerSpecForSlot = context.wcBattlerSpecForSlot;
  context.wcBattlerSpecForSlot = function spyBattlerSpecForSlot(baseName, build, pl, bsd, ad, forcedMegaView) {
    capturedForcedViews.push({ baseName, forcedMegaView });
    return realBattlerSpecForSlot(baseName, build, pl, bsd, ad, forcedMegaView);
  };

  const referenceTeamDefs = [
    {
      id: "test-reference-b",
      label: "Test reference B",
      members: [
        { name: "Gholdengo", item: "Choice Specs", role: "fast-special", moves: ["Make It Rain", "Shadow Ball", "Trick", "Protect"] },
        { name: "Torkoal", item: "Charcoal", role: "bulky-special", moves: ["Eruption", "Protect", "Rock Slide", "Yawn"] },
      ],
    },
  ];
  const referenceTeams = referenceTeamDefs.map((team) => context.wcResolveBaselineTeam(team, pokemonList, baseStatsData, abilitiesData));
  const oppPool = referenceTeamDefs.map((team, i) => ({ id: team.id, label: team.label, specs: referenceTeams[i], weight: 1 }));
  const simData = { movesData, moveEffects, abilityEffects, itemEffects, typeChart, natures, sheetMode: "open", format: "doubles" };

  try {
    dualMegaCombos.forEach((names) => {
      capturedForcedViews.length = 0;
      context.wcSimulateOneCombo(names, FIXTURE_B_BUILDS, "doubles", pokemonList, baseStatsData, abilitiesData, oppPool, simData, fixtureBPlans);

      // wcBuildMegaScenarios resolves each scenario's full specsByName in
      // one pass, lineup-length calls at a time (one per real Mega
      // candidate scenario -- Sceptile-mega-alone, then Charizard-mega-
      // alone). Group the captured calls into those same lineup-length
      // chunks and check each chunk independently -- a real Mega
      // candidate's own scenario never simultaneously forces the other
      // real candidate to "mega" too.
      const chunkSize = names.length;
      for (let start = 0; start < capturedForcedViews.length; start += chunkSize) {
        const chunk = capturedForcedViews.slice(start, start + chunkSize);
        const sceptileCall = chunk.find((c) => c.baseName === "Sceptile");
        const charizardCall = chunk.find((c) => c.baseName === "Charizard");
        assert.ok(sceptileCall && charizardCall, `expected both Sceptile and Charizard resolved in each scenario's spec build for combo [${names}]`);
        assert.ok(
          !(sceptileCall.forcedMegaView === "mega" && charizardCall.forcedMegaView === "mega"),
          `combo [${names}]: Sceptile and Charizard were both forced to "mega" in the same scenario -- an impossible real Doubles state`
        );
      }
    });
  } finally {
    context.wcBattlerSpecForSlot = realBattlerSpecForSlot;
  }
});

console.log(`\nAll ${checksRun} checks passed.`);
