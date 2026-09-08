#!/usr/bin/env node
// WinCon — tools/test-championsdata-pipeline.mjs (Milestone 53: the
// championsbattledata.com pipeline)
//
// Two halves, mirroring tools/test-limitless-pipeline.mjs's own split:
//
//   1. Pure transform tests (no network) for rowsFromIndex/rowsFromSpeciesTop,
//      exported from api/cron-championsdata-sync.js, against a fixture
//      shaped exactly like a real `/api` index response (confirmed live
//      during this milestone's research: pokemon[].summary.battleSummary.
//      Current.{Doubles,Singles}.top.{move,held_item,teammate,
//      stat_alignment,stat_points,ability}).
//   2. End-to-end handler smoke tests (installFakeFetch/makeFakeRes,
//      same pattern as the Limitless pipeline's own) for the dry-run/auth
//      paths.
//
// Plus a third half specific to this milestone: strategy.js's
// wcRealStatPointSpreadFor (the real-data confidence gate) and its one
// wire-up inside wcGenerateBuild -- a real, confident live spread wins
// over the wcPickSP heuristic guess, an unconfident/missing one still
// falls back to it, and a build that auto-opts into a Mega form never
// gets a live spread at all (the Mega-conflation guard -- see that
// function's own header comment in strategy.js for why).
//
// Run: node tools/test-championsdata-pipeline.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import cronHandler from "../api/cron-championsdata-sync.js";

const { rowsFromIndex, rowsFromSpeciesTop } = cronHandler;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

let checks = 0;
function check(description, fn) {
  fn();
  checks += 1;
  console.log(`OK  ${description}`);
}

async function checkAsync(description, fn) {
  await fn();
  checks += 1;
  console.log(`OK  ${description}`);
}

// ---------------------------------------------------------------------------
// Part 1: rowsFromSpeciesTop / rowsFromIndex — pure, no network/DB.
// ---------------------------------------------------------------------------

// Shaped like a real `top` object under battleSummary.Current.Doubles/
// Singles — a full 6-category entry, plus a `null` (missing) stat_alignment
// to confirm a genuinely-missing category is skipped, not written as a
// null row (same "silently a no-op until real data exists" contract every
// other live_* table already follows).
const GARCHOMP_DOUBLES_TOP = {
  move: { name: "Earthquake", percentage_value: 61.2 },
  held_item: { name: "Life Orb", percentage_value: 29.4 },
  teammate: { name: "Incineroar", percentage_value: 18.7 },
  ability: { name: "Rough Skin", percentage_value: 88.1 },
  stat_points: {
    name: null,
    percentage_value: 38.6,
    hp_points: 2,
    attack_points: 32,
    defense_points: 0,
    sp_atk_points: 0,
    sp_def_points: 0,
    speed_points: 32,
  },
  // stat_alignment deliberately absent — real gap in the source data.
};

check("rowsFromSpeciesTop returns [] when `top` is missing entirely (a format the species has no logged data for)", () => {
  assert.deepEqual(rowsFromSpeciesTop("Garchomp", "singles", null), []);
  assert.deepEqual(rowsFromSpeciesTop("Garchomp", "singles", undefined), []);
});

check("rowsFromSpeciesTop builds exactly one row per real category present, skipping a genuinely missing one (stat_alignment here)", () => {
  const rows = rowsFromSpeciesTop("Garchomp", "doubles", GARCHOMP_DOUBLES_TOP);
  assert.equal(rows.length, 5, "5 real categories present (move/held_item/teammate/ability/stat_points) — stat_alignment must not appear as a null row");
  assert.deepEqual(
    rows.map((r) => r.category).sort(),
    ["ability", "held_item", "move", "stat_points", "teammate"]
  );
  rows.forEach((r) => {
    assert.equal(r.species, "Garchomp");
    assert.equal(r.format, "doubles");
    assert.equal(r.rank, 1);
  });
});

check("rowsFromSpeciesTop's stat_points row carries the real 6 point fields; every other category's row keeps them all null", () => {
  const rows = rowsFromSpeciesTop("Garchomp", "doubles", GARCHOMP_DOUBLES_TOP);
  const statPointsRow = rows.find((r) => r.category === "stat_points");
  assert.equal(statPointsRow.name, null, "stat_points has no single \"name\", only the spread");
  assert.equal(statPointsRow.percentage_value, 38.6);
  assert.deepEqual(
    {
      hp: statPointsRow.hp_points,
      attack: statPointsRow.attack_points,
      defense: statPointsRow.defense_points,
      sp_attack: statPointsRow.sp_atk_points,
      sp_defense: statPointsRow.sp_def_points,
      speed: statPointsRow.speed_points,
    },
    { hp: 2, attack: 32, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 }
  );

  const moveRow = rows.find((r) => r.category === "move");
  assert.equal(moveRow.name, "Earthquake");
  assert.equal(moveRow.percentage_value, 61.2);
  ["hp_points", "attack_points", "defense_points", "sp_atk_points", "sp_def_points", "speed_points"].forEach((field) => {
    assert.equal(moveRow[field], null, `${field} must stay null on a non-stat_points row`);
  });
});

check("rowsFromIndex walks every species and both real formats, skipping a species with no summary at all", () => {
  const index = {
    pokemon: [
      {
        name: "Garchomp",
        summary: { battleSummary: { Current: { Doubles: { top: GARCHOMP_DOUBLES_TOP }, Singles: { top: { ability: { name: "Rough Skin", percentage_value: 92.0 } } } } } },
      },
      {
        // A species with no logged battle data yet — real shape seen live
        // for lower-usage species — must simply contribute zero rows, not
        // throw.
        name: "UnplayedMon",
        summary: { battleSummary: { Current: {} } },
      },
      {
        // Missing `name` entirely — malformed/defensive case, must be
        // skipped rather than writing a row keyed by "undefined".
        summary: { battleSummary: { Current: { Doubles: { top: GARCHOMP_DOUBLES_TOP } } } },
      },
    ],
  };
  const rows = rowsFromIndex(index);
  assert.equal(rows.filter((r) => r.species === "Garchomp" && r.format === "doubles").length, 5);
  assert.equal(rows.filter((r) => r.species === "Garchomp" && r.format === "singles").length, 1);
  assert.equal(rows.filter((r) => r.species === "UnplayedMon").length, 0);
  assert.equal(rows.some((r) => r.species === undefined || r.species === null), false, "the name-less entry must not produce any row");
});

check("rowsFromIndex returns [] for a missing/malformed pokemon array, rather than throwing", () => {
  assert.deepEqual(rowsFromIndex({}), []);
  assert.deepEqual(rowsFromIndex({ pokemon: null }), []);
  assert.deepEqual(rowsFromIndex(null), []);
});

// ---------------------------------------------------------------------------
// Part 2: the handler — dry-run/auth smoke tests, same shape as the
// Limitless pipeline's own (installFakeFetch/makeFakeRes).
// ---------------------------------------------------------------------------

function makeFakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.body = obj;
    return res;
  };
  return res;
}

const FAKE_INDEX = {
  pokemon: [
    { name: "Garchomp", summary: { battleSummary: { Current: { Doubles: { top: GARCHOMP_DOUBLES_TOP } } } } },
  ],
};

function installFakeFetch() {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/api")) {
      return { ok: true, json: async () => FAKE_INDEX };
    }
    throw new Error(`test double: unexpected fetch to ${u}`);
  };
  return () => {
    global.fetch = originalFetch;
  };
}

await checkAsync("real (non-dry-run) request without CRON_SECRET configured is refused with a clear 500, no network calls made", async () => {
  const restoreFetch = installFakeFetch();
  delete process.env.CRON_SECRET;
  try {
    const res = makeFakeRes();
    await cronHandler({ query: {}, headers: {} }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /CRON_SECRET is not configured/);
  } finally {
    restoreFetch();
  }
});

await checkAsync("real (non-dry-run) request with the wrong Authorization header is refused with 401", async () => {
  const restoreFetch = installFakeFetch();
  process.env.CRON_SECRET = "the-real-secret";
  try {
    const res = makeFakeRes();
    await cronHandler({ query: {}, headers: { authorization: "Bearer wrong-guess" } }, res);
    assert.equal(res.statusCode, 401);
  } finally {
    delete process.env.CRON_SECRET;
    restoreFetch();
  }
});

await checkAsync("a dry run needs no secret at all, makes no Supabase write calls, and reports exactly what it would write", async () => {
  const restoreFetch = installFakeFetch();
  delete process.env.CRON_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = makeFakeRes();
    await cronHandler({ query: { dryRun: "1" }, headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.dryRun, true);
    assert.equal(res.body.speciesSeen, 1);
    assert.equal(res.body.rowsWritten, 5, "Garchomp's Doubles fixture has 5 real categories");
    assert.ok(Array.isArray(res.body.wouldWrite), "dry run must report what it would have written");
    assert.ok(res.body.wouldWrite.some((r) => r.category === "stat_points" && r.attack_points === 32), "the fixture's real Stat Point spread should show up in the would-write rows");
  } finally {
    restoreFetch();
  }
});

await checkAsync("a source fetch failure is caught and reported, not left to crash the handler", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("simulated network failure");
  };
  try {
    const res = makeFakeRes();
    await cronHandler({ query: { dryRun: "1" }, headers: {} }, res);
    assert.equal(res.statusCode, 500);
    assert.ok(res.body.errors.some((e) => e.includes("simulated network failure")));
  } finally {
    global.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Part 3: wcRealStatPointSpreadFor + its wire-up in wcGenerateBuild —
// loaded the same vm-context way every other strategy.js test in this
// project loads it (a browser-style script, not a module).
// ---------------------------------------------------------------------------

const SCRIPT_FILES = ["type-utils.js", "stats.js", "megas.js", "strategy.js"];
const context = vm.createContext({ console });
SCRIPT_FILES.forEach((file) => {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  vm.runInContext(code, context, { filename: file });
});

const baseStatsData = loadJSON("data/base-stats.json");
const learnsets = loadJSON("data/learnsets.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
function statsFor(name) {
  return baseStatsData.find((b) => b.name === name);
}

// Sceptile is not in WINCON_META_KNOWN_SETS (only "Mega Sceptile" is) —
// a real species whose base-form build has nothing curated to override a
// live spread, making it the right fixture for these tests. Its real
// spread/percentage below are made up but shaped exactly like a real
// live_champions_stats row (see wcFetchLiveChampionsStats, teams.js).
const CONFIDENT_SPREAD = { hp: 2, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 32 };
const UNCONFIDENT_SPREAD = { hp: 4, attack: 4, defense: 4, sp_attack: 4, sp_defense: 4, speed: 4 };

check("wcRealStatPointSpreadFor returns the real spread once its percentage clears the real computed 25% floor", () => {
  const liveChampionsStats = { Sceptile: { stat_points: { percentageValue: 38.6, spPoints: CONFIDENT_SPREAD } } };
  const result = context.wcRealStatPointSpreadFor("Sceptile", "doubles", liveChampionsStats);
  // JSON round-trip: the vm context's own object literal (from the
  // function's `{...entry.spPoints}`) is a different realm than this
  // file's plain object, so a raw deepEqual would fail on prototype
  // identity alone despite matching structurally — same vm gotcha this
  // codebase's other strategy.js tests already work around (see
  // tools/test-untapped-gem-megas.mjs's own build.moves comparisons).
  assert.deepEqual(JSON.parse(JSON.stringify(result)), CONFIDENT_SPREAD);
});

check("wcRealStatPointSpreadFor returns the real spread when its percentage sits exactly AT the 25% floor (>=, not >)", () => {
  const liveChampionsStats = { Sceptile: { stat_points: { percentageValue: 25, spPoints: CONFIDENT_SPREAD } } };
  const result = context.wcRealStatPointSpreadFor("Sceptile", "doubles", liveChampionsStats);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), CONFIDENT_SPREAD);
});

check("wcRealStatPointSpreadFor returns null when the percentage sits below the 25% floor — too many real players disagree", () => {
  const liveChampionsStats = { Sceptile: { stat_points: { percentageValue: 10, spPoints: UNCONFIDENT_SPREAD } } };
  assert.equal(context.wcRealStatPointSpreadFor("Sceptile", "doubles", liveChampionsStats), null);
});

check("wcRealStatPointSpreadFor returns null with no live data at all, or no entry for this species/category", () => {
  assert.equal(context.wcRealStatPointSpreadFor("Sceptile", "doubles", null), null);
  assert.equal(context.wcRealStatPointSpreadFor("Sceptile", "doubles", {}), null);
  assert.equal(context.wcRealStatPointSpreadFor("Sceptile", "doubles", { Sceptile: {} }), null);
  assert.equal(context.wcRealStatPointSpreadFor("Sceptile", "doubles", { Sceptile: { stat_points: { percentageValue: 90 } } }), null, "a stat_points entry with no spPoints at all must still be null");
});

check("wcGenerateBuild uses a real, confident live Stat Point spread for a base-form species with nothing curated", () => {
  const liveChampionsStats = { Sceptile: { stat_points: { percentageValue: 38.6, spPoints: CONFIDENT_SPREAD } } };
  const build = context.wcGenerateBuild(
    { name: "Sceptile", types: ["Grass"] },
    statsFor("Sceptile"),
    learnsets["Sceptile"],
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData, liveChampionsStats }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(build.sp)), CONFIDENT_SPREAD);
});

check("wcGenerateBuild falls back to the wcPickSP heuristic when the live spread is below the confidence floor", () => {
  const liveChampionsStats = { Sceptile: { stat_points: { percentageValue: 10, spPoints: UNCONFIDENT_SPREAD } } };
  const build = context.wcGenerateBuild(
    { name: "Sceptile", types: ["Grass"] },
    statsFor("Sceptile"),
    learnsets["Sceptile"],
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData, liveChampionsStats }
  );
  assert.notDeepEqual(JSON.parse(JSON.stringify(build.sp)), UNCONFIDENT_SPREAD, "an unconfident live spread must never be used");
});

check("wcGenerateBuild behaves exactly as before (heuristic wcPickSP) when opts.liveChampionsStats is simply absent — no regression for every existing caller that doesn't pass it", () => {
  const build = context.wcGenerateBuild(
    { name: "Sceptile", types: ["Grass"] },
    statsFor("Sceptile"),
    learnsets["Sceptile"],
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData }
  );
  assert.ok(build.sp && Number.isFinite(build.sp.hp), "a build must always come out with a real Stat Point spread, live data or not");
});

check("wcGenerateBuild's existing curated Stat Points (e.g. Garchomp) still win over a live spread — a human's own verification outranks automated live data", () => {
  const liveChampionsStats = { Garchomp: { stat_points: { percentageValue: 99, spPoints: { hp: 4, attack: 4, defense: 4, sp_attack: 4, sp_defense: 4, speed: 4 } } } };
  const build = context.wcGenerateBuild(
    { name: "Garchomp", types: ["Dragon", "Ground"] },
    statsFor("Garchomp"),
    learnsets["Garchomp"],
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData, liveChampionsStats }
  );
  // Hardcoded from strategy.js's own WINCON_META_KNOWN_SETS (const, so not
  // readable off the vm context — see this codebase's established
  // convention for this exact gotcha, e.g. tools/test-curated-nature-sp.mjs).
  const GARCHOMP_CURATED_SP = { hp: 2, attack: 32, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 };
  assert.deepEqual(JSON.parse(JSON.stringify(build.sp)), GARCHOMP_CURATED_SP);
});

check("wcGenerateBuild never applies a live spread to a build that auto-opts into a Mega form — the Mega-conflation guard", () => {
  // Gengar is not in WINCON_META_KNOWN_SETS, so with a qualifying
  // live_meta_builds entry it auto-opts into Mega Gengar (see
  // tools/test-untapped-gem-megas.mjs for the same fixture shape). A live
  // Stat Point entry keyed by the BASE species "Gengar" must NOT be
  // applied to this Mega build — championsbattledata.com's aggregate for
  // a species mixes in however much of its logged data was actually its
  // Mega form, so trusting it here risks handing out a spread tuned for
  // the wrong stat line entirely (see wcRealStatPointSpreadFor's own
  // header comment in strategy.js).
  const gengarBaseStats = statsFor("Gengar");
  const megaGengarBaseStats = statsFor("Mega Gengar");
  const liveMetaBuilds = { Gengar: [{ item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 25, winRate: 64 }] };
  const liveChampionsStats = { Gengar: { stat_points: { percentageValue: 99, spPoints: { hp: 4, attack: 4, defense: 4, sp_attack: 4, sp_defense: 4, speed: 4 } } } };
  const build = context.wcGenerateBuild(
    { name: "Gengar", types: ["Ghost", "Poison"] },
    gengarBaseStats,
    learnsets["Gengar"],
    movesData,
    [],
    typeChart,
    {
      format: "doubles",
      usedItems: new Set(),
      megaForms: [{ name: "Mega Gengar", types: ["Ghost", "Poison"], baseStats: megaGengarBaseStats }],
      abilitiesData,
      liveMetaBuilds,
      liveChampionsStats,
    }
  );
  assert.equal(build.item, "Gengarite", "sanity check: this build really did auto-opt into Mega Gengar");
  assert.notDeepEqual(JSON.parse(JSON.stringify(build.sp)), { hp: 4, attack: 4, defense: 4, sp_attack: 4, sp_defense: 4, speed: 4 }, "the base species' live spread must never be forced onto this Mega build");
});

console.log("");
console.log(`All ${checks} championsbattledata.com pipeline checks passed (pure transforms + end-to-end handler smoke tests + wcRealStatPointSpreadFor/wcGenerateBuild integration).`);
