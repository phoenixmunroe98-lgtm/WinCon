#!/usr/bin/env node
// WinCon — tools/test-weighted-policy-equivalence.mjs (Milestone 35, Task 3)
//
// Dev-only regression test. Proves the exact claim the task requires:
// "start that file [data/policy-weights.json] with weights that reproduce
// today's hand-tuned heuristic exactly, as a safe baseline."
//
// It is not enough for wcChooseAiMoveWeighted(..., WC_DEFAULT_AI_WEIGHTS) to
// produce a SIMILAR win rate to wcChooseAiMove — it must make the identical
// move choice, for the identical battler, on every single turn, given the
// identical rng stream. This test proves that directly: it runs full
// battles once under the real "heuristic" policy and once under "weighted"
// with the default weights (same fixed seed each time, so every rng draw —
// turn order, damage rolls, AI jitter — lines up call-for-call), recording
// every (turn, side, chosen move name, target names) tuple as it goes, and
// asserts the two recordings are byte-for-byte identical. It also checks
// data/policy-weights.json on disk is exactly WC_DEFAULT_AI_WEIGHTS, so a
// stray hand-edit to that file can't silently break the "safe baseline"
// guarantee this test exists to protect.
//
// Run: node tools/test-weighted-policy-equivalence.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function makeSeededRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

function loadJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

const pokemonList = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const natures = loadJSON("data/natures.json");
const moveEffects = loadJSON("data/move-effects.json");
const abilityEffects = loadJSON("data/ability-effects.json");
const itemEffects = loadJSON("data/item-effects.json");

function loadTeam(relPath) {
  const absPath = path.join(ROOT, relPath);
  const raw = JSON.parse(fs.readFileSync(absPath, "utf8"));
  const specs = raw.lineup.map((name) => {
    const build = raw.builds[name];
    return context.wcBattlerSpecForSlot(name, build, pokemonList, baseStatsData, abilitiesData);
  });
  return { label: raw.label, format: raw.format, lineup: raw.lineup, specs };
}

const teamKingambit = loadTeam("tools/fixtures/team-kingambit-sun.json");
const teamHyperOffense = loadTeam("tools/fixtures/team-hyper-offense.json");

// Capture the real, untouched heuristic and the new weighted sibling BEFORE
// installing any recording wrapper below — these are the two functions
// under test.
const realHeuristic = context.wcChooseAiMove;
const realWeighted = context.wcChooseAiMoveWeighted;
assert.equal(typeof realHeuristic, "function", "wcChooseAiMove must exist");
assert.equal(typeof realWeighted, "function", "wcChooseAiMoveWeighted must exist");

assert.equal(typeof context.WC_DEFAULT_AI_WEIGHTS, "object", "WC_DEFAULT_AI_WEIGHTS must exist");
assert.notEqual(context.WC_DEFAULT_AI_WEIGHTS, null, "WC_DEFAULT_AI_WEIGHTS must not be null");
// context.WC_DEFAULT_AI_WEIGHTS is an object created inside the vm context's
// own realm — it has that realm's Object.prototype, not this module's, so
// assert.deepEqual (== deepStrictEqual under node:assert/strict, which
// checks prototype identity) would spuriously fail against a plain object
// parsed here even when every property matches. A JSON round-trip produces
// an equivalent plain object in THIS realm, which is all a weights bag ever
// needs to be (it's read-only data, never instanceof-checked).
const WC_DEFAULT_AI_WEIGHTS = JSON.parse(JSON.stringify(context.WC_DEFAULT_AI_WEIGHTS));

// ---------------------------------------------------------------------------
// Recording wrapper: calls the real policy function unmodified, then logs a
// plain-data description of the decision (never the live object graph, so
// later mutation of HP/fainted flags during the battle can't retroactively
// change what an earlier recorded entry looks like).
// ---------------------------------------------------------------------------

function describeDecision(mySide, decision) {
  if (!decision || !decision.move) return { side: mySide, move: null, targets: [] };
  return {
    side: mySide,
    move: decision.move.name,
    targets: decision.targets.map((t) => t.name),
    guaranteedKO: !!decision.guaranteedKO,
  };
}

function makeRecordingPolicy(realFn, log) {
  return function recordingPolicy(battler, allies, foes, ctx) {
    const decision = realFn(battler, allies, foes, ctx);
    log.push(describeDecision(ctx.mySide, decision));
    return decision;
  };
}

function runRecordedBattles({ policyFn, extraSimData, teamA, teamB, format, sheetMode, seed, battles }) {
  const log = [];
  context.wcChooseAiMove = makeRecordingPolicy(policyFn, log);
  const simData = { movesData, moveEffects, abilityEffects, itemEffects, typeChart, natures, sheetMode, ...extraSimData };
  const rng = makeSeededRng(seed);
  const outcomes = [];
  for (let i = 0; i < battles; i += 1) {
    outcomes.push(context.wcRunOneBattle(teamA.specs, teamB.specs, format, simData, rng));
  }
  return { log, outcomes };
}

// ---------------------------------------------------------------------------
// Test matrix: both fixture teams (asymmetric, real 4-mon Doubles lineups),
// both sheet modes, several distinct seeds — every combination must produce
// byte-for-byte identical decision logs and outcomes between "heuristic"
// and "weighted with WC_DEFAULT_AI_WEIGHTS".
// ---------------------------------------------------------------------------

const SEEDS = [1, 42, 12345, 999999];
const SHEET_MODES = ["open", "closed"];
const BATTLES_PER_CASE = 15;

let casesRun = 0;
let totalBattlesCompared = 0;

SHEET_MODES.forEach((sheetMode) => {
  SEEDS.forEach((seed) => {
    const heuristicRun = runRecordedBattles({
      policyFn: realHeuristic,
      extraSimData: {},
      teamA: teamKingambit,
      teamB: teamHyperOffense,
      format: "doubles",
      sheetMode,
      seed,
      battles: BATTLES_PER_CASE,
    });

    const weightedRun = runRecordedBattles({
      policyFn: realWeighted,
      extraSimData: { policyWeights: WC_DEFAULT_AI_WEIGHTS },
      teamA: teamKingambit,
      teamB: teamHyperOffense,
      format: "doubles",
      sheetMode,
      seed,
      battles: BATTLES_PER_CASE,
    });

    assert.deepEqual(
      weightedRun.outcomes,
      heuristicRun.outcomes,
      `Battle outcomes diverged (sheetMode=${sheetMode}, seed=${seed}): ` +
        `heuristic=${JSON.stringify(heuristicRun.outcomes)} weighted=${JSON.stringify(weightedRun.outcomes)}`
    );

    assert.equal(
      weightedRun.log.length,
      heuristicRun.log.length,
      `Decision log length diverged (sheetMode=${sheetMode}, seed=${seed}): ` +
        `heuristic had ${heuristicRun.log.length} decisions, weighted had ${weightedRun.log.length}`
    );

    weightedRun.log.forEach((entry, i) => {
      assert.deepEqual(
        entry,
        heuristicRun.log[i],
        `Decision #${i} diverged (sheetMode=${sheetMode}, seed=${seed}):\n` +
          `  heuristic: ${JSON.stringify(heuristicRun.log[i])}\n` +
          `  weighted:  ${JSON.stringify(entry)}`
      );
    });

    casesRun += 1;
    totalBattlesCompared += BATTLES_PER_CASE;
    console.log(
      `OK  sheetMode=${sheetMode.padEnd(6)} seed=${String(seed).padEnd(7)} ` +
        `${BATTLES_PER_CASE} battles, ${heuristicRun.log.length} decisions — identical`
    );
  });
});

// ---------------------------------------------------------------------------
// Also confirm no-weights-supplied (weighted called with an empty data bag,
// i.e. neither policyWeights nor policyWeightsBySide set) falls back to
// WC_DEFAULT_AI_WEIGHTS and is therefore ALSO identical to the heuristic —
// this is the "safe, defined fallback" behavior wcChooseAiMoveWeighted's own
// doc comment claims.
// ---------------------------------------------------------------------------

{
  const seed = 7;
  const heuristicRun = runRecordedBattles({
    policyFn: realHeuristic,
    extraSimData: {},
    teamA: teamKingambit,
    teamB: teamHyperOffense,
    format: "doubles",
    sheetMode: "open",
    seed,
    battles: BATTLES_PER_CASE,
  });
  const weightedNoWeightsRun = runRecordedBattles({
    policyFn: realWeighted,
    extraSimData: {}, // no policyWeights / policyWeightsBySide at all
    teamA: teamKingambit,
    teamB: teamHyperOffense,
    format: "doubles",
    sheetMode: "open",
    seed,
    battles: BATTLES_PER_CASE,
  });
  assert.deepEqual(weightedNoWeightsRun.outcomes, heuristicRun.outcomes, "weighted-with-no-weights-supplied must fall back to defaults and match the heuristic exactly");
  weightedNoWeightsRun.log.forEach((entry, i) => {
    assert.deepEqual(entry, heuristicRun.log[i], `no-weights-supplied decision #${i} diverged from heuristic`);
  });
  console.log(`OK  weighted() with no policyWeights supplied at all falls back to WC_DEFAULT_AI_WEIGHTS — identical to heuristic`);
  casesRun += 1;
  totalBattlesCompared += BATTLES_PER_CASE;
}

// ---------------------------------------------------------------------------
// data/policy-weights.json (once created) must be an exact, faithful
// serialization of WC_DEFAULT_AI_WEIGHTS — not just "close enough". This
// guards against the file drifting from the constant it's supposed to mirror
// (e.g. a hand-edit, or the constant changing in a later refactor without
// the JSON file being regenerated).
// ---------------------------------------------------------------------------

const policyWeightsPath = path.join(ROOT, "data", "policy-weights.json");
if (fs.existsSync(policyWeightsPath)) {
  const onDisk = JSON.parse(fs.readFileSync(policyWeightsPath, "utf8"));
  assert.deepEqual(onDisk, WC_DEFAULT_AI_WEIGHTS, "data/policy-weights.json must exactly match WC_DEFAULT_AI_WEIGHTS");
  console.log("OK  data/policy-weights.json matches WC_DEFAULT_AI_WEIGHTS exactly");
  casesRun += 1;
} else {
  console.log("SKIP data/policy-weights.json does not exist yet (create it, then re-run this test)");
}

console.log("");
console.log(`All ${casesRun} equivalence checks passed (${totalBattlesCompared} battles compared, decision-by-decision).`);
