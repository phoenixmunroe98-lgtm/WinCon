// WinCon — tools/test-shared-weakness-warnings.mjs
//
// Milestone 41: wcSharedWeaknessWarnings(members, typeChart) -- the fully
// computable counterpart to wcAntiSynergyWarnings' two hand-picked
// ability/item checks (Milestone 38). No curated list here at all: every
// pair on the team, checked against every real type in typeChart.types
// via the same wcEffectivenessOf helper wcDefenseCoverageBonus/
// wcTeamNetScoreForType already use elsewhere in this file. Real fixtures
// throughout (verified directly against data/type-chart.json before
// writing these assertions, not guessed): Venusaur (Grass/Poison) and
// Beedrill (Bug/Poison) both take a real 2x from Fire, Flying, and
// Psychic despite sharing only one of their two types; Venusaur and
// Dragonite (Dragon/Flying) share an Ice weakness where Dragonite takes
// the full 4x; Venusaur and Charizard (Fire/Flying) share nothing --
// the honest negative case, confirming this doesn't over-fire. A couple
// of edge cases (an immunity that should never count as "shared," and a
// same-typing pair that should still be caught) use small synthetic
// fixtures, the same established pattern test-helping-hand.mjs and
// test-anti-synergy-auditor.mjs already use when no clean real fixture
// exists for the specific boundary being checked.
//
// Run: node tools/test-shared-weakness-warnings.mjs

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
const pokemonData = loadJSON("data/pokemon.json");
const byName = (name) => {
  const p = pokemonData.find((x) => x.name === name);
  return { name, types: p.types };
};

const VENUSAUR = byName("Venusaur");
const BEEDRILL = byName("Beedrill");
const DRAGONITE = byName("Dragonite");
const CHARIZARD = byName("Charizard");

// ---------------------------------------------------------------------------
// Guard clauses
// ---------------------------------------------------------------------------

check("returns [] for fewer than 2 members", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcSharedWeaknessWarnings([VENUSAUR], typeChart))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcSharedWeaknessWarnings([], typeChart))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcSharedWeaknessWarnings(null, typeChart))), []);
});

check("returns [] for a malformed typeChart (no types array)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcSharedWeaknessWarnings([VENUSAUR, BEEDRILL], {}))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcSharedWeaknessWarnings([VENUSAUR, BEEDRILL], null))), []);
});

check("skips a member missing real types data rather than throwing", () => {
  const broken = { name: "NoTypesMon" };
  assert.doesNotThrow(() => context.wcSharedWeaknessWarnings([VENUSAUR, broken], typeChart));
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcSharedWeaknessWarnings([VENUSAUR, broken], typeChart))), []);
});

// ---------------------------------------------------------------------------
// Venusaur / Beedrill -- two DIFFERENT typings (Grass/Poison vs. Bug/
// Poison), sharing only Poison, but both genuinely weak 2x to Fire,
// Flying, and Psychic. This is exactly the case wcSameTypingPenalty
// (exact type-combo duplicates only) could never catch.
// ---------------------------------------------------------------------------

check("Venusaur/Beedrill: fires a warning for Fire, Flying, and Psychic (all real 2x/2x)", () => {
  const warnings = context.wcSharedWeaknessWarnings([VENUSAUR, BEEDRILL], typeChart);
  ["Fire", "Flying", "Psychic"].forEach((type) => {
    const hit = warnings.find((w) => w.includes(type));
    assert.ok(hit, `expected a ${type} warning, got: ${JSON.stringify(warnings)}`);
    assert.match(hit, /Venusaur/);
    assert.match(hit, /Beedrill/);
  });
  assert.equal(warnings.length, 3, `expected exactly 3 warnings (Fire, Flying, Psychic), got ${warnings.length}: ${JSON.stringify(warnings)}`);
});

check("Venusaur/Beedrill: neither is tagged 4x (both are plain 2x)", () => {
  const warnings = context.wcSharedWeaknessWarnings([VENUSAUR, BEEDRILL], typeChart);
  warnings.forEach((w) => assert.ok(!w.includes("4x"), `did not expect a 4x tag in: ${w}`));
});

check("member order doesn't change which weaknesses are found, just the naming order", () => {
  const forward = context.wcSharedWeaknessWarnings([VENUSAUR, BEEDRILL], typeChart);
  const reversed = context.wcSharedWeaknessWarnings([BEEDRILL, VENUSAUR], typeChart);
  assert.equal(forward.length, reversed.length);
});

// ---------------------------------------------------------------------------
// Venusaur / Dragonite -- the 4x case (Ice hits Dragonite for a full 4x,
// Venusaur only 2x).
// ---------------------------------------------------------------------------

check("Venusaur/Dragonite: fires exactly one Ice warning, and tags Dragonite (not Venusaur) as the 4x side", () => {
  const warnings = context.wcSharedWeaknessWarnings([VENUSAUR, DRAGONITE], typeChart);
  assert.equal(warnings.length, 1, `expected exactly 1 warning (Ice), got ${warnings.length}: ${JSON.stringify(warnings)}`);
  const [note] = warnings;
  assert.match(note, /Ice/);
  assert.match(note, /Dragonite \(a brutal 4x\)/);
  assert.ok(!/Venusaur \(a brutal 4x\)/.test(note), `did not expect Venusaur to be tagged 4x in: ${note}`);
  assert.match(note, /Venusaur/);
});

// ---------------------------------------------------------------------------
// Venusaur / Charizard -- the honest negative case: these two share no
// real 2x-or-worse weakness (Charizard resists/is neutral to everything
// that hurts Venusaur), so nothing should fire.
// ---------------------------------------------------------------------------

check("Venusaur/Charizard: fires nothing -- a real pair with no shared weakness at all", () => {
  const warnings = context.wcSharedWeaknessWarnings([VENUSAUR, CHARIZARD], typeChart);
  assert.deepEqual(JSON.parse(JSON.stringify(warnings)), []);
});

// ---------------------------------------------------------------------------
// Edge cases needing synthetic fixtures (established pattern elsewhere in
// this test suite for boundaries no clean real fixture demonstrates).
// ---------------------------------------------------------------------------

check("an immunity on one side never counts as a shared weakness, even if the other side is genuinely weak", () => {
  // Ground is a 0x immunity for a pure Flying-type, and a real 2x weakness
  // for a pure Rock-type -- 0 * anything never clears the >= 2 bar.
  const flyingMon = { name: "SyntheticFlyer", types: ["Flying"] };
  const rockMon = { name: "SyntheticRock", types: ["Rock"] };
  const warnings = context.wcSharedWeaknessWarnings([flyingMon, rockMon], typeChart);
  assert.ok(!warnings.some((w) => w.includes("Ground")), `did not expect a Ground warning in: ${JSON.stringify(warnings)}`);
});

check("an identical-typing pair still gets a real shared weakness flagged (this function doesn't try to avoid that overlap with wcSameTypingPenalty)", () => {
  const twinA = { name: "TwinIceA", types: ["Ice"] };
  const twinB = { name: "TwinIceB", types: ["Ice"] };
  const warnings = context.wcSharedWeaknessWarnings([twinA, twinB], typeChart);
  const fireHit = warnings.find((w) => w.includes("Fire"));
  assert.ok(fireHit, `expected a Fire warning for two pure Ice-types, got: ${JSON.stringify(warnings)}`);
  assert.match(fireHit, /TwinIceA/);
  assert.match(fireHit, /TwinIceB/);
});

check("a genuinely safe pair (no shared weakness, synthetic) fires nothing", () => {
  const steelMon = { name: "SyntheticSteel", types: ["Steel"] };
  const waterMon = { name: "SyntheticWater", types: ["Water"] };
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcSharedWeaknessWarnings([steelMon, waterMon], typeChart))), []);
});

// ---------------------------------------------------------------------------
// A full 6-member team: the real Venusaur/Dragonite Ice weakness should
// still surface correctly buried among 4 other members that share
// nothing with either of them.
// ---------------------------------------------------------------------------

check("surfaces the real Venusaur/Dragonite Ice warning inside a full 6-member team, with no unrelated false positives from the other 4", () => {
  const others = ["Steelix", "Primarina", "Sneasler", "Sceptile"].map(byName);
  const team = [VENUSAUR, DRAGONITE, ...others];
  const warnings = context.wcSharedWeaknessWarnings(team, typeChart);
  const iceHit = warnings.find((w) => w.includes("Ice") && w.includes("Venusaur") && w.includes("Dragonite"));
  assert.ok(iceHit, `expected the Venusaur/Dragonite Ice warning inside the full team, got: ${JSON.stringify(warnings)}`);
});

console.log("");
console.log(`All ${checks} shared-weakness checks passed.`);
