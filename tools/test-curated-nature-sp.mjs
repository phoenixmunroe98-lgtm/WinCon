// WinCon — tools/test-curated-nature-sp.mjs
//
// Regression test for the beta-tester fix: WINCON_META_KNOWN_SETS entries
// now carry real nature/sp fields (strategy.js), and wcGenerateBuild must
// actually use them -- verbatim -- instead of silently falling through to
// wcPickNature/wcPickSP the way it always did before (the exact bug behind
// "Incineroar adamant full 32HP and 32 ATK... not a good set": Incineroar's
// moves/item WERE curated, but its Nature/Stat Points were not, so it fell
// through anyway).
//
// Run: node tools/test-curated-nature-sp.mjs

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

function statsFor(name) {
  return baseStatsData.find((b) => b.name === name);
}

// Hardcoded from strategy.js's own WINCON_META_KNOWN_SETS (const, so not
// readable off the vm context -- see the codebase's established
// convention for this exact vm gotcha).
const INCINEROAR_NATURE = "Careful";
const INCINEROAR_SP = { hp: 32, attack: 0, defense: 2, sp_attack: 0, sp_defense: 32, speed: 0 };
const KINGAMBIT_NATURE = "Adamant";
const KINGAMBIT_SP = { hp: 32, attack: 32, defense: 0, sp_attack: 0, sp_defense: 2, speed: 0 };

check("wcGenerateBuild uses Incineroar's curated Nature verbatim (the tester's own broken example, fixed)", () => {
  const build = context.wcGenerateBuild(
    { name: "Incineroar", types: ["Fire", "Dark"] },
    statsFor("Incineroar"),
    learnsets["Incineroar"],
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData }
  );
  assert.equal(build.nature, INCINEROAR_NATURE, "Incineroar must no longer get the generic Adamant offensive Nature");
});

check("wcGenerateBuild uses Incineroar's curated Stat Points verbatim", () => {
  const build = context.wcGenerateBuild(
    { name: "Incineroar", types: ["Fire", "Dark"] },
    statsFor("Incineroar"),
    learnsets["Incineroar"],
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(build.sp)), INCINEROAR_SP);
});

check("wcGenerateBuild uses Kingambit's curated Nature/Stat Points verbatim (an offense-leaning curated set)", () => {
  const build = context.wcGenerateBuild(
    { name: "Kingambit", types: ["Dark", "Steel"] },
    statsFor("Kingambit"),
    learnsets["Kingambit"],
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData }
  );
  assert.equal(build.nature, KINGAMBIT_NATURE);
  assert.deepEqual(JSON.parse(JSON.stringify(build.sp)), KINGAMBIT_SP);
});

check("a locked build's nature/sp still wins over a curated set's nature/sp (Locked Builds outranks curation)", () => {
  const lockedBuild = { nature: "Bold", sp: { hp: 4, attack: 0, defense: 66, sp_attack: 0, sp_defense: 66, speed: 0 }, moves: ["Fake Out", "Parting Shot", "Flare Blitz", "Throat Chop"] };
  const build = context.wcGenerateBuild(
    { name: "Incineroar", types: ["Fire", "Dark"] },
    statsFor("Incineroar"),
    learnsets["Incineroar"],
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData, lockedBuild }
  );
  assert.equal(build.nature, "Bold");
  assert.notEqual(build.nature, INCINEROAR_NATURE);
});

check("a non-curated species is unaffected and still runs through the fallback heuristic", () => {
  const build = context.wcGenerateBuild(
    { name: "Slowbro", types: ["Water", "Psychic"] },
    statsFor("Slowbro"),
    learnsets["Slowbro"],
    movesData,
    [],
    typeChart,
    { format: "doubles", usedItems: new Set(), abilitiesData }
  );
  assert.ok(build.nature, "Slowbro should still get SOME Nature from the fallback heuristic");
  assert.equal(Object.values(build.sp).reduce((a, b) => a + b, 0), 66);
});

const MEGA_CHARIZARD_Y_SP = { hp: 2, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 32 };

check("a curated Mega form's OWN Stat Points (tuned against its own base stats) apply verbatim when a base Pokemon auto-opts into it", () => {
  const mCharBaseStats = statsFor("Mega Charizard Y");
  const build = context.wcGenerateBuild(
    { name: "Charizard", types: ["Fire", "Flying"] },
    statsFor("Charizard"),
    learnsets["Charizard"],
    movesData,
    [],
    typeChart,
    {
      format: "doubles",
      usedItems: new Set(),
      abilitiesData,
      megaForms: [{ name: "Mega Charizard Y", types: ["Fire", "Flying"], baseStats: mCharBaseStats }],
    }
  );
  assert.equal(build.item, "Charizardite Y", "expected the auto-mega branch to actually fire for this test to be meaningful");
  // Unlike a locked build (which is base-species-keyed and guarded by
  // isBaseForm), WINCON_META_KNOWN_SETS["Mega Charizard Y"]'s own sp was
  // curated against Mega Charizard Y's real base stats directly, so it's
  // correct to force it onto this auto-opted slot verbatim -- no
  // freshly-picked fallback needed or wanted here.
  assert.deepEqual(JSON.parse(JSON.stringify(build.sp)), MEGA_CHARIZARD_Y_SP);
});

console.log("");
console.log(`All ${checks} curated-nature-sp checks passed.`);
