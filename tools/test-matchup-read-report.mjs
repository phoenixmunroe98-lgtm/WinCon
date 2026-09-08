// WinCon — tools/test-matchup-read-report.mjs (Milestone 54, Part C)
//
// Regression test for wcMatchupReadReport (battle-sim-lineup.js) --
// WinCon's own, no-external-AI answer to a "Win Rate Calculator AI"
// request (see README's Milestone 54 section). This one deliberately
// tests against a HAND-CRAFTED result.grid rather than a full real
// Monte-Carlo run: the function only ever reads the grid's own shape
// (winRateA/megaA/megaB per cell), never the simulation internals, so a
// hand-built grid with known, chosen win rates is a legitimate, much
// faster way to pin down the confidence-level math and pivot-point
// selection/ordering exactly. The Speed/type-matchup narration lines, by
// contrast, ARE checked against real fixture species and their real
// built stats/types -- nothing there is invented either.
//
// Run: node tools/test-matchup-read-report.mjs

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

const SCRIPT_FILES = ["type-utils.js", "stats.js", "megas.js", "strategy.js", "battle-sim-lineup.js"];
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

const pokemonList = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const learnsets = loadJSON("data/learnsets.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const natures = loadJSON("data/natures.json");
const statsFor = (n) => baseStatsData.find((b) => b.name === n);

function specFor(name) {
  const p = pokemonList.find((pp) => pp.name === name);
  const baseStats = statsFor(name);
  const build = context.wcGenerateBuild(
    { name, types: p.types },
    baseStats,
    learnsets[name],
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData }
  );
  return { name, types: p.types, baseStats, build };
}

// Real fixture species on both sides -- their real base Speed, real
// built Stat Points/Nature, and real typing all feed the Simulation
// Logic lines, so this is exactly what a real saved team would produce.
const teamASpecs = [specFor("Charizard"), specFor("Whimsicott")];
const teamBSpecs = [specFor("Steelix"), specFor("Sylveon")];

const realSpeedOf = (spec) => context.wcCalcStat(spec.baseStats.spe, "speed", spec.build.sp.speed || 0, spec.build.nature, natures);
const fastestA = teamASpecs.reduce((a, b) => (realSpeedOf(b) > realSpeedOf(a) ? b : a));
const fastestB = teamBSpecs.reduce((a, b) => (realSpeedOf(b) > realSpeedOf(a) ? b : a));

check("wcMatchupReadReport returns null (not a crash) when the grid is missing or empty", () => {
  assert.equal(context.wcMatchupReadReport(null, "A", "B", teamASpecs, teamBSpecs, natures, typeChart), null);
  assert.equal(context.wcMatchupReadReport({ grid: [] }, "A", "B", teamASpecs, teamBSpecs, natures, typeChart), null);
});

check("wcMatchupReadReport's headline is the real 'neither side Mega'd' cell's win rate, rounded to a whole percent", () => {
  const grid = [
    { megaA: null, megaB: null, winRateA: 0.552 },
    { megaA: "Charizard", megaB: null, winRateA: 0.70 },
  ];
  const report = context.wcMatchupReadReport({ grid }, "Team A", "Team B", teamASpecs, teamBSpecs, natures, typeChart);
  assert.equal(report.headlinePct, 55, `expected 0.552 rounded to 55, got ${report.headlinePct}`);
});

check("wcMatchupReadReport's confidence is 'high' on a real tight grid spread (<=10 points) and 'low' on a wide one (>25 points), with the same headline cell", () => {
  const tightGrid = [
    { megaA: null, megaB: null, winRateA: 0.55 },
    { megaA: "Charizard", megaB: null, winRateA: 0.58 },
    { megaA: null, megaB: "Steelix", winRateA: 0.50 },
  ];
  const tightReport = context.wcMatchupReadReport({ grid: tightGrid }, "Team A", "Team B", teamASpecs, teamBSpecs, natures, typeChart);
  assert.equal(tightReport.confidence, "high", `expected a <=10pt spread to read high confidence, got ${tightReport.confidence}`);

  const wideGrid = [
    { megaA: null, megaB: null, winRateA: 0.55 },
    { megaA: "Charizard", megaB: null, winRateA: 0.80 },
    { megaA: null, megaB: "Steelix", winRateA: 0.30 },
  ];
  const wideReport = context.wcMatchupReadReport({ grid: wideGrid }, "Team A", "Team B", teamASpecs, teamBSpecs, natures, typeChart);
  assert.equal(wideReport.confidence, "low", `expected a >25pt spread to read low confidence, got ${wideReport.confidence}`);
  assert.equal(wideReport.headlinePct, tightReport.headlinePct, "both grids share the same default cell -- only the spread should change the confidence read");
});

check("wcMatchupReadReport's confidenceNote cites the real battle count (grid.length * the real WC_TEAMVSTEAM_RUNS_PER_OPPONENT constant)", () => {
  const grid = [
    { megaA: null, megaB: null, winRateA: 0.5 },
    { megaA: "Charizard", megaB: null, winRateA: 0.6 },
  ];
  const report = context.wcMatchupReadReport({ grid }, "Team A", "Team B", teamASpecs, teamBSpecs, natures, typeChart);
  // top-level `const` inside vm.runInContext code creates a lexical
  // binding, not an own property of the contextified sandbox object, so
  // it can't be read back as context.WC_TEAMVSTEAM_RUNS_PER_OPPONENT from
  // out here -- its real value (3000) is grep-confirmed directly in
  // battle-sim-lineup.js and hardcoded here as this test's own real,
  // independently-verifiable expectation instead.
  const RUNS_PER_OPPONENT = 3000;
  const expectedBattles = grid.length * RUNS_PER_OPPONENT;
  assert.ok(report.confidenceNote.includes(String(expectedBattles)), `expected the real battle count ${expectedBattles} in: ${report.confidenceNote}`);
  assert.ok(report.confidenceNote.toLowerCase().includes("not a guaranteed"), "expected the mandatory 'not guaranteed' honesty phrasing");
});

check("wcMatchupReadReport's Simulation Logic Speed line names the real faster side by its real fastest member and real Speed stat", () => {
  const grid = [{ megaA: null, megaB: null, winRateA: 0.5 }];
  const report = context.wcMatchupReadReport({ grid }, "Team A", "Team B", teamASpecs, teamBSpecs, natures, typeChart);
  const speedLine = report.simulationLogicLines[0];
  assert.ok(speedLine.includes(String(realSpeedOf(fastestA))) || speedLine.includes(String(realSpeedOf(fastestB))), `expected a real Speed number in: ${speedLine}`);
  if (realSpeedOf(fastestA) > realSpeedOf(fastestB)) {
    assert.ok(speedLine.includes(fastestA.name) && speedLine.includes("outpaces"), `expected Team A's real fastest (${fastestA.name}) to be named as outpacing, got: ${speedLine}`);
  } else if (realSpeedOf(fastestB) > realSpeedOf(fastestA)) {
    assert.ok(speedLine.includes(fastestB.name) && speedLine.includes("real Speed-tier disadvantage"), `expected Team B's real fastest (${fastestB.name}) to be named as outpacing, got: ${speedLine}`);
  } else {
    assert.ok(speedLine.includes("exactly ties"), `expected a real speed-tie line, got: ${speedLine}`);
  }
});

check("wcMatchupReadReport's Simulation Logic type-advantage line matches a real pairing count computed directly via wcEffectivenessOf", () => {
  const grid = [{ megaA: null, megaB: null, winRateA: 0.5 }];
  const report = context.wcMatchupReadReport({ grid }, "Team A", "Team B", teamASpecs, teamBSpecs, natures, typeChart);
  let favorsA = 0;
  let favorsB = 0;
  teamASpecs.forEach((a) => {
    teamBSpecs.forEach((b) => {
      const aAdvantage = a.types.some((t) => context.wcEffectivenessOf(typeChart, t, b.types) > 1);
      const bAdvantage = b.types.some((t) => context.wcEffectivenessOf(typeChart, t, a.types) > 1);
      if (aAdvantage && !bAdvantage) favorsA += 1;
      else if (bAdvantage && !aAdvantage) favorsB += 1;
    });
  });
  const typeLine = report.simulationLogicLines[1];
  assert.ok(typeLine.includes(`${favorsA} pairings favor`) || typeLine.includes(`(${favorsA} pairings favor Team A`), `expected the real pairing counts (${favorsA} vs ${favorsB}) in: ${typeLine}`);
});

check("wcMatchupReadReport's Pivot Points are read directly off the real grid, sorted by the largest real delta from the headline, capped to 3", () => {
  const grid = [
    { megaA: null, megaB: null, winRateA: 0.50 }, // headline: 50%
    { megaA: "Charizard", megaB: null, winRateA: 0.55 }, // delta +5 (smallest -- expected to be dropped)
    { megaA: null, megaB: "Steelix", winRateA: 0.30 }, // delta -20
    { megaA: "Charizard", megaB: "Steelix", winRateA: 0.70 }, // delta +20
    { megaA: null, megaB: "Sylveon", winRateA: 0.42 }, // delta -8
  ];
  const report = context.wcMatchupReadReport({ grid }, "Team A", "Team B", teamASpecs, teamBSpecs, natures, typeChart);
  assert.equal(report.pivotPointLines.length, 3, "expected the top-3 real deltas only");
  // The two +/-20 deltas are the largest in magnitude, so both must
  // appear; the -8 delta is the third-largest and also survives; only
  // the smallest real delta (+5) gets dropped by the top-3 cap.
  assert.ok(report.pivotPointLines[0].includes("70%") || report.pivotPointLines[0].includes("30%"), `expected the largest real delta first, got: ${report.pivotPointLines[0]}`);
  assert.ok(report.pivotPointLines.some((l) => l.includes("Charizard") && l.includes("Steelix") && l.includes("70%")), "expected the real double-Mega scenario named with its real resulting win rate");
  assert.ok(report.pivotPointLines.some((l) => l.includes("42%")), "expected the real -8pt delta (42%) to survive the top-3 cap");
  assert.ok(!report.pivotPointLines.some((l) => l.includes("55%")), "expected the smallest real delta (+5, 55%) to be dropped by the top-3 cap");
});

check("wcMatchupReadReport's Pivot Points honestly falls back when no real grid scenario meaningfully changes the win rate", () => {
  const grid = [
    { megaA: null, megaB: null, winRateA: 0.50 },
    { megaA: "Charizard", megaB: null, winRateA: 0.50 },
    { megaA: null, megaB: "Steelix", winRateA: 0.50 },
  ];
  const report = context.wcMatchupReadReport({ grid }, "Team A", "Team B", teamASpecs, teamBSpecs, natures, typeChart);
  assert.deepEqual(JSON.parse(JSON.stringify(report.pivotPointLines)), [
    "No Mega-Evolution choice meaningfully changes the win rate here -- every scenario this app actually simulated landed close to the headline number.",
  ]);
});

console.log(`\nAll ${checks} Matchup Read Report checks passed.`);
