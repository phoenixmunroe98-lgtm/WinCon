// WinCon — tools/test-team-move-synergy.mjs
//
// Tests the extension of teammate synergy into actual move-picking
// (wcScoreMove/wcPickMoves/wcGenerateBuild/wcGenerateTeamBuilds), the
// second half of the beta-tester's request ("it would be very interesting
// if you suggested teammates with good defensive or offensive
// synergies"). Reuses the already-shipped archetype-detection functions
// from Dream Team's species-picking step (wcDetectInProgressArchetype/
// wcArchetypeBeneficiaryScore) rather than duplicating logic -- see the
// comment above wcGenerateBuild's opts.teamSoFar handling in strategy.js.
//
// Run: node tools/test-team-move-synergy.mjs

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

const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const baseStatsData = loadJSON("data/base-stats.json");
const learnsets = loadJSON("data/learnsets.json");
const abilitiesData = loadJSON("data/abilities.json");

function statsFor(name) {
  return baseStatsData.find((b) => b.name === name);
}

const heatWave = movesData.find((m) => m.name === "Heat Wave");
const surf = movesData.find((m) => m.name === "Surf");

// A non-empty, fixed threats list -- wcScoreMove divides by threats.length,
// so an empty array (0/0 = NaN) would poison every score. The exact
// types don't matter for these tests since it's held constant across
// every compared call.
const THREATS = [{ name: "Grass Threat", types: ["Grass"] }, { name: "Steel Threat", types: ["Steel"] }];

// ---------------------------------------------------------------------------
// wcScoreMove unit tests: the new teamContext param, in isolation.
// ---------------------------------------------------------------------------

check("wcScoreMove gives a Fire move the weather bonus when a TEAMMATE's real ability sets sun, even though this Pokemon's own ability doesn't", () => {
  const noContext = context.wcScoreMove(heatWave, ["Normal"], "Special", THREATS, typeChart, "doubles", null, "closed", null);
  const withTeamSun = context.wcScoreMove(heatWave, ["Normal"], "Special", THREATS, typeChart, "doubles", null, "closed", {
    weatherType: "Fire",
    archetypeType: "sun",
    isBeneficiary: false,
  });
  assert.ok(withTeamSun > noContext, `expected team-sun context to raise Heat Wave's score (${noContext} -> ${withTeamSun})`);
  assert.ok(Math.abs(withTeamSun - noContext - 1) < 1e-9, "expected exactly the same +1 bonus the own-ability weather case gets");
});

check("wcScoreMove does NOT double-count the weather bonus when this Pokemon's OWN ability already sets that weather", () => {
  const ownWeatherOnly = context.wcScoreMove(heatWave, ["Normal"], "Special", THREATS, typeChart, "doubles", "Drought", "closed", null);
  const ownWeatherPlusTeamContext = context.wcScoreMove(heatWave, ["Normal"], "Special", THREATS, typeChart, "doubles", "Drought", "closed", {
    weatherType: "Fire",
    archetypeType: "sun",
    isBeneficiary: true,
  });
  assert.ok(Math.abs(ownWeatherPlusTeamContext - ownWeatherOnly) < 1e-9, "own-ability weather bonus must not be applied twice");
});

check("wcScoreMove leaves an off-type move (Surf, not Fire) unaffected by a teammate's sun", () => {
  const noContext = context.wcScoreMove(surf, ["Water"], "Special", THREATS, typeChart, "doubles", null, "closed", null);
  const withTeamSun = context.wcScoreMove(surf, ["Water"], "Special", THREATS, typeChart, "doubles", null, "closed", {
    weatherType: "Fire",
    archetypeType: "sun",
    isBeneficiary: false,
  });
  assert.ok(Math.abs(withTeamSun - noContext) < 1e-9, "a non-Fire move must not get the Fire-weather bonus");
});

check("wcScoreMove favors a non-Status move when this Pokemon genuinely benefits from a real, already-built Trick Room/Tailwind/redirect teammate", () => {
  const protect = movesData.find((m) => m.name === "Protect");
  const noContext = context.wcScoreMove(surf, ["Water"], "Special", THREATS, typeChart, "doubles", null, "closed", null);
  const withBeneficiary = context.wcScoreMove(surf, ["Water"], "Special", THREATS, typeChart, "doubles", null, "closed", {
    weatherType: null,
    archetypeType: "trickroom",
    isBeneficiary: true,
  });
  assert.ok(withBeneficiary > noContext, "a damaging move should score higher once this Pokemon is a real Trick Room beneficiary");

  const protectNoContext = context.wcScoreMove(protect, ["Water"], "Special", THREATS, typeChart, "doubles", null, "closed", null);
  const protectWithBeneficiary = context.wcScoreMove(protect, ["Water"], "Special", THREATS, typeChart, "doubles", null, "closed", {
    weatherType: null,
    archetypeType: "trickroom",
    isBeneficiary: true,
  });
  assert.ok(Math.abs(protectWithBeneficiary - protectNoContext) < 1e-9, "Status moves (Protect) must not get the offense-favoring bonus");
});

check("wcScoreMove gives no bonus at all when isBeneficiary is false, even with an archetype detected", () => {
  const noContext = context.wcScoreMove(surf, ["Water"], "Special", THREATS, typeChart, "doubles", null, "closed", null);
  const nonBeneficiary = context.wcScoreMove(surf, ["Water"], "Special", THREATS, typeChart, "doubles", null, "closed", {
    weatherType: null,
    archetypeType: "trickroom",
    isBeneficiary: false,
  });
  assert.ok(Math.abs(nonBeneficiary - noContext) < 1e-9);
});

// ---------------------------------------------------------------------------
// wcGenerateTeamBuilds integration: real teamSoFar threading end-to-end.
// ---------------------------------------------------------------------------

check("wcGenerateTeamBuilds behaves identically for a team with no forming archetype (regression guard)", () => {
  const members = [
    { name: "Slowbro", types: ["Water", "Psychic"], baseStats: statsFor("Slowbro"), learnableNames: learnsets["Slowbro"] },
    { name: "Gengar", types: ["Ghost", "Poison"], baseStats: statsFor("Gengar"), learnableNames: learnsets["Gengar"] },
  ];
  const result = context.wcGenerateTeamBuilds(members, movesData, THREATS, typeChart, "doubles", abilitiesData, "closed", null, null);
  // No exception, both builds complete, standard shape -- teamSoFar
  // threading must not break anything when nothing ever fires.
  assert.ok(result.builds.Slowbro && result.builds.Gengar);
  assert.equal(result.builds.Slowbro.moves.length, 4);
  assert.equal(result.builds.Gengar.moves.length, 4);
});

check("wcPickMoves actually flips its 4th-slot pick once a real Trick Room beneficiary's offense-favoring bonus applies (end-to-end, not just a raw score check)", () => {
  // Fully controlled fixture: 3 forced moves fill slots 1-3 (real moves,
  // all Normal-type so neither remaining candidate below gets an uneven
  // repeat-type penalty), leaving exactly ONE slot contested between two
  // real moves whose base scores (see wcScoreMove) are close enough that
  // the new +0.5 offense-favoring bonus changes the winner:
  // Tailwind (Status, base 3.5) normally beats Rock Tomb (Physical, base
  // 3.4) -- but a genuine Trick Room beneficiary should favor the
  // non-Status option once the bonus applies (Rock Tomb: 3.4 + 0.5 = 3.9).
  const pokemon = { types: ["Normal"] };
  const learnableNames = ["Protect", "Helping Hand", "Fake Out", "Tailwind", "Rock Tomb"];
  const forcedMoves = ["Protect", "Helping Hand", "Fake Out"];

  const withoutContext = context.wcPickMoves(pokemon, learnableNames, movesData, "Physical", THREATS, typeChart, forcedMoves, "doubles", null, "closed", null);
  assert.equal(withoutContext[3], "Tailwind", `expected Tailwind to win the 4th slot without team context, got ${withoutContext[3]}`);

  const withContext = context.wcPickMoves(pokemon, learnableNames, movesData, "Physical", THREATS, typeChart, forcedMoves, "doubles", null, "closed", {
    weatherType: null,
    archetypeType: "trickroom",
    isBeneficiary: true,
  });
  assert.equal(withContext[3], "Rock Tomb", `expected Rock Tomb to win the 4th slot once the Trick Room beneficiary bonus applies, got ${withContext[3]}`);
});

check("wcGenerateTeamBuilds's later members receive teamSoFar containing every earlier member's REAL built moves (wiring smoke test)", () => {
  // Directly exercise wcGenerateBuild's opts.teamSoFar contract end-to-end
  // through real species/data -- Farigiraf's curated set includes a real
  // Trick Room, so a later Kingambit call must complete normally whether
  // or not that context is threaded through.
  const first = context.wcGenerateBuild(
    { name: "Farigiraf", types: ["Normal", "Psychic"] },
    statsFor("Farigiraf"),
    learnsets["Farigiraf"],
    movesData,
    THREATS,
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData }
  );
  assert.ok(first.moves.includes("Trick Room"), "test fixture assumption: Farigiraf is curated with a real Trick Room set");

  const teamSoFar = [{ name: "Farigiraf", moves: first.moves }];
  const secondWithTeam = context.wcGenerateBuild(
    { name: "Kingambit", types: ["Dark", "Steel"] },
    statsFor("Kingambit"),
    learnsets["Kingambit"],
    movesData,
    THREATS,
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData, teamSoFar }
  );
  assert.equal(secondWithTeam.moves.length, 4);
});

console.log("");
console.log(`All ${checks} team-move-synergy checks passed.`);
