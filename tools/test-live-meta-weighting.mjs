// WinCon — tools/test-live-meta-weighting.mjs
//
// Regression test for the "also inform Your Rival and Simulated Win
// Rate" follow-up to Milestone 34 (the Limitless pipeline): a live-usage
// candidate bonus (wcLiveMetaCandidateBonus, folded into
// wcDreamTeamCandidateScore -- shared by Auto-build's Dream Team AND
// Your Rival) and a Monte-Carlo opponent-sampling weight
// (wcLiveUsageWeightForTeam, folded into wcSimulateTeamWinRate via
// wcRunMonteCarlo's own `weight` field). Both are deliberately additive:
// with no live data (liveMeta/liveTierStats missing or empty), every
// assertion here should match the exact pre-change behavior (bonus 0,
// weight 1).
//
// Run: node tools/test-live-meta-weighting.mjs

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

let checks = 0;
function check(description, fn) {
  fn();
  checks += 1;
  console.log(`OK  ${description}`);
}

// ---------------------------------------------------------------------------
// wcLiveMetaCandidateBonus / wcLiveMetaReasoningNote — pure functions.
// ---------------------------------------------------------------------------

check("wcLiveMetaCandidateBonus is 0 with no live data at all", () => {
  assert.equal(context.wcLiveMetaCandidateBonus("Kingambit", null), 0);
  assert.equal(context.wcLiveMetaCandidateBonus("Kingambit", undefined), 0);
  assert.equal(context.wcLiveMetaCandidateBonus("Kingambit", {}), 0);
});

check("wcLiveMetaCandidateBonus is 0 below the minimum sample size", () => {
  const liveMeta = { Kingambit: { timesUsed: 2, winRate: 90 } }; // below WC_META_USAGE_MIN_SAMPLE (5)
  assert.equal(context.wcLiveMetaCandidateBonus("Kingambit", liveMeta), 0);
});

check("wcLiveMetaCandidateBonus scores up for a real, qualifying above-50% win rate", () => {
  const liveMeta = { Kingambit: { timesUsed: 20, winRate: 70 } };
  const bonus = context.wcLiveMetaCandidateBonus("Kingambit", liveMeta);
  assert.ok(bonus > 0, `expected a positive bonus, got ${bonus}`);
});

check("wcLiveMetaCandidateBonus scores down for a real, qualifying below-50% win rate", () => {
  const liveMeta = { Kingambit: { timesUsed: 20, winRate: 30 } };
  const bonus = context.wcLiveMetaCandidateBonus("Kingambit", liveMeta);
  assert.ok(bonus < 0, `expected a negative bonus, got ${bonus}`);
});

check("wcLiveMetaReasoningNote says nothing when there's no data or too close to even", () => {
  assert.equal(context.wcLiveMetaReasoningNote("Kingambit", null), "");
  assert.equal(context.wcLiveMetaReasoningNote("Kingambit", { Kingambit: { timesUsed: 20, winRate: 52 } }), "");
});

check("wcLiveMetaReasoningNote names the real win rate and sample size when it clears the bar", () => {
  const note = context.wcLiveMetaReasoningNote("Kingambit", { Kingambit: { timesUsed: 20, winRate: 70 } });
  assert.match(note, /70%/);
  assert.match(note, /20/);
});

// ---------------------------------------------------------------------------
// wcDreamTeamCandidateScore — confirms the new liveMetaBonus term is wired
// in without disturbing the score when no live data is supplied.
// ---------------------------------------------------------------------------

check("wcDreamTeamCandidateScore is unaffected when options.liveMeta is absent", () => {
  const typeChart = loadJSON("data/type-chart.json");
  const candidate = { name: "Kingambit", types: ["Dark", "Steel"], baseStats: { hp: 100, atk: 135, def: 120, spa: 60, spd: 65, spe: 50 } };
  const scoreWithout = context.wcDreamTeamCandidateScore(candidate, [], [], typeChart, typeChart.types, {});
  const scoreWithEmptyLiveMeta = context.wcDreamTeamCandidateScore(candidate, [], [], typeChart, typeChart.types, { liveMeta: {} });
  assert.equal(scoreWithout, scoreWithEmptyLiveMeta);
});

check("wcDreamTeamCandidateScore goes up when the candidate has a strong, qualifying live win rate", () => {
  const typeChart = loadJSON("data/type-chart.json");
  const candidate = { name: "Kingambit", types: ["Dark", "Steel"], baseStats: { hp: 100, atk: 135, def: 120, spa: 60, spd: 65, spe: 50 } };
  const scoreWithout = context.wcDreamTeamCandidateScore(candidate, [], [], typeChart, typeChart.types, {});
  const scoreWithLiveMeta = context.wcDreamTeamCandidateScore(candidate, [], [], typeChart, typeChart.types, { liveMeta: { Kingambit: { timesUsed: 20, winRate: 75 } } });
  assert.ok(scoreWithLiveMeta > scoreWithout, `expected the live-backed score (${scoreWithLiveMeta}) to beat the baseline (${scoreWithout})`);
});

// ---------------------------------------------------------------------------
// wcLiveUsageWeightForTeam — pure function powering Simulated Win Rate's
// opponent-sampling weight.
// ---------------------------------------------------------------------------

const SAMPLE_TEAM_MEMBERS = [{ name: "Kingambit" }, { name: "Garchomp" }, { name: "Sneasler" }];

check("wcLiveUsageWeightForTeam is neutral (1) with no live data", () => {
  assert.equal(context.wcLiveUsageWeightForTeam(SAMPLE_TEAM_MEMBERS, null), 1);
  assert.equal(context.wcLiveUsageWeightForTeam(SAMPLE_TEAM_MEMBERS, {}), 1);
});

check("wcLiveUsageWeightForTeam is neutral (1) when no member clears the minimum sample size", () => {
  const liveTierStats = { Kingambit: { timesUsed: 1, winRate: 90 } };
  assert.equal(context.wcLiveUsageWeightForTeam(SAMPLE_TEAM_MEMBERS, liveTierStats), 1);
});

check("wcLiveUsageWeightForTeam is above 1 when qualifying members are winning a lot right now", () => {
  const liveTierStats = {
    Kingambit: { timesUsed: 20, winRate: 80 },
    Garchomp: { timesUsed: 20, winRate: 80 },
  };
  const weight = context.wcLiveUsageWeightForTeam(SAMPLE_TEAM_MEMBERS, liveTierStats);
  assert.ok(weight > 1, `expected weight > 1, got ${weight}`);
  assert.ok(weight <= 2, `expected weight capped at 2, got ${weight}`);
});

check("wcLiveUsageWeightForTeam is below 1 when qualifying members are losing a lot right now", () => {
  const liveTierStats = {
    Kingambit: { timesUsed: 20, winRate: 10 },
    Garchomp: { timesUsed: 20, winRate: 10 },
  };
  const weight = context.wcLiveUsageWeightForTeam(SAMPLE_TEAM_MEMBERS, liveTierStats);
  assert.ok(weight < 1, `expected weight < 1, got ${weight}`);
  assert.ok(weight >= 0.5, `expected weight floored at 0.5, got ${weight}`);
});

// ---------------------------------------------------------------------------
// wcRunMonteCarlo — confirms an opponent's own `weight` field actually
// scales its share of the run budget, using the REAL engine (small,
// cheap run counts) rather than a stub -- this proves the mechanism end
// to end, not just that the pure weight function returns a number.
// ---------------------------------------------------------------------------

const pokemonList = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChartData = loadJSON("data/type-chart.json");
const natures = loadJSON("data/natures.json");
const moveEffects = loadJSON("data/move-effects.json");
const abilityEffects = loadJSON("data/ability-effects.json");
const itemEffects = loadJSON("data/item-effects.json");

function makeSpec(name, item, moves) {
  const build = { nature: "Adamant", item, moves, sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } };
  return context.wcBattlerSpecForSlot(name, build, pokemonList, baseStatsData, abilitiesData);
}

const mySpecs = [
  makeSpec("Kingambit", "Life Orb", ["Kowtow Cleave", "Sucker Punch", "Swords Dance", "Protect"]),
  makeSpec("Garchomp", "Rocky Helmet", ["Earthquake", "Stone Edge", "Scale Shot", "Protect"]),
];
const oppSpecsA = [
  makeSpec("Sneasler", "Focus Sash", ["Close Combat", "Dire Claw", "Protect", "Fake Out"]),
  makeSpec("Basculegion", "Choice Band", ["Wave Crash", "Flip Turn", "Aqua Jet", "Liquidation"]),
];
const oppSpecsB = [
  makeSpec("Whimsicott", "Focus Sash", ["Tailwind", "Moonblast", "Encore", "Protect"]),
  makeSpec("Torkoal", "Charcoal", ["Eruption", "Protect", "Rock Slide", "Yawn"]),
];

const simData = { movesData, moveEffects, abilityEffects, itemEffects, typeChart: typeChartData, natures, sheetMode: "open" };

check("wcRunMonteCarlo with no weight field on any opponent behaves exactly as before (equal run counts)", () => {
  const oppPool = [
    { id: "a", label: "A", specs: oppSpecsA },
    { id: "b", label: "B", specs: oppSpecsB },
  ];
  const result = context.wcRunMonteCarlo(mySpecs, oppPool, 10, "doubles", simData);
  assert.equal(result.totalRuns, 20, "two opponents x 10 runs each, no weighting applied");
});

check("wcRunMonteCarlo scales an opponent's run count by its own weight", () => {
  const oppPool = [
    { id: "a", label: "A", specs: oppSpecsA, weight: 2 },
    { id: "b", label: "B", specs: oppSpecsB, weight: 0.5 },
  ];
  const result = context.wcRunMonteCarlo(mySpecs, oppPool, 10, "doubles", simData);
  // 10*2 = 20 for A, max(1, round(10*0.5)) = 5 for B -> 25 total.
  assert.equal(result.totalRuns, 25, `expected 25 total runs (20 + 5), got ${result.totalRuns}`);
});

check("wcRunMonteCarlo never lets a weighted opponent's run count drop to 0", () => {
  const oppPool = [{ id: "a", label: "A", specs: oppSpecsA, weight: 0.01 }];
  const result = context.wcRunMonteCarlo(mySpecs, oppPool, 5, "doubles", simData);
  assert.ok(result.totalRuns >= 1, `expected at least 1 run, got ${result.totalRuns}`);
});

// ---------------------------------------------------------------------------
// wcSimulateTeamWinRate — end-to-end: confirms liveTierStats in the
// payload actually reaches oppPool as the right per-team weight. Stubs
// wcRunMonteCarlo to just capture its oppLineupPool argument rather than
// running a full simulation, so this stays fast and fully deterministic.
// ---------------------------------------------------------------------------

const CHOSEN_SIX = ["Kingambit", "Sneasler", "Basculegion", "Garchomp", "Incineroar", "Dragonite"];
function emptyBuild() {
  return { nature: "Adamant", item: "", moves: ["Protect", "Protect", "Protect", "Protect"], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 } };
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
CHOSEN_SIX.forEach((name) => { builds[name] = { ...emptyBuild(), ...BUILD_OVERRIDES[name] }; });

const metaBaseline = {
  doubles: [
    {
      id: "hot-team",
      label: "Currently hot team",
      members: [
        { name: "Gholdengo", item: "Choice Specs", role: "fast-special", moves: ["Make It Rain", "Shadow Ball", "Trick", "Protect"] },
        { name: "Torkoal", item: "Charcoal", role: "bulky-special", moves: ["Eruption", "Protect", "Rock Slide", "Yawn"] },
      ],
    },
    {
      id: "cold-team",
      label: "No live data team",
      members: [
        { name: "Whimsicott", item: "Focus Sash", role: "fast-special", moves: ["Tailwind", "Moonblast", "Encore", "Protect"] },
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
  typeChart: typeChartData,
  natures,
  metaBaseline,
  comboLookup: null,
  liveTierStats: {
    Gholdengo: { timesUsed: 30, winRate: 85 },
    Torkoal: { timesUsed: 30, winRate: 85 },
  },
};

check("wcSimulateTeamWinRate threads liveTierStats into oppPool as a per-team weight, leaving the no-data team neutral", () => {
  let capturedOppPool = null;
  const originalMonteCarlo = context.wcRunMonteCarlo;
  context.wcRunMonteCarlo = function stub(myLineupSpecs, oppLineupPool) {
    if (!capturedOppPool) capturedOppPool = oppLineupPool; // capture the first call (round 1 of the search)
    const totalRuns = oppLineupPool.length || 1;
    return { winRate: 0.5, wins: 1, losses: 1, draws: 0, totalRuns, perOpponent: oppLineupPool.map((o) => ({ id: o.id, label: o.label, winRate: 0.5 })) };
  };
  try {
    context.wcSimulateTeamWinRate(payload);
  } finally {
    context.wcRunMonteCarlo = originalMonteCarlo;
  }
  assert.ok(capturedOppPool, "expected wcRunMonteCarlo to have been called at least once");
  const hotTeam = capturedOppPool.find((o) => o.id === "hot-team");
  const coldTeam = capturedOppPool.find((o) => o.id === "cold-team");
  assert.ok(hotTeam, "expected the hot-team reference opponent in oppPool");
  assert.ok(coldTeam, "expected the cold-team reference opponent in oppPool");
  assert.ok(hotTeam.weight > 1, `expected the hot team's weight > 1, got ${hotTeam.weight}`);
  assert.equal(coldTeam.weight, 1, "expected the team with no live data to stay at neutral weight 1");
});

console.log("");
console.log(`All ${checks} live-meta weighting checks passed.`);
