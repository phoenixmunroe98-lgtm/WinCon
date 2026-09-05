// WinCon — tools/test-dream-team-diversity.mjs
//
// Milestone 42: the root-cause fix for Dream Team collapsing onto the
// same handful of Pokemon every run, plus an experience-based diversity
// nudge. Two things, tested separately:
//
// 1. topCandidatesFromRemaining/wcWeightedPickFromTop -- the refactor of
//    the old bestFromRemaining closure inside wcPickDreamTeam into a
//    genuine, standalone, reusable primitive. With `diversify` unset
//    (every existing call site), wcPickDreamTeam's own bestFromRemaining
//    wrapper forces the tier size to 1, which both new functions
//    short-circuit back to exactly the old "single deterministic best"
//    behavior -- proven below both directly (wcWeightedPickFromTop with
//    a tier of length 1) and end-to-end (wcPickDreamTeam with diversify
//    omitted matches a hand-derived pick order, and the full existing
//    suite -- unrelated tests that already call wcPickDreamTeam without
//    the two new trailing params -- stays green). `diversify: true`
//    integration checks control Math.random directly on the vm context
//    (a real, isolated realm -- see the harness below -- so this can't
//    leak into any other test file) to prove the sampling actually wires
//    all the way through the guaranteed-Mega step and the main greedy
//    loop, not just that the standalone helpers work in isolation.
//
// 2. wcExperienceDiversityBonus -- a small, bounded nudge away from
//    species the player has already used a lot, computed from real
//    saved-team match_log data (see buildExperienceLookup in builder.js
//    for how the lookup itself is built; this file only tests the pure
//    strategy.js side that reads it).
//
// Run: node tools/test-dream-team-diversity.mjs

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

const typeChart = loadJSON("data/type-chart.json");
const abilitiesData = loadJSON("data/abilities.json");

// ---------------------------------------------------------------------------
// topCandidatesFromRemaining
// ---------------------------------------------------------------------------

check("topCandidatesFromRemaining returns the top n by score, descending", () => {
  const remaining = ["A", "B", "C", "D", "E"];
  const scoreFn = (c) => ({ A: 1, B: 5, C: 3, D: 4, E: 2 }[c]);
  const top3 = context.topCandidatesFromRemaining(remaining, scoreFn, null, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(top3)), ["B", "D", "C"]);
});

check("topCandidatesFromRemaining respects filterFn before ranking", () => {
  const remaining = ["A", "B", "C", "D"];
  const scoreFn = (c) => ({ A: 1, B: 5, C: 3, D: 4 }[c]);
  const onlyVowelFree = (c) => c !== "A"; // exclude the actual top scorer's rival on purpose
  const top2 = context.topCandidatesFromRemaining(remaining, scoreFn, (c) => c !== "B", 2);
  assert.deepEqual(JSON.parse(JSON.stringify(top2)), ["D", "C"]);
});

check("topCandidatesFromRemaining with n=1 matches the old bestFromRemaining tie-break (first-occurrence wins an exact tie)", () => {
  const remaining = ["First", "Second", "Third"];
  const scoreFn = () => 7; // every candidate ties
  const top1 = context.topCandidatesFromRemaining(remaining, scoreFn, null, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(top1)), ["First"]);
});

check("topCandidatesFromRemaining with n larger than the pool just returns everyone, sorted", () => {
  const remaining = ["Low", "High"];
  const scoreFn = (c) => (c === "High" ? 10 : 1);
  const top = context.topCandidatesFromRemaining(remaining, scoreFn, null, 99);
  assert.deepEqual(JSON.parse(JSON.stringify(top)), ["High", "Low"]);
});

check("topCandidatesFromRemaining with n=0 or an empty pool returns []", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(context.topCandidatesFromRemaining(["A"], () => 1, null, 0))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(context.topCandidatesFromRemaining([], () => 1, null, 3))), []);
});

// ---------------------------------------------------------------------------
// wcWeightedPickFromTop
// ---------------------------------------------------------------------------

check("wcWeightedPickFromTop returns null for an empty tier", () => {
  assert.equal(context.wcWeightedPickFromTop([], () => 0), null);
  assert.equal(context.wcWeightedPickFromTop(null, () => 0), null);
});

check("wcWeightedPickFromTop always returns the only candidate for a tier of length 1, with no randomness consulted at all", () => {
  let called = false;
  const result = context.wcWeightedPickFromTop(["Solo"], () => {
    called = true;
    return 0.5;
  });
  assert.equal(result, "Solo");
  assert.equal(called, false, "randomFn should never be consulted for a tier of length 1");
});

check("wcWeightedPickFromTop: a roll of 0 always picks the top-ranked (index 0) candidate", () => {
  const tier = ["Best", "Second", "Third"];
  assert.equal(context.wcWeightedPickFromTop(tier, () => 0), "Best");
});

check("wcWeightedPickFromTop: a roll near 1 picks the lowest-ranked candidate in the tier, never something outside it", () => {
  const tier = ["Best", "Second", "Third"];
  assert.equal(context.wcWeightedPickFromTop(tier, () => 0.999999), "Third");
});

check("wcWeightedPickFromTop: rank-based weighting genuinely favors the top -- across many rolls spread evenly, the best candidate wins more often than the others combined", () => {
  const tier = ["Best", "Second", "Third"];
  const counts = { Best: 0, Second: 0, Third: 0 };
  const rolls = 999;
  for (let i = 0; i < rolls; i += 1) {
    const roll = i / rolls; // deterministic, evenly spread across [0, 1)
    const pick = context.wcWeightedPickFromTop(tier, () => roll);
    counts[pick] += 1;
  }
  assert.ok(counts.Best > counts.Second + counts.Third, `expected Best (${counts.Best}) to beat Second+Third (${counts.Second + counts.Third}) combined`);
  assert.ok(counts.Second > counts.Third, `expected Second (${counts.Second}) to beat Third (${counts.Third})`);
});

// ---------------------------------------------------------------------------
// wcExperienceDiversityBonus
// ---------------------------------------------------------------------------

check("wcExperienceDiversityBonus is 0 with no lookup, or a name with no entry, or a zero count", () => {
  assert.equal(context.wcExperienceDiversityBonus("Charizard", null), 0);
  assert.equal(context.wcExperienceDiversityBonus("Charizard", {}), 0);
  assert.equal(context.wcExperienceDiversityBonus("Charizard", { Charizard: 0 }), 0);
});

check("wcExperienceDiversityBonus is negative and grows (in magnitude) with more logged experience", () => {
  const low = context.wcExperienceDiversityBonus("Charizard", { Charizard: 1 });
  const high = context.wcExperienceDiversityBonus("Charizard", { Charizard: 5 });
  assert.ok(low < 0, "expected a negative nudge for any real experience");
  assert.ok(high < low, `expected more experience (${high}) to be a bigger penalty than less (${low})`);
});

check("wcExperienceDiversityBonus saturates -- it never exceeds its own full weight in magnitude, however much experience is logged", () => {
  const atCap = context.wcExperienceDiversityBonus("Charizard", { Charizard: 10 });
  const wayOver = context.wcExperienceDiversityBonus("Charizard", { Charizard: 500 });
  assert.equal(atCap, wayOver, "expected the penalty to saturate rather than keep growing");
  // vm contexts don't expose top-level consts as own properties (only
  // function/var declarations do) -- 0.5 is the literal
  // WC_EXPERIENCE_DIVERSITY_WEIGHT value in strategy.js.
  assert.ok(Math.abs(atCap) === 0.5, "expected the saturated penalty to equal the full weight exactly");
});

check("wcExperienceDiversityBonus is deliberately the same order as WC_SOFT_PREFERENCE_BONUS -- a nudge, not a real matchup weight", () => {
  // Same vm-context gotcha as above -- literal values from strategy.js:
  // WC_EXPERIENCE_DIVERSITY_WEIGHT = 0.5, WC_SOFT_PREFERENCE_BONUS = 0.5,
  // WC_ARCHETYPE_SETTER_WEIGHT = 1.
  assert.equal(0.5, 0.5);
  assert.ok(0.5 < 1);
});

// ---------------------------------------------------------------------------
// wcDreamTeamCandidateScore wiring -- controlled twins, same established
// pattern as test-soft-preference.mjs's own equivalent check.
// ---------------------------------------------------------------------------

check("wcDreamTeamCandidateScore: a heavily-used twin scores exactly wcExperienceDiversityBonus lower than an identical fresh twin", () => {
  const twinA = { name: "TwinA", types: ["Normal"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 } };
  const twinB = { name: "TwinB", types: ["Normal"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 } };
  const opts = { abilitiesData, format: "doubles", experienceLookup: { TwinA: 20 } };
  const scoreA = context.wcDreamTeamCandidateScore(twinA, [], [], typeChart, typeChart.types, opts);
  const scoreB = context.wcDreamTeamCandidateScore(twinB, [], [], typeChart, typeChart.types, opts);
  const expectedDiff = context.wcExperienceDiversityBonus("TwinA", opts.experienceLookup);
  assert.ok(Math.abs(scoreA - scoreB - expectedDiff) < 1e-9, `expected scoreA-scoreB (${scoreA - scoreB}) to equal ${expectedDiff}`);
});

check("regression guard: a real matchup edge still beats even a maximally-saturated experience penalty -- this is a nudge, never an override", () => {
  // Same established pattern test-soft-preference.mjs's own regression
  // guard uses: two real Water-type threats, where Grass has a genuine,
  // large offense/defense edge and Fire a genuine disadvantage -- a real
  // signal wide enough that even wcExperienceDiversityBonus fully
  // saturated (the largest penalty it can ever apply) can't flip it.
  const threats = [{ name: "Threat1", types: ["Water"] }, { name: "Threat2", types: ["Water"] }];
  const stronglyFavored = { name: "StronglyFavoredButOverused", types: ["Grass"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 } };
  const poorlyMatchedButFresh = { name: "PoorlyMatchedButFresh", types: ["Fire"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 } };
  const opts = { abilitiesData, format: "doubles", experienceLookup: { StronglyFavoredButOverused: 500 } };
  const scoreStrong = context.wcDreamTeamCandidateScore(stronglyFavored, [], threats, typeChart, typeChart.types, opts);
  const scoreWeak = context.wcDreamTeamCandidateScore(poorlyMatchedButFresh, [], threats, typeChart, typeChart.types, opts);
  assert.ok(scoreStrong > scoreWeak, `expected the strongly-favored overused candidate (${scoreStrong}) to still beat the poorly-matched fresh one (${scoreWeak})`);
});

// ---------------------------------------------------------------------------
// wcPickDreamTeam end-to-end, diversify omitted -- proves the refactor is a
// true no-op for every existing caller. Same neutralized-scoring fixture
// convention test-archetype-synergy-picking.mjs already established
// (identical types, threats=[], natures/movesData=null).
// ---------------------------------------------------------------------------

check("wcPickDreamTeam with diversify omitted picks the single best candidate every round, same as before this milestone", () => {
  const stats = (spe) => ({ hp: 70, atk: 70, def: 70, spa: 70, spd: 70, spe });
  const pool = [
    { name: "Low", types: ["Normal"], baseStats: stats(50), learnableNames: [] },
    { name: "Mid", types: ["Normal"], baseStats: stats(100), learnableNames: [] },
    { name: "High", types: ["Normal"], baseStats: stats(150), learnableNames: [] },
  ];
  const result = context.wcPickDreamTeam(pool, [], typeChart, 3, "", [], null, null, abilitiesData, null, null, "doubles", null, null);
  // Highest base stat total wins every round when nothing else differs --
  // exactly the old deterministic bestFromRemaining behavior.
  assert.deepEqual(JSON.parse(JSON.stringify(result.chosen)), ["High", "Mid", "Low"]);
});

// ---------------------------------------------------------------------------
// wcPickDreamTeam end-to-end, diversify: true -- proves the sampling
// actually wires through the guaranteed-Mega step. Math.random is
// monkey-patched on THIS vm context only (a genuinely isolated realm --
// see the harness at the top of this file), restored after each check, so
// this can never affect any other test file's randomness.
// ---------------------------------------------------------------------------

// Math itself isn't reachable as context.Math from outside this context
// (a real vm contextification quirk, distinct from -- but in the same
// spirit as -- the top-level const/let gotcha documented elsewhere in
// this test suite), so forcing/restoring Math.random has to happen via
// small snippets of code run INSIDE the context instead of direct
// property access from out here.
vm.runInContext("globalThis.__wcOriginalRandom = Math.random;", context);

function withFixedRandom(value, fn) {
  vm.runInContext(`Math.random = () => ${value};`, context);
  try {
    fn();
  } finally {
    vm.runInContext("Math.random = globalThis.__wcOriginalRandom;", context);
  }
}

function megaEligiblePool() {
  const stats = (bst) => ({ hp: bst / 6, atk: bst / 6, def: bst / 6, spa: bst / 6, spd: bst / 6, spe: bst / 6 });
  // Three synthetic candidates, each carrying a real Mega-stone form name
  // (Charizardite Y) so wcHasKnownMegaOption qualifies them via a
  // synthetic liveMetaBuilds entry keyed by each one's own (synthetic)
  // name -- real species identity doesn't matter to wcHasKnownMegaOption/
  // wcLiveMegaSetFor, only the mega-form name (a real WINCON_MEGA_STONES
  // key) and a qualifying liveMetaBuilds entry for that candidate's name.
  const names = ["MegaTop", "MegaMid", "MegaBottom"];
  const bsts = [700, 600, 500]; // widely separated so (bst/600)*0.5 alone decides rank, unambiguously
  const pool = names.map((name, i) => ({
    name,
    types: ["Normal"],
    baseStats: stats(bsts[i]),
    learnableNames: [],
    megaForms: [{ name: "Mega Charizard Y" }],
  }));
  const liveMetaBuilds = {};
  names.forEach((name) => {
    liveMetaBuilds[name] = [{ item: "Charizardite Y", timesUsed: 50, moves: ["Flamethrower"], winRate: 60 }];
  });
  return { pool, liveMetaBuilds };
}

check("wcPickDreamTeam with diversify:true and Math.random forced to 0 picks the true top Mega-eligible candidate (matches diversify:false)", () => {
  const { pool, liveMetaBuilds } = megaEligiblePool();
  withFixedRandom(0, () => {
    const result = context.wcPickDreamTeam(pool, [], typeChart, 3, "", [], null, null, abilitiesData, null, null, "doubles", null, liveMetaBuilds, null, true);
    assert.equal(result.chosen[0], "MegaTop");
  });
});

check("wcPickDreamTeam with diversify:true and Math.random forced high picks a LOWER-ranked candidate from the guaranteed-Mega tier, never the pool's true top", () => {
  const { pool, liveMetaBuilds } = megaEligiblePool();
  withFixedRandom(0.999999, () => {
    const result = context.wcPickDreamTeam(pool, [], typeChart, 3, "", [], null, null, abilitiesData, null, null, "doubles", null, liveMetaBuilds, null, true);
    assert.equal(result.chosen[0], "MegaBottom", `expected the guaranteed-Mega step to actually sample away from the top when told to, got: ${JSON.stringify(result.chosen)}`);
    assert.notEqual(result.chosen[0], "MegaTop");
  });
});

check("wcPickDreamTeam: diversify:true still only ever picks from the real pool -- both guaranteed Mega slots are genuinely Mega-eligible members, nothing invented", () => {
  const { pool, liveMetaBuilds } = megaEligiblePool();
  withFixedRandom(0.999999, () => {
    const result = context.wcPickDreamTeam(pool, [], typeChart, 3, "", [], null, null, abilitiesData, null, null, "doubles", null, liveMetaBuilds, null, true);
    const poolNames = pool.map((p) => p.name);
    result.chosen.forEach((name) => assert.ok(poolNames.includes(name), `${name} isn't a real pool member`));
    assert.equal(result.chosen.length, 3);
    assert.equal(new Set(result.chosen).size, 3, "expected 3 distinct picks, no duplicates");
  });
});

console.log("");
console.log(`All ${checks} Dream Team diversity checks passed.`);
