// WinCon — tools/test-pilot-guide.mjs
//
// Milestone 44: "how to pilot this team" explainer bubble. Tests the two
// genuinely new pieces in strategy.js -- WINCON_ARCHETYPE_COUNTERS/
// wcStatedCounterNote (the hand-picked counters table) and
// wcAssemblePilotGuide (the pure, DOM-free data assembly consumed by
// builder.js's renderPilotGuideNote, the actual synthesis of data that's
// already computed elsewhere).
//
// Run: node tools/test-pilot-guide.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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
// wcStatedCounterNote / WINCON_ARCHETYPE_COUNTERS
// ---------------------------------------------------------------------------

// Every archetype key this app can ever surface as a team's primary or
// alternative strategy (see strategy.js's WC_ARCHETYPE_DISPLAY_NAMES plus
// helpinghand, which is deliberately excluded from the pick-time signals
// system but can still win via wcAnalyzeTeamStrategy's own candidate
// list -- see wcBuildStrategyCandidates).
const ALL_REAL_ARCHETYPES = [
  "trickroom", "tailwind", "sun", "rain", "sand", "snow", "screens",
  "wideguard", "quickguard", "safeguard", "redirect", "hazards",
  "electricterrain", "grassyterrain", "mistyterrain", "psychicterrain",
  "helpinghand",
];

check("wcStatedCounterNote returns a real, non-empty counter line for every real archetype", () => {
  ALL_REAL_ARCHETYPES.forEach((archetype) => {
    const note = context.wcStatedCounterNote(archetype);
    assert.ok(typeof note === "string" && note.length > 20, `expected a real counter line for "${archetype}", got ${JSON.stringify(note)}`);
    assert.ok(note.includes(" -- "), `expected the counter/reason separator for "${archetype}"`);
  });
});

check("wcStatedCounterNote returns null for 'balanced' -- there's nothing specific to counter", () => {
  assert.equal(context.wcStatedCounterNote("balanced"), null);
});

check("wcStatedCounterNote returns null for an unknown/invalid archetype key", () => {
  assert.equal(context.wcStatedCounterNote("not-a-real-archetype"), null);
  assert.equal(context.wcStatedCounterNote(undefined), null);
});

check("wcStatedCounterNote's Trick Room counter names Taunt (the real, well-known answer)", () => {
  assert.ok(context.wcStatedCounterNote("trickroom").includes("Taunt"));
});

check("wcStatedCounterNote's Helping Hand counter names Protect (the real, well-known answer)", () => {
  assert.ok(context.wcStatedCounterNote("helpinghand").includes("Protect"));
});

check("wcStatedCounterNote gives each of the four terrains a real, ungrounded-based counter (they share the same real mechanic)", () => {
  ["electricterrain", "grassyterrain", "mistyterrain", "psychicterrain"].forEach((t) => {
    assert.ok(context.wcStatedCounterNote(t).toLowerCase().includes("ungrounded") || context.wcStatedCounterNote(t).toLowerCase().includes("flying"));
  });
});

check("wcArchetypeDisplayName covers helpinghand (a real gap the display-names table had before this milestone)", () => {
  assert.equal(context.wcArchetypeDisplayName("helpinghand"), "Helping Hand");
});

// ---------------------------------------------------------------------------
// wcAssemblePilotGuide: pure data assembly, no DOM.
// ---------------------------------------------------------------------------

check("wcAssemblePilotGuide returns null when there's no strategy at all", () => {
  assert.equal(context.wcAssemblePilotGuide(null, null, []), null);
  assert.equal(context.wcAssemblePilotGuide(undefined, null, []), null);
});

check("wcAssemblePilotGuide handles a 'balanced' strategy honestly -- no archetype label, no counter, mechanism note still passes through", () => {
  const strategy = { archetype: "balanced", setterName: null, note: "Playing as six independent attackers." };
  const guide = context.wcAssemblePilotGuide(strategy, null, []);
  assert.equal(guide.archetypeLabel, null);
  assert.equal(guide.counterNote, null);
  assert.equal(guide.setterName, null);
  assert.equal(guide.megaAdviceNote, null);
  assert.equal(guide.mechanismNote, "Playing as six independent attackers.");
  assert.deepEqual(JSON.parse(JSON.stringify(guide.warnings)), []);
});

check("wcAssemblePilotGuide combines every real ingredient for a genuine archetype -- label, setter, mega advice, warnings, and the stated counter", () => {
  const strategy = { archetype: "trickroom", setterName: "Farigiraf", note: "Farigiraf can learn Trick Room and your team is built bulky." };
  const megaAdvice = { note: "Mega Gengar looks like the stronger matchup call." };
  const warnings = ["Steel is a shared weakness between Farigiraf and Steelix."];
  const guide = context.wcAssemblePilotGuide(strategy, megaAdvice, warnings);
  assert.equal(guide.archetype, "trickroom");
  assert.equal(guide.archetypeLabel, "Trick Room");
  assert.equal(guide.setterName, "Farigiraf");
  assert.equal(guide.mechanismNote, strategy.note);
  assert.equal(guide.megaAdviceNote, megaAdvice.note);
  assert.deepEqual(JSON.parse(JSON.stringify(guide.warnings)), warnings);
  assert.equal(guide.counterNote, context.wcStatedCounterNote("trickroom"));
  assert.ok(guide.counterNote.includes("Taunt"));
});

check("wcAssemblePilotGuide's helpinghand archetype gets a real display label (Milestone 36 deliberately excluded it from the pick-time signals system, but it can still win here)", () => {
  const strategy = { archetype: "helpinghand", setterName: "Whimsicott", note: "Whimsicott can learn Helping Hand." };
  const guide = context.wcAssemblePilotGuide(strategy, null, []);
  assert.equal(guide.archetypeLabel, "Helping Hand");
  assert.ok(guide.counterNote.includes("Protect"));
});

check("wcAssemblePilotGuide defaults warnings to an empty array when omitted, and never mutates the caller's warnings array", () => {
  const strategy = { archetype: "wideguard", setterName: "Steelix", note: "Steelix can learn Wide Guard." };
  const guideNoWarnings = context.wcAssemblePilotGuide(strategy, null);
  assert.deepEqual(JSON.parse(JSON.stringify(guideNoWarnings.warnings)), []);

  const warnings = ["a real warning"];
  const guide = context.wcAssemblePilotGuide(strategy, null, warnings);
  guide.warnings.push("mutated after the fact");
  assert.deepEqual(warnings, ["a real warning"], "the caller's own warnings array must be untouched");
});

check("wcAssemblePilotGuide omits Mega advice cleanly when wcMegaMatchupAdvice found nothing to compare (its own real null case)", () => {
  const strategy = { archetype: "tailwind", setterName: "Staraptor", note: "Staraptor can learn Tailwind." };
  const guide = context.wcAssemblePilotGuide(strategy, null, []);
  assert.equal(guide.megaAdviceNote, null);
});

console.log("");
console.log(`All ${checks} pilot-guide checks passed.`);
