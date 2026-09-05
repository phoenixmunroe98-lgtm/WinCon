// WinCon — tools/test-lineup-search.mjs
//
// Regression test for Milestone 35, Task 1: the successive-halving lineup
// search in battle-sim-lineup.js's wcSimulateTeamWinRate. Run with:
//   node tools/test-lineup-search.mjs
//
// The property this proves: the OLD selection step ranked all C(6,4)/C(6,3)
// candidate lineups once with wcScoreMatchup (strategy.js — type
// effectiveness + Speed only, no abilities/items/real damage) and simulated
// only its #1 pick with the real engine. If that cheap ranking was wrong,
// the true best lineup was never simulated at all. The NEW selection step
// (wcSelectBestLineupBySuccessiveHalving) uses the real mechanical engine
// (wcRunMonteCarlo) at every round instead.
//
// To test that without needing to hand-craft a real team/ability/item
// interaction subtle enough to fool wcScoreMatchup (fragile, and it would
// break the moment anyone tunes the heuristic's weights), this stubs
// wcRunMonteCarlo itself with a deterministic, fully-controlled "ground
// truth" win rate per lineup — set up to directly contradict whatever the
// real, unstubbed wcScoreMatchup ranks as best. Everything else (lineup
// enumeration, battler-spec construction, Mega-scenario branching) runs for
// real. This isolates exactly the property in question — "does the search
// find the lineup with the highest real-engine win rate, even when the
// cheap proxy disagrees" — from the separate (and separately covered)
// question of whether the damage engine itself is correct.

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

// Same files, same order, as battle-sim-worker.js's importScripts list —
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

// ---------------------------------------------------------------------------
// Fixture: a real 6-Pokémon Doubles team + a small real reference field.
// ---------------------------------------------------------------------------

const pokemonList = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const natures = loadJSON("data/natures.json");
const moveEffects = loadJSON("data/move-effects.json");
const abilityEffects = loadJSON("data/ability-effects.json");
const itemEffects = loadJSON("data/item-effects.json");

const CHOSEN_SIX = ["Kingambit", "Sneasler", "Basculegion", "Garchomp", "Incineroar", "Dragonite"];

function emptyBuild() {
  return {
    nature: "Adamant",
    item: "",
    moves: ["Protect", "Protect", "Protect", "Protect"],
    sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 },
  };
}

const BUILD_OVERRIDES = {
  Kingambit: { item: "Life Orb", moves: ["Kowtow Cleave", "Sucker Punch", "Swords Dance", "Protect"] },
  Sneasler: { item: "Focus Sash", moves: ["Close Combat", "Dire Claw", "Protect", "Fake Out"] },
  Basculegion: { item: "Choice Band", moves: ["Wave Crash", "Flip Turn", "Aqua Jet", "Liquidation"] },
  Garchomp: { item: "Rocky Helmet", moves: ["Earthquake", "Stone Edge", "Scale Shot", "Protect"] },
  Incineroar: { item: "Sitrus Berry", moves: ["Flare Blitz", "Fake Out", "Parting Shot", "Protect"] },
  Dragonite: { item: "Choice Band", moves: ["Scale Shot", "Extreme Speed", "Protect", "Dragon Dance"] },
};

const builds = {};
CHOSEN_SIX.forEach((name) => {
  builds[name] = { ...emptyBuild(), ...BUILD_OVERRIDES[name] };
});

// A tiny but real reference field — one team, trimmed to 3 members, which is
// all wcResolveBaselineTeam needs to produce a valid opponent-pool entry.
// None of these are Mega-eligible for our six, so every candidate lineup
// resolves to exactly one Mega scenario, keeping the assertions simple.
const metaBaseline = {
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

const payload = {
  chosenSix: CHOSEN_SIX,
  builds,
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
  metaBaseline,
  comboLookup: null,
};

// ---------------------------------------------------------------------------
// Step 1: find out what the OLD cheap-heuristic-only ranking would have
// picked, by calling the exact same functions wcSimulateTeamWinRate used to
// call before Task 1 (wcRankLineupsHeuristic is still present — it's still
// used by wcBestLineupAgainstReference for the Battle Tracker's Team vs Team
// tool — we're just not driving the Builder's Simulated Win Rate with it
// anymore).
// ---------------------------------------------------------------------------

const n = 4; // Doubles: bring 4 of 6
const lineups = context.wcEnumerateLineups(CHOSEN_SIX, n);
assert.equal(lineups.length, 15, "expected C(6,4) = 15 candidate lineups for a 6-Pokémon Doubles team");

const specsByName = {};
CHOSEN_SIX.forEach((name) => {
  specsByName[name] = context.wcBattlerSpecForSlot(name, builds[name], pokemonList, baseStatsData, abilitiesData);
});

const referenceTeamDefs = metaBaseline.doubles;
const referenceTeams = referenceTeamDefs.map((team) => context.wcResolveBaselineTeam(team, pokemonList, baseStatsData, abilitiesData));

const rankData = { typeChart, natures, movesData, sheetMode: payload.sheetMode };
const heuristicRanked = context.wcRankLineupsHeuristic(lineups, specsByName, referenceTeams, rankData, null);

const keyOf = (names) => [...names].sort().join(",");
const heuristicTopKey = keyOf(heuristicRanked[0].names);
const heuristicWorstKey = keyOf(heuristicRanked[heuristicRanked.length - 1].names);

assert.notEqual(
  heuristicTopKey,
  heuristicWorstKey,
  "fixture must have a heuristic ranking with a distinct #1 and last pick to be a meaningful adversarial test"
);

// ---------------------------------------------------------------------------
// Step 2: stub wcRunMonteCarlo with a controlled "ground truth" that
// deliberately inverts the cheap heuristic's judgment — the heuristic's #1
// pick is actually mediocre (0.40), and the lineup the heuristic ranked
// DEAD LAST is actually the true best (0.95). Every other candidate gets a
// fixed middle value, clearly below the true best, so there's no ambiguity
// about which lineup should win.
// ---------------------------------------------------------------------------

let monteCarloCallCount = 0;
context.wcRunMonteCarlo = function fakeMonteCarlo(myLineupSpecs, oppLineupPool, runsPerOpponent) {
  monteCarloCallCount += 1;
  const key = keyOf(myLineupSpecs.map((s) => s.name));
  let winRate;
  if (key === heuristicWorstKey) winRate = 0.95; // true best — heuristic ranked this LAST
  else if (key === heuristicTopKey) winRate = 0.4; // heuristic's #1 pick — actually mediocre
  else winRate = 0.6; // every other candidate — deterministic middle value

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

// ---------------------------------------------------------------------------
// Step 3: run the real (now-patched) top-level entry point and confirm it
// finds the true best lineup, not the cheap heuristic's wrong #1 pick.
// ---------------------------------------------------------------------------

const result = context.wcSimulateTeamWinRate(payload);

// Milestone 48: wcSimulateTeamWinRate now returns { format, plans } --
// one plan per real detected game plan the team can run, always at
// least one. This fixture's builds (BUILD_OVERRIDES above) have no
// Tailwind/Trick Room/screens moves and no real anti-Trick-Room tooling,
// so wcBuildGamePlans falls back to exactly one "Standard" plan -- this
// test's own concern (does the successive-halving search beat the cheap
// heuristic) is unaffected by that change, just addressed through
// result.plans[0] instead of the old flat result.lineup/result.scenarios.
assert.equal(result.format, "doubles");
assert.equal(result.plans.length, 1, "a team with no detected archetype should get exactly one (Standard) plan back");
const plan = result.plans[0];
assert.equal(plan.key, "default");
const resultKey = keyOf(plan.lineup);

assert.equal(plan.lineup.length, 4);
assert.equal(
  resultKey,
  heuristicWorstKey,
  `expected the true-best lineup [${heuristicWorstKey}] (which the cheap heuristic ranked LAST) — got [${resultKey}] instead`
);
assert.notEqual(
  resultKey,
  heuristicTopKey,
  "search settled for the cheap heuristic's #1 pick instead of the real-engine best — the bug this task fixes"
);

assert.ok(plan.scenarios.length >= 1, "expected at least one Mega scenario");
plan.scenarios.forEach((scenario) => {
  assert.ok(
    Math.abs(scenario.winRate - 0.95) < 1e-9,
    `final full-accuracy stage should report the true (stubbed) win rate 0.95 for the winning lineup, got ${scenario.winRate}`
  );
});

// Sanity check that this actually ran a multi-round search rather than,
// say, silently short-circuiting to a single wcRunMonteCarlo call.
assert.ok(
  monteCarloCallCount > lineups.length,
  `expected more than ${lineups.length} wcRunMonteCarlo calls across all rounds + the final stage, got ${monteCarloCallCount}`
);

console.log(`PASS: cheap heuristic's #1 pick was [${heuristicTopKey}] (true win rate 0.40)`);
console.log(`PASS: real-engine successive-halving search correctly found [${resultKey}] instead (true win rate 0.95)`);
console.log(`PASS: final scenario win rate matches the true value, and the search made ${monteCarloCallCount} wcRunMonteCarlo calls across all rounds`);
console.log("\nAll assertions passed.");
