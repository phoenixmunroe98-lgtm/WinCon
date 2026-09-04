// WinCon — tools/test-locked-build-generation.mjs
//
// Regression test for "I want to be able to set a pokemons stats and
// moveset permanently as this is what its build is in the app." This
// tests wcGenerateBuild's new opts.lockedBuild short-circuit (strategy.js):
// a locked {nature, sp, moves} triple should be forced onto every build
// this function generates for that species, EXCEPT the Stat Point spread
// when the same call auto-opts into a Mega form -- a spread tuned for the
// base species' stats shouldn't be blindly forced onto a very different
// Mega stat line (see the design note directly above the isBaseForm check
// in wcGenerateBuild). Item/ability are never touched by any of this --
// wcGenerateBuild doesn't even return an ability field, and item
// selection (wcPickItem) never reads the moveset either way.
//
// Run: node tools/test-locked-build-generation.mjs

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

const baseStatsData = loadJSON("data/base-stats.json");
const learnsets = loadJSON("data/learnsets.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");

const slowbroBaseStats = baseStatsData.find((b) => b.name === "Slowbro");
const slowbroLearnset = learnsets["Slowbro"];
const gengarBaseStats = baseStatsData.find((b) => b.name === "Gengar");
const megaGengarBaseStats = baseStatsData.find((b) => b.name === "Mega Gengar");
const gengarLearnset = learnsets["Gengar"];

// A deliberately distinctive Stat Point spread (real Champions builds
// never max EVERY stat at once — 66 is over the 508-ish real total cap
// intentionally, so it can never coincidentally match an algorithmically
// picked spread) used to prove "was this forced verbatim, or freshly
// picked" beyond any doubt.
const LOCKED_SP = { hp: 4, attack: 0, defense: 66, sp_attack: 0, sp_defense: 66, speed: 0 };
const LOCKED_MOVES = ["Trick Room", "Scald", "Slack Off", "Iron Defense"];

function baseGengarCandidate() {
  return { name: "Gengar", types: ["Ghost", "Poison"] };
}

// ---------------------------------------------------------------------------
// Locked nature + moves forced verbatim onto a non-Mega pick.
// ---------------------------------------------------------------------------

check("wcGenerateBuild forces a locked build's nature and moves verbatim onto a non-Mega pick", () => {
  const lockedBuild = { nature: "Bold", sp: LOCKED_SP, moves: LOCKED_MOVES };
  const build = context.wcGenerateBuild(
    { name: "Slowbro", types: ["Water", "Psychic"] },
    slowbroBaseStats,
    slowbroLearnset,
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData, lockedBuild }
  );
  assert.equal(build.nature, "Bold");
  assert.deepEqual(JSON.parse(JSON.stringify(build.moves)), LOCKED_MOVES);
});

check("wcGenerateBuild forces a locked build's Stat Point spread verbatim onto a non-Mega pick", () => {
  const lockedBuild = { nature: "Bold", sp: LOCKED_SP, moves: LOCKED_MOVES };
  const build = context.wcGenerateBuild(
    { name: "Slowbro", types: ["Water", "Psychic"] },
    slowbroBaseStats,
    slowbroLearnset,
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData, lockedBuild }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(build.sp)), LOCKED_SP);
});

// ---------------------------------------------------------------------------
// Mega auto-opt edge case: nature/moves still lock in, but sp is
// freshly picked against the Mega's own (very different) base stats.
// ---------------------------------------------------------------------------

check("wcGenerateBuild still forces locked nature/moves when the same species auto-opts into a Mega form", () => {
  const liveMetaBuilds = { Gengar: [{ item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 25, winRate: 64 }] };
  const lockedBuild = { nature: "Timid", sp: LOCKED_SP, moves: ["Trick Room", "Scald", "Slack Off", "Iron Defense"] };
  // Trick Room/Scald/Slack Off/Iron Defense aren't Gengar's real learnset
  // -- swap in a locked moveset Gengar can actually learn, so this test
  // isolates the sp/nature question rather than getting tangled up in
  // move-learnability filtering (already covered by the tests below).
  const gengarLockedMoves = ["Shadow Ball", "Sludge Bomb", "Substitute", "Focus Blast"];
  const build = context.wcGenerateBuild(
    baseGengarCandidate(),
    gengarBaseStats,
    gengarLearnset,
    movesData,
    [],
    typeChart,
    {
      format: "doubles",
      usedItems: new Set(),
      megaForms: [{ name: "Mega Gengar", types: ["Ghost", "Poison"], baseStats: megaGengarBaseStats }],
      abilitiesData,
      liveMetaBuilds,
      lockedBuild: { ...lockedBuild, moves: gengarLockedMoves },
    }
  );
  assert.equal(build.item, "Gengarite", "expected the auto-mega branch to actually fire for this test to be meaningful");
  assert.equal(build.nature, "Timid", "locked nature should still apply even when the slot Mega-Evolves");
  assert.deepEqual(JSON.parse(JSON.stringify(build.moves)), gengarLockedMoves, "locked moves should still apply even when the slot Mega-Evolves");
});

check("wcGenerateBuild picks a FRESH Stat Point spread (not the locked one) when the same species auto-opts into a Mega form", () => {
  const liveMetaBuilds = { Gengar: [{ item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 25, winRate: 64 }] };
  const lockedBuild = { nature: "Timid", sp: LOCKED_SP, moves: ["Shadow Ball", "Sludge Bomb", "Substitute", "Focus Blast"] };
  const build = context.wcGenerateBuild(
    baseGengarCandidate(),
    gengarBaseStats,
    gengarLearnset,
    movesData,
    [],
    typeChart,
    {
      format: "doubles",
      usedItems: new Set(),
      megaForms: [{ name: "Mega Gengar", types: ["Ghost", "Poison"], baseStats: megaGengarBaseStats }],
      abilitiesData,
      liveMetaBuilds,
      lockedBuild,
    }
  );
  assert.equal(build.item, "Gengarite", "expected the auto-mega branch to actually fire for this test to be meaningful");
  assert.notDeepEqual(
    JSON.parse(JSON.stringify(build.sp)),
    LOCKED_SP,
    "a Stat Point spread tuned for base Gengar's stats should NOT be blindly forced onto Mega Gengar's very different stat line"
  );
});

// ---------------------------------------------------------------------------
// No opts.lockedBuild at all — must behave exactly as before this feature.
// ---------------------------------------------------------------------------

check("wcGenerateBuild behaves identically whether opts.lockedBuild is omitted or explicitly undefined (regression guard)", () => {
  const opts = { format: "doubles", usedItems: new Set(), abilitiesData };
  const buildOmitted = context.wcGenerateBuild({ name: "Slowbro", types: ["Water", "Psychic"] }, slowbroBaseStats, slowbroLearnset, movesData, [], typeChart, opts);
  const buildExplicitUndefined = context.wcGenerateBuild(
    { name: "Slowbro", types: ["Water", "Psychic"] },
    slowbroBaseStats,
    slowbroLearnset,
    movesData,
    [],
    typeChart,
    { ...opts, lockedBuild: undefined }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(buildOmitted)), JSON.parse(JSON.stringify(buildExplicitUndefined)));
});

// ---------------------------------------------------------------------------
// A locked move the species can't actually learn is silently dropped —
// the existing wcPickMoves learnability filter still protects a locked
// build the same way it protects every other forced-move source
// (opts.forcedMoves, a hand-curated/live meta set) from ever handing out
// an illegal move.
// ---------------------------------------------------------------------------

check("wcGenerateBuild drops an unlearnable move from a locked build and backfills the slot algorithmically", () => {
  const lockedBuild = { nature: "Bold", sp: LOCKED_SP, moves: ["Trick Room", "Psychic", "Scald", "Slack Off"] };
  // Psychic (the move) is not in Slowbro's real learnset (confirmed
  // against data/learnsets.json) -- a deliberately illegal entry.
  assert.ok(!slowbroLearnset.includes("Psychic"), "test fixture assumption: Slowbro cannot learn Psychic");
  const build = context.wcGenerateBuild(
    { name: "Slowbro", types: ["Water", "Psychic"] },
    slowbroBaseStats,
    slowbroLearnset,
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData, lockedBuild }
  );
  assert.equal(build.moves.length, 4);
  assert.ok(!build.moves.includes("Psychic"), "an unlearnable locked move must never end up on the built moveset");
  ["Trick Room", "Scald", "Slack Off"].forEach((mv) => {
    assert.ok(build.moves.includes(mv), `expected the valid locked move ${mv} to still be present`);
  });
});

console.log("");
console.log(`All ${checks} locked-build-generation checks passed.`);
