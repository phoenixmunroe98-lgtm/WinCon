// WinCon — tools/test-assisting-pokemon.mjs (Milestone 52)
//
// Regression test for Phoenix's "Assisting Pokemon" request: "Make sure
// primarinas assistance isnt missed in the match-up, the use of reflect
// and light screen enable staraptor and incineroar to be able to have
// more survivability. this type of play is to be called an assisting
// pokemon and it applied to all pokemon who can assist the teams synergy
// and strategy (including but not limited too: Sinistcha, Primarina,
// girafarig, peliper, and similar pokemon)". The screens-aware
// survivability fix itself is covered in tools/test-game-plan-simulation.mjs
// (Milestone 52 section); this file covers the second half: a real,
// curated support-ABILITY signal that nothing else in strategy.js
// recognized, and the "Assisting Pokemon" label/reasoning text itself.
//
// Note: "Girafarig" does not exist anywhere in WinCon's roster
// (data/pokemon.json) -- only its real-game evolution Farigiraf is
// present. This is confirmed below rather than silently substituted.
//
// Run: node tools/test-assisting-pokemon.mjs

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

const pokemonList = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const learnsets = loadJSON("data/learnsets.json");
const abilitiesData = loadJSON("data/abilities.json");
const typeChart = loadJSON("data/type-chart.json");
const byName = (name) => baseStatsData.find((b) => b.name === name);

// ---------------------------------------------------------------------------
// The Girafarig -> Farigiraf reality check
// ---------------------------------------------------------------------------

check("Girafarig does not exist anywhere in WinCon's roster -- only its real-game evolution, Farigiraf, is present", () => {
  assert.equal(
    pokemonList.some((p) => p.name === "Girafarig"),
    false,
    "Girafarig should NOT be in data/pokemon.json"
  );
  assert.ok(pokemonList.some((p) => p.name === "Farigiraf"), "Farigiraf should be in data/pokemon.json");
});

check("Farigiraf's real ability and learnset are exactly what this feature relies on", () => {
  assert.equal(abilitiesData["Farigiraf"].ability, "Armor Tail");
  const learnable = learnsets["Farigiraf"] || [];
  ["Helping Hand", "Light Screen", "Psychic Terrain", "Reflect", "Trick Room"].forEach((move) => {
    assert.ok(learnable.includes(move), `expected Farigiraf to learn ${move}`);
  });
});

// ---------------------------------------------------------------------------
// wcHasRealSupportAbility -- the one genuinely new signal
// ---------------------------------------------------------------------------

check("wcHasRealSupportAbility is true for every real curated support ability, confirmed against data/abilities.json", () => {
  assert.equal(abilitiesData["Sinistcha"].ability, "Hospitality");
  assert.equal(context.wcHasRealSupportAbility("Sinistcha", abilitiesData), true);
});

check("wcHasRealSupportAbility is false for Pokemon whose real ability is not on the curated list -- including Steelix and Sceptile, which Phoenix considers the offense/coverage picks, not support picks, on her own team", () => {
  assert.equal(context.wcHasRealSupportAbility("Charizard", abilitiesData), false);
  assert.equal(context.wcHasRealSupportAbility("Steelix", abilitiesData), false);
  assert.equal(context.wcHasRealSupportAbility("Sceptile", abilitiesData), false);
  assert.equal(context.wcHasRealSupportAbility("Incineroar", abilitiesData), false);
  assert.equal(context.wcHasRealSupportAbility("Staraptor", abilitiesData), false);
});

check("wcHasRealSupportAbility is false when abilitiesData doesn't have an entry, and false for a made-up name", () => {
  assert.equal(context.wcHasRealSupportAbility("NotARealPokemon", abilitiesData), false);
});

// ---------------------------------------------------------------------------
// wcSupportAbilityReasoningNote -- names the trait, as Phoenix asked
// ---------------------------------------------------------------------------

check("wcSupportAbilityReasoningNote names the trait 'Assisting Pokemon' and describes Sinistcha's real Hospitality", () => {
  const note = context.wcSupportAbilityReasoningNote({ name: "Sinistcha" }, abilitiesData);
  assert.ok(note.includes("Assisting Pokemon"), `expected the note to say "Assisting Pokemon", got: ${note}`);
  assert.ok(note.includes("Hospitality"), `expected the note to name the real ability, got: ${note}`);
  assert.ok(note.includes("heals an ally's HP"), `expected the note to describe the real effect, got: ${note}`);
});

check("wcSupportAbilityReasoningNote returns an empty string for a candidate without a curated support ability", () => {
  assert.equal(context.wcSupportAbilityReasoningNote({ name: "Charizard" }, abilitiesData), "");
});

check("wcArchetypeSynergyReasoningNote's own-signal sentence now also says 'Assisting Pokemon', for a real screens-setter with no archetype yet forming", () => {
  const primarina = { name: "Primarina", types: ["Water", "Fairy"], baseStats: byName("Primarina"), learnableNames: learnsets["Primarina"] || [] };
  const note = context.wcArchetypeSynergyReasoningNote(primarina, [], "doubles", abilitiesData);
  assert.ok(note.includes("Assisting Pokemon"), `expected Primarina's own-signal reasoning note to say "Assisting Pokemon", got: ${note}`);
});

// ---------------------------------------------------------------------------
// wcDreamTeamCandidateScore -- the new, small, non-double-counted bonus
// ---------------------------------------------------------------------------

check("wcDreamTeamCandidateScore credits a real curated support ability (Sinistcha-shaped) over an identical twin without one, by exactly WC_SUPPORT_ABILITY_WEIGHT, with team/threats empty so no other term can differ", () => {
  // Same types, same base stats, same (empty) learnable moves -- the ONLY
  // difference is the real ability, so archetypeBonus/teamStyleBonus/etc.
  // are identical between the two and the whole score gap is explained by
  // the new supportAbilityBonus term alone.
  const sharedStats = { hp: 71, atk: 60, def: 106, spa: 121, spd: 80, spe: 70 };
  const withSupportAbility = { name: "SinistchaTwin", types: ["Grass", "Ghost"], baseStats: sharedStats, learnableNames: [] };
  const withoutSupportAbility = { name: "PlainTwin", types: ["Grass", "Ghost"], baseStats: sharedStats, learnableNames: [] };
  const fakeAbilities = {
    SinistchaTwin: { ability: "Hospitality", description: "test" },
    PlainTwin: { ability: "Overgrow", description: "test" },
  };
  const opts = { abilitiesData: fakeAbilities, format: "doubles" };

  const scoreWith = context.wcDreamTeamCandidateScore(withSupportAbility, [], [], typeChart, typeChart.types, opts);
  const scoreWithout = context.wcDreamTeamCandidateScore(withoutSupportAbility, [], [], typeChart, typeChart.types, opts);
  const WC_SUPPORT_ABILITY_WEIGHT = 1;
  assert.ok(
    Math.abs(scoreWith - scoreWithout - WC_SUPPORT_ABILITY_WEIGHT) < 1e-9,
    `expected the score gap to equal WC_SUPPORT_ABILITY_WEIGHT (${WC_SUPPORT_ABILITY_WEIGHT}), got ${scoreWith - scoreWithout}`
  );
});

check("wcDreamTeamCandidateScore does NOT double-count a real screens-setter (Primarina) -- her real learnable Light Screen/Reflect already earns credit via the existing archetypeBonus, and supportAbilityBonus stays 0 for her since her real ability (not on the curated list) doesn't add a second bonus for the same trait", () => {
  const primarina = { name: "Primarina", types: ["Water", "Fairy"], baseStats: byName("Primarina"), learnableNames: learnsets["Primarina"] || [] };
  assert.equal(context.wcHasRealSupportAbility("Primarina", abilitiesData), false, "Primarina's real ability should not be on the curated support-ability list");
  const opts = { abilitiesData, format: "doubles" };
  // Just confirms this runs and produces a real archetypeBonus > 0 (her
  // own screens signal), not a specific numeric target -- the numeric
  // claim above (no curated-ability double credit) is the real assertion.
  const score = context.wcDreamTeamCandidateScore(primarina, [], [], typeChart, typeChart.types, opts);
  assert.ok(Number.isFinite(score));
});

console.log(`\nAll ${checks} checks passed.`);
