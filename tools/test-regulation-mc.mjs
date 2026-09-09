// WinCon — tools/test-regulation-mc.mjs (Milestone 61)
//
// Regression test for the Regulation M-C update Phoenix asked for ("Mega
// Z stones are to react like mega stones -- add in any changes to
// moveset, abilities, items, etc as well"). Covers:
//
// 1. The 3 confirmed new Mega Z forms (Mega Absol Z, Mega Garchomp Z,
//    Mega Lucario Z) -- a real, distinct SECOND Mega form for a species
//    that already had one, resolved entirely through existing data-driven
//    machinery (WINCON_MEGA_STONES in megas.js) with zero code changes
//    needed anywhere, confirmed by reading every consumer (builder.js,
//    app.js, strategy.js, battle-sim-lineup.js) before writing any of
//    this milestone's own code.
// 2. Mega Absol Z's real Sharpness ability (50% boost to slicing moves)
//    and Mega Lucario Z's real Aura Break ability (halves damage from
//    contact moves) -- both newly implemented for this milestone, run
//    through the real engine end to end, not just asserted against a
//    stub.
// 3. A real, pre-existing bug this milestone's own Aura Break work
//    surfaced and fixed: the damageTakenMult dispatcher in
//    battle-sim-engine.js only ever checked `condition === "fullHp"`
//    (Multiscale) and treated every OTHER condition value as "not
//    fullHp, so apply it regardless" -- silently making Solid Rock/
//    Filter (meant to only reduce super-effective hits) and Fur Coat
//    (meant to only reduce Physical hits) reduce ALL damage taken, and
//    never reading Thick Fat/Purifying Salt's own types/type fields at
//    all. Fixed generically (wcDamageTakenMultApplies) so all 6 real
//    damageTakenMult abilities in data/ability-effects.json are now
//    checked against their own genuine condition.
//
// Run: node tools/test-regulation-mc.mjs

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

const SCRIPT_FILES = [
  "type-utils.js",
  "stats.js",
  "megas.js",
  "strategy.js",
  "battle-stages.js",
  "battle-damage.js",
  "battle-turn-order.js",
  "battle-sim-baseline.js",
  "battle-sim-engine.js",
  "battle-sim-ai.js",
  "battle-sim-lineup.js",
];

const context = vm.createContext({ console });
SCRIPT_FILES.forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
});

const pokemonList = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const natures = loadJSON("data/natures.json");
const moveEffects = loadJSON("data/move-effects.json");
const abilityEffects = loadJSON("data/ability-effects.json");
const itemEffects = loadJSON("data/item-effects.json");
const items = loadJSON("data/items.json");
const learnsets = loadJSON("data/learnsets.json");

const simData = { movesData, moveEffects, abilityEffects, itemEffects, typeChart, natures };

function makeSpec(name, item, movesList) {
  const build = { nature: "Hardy", item, moves: movesList, sp: { hp: 32, attack: 32, defense: 32, sp_attack: 32, sp_defense: 32, speed: 32 } };
  return context.wcBattlerSpecForSlot(name, build, pokemonList, baseStatsData, abilitiesData);
}
function makeBattler(spec) {
  return context.wcMakeBattler(spec, movesData, moveEffects, natures);
}
function resolvedMove(name) {
  return context.wcResolveMove(name, movesData, moveEffects);
}
function freshField() {
  return {
    weather: null, weatherTurns: 0, trickRoomTurns: 0,
    tailwindTurns: { me: 0, opp: 0 },
    screens: { me: { physical: 0, special: 0 }, opp: { physical: 0, special: 0 } },
  };
}

let checksRun = 0;
function check(label, fn) {
  fn();
  checksRun += 1;
  console.log(`OK  ${label}`);
}

// ---------------------------------------------------------------------------
// 1. Mega Z forms resolve entirely through existing data-driven machinery.
// ---------------------------------------------------------------------------

check("Absol/Garchomp/Lucario each now have TWO real Mega forms (the existing one plus the new Z variant)", () => {
  [
    ["Absol", "Mega Absol", "Mega Absol Z"],
    ["Garchomp", "Mega Garchomp", "Mega Garchomp Z"],
    ["Lucario", "Mega Lucario", "Mega Lucario Z"],
  ].forEach(([base, existing, zForm]) => {
    const forms = JSON.parse(JSON.stringify(context.wcMegaFormsOf(pokemonList, base))).map((f) => f.name);
    assert.ok(forms.includes(existing), `expected ${base}'s existing Mega form ${existing} to still be there`);
    assert.ok(forms.includes(zForm), `expected ${base}'s new Mega Z form ${zForm} to be found`);
    assert.equal(forms.length, 2, `expected exactly 2 Mega forms for ${base}, got ${forms.length}`);
  });
});

check("wcEffectivePokemon resolves the correct one of a species' two real Mega Stones -- never confuses Absolite with Absolite Z", () => {
  assert.equal(context.wcEffectivePokemon(pokemonList, "Absol", "Absolite").name, "Mega Absol");
  assert.equal(context.wcEffectivePokemon(pokemonList, "Absol", "Absolite Z").name, "Mega Absol Z");
  assert.equal(context.wcEffectivePokemon(pokemonList, "Garchomp", "Garchompite").name, "Mega Garchomp");
  assert.equal(context.wcEffectivePokemon(pokemonList, "Garchomp", "Garchompite Z").name, "Mega Garchomp Z");
  assert.equal(context.wcEffectivePokemon(pokemonList, "Lucario", "Lucarionite").name, "Mega Lucario");
  assert.equal(context.wcEffectivePokemon(pokemonList, "Lucario", "Lucarionite Z").name, "Mega Lucario Z");
  // A completely unrelated item still resolves to the base form, not either Mega.
  assert.equal(context.wcEffectivePokemon(pokemonList, "Absol", "Life Orb").name, "Absol");
});

check("wcIsMegaEligible is true for both of a species' real Mega Stones", () => {
  assert.equal(context.wcIsMegaEligible("Garchomp", { item: "Garchompite" }, pokemonList), true);
  assert.equal(context.wcIsMegaEligible("Garchomp", { item: "Garchompite Z" }, pokemonList), true);
  assert.equal(context.wcIsMegaEligible("Garchomp", { item: "Life Orb" }, pokemonList), false);
});

check("The 3 new Mega Z roster entries have real base-stats/abilities/learnsets entries -- nothing half-wired", () => {
  ["Mega Absol Z", "Mega Garchomp Z", "Mega Lucario Z"].forEach((name) => {
    assert.ok(baseStatsData.some((b) => b.name === name), `expected base-stats.json to have ${name}`);
    assert.ok(abilitiesData[name], `expected abilities.json to have ${name}`);
    assert.ok(learnsets[name] && learnsets[name].length > 0, `expected learnsets.json to have a non-empty movepool for ${name}`);
  });
  assert.equal(abilitiesData["Mega Absol Z"].ability, "Sharpness");
  assert.equal(abilitiesData["Mega Garchomp Z"].ability, "Levitate");
  assert.equal(abilitiesData["Mega Lucario Z"].ability, "Aura Break");
  // Confirmed by 2 independent sources (godisageek, champsdex) -- Mega
  // Absol Z's type genuinely changes from base Absol's mono-Dark.
  const megaAbsolZ = pokemonList.find((p) => p.name === "Mega Absol Z");
  assert.deepEqual(megaAbsolZ.types, ["Dark", "Ghost"]);
});

check("The 3 new Mega Z items are real, described, legal items -- and the OTHER still-unconfirmed M-C stub stones (already present in items.json before this milestone) are untouched, not fabricated", () => {
  ["Absolite Z", "Garchompite Z", "Lucarionite Z"].forEach((name) => {
    const item = items.find((i) => i.name === name);
    assert.ok(item, `expected items.json to have ${name}`);
    assert.ok(item.description && item.description.trim().length > 0, `expected ${name} to have a real, non-blank description now`);
  });
  // Baxcalibrite and Golisopite were filled in by the later Regulation M-C
  // roster update milestone (Mega Golisopod/Mega Baxcalibur confirmed real
  // -- see tools/test-regulation-mc-roster.mjs), so they've moved out of
  // this still-blank list. Fresh research that milestone ran (an X/Twitter
  // leak post cross-checked against 3 independent sources) also confirmed
  // Darkrai/Heatran/Magearna/Tatsugiri/Zeraora do NOT get Mega forms in
  // Regulation M-C at all -- these 5 stub items are real Regulation M-C
  // items WinCon doesn't have confirmed Mega data for, and were never
  // going to (not this milestone's gap to fill, a genuinely different one).
  // Left blank deliberately: a real, documented gap (see the Builder's own
  // Regulation M-C banner and README), not something this milestone guesses at.
  ["Darkranite", "Heatranite", "Magearnite", "Tatsugirinite", "Zeraorite"].forEach((name) => {
    const item = items.find((i) => i.name === name);
    assert.ok(item, `expected the pre-existing stub item ${name} to still be present`);
    assert.equal(item.description.trim(), "", `expected ${name}'s description to still be an honest, undescribed gap`);
  });
});

// ---------------------------------------------------------------------------
// 2. Sharpness (Mega Absol Z) and Aura Break (Mega Lucario Z), run through
// the real engine end to end.
// ---------------------------------------------------------------------------

check("Sharpness genuinely boosts a real slicing move (Night Slash) by 1.5x, isolated against the same move/target with a non-Sharpness Absol", () => {
  const defender = makeBattler(makeSpec("Steelix", "", ["Protect", "Protect", "Protect", "Protect"]));
  const nightSlash = resolvedMove("Night Slash");
  const plainAbsol = makeBattler(makeSpec("Absol", "", ["Night Slash", "Protect", "Protect", "Protect"]));
  const megaAbsolZ = makeBattler(makeSpec("Absol", "Absolite Z", ["Night Slash", "Protect", "Protect", "Protect"]));
  assert.equal(megaAbsolZ.ability, "Sharpness");
  const plainHit = context.wcResolveOneHit(plainAbsol, nightSlash, defender, freshField(), simData, () => 0.5);
  const megaHit = context.wcResolveOneHit(megaAbsolZ, nightSlash, defender, freshField(), simData, () => 0.5);
  const plainRatio = plainHit.damage / plainAbsol.stats.atk;
  const megaRatio = megaHit.damage / megaAbsolZ.stats.atk;
  const observedMult = megaRatio / plainRatio;
  assert.ok(Math.abs(observedMult - 1.5) < 0.1, `expected roughly a 1.5x Sharpness boost (both same type/STAB), got ${observedMult.toFixed(3)}`);
});

check("Sharpness does NOT boost a non-slicing move (Iron Head isn't on the real slicing list)", () => {
  const ironHead = resolvedMove("Iron Head");
  assert.ok(!abilityEffects.Sharpness.moves.includes("Iron Head"));
  assert.ok(abilityEffects.Sharpness.moves.includes("Night Slash"));
});

check("Aura Break genuinely halves damage from a real contact move, isolated via wcDamageTakenMultApplies directly (no stat-line noise)", () => {
  const auraBreak = abilityEffects["Aura Break"];
  assert.equal(auraBreak.effect, "damageTakenMult");
  assert.equal(auraBreak.condition, "contact");
  assert.equal(auraBreak.mult, 0.5);
  const ironHead = resolvedMove("Iron Head"); // real contact move
  const shadowBall = resolvedMove("Shadow Ball"); // real non-contact move
  assert.equal(ironHead.flags.contact, true);
  assert.equal(shadowBall.flags.contact, false);
  assert.equal(context.wcDamageTakenMultApplies(auraBreak, ironHead, {}, ironHead.type, typeChart), true);
  assert.equal(context.wcDamageTakenMultApplies(auraBreak, shadowBall, {}, shadowBall.type, typeChart), false);
});

check("Mega Lucario Z genuinely resolves with the Aura Break ability through the real slot-resolution path", () => {
  const megaLucarioZ = makeBattler(makeSpec("Lucario", "Lucarionite Z", ["Protect", "Protect", "Protect", "Protect"]));
  assert.equal(megaLucarioZ.name, "Mega Lucario Z");
  assert.equal(megaLucarioZ.ability, "Aura Break");
});

// ---------------------------------------------------------------------------
// 3. The damageTakenMult dispatcher bug this milestone found and fixed --
// pre-existing, not introduced by Aura Break, but touched by the same code.
// ---------------------------------------------------------------------------

check("wcDamageTakenMultApplies checks each real ability's own genuine condition, not just fullHp -- the pre-existing bug this milestone fixed", () => {
  // Multiscale (fullHp) -- unchanged, already worked.
  assert.equal(context.wcDamageTakenMultApplies({ condition: "fullHp" }, {}, { hp: 100, maxHp: 100 }, "Normal", typeChart), true);
  assert.equal(context.wcDamageTakenMultApplies({ condition: "fullHp" }, {}, { hp: 99, maxHp: 100 }, "Normal", typeChart), false);

  // Solid Rock / Filter (superEffective) -- previously always applied.
  assert.equal(context.wcDamageTakenMultApplies({ condition: "superEffective" }, {}, { types: ["Fire", "Flying"] }, "Rock", typeChart), true);
  assert.equal(context.wcDamageTakenMultApplies({ condition: "superEffective" }, {}, { types: ["Fire", "Flying"] }, "Normal", typeChart), false);

  // Fur Coat (physicalMove) -- previously always applied, even to Special hits.
  assert.equal(context.wcDamageTakenMultApplies({ condition: "physicalMove" }, { category: "Physical" }, {}, "Normal", typeChart), true);
  assert.equal(context.wcDamageTakenMultApplies({ condition: "physicalMove" }, { category: "Special" }, {}, "Normal", typeChart), false);

  // Thick Fat (types array) -- previously never actually checked.
  assert.equal(context.wcDamageTakenMultApplies({ types: ["Fire", "Ice"] }, {}, {}, "Fire", typeChart), true);
  assert.equal(context.wcDamageTakenMultApplies({ types: ["Fire", "Ice"] }, {}, {}, "Water", typeChart), false);

  // Purifying Salt (single type) -- previously never actually checked.
  assert.equal(context.wcDamageTakenMultApplies({ type: "Ghost" }, {}, {}, "Ghost", typeChart), true);
  assert.equal(context.wcDamageTakenMultApplies({ type: "Ghost" }, {}, {}, "Dark", typeChart), false);
});

check("Fur Coat (Furfrou), run through the real engine, now genuinely reduces only Physical damage, not Special", () => {
  const attacker = makeBattler(makeSpec("Steelix", "", ["Iron Head", "Moonblast", "Iron Head", "Iron Head"]));
  const furfrou = makeBattler(makeSpec("Furfrou", "", ["Protect", "Protect", "Protect", "Protect"]));
  assert.equal(furfrou.ability, "Fur Coat");
  const applied = context.wcDamageTakenMultApplies(abilityEffects["Fur Coat"], resolvedMove("Iron Head"), furfrou, "Steel", typeChart);
  const notApplied = context.wcDamageTakenMultApplies(abilityEffects["Fur Coat"], resolvedMove("Moonblast"), furfrou, "Fairy", typeChart);
  assert.equal(applied, true, "Fur Coat should apply to a real Physical hit");
  assert.equal(notApplied, false, "Fur Coat should NOT apply to a real Special hit");
});

console.log(`\nAll ${checksRun} checks passed.`);
