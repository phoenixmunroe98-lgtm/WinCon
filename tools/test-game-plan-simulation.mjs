// WinCon — tools/test-game-plan-simulation.mjs (Milestone 48)
//
// Regression test for the "WinCon Meta Analyst"-adjacent but separate
// Milestone 48 feature: the Simulated Win Rate now detects a built team's
// real game plans (wcBuildGamePlans, battle-sim-lineup.js) and simulates
// each one separately with role-weighted AI and role-ordered leads,
// instead of running one generic-AI battle and reporting a single blended
// number. Also covers the two engine-correctness pieces this feature
// needed as groundwork: Light Screen/Reflect/Aurora Veil's real damage
// reduction (previously a complete no-op), and a real bug where Tailwind's
// turn counter was silently decremented twice a turn in Doubles.
//
// Run: node tools/test-game-plan-simulation.mjs

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

// Same files, same order, as battle-sim-worker.js's importScripts list.
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

// ---------------------------------------------------------------------------
// Fixture: Phoenix's own real "Mega Sceptile & Charizard Y Dual-Core" team
// (the same one she pasted this session) -- real, learnable moves/items
// confirmed directly against data/learnsets.json and data/items.json
// before writing this fixture.
// ---------------------------------------------------------------------------

const CHOSEN_SIX = ["Staraptor", "Primarina", "Incineroar", "Steelix", "Sceptile", "Charizard"];

const BUILDS = {
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

// ---------------------------------------------------------------------------
// 1. wcBuildGamePlans -- detection and role assignment.
// ---------------------------------------------------------------------------

const rawPlans = context.wcBuildGamePlans(CHOSEN_SIX, BUILDS, pokemonList, baseStatsData, abilitiesData);
// Cross-realm arrays/objects built inside the vm context aren't
// reference-equal-prototype to this module's own literals -- a JSON
// round-trip produces an equivalent plain structure in THIS realm,
// which is all these plan objects ever need to be for comparison.
const plans = JSON.parse(JSON.stringify(rawPlans));

check("wcBuildGamePlans finds exactly 3 real plans for this real team (Tailwind x2 carries, Trick Room defence)", () => {
  const keys = plans.map((p) => p.key).sort();
  assert.deepEqual(keys, ["tailwind__Charizard", "tailwind__Sceptile", "trickroomdefense"]);
});

check("the Sceptile Tailwind plan assigns setter/screener/carry correctly", () => {
  const plan = plans.find((p) => p.key === "tailwind__Sceptile");
  assert.equal(plan.label, "Tailwind (carry: Sceptile)");
  assert.deepEqual(plan.archetypeKeys, ["tailwind"]);
  assert.equal(plan.roleByName.Staraptor, "setter");
  assert.equal(plan.roleByName.Primarina, "screener");
  assert.equal(plan.roleByName.Sceptile, "carry");
  assert.equal(plan.roleByName.Incineroar, "support");
  assert.equal(plan.roleByName.Steelix, "support");
  assert.equal(plan.roleByName.Charizard, "support");
  assert.deepEqual(plan.requiredNames, ["Staraptor", "Sceptile"]);
});

check("the Charizard Tailwind plan is a genuinely separate plan with its own carry", () => {
  const plan = plans.find((p) => p.key === "tailwind__Charizard");
  assert.equal(plan.label, "Tailwind (carry: Charizard)");
  assert.equal(plan.roleByName.Charizard, "carry");
  assert.equal(plan.roleByName.Sceptile, "support");
  assert.deepEqual(plan.requiredNames, ["Staraptor", "Charizard"]);
});

check("the Trick Room defence plan leads with the real Taunt user and the real screener", () => {
  const plan = plans.find((p) => p.key === "trickroomdefense");
  assert.equal(plan.label, "Trick Room defence");
  assert.equal(plan.roleByName.Incineroar, "setter"); // Taunt/Fake Out user, leads
  assert.equal(plan.roleByName.Primarina, "screener");
  assert.equal(plan.roleByName.Sceptile, "carry"); // first Mega-eligible member without an assigned role yet
  assert.deepEqual([...plan.requiredNames].sort(), ["Incineroar", "Primarina"]);
});

check("a team with no real archetype and no real anti-Trick-Room tooling gets exactly one Standard plan", () => {
  const plainBuilds = {};
  CHOSEN_SIX.forEach((name) => {
    plainBuilds[name] = {
      nature: "Adamant",
      item: "",
      moves: ["Protect", "Protect", "Protect", "Protect"],
      sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 },
    };
  });
  const plainPlans = JSON.parse(JSON.stringify(context.wcBuildGamePlans(CHOSEN_SIX, plainBuilds, pokemonList, baseStatsData, abilitiesData)));
  assert.equal(plainPlans.length, 1);
  assert.equal(plainPlans[0].key, "default");
  assert.equal(plainPlans[0].label, "Standard");
  CHOSEN_SIX.forEach((name) => assert.equal(plainPlans[0].roleByName[name], "neutral"));
  assert.deepEqual(plainPlans[0].requiredNames, []);
});

// ---------------------------------------------------------------------------
// 2. wcRoleWeightsFor / wcOrderLineupForPlan -- the two small primitives
// that turn a plan's roles into an actual AI/lead-order change.
// ---------------------------------------------------------------------------

check("wcRoleWeightsFor boosts exactly the payoffs each role cares about, on top of the real defaults", () => {
  const setterWeights = context.wcRoleWeightsFor("setter");
  assert.equal(setterWeights.tailwindUpScore, 90);
  assert.equal(setterWeights.expectedDamageWeight, context.WC_DEFAULT_AI_WEIGHTS.expectedDamageWeight); // untouched default carried through
  assert.equal(context.wcRoleWeightsFor("neutral"), null);
  assert.equal(context.wcRoleWeightsFor("support"), null);
});

check("wcOrderLineupForPlan leads with setter then screener, benches support then carry last", () => {
  const plan = { roleByName: { A: "carry", B: "support", C: "setter", D: "screener" } };
  const ordered = JSON.parse(JSON.stringify(context.wcOrderLineupForPlan(["A", "B", "C", "D"], plan)));
  assert.deepEqual(ordered, ["C", "D", "B", "A"]);
});

// ---------------------------------------------------------------------------
// 3. wcSimulateTeamWinRate's new { format, plans } shape, end to end --
// stubbing wcRunMonteCarlo (same technique tools/test-lineup-search.mjs
// uses) so this stays fast and deterministic without needing thousands of
// real simulated battles.
// ---------------------------------------------------------------------------

context.wcRunMonteCarlo = function fakeMonteCarlo(specs, oppPool, runsPerOpponent) {
  const totalRuns = oppPool.length * runsPerOpponent;
  return { winRate: 0.5, wins: Math.round(totalRuns * 0.5), losses: totalRuns - Math.round(totalRuns * 0.5), draws: 0, totalRuns, perOpponent: [] };
};

const metaBaseline = {
  doubles: [
    {
      id: "test-reference-a",
      label: "Test reference A",
      members: [
        { name: "Gholdengo", item: "Choice Specs", role: "fast-special", moves: ["Make It Rain", "Shadow Ball", "Trick", "Protect"] },
        { name: "Torkoal", item: "Charcoal", role: "bulky-special", moves: ["Eruption", "Protect", "Rock Slide", "Yawn"] },
      ],
    },
  ],
  singles: [],
};

const payload = {
  chosenSix: CHOSEN_SIX,
  builds: BUILDS,
  format: "doubles",
  sheetMode: "open",
  pokemonList, baseStatsData, abilitiesData, movesData,
  moveEffects, abilityEffects, itemEffects, typeChart, natures,
  metaBaseline, comboLookup: null, liveTierStats: null,
};

const result = JSON.parse(JSON.stringify(context.wcSimulateTeamWinRate(payload)));

check("wcSimulateTeamWinRate returns one plan per real detected game plan, each with its own 4-of-6 lineup", () => {
  assert.equal(result.format, "doubles");
  assert.equal(result.plans.length, 3);
  const byKey = {};
  result.plans.forEach((p) => { byKey[p.key] = p; });
  ["tailwind__Sceptile", "tailwind__Charizard", "trickroomdefense"].forEach((key) => {
    assert.ok(byKey[key], `expected a plan for ${key}`);
    assert.equal(byKey[key].lineup.length, 4);
    assert.ok(byKey[key].scenarios.length >= 1);
  });
});

check("each plan's own lineup actually contains that plan's required pieces", () => {
  result.plans.forEach((plan) => {
    const requiredNames = plans.find((p) => p.key === plan.key).requiredNames;
    requiredNames.forEach((name) => assert.ok(plan.lineup.includes(name), `${plan.key}'s lineup [${plan.lineup}] is missing required ${name}`));
  });
});

// ---------------------------------------------------------------------------
// 4. Screens (Light Screen/Reflect/Aurora Veil) now really halves damage --
// previously a complete no-op mechanically (no field state at all).
// ---------------------------------------------------------------------------

function makeSimpleSpec(name, moveNames) {
  const identity = pokemonList.find((p) => p.name === name);
  const baseStats = baseStatsData.find((b) => b.name === name);
  return {
    name,
    types: identity.types,
    baseStats,
    ability: null,
    build: {
      nature: "Hardy",
      item: "",
      moves: moveNames,
      sp: { hp: 0, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 0 },
    },
  };
}

const fixedRng = () => 0.5; // no crit (crit chance is well under 50%), fixed damage roll

check("a Special move deals exactly the real Doubles (0.66x) / Singles (0.5x) reduced damage when the defender's side has Light Screen up, and none at all when it doesn't", () => {
  const attackerSpec = makeSimpleSpec("Gengar", ["Sludge Bomb"]);
  const defenderSpec = makeSimpleSpec("Snorlax", ["Protect"]);
  const attacker = context.wcMakeBattler(attackerSpec, movesData, moveEffects, natures);
  const defenderNoScreen = context.wcMakeBattler(defenderSpec, movesData, moveEffects, natures);
  const defenderWithScreen = context.wcMakeBattler(defenderSpec, movesData, moveEffects, natures);
  defenderWithScreen.side = "opp";
  defenderNoScreen.side = "opp";
  const move = attacker.moves.find((m) => m.name === "Sludge Bomb");

  const fieldNoScreen = { screens: { me: { physical: 0, special: 0 }, opp: { physical: 0, special: 0 } } };
  const fieldWithScreen = { screens: { me: { physical: 0, special: 0 }, opp: { physical: 0, special: 5 } } };

  const dataDoubles = { typeChart, abilityEffects, itemEffects, format: "doubles" };
  const dataSingles = { typeChart, abilityEffects, itemEffects, format: "singles" };

  const noScreenHit = context.wcResolveOneHit(attacker, move, defenderNoScreen, fieldNoScreen, dataDoubles, fixedRng);
  const doublesScreenHit = context.wcResolveOneHit(attacker, move, defenderWithScreen, fieldWithScreen, dataDoubles, fixedRng);
  const singlesScreenHit = context.wcResolveOneHit(attacker, move, defenderWithScreen, fieldWithScreen, dataSingles, fixedRng);

  assert.ok(noScreenHit.damage > 0);
  assert.equal(doublesScreenHit.damage, Math.max(1, Math.floor(noScreenHit.damage * 0.66)));
  assert.equal(singlesScreenHit.damage, Math.max(1, Math.floor(noScreenHit.damage * 0.5)));
});

check("Reflect only reduces Physical damage, not Special -- Light Screen only reduces Special, not Physical", () => {
  const attackerSpec = makeSimpleSpec("Machamp", ["Close Combat"]);
  const defenderSpec = makeSimpleSpec("Snorlax", ["Protect"]);
  const attacker = context.wcMakeBattler(attackerSpec, movesData, moveEffects, natures);
  const defender = context.wcMakeBattler(defenderSpec, movesData, moveEffects, natures);
  defender.side = "opp";
  const move = attacker.moves.find((m) => m.name === "Close Combat");
  assert.equal(move.category, "Physical");

  const fieldLightScreenOnly = { screens: { me: { physical: 0, special: 0 }, opp: { physical: 0, special: 5 } } };
  const fieldReflectOnly = { screens: { me: { physical: 0, special: 0 }, opp: { physical: 5, special: 0 } } };
  const fieldNone = { screens: { me: { physical: 0, special: 0 }, opp: { physical: 0, special: 0 } } };
  const data = { typeChart, abilityEffects, itemEffects, format: "doubles" };

  const baseline = context.wcResolveOneHit(attacker, move, defender, fieldNone, data, fixedRng).damage;
  const underLightScreen = context.wcResolveOneHit(attacker, move, defender, fieldLightScreenOnly, data, fixedRng).damage;
  const underReflect = context.wcResolveOneHit(attacker, move, defender, fieldReflectOnly, data, fixedRng).damage;

  assert.equal(underLightScreen, baseline, "Light Screen must not reduce a Physical move");
  assert.equal(underReflect, Math.max(1, Math.floor(baseline * 0.66)), "Reflect must reduce a Physical move");
});

check("screens are ignored on a critical hit, exactly as the real move text says", () => {
  const attackerSpec = makeSimpleSpec("Gengar", ["Sludge Bomb"]);
  const defenderSpec = makeSimpleSpec("Snorlax", ["Protect"]);
  const attacker = context.wcMakeBattler(attackerSpec, movesData, moveEffects, natures);
  const defender = context.wcMakeBattler(defenderSpec, movesData, moveEffects, natures);
  defender.side = "opp";
  const move = attacker.moves.find((m) => m.name === "Sludge Bomb");
  const fieldWithScreen = { screens: { me: { physical: 0, special: 0 }, opp: { physical: 0, special: 5 } } };
  const fieldNone = { screens: { me: { physical: 0, special: 0 }, opp: { physical: 0, special: 0 } } };
  const data = { typeChart, abilityEffects, itemEffects, format: "doubles" };

  const forcedCritRng = () => 0; // rng() < critChance is true at 0, forcing a crit; the same 0 draw also feeds randMod, identical on both sides below
  const critNoScreen = context.wcResolveOneHit(attacker, move, defender, fieldNone, data, forcedCritRng);
  const critWithScreen = context.wcResolveOneHit(attacker, move, defender, fieldWithScreen, data, forcedCritRng);
  assert.ok(critNoScreen.isCrit && critWithScreen.isCrit, "fixture must actually force a crit for this check to mean anything");
  assert.equal(critWithScreen.damage, critNoScreen.damage, "a real crit should ignore screens entirely");
});

// ---------------------------------------------------------------------------
// 5. Tailwind's real bug fix -- wcApplyEndOfTurn used to decrement
// tailwindTurns itself, once per ACTIVE BATTLER on a side (2 in Doubles),
// silently halving its real 4-turn duration. Direct white-box check that
// wcApplyEndOfTurn no longer touches it at all.
// ---------------------------------------------------------------------------

check("wcApplyEndOfTurn no longer decrements tailwindTurns itself (that used to run once per active battler, halving Tailwind's duration in Doubles)", () => {
  const spec = makeSimpleSpec("Snorlax", ["Protect"]);
  const battlerOne = context.wcMakeBattler(spec, movesData, moveEffects, natures);
  const battlerTwo = context.wcMakeBattler(spec, movesData, moveEffects, natures);
  const field = { tailwindTurns: { me: 4, opp: 0 }, screens: { me: { physical: 0, special: 0 }, opp: { physical: 0, special: 0 } } };
  // Simulate one full turn's worth of Doubles end-of-turn processing: two
  // active battlers on the "me" side, exactly as wcRunOneBattle's main
  // loop does (`active[side].forEach((b) => wcApplyEndOfTurn(...))`).
  context.wcApplyEndOfTurn(battlerOne, field, "me", abilityEffects, itemEffects);
  context.wcApplyEndOfTurn(battlerTwo, field, "me", abilityEffects, itemEffects);
  assert.equal(field.tailwindTurns.me, 4, "tailwindTurns must be untouched by wcApplyEndOfTurn regardless of how many active battlers call it");
});

console.log(`\nAll ${checksRun} checks passed.`);
