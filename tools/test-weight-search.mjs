#!/usr/bin/env node
// WinCon — tools/test-weight-search.mjs (Milestone 35, Task 3)
//
// Dev-only regression test for the weight-search/evaluation-gate MATH in
// tools/selfplay-harness.mjs — perturbOneWeight, acceptRound, and
// computeGateVerdict. These are plain functions with zero dependency on the
// vm context or the battle engine (see that file's own "Testability" note),
// so this test drives them directly with fully controlled inputs — fake rng
// sequences, fake win/loss counts, fake win rates — the same way
// tools/test-lineup-search.mjs stubs wcRunMonteCarlo to test
// wcSelectBestLineupBySuccessiveHalving's search logic in isolation from the
// real (expensive, randomized) damage engine.
//
// A second section runs the full --search CLI end to end on a tiny scale
// (a handful of iterations/battles) as a real smoke test — proving the
// pieces this file can't unit-test in isolation (vm loading, actually
// calling wcRunOneBattle, actually writing/not-writing the weights file)
// still work together, without needing thousands of battles.
//
// Run: node tools/test-weight-search.mjs

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { perturbOneWeight, acceptRound, computeGateVerdict, perturbableKeysOf, WC_NON_PERTURBABLE_AI_WEIGHT_KEYS } from "./selfplay-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let checks = 0;
function check(description, fn) {
  fn();
  checks += 1;
  console.log(`OK  ${description}`);
}

// ---------------------------------------------------------------------------
// perturbableKeysOf
// ---------------------------------------------------------------------------

check("perturbableKeysOf excludes exactly the three pinned-at-zero keys", () => {
  const weights = { a: 1, b: 2, tailwindAlreadyUpScore: 0, trickRoomAlreadyUpScore: 0, statusUntargetableScore: 0, c: 3 };
  const keys = perturbableKeysOf(weights);
  assert.deepEqual(new Set(keys), new Set(["a", "b", "c"]));
  WC_NON_PERTURBABLE_AI_WEIGHT_KEYS.forEach((k) => assert.equal(keys.includes(k), false, `${k} must not be perturbable`));
});

// ---------------------------------------------------------------------------
// perturbOneWeight — fully controlled fake rng, so both which key gets
// chosen and the perturbation factor are exact, known values.
// ---------------------------------------------------------------------------

check("perturbOneWeight picks the key its rng's first draw selects, and scales only that key", () => {
  const weights = { alpha: 10, beta: 20, gamma: 30 };
  const keys = ["alpha", "beta", "gamma"];
  // First rng() call picks the key index: 0.4 * 3 = 1.2 -> floor 1 -> "beta".
  // Second rng() call sets the factor: step=0.5, rng()=0.75 -> 1 + (0.75*2-1)*0.5 = 1.25.
  const draws = [0.4, 0.75];
  let i = 0;
  const fakeRng = () => draws[i++];
  const { weights: candidate, key, factor } = perturbOneWeight(weights, keys, 0.5, fakeRng);
  assert.equal(key, "beta");
  assert.equal(factor, 1.25);
  assert.equal(candidate.beta, 25); // 20 * 1.25
  assert.equal(candidate.alpha, 10); // untouched
  assert.equal(candidate.gamma, 30); // untouched
  assert.notEqual(candidate, weights, "must return a new object, never mutate the input");
  assert.equal(weights.beta, 20, "original weights object must be untouched");
});

check("perturbOneWeight throws on an empty perturbable-key list rather than silently no-op'ing", () => {
  assert.throws(() => perturbOneWeight({ a: 1 }, [], 0.2, Math.random), /no perturbable keys/);
});

// ---------------------------------------------------------------------------
// acceptRound — the literal task rule: "wins more than the current best".
// ---------------------------------------------------------------------------

check("acceptRound accepts only a strict win-count majority for the candidate", () => {
  assert.equal(acceptRound(11, 9), true, "11 > 9 must accept");
  assert.equal(acceptRound(9, 11), false, "9 > 11 must reject");
  assert.equal(acceptRound(10, 10), false, "an exact tie must reject, not accept");
  assert.equal(acceptRound(0, 0), false, "an all-draws round must reject");
});

// ---------------------------------------------------------------------------
// computeGateVerdict — the strict evaluation gate's pass/fail math.
// ---------------------------------------------------------------------------

check("computeGateVerdict passes only when the delta clears the stated margin", () => {
  const clearWin = computeGateVerdict(0.60, 0.50, 3);
  assert.equal(clearWin.pass, true);
  assert.ok(Math.abs(clearWin.deltaPercentagePoints - 10) < 1e-9);

  const belowMargin = computeGateVerdict(0.505, 0.50, 3);
  assert.equal(belowMargin.pass, false, "a 0.5-point delta must not clear a 3-point margin");
  assert.ok(Math.abs(belowMargin.deltaPercentagePoints - 0.5) < 1e-9);

  const exactlyAtMargin = computeGateVerdict(0.53, 0.50, 3);
  assert.equal(exactlyAtMargin.pass, true, "a delta exactly equal to the margin must pass (>=, not >)");

  const worse = computeGateVerdict(0.40, 0.50, 3);
  assert.equal(worse.pass, false);
  assert.ok(worse.deltaPercentagePoints < 0, "a candidate worse than baseline must show a negative delta");

  const zeroMarginTie = computeGateVerdict(0.50, 0.50, 0);
  assert.equal(zeroMarginTie.pass, true, "a zero margin must accept an exact tie");
});

console.log("");
console.log(`All ${checks} pure weight-search/gate logic checks passed.`);

// ---------------------------------------------------------------------------
// End-to-end smoke test: run the real --search CLI on a tiny scale against
// the bundled fixtures. This does not assert a specific win rate (that
// would be flaky — it depends on the real damage/turn-order engine and
// whatever the search rng happens to explore) — it asserts the CLI:
//   (a) exits cleanly,
//   (b) prints a per-round log line for every requested iteration,
//   (c) prints the gate's delta and battle count, matching the task's
//       explicit "log the exact win-rate delta and battle count for every
//       candidate" requirement,
//   (d) leaves the weights file untouched when the gate (correctly) fails
//       against an unreachably strict margin, and
//   (e) DOES write the file when the gate is given a trivially-clearable
//       margin — proving the write-on-pass branch actually executes, not
//       just that it looks right on inspection.
// ---------------------------------------------------------------------------

const HARNESS = path.join(ROOT, "tools", "selfplay-harness.mjs");
const TEAM_A = path.join(ROOT, "tools", "fixtures", "team-kingambit-sun.json");
const TEAM_B = path.join(ROOT, "tools", "fixtures", "team-hyper-offense.json");

function runCli(args) {
  return execFileSync("node", [HARNESS, ...args], { encoding: "utf8" });
}

{
  const outPath = path.join(ROOT, "tools", "__test_search_output_impossible.json");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  const output = runCli([
    "--search",
    "--team-a", TEAM_A,
    "--team-b", TEAM_B,
    "--search-iterations", "4",
    "--search-battles", "10",
    "--search-seed", "1",
    "--gate-battles", "40",
    "--gate-margin", "10000", // impossible to clear — must never write
    "--weights-out", outPath,
  ]);

  const roundLines = output.match(/^round \d+\/4:/gm) || [];
  assert.equal(roundLines.length, 4, `expected exactly 4 round log lines, got ${roundLines.length}\n${output}`);
  assert.match(output, /Delta: [+-][\d.]+ percentage points over 40 battles each/, "must log the exact delta and battle count");
  assert.match(output, /FAIL — gate not cleared/);
  assert.equal(fs.existsSync(outPath), false, "an unreachable gate margin must never write the weights file");
  console.log("OK  end-to-end smoke: impossible gate margin logs every round + the exact delta, and never writes the file");
}

{
  const outPath = path.join(ROOT, "tools", "__test_search_output_trivial.json");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  const output = runCli([
    "--search",
    "--team-a", TEAM_A,
    "--team-b", TEAM_A, // mirror gauntlet — see selfplay-harness.mjs's own note on why this is fine for a smoke test
    "--search-iterations", "3",
    "--search-battles", "10",
    "--search-seed", "1",
    "--gate-battles", "40",
    "--gate-margin", "0", // trivially clearable (delta >= 0 always passes) — proves the write branch fires
    "--weights-out", outPath,
  ]);
  assert.match(output, /PASS — wrote/);
  assert.equal(fs.existsSync(outPath), true, "a trivially-clearable gate margin must write the weights file");
  const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(typeof written, "object");
  assert.ok(Object.keys(written).length >= 15, "written weights file must contain the full weights object, not a partial one");
  fs.unlinkSync(outPath);
  console.log("OK  end-to-end smoke: trivially-clearable gate margin actually writes the weights file, with the full weights object");
}

console.log("");
console.log("All weight-search tests passed (pure logic + end-to-end smoke).");
