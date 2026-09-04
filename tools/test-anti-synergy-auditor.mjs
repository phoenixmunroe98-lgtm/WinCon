// WinCon — tools/test-anti-synergy-auditor.mjs
//
// Milestone 38: Phoenix's Steelix/Wide-Guard doc explicitly asked to
// "identify hidden anti-synergies" -- this tests wcAntiSynergyWarnings,
// the first real version of that. Two real, current, well-understood VGC
// conflicts, hand-picked and not exhaustive (same honesty note
// WINCON_SPREAD_MOVES already carries):
//   (a) a teammate's own Sandstorm (Sand Stream) chipping a same-team
//       Focus Sash holder that isn't Rock/Ground/Steel-typed, before the
//       Sash is ever needed.
//   (b) a teammate holding Choice Scarf while another teammate's REAL
//       build runs Trick Room -- Scarf's Speed boost works directly
//       against Trick Room's reversed turn order for that Pokemon.
//
// Run: node tools/test-anti-synergy-auditor.mjs

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

const abilitiesData = loadJSON("data/abilities.json");

// Real fixtures: Tyranitar's real ability is Sand Stream; Whimsicott
// (Grass/Fairy, not Rock/Ground/Steel) is a clean "vulnerable to sand
// chip" Sash holder; a synthetic Rock/Ground/Steel-typed Sash holder is
// used to confirm immune typing silences the warning. Slowbro really
// learns Trick Room.
const TYRANITAR = { name: "Tyranitar", types: ["Rock", "Dark"] };
const WHIMSICOTT = { name: "Whimsicott", types: ["Grass", "Fairy"] };
const STEELIX = { name: "Steelix", types: ["Steel", "Ground"] };
const SLOWBRO = { name: "Slowbro", types: ["Water", "Psychic"] };
const KINGAMBIT = { name: "Kingambit", types: ["Dark", "Steel"] };

check("wcAntiSynergyWarnings never throws and returns [] on an empty team", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcAntiSynergyWarnings([], {}, abilitiesData))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcAntiSynergyWarnings(null, {}, abilitiesData))), []);
});

check("flags a Sandstorm setter chipping a non-immune-typed Focus Sash holder", () => {
  const members = [TYRANITAR, WHIMSICOTT];
  const builds = {
    Tyranitar: { item: "Assault Vest", moves: ["Rock Slide", "Crunch", "Ice Punch", "Protect"] },
    Whimsicott: { item: "Focus Sash", moves: ["Tailwind", "Moonblast", "Encore", "Protect"] },
  };
  const warnings = context.wcAntiSynergyWarnings(members, builds, abilitiesData);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Whimsicott/);
  assert.match(warnings[0], /Focus Sash/);
  assert.match(warnings[0], /Tyranitar/);
  assert.match(warnings[0], /Sandstorm/);
});

check("stays silent when the Focus Sash holder is Rock/Ground/Steel-typed (immune to sand chip)", () => {
  const members = [TYRANITAR, STEELIX];
  const builds = {
    Tyranitar: { item: "Assault Vest", moves: ["Rock Slide", "Crunch", "Ice Punch", "Protect"] },
    Steelix: { item: "Focus Sash", moves: ["Heavy Slam", "Earthquake", "Wide Guard", "Stealth Rock"] },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcAntiSynergyWarnings(members, builds, abilitiesData))), []);
});

check("stays silent when no teammate actually sets Sandstorm", () => {
  const members = [SLOWBRO, WHIMSICOTT];
  const builds = {
    Slowbro: { item: "Sitrus Berry", moves: ["Trick Room", "Scald", "Slack Off", "Protect"] },
    Whimsicott: { item: "Focus Sash", moves: ["Tailwind", "Moonblast", "Encore", "Protect"] },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcAntiSynergyWarnings(members, builds, abilitiesData))), []);
});

check("flags a Choice Scarf holder alongside a teammate whose REAL build runs Trick Room", () => {
  const members = [SLOWBRO, KINGAMBIT];
  const builds = {
    Slowbro: { item: "Mental Herb", moves: ["Trick Room", "Scald", "Slack Off", "Protect"] },
    Kingambit: { item: "Choice Scarf", moves: ["Sucker Punch", "Kowtow Cleave", "Iron Head", "Swords Dance"] },
  };
  const warnings = context.wcAntiSynergyWarnings(members, builds, abilitiesData);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Kingambit/);
  assert.match(warnings[0], /Choice Scarf/);
  assert.match(warnings[0], /Slowbro/);
  assert.match(warnings[0], /Trick Room/);
});

check("stays silent when Trick Room is only learnable, not actually in the build", () => {
  const members = [SLOWBRO, KINGAMBIT];
  const builds = {
    Slowbro: { item: "Sitrus Berry", moves: ["Scald", "Slack Off", "Protect", "Calm Mind"] }, // no Trick Room in the real build
    Kingambit: { item: "Choice Scarf", moves: ["Sucker Punch", "Kowtow Cleave", "Iron Head", "Swords Dance"] },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcAntiSynergyWarnings(members, builds, abilitiesData))), []);
});

check("stays silent when the Choice Scarf holder is the Trick Room setter itself (no conflict with itself)", () => {
  const members = [SLOWBRO];
  const builds = {
    Slowbro: { item: "Choice Scarf", moves: ["Trick Room", "Scald", "Slack Off", "Protect"] },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(context.wcAntiSynergyWarnings(members, builds, abilitiesData))), []);
});

check("both real conflicts can fire together on the same team", () => {
  const members = [TYRANITAR, WHIMSICOTT, SLOWBRO, KINGAMBIT];
  const builds = {
    Tyranitar: { item: "Assault Vest", moves: ["Rock Slide", "Crunch", "Ice Punch", "Protect"] },
    Whimsicott: { item: "Focus Sash", moves: ["Tailwind", "Moonblast", "Encore", "Protect"] },
    Slowbro: { item: "Mental Herb", moves: ["Trick Room", "Scald", "Slack Off", "Protect"] },
    Kingambit: { item: "Choice Scarf", moves: ["Sucker Punch", "Kowtow Cleave", "Iron Head", "Swords Dance"] },
  };
  const warnings = context.wcAntiSynergyWarnings(members, builds, abilitiesData);
  assert.equal(warnings.length, 2);
});

console.log("");
console.log(`All ${checks} anti-synergy auditor checks passed.`);
