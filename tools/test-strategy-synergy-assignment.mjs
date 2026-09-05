// WinCon — tools/test-strategy-synergy-assignment.mjs
//
// Milestone 43: tests for Auto-build strategy baking MULTIPLE compatible
// archetypes into a team's FIRST generated build automatically, instead
// of only ever proposing one single manual "Make changes" amendment --
// wcBuildStrategyCandidates (the extracted, untruncated candidate list),
// wcAssignTeamSynergy (conflict-group resolution), wcStrongestPick (the
// upgraded "genuinely strong attacker/wall" setter tie-break),
// wcApplyAmendmentToBuild (the real, non-preview mutation), and the
// auto-Mega-skip wired into wcGenerateTeamBuilds via wcGenerateBuild's
// new opts.skipAutoMega/build.autoMegaApplied.
//
// Run: node tools/test-strategy-synergy-assignment.mjs

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

const THREATS = [{ name: "Grass Threat", types: ["Grass"] }, { name: "Steel Threat", types: ["Steel"] }];

// ---------------------------------------------------------------------------
// wcStrongestPick / wcAttackerOrWallScore: the "genuinely strong attacker
// or wall" tie-break requirement (3), in isolation.
// ---------------------------------------------------------------------------

check("wcStrongestPick prefers the real, much higher-BST/offense/bulk Pokemon regardless of pool order", () => {
  const kingambit = { name: "Kingambit", baseStats: statsFor("Kingambit") };
  const weakling = { name: "Weakling", baseStats: { hp: 10, atk: 10, def: 10, spa: 10, spd: 10, spe: 10 } };
  assert.equal(context.wcStrongestPick([weakling, kingambit]).name, "Kingambit");
  assert.equal(context.wcStrongestPick([kingambit, weakling]).name, "Kingambit", "order must not matter");
});

check("wcAttackerOrWallScore rewards a real wall's bulk, not just raw BST -- a bulkier mon with the same BST as a frailer one scores higher", () => {
  const wall = { hp: 150, atk: 50, def: 150, spa: 50, spd: 150, spe: 10 }; // BST 560, huge bulk
  const glass = { hp: 50, atk: 150, def: 50, spa: 150, spd: 50, spe: 150 }; // BST 560, all offense/speed
  const wallScore = context.wcAttackerOrWallScore({ baseStats: wall });
  const glassScore = context.wcAttackerOrWallScore({ baseStats: glass });
  // Same BST, but wall's bulk term (hp+def+spd) dwarfs glass's, and glass's
  // best-offense term only counts its higher stat once -- wall should win.
  assert.ok(wallScore > glassScore, `expected the bulky wall to score higher (${wallScore} vs ${glassScore})`);
});

// ---------------------------------------------------------------------------
// wcAssignTeamSynergy: conflict-group resolution (requirement 2), tested
// directly against hand-built candidate objects so the conflict-resolution
// logic itself is isolated from archetype-detection specifics.
// ---------------------------------------------------------------------------

check("wcAssignTeamSynergy resolves Trick Room XOR Tailwind by fitScore -- only the higher one survives", () => {
  const candidates = [
    { archetype: "trickroom", setterName: "Alpha", fitScore: 3 },
    { archetype: "tailwind", setterName: "Beta", fitScore: 5 },
  ];
  const assignments = context.wcAssignTeamSynergy(candidates);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].archetype, "tailwind");
});

check("wcAssignTeamSynergy resolves the four terrains as one conflict group -- at most one survives", () => {
  const candidates = [
    { archetype: "electricterrain", setterName: "Gamma", fitScore: 2 },
    { archetype: "grassyterrain", setterName: "Delta", fitScore: 4 },
    { archetype: "mistyterrain", setterName: "Epsilon", fitScore: 1 },
  ];
  const assignments = context.wcAssignTeamSynergy(candidates);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].archetype, "grassyterrain");
});

check("wcAssignTeamSynergy stacks independent archetypes (screens/Wide Guard/Safeguard/etc.) with different setters -- all survive", () => {
  const candidates = [
    { archetype: "wideguard", setterName: "Zeta", fitScore: 1 },
    { archetype: "screens", setterName: "Eta", fitScore: 1 },
    { archetype: "safeguard", setterName: "Theta", fitScore: 1 },
  ];
  const assignments = context.wcAssignTeamSynergy(candidates);
  assert.equal(assignments.length, 3);
  assert.deepEqual(
    new Set(assignments.map((a) => a.archetype)),
    new Set(["wideguard", "screens", "safeguard"])
  );
});

check("wcAssignTeamSynergy caps a single setter at one forced role, even across two otherwise-independent archetype groups", () => {
  const candidates = [
    { archetype: "wideguard", setterName: "Iota", fitScore: 5 },
    { archetype: "screens", setterName: "Iota", fitScore: 3 },
  ];
  const assignments = context.wcAssignTeamSynergy(candidates);
  assert.equal(assignments.length, 1, "Iota can only run one of the two, even though screens' own group is unclaimed");
  assert.equal(assignments[0].archetype, "wideguard");
});

check("wcAssignTeamSynergy: a realistic mixed pass (conflicts + stacking + setter cap all at once)", () => {
  const candidates = [
    { archetype: "tailwind", setterName: "Kappa", fitScore: 5 },
    { archetype: "trickroom", setterName: "Lambda", fitScore: 3 },
    { archetype: "wideguard", setterName: "Mu", fitScore: 2 },
    { archetype: "screens", setterName: "Mu", fitScore: 1 }, // same setter as wideguard, lower score
    { archetype: "electricterrain", setterName: "Nu", fitScore: 4 },
    { archetype: "mistyterrain", setterName: "Xi", fitScore: 1 },
  ];
  const assignments = context.wcAssignTeamSynergy(candidates);
  assert.deepEqual(JSON.parse(JSON.stringify(assignments.map((a) => a.archetype))), ["tailwind", "electricterrain", "wideguard"]);
});

check("wcAssignTeamSynergy never mutates its input array", () => {
  const candidates = [
    { archetype: "tailwind", setterName: "A", fitScore: 1 },
    { archetype: "trickroom", setterName: "B", fitScore: 2 },
  ];
  const copy = JSON.parse(JSON.stringify(candidates));
  context.wcAssignTeamSynergy(candidates);
  assert.deepEqual(JSON.parse(JSON.stringify(candidates)), copy);
});

// ---------------------------------------------------------------------------
// wcApplyAmendmentToBuild: the real (non-preview) mutation helper.
// ---------------------------------------------------------------------------

check("wcApplyAmendmentToBuild mutates a real build in place -- moves/nature/sp overlaid, item swapped and usedItems kept in sync", () => {
  const build = { nature: "Modest", sp: { hp: 4, attack: 0, defense: 0, sp_attack: 28, sp_defense: 0, speed: 0 }, moves: ["Surf", "Ice Beam", "Protect", "Toxic"], item: "Leftovers" };
  const usedItems = new Set(["Leftovers", "Choice Scarf"]);
  const amendment = {
    pokemon: "Slowbro",
    moves: { slotIndex: 3, from: "Toxic", to: "Trick Room" },
    role: { from: "fast", to: "bulky", natureFrom: "Modest", natureTo: "Quiet", spFrom: build.sp, spTo: { hp: 4, attack: 0, defense: 28, sp_attack: 0, sp_defense: 0, speed: 0 } },
    item: { from: "Leftovers", to: "Mental Herb" },
  };
  context.wcApplyAmendmentToBuild(build, amendment, usedItems);
  assert.deepEqual(JSON.parse(JSON.stringify(build.moves)), ["Surf", "Ice Beam", "Protect", "Trick Room"]);
  assert.equal(build.nature, "Quiet");
  assert.deepEqual(JSON.parse(JSON.stringify(build.sp)), { hp: 4, attack: 0, defense: 28, sp_attack: 0, sp_defense: 0, speed: 0 });
  assert.equal(build.item, "Mental Herb");
  assert.ok(!usedItems.has("Leftovers"), "old item should be freed");
  assert.ok(usedItems.has("Mental Herb"), "new item should be marked used");
});

check("wcApplyAmendmentToBuild leaves the item alone when the amendment has no item field", () => {
  const build = { nature: "Jolly", sp: { hp: 0, attack: 32, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 }, moves: ["Tackle", "Growl", "", ""], item: "Choice Band" };
  const usedItems = new Set(["Choice Band"]);
  context.wcApplyAmendmentToBuild(build, { moves: { slotIndex: 2, from: "", to: "Tailwind" }, role: null, item: null }, usedItems);
  assert.equal(build.item, "Choice Band");
  assert.ok(usedItems.has("Choice Band"));
  assert.deepEqual(JSON.parse(JSON.stringify(build.moves)), ["Tackle", "Growl", "Tailwind", ""]);
});

// ---------------------------------------------------------------------------
// wcBuildStrategyCandidates: requirement (1) -- the FULL candidate list,
// not just wcAnalyzeTeamStrategy's own top-2. Real species/data fixture:
// Farigiraf (Trick Room + screens learner), Steelix (Wide Guard learner,
// Milestone 38's own real example), Slowbro (Trick Room + screens
// learner) -- three real, distinct archetypes should all appear.
// ---------------------------------------------------------------------------

const farigiraf = { name: "Farigiraf", types: ["Normal", "Psychic"], baseStats: statsFor("Farigiraf"), learnableNames: learnsets["Farigiraf"] };
const steelix = { name: "Steelix", types: ["Steel", "Ground"], baseStats: statsFor("Steelix"), learnableNames: learnsets["Steelix"] };
const slowbroMember = { name: "Slowbro", types: ["Water", "Psychic"], baseStats: statsFor("Slowbro"), learnableNames: learnsets["Slowbro"] };
const MIXED_MEMBERS = [farigiraf, steelix, slowbroMember];
// All three built bulky/slow (sp.speed < 16) so Trick Room's netBenefit
// (bulkyMembers - fastMembers) is a real 3 - 0 = 3, and every member is a
// real slot for wcActualRole/roleOf to read.
const MIXED_BUILDS = {
  Farigiraf: { sp: { speed: 2 }, moves: [] },
  Steelix: { sp: { speed: 0 }, moves: [] },
  Slowbro: { sp: { speed: 2 }, moves: [] },
};

check("wcBuildStrategyCandidates returns every qualifying archetype, not truncated to 2, for a real multi-archetype team", () => {
  const candidates = context.wcBuildStrategyCandidates(MIXED_MEMBERS, MIXED_BUILDS, movesData, THREATS, typeChart, "doubles", "", abilitiesData);
  assert.ok(candidates.length >= 3, `expected at least 3 real candidates, got ${candidates.length}`);
  const archetypes = new Set(candidates.map((c) => c.archetype));
  assert.ok(archetypes.has("trickroom"), "Farigiraf/Slowbro's Trick Room should be detected");
  assert.ok(archetypes.has("wideguard"), "Steelix's Wide Guard should be detected");
  assert.ok(archetypes.has("screens"), "Farigiraf/Slowbro's screens should be detected");
});

check("wcAnalyzeTeamStrategy itself is behaviorally unchanged by the extraction -- still only ever a single winner + one alternative", () => {
  const result = context.wcAnalyzeTeamStrategy(MIXED_MEMBERS, MIXED_BUILDS, movesData, THREATS, typeChart, "doubles", "", abilitiesData, null);
  assert.ok(result.archetype, "should surface exactly one winning archetype");
  assert.ok("alternative" in result, "should still surface (at most) one alternative");
  assert.ok(!("candidates" in result), "should never leak the full candidate list through its own return shape");
});

// ---------------------------------------------------------------------------
// wcGenerateBuild: the new opts.skipAutoMega / build.autoMegaApplied hook,
// in isolation, using Staraptor -- a real curated Mega (Mega Staraptor,
// Contrary) whose BASE form (Reckless) learns Tailwind, matching Phoenix's
// own real bug report (a Tailwind lead auto-evolving and losing the
// ability that made it the right pick).
// ---------------------------------------------------------------------------

const staraptorMegaForms = [{ name: "Mega Staraptor", types: ["Normal", "Flying"], baseStats: statsFor("Mega Staraptor") }];
const staraptor = {
  name: "Staraptor",
  types: ["Normal", "Flying"],
  baseStats: statsFor("Staraptor"),
  learnableNames: learnsets["Staraptor"],
  megaForms: staraptorMegaForms,
};

check("wcGenerateBuild auto-Mega's Staraptor by default (regression guard: the pre-existing behavior this whole feature must not disturb)", () => {
  const build = context.wcGenerateBuild(staraptor, staraptor.baseStats, staraptor.learnableNames, movesData, THREATS, typeChart, {
    format: "doubles",
    usedItems: new Set(),
    megaForms: staraptorMegaForms,
    abilitiesData,
  });
  assert.equal(build.autoMegaApplied, true);
  assert.equal(build.item, "Staraptite");
});

check("wcGenerateBuild's opts.skipAutoMega suppresses the auto-Mega entirely", () => {
  const build = context.wcGenerateBuild(staraptor, staraptor.baseStats, staraptor.learnableNames, movesData, THREATS, typeChart, {
    format: "doubles",
    usedItems: new Set(),
    megaForms: staraptorMegaForms,
    abilitiesData,
    skipAutoMega: true,
  });
  assert.equal(build.autoMegaApplied, false);
  assert.notEqual(build.item, "Staraptite");
});

check("a directly-forced Mega slot (the member's own name IS the Mega form) is never flagged autoMegaApplied -- there's no base form to fall back to", () => {
  const megaCharizardY = { name: "Mega Charizard Y", types: ["Fire", "Flying"], baseStats: statsFor("Mega Charizard Y"), learnableNames: learnsets["Charizard"] };
  const build = context.wcGenerateBuild(megaCharizardY, megaCharizardY.baseStats, megaCharizardY.learnableNames, movesData, THREATS, typeChart, {
    format: "doubles",
    usedItems: new Set(),
    abilitiesData,
  });
  assert.equal(build.autoMegaApplied, false);
  assert.equal(build.item, "Charizardite Y");
});

// ---------------------------------------------------------------------------
// wcGenerateTeamBuilds end-to-end: requirements (4) and (5) together --
// an accepted synergy assignment gets baked automatically into the FIRST
// build, and the assigned member's auto-Mega is suppressed so it keeps
// the ability/moveset that made it the right pick.
// ---------------------------------------------------------------------------

const slowbroForTeam = { name: "Slowbro", types: ["Water", "Psychic"], baseStats: statsFor("Slowbro"), learnableNames: learnsets["Slowbro"] };

check("wcGenerateTeamBuilds automatically bakes Tailwind into Staraptor's first build AND skips its auto-Mega -- no manual 'Make changes' click needed", () => {
  const result = context.wcGenerateTeamBuilds(
    [staraptor, slowbroForTeam],
    movesData,
    THREATS,
    typeChart,
    "doubles",
    abilitiesData,
    "closed",
    null,
    null
  );
  const build = result.builds.Staraptor;
  assert.equal(build.moves.length, 4);
  assert.ok(build.moves.includes("Tailwind"), `expected Tailwind baked in automatically, got ${build.moves}`);
  assert.equal(build.autoMegaApplied, false, "auto-Mega should have been suppressed once Staraptor was assigned a forced role");
  assert.notEqual(build.item, "Staraptite", "Staraptor should keep a real support/offensive item, not its Mega Stone, once it's the Tailwind setter");
});

check("wcGenerateTeamBuilds leaves an auto-Mega'd member's Mega intact when it is NOT assigned any forced role", () => {
  // Charizard's real curated Mega Y set exists, but base Charizard learns
  // none of the archetype-setter moves (Trick Room/Tailwind/screens/Wide
  // Guard/Quick Guard/terrain/Safeguard) that wcAssignTeamSynergy could
  // ever assign it -- so across ANY team it should never lose its Mega.
  // Suppressing tailwind/sun/rain via notes here just rules out the two
  // OTHER archetypes this same Staraptor/Charizard pairing would
  // otherwise qualify for, so this run cleanly demonstrates a real "no
  // assignment happened" case for both members at once.
  const charizardMegaForms = [{ name: "Mega Charizard Y", types: ["Fire", "Flying"], baseStats: statsFor("Mega Charizard Y") }];
  const charizard = {
    name: "Charizard",
    types: ["Fire", "Flying"],
    baseStats: statsFor("Charizard"),
    learnableNames: learnsets["Charizard"],
    megaForms: charizardMegaForms,
  };
  const result = context.wcGenerateTeamBuilds(
    [staraptor, charizard],
    movesData,
    THREATS,
    typeChart,
    "doubles",
    abilitiesData,
    "closed",
    null,
    null,
    "no tailwind, no sun, no rain please"
  );
  assert.equal(result.builds.Staraptor.autoMegaApplied, true);
  assert.equal(result.builds.Staraptor.item, "Staraptite");
  assert.equal(result.builds.Charizard.autoMegaApplied, true);
  assert.equal(result.builds.Charizard.item, "Charizardite Y");
});

check("wcGenerateTeamBuilds's regression case (Slowbro/Gengar, no forming archetype) is untouched by the new synergy step", () => {
  const slowboMember = { name: "Slowbro", types: ["Water", "Psychic"], baseStats: statsFor("Slowbro"), learnableNames: learnsets["Slowbro"] };
  const gengarMember = { name: "Gengar", types: ["Ghost", "Poison"], baseStats: statsFor("Gengar"), learnableNames: learnsets["Gengar"] };
  const result = context.wcGenerateTeamBuilds([slowboMember, gengarMember], movesData, THREATS, typeChart, "doubles", abilitiesData, "closed", null, null);
  assert.ok(result.builds.Slowbro && result.builds.Gengar);
  assert.equal(result.builds.Slowbro.moves.length, 4);
  assert.equal(result.builds.Gengar.moves.length, 4);
});

console.log("");
console.log(`All ${checks} strategy-synergy-assignment checks passed.`);
