// WinCon — tools/test-meta-analyst.mjs
//
// Milestone 46: the "WinCon Meta Analyst" -- a deterministic, rule-based
// team critique engine built from an externally-sourced system-prompt
// draft (a Gemini prompt describing an LLM chatbot critic). WinCon has
// no backend and holds no API key, so this reuses the same explainable,
// rule-based approach every other analysis feature in this file already
// uses, instead of wiring up a real chatbot. Tests the four new checks
// (physical/special move-vs-stat mismatch, Trick Room dependency, the
// anti-Trick-Room audit, the item-value audit), the pure fix-applier,
// and the combined wcMetaAnalystReport entry point -- including a full
// real-data integration test built from a real team a user pasted in for
// analysis (Gemini's "Mega Sceptile & Charizard Y Dual-Core"), with its
// one illegal move (Staraptor can't actually learn Taunt in this game's
// data -- see wcParseShowdownTeam's own movepool-legality warning for how
// a real paste surfaces that) swapped for a legal placeholder so the
// strategy-analysis layer itself can run end to end.
//
// Run: node tools/test-meta-analyst.mjs

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

// ---------------------------------------------------------------------------
// Dependency confirmation
// ---------------------------------------------------------------------------

check("dependency check: the earlier analysis primitives this builds on all exist", () => {
  ["wcAnalyzeTeamStrategy", "wcAntiSynergyWarnings", "wcSharedWeaknessWarnings", "wcMegaMatchupAdvice", "wcStatedCounterNote", "wcArchetypeDisplayName"].forEach(
    (fn) => assert.equal(typeof context[fn], "function", `${fn} should exist`)
  );
});

check("dependency check: the new Milestone 46 functions all exist", () => {
  [
    "wcMoveStatMismatchWarnings",
    "wcTrickRoomDependencyWarnings",
    "wcAntiTrickRoomAudit",
    "wcItemValueAudit",
    "wcApplyMetaAnalystFixes",
    "wcMetaAnalystReport",
  ].forEach((fn) => assert.equal(typeof context[fn], "function", `${fn} should exist`));
  // Note: WINCON_HIGH_VARIANCE_ITEMS is a top-level const in strategy.js --
  // per this harness's own established vm.createContext gotcha (see the
  // README/other test files), a top-level const isn't visible as
  // context.WINCON_HIGH_VARIANCE_ITEMS from outside, only function
  // declarations are. Its real behavior is exercised directly by the
  // Quick Claw check below instead.
});

const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const baseStatsData = loadJSON("data/base-stats.json");
const learnsets = loadJSON("data/learnsets.json");
const abilitiesData = loadJSON("data/abilities.json");
const pokemonData = loadJSON("data/pokemon.json");

function statsFor(name) {
  return baseStatsData.find((b) => b.name === name);
}

function poolMember(name) {
  return { name, types: pokemonData.find((p) => p.name === name).types, baseStats: statsFor(name), learnableNames: learnsets[name] };
}

function emptyBuild() {
  return { nature: "", item: "", moves: ["", "", "", ""], sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0 }, ability: "" };
}

const THREATS = [{ name: "Grass Threat", types: ["Grass"] }, { name: "Steel Threat", types: ["Steel"] }];

// ---------------------------------------------------------------------------
// wcMoveStatMismatchWarnings
// ---------------------------------------------------------------------------

check("wcMoveStatMismatchWarnings flags a real Physical move on a heavily Special-biased attacker with a concrete same-type alternative", () => {
  const sceptile = poolMember("Mega Sceptile"); // real: atk 110, spa 145 -- a 35-point special bias
  const build = emptyBuild();
  build.moves = ["Dragon Rush", "Leaf Storm", "Earth Power", "Focus Blast"]; // Dragon Rush is real, Physical, and Mega Sceptile really learns it
  const builds = { "Mega Sceptile": build };
  const results = context.wcMoveStatMismatchWarnings([sceptile], builds, movesData);
  assert.equal(results.length, 1);
  assert.match(results[0].text, /Mega Sceptile/);
  assert.match(results[0].text, /Dragon Rush/);
  assert.match(results[0].text, /Dragon Pulse/); // the real same-type Special alternative in its learnset
  assert.deepEqual(JSON.parse(JSON.stringify(results[0].suggestedFix)), { pokemon: "Mega Sceptile", field: "move", slotIndex: 0, to: "Dragon Pulse" });
});

check("wcMoveStatMismatchWarnings stays quiet when no genuinely better same-type alternative exists in the learnset", () => {
  const sceptile = poolMember("Mega Sceptile");
  const build = emptyBuild();
  // Rock Slide is Physical and Mega Sceptile can learn it, but it has no
  // learnable same-type (Rock) Special move to switch to at all -- silence,
  // not a guess, is the right answer here.
  build.moves = ["Rock Slide", "Leaf Storm", "Dragon Pulse", "Focus Blast"];
  const results = context.wcMoveStatMismatchWarnings([sceptile], { "Mega Sceptile": build }, movesData);
  assert.equal(results.length, 0);
});

check("wcMoveStatMismatchWarnings never recommends a move the Pokemon already knows in another slot", () => {
  const sceptile = poolMember("Mega Sceptile");
  const build = emptyBuild();
  // Earthquake (Physical Ground) has exactly one learnable same-type
  // Special alternative, Earth Power -- but this build already runs Earth
  // Power in another slot, so there's nothing left to recommend.
  build.moves = ["Earthquake", "Earth Power", "Dragon Pulse", "Focus Blast"];
  const results = context.wcMoveStatMismatchWarnings([sceptile], { "Mega Sceptile": build }, movesData);
  assert.equal(results.length, 0);
});

check("wcMoveStatMismatchWarnings: real Steelix moveset (Attack-biased stats, all-Physical moves) produces zero false positives", () => {
  const steelix = poolMember("Steelix"); // real: atk 85, spa 55
  const build = emptyBuild();
  build.moves = ["Heavy Slam", "Earthquake", "Wide Guard", "Rock Slide"];
  const results = context.wcMoveStatMismatchWarnings([steelix], { Steelix: build }, movesData);
  assert.equal(results.length, 0);
});

// ---------------------------------------------------------------------------
// wcTrickRoomDependencyWarnings
// ---------------------------------------------------------------------------

check("wcTrickRoomDependencyWarnings flags a Brave/0-Speed 'Trick Room sweeper' spread when no teammate actually sets Trick Room", () => {
  const steelix = poolMember("Steelix");
  const build = emptyBuild();
  build.nature = "Brave";
  build.sp.speed = 0;
  build.moves = ["Heavy Slam", "Earthquake", "Wide Guard", "Rock Slide"];
  const results = context.wcTrickRoomDependencyWarnings([steelix], { Steelix: build });
  assert.equal(results.length, 1);
  assert.match(results[0], /Steelix/);
  assert.match(results[0], /Trick Room/);
});

check("wcTrickRoomDependencyWarnings stays quiet once a real teammate sets Trick Room", () => {
  const steelix = poolMember("Steelix");
  const oranguru = poolMember("Oranguru");
  const steelixBuild = emptyBuild();
  steelixBuild.nature = "Brave";
  steelixBuild.sp.speed = 0;
  steelixBuild.moves = ["Heavy Slam", "Earthquake", "Wide Guard", "Rock Slide"];
  const oranguruBuild = emptyBuild();
  oranguruBuild.moves = ["Trick Room", "Instruct", "Foul Play", "Psychic"];
  const results = context.wcTrickRoomDependencyWarnings(
    [steelix, oranguru],
    { Steelix: steelixBuild, Oranguru: oranguruBuild }
  );
  assert.equal(results.length, 0);
});

check("wcTrickRoomDependencyWarnings exempts a member that knows Trick Room itself, even alone", () => {
  const steelix = poolMember("Steelix");
  const build = emptyBuild();
  build.nature = "Brave";
  build.sp.speed = 0;
  build.moves = ["Trick Room", "Heavy Slam", "Earthquake", "Rock Slide"];
  const results = context.wcTrickRoomDependencyWarnings([steelix], { Steelix: build });
  assert.equal(results.length, 0);
});

check("wcTrickRoomDependencyWarnings never fires for a Sassy/Relaxed minimum-Speed support build (not an Atk/SpA-boosting nature)", () => {
  const incineroar = poolMember("Incineroar");
  const build = emptyBuild();
  build.nature = "Sassy";
  build.sp.speed = 0;
  build.moves = ["Fake Out", "Taunt", "Parting Shot", "Throat Chop"];
  const results = context.wcTrickRoomDependencyWarnings([incineroar], { Incineroar: build });
  assert.equal(results.length, 0);
});

// ---------------------------------------------------------------------------
// wcAntiTrickRoomAudit
// ---------------------------------------------------------------------------

check("wcAntiTrickRoomAudit: a real Incineroar covering all four tools produces four confirmations, zero gaps", () => {
  const incineroar = poolMember("Incineroar");
  const build = emptyBuild();
  build.nature = "Sassy";
  build.sp.speed = 0;
  build.item = "Safety Goggles";
  build.moves = ["Fake Out", "Taunt", "Parting Shot", "Throat Chop"];
  const audit = context.wcAntiTrickRoomAudit([incineroar], { Incineroar: build }, "tailwind");
  assert.equal(audit.audited, true);
  assert.equal(audit.confirmations.length, 4);
  assert.equal(audit.gaps.length, 0);
});

check("wcAntiTrickRoomAudit: a team with none of the four tools produces four gaps, zero confirmations", () => {
  const staraptor = poolMember("Staraptor");
  const build = emptyBuild();
  build.nature = "Jolly";
  build.sp.speed = 32;
  build.item = "Focus Sash";
  build.moves = ["Tailwind", "Protect", "Brave Bird", "Close Combat"];
  const audit = context.wcAntiTrickRoomAudit([staraptor], { Staraptor: build }, "tailwind");
  assert.equal(audit.audited, true);
  assert.equal(audit.confirmations.length, 0);
  assert.equal(audit.gaps.length, 4);
});

check("wcAntiTrickRoomAudit is skipped entirely for a team whose own archetype IS Trick Room", () => {
  const audit = context.wcAntiTrickRoomAudit([poolMember("Steelix")], { Steelix: emptyBuild() }, "trickroom");
  assert.equal(audit.audited, false);
});

// ---------------------------------------------------------------------------
// wcItemValueAudit
// ---------------------------------------------------------------------------

check("wcItemValueAudit flags a held high-variance item", () => {
  const build = emptyBuild();
  build.item = "Quick Claw";
  const result = context.wcItemValueAudit([poolMember("Steelix")], { Steelix: build });
  assert.equal(result.flags.length, 1);
  assert.match(result.flags[0], /Quick Claw/);
  assert.equal(result.fixes.length, 0);
});

check("wcItemValueAudit recommends Light Clay for a real dual-screener not holding it", () => {
  const primarina = poolMember("Primarina");
  const build = emptyBuild();
  build.item = "Leftovers";
  build.moves = ["Reflect", "Light Screen", "Hyper Voice", "Dazzling Gleam"];
  const result = context.wcItemValueAudit([primarina], { Primarina: build });
  assert.equal(result.flags.length, 1);
  assert.equal(result.fixes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.fixes[0])), { pokemon: "Primarina", field: "item", to: "Light Clay" });
});

check("wcItemValueAudit recommends Focus Sash for a real Tailwind lead holding no item at all", () => {
  const staraptor = poolMember("Staraptor");
  const build = emptyBuild();
  build.item = "";
  build.moves = ["Tailwind", "Protect", "Brave Bird", "Close Combat"];
  const result = context.wcItemValueAudit([staraptor], { Staraptor: build });
  assert.equal(result.flags.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.fixes[0])), { pokemon: "Staraptor", field: "item", to: "Focus Sash" });
});

check("wcItemValueAudit never suggests replacing a real Mega Stone, even on a dual-screener", () => {
  const primarina = poolMember("Primarina");
  const build = emptyBuild();
  build.item = "Sceptilite"; // contrived, but proves the exemption is item-value-based, not species-based
  build.moves = ["Reflect", "Light Screen", "Hyper Voice", "Dazzling Gleam"];
  const result = context.wcItemValueAudit([primarina], { Primarina: build });
  assert.equal(result.flags.length, 0);
  assert.equal(result.fixes.length, 0);
});

check("wcItemValueAudit stays quiet on a real, already-correct dual-screener/Light-Clay pairing", () => {
  const primarina = poolMember("Primarina");
  const build = emptyBuild();
  build.item = "Light Clay";
  build.moves = ["Reflect", "Light Screen", "Hyper Voice", "Dazzling Gleam"];
  const result = context.wcItemValueAudit([primarina], { Primarina: build });
  assert.equal(result.flags.length, 0);
  assert.equal(result.fixes.length, 0);
});

// ---------------------------------------------------------------------------
// wcApplyMetaAnalystFixes: pure, additive fix application
// ---------------------------------------------------------------------------

check("wcApplyMetaAnalystFixes applies item and move fixes without mutating the original builds object", () => {
  const original = {
    Primarina: { nature: "Modest", item: "Leftovers", moves: ["Reflect", "Light Screen", "Hyper Voice", "Dazzling Gleam"], sp: { hp: 32 }, ability: "" },
    "Mega Sceptile": { nature: "Timid", item: "Sceptilite", moves: ["Dragon Rush", "Leaf Storm", "Earth Power", "Focus Blast"], sp: {}, ability: "" },
  };
  const snapshot = JSON.parse(JSON.stringify(original));
  const fixed = context.wcApplyMetaAnalystFixes(original, [
    { pokemon: "Primarina", field: "item", to: "Light Clay" },
    { pokemon: "Mega Sceptile", field: "move", slotIndex: 0, to: "Dragon Pulse" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(original)), snapshot, "must never mutate the input");
  assert.equal(fixed.Primarina.item, "Light Clay");
  assert.equal(fixed["Mega Sceptile"].moves[0], "Dragon Pulse");
  assert.equal(fixed["Mega Sceptile"].moves[1], "Leaf Storm"); // untouched slots survive
});

// ---------------------------------------------------------------------------
// wcMetaAnalystReport: full real-data integration test, built from a real
// user-pasted team (Gemini's "Mega Sceptile & Charizard Y Dual-Core").
// Staraptor's pasted Taunt is illegal in this game's real data (it isn't
// in Staraptor's learnset -- confirmed separately, and exactly the kind
// of thing wcParseShowdownTeam's own import-time warning already catches
// for a real paste) -- swapped here for the real, legal Protect so the
// strategy-analysis layer itself has something valid to run end to end.
// ---------------------------------------------------------------------------

function geminiTeamMembers() {
  return [
    poolMember("Staraptor"),
    poolMember("Primarina"),
    poolMember("Incineroar"),
    poolMember("Steelix"),
    poolMember("Mega Sceptile"),
    poolMember("Mega Charizard Y"),
  ];
}

function geminiTeamBuilds() {
  const b = (nature, item, moves, sp) => ({ nature, item, moves, sp: { hp: 0, attack: 0, defense: 0, sp_attack: 0, sp_defense: 0, speed: 0, ...sp }, ability: "" });
  return {
    Staraptor: b("Jolly", "Focus Sash", ["Tailwind", "Protect", "Brave Bird", "Close Combat"], { attack: 32, speed: 32 }),
    Primarina: b("Modest", "Light Clay", ["Reflect", "Light Screen", "Hyper Voice", "Dazzling Gleam"], { hp: 32, sp_attack: 32 }),
    Incineroar: b("Sassy", "Safety Goggles", ["Fake Out", "Taunt", "Parting Shot", "Throat Chop"], { hp: 32, sp_defense: 32, speed: 0 }),
    Steelix: b("Brave", "Leftovers", ["Heavy Slam", "Earthquake", "Wide Guard", "Rock Slide"], { hp: 32, attack: 32, speed: 0 }),
    "Mega Sceptile": b("Timid", "Sceptilite", ["Leaf Storm", "Dragon Pulse", "Earth Power", "Focus Blast"], { sp_attack: 32, speed: 32 }),
    "Mega Charizard Y": b("Timid", "Charizardite Y", ["Heat Wave", "Solar Beam", "Focus Blast", "Protect"], { sp_attack: 32, speed: 32 }),
  };
}

check("wcMetaAnalystReport on the real Gemini team: zero move-stat mismatches (every mon's moves already match its real stat bias)", () => {
  const report = context.wcMetaAnalystReport(geminiTeamMembers(), geminiTeamBuilds(), movesData, THREATS, typeChart, "doubles", "", abilitiesData, null);
  assert.equal(report.moveMismatches.length, 0);
});

check("wcMetaAnalystReport on the real Gemini team: catches Steelix's real Trick Room dependency (Brave/0 Speed, but no Trick Room setter anywhere on the team)", () => {
  const report = context.wcMetaAnalystReport(geminiTeamMembers(), geminiTeamBuilds(), movesData, THREATS, typeChart, "doubles", "", abilitiesData, null);
  assert.equal(report.trickRoomDependency.length, 1);
  assert.match(report.trickRoomDependency[0], /Steelix/);
});

check("wcMetaAnalystReport on the real Gemini team: the anti-Trick-Room audit passes clean (Incineroar alone covers all four tools)", () => {
  const report = context.wcMetaAnalystReport(geminiTeamMembers(), geminiTeamBuilds(), movesData, THREATS, typeChart, "doubles", "", abilitiesData, null);
  assert.equal(report.trickRoomAudit.audited, true);
  assert.equal(report.trickRoomAudit.gaps.length, 0);
  assert.equal(report.trickRoomAudit.confirmations.length, 4);
});

check("wcMetaAnalystReport on the real Gemini team: the item-value audit is clean (Focus Sash/Light Clay/Safety Goggles all already correctly assigned)", () => {
  const report = context.wcMetaAnalystReport(geminiTeamMembers(), geminiTeamBuilds(), movesData, THREATS, typeChart, "doubles", "", abilitiesData, null);
  assert.equal(report.itemAudit.flags.length, 0);
  assert.equal(report.fixes.length, 0);
});

check("wcMetaAnalystReport on the real Gemini team: a real strategy is detected and the Team Modes breakdown is non-empty", () => {
  const report = context.wcMetaAnalystReport(geminiTeamMembers(), geminiTeamBuilds(), movesData, THREATS, typeChart, "doubles", "", abilitiesData, null);
  assert.equal(typeof report.archetype, "string");
  assert.ok(report.modes.length >= 1, "the Anti-Trick-Room Mode alone should always populate modes for this team");
  assert.ok(report.modes.some((m) => m.title === "Anti-Trick-Room Mode"));
});

check("wcMetaAnalystReport on the real Gemini team: an empty fixes list round-trips through wcApplyMetaAnalystFixes unchanged", () => {
  const builds = geminiTeamBuilds();
  const report = context.wcMetaAnalystReport(geminiTeamMembers(), builds, movesData, THREATS, typeChart, "doubles", "", abilitiesData, null);
  const fixed = context.wcApplyMetaAnalystFixes(builds, report.fixes);
  assert.deepEqual(JSON.parse(JSON.stringify(fixed)), JSON.parse(JSON.stringify(builds)));
});

console.log(`\nAll ${checks} Meta Analyst checks passed.`);
