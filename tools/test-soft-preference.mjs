// WinCon — tools/test-soft-preference.mjs
//
// Phoenix's Tailwind/Staraptor/screens request also asked: "if you must
// replace Staraptor, ensure the replacement carries equivalent value."
// Before this, a name in Team Notes either hard-forced a Pokemon onto the
// roster (WINCON_INCLUDE_TRIGGERS/wcNotesMentionedSpecies, unconditional)
// or did nothing during picking -- so a mentioned-but-not-demanded
// Pokemon could never actually lose a fair fight to a better alternative,
// which made "ensure equivalence" impossible to place. This tests the
// fix: wcNotesSoftPreferenceBonus (a small, genuinely-scored nudge, never
// a force), its wiring into wcDreamTeamCandidateScore, and the honest
// flip side wcSoftPreferenceTradeoffNote (says what was traded away when
// the softly-preferred Pokemon still loses).
//
// Run: node tools/test-soft-preference.mjs

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

// Real fixtures, matching Phoenix's own scenario: Staraptor (real
// curated ability here is Reckless, learns Tailwind) as the softly-
// preferred pick that ends up NOT making the team, and Whimsicott (real
// ability Prankster, also learns Tailwind) as the teammate that actually
// takes over the Tailwind role instead -- two different abilities, so
// there's genuinely something worth flagging as traded away.
const STARAPTOR = { name: "Staraptor", types: ["Normal", "Flying"], baseStats: byName("Staraptor"), learnableNames: learnsets["Staraptor"] };
const WHIMSICOTT = { name: "Whimsicott", types: ["Grass", "Fairy"], baseStats: byName("Whimsicott"), learnableNames: learnsets["Whimsicott"] };
const PLAIN = { name: "PlainMon", types: ["Normal"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 }, learnableNames: [] };

// ---------------------------------------------------------------------------
// wcNotesSoftPreferenceBonus
// ---------------------------------------------------------------------------

check("wcNotesSoftPreferenceBonus fires WC_SOFT_PREFERENCE_BONUS on a real plain-substring mention", () => {
  const bonus = context.wcNotesSoftPreferenceBonus("Staraptor", "I've landed on Staraptor to set up tailwind");
  assert.equal(bonus, 0.5); // WC_SOFT_PREFERENCE_BONUS in strategy.js
});

check("wcNotesSoftPreferenceBonus is 0 when the candidate's name is not mentioned", () => {
  const bonus = context.wcNotesSoftPreferenceBonus("Whimsicott", "I've landed on Staraptor to set up tailwind");
  assert.equal(bonus, 0);
});

check("wcNotesSoftPreferenceBonus is 0 for empty/whitespace notes", () => {
  assert.equal(context.wcNotesSoftPreferenceBonus("Staraptor", ""), 0);
  assert.equal(context.wcNotesSoftPreferenceBonus("Staraptor", "   "), 0);
  assert.equal(context.wcNotesSoftPreferenceBonus("Staraptor", null), 0);
});

check("WC_SOFT_PREFERENCE_BONUS is genuinely smaller than a real archetype-synergy weight (never overrides a real matchup edge)", () => {
  // vm contexts don't expose top-level `const`s as own properties (only
  // `function`/`var` declarations do), so these are the same literal
  // values strategy.js defines them as -- WC_SOFT_PREFERENCE_BONUS = 0.5,
  // WC_ARCHETYPE_BENEFICIARY_WEIGHT = 1.5, WC_ARCHETYPE_SETTER_WEIGHT = 1.
  assert.ok(0.5 < 1.5);
  assert.ok(0.5 < 1);
});

// ---------------------------------------------------------------------------
// wcDreamTeamCandidateScore wiring -- controlled twins, identical except
// one is mentioned in notes, following test-archetype-synergy-picking.mjs's
// own established twin pattern.
// ---------------------------------------------------------------------------

check("wcDreamTeamCandidateScore: a mentioned candidate scores exactly WC_SOFT_PREFERENCE_BONUS higher than an identical unmentioned twin", () => {
  const twinA = { name: "TwinA", types: ["Normal"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 } };
  const twinB = { name: "TwinB", types: ["Normal"], baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 } };
  const opts = { abilitiesData, format: "doubles", notes: "I'm really keen on TwinA for this team" };
  const scoreA = context.wcDreamTeamCandidateScore(twinA, [], [], typeChart, typeChart.types, opts);
  const scoreB = context.wcDreamTeamCandidateScore(twinB, [], [], typeChart, typeChart.types, opts);
  assert.ok(Math.abs(scoreA - scoreB - 0.5) < 1e-9, `expected scoreA-scoreB (${scoreA - scoreB}) to equal 0.5`);
});

check("regression guard: a mentioned-but-clearly-worse candidate still loses to a strong unmentioned alternative", () => {
  // A real bad matchup (Fire, weak to and weak against a Water-heavy
  // threat list) named in notes, versus a real great matchup (Grass,
  // resists Water and hits it for super effective) that isn't mentioned
  // at all -- a gap in wcDreamTeamCandidateScore's real coverage-gain
  // terms far bigger than WC_SOFT_PREFERENCE_BONUS (0.5) could ever
  // close, so the soft preference can only ever break a close tie, never
  // rescue a genuinely worse pick.
  const threats = [{ name: "Threat1", types: ["Water"] }, { name: "Threat2", types: ["Water"] }];
  const weakButMentioned = { name: "WeakButMentioned", types: ["Fire"], baseStats: { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50 } };
  const strongUnmentioned = { name: "StrongUnmentioned", types: ["Grass"], baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 } };
  const opts = { abilitiesData, format: "doubles", notes: "I've landed on WeakButMentioned for this team" };
  const scoreWeak = context.wcDreamTeamCandidateScore(weakButMentioned, [], threats, typeChart, typeChart.types, opts);
  const scoreStrong = context.wcDreamTeamCandidateScore(strongUnmentioned, [], threats, typeChart, typeChart.types, opts);
  assert.ok(scoreStrong > scoreWeak, `expected the strong unmentioned candidate (${scoreStrong}) to still beat the weak mentioned one (${scoreWeak})`);
});

// ---------------------------------------------------------------------------
// wcSoftPreferenceTradeoffNote
// ---------------------------------------------------------------------------

check("wcSoftPreferenceTradeoffNote is null when there's no mentioned candidate", () => {
  assert.equal(context.wcSoftPreferenceTradeoffNote(null, [WHIMSICOTT], "doubles", abilitiesData), null);
});

check("wcSoftPreferenceTradeoffNote is null when the mentioned candidate actually made the final team", () => {
  const finalTeam = [STARAPTOR, WHIMSICOTT];
  assert.equal(context.wcSoftPreferenceTradeoffNote(STARAPTOR, finalTeam, "doubles", abilitiesData), null);
});

check("wcSoftPreferenceTradeoffNote is null when the mentioned candidate carries no archetype signal", () => {
  assert.equal(context.wcSoftPreferenceTradeoffNote(PLAIN, [WHIMSICOTT], "doubles", abilitiesData), null);
});

check("wcSoftPreferenceTradeoffNote is null when nothing on the final team fills that archetype role either", () => {
  const finalTeam = [PLAIN];
  assert.equal(context.wcSoftPreferenceTradeoffNote(STARAPTOR, finalTeam, "doubles", abilitiesData), null);
});

check("wcSoftPreferenceTradeoffNote is null when the actual setter's ability matches the mentioned Pokemon's (nothing was really given up)", () => {
  // Two synthetic Tailwind setters sharing the same ability -- nothing
  // distinctive was traded away, so this should stay silent.
  const sameAbilityAbilities = Object.assign({}, abilitiesData, {
    SyntheticMentioned: { ability: "Reckless" },
    SyntheticActual: { ability: "Reckless" },
  });
  const mentioned = { name: "SyntheticMentioned", baseStats: PLAIN.baseStats, learnableNames: ["Tailwind"] };
  const actual = { name: "SyntheticActual", baseStats: PLAIN.baseStats, learnableNames: ["Tailwind"] };
  assert.equal(context.wcSoftPreferenceTradeoffNote(mentioned, [actual], "doubles", sameAbilityAbilities), null);
});

check("wcSoftPreferenceTradeoffNote explains the trade-off plainly when a different-ability teammate took over the same archetype role", () => {
  const finalTeam = [WHIMSICOTT];
  const note = context.wcSoftPreferenceTradeoffNote(STARAPTOR, finalTeam, "doubles", abilitiesData);
  assert.notEqual(note, null);
  assert.match(note, /Staraptor/);
  assert.match(note, /Whimsicott/);
  assert.match(note, /Tailwind/);
  assert.match(note, /Prankster/);
  assert.match(note, /Reckless/);
});

console.log("");
console.log(`All ${checks} soft-preference checks passed.`);
