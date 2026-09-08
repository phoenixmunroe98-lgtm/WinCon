// WinCon — tools/test-battle-plan-report.mjs (Milestone 54, Part D;
// reworked for Milestone 56's wcPickBestLineup refactor + win-condition
// bug fix)
//
// Regression test for wcBattlePlanReport (strategy.js) -- WinCon's own,
// no-external-AI answer to a "Battle Coach AI" request (see README's
// Milestone 54 section). Fixture teams use real roster species and real
// wcGenerateBuild output throughout. A few checks below deliberately
// override one real build's own `.moves` array (still real move names
// from data/moves.json, e.g. "Trick Room") so a specific Turn-1
// mechanism is guaranteed to fire -- that's testing THIS function's own
// move-reading rule set, not asserting anything about what Auto-build
// would naturally choose. Nothing here is a placeholder/mocked value.
//
// Milestone 56 refactored the Core Four selection to go through the
// shared wcPickBestLineup helper (moved to strategy.js), and fixed a
// real bug: the closing Win Condition line used to run
// wcAnalyzeTeamStrategy on the full 6-member roster instead of the
// actual Core Four being brought to this matchup, so it could name a
// mechanism the bench was carrying instead of the team on the field.
// This fixture (verified below) demonstrates the bug directly: the full
// roster's real archetype (helpinghand, set by Whimsicott) differs from
// the real Core Four's own archetype (grassyterrain, set by Sceptile) --
// the win-condition line must now say the latter.
//
// Milestone 58 fixed a second real bug Phoenix caught directly from a
// real Battle Plan output she pasted: "Pivoting & Win Condition" told
// her to "bring in" a Pokemon that was one of the 2 real members never
// selected into the Core Four at all (real-game-impossible under actual
// Team Preview rules -- those 2 can't be used this battle under any
// circumstance). The pivot-line generator was reusing benchedNames (the
// excluded-from-Core-Four pool) where it should have used a genuine
// in-battle reserve pool (the OTHER 2 real Core Four members -- picked,
// just not leading Turn 1, and genuinely switch-in-able later). Turn 1
// Execution had the same class of bug in the other direction: its own
// mechanism scan read the full Core Four instead of just the 2 real
// Turn-1 leads, so a reserve member's built move could get a false
// "Turn 1" claim. realTiers() below independently reproduces
// wcBattlePlanReport's own real lead/reserve/bench split so the new
// checks never hardcode a name.
//
// Run: node tools/test-battle-plan-report.mjs

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

function threatsFor(names) {
  return names.map((n) => {
    const p = pokemonList.find((pp) => pp.name === n);
    return { name: n, types: p.types, baseStats: statsFor(n) };
  });
}

// The same real fixture team already smoke-tested during Part D's
// implementation.
const userTeam = buildTeam(["Charizard", "Primarina", "Steelix", "Sceptile", "Farigiraf", "Whimsicott"]);
const opponentThreats = threatsFor(["Kingambit", "Garchomp", "Incineroar", "Sylveon"]);

function runReport(builds) {
  return context.wcBattlePlanReport(userTeam.members, builds || userTeam.builds, opponentThreats, movesData, typeChart, "doubles", abilitiesData, natures);
}

// Milestone 58: independently reproduces wcBattlePlanReport's own real
// lead/reserve/bench split (never hardcoded) -- the 2 real Turn-1 leads,
// the other 2 real Core Four members (picked, not leading, genuinely
// switch-in-able later this battle), and the 2 not selected into the
// Core Four at all (can never be used this battle under any
// circumstance). Used to build fixtures that force a signal onto
// exactly the right real tier, whichever real members the ranking
// heuristic actually puts there for a given build set.
function realTiers(members, builds, threats) {
  const lineup = context.wcPickBestLineup(members, builds, threats, "doubles", natures, movesData, typeChart);
  const specsByName = {};
  members.forEach((m) => {
    const key = m.slotName || m.name;
    specsByName[key] = { name: m.name, types: m.types, baseStats: m.baseStats, build: builds[key] || builds[m.name] };
  });
  const coreFourLineups = context.wcEnumerateLineups(lineup.lineupNames, Math.min(2, lineup.lineupNames.length));
  const leadRanked = context.wcRankLineupsHeuristic(coreFourLineups, specsByName, [threats], { typeChart, natures, movesData, sheetMode: "closed" }, null);
  const leadNames = leadRanked.length ? leadRanked[0].names : lineup.lineupNames.slice(0, 2);
  const reserveNames = lineup.lineupNames.filter((n) => !leadNames.includes(n));
  return { coreFourNames: lineup.lineupNames, benchedNames: lineup.benchedNames, leadNames, reserveNames };
}

check("wcBattlePlanReport's empty-opponent guard returns the honest fallback shape with no crash", () => {
  const report = context.wcBattlePlanReport(userTeam.members, userTeam.builds, [], movesData, typeChart, "doubles", abilitiesData, natures);
  assert.deepEqual(JSON.parse(JSON.stringify(report.coreFourNames)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(report.coreFourLines)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(report.benchLines)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(report.pivotLines)), []);
  assert.equal(report.turn1Lines.length, 1);
  assert.ok(report.turn1Lines[0].includes("No opponent species entered yet"));
});

check("wcBattlePlanReport's Core Four is exactly 4 real members for doubles, matching wcPickBestLineup's own real selection against the revealed threats", () => {
  const report = runReport();
  assert.equal(report.coreFourNames.length, 4);
  assert.equal(report.coreFourLines.length, 4);
  assert.equal(report.benchLines.length, 2);

  // Milestone 56: wcBattlePlanReport now builds its Core Four via the
  // shared wcPickBestLineup helper -- so this test compares directly
  // against that same helper's own real output, rather than re-deriving
  // the ranking by hand.
  const lineup = context.wcPickBestLineup(userTeam.members, userTeam.builds, opponentThreats, "doubles", natures, movesData, typeChart);
  assert.deepEqual(JSON.parse(JSON.stringify(report.coreFourNames.slice().sort())), JSON.parse(JSON.stringify(lineup.lineupNames.slice().sort())), "expected the same real lineup wcPickBestLineup itself would pick");

  const names = userTeam.members.map((m) => m.slotName || m.name);
  const benched = names.filter((n) => !report.coreFourNames.includes(n));
  assert.equal(benched.length, 2);
  assert.deepEqual(benched.slice().sort(), lineup.benchedNames.slice().sort());
  benched.forEach((n) => assert.ok(report.benchLines.some((l) => l.startsWith(n)), `expected a bench line naming ${n}`));
});

check("wcBattlePlanReport's Core Four lines cite each member's own real average matchup score against the revealed 6, matching wcScoreMatchup computed independently", () => {
  const report = runReport();
  report.coreFourNames.forEach((name, i) => {
    const spec = { name, types: userTeam.members.find((m) => m.name === name).types, baseStats: statsFor(name), build: userTeam.builds[name] };
    let total = 0;
    opponentThreats.forEach((threat) => {
      const result = context.wcScoreMatchup(
        { name: spec.name, types: spec.types },
        spec.build,
        spec.baseStats,
        { name: threat.name, types: threat.types },
        threat.baseStats,
        natures,
        typeChart,
        movesData,
        { sheetMode: "closed" }
      );
      total += result.points;
    });
    const expectedAvg = (total / opponentThreats.length).toFixed(1);
    assert.ok(report.coreFourLines[i].includes(`average matchup score ${expectedAvg}`), `expected real avg ${expectedAvg} for ${name} in: ${report.coreFourLines[i]}`);
  });
});

check("wcBattlePlanReport's Turn 1 line honestly falls back when the real Core Four's built kit carries none of the tracked mechanisms", () => {
  const report = runReport();
  // This exact fixture was already independently confirmed (during Part
  // D's implementation) to produce no mechanism signal on Auto-build's
  // own real move choices -- if that ever changes because Auto-build's
  // heuristic changed, this assertion is the honest signal to update the
  // fixture, not to weaken the check.
  const fallbackLine = "The revealed 6 doesn't cleanly point to one extra Turn 1 mechanism beyond the lead matchup itself -- play the real type/Speed read above rather than forcing a setup line that isn't really there.";
  assert.ok(report.turn1Lines.includes(fallbackLine), `expected the honest no-mechanism fallback line, got: ${JSON.stringify(report.turn1Lines)}`);
});

check("wcBattlePlanReport's Turn 1 line correctly detects a real, built Trick Room and names the member that carries it", () => {
  // Force every member's own real build to carry a real move name
  // ("Trick Room") this function checks for directly -- guarantees
  // whichever real member wcPickBestLineup picks for the Core Four will
  // trigger the detection, so this tests the report's own reading of
  // build.moves, not Auto-build's independent move selection.
  const forcedBuilds = {};
  userTeam.members.forEach((m) => {
    forcedBuilds[m.name] = { ...userTeam.builds[m.name], moves: ["Trick Room", ...userTeam.builds[m.name].moves.slice(1)] };
  });
  const report = runReport(forcedBuilds);
  const trickRoomLine = report.turn1Lines.find((l) => l.includes("real built Trick Room"));
  assert.ok(trickRoomLine, `expected a Trick Room detection line, got: ${JSON.stringify(report.turn1Lines)}`);
  assert.ok(report.coreFourNames.some((n) => trickRoomLine.startsWith(n)), `expected the Trick Room line to name one of the real Core Four members, got: ${trickRoomLine}`);
});

check("wcBattlePlanReport's Turn 1 line correctly detects a real, built weather-setting ability (Abomasnow's real Snow Warning)", () => {
  const withWeatherSetter = buildTeam(["Abomasnow", "Primarina", "Steelix", "Sceptile", "Farigiraf", "Whimsicott"]);
  const report = context.wcBattlePlanReport(withWeatherSetter.members, withWeatherSetter.builds, opponentThreats, movesData, typeChart, "doubles", abilitiesData, natures);
  if (report.coreFourNames.includes("Abomasnow")) {
    const weatherLine = report.turn1Lines.find((l) => l.includes("Snow Warning") && l.includes("sets its weather Turn 1"));
    assert.ok(weatherLine, `expected a real Snow Warning detection line, got: ${JSON.stringify(report.turn1Lines)}`);
  } else {
    // The real ranking heuristic didn't put Abomasnow in the Core Four
    // for this matchup -- honestly skip rather than force a false
    // positive, since the mechanism can only fire for an actual Core
    // Four member.
    console.log("    (skipped: the real ranking heuristic benched Abomasnow for this matchup)");
  }
});

check("Milestone 58: wcBattlePlanReport's Pivoting section flags a real IN-BATTLE RESERVE support-signal member (a real Core Four pick who isn't leading Turn 1) for a later pivot", () => {
  const tiers = realTiers(userTeam.members, userTeam.builds, opponentThreats);
  if (tiers.reserveNames.length === 0) {
    console.log("    (skipped: this fixture's real Core Four has no in-battle reserve slot to test)");
    return;
  }
  const reserveCandidate = tiers.reserveNames[0];
  const forcedBuilds = { ...userTeam.builds };
  forcedBuilds[reserveCandidate] = { ...userTeam.builds[reserveCandidate], moves: ["Tailwind", ...userTeam.builds[reserveCandidate].moves.slice(1)] };
  const report = runReport(forcedBuilds);
  const pivotLine = report.pivotLines.find((l) => l.startsWith(reserveCandidate));
  assert.ok(pivotLine, `expected a real pivot line for the real in-battle reserve ${reserveCandidate}, got: ${JSON.stringify(report.pivotLines)}`);
  assert.ok(pivotLine.includes("still carries real support value"));
  assert.ok(pivotLine.includes("in your Core Four but not leading Turn 1"), `expected the pivot line to correctly describe ${reserveCandidate} as a real Core Four member, not a bench member, got: ${pivotLine}`);
});

check("Milestone 58 regression (Phoenix: her real report told her to \"bring in\" a Pokemon that was never selected into the Core Four at all): a real BENCHED (excluded-from-Core-Four) support-signal member never gets a pivot line -- it can't be brought into this battle under any circumstance", () => {
  const tiers = realTiers(userTeam.members, userTeam.builds, opponentThreats);
  assert.equal(tiers.benchedNames.length, 2, "expected exactly 2 real benched members for this fixture");
  const benchCandidate = tiers.benchedNames[0];
  const forcedBuilds = { ...userTeam.builds };
  // Force every real support signal this function tracks onto the real
  // benched member -- if even one of these leaked through as a pivot
  // line, that would be Phoenix's exact real bug again.
  forcedBuilds[benchCandidate] = {
    ...userTeam.builds[benchCandidate],
    moves: ["Tailwind", "Trick Room", "Light Screen", "Follow Me"],
  };
  const report = runReport(forcedBuilds);
  assert.ok(!report.coreFourNames.includes(benchCandidate), `sanity check: ${benchCandidate} must genuinely be excluded from this fixture's real Core Four`);
  const leaked = report.pivotLines.find((l) => l.startsWith(benchCandidate));
  assert.ok(!leaked, `${benchCandidate} was never selected into the Core Four and can't be brought into this battle at all -- it must never appear in a pivot line, got: ${JSON.stringify(report.pivotLines)}`);
});

check("Milestone 58: Turn 1 Execution's mechanism scan only reads the real Turn-1 leads, never a real Core Four member sitting in reserve", () => {
  const tiers = realTiers(userTeam.members, userTeam.builds, opponentThreats);
  if (tiers.reserveNames.length === 0) {
    console.log("    (skipped: this fixture's real Core Four has no in-battle reserve slot to test)");
    return;
  }
  const reserveCandidate = tiers.reserveNames[0];
  const forcedBuilds = { ...userTeam.builds };
  // Light Screen is one of Turn 1 Execution's own tracked mechanisms --
  // forcing it onto a real reserve member (not a real Turn-1 lead) must
  // NOT produce a false "carries a real built Light Screen ... Turn 1"
  // claim about a Pokemon that isn't actually being sent out Turn 1;
  // it should surface in Pivoting instead (checked above's own sibling
  // signal list already covers Light Screen too).
  forcedBuilds[reserveCandidate] = { ...userTeam.builds[reserveCandidate], moves: ["Light Screen", ...userTeam.builds[reserveCandidate].moves.slice(1)] };
  const report = runReport(forcedBuilds);
  const falseTurn1Claim = report.turn1Lines.find((l) => l.startsWith(reserveCandidate));
  assert.ok(!falseTurn1Claim, `${reserveCandidate} isn't one of this matchup's real Turn-1 leads -- Turn 1 Execution must not claim it's setting anything Turn 1, got: ${JSON.stringify(report.turn1Lines)}`);
  const pivotLine = report.pivotLines.find((l) => l.startsWith(reserveCandidate));
  assert.ok(pivotLine, `expected ${reserveCandidate}'s real Light Screen to surface as a Pivoting signal instead, got: ${JSON.stringify(report.pivotLines)}`);
});

check("wcBattlePlanReport's final line states the real Core Four's OWN win condition, matching wcAnalyzeTeamStrategy run independently against just the real lineup members -- not the full 6-member roster", () => {
  const report = runReport();
  const lineup = context.wcPickBestLineup(userTeam.members, userTeam.builds, opponentThreats, "doubles", natures, movesData, typeChart);
  const lineupStrategy = context.wcAnalyzeTeamStrategy(lineup.lineupMembers, userTeam.builds, movesData, opponentThreats, typeChart, "doubles", "", abilitiesData, null);
  const lastLine = report.pivotLines[report.pivotLines.length - 1];
  if (lineupStrategy.archetype === "independent") {
    assert.ok(lastLine.startsWith("No single shared win condition"), `expected the independent-lineup line, got: ${lastLine}`);
  } else {
    assert.ok(lastLine.includes(context.wcArchetypeDisplayName(lineupStrategy.archetype)), `expected the real Core Four's own archetype name in: ${lastLine}`);
  }
});

check("Milestone 56 bug-fix regression: this fixture's real full 6-roster archetype genuinely differs from the real Core Four's own archetype, and the Win Condition line reports the Core Four's, not the roster's", () => {
  const report = runReport();
  const lineup = context.wcPickBestLineup(userTeam.members, userTeam.builds, opponentThreats, "doubles", natures, movesData, typeChart);
  const lineupStrategy = context.wcAnalyzeTeamStrategy(lineup.lineupMembers, userTeam.builds, movesData, opponentThreats, typeChart, "doubles", "", abilitiesData, null);
  const fullRosterStrategy = context.wcAnalyzeTeamStrategy(userTeam.members, userTeam.builds, movesData, opponentThreats, typeChart, "doubles", "", abilitiesData, null);

  // If this ever stops being true because Auto-build's own heuristic or
  // the ranking changed, that's the honest signal to pick a new fixture
  // that still demonstrates the fix -- not to weaken this check. As of
  // this write, the full 6's real archetype is "helpinghand" (set by
  // Whimsicott) while the real Core Four's is "grassyterrain" (set by
  // Sceptile) -- genuinely different mechanisms.
  assert.notEqual(lineupStrategy.archetype, fullRosterStrategy.archetype, "expected this fixture to genuinely exercise the bug: the full roster and the real Core Four disagree on archetype");

  const lastLine = report.pivotLines[report.pivotLines.length - 1];
  assert.ok(lastLine.includes(context.wcArchetypeDisplayName(lineupStrategy.archetype)), `expected the Core Four's own real archetype (${lineupStrategy.archetype}) in the Win Condition line, got: ${lastLine}`);
  assert.ok(!lastLine.includes(context.wcArchetypeDisplayName(fullRosterStrategy.archetype)), `the Win Condition line should NOT report the full roster's real archetype (${fullRosterStrategy.archetype}) -- that was the bug -- got: ${lastLine}`);
});

console.log(`\nAll ${checks} Battle Plan Report checks passed.`);
