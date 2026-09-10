// WinCon — tools/test-sprite-coverage.mjs
//
// Milestone 66: Phoenix reported that Rillaboom and Baxcalibur had no
// image next to their name in the Team Builder's Pokemon selector.
// Investigating found the real scope was much bigger than those two:
// spriteImg() (builder.js) silently returns null whenever data/sprites.json
// has no entry for a roster name -- "if a sprite is ever missing or fails
// to load, it just doesn't render, nothing else on the page depends on it"
// (see README's Milestone 4 section) -- which is the right degrade-
// gracefully behavior for a genuinely-unavailable sprite, but it also means
// a roster addition that forgot to add its sprite entry fails completely
// silently, with nothing in the test suite ever catching it. That's
// exactly what happened: the entire Milestone 63 Regulation M-C roster
// addition (28 new base/form entries + 3 new Mega Evolutions), the 3 Mega
// Z forms from Milestone 61, and two older Paldean Tauros breed entries
// were all missing sprites -- 36 roster entries in total, discovered by
// diffing data/pokemon.json's names against data/sprites.json's keys.
//
// Fixed by resolving and downloading real sprites for all 36 (via
// PokeAPI's GitHub-hosted data mirror, cross-checked the same two-step way
// Milestone 4 established: the species' own dex-number-keyed English name,
// and -- since this mirror's per-form English name column turned out to be
// unreliably joined -- each variant's own listed types compared against
// this roster's own already-confirmed types instead, which is the same
// verification signal Milestone 4 already used for ambiguous prefixed
// forms). One genuine, unrelated data bug surfaced along the way: Arboliva
// had been carrying Smoliv's real dex number (928) instead of its own
// (930) -- corrected in data/pokemon.json.
//
// This file is the regression test that should have existed already: it
// doesn't re-verify the specific sprite artwork (that's a one-time human/
// visual check, done for a spot-check sample when Milestone 66 shipped),
// it verifies the STRUCTURAL invariant that let this bug happen silently
// -- every roster entry has a sprites.json entry, and every sprites.json
// entry points to a real, valid, real-sized PNG file that actually exists
// on disk -- so a future roster addition that forgets its sprite fails a
// test immediately instead of just quietly not rendering an image.
//
// Run: node tools/test-sprite-coverage.mjs

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

let checks = 0;
function check(description, fn) {
  fn();
  checks += 1;
  console.log(`OK  ${description}`);
}

const pokemonData = loadJSON("data/pokemon.json");
const sprites = loadJSON("data/sprites.json");
const pokemonNames = pokemonData.map((p) => p.name);

check("every roster entry in data/pokemon.json has a data/sprites.json entry (the Milestone 66 bug: 36 entries silently had none)", () => {
  const missing = pokemonNames.filter((name) => !(name in sprites));
  assert.deepEqual(missing, [], `roster entries with no sprite mapping: ${missing.join(", ")}`);
});

check("Rillaboom and Baxcalibur specifically -- the two Phoenix named -- now have sprite entries", () => {
  assert.ok("Rillaboom" in sprites);
  assert.ok("Baxcalibur" in sprites);
});

check("every data/sprites.json value points to a real file that exists on disk", () => {
  const missingFiles = [];
  for (const [name, rel] of Object.entries(sprites)) {
    const full = path.join(ROOT, "data", rel);
    if (!fs.existsSync(full)) missingFiles.push(`${name} -> ${rel}`);
  }
  assert.deepEqual(missingFiles, [], `sprite entries pointing at missing files: ${missingFiles.join(", ")}`);
});

check("every sprite file is a real, non-trivial PNG (magic bytes + sane dimensions), not an empty/placeholder/error file", () => {
  const bad = [];
  for (const [name, rel] of Object.entries(sprites)) {
    const full = path.join(ROOT, "data", rel);
    const buf = fs.readFileSync(full);
    const isPng = buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isPng) {
      bad.push(`${name}: not a PNG`);
      continue;
    }
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width < 10 || height < 10) bad.push(`${name}: suspiciously small (${width}x${height})`);
  }
  assert.deepEqual(bad, [], bad.join("; "));
});

check("data/sprites.json has no orphaned entries for a name that isn't (or no longer is) in the roster", () => {
  const rosterNames = new Set(pokemonNames);
  const orphans = Object.keys(sprites).filter((name) => !rosterNames.has(name));
  assert.deepEqual(orphans, [], `sprite entries with no matching roster entry: ${orphans.join(", ")}`);
});

check("Arboliva's dexNumber is its own real dex number (930), not Smoliv's (928) -- a real bug found while cross-checking sprite ids against species data", () => {
  const arboliva = pokemonData.find((p) => p.name === "Arboliva");
  assert.ok(arboliva, "Arboliva should exist in the roster");
  assert.equal(arboliva.dexNumber, 930);
});

console.log(`\nAll ${checks} sprite-coverage checks passed (${Object.keys(sprites).length} sprite entries, ${pokemonNames.length} roster entries).`);
