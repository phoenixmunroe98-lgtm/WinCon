// WinCon — tools/test-team-strategy-report.mjs (Milestone 54, Part A)
//
// Regression test for wcTeamStrategyReport (strategy.js) -- WinCon's own,
// no-external-AI answer to a "Team Builder AI" request (see README's
// Milestone 54 section). Every assertion here checks against real,
// independently-verifiable data (real roster species, real type-chart
// math, real built moves) -- nothing is a placeholder/mocked value.
//
// Run: node tools/test-team-strategy-report.mjs

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

const pokemonList = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const learnsets = loadJSON("data/learnsets.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const statsFor = (n) => baseStatsData.find((b) => b.name === n);

function buildTeam(names) {
  const members = names.map((n) => {
    const p = pokemonList.find((pp) => pp.name === n);
    return { name: n, slotName: n, types: p.types, baseStats: statsFor(n), learnableNames: learnsets[n] };
  });
  const builds = {};
  members.forEach((m) => {
    builds[m.name] = context.wcGenerateBuild(
      { name: m.name, types: m.types },
      m.baseStats,
      m.learnableNames,
      movesData,
      [],
      typeChart,
      { format: "doubles", usedItems: new Set(), abilitiesData }
    );
  });
  return { members, builds };
}

// A defensively poor real fixture (several real Fire/Fighting/Ground/
// Fairy/Poison/Steel weaknesses cluster on this exact roster -- verified
// independently below via wcSharedWeaknessWarnings directly) -- expected
// to land in the lower grade bands.
const weakTeam = buildTeam(["Kingambit", "Whimsicott", "Garchomp", "Incineroar", "Sylveon", "Grimmsnarl"]);

check("wcTeamStrategyReport returns all four real fields with no crash on a real, complete fixture team", () => {
  const report = context.wcTeamStrategyReport(weakTeam.members, weakTeam.builds, movesData, [], typeChart, "doubles", "", abilitiesData, null);
  assert.ok(typeof report.winCondition === "string" && report.winCondition.length > 0);
  assert.equal(report.roleLines.length, 6, "one role line per team member");
  assert.ok(report.threatLines.length > 0);
  assert.equal(report.coverageLines.length, 2, "one offensive line, one defensive line");
  assert.ok(["S", "A", "B", "C", "D"].includes(report.grade.letter));
  assert.ok(report.grade.score >= 0 && report.grade.score <= 100);
});

check("wcTeamStrategyReport's grade responds to real shared-weakness warnings -- a team independently confirmed to have 11 real shared weaknesses scores in the bottom band", () => {
  const sharedWeaknesses = context.wcSharedWeaknessWarnings(weakTeam.members, typeChart);
  assert.ok(sharedWeaknesses.length >= 10, `expected this fixture's real shared-weakness count to stay double digits, got ${sharedWeaknesses.length} -- if this roster's real typing changed, pick a new deliberately-weak fixture`);
  const report = context.wcTeamStrategyReport(weakTeam.members, weakTeam.builds, movesData, [], typeChart, "doubles", "", abilitiesData, null);
  assert.equal(report.grade.letter, "D", `expected a real, heavily-penalized D grade for this fixture, got ${report.grade.letter} (${report.grade.score})`);
});

check("wcTeamStrategyReport names the real setter directly in that member's own role line, not a generic role description", () => {
  const report = context.wcTeamStrategyReport(weakTeam.members, weakTeam.builds, movesData, [], typeChart, "doubles", "", abilitiesData, null);
  // Whatever the real winning archetype/setter turned out to be for this
  // fixture (Auto-build's own heuristic decides it, not this test), that
  // exact setter's own role line must say so -- checked generically
  // rather than hardcoding which archetype wins, since that depends on
  // wcGenerateBuild's own move choices.
  const setterMatch = report.roleLines.find((line) => /sets .* -- the team's real win condition\.$/.test(line));
  if (report.winCondition.startsWith("Win condition:")) {
    assert.ok(setterMatch, `expected one role line to name the real setter, got: ${JSON.stringify(report.roleLines)}`);
  } else {
    assert.equal(setterMatch, undefined, "an 'independent' team should have no setter role line");
  }
});

check("wcDefensiveCoverageGaps only ever returns real types where wcTeamNetScoreForType is genuinely <= -2 (spot-checked against Fairy for the weak fixture)", () => {
  const gaps = context.wcDefensiveCoverageGaps(weakTeam.members, typeChart);
  gaps.forEach((type) => {
    const net = context.wcTeamNetScoreForType(type, weakTeam.members.map((m) => m.types), typeChart);
    assert.ok(net <= -2, `${type} was returned as a gap but its real net score is ${net}`);
  });
});

check("wcOffensiveCoverageGaps only ever returns types with zero real damaging BUILT moves on the team -- verified directly against the fixture's own real builds", () => {
  const gaps = context.wcOffensiveCoverageGaps(weakTeam.members, weakTeam.builds, movesData, typeChart);
  const coveredTypes = new Set();
  weakTeam.members.forEach((m) => {
    (weakTeam.builds[m.name].moves || []).forEach((moveName) => {
      const move = movesData.find((mv) => mv.name === moveName);
      if (move && move.category !== "Status" && move.power > 0) coveredTypes.add(move.type);
    });
  });
  gaps.forEach((type) => assert.equal(coveredTypes.has(type), false, `${type} was returned as an offense gap but a real built move on this team covers it`));
  typeChart.types.forEach((type) => {
    if (!gaps.includes(type)) assert.ok(coveredTypes.has(type), `${type} wasn't flagged as a gap but no real built move covers it either`);
  });
});

check("wcTeamSynergyGrade is a pure function of its five real inputs -- more warnings strictly lowers the score, all else equal", () => {
  const base = context.wcTeamSynergyGrade(0, 0, 0, true, 2);
  const withMoreWarnings = context.wcTeamSynergyGrade(3, 0, 0, true, 2);
  assert.ok(withMoreWarnings.score < base.score);
  // Use a real non-zero warning count as the baseline for this comparison
  // so neither side is sitting at the score cap (100) already -- at 0
  // warnings/gaps, both the archetype and no-archetype scores clamp to
  // the same 100 ceiling and the bonus has nothing left to add, which
  // isn't a real difference in the scoring logic, just the clamp.
  const withArchetype = context.wcTeamSynergyGrade(2, 0, 0, true, 0);
  const withoutArchetype = context.wcTeamSynergyGrade(2, 0, 0, false, 0);
  assert.ok(withArchetype.score > withoutArchetype.score, "a real forming archetype should score strictly higher than none, all else equal");
  const perfect = context.wcTeamSynergyGrade(0, 0, 0, true, 3);
  assert.equal(perfect.letter, "S", `expected a team with zero warnings/gaps, a real archetype, and 3 Assisting Pokemon to grade S, got ${perfect.letter} (${perfect.score})`);
});

console.log(`\nAll ${checks} Team Strategy Report checks passed.`);
