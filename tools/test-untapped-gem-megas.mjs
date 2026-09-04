// WinCon — tools/test-untapped-gem-megas.mjs
//
// Regression test for the "untapped gem" follow-up: Dream Team/Auto-
// build/autofill used to only ever proactively opt a base species into
// one of its own Mega forms when WINCON_META_KNOWN_SETS (strategy.js) —
// a short, hand-curated list — had a real set for it, which meant a
// genuinely strong Mega with no one having hand-researched it yet (an
// "untapped gem" in someone's own box) could never get recommended or
// guaranteed a team slot, no matter how good it actually is. This tests
// the fix: wcLiveMegaSetFor (and everything built on it) lets a Mega
// with real, sample-size-qualified live Regulation M-B tournament
// results (live_meta_builds) qualify too, without touching the
// hand-curated list or anything about a non-Mega pick.
//
// Fixture: Mega Gengar is NOT in WINCON_META_KNOWN_SETS today (only
// Mega Charizard Y / Floette / Staraptor are) — a real "untapped gem"
// stand-in. Real decklists name a Mega-Evolving Pokémon by its BASE
// species (Gengar) holding its Mega Stone (Gengarite) as the item — see
// api/cron-limitless-sync.js's own header comment — so live_meta_builds
// rows here are keyed by "Gengar", not "Mega Gengar".
//
// Run: node tools/test-untapped-gem-megas.mjs

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

const gengarBaseStats = baseStatsData.find((b) => b.name === "Gengar");
const megaGengarBaseStats = baseStatsData.find((b) => b.name === "Mega Gengar");
const gengarLearnset = learnsets["Gengar"];

const GENGAR_CANDIDATE = {
  name: "Gengar",
  types: ["Ghost", "Poison"],
  baseStats: gengarBaseStats,
  learnableNames: gengarLearnset,
  megaForms: [{ name: "Mega Gengar", types: ["Ghost", "Poison"], baseStats: megaGengarBaseStats }],
};

// ---------------------------------------------------------------------------
// wcLiveMegaSetFor — pure function.
// ---------------------------------------------------------------------------

check("wcLiveMegaSetFor is null with no live data at all", () => {
  assert.equal(context.wcLiveMegaSetFor("Mega Gengar", "Gengar", null), null);
  assert.equal(context.wcLiveMegaSetFor("Mega Gengar", "Gengar", {}), null);
});

check("wcLiveMegaSetFor is null when the base species has builds but none hold the Mega Stone", () => {
  const liveMetaBuilds = { Gengar: [{ item: "Choice Specs", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 40, winRate: 60 }] };
  assert.equal(context.wcLiveMegaSetFor("Mega Gengar", "Gengar", liveMetaBuilds), null);
});

check("wcLiveMegaSetFor is null below the minimum sample size even holding the right stone", () => {
  const liveMetaBuilds = { Gengar: [{ item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 2, winRate: 90 }] };
  assert.equal(context.wcLiveMegaSetFor("Mega Gengar", "Gengar", liveMetaBuilds), null);
});

check("wcLiveMegaSetFor returns a metaSet-shaped {moves,item,note} once real sample size confirms the Mega Stone build", () => {
  const liveMetaBuilds = { Gengar: [{ item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 25, winRate: 64 }] };
  const set = context.wcLiveMegaSetFor("Mega Gengar", "Gengar", liveMetaBuilds);
  assert.ok(set, "expected a qualifying live meta set");
  assert.deepEqual(JSON.parse(JSON.stringify(set.moves)), ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"]);
  assert.equal(set.item, "Gengarite");
  assert.match(set.note, /25/);
  assert.match(set.note, /64%/);
});

check("wcLiveMegaSetFor picks the higher-usage qualifying build when a species has more than one real Mega-Stone build on file", () => {
  const liveMetaBuilds = {
    Gengar: [
      { item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Destiny Bond"], timesUsed: 10, winRate: 50 },
      { item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 30, winRate: 58 },
    ],
  };
  const set = context.wcLiveMegaSetFor("Mega Gengar", "Gengar", liveMetaBuilds);
  assert.deepEqual(JSON.parse(JSON.stringify(set.moves)), ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], "expected the 30-sample build, not the 10-sample one");
});

// ---------------------------------------------------------------------------
// wcHasKnownMegaOption — with and without live data.
// ---------------------------------------------------------------------------

check("wcHasKnownMegaOption is false for Mega Gengar with no live data (it's not hand-curated either)", () => {
  assert.equal(context.wcHasKnownMegaOption(GENGAR_CANDIDATE, {}), false);
  assert.equal(context.wcHasKnownMegaOption(GENGAR_CANDIDATE), false);
});

check("wcHasKnownMegaOption is true for Mega Gengar once live data qualifies it", () => {
  const liveMetaBuilds = { Gengar: [{ item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 25, winRate: 64 }] };
  assert.equal(context.wcHasKnownMegaOption(GENGAR_CANDIDATE, liveMetaBuilds), true);
});

check("wcHasKnownMegaOption is unaffected for an already-hand-curated Mega (Mega Charizard Y) regardless of live data", () => {
  const charizardCandidate = {
    name: "Charizard",
    megaForms: [{ name: "Mega Charizard Y", types: ["Fire", "Flying"], baseStats: baseStatsData.find((b) => b.name === "Mega Charizard Y") }],
  };
  assert.equal(context.wcHasKnownMegaOption(charizardCandidate, {}), true);
  assert.equal(context.wcHasKnownMegaOption(charizardCandidate, null), true);
});

// ---------------------------------------------------------------------------
// wcPickAutoMegaForm — with and without live data.
// ---------------------------------------------------------------------------

check("wcPickAutoMegaForm returns null for Gengar's Mega form with no live data", () => {
  const used = new Set();
  assert.equal(context.wcPickAutoMegaForm(GENGAR_CANDIDATE.megaForms, used, "Gengar", {}), null);
});

check("wcPickAutoMegaForm returns Mega Gengar once live data confirms it, and doesn't mark the stone used when it doesn't pick one", () => {
  const liveMetaBuilds = { Gengar: [{ item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 25, winRate: 64 }] };
  const used = new Set();
  const picked = context.wcPickAutoMegaForm(GENGAR_CANDIDATE.megaForms, used, "Gengar", liveMetaBuilds);
  assert.ok(picked, "expected wcPickAutoMegaForm to pick Mega Gengar");
  assert.equal(picked.name, "Mega Gengar");
});

check("wcPickAutoMegaForm respects Item Clause even for a live-confirmed Mega (stone already used)", () => {
  const liveMetaBuilds = { Gengar: [{ item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 25, winRate: 64 }] };
  const used = new Set(["Gengarite"]);
  assert.equal(context.wcPickAutoMegaForm(GENGAR_CANDIDATE.megaForms, used, "Gengar", liveMetaBuilds), null);
});

// ---------------------------------------------------------------------------
// wcGenerateBuild — end-to-end: Gengar actually opts into Mega Gengar and
// gets the live-sourced moves/item, with no hand-curated entry involved.
// ---------------------------------------------------------------------------

check("wcGenerateBuild opts Gengar into Mega Gengar and uses the live-confirmed moves/item when liveMetaBuilds qualifies it", () => {
  const liveMetaBuilds = { Gengar: [{ item: "Gengarite", moves: ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"], timesUsed: 25, winRate: 64 }] };
  const build = context.wcGenerateBuild(
    { name: "Gengar", types: ["Ghost", "Poison"] },
    gengarBaseStats,
    gengarLearnset,
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), megaForms: GENGAR_CANDIDATE.megaForms, abilitiesData, liveMetaBuilds }
  );
  assert.equal(build.item, "Gengarite", "expected Gengar to auto-opt into its Mega form and hold the stone");
  assert.deepEqual(JSON.parse(JSON.stringify(build.moves)), ["Shadow Ball", "Sludge Bomb", "Protect", "Nasty Plot"]);
});

check("wcGenerateBuild does NOT opt Gengar into Mega Gengar with no live data and no curated entry (falls back to base Gengar)", () => {
  const build = context.wcGenerateBuild(
    { name: "Gengar", types: ["Ghost", "Poison"] },
    gengarBaseStats,
    gengarLearnset,
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), megaForms: GENGAR_CANDIDATE.megaForms, abilitiesData }
  );
  assert.notEqual(build.item, "Gengarite", "expected no Mega Stone without a qualifying set from either source");
});

check("wcGenerateBuild's existing curated Megas (e.g. Mega Charizard Y) are completely unaffected by this change", () => {
  const charizardBaseStats = baseStatsData.find((b) => b.name === "Charizard");
  const megaCharizardYBaseStats = baseStatsData.find((b) => b.name === "Mega Charizard Y");
  const charizardLearnset = learnsets["Charizard"];
  const build = context.wcGenerateBuild(
    { name: "Charizard", types: ["Fire", "Flying"] },
    charizardBaseStats,
    charizardLearnset,
    movesData,
    [],
    typeChart,
    {
      format: "doubles",
      usedItems: new Set(),
      megaForms: [{ name: "Mega Charizard Y", types: ["Fire", "Flying"], baseStats: megaCharizardYBaseStats }],
      abilitiesData,
    }
  );
  assert.equal(build.item, "Charizardite Y");
  assert.deepEqual(JSON.parse(JSON.stringify(build.moves)), ["Heat Wave", "Solar Beam", "Protect", "Weather Ball"]);
});

console.log("");
console.log(`All ${checks} untapped-gem Mega checks passed.`);
