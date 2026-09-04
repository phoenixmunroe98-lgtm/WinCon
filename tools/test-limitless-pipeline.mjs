#!/usr/bin/env node
// WinCon — tools/test-limitless-pipeline.mjs (Milestone 34: the Limitless pipeline)
//
// Dev-only regression test for the PURE aggregation math in
// api/cron-limitless-sync.js — foldPlayerIntoAggregates, mergeRunningAverage,
// and buildKeyFor. None of these three touch the network or the database
// (see that file's own header comment), so this test drives them directly
// against a small, hand-built standings fixture shaped exactly like a real
// Limitless /tournaments/{id}/standings response (confirmed live against
// the real API during Milestone 34's own research) — no mocking needed.
//
// Run: node tools/test-limitless-pipeline.mjs

import assert from "node:assert/strict";
import cronHandler from "../api/cron-limitless-sync.js";

const { foldPlayerIntoAggregates, mergeRunningAverage, buildKeyFor } = cronHandler;

let checks = 0;
function check(description, fn) {
  fn();
  checks += 1;
  console.log(`OK  ${description}`);
}

// ---------------------------------------------------------------------------
// buildKeyFor — move order must not matter; every other field must.
// ---------------------------------------------------------------------------

check("buildKeyFor is insensitive to move order", () => {
  const a = buildKeyFor("Kingambit", "Defiant", "Life Orb", "Adamant", ["Kowtow Cleave", "Sucker Punch", "Swords Dance", "Protect"]);
  const b = buildKeyFor("Kingambit", "Defiant", "Life Orb", "Adamant", ["Protect", "Swords Dance", "Sucker Punch", "Kowtow Cleave"]);
  assert.equal(a, b);
});

check("buildKeyFor distinguishes different items/abilities/natures for the same species", () => {
  const base = buildKeyFor("Kingambit", "Defiant", "Life Orb", "Adamant", ["Kowtow Cleave"]);
  assert.notEqual(base, buildKeyFor("Kingambit", "Defiant", "Black Glasses", "Adamant", ["Kowtow Cleave"]), "different item must produce a different key");
  assert.notEqual(base, buildKeyFor("Kingambit", "Supreme Overlord", "Life Orb", "Adamant", ["Kowtow Cleave"]), "different ability must produce a different key");
  assert.notEqual(base, buildKeyFor("Kingambit", "Defiant", "Life Orb", "Jolly", ["Kowtow Cleave"]), "different nature must produce a different key");
});

// ---------------------------------------------------------------------------
// mergeRunningAverage — the weighted-average math a running aggregate needs
// to get right, since it's re-derived from a compact (timesUsed, winRate)
// pair rather than ever storing every individual sample.
// ---------------------------------------------------------------------------

check("mergeRunningAverage starts a fresh average when there's no existing row", () => {
  const result = mergeRunningAverage(undefined, 2, 150); // two samples averaging 75%
  assert.equal(result.timesUsed, 2);
  assert.equal(result.winRate, 75);
});

check("mergeRunningAverage correctly weights an existing average against new samples", () => {
  // Existing: 10 samples averaging 60% (sum = 600). New: 5 samples averaging 20% (sum = 100).
  // Combined: 15 samples, sum 700, average 46.666... -> rounded to 1 decimal place: 46.7
  const result = mergeRunningAverage({ times_used: 10, win_rate: 60 }, 5, 100);
  assert.equal(result.timesUsed, 15);
  assert.equal(result.winRate, 46.7);
});

check("mergeRunningAverage handles an existing row with a null win_rate (no prior samples ever recorded) as a zero base", () => {
  const result = mergeRunningAverage({ times_used: 0, win_rate: null }, 3, 300);
  assert.equal(result.timesUsed, 3);
  assert.equal(result.winRate, 100);
});

// ---------------------------------------------------------------------------
// foldPlayerIntoAggregates — the per-player, per-tournament accumulation
// step. Fixture shaped exactly like a real /standings response entry.
// ---------------------------------------------------------------------------

function kingambitPlayer(winRateWins, winRateLosses) {
  return {
    name: "test-player",
    country: "US",
    record: { wins: winRateWins, losses: winRateLosses, ties: 0 },
    decklist: [
      { id: "kingambit", name: "Kingambit", item: "Life Orb", ability: "Defiant", attacks: ["Kowtow Cleave", "Sucker Punch", "Swords Dance", "Protect"], nature: "Adamant", tera: null },
      { id: "sneasler", name: "Sneasler", item: "Focus Sash", ability: "Unburden", attacks: ["Close Combat", "Dire Claw", "Protect", "Fake Out"], nature: "Jolly", tera: null },
    ],
    placing: 1,
    player: "test-player",
    deck: {},
    drop: null,
  };
}

check("foldPlayerIntoAggregates accumulates times-used and a win-rate-weighted sum per species", () => {
  const tierStats = {};
  const metaBuilds = {};
  foldPlayerIntoAggregates(kingambitPlayer(8, 2), tierStats, metaBuilds); // 80% win rate
  foldPlayerIntoAggregates(kingambitPlayer(2, 8), tierStats, metaBuilds); // 20% win rate

  assert.equal(tierStats.Kingambit.timesUsed, 2);
  assert.equal(tierStats.Kingambit.winRateSum, 100); // 80 + 20
  assert.equal(tierStats.Sneasler.timesUsed, 2);
  assert.equal(tierStats.Sneasler.winRateSum, 100);
});

check("foldPlayerIntoAggregates groups identical builds together and keeps different builds separate", () => {
  const tierStats = {};
  const metaBuilds = {};
  foldPlayerIntoAggregates(kingambitPlayer(10, 0), tierStats, metaBuilds); // same exact Kingambit build as below
  foldPlayerIntoAggregates(kingambitPlayer(0, 10), tierStats, metaBuilds); // identical build, different outcome

  const kingambitKey = buildKeyFor("Kingambit", "Defiant", "Life Orb", "Adamant", ["Kowtow Cleave", "Sucker Punch", "Swords Dance", "Protect"]);
  assert.equal(metaBuilds[kingambitKey].timesUsed, 2);
  assert.equal(metaBuilds[kingambitKey].winRateSum, 100); // 100 + 0
  assert.equal(Object.keys(metaBuilds).length, 2, "Kingambit + Sneasler builds only — no phantom extra entries");
});

check("foldPlayerIntoAggregates skips a player with zero total games (a full-tournament drop before playing)", () => {
  const tierStats = {};
  const metaBuilds = {};
  const noShow = kingambitPlayer(0, 0);
  noShow.record.ties = 0;
  foldPlayerIntoAggregates(noShow, tierStats, metaBuilds);
  assert.deepEqual(tierStats, {}, "a player with 0 wins/losses/ties must contribute nothing — there's no real outcome to weight by");
  assert.deepEqual(metaBuilds, {});
});

check("foldPlayerIntoAggregates never double-counts a species appearing twice in one malformed decklist", () => {
  const tierStats = {};
  const metaBuilds = {};
  const malformed = kingambitPlayer(6, 4);
  malformed.decklist.push({ ...malformed.decklist[0] }); // duplicate Kingambit entry
  foldPlayerIntoAggregates(malformed, tierStats, metaBuilds);
  assert.equal(tierStats.Kingambit.timesUsed, 1, "one player, one real team slot — a duplicate entry must not count twice");
});

console.log("");
console.log(`All ${checks} Limitless pipeline aggregation checks passed.`);

// ---------------------------------------------------------------------------
// End-to-end smoke test of the actual handler — mocked fetch (both the
// Limitless calls and, where reached, the Supabase REST calls), a fake
// req/res pair, and real environment variables set/unset per case. This is
// the piece the pure-function checks above can't cover: the auth guard,
// the dry-run branch actually short-circuiting before any write call, and
// the tournament loop actually calling the aggregation functions above in
// context.
// ---------------------------------------------------------------------------

async function checkAsync(description, fn) {
  await fn();
  checks += 1;
  console.log(`OK  ${description}`);
}

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

const FAKE_TOURNAMENTS = [
  { game: "VGC", name: "Fixture Weekly #1", date: "2026-08-01T00:00:00.000Z", format: "M-B", id: "fixture-t1", players: 32, organizerId: 1 },
  { game: "VGC", name: "Fixture Weekly #2", date: "2026-08-08T00:00:00.000Z", format: "M-B", id: "fixture-t2", players: 40, organizerId: 1 },
];

const FAKE_STANDINGS = {
  "fixture-t1": [kingambitPlayer(9, 1)],
  "fixture-t2": [kingambitPlayer(5, 5)],
};

function installFakeFetch() {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/tournaments?")) {
      return { ok: true, json: async () => FAKE_TOURNAMENTS };
    }
    const standingsMatch = u.match(/\/api\/tournaments\/([^/]+)\/standings/);
    if (standingsMatch) {
      return { ok: true, json: async () => FAKE_STANDINGS[standingsMatch[1]] || [] };
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
    assert.equal(res.body.tournamentsProcessed, 2, "both fixture tournaments should be processed");
    assert.equal(res.body.tournamentsSkipped, 0);
    assert.ok(res.body.wouldWrite, "dry run must report what it would have written");
    assert.ok(res.body.wouldWrite.tierStats.Kingambit, "the fixture's Kingambit appearances should show up in the would-write tier stats");
    assert.equal(res.body.wouldWrite.tierStats.Kingambit.timesUsed, 2, "one appearance per fixture tournament");
  } finally {
    restoreFetch();
  }
});

await checkAsync("a per-tournament fetch failure is skipped, not fatal to the whole dry run", async () => {
  const trueOriginalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/tournaments?")) return { ok: true, json: async () => FAKE_TOURNAMENTS };
    if (u.includes("/tournaments/fixture-t1/standings")) throw new Error("simulated network failure");
    const standingsMatch = u.match(/\/api\/tournaments\/([^/]+)\/standings/);
    if (standingsMatch) return { ok: true, json: async () => FAKE_STANDINGS[standingsMatch[1]] || [] };
    throw new Error(`test double: unexpected fetch to ${u}`);
  };
  const restoreFetch = () => {
    global.fetch = trueOriginalFetch;
  };
  try {
    const res = makeFakeRes();
    await cronHandler({ query: { dryRun: "1" }, headers: {} }, res);
    assert.equal(res.statusCode, 200, "one bad tournament must not fail the whole run");
    assert.equal(res.body.tournamentsProcessed, 1, "only the surviving tournament counts as processed");
    assert.equal(res.body.tournamentsSkipped, 1);
    assert.ok(res.body.errors.some((e) => e.includes("fixture-t1")), "the skipped tournament's id should be named in the error log");
  } finally {
    restoreFetch();
  }
});

console.log("");
console.log(`All ${checks} Limitless pipeline checks passed (pure aggregation math + end-to-end handler smoke tests).`);
