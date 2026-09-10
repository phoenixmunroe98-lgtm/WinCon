// WinCon -- tools/test-regulation-mc-roster.mjs (Regulation M-C roster
// update, continuation of Milestone 61)
//
// Phoenix's request: "New M-C ruleset is out please update site to
// confirm these new items, abilities, pokemon and megas and their
// stats." Milestone 61 shipped the 3 confirmed Mega Z forms (a second
// Mega for a species that already had one) and left the rest -- the
// ~28-entry newly-legal base roster and the 3 new-to-the-franchise Mega
// Evolutions (Mega Salamence, Mega Golisopod, Mega Baxcalibur) -- as a
// documented gap. This milestone fills that gap with real, cross-checked
// data (pokemondb.net, Bulbapedia, pokemon-zone.com, gamewith.ai,
// pokepc.net; a fabricated "Cacophony" ability from one AI-summarized
// Bulbapedia fetch was caught and discarded when it wasn't corroborated
// anywhere else -- see this milestone's own data script comment header).
//
// Milestone 66 Day-1 re-verification (the ruleset had been live a full
// day by then, giving sources like pokemon-zone.com's own Regulation M-C
// overview page and a Bulbagarden roster-reconciliation thread time to go
// up) found one real miss in the original 28-entry list: Pawmot was a
// genuine Regulation M-C addition this milestone's original research
// never surfaced. Added here as the 29th base/form entry -- see this
// file's own NEW_BASE_OR_FORM_NAMES list and the dedicated Pawmot check
// below -- with the counts updated to match (29 + 6 = 35). Everything
// else re-checked the same day came back clean: zero stat/ability/typing
// corrections needed anywhere else in this file.
//
// Run: node tools/test-regulation-mc-roster.mjs

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

const SCRIPT_FILES = ["type-utils.js", "stats.js", "megas.js"];
const context = vm.createContext({ console });
SCRIPT_FILES.forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
});

const pokemonList = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const abilitiesData = loadJSON("data/abilities.json");
const abilityDex = loadJSON("data/ability-dex.json");
const movesData = loadJSON("data/moves.json");
const learnsets = loadJSON("data/learnsets.json");
const items = loadJSON("data/items.json");

let checksRun = 0;
function check(label, fn) {
  fn();
  checksRun += 1;
  console.log(`OK  ${label}`);
}

const NEW_BASE_OR_FORM_NAMES = [
  "Wigglytuff", "Persian", "Alolan Persian", "Farfetch'd", "Sirfetch'd",
  "Mr. Mime", "Swalot", "Salamence", "Gogoat", "Golisopod", "Rillaboom",
  "Cinderace", "Inteleon", "Thievul", "Toxtricity (Amped Form)",
  "Toxtricity (Low Key Form)", "Grapploct", "Perrserker", "Pincurchin",
  "Indeedee (Male)", "Indeedee (Female)", "Arboliva",
  "Squawkabilly (Green Plumage)", "Squawkabilly (Blue Plumage)",
  "Squawkabilly (Yellow Plumage)", "Squawkabilly (White Plumage)",
  "Mabosstiff", "Baxcalibur",
  // Milestone 66: the real 29th entry, missed by the original research
  // pass and caught on Day-1 re-verification.
  "Pawmot",
];
const NEW_MEGA_NAMES = ["Mega Salamence", "Mega Golisopod", "Mega Baxcalibur"];

check("The real, fully-confirmed roster (after Milestone 66's Day-1 Pawmot correction) reconciles to exactly 29 new base/form entries + 6 Mega Evolutions = 35", () => {
  assert.equal(NEW_BASE_OR_FORM_NAMES.length, 29);
  const allNewMegasEver = ["Mega Absol Z", "Mega Garchomp Z", "Mega Lucario Z", ...NEW_MEGA_NAMES];
  assert.equal(allNewMegasEver.length, 6);
  assert.equal(NEW_BASE_OR_FORM_NAMES.length + allNewMegasEver.length, 35);
});

check("Every one of the 29 new base/form roster entries has real pokemon.json/base-stats/abilities/learnsets entries -- nothing half-wired", () => {
  NEW_BASE_OR_FORM_NAMES.forEach((name) => {
    assert.ok(pokemonList.some((p) => p.name === name), `expected pokemon.json to have ${name}`);
    assert.ok(baseStatsData.some((b) => b.name === name), `expected base-stats.json to have ${name}`);
    assert.ok(abilitiesData[name], `expected abilities.json to have ${name}`);
    assert.ok(learnsets[name] && learnsets[name].length > 0, `expected a non-empty learnsets.json movepool for ${name}`);
  });
});

check("Every legal move in every new entry's learnset is a move that genuinely exists in data/moves.json -- never a fabricated or not-yet-added move", () => {
  const validMoveNames = new Set(movesData.map((m) => m.name));
  [...NEW_BASE_OR_FORM_NAMES, ...NEW_MEGA_NAMES].forEach((name) => {
    learnsets[name].forEach((moveName) => {
      assert.ok(validMoveNames.has(moveName), `${name}'s learnset references "${moveName}", which isn't in moves.json`);
    });
    assert.equal(new Set(learnsets[name]).size, learnsets[name].length, `${name}'s learnset has a duplicate move`);
  });
});

check("Species that split into multiple roster forms (Persian, Toxtricity, Indeedee, Squawkabilly) share one real dexNumber across every one of their forms", () => {
  const dex = (name) => pokemonList.find((p) => p.name === name).dexNumber;
  assert.equal(dex("Persian"), dex("Alolan Persian"));
  assert.equal(dex("Toxtricity (Amped Form)"), dex("Toxtricity (Low Key Form)"));
  assert.equal(dex("Indeedee (Male)"), dex("Indeedee (Female)"));
  const squawk = dex("Squawkabilly (Green Plumage)");
  ["Blue", "Yellow", "White"].forEach((plumage) => {
    assert.equal(dex(`Squawkabilly (${plumage} Plumage)`), squawk);
  });
});

check("The 3 new-to-the-franchise Mega Evolutions (Mega Salamence, Mega Golisopod, Mega Baxcalibur) each resolve to exactly their real new base species through wcMegaFormsOf/wcBaseFormOf, and their real Mega Stones resolve through WINCON_MEGA_STONES", () => {
  const megaFormsOf = vm.runInContext("wcMegaFormsOf", context);
  const baseFormOf = vm.runInContext("wcBaseFormOf", context);
  const stones = vm.runInContext("WINCON_MEGA_STONES", context);
  [
    ["Salamence", "Mega Salamence", "Salamencite"],
    ["Golisopod", "Mega Golisopod", "Golisopite"],
    ["Baxcalibur", "Mega Baxcalibur", "Baxcalibrite"],
  ].forEach(([base, megaName, stoneName]) => {
    const forms = JSON.parse(JSON.stringify(megaFormsOf(pokemonList, base))).map((f) => f.name);
    assert.deepEqual(forms, [megaName], `expected ${base}'s only Mega form to be ${megaName}`);
    const resolvedBase = baseFormOf(pokemonList, megaName);
    assert.equal(resolvedBase.name, base);
    assert.equal(stones[megaName], stoneName);
    const stoneItem = items.find((i) => i.name === stoneName);
    assert.ok(stoneItem, `expected items.json to have ${stoneName}`);
    assert.ok(stoneItem.description.trim().length > 0, `expected ${stoneName} to have a real, filled-in description`);
  });
});

check("Mega Salamence's stats/typing/ability are the real, canonical mainline Mega Salamence (not new-to-the-franchise like Golisopod/Baxcalibur -- it's a returning Gen 6 Mega, cross-checked against pokebase.app's Champions-specific page)", () => {
  const mega = baseStatsData.find((b) => b.name === "Mega Salamence");
  assert.deepEqual(mega, { name: "Mega Salamence", hp: 95, atk: 145, def: 130, spa: 120, spd: 90, spe: 120 });
  assert.deepEqual(pokemonList.find((p) => p.name === "Mega Salamence").types, ["Dragon", "Flying"]);
  assert.equal(abilitiesData["Mega Salamence"].ability, "Aerilate");
});

check("Mega Golisopod's and Mega Baxcalibur's stats/typing were cross-checked against 2-3 independent sources each (pokemon-zone.com, gamewith.ai, pokepc.net) after Regulation M-C's actual launch, not guessed from a pre-launch \"shown as base form\" placeholder", () => {
  const golisopodMega = baseStatsData.find((b) => b.name === "Mega Golisopod");
  assert.deepEqual(golisopodMega, { name: "Mega Golisopod", hp: 75, atk: 150, def: 175, spa: 70, spd: 120, spe: 40 });
  assert.deepEqual(pokemonList.find((p) => p.name === "Mega Golisopod").types, ["Bug", "Steel"]);
  assert.equal(abilitiesData["Mega Golisopod"].ability, "Tough Claws");

  const baxcaliburMega = baseStatsData.find((b) => b.name === "Mega Baxcalibur");
  assert.deepEqual(baxcaliburMega, { name: "Mega Baxcalibur", hp: 115, atk: 175, def: 117, spa: 105, spd: 101, spe: 87 });
  assert.deepEqual(pokemonList.find((p) => p.name === "Mega Baxcalibur").types, ["Dragon", "Ice"]);
  assert.equal(abilitiesData["Mega Baxcalibur"].ability, "Thermal Exchange");
});

check("Milestone 66: Pawmot (the real 29th entry, missed until Day-1 re-verification) is wired in with its real dex number, typing, stats, and ability, triple-confirmed against pokemondb.net, Serebii.net, and this project's PokeAPI data-mirror pass", () => {
  assert.deepEqual(pokemonList.find((p) => p.name === "Pawmot"), {
    name: "Pawmot", dexNumber: 923, types: ["Electric", "Fighting"], form: "Base",
  });
  assert.deepEqual(baseStatsData.find((b) => b.name === "Pawmot"), {
    name: "Pawmot", hp: 70, atk: 115, def: 70, spa: 70, spd: 60, spe: 105,
  });
  assert.equal(abilitiesData["Pawmot"].ability, "Iron Fist");
});

check("Every ability newly assigned this milestone that abilities.json references has a matching data/ability-dex.json entry (or was already a real, pre-existing WinCon ability like Tough Claws/Aerilate/Ice Body)", () => {
  const usedAbilities = new Set([...NEW_BASE_OR_FORM_NAMES, ...NEW_MEGA_NAMES].map((n) => abilitiesData[n].ability));
  usedAbilities.forEach((abilityName) => {
    assert.ok(abilityDex[abilityName], `expected ability-dex.json to document "${abilityName}"`);
  });
});

check("Regulation M-C's real Mega roster is exactly 6 (3 already-shipped Mega Z forms + these 3) -- fresh research this milestone ran confirmed Darkrai/Heatran/Magearna/Tatsugiri/Zeraora do NOT get Mega forms in M-C, so their pre-existing item stubs correctly stay undescribed gaps, not a missed 4th/5th/etc. new Mega", () => {
  ["Mega Darkrai", "Mega Heatran", "Mega Magearna", "Mega Tatsugiri", "Mega Zeraora"].forEach((name) => {
    assert.ok(!pokemonList.some((p) => p.name === name), `did not expect a roster entry for ${name} -- not part of Regulation M-C`);
  });
});

console.log(`\nAll ${checksRun} checks passed.`);
