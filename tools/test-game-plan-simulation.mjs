// WinCon — tools/test-game-plan-simulation.mjs (Milestone 48)
//
// Regression test for wcBuildGamePlans (battle-sim-lineup.js) -- the
// detector for a built team's real game plans (Tailwind/Trick Room per
// real carry/setter candidate), and the two small primitives built on top
// of it: wcRoleWeightsFor (role-weighted AI overlays) and
// wcOrderLineupForPlan (setter/screener-first lead ordering). As of
// Milestone 57, Simulated Win Rate no longer narrows to one lineup per
// detected plan before simulating it -- it fully simulates every real
// lineup combination, applying a plan's role-weighted AI only to the
// specific combos that satisfy that plan's required pieces (see
// tools/test-full-lineup-sweep.mjs for that full-sweep behavior). This
// file's remaining coverage is the still-live pieces underneath that:
// game-plan detection itself, wcBattlerSpecForSlot's forced base/mega
// view resolution, and wcBulkPoints' real bulk scoring -- plus the two
// engine-correctness pieces Milestone 48 needed as groundwork: Light
// Screen/Reflect/Aurora Veil's real damage reduction (previously a
// complete no-op), and a real bug where Tailwind's turn counter was
// silently decremented twice a turn in Doubles.
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

// ---------------------------------------------------------------------------
// 6. Milestone 49: wcBuildGamePlans lets team notes override which real
// setter candidate gets the role, instead of always defaulting to the
// fastest candidate. (This section previously also covered
// wcTypeCoverBonus/wcStatCoverBonus/wcCarryPlanBonus's carry-synergy
// scoring for a plan's free lineup slots; those were removed in
// Milestone 57's full-lineup-sweep rewrite, which no longer narrows to
// one lineup per plan before scoring it -- every real combination is
// simulated directly instead.)
// ---------------------------------------------------------------------------

check("wcBuildGamePlans now genuinely lets team notes override which real setter candidate gets the role (previously hardcoded to \"\", a real gap this milestone closes)", () => {
  // A small dedicated fixture: two real, legal Tailwind learners on one
  // team, so there's an actual choice for notes to influence.
  const twoSetterSix = ["Staraptor", "Whimsicott", "Primarina", "Incineroar", "Steelix", "Sceptile"];
  const twoSetterBuilds = {
    ...BUILDS,
    Whimsicott: {
      nature: "Timid",
      item: "Focus Sash",
      moves: ["Tailwind", "Moonblast", "Encore", "Protect"],
      sp: { hp: 0, attack: 0, defense: 0, sp_attack: 20, sp_defense: 4, speed: 32 },
    },
  };
  delete twoSetterBuilds.Charizard;

  const noNotesPlans = JSON.parse(
    JSON.stringify(context.wcBuildGamePlans(twoSetterSix, twoSetterBuilds, pokemonList, baseStatsData, abilitiesData, ""))
  );
  const defaultSetter = noNotesPlans.find((p) => p.key.startsWith("tailwind__")).roleByName;
  const defaultSetterName = Object.keys(defaultSetter).find((name) => defaultSetter[name] === "setter");

  const otherCandidate = defaultSetterName === "Staraptor" ? "Whimsicott" : "Staraptor";
  const notedPlans = JSON.parse(
    JSON.stringify(
      context.wcBuildGamePlans(twoSetterSix, twoSetterBuilds, pokemonList, baseStatsData, abilitiesData, `Always lead with ${otherCandidate} to set Tailwind.`)
    )
  );
  const notedSetterRoles = notedPlans.find((p) => p.key.startsWith("tailwind__")).roleByName;
  const notedSetterName = Object.keys(notedSetterRoles).find((name) => notedSetterRoles[name] === "setter");
  assert.equal(notedSetterName, otherCandidate, "team notes naming a real Tailwind-capable teammate should override the default (fastest) setter pick");
});

// ---------------------------------------------------------------------------
// 7. Milestone 49 follow-up: Phoenix caught a real, pre-existing bug --
// "using sceptile and charizard in a team would mean only one is a mega,
// this means you should take into account sceptiles base stats not its
// mega evolved and vice versa". wcBattlerSpecForSlot's forcedMegaView
// param is what makes that possible -- forcing "base" or "mega" resolves
// a member's real effective typing/stats for that specific view. (This
// section previously also covered wcMegaOverridesForSearch and
// wcSimulatePlan's search-phase Mega discipline; both were removed in
// Milestone 57's full-lineup-sweep rewrite -- the same never-simultaneous-
// Mega invariant is now covered directly against wcBuildMegaScenarios in
// tools/test-full-lineup-sweep.mjs.)
// ---------------------------------------------------------------------------

check("wcBattlerSpecForSlot's forced \"base\" view genuinely resolves Sceptile's real base (non-Mega) typing, not Mega Sceptile's Grass/Dragon", () => {
  const forcedBase = JSON.parse(JSON.stringify(context.wcBattlerSpecForSlot("Sceptile", BUILDS.Sceptile, pokemonList, baseStatsData, abilitiesData, "base")));
  assert.deepEqual([...forcedBase.types].sort(), ["Grass"], "base Sceptile is pure Grass -- forcing \"base\" must not carry over Mega Sceptile's real second Dragon type");

  const forcedMega = JSON.parse(JSON.stringify(context.wcBattlerSpecForSlot("Sceptile", BUILDS.Sceptile, pokemonList, baseStatsData, abilitiesData, "mega")));
  assert.deepEqual([...forcedMega.types].sort(), ["Dragon", "Grass"], "forcing \"mega\" must still resolve the real Mega Sceptile Grass/Dragon typing when explicitly asked for");
});

// ---------------------------------------------------------------------------
// 8. Milestone 51: real bulk scoring (Phoenix: base Sceptile "wont hold
// out for the length of a battle"). wcBulkPoints uses hp*min(def,spd) --
// a Pokemon is only as bulky as its WEAKER defensive stat -- and the real
// numbers below were independently verified against data/base-stats.json
// before writing these assertions. (This section previously also covered
// wcSurvivabilityBonus, wcCarryPlanBonus's survivability term, and
// Milestone 52's screens-aware survivability multiplier; all were removed
// in Milestone 57's full-lineup-sweep rewrite, which no longer scores
// candidate lineups with a synergy heuristic before simulating them.)
// ---------------------------------------------------------------------------

check("wcBulkPoints uses hp*min(def,spd), not hp+def+spd -- so one huge defensive stat can't hide a genuinely weak other side", () => {
  // Steelix: hp=75, def=200, spd=65 -- 200 Defense LOOKS like a wall, but
  // its real weaker side (65 Special Defense) is what a smart opponent
  // actually attacks, so its real bulk score is 75*65=4875, not 75*200.
  assert.equal(context.wcBulkPoints({ hp: 75, def: 200, spd: 65 }), 4875);
  // Incineroar: hp=95, def=90, spd=90 -- balanced across both sides, so its
  // real bulk score (95*90=8550) is far higher than Steelix's despite a
  // much lower raw Defense stat.
  assert.equal(context.wcBulkPoints({ hp: 95, def: 90, spd: 90 }), 8550);
  // Base (non-Mega) Sceptile: hp=70, def=65, spd=85 -- 70*65=4550, in the
  // same fragile range as Steelix once you look at its real weaker side.
  assert.equal(context.wcBulkPoints({ hp: 70, def: 65, spd: 85 }), 4550);
});

console.log(`\nAll ${checksRun} checks passed.`);
