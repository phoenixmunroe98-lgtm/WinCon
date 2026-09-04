// WinCon — tools/test-locked-amendment-preview.mjs
//
// Regression test for wcApplyAmendmentToFields (strategy.js), the pure
// merge function behind the "show any amendments that are recommended as
// a change of view (similar to the mega function)" half of the locked-
// builds feature. builder.js's applyAmendmentsToBuilds never lets an
// Auto-build-strategy amendment touch a LOCKED species' real nature/sp/
// moves directly -- instead it overlays the amendment onto a preview
// (build.recommendedBuild) using this function, so the change shows up
// as a togglable "Current / Recommended" pill instead of silently
// applying. This is the one piece of that arbitration that's pure/DOM-
// free and can be unit-tested directly.
//
// Run: node tools/test-locked-amendment-preview.mjs

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

const ORIGINAL_FIELDS = {
  nature: "Bold",
  sp: { hp: 4, attack: 0, defense: 66, sp_attack: 0, sp_defense: 66, speed: 0 },
  moves: ["Trick Room", "Scald", "Slack Off", "Iron Defense"],
};

check("a moves-only amendment overlays exactly one slot, leaving nature/sp/every other move untouched", () => {
  const amendment = { pokemon: "Slowbro", moves: { slotIndex: 2, from: "Slack Off", to: "Yawn" } };
  const result = context.wcApplyAmendmentToFields(ORIGINAL_FIELDS, amendment);
  assert.equal(result.nature, ORIGINAL_FIELDS.nature);
  assert.deepEqual(JSON.parse(JSON.stringify(result.sp)), ORIGINAL_FIELDS.sp);
  assert.deepEqual(JSON.parse(JSON.stringify(result.moves)), ["Trick Room", "Scald", "Yawn", "Iron Defense"]);
});

check("a role amendment overlays nature+sp together, leaving moves untouched", () => {
  const newSp = { hp: 4, attack: 0, defense: 0, sp_attack: 0, sp_defense: 4, speed: 128 };
  const amendment = {
    pokemon: "Slowbro",
    role: { from: "bulky", to: "fast", natureFrom: "Bold", natureTo: "Timid", spFrom: ORIGINAL_FIELDS.sp, spTo: newSp },
  };
  const result = context.wcApplyAmendmentToFields(ORIGINAL_FIELDS, amendment);
  assert.equal(result.nature, "Timid");
  assert.deepEqual(JSON.parse(JSON.stringify(result.sp)), newSp);
  assert.deepEqual(JSON.parse(JSON.stringify(result.moves)), ORIGINAL_FIELDS.moves);
});

check("a combined moves+role amendment overlays both at once", () => {
  const newSp = { hp: 4, attack: 0, defense: 0, sp_attack: 0, sp_defense: 4, speed: 128 };
  const amendment = {
    pokemon: "Slowbro",
    moves: { slotIndex: 0, from: "Trick Room", to: "Psychic" },
    role: { from: "bulky", to: "fast", natureFrom: "Bold", natureTo: "Timid", spFrom: ORIGINAL_FIELDS.sp, spTo: newSp },
  };
  const result = context.wcApplyAmendmentToFields(ORIGINAL_FIELDS, amendment);
  assert.equal(result.nature, "Timid");
  assert.deepEqual(JSON.parse(JSON.stringify(result.sp)), newSp);
  assert.deepEqual(JSON.parse(JSON.stringify(result.moves)), ["Psychic", "Scald", "Slack Off", "Iron Defense"]);
});

check("wcApplyAmendmentToFields never mutates its input fields object", () => {
  const original = JSON.parse(JSON.stringify(ORIGINAL_FIELDS));
  context.wcApplyAmendmentToFields(ORIGINAL_FIELDS, { pokemon: "Slowbro", moves: { slotIndex: 1, from: "Scald", to: "Ice Beam" } });
  assert.deepEqual(JSON.parse(JSON.stringify(ORIGINAL_FIELDS)), original, "the input triple must come back unchanged -- callers rely on this to safely chain amendments");
});

check("two sequential amendments compose correctly when the second call's input is the first call's output", () => {
  const first = context.wcApplyAmendmentToFields(ORIGINAL_FIELDS, { pokemon: "Slowbro", moves: { slotIndex: 3, from: "Iron Defense", to: "Amnesia" } });
  const second = context.wcApplyAmendmentToFields(first, { pokemon: "Slowbro", moves: { slotIndex: 1, from: "Scald", to: "Ice Beam" } });
  assert.deepEqual(JSON.parse(JSON.stringify(second.moves)), ["Trick Room", "Ice Beam", "Slack Off", "Amnesia"]);
  assert.equal(second.nature, ORIGINAL_FIELDS.nature);
  assert.deepEqual(JSON.parse(JSON.stringify(second.sp)), ORIGINAL_FIELDS.sp);
});

console.log("");
console.log(`All ${checks} locked-amendment-preview checks passed.`);
