// WinCon — tools/test-archetype-synergy-picking.mjs
//
// Regression test for "I would also like the dream team to auto strategise
// when picking the team. Look at synergy between pairs, tripples and
// groups of 4 pokemon and how they can work together to win." Before this,
// Dream Team's picking loop (wcPickDreamTeam/wcDreamTeamCandidateScore)
// scored each candidate purely on matchup/coverage/raw-stats/meta-usage --
// completely blind to how the picks already on the team might work
// TOGETHER (Trick Room + bulky attackers, Tailwind + fast attackers, a
// weather setter + its abusers, redirection + a hard-hitting partner,
// etc). This tests the fix: wcArchetypeSignalsFor/wcDetectInProgressArchetype/
// wcArchetypeBeneficiaryScore/wcArchetypeSynergyBonus, reading only the two
// signals that exist BEFORE a moveset is built (a species' fixed real
// ability, and whether it can LEARN a strategy-defining move) since
// wcGenerateTeamBuilds always runs after wcPickDreamTeam finishes.
//
// Also covers the auto-apply half of the same request (implemented in
// builder.js's generateDreamTeam(), not testable here without a DOM/
// Supabase-backed harness): once Dream Team finishes, its picks are
// scored/reasoned about here exactly the same way generateDreamTeam()
// calls wcAnalyzeTeamStrategy + applyAmendmentsToBuilds immediately
// afterward -- see README.md's Milestone 36 section for that half.
//
// Run: node tools/test-archetype-synergy-picking.mjs

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
const typeChart = loadJSON("data/type-chart.json");
const byName = (name) => baseStatsData.find((b) => b.name === name);

// Real fixtures: Slowbro learns Trick Room and is slow (bulky role);
// Dragonite learns Tailwind and is comparatively fast for this test;
// Torkoal's real ability is Drought (sun setter); Politoed's real
// ability is Drizzle (rain setter) -- all confirmed directly against
// data/abilities.json and data/learnsets.json, not invented.
const SLOWBRO = { name: "Slowbro", types: ["Water", "Psychic"], baseStats: byName("Slowbro"), learnableNames: learnsets["Slowbro"] };
const DRAGONITE = { name: "Dragonite", types: ["Dragon", "Flying"], baseStats: byName("Dragonite"), learnableNames: learnsets["Dragonite"] };
// Aerodactyl: real Tailwind learner, genuinely fast (base Speed 130, so
// wcPickRole calls it "fast") -- unlike Dragonite (base Speed 80, which
// wcPickRole calls "bulky"), Aerodactyl is the clean fixture for "a real
// setter of one archetype that does NOT benefit from a different one
// already forming."
const AERODACTYL = { name: "Aerodactyl", types: ["Rock", "Flying"], baseStats: byName("Aerodactyl"), learnableNames: learnsets["Aerodactyl"] };
const TORKOAL = { name: "Torkoal", types: ["Fire"], baseStats: byName("Torkoal"), learnableNames: learnsets["Torkoal"] || [] };
const POLITOED = { name: "Politoed", types: ["Water"], baseStats: byName("Politoed"), learnableNames: learnsets["Politoed"] || [] };
const NINETALES = { name: "Ninetales", types: ["Fire"], baseStats: byName("Ninetales"), learnableNames: learnsets["Ninetales"] || [] };
const PLAIN = { name: "PlainMon", types: ["Normal"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 }, learnableNames: [] };

// ---------------------------------------------------------------------------
// wcArchetypeSignalsFor
// ---------------------------------------------------------------------------

check("wcArchetypeSignalsFor detects a Trick Room signal from a real learnset (Slowbro)", () => {
  const signals = context.wcArchetypeSignalsFor(SLOWBRO, "doubles", abilitiesData);
  assert.ok(signals.includes("trickroom"), `expected trickroom in ${JSON.stringify(signals)}`);
});

check("wcArchetypeSignalsFor detects a Tailwind signal from a real learnset (Dragonite)", () => {
  const signals = context.wcArchetypeSignalsFor(DRAGONITE, "doubles", abilitiesData);
  assert.ok(signals.includes("tailwind"), `expected tailwind in ${JSON.stringify(signals)}`);
});

check("wcArchetypeSignalsFor detects a sun signal from a real weather-setting ability (Torkoal's Drought)", () => {
  const signals = context.wcArchetypeSignalsFor(TORKOAL, "doubles", abilitiesData);
  assert.deepEqual(JSON.parse(JSON.stringify(signals)), ["sun"]);
});

check("wcArchetypeSignalsFor detects a rain signal from a real weather-setting ability (Politoed's Drizzle)", () => {
  const signals = context.wcArchetypeSignalsFor(POLITOED, "doubles", abilitiesData);
  assert.deepEqual(JSON.parse(JSON.stringify(signals)), ["rain"]);
});

check("wcArchetypeSignalsFor is empty for a Pokémon with no strategy-relevant ability or learnable move", () => {
  const signals = context.wcArchetypeSignalsFor(PLAIN, "doubles", abilitiesData);
  assert.deepEqual(JSON.parse(JSON.stringify(signals)), []);
});

check("wcArchetypeSignalsFor only counts redirection in Doubles, never Singles", () => {
  const redirector = { name: "SyntheticRedirector", types: ["Normal"], baseStats: PLAIN.baseStats, learnableNames: ["Follow Me"] };
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcArchetypeSignalsFor(redirector, "doubles", abilitiesData))), ["redirect"]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcArchetypeSignalsFor(redirector, "singles", abilitiesData))), []);
});

check("wcArchetypeSignalsFor only counts hazards in Singles, never Doubles", () => {
  const hazardSetter = { name: "SyntheticHazardSetter", types: ["Rock"], baseStats: PLAIN.baseStats, learnableNames: ["Stealth Rock"] };
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcArchetypeSignalsFor(hazardSetter, "singles", abilitiesData))), ["hazards"]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcArchetypeSignalsFor(hazardSetter, "doubles", abilitiesData))), []);
});

// ---------------------------------------------------------------------------
// wcDetectInProgressArchetype
// ---------------------------------------------------------------------------

check("wcDetectInProgressArchetype returns null for an empty team", () => {
  assert.equal(context.wcDetectInProgressArchetype([], "doubles", abilitiesData), null);
});

check("wcDetectInProgressArchetype returns null when nobody on the team has a signal", () => {
  assert.equal(context.wcDetectInProgressArchetype([PLAIN], "doubles", abilitiesData), null);
});

check("wcDetectInProgressArchetype picks the archetype with the most independent setters", () => {
  const team = [SLOWBRO, TORKOAL]; // 1 trickroom setter, 1 sun setter -- tie broken by first-detected
  const result = context.wcDetectInProgressArchetype(team, "doubles", abilitiesData);
  assert.ok(result, "expected an archetype to be detected");
  assert.equal(result.type, "trickroom", "Slowbro appears first in `team`, so ties go to whichever was detected first");
  assert.deepEqual(JSON.parse(JSON.stringify(result.setters)), ["Slowbro"]);
});

check("wcDetectInProgressArchetype's winning archetype has strictly more setters than a rival one", () => {
  const secondTrickRoomer = { name: "Mega Alakazam", types: ["Psychic"], baseStats: byName("Mega Alakazam"), learnableNames: learnsets["Mega Alakazam"] };
  const team = [SLOWBRO, secondTrickRoomer, TORKOAL]; // 2 trickroom setters outweigh 1 sun setter
  const result = context.wcDetectInProgressArchetype(team, "doubles", abilitiesData);
  assert.equal(result.type, "trickroom");
  assert.deepEqual(JSON.parse(JSON.stringify(result.setters.sort())), ["Mega Alakazam", "Slowbro"]);
});

// ---------------------------------------------------------------------------
// wcArchetypeBeneficiaryScore
// ---------------------------------------------------------------------------

check("wcArchetypeBeneficiaryScore: null archetype always scores 0", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(PLAIN, null, abilitiesData), 0);
});

check("wcArchetypeBeneficiaryScore: trick room rewards a bulky (slow) candidate, not a fast one", () => {
  const bulky = { name: "Bulky", baseStats: { hp: 100, atk: 80, def: 100, spa: 80, spd: 100, spe: 40 } };
  const fast = { name: "Fast", baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 140 } };
  assert.equal(context.wcArchetypeBeneficiaryScore(bulky, "trickroom", abilitiesData), 1);
  assert.equal(context.wcArchetypeBeneficiaryScore(fast, "trickroom", abilitiesData), 0);
});

check("wcArchetypeBeneficiaryScore: tailwind rewards a fast candidate, not a bulky one", () => {
  const bulky = { name: "Bulky", baseStats: { hp: 100, atk: 80, def: 100, spa: 80, spd: 100, spe: 40 } };
  const fast = { name: "Fast", baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 140 } };
  assert.equal(context.wcArchetypeBeneficiaryScore(fast, "tailwind", abilitiesData), 1);
  assert.equal(context.wcArchetypeBeneficiaryScore(bulky, "tailwind", abilitiesData), 0);
});

check("wcArchetypeBeneficiaryScore: sun rewards a Fire-type or sun-boosted-ability candidate", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(NINETALES, "sun", abilitiesData), 1, "Ninetales is Fire-type");
  assert.equal(context.wcArchetypeBeneficiaryScore(PLAIN, "sun", abilitiesData), 0);
});

check("wcArchetypeBeneficiaryScore: rain rewards a Water-type or rain-boosted-ability candidate", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(POLITOED, "rain", abilitiesData), 1, "Politoed is Water-type");
  assert.equal(context.wcArchetypeBeneficiaryScore(PLAIN, "rain", abilitiesData), 0);
});

check("wcArchetypeBeneficiaryScore: redirection rewards a real hard hitter (100+ Atk or SpA)", () => {
  const hardHitter = { name: "HardHitter", baseStats: { hp: 80, atk: 130, def: 80, spa: 60, spd: 80, spe: 80 } };
  const softHitter = { name: "SoftHitter", baseStats: { hp: 80, atk: 60, def: 80, spa: 70, spd: 80, spe: 80 } };
  assert.equal(context.wcArchetypeBeneficiaryScore(hardHitter, "redirect", abilitiesData), 1);
  assert.equal(context.wcArchetypeBeneficiaryScore(softHitter, "redirect", abilitiesData), 0);
});

check("wcArchetypeBeneficiaryScore: hazards has no per-candidate beneficiary today (whole-team chip damage, not a single abuser)", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(PLAIN, "hazards", abilitiesData), 0);
});

check("wcArchetypeBeneficiaryScore: an unrecognized archetype type is a safe no-op", () => {
  assert.equal(context.wcArchetypeBeneficiaryScore(PLAIN, "not-a-real-archetype", abilitiesData), 0);
});

// ---------------------------------------------------------------------------
// wcArchetypeSynergyBonus
// ---------------------------------------------------------------------------

check("wcArchetypeSynergyBonus: with no archetype forming yet, a candidate who COULD start one gets the setter weight", () => {
  assert.equal(context.wcArchetypeSynergyBonus(SLOWBRO, [], "doubles", abilitiesData), 1, "expected the setter weight (WC_ARCHETYPE_SETTER_WEIGHT in strategy.js)");
});

check("wcArchetypeSynergyBonus: with no archetype forming yet, a candidate with no signal gets 0", () => {
  assert.equal(context.wcArchetypeSynergyBonus(PLAIN, [], "doubles", abilitiesData), 0);
});

check("wcArchetypeSynergyBonus: once an archetype is forming, a real beneficiary outweighs merely starting a new one (beneficiary weight > setter weight)", () => {
  const team = [SLOWBRO]; // trickroom is already forming
  const bulkyBeneficiary = { name: "Bulky", baseStats: { hp: 100, atk: 80, def: 100, spa: 80, spd: 100, spe: 40 } };
  assert.equal(context.wcArchetypeSynergyBonus(bulkyBeneficiary, team, "doubles", abilitiesData), 1.5, "expected the beneficiary weight (WC_ARCHETYPE_BENEFICIARY_WEIGHT in strategy.js)");
});

check("wcArchetypeSynergyBonus: once an archetype is forming, a non-beneficiary candidate gets 0 even if it could set its own", () => {
  const team = [SLOWBRO]; // trickroom is already forming
  // Aerodactyl is a real tailwind setter, but tailwind isn't the team's forming archetype, and being genuinely fast means it doesn't benefit FROM trick room either.
  assert.equal(context.wcArchetypeSynergyBonus(AERODACTYL, team, "doubles", abilitiesData), 0);
});

// ---------------------------------------------------------------------------
// wcArchetypeSynergyReasoningNote
// ---------------------------------------------------------------------------

check("wcArchetypeSynergyReasoningNote is empty when there's nothing to say", () => {
  assert.equal(context.wcArchetypeSynergyReasoningNote(PLAIN, [], "doubles", abilitiesData), "");
});

check("wcArchetypeSynergyReasoningNote names the move when a candidate could start a new shared strategy", () => {
  const note = context.wcArchetypeSynergyReasoningNote(SLOWBRO, [], "doubles", abilitiesData);
  assert.match(note, /Trick Room/);
  assert.match(note, /Slowbro/);
});

check("wcArchetypeSynergyReasoningNote names the forming archetype and its setters when a candidate benefits from one already forming", () => {
  const team = [SLOWBRO];
  const bulkyBeneficiary = { name: "BulkyBeneficiary", baseStats: { hp: 100, atk: 80, def: 100, spa: 80, spd: 100, spe: 40 } };
  const note = context.wcArchetypeSynergyReasoningNote(bulkyBeneficiary, team, "doubles", abilitiesData);
  assert.match(note, /Trick Room/);
  assert.match(note, /Slowbro/);
  assert.match(note, /BulkyBeneficiary/);
});

// ---------------------------------------------------------------------------
// wcDreamTeamCandidateScore wiring -- with every other term forced neutral
// (identical types, identical base stat totals, no threats/natures/
// movesData/metaUsage/metaBaseline/liveMeta), the ONLY thing that can
// separate two otherwise-identical candidates is the new archetypeBonus.
// ---------------------------------------------------------------------------

check("wcDreamTeamCandidateScore: a real beneficiary of a forming archetype scores exactly WC_ARCHETYPE_BENEFICIARY_WEIGHT higher than a non-beneficiary twin", () => {
  const team = [SLOWBRO]; // trickroom forming
  const beneficiary = { name: "TwinA", types: ["Normal"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 30 } }; // bulky, base stat total 430
  const nonBeneficiary = { name: "TwinB", types: ["Normal"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 130 } }; // fast, base stat total 530
  const opts = { abilitiesData, format: "doubles" };
  const scoreA = context.wcDreamTeamCandidateScore(beneficiary, team, [], typeChart, typeChart.types, opts);
  const scoreB = context.wcDreamTeamCandidateScore(nonBeneficiary, team, [], typeChart, typeChart.types, opts);
  // Every other scoring term is identical between the two twins (same
  // type, no threats/natures/movesData/meta data) except the base stat
  // total itself and the archetype bonus -- so the real difference is
  // fully accounted for by those two terms alone.
  const bstTermDiff = ((430 - 530) / 600) * 0.5;
  const expectedDiff = 1.5 + bstTermDiff; // 1.5 = WC_ARCHETYPE_BENEFICIARY_WEIGHT in strategy.js
  assert.ok(Math.abs(scoreA - scoreB - expectedDiff) < 1e-9, `expected scoreA-scoreB (${scoreA - scoreB}) to equal ${expectedDiff}`);
});

// ---------------------------------------------------------------------------
// wcPickDreamTeam end-to-end -- every non-archetype scoring term neutralized
// (identical types, threats=[], natures/movesData=null so the flat-average
// coverage fallback runs, no meta data) so the greedy pick order is driven
// deterministically by archetype synergy plus small, fully-computed base-
// stat-total tiebreaks. See the file header's Build Order comment for how
// each round's winner was hand-derived.
// ---------------------------------------------------------------------------

check("wcPickDreamTeam leans the whole team into an emerging Trick Room strategy once a real setter is in the pool", () => {
  const stats = (spe) => ({ hp: 70, atk: 70, def: 70, spa: 70, spd: 70, spe });
  const pool = [
    { name: "TR-Setter", types: ["Normal"], baseStats: stats(30), learnableNames: ["Trick Room"] },
    { name: "Bulky-A", types: ["Normal"], baseStats: stats(40), learnableNames: [] },
    { name: "Bulky-B", types: ["Normal"], baseStats: stats(50), learnableNames: [] },
    { name: "Fast-A", types: ["Normal"], baseStats: stats(140), learnableNames: [] },
    { name: "Fast-B", types: ["Normal"], baseStats: stats(150), learnableNames: [] },
    { name: "Filler-C", types: ["Normal"], baseStats: stats(160), learnableNames: [] },
    { name: "Filler-D", types: ["Normal"], baseStats: stats(170), learnableNames: [] },
    { name: "Filler-E", types: ["Normal"], baseStats: stats(180), learnableNames: [] },
  ];

  const result = context.wcPickDreamTeam(pool, [], typeChart, 6, "", [], null, null, abilitiesData, null, null, "doubles", null, null);

  // The two genuinely bulky, trick-room-friendly picks (Bulky-A, Bulky-B)
  // must beat every faster filler into the team, precisely because they
  // benefit from the strategy TR-Setter starts -- not because of raw stats
  // (the fillers all have a HIGHER base stat total than either of them).
  assert.ok(result.chosen.includes("TR-Setter"), "expected the real Trick Room setter to be picked");
  assert.ok(result.chosen.includes("Bulky-A"), "expected Bulky-A (a real Trick Room beneficiary) to be picked over faster, higher-BST fillers");
  assert.ok(result.chosen.includes("Bulky-B"), "expected Bulky-B (a real Trick Room beneficiary) to be picked over faster, higher-BST fillers");
  assert.ok(!result.chosen.includes("Fast-A") && !result.chosen.includes("Fast-B"), "the two purely-fast, non-beneficiary picks should lose out to the archetype-synergy picks despite higher raw stats");

  const reasoningText = result.reasoning.join(" ");
  assert.match(reasoningText, /Trick Room/, "expected the archetype synergy reasoning to name Trick Room somewhere in the picks");
});

console.log("");
console.log(`All ${checks} archetype-synergy picking checks passed.`);
