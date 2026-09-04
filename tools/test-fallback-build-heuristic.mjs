// WinCon — tools/test-fallback-build-heuristic.mjs
//
// Regression/behavior test for the beta-tester fix to wcPickNature/
// wcPickSP (strategy.js): the "bulky" role used to ALWAYS pick an
// offense-boosting Nature (Adamant/Modest) and dump Stat Points into
// offense + whichever defense was numerically weaker, regardless of
// whether this Pokemon's offense was actually any good -- exactly
// backwards for a support/wall-style Pokemon (the tester's own
// "Incineroar adamant... not a good set" example). The fix: only go
// offensive when the primary offense stat actually outclasses this
// Pokemon's own bulk (Math.max(def, spd)); otherwise go fully
// defensive, and Nature/Stat Points always agree on which branch was
// taken (never a mismatched pair -- the tester's other example,
// "Gholdengo 32 spa 32 SpD modest").
//
// Run: node tools/test-fallback-build-heuristic.mjs

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

function spTotal(sp) {
  return Object.values(sp).reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Fast role: unchanged from before this fix (regression guard).
// ---------------------------------------------------------------------------

check("fast role still gets max offense + max Speed, Jolly/Timid, regardless of bulk", () => {
  // A fast physical attacker with mediocre bulk either way.
  const baseStats = { hp: 70, atk: 110, def: 60, spa: 50, spd: 60, spe: 100 };
  const nature = context.wcPickNature("attack", "fast", baseStats);
  const sp = context.wcPickSP("attack", "fast", baseStats);
  assert.equal(nature, "Jolly");
  assert.deepEqual(JSON.parse(JSON.stringify(sp)), { hp: 2, attack: 32, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 });
});

// ---------------------------------------------------------------------------
// Bulky role, offense clearly better than bulk -- stays offensive, but SP
// now maxes HP (not a bare defensive stat) alongside offense.
// ---------------------------------------------------------------------------

check("bulky role with offense clearly beating bulk stays offensive (Adamant) with HP + offense SP", () => {
  // Kingambit-shaped: Atk 135 clearly beats max(Def 120, SpD 85).
  const baseStats = { hp: 100, atk: 135, def: 120, spa: 60, spd: 85, spe: 50 };
  const nature = context.wcPickNature("attack", "bulky", baseStats);
  const sp = context.wcPickSP("attack", "bulky", baseStats);
  assert.equal(nature, "Adamant");
  assert.equal(sp.hp, 32);
  assert.equal(sp.attack, 32);
  assert.equal(spTotal(sp), 66);
});

check("bulky role with special offense clearly beating bulk stays offensive (Modest)", () => {
  const baseStats = { hp: 120, atk: 90, def: 70, spa: 110, spd: 70, spe: 60 };
  const nature = context.wcPickNature("sp_attack", "bulky", baseStats);
  const sp = context.wcPickSP("sp_attack", "bulky", baseStats);
  assert.equal(nature, "Modest");
  assert.equal(sp.hp, 32);
  assert.equal(sp.sp_attack, 32);
  assert.equal(spTotal(sp), 66);
});

// ---------------------------------------------------------------------------
// Bulky role, offense weaker than bulk -- the exact bug the beta tester
// hit (Incineroar/Gholdengo). Nature and SP must now AGREE and both go
// defensive, never a mismatched offensive-Nature/defensive-SP pair.
// ---------------------------------------------------------------------------

check("bulky role with offense weaker than bulk goes defensive (Careful/Impish) with matching HP + defense SP, not the old offensive default", () => {
  // A genuine wall: Atk 80 is well below max(Def 110, SpD 95) -- no
  // business running an offensive spread.
  const baseStats = { hp: 100, atk: 80, def: 110, spa: 60, spd: 95, spe: 60 };
  const nature = context.wcPickNature("attack", "bulky", baseStats);
  const sp = context.wcPickSP("attack", "bulky", baseStats);
  assert.notEqual(nature, "Adamant", "must not still hand out the old offensive default");
  assert.ok(["Impish", "Careful"].includes(nature), `expected a defensive Nature, got ${nature}`);
  assert.equal(sp.hp, 32, "must invest HP, not offense, as the first 32");
  assert.equal(sp.attack, 0, "must not dump 32 into a weak offense stat anymore");
  assert.equal(spTotal(sp), 66);
});

check("Nature and Stat Points never disagree on offensive-vs-defensive branch (the exact Gholdengo-style bug)", () => {
  // A special attacker whose SpA does NOT clearly outclass its bulk.
  const baseStats = { hp: 87, atk: 62, def: 65, spa: 133, spd: 91, spe: 84 };
  // SpA 133 > max(65, 91) = 91, so this one SHOULD be offensive --
  // sanity-check the boundary case is handled the same both ways below.
  const offensiveNature = context.wcPickNature("sp_attack", "bulky", baseStats);
  const offensiveSp = context.wcPickSP("sp_attack", "bulky", baseStats);
  assert.equal(offensiveNature, "Modest");
  assert.equal(offensiveSp.sp_attack, 32);

  // Now a genuinely bulk-favoring case: SpA no longer clearly ahead.
  const defensiveBaseStats = { hp: 87, atk: 62, def: 65, spa: 80, spd: 130, spe: 84 };
  const defensiveNature = context.wcPickNature("sp_attack", "bulky", defensiveBaseStats);
  const defensiveSp = context.wcPickSP("sp_attack", "bulky", defensiveBaseStats);
  assert.ok(["Calm", "Bold"].includes(defensiveNature), `expected a defensive Nature, got ${defensiveNature}`);
  assert.equal(defensiveSp.sp_attack, 0, "an offensive Nature-less defensive branch must not still max the offense stat");
  assert.equal(defensiveSp.hp, 32);
});

check("defensive branch lowers the SECONDARY offense stat via Nature, never the primary one this Pokemon is built around", () => {
  // Primary offense is Attack (115 > 80), and bulk (SpD 130) clearly wins.
  const baseStats = { hp: 95, atk: 115, def: 70, spa: 80, spd: 130, spe: 60 };
  const nature = context.wcPickNature("attack", "bulky", baseStats);
  // Calm lowers Atk (wrong -- would cripple the primary offense) while
  // Careful lowers SpA (correct -- primary offense, Attack, stays intact).
  assert.equal(nature, "Careful", "must lower the secondary (SpA) stat, not the primary Attack stat, via Nature");
});

console.log("");
console.log(`All ${checks} fallback-build-heuristic checks passed.`);
