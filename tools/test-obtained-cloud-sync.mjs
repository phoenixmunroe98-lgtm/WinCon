// WinCon — tools/test-obtained-cloud-sync.mjs (Milestone 62)
//
// Regression test for the real bug Phoenix reported: "i found a bug where
// when i switched between chrom profiles and logged in it has pulled an
// old version of my saved pokedex not a new one." Confirmed directly
// against the code: "obtained" (marked-caught) Pokemon lived ONLY in
// whichever browser's localStorage last wrote it -- app.js, home.js, and
// builder.js all read/wrote the same "wincon.obtained" key, but nothing
// ever synced it to the signed-in account, unlike teams
// (0001_init.sql/wcLoadAndSyncTeamState) and locked builds
// (0008_locked_builds.sql/wcFetchLockedBuilds). A different Chrome PROFILE
// has an entirely separate localStorage -- exactly like a different
// browser or device -- so signing into the same account there showed
// whatever THAT profile's own storage already held (nothing, or a stale
// snapshot), never the account's real, current Pokedex.
//
// The fix adds `obtained_pokemon` (0010_obtained_pokemon.sql, one row per
// (user, species) -- mirrors locked_builds' shape) and two new functions
// in teams.js: wcLoadAndSyncObtained (merges local + cloud, uploads
// local-only entries) and wcSetObtainedInCloud (upserts/deletes exactly
// one row per toggle). This file can't spin up a real Supabase project,
// so it mocks window.wcSupabase/window.wcAuth -- a real, controllable
// stand-in for the exact chained calls (.from().select().eq(),
// .from().upsert(), .from().delete().eq().eq()) these two functions
// actually make -- and drives real invocations of the real functions
// against it, not just asserting their source text.
//
// Run: node tools/test-obtained-cloud-sync.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let checksRun = 0;
function check(label, fn) {
  fn();
  checksRun += 1;
  console.log(`OK  ${label}`);
}

async function checkAsync(label, fn) {
  await fn();
  checksRun += 1;
  console.log(`OK  ${label}`);
}

// A promise that also carries a chainable `.eq()` returning the same kind
// of chainable promise -- covers both the one-`.eq()` select() path and
// the two-`.eq()` delete() path with the same helper, since real
// Supabase's own query builder is thenable at every step of the chain.
function chainable(result) {
  const p = Promise.resolve(result);
  p.eq = () => chainable(result);
  return p;
}

// Objects/arrays built by code running INSIDE the vm context (e.g. the
// rows wcLoadAndSyncObtained/wcSetObtainedInCloud construct before handing
// them to this mock) come from that context's own separate realm --
// assert.deepStrictEqual (imported from node:assert/strict) considers a
// cross-realm object "not reference-equal" even when structurally
// identical, and throws a confusing "same structure but are not
// reference-equal" error. A JSON round-trip rebuilds the same data as
// plain, current-realm objects/arrays, which is all these assertions
// actually care about.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * A real, controllable stand-in for window.wcSupabase, covering exactly
 * the calls wcLoadAndSyncObtained/wcSetObtainedInCloud make against the
 * "obtained_pokemon" table: .select("species").eq("user_id", uid),
 * .upsert(rows, opts), and .delete().eq("user_id", uid).eq("species", sp).
 */
function makeMockSupabase({ session = { user: { id: "user-1" } }, cloudRows = [], selectError = null, upsertError = null, deleteError = null, hangOnSelect = false } = {}) {
  const calls = { selects: 0, upserts: [], deletes: [] };
  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
    },
    from(table) {
      assert.equal(table, "obtained_pokemon", "only obtained_pokemon should ever be queried by these functions");
      return {
        select(cols) {
          assert.equal(cols, "species");
          calls.selects += 1;
          if (hangOnSelect) return { eq: () => new Promise(() => {}) }; // never resolves -- exercises wcWithTimeout's own timeout path
          return {
            eq: (col, val) => {
              assert.equal(col, "user_id");
              return chainable(selectError ? { data: null, error: { message: selectError } } : { data: cloudRows, error: null });
            },
          };
        },
        upsert(rows, opts) {
          calls.upserts.push({ rows, opts });
          return chainable({ error: upsertError ? { message: upsertError } : null });
        },
        delete() {
          return {
            eq: (col1, val1) => {
              assert.equal(col1, "user_id");
              return {
                eq: (col2, val2) => {
                  assert.equal(col2, "species");
                  calls.deletes.push(val2);
                  return chainable({ error: deleteError ? { message: deleteError } : null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

function makeWindow({ supabase = null, signedIn = true, userId = "user-1" } = {}) {
  return {
    wcSupabase: supabase,
    wcAuth: { isSignedIn: () => signedIn, getUserId: () => userId },
  };
}

function freshContext() {
  // wcWithTimeout (teams.js) uses setTimeout -- a vm.createContext() sandbox
  // has no globals at all unless explicitly supplied, unlike a real browser
  // window, so this must be passed in by hand.
  const context = vm.createContext({ console, window: undefined, setTimeout, clearTimeout });
  const code = fs.readFileSync(path.join(ROOT, "teams.js"), "utf8");
  vm.runInContext(code, context, { filename: "teams.js" });
  return context;
}

// ---------------------------------------------------------------------------
// wcLoadAndSyncObtained
// ---------------------------------------------------------------------------

await checkAsync("wcLoadAndSyncObtained returns the local set unchanged when signed out (no window.wcSupabase set at all)", async () => {
  const context = freshContext();
  context.window = { wcSupabase: undefined };
  const local = new Set(["Pikachu", "Charizard"]);
  const result = await context.wcLoadAndSyncObtained(local);
  assert.deepEqual([...result].sort(), ["Charizard", "Pikachu"]);
});

await checkAsync("wcLoadAndSyncObtained returns the local set unchanged when there's no real Supabase session", async () => {
  const context = freshContext();
  const { client } = makeMockSupabase({ session: null });
  context.window = makeWindow({ supabase: client });
  const local = new Set(["Pikachu"]);
  const result = await context.wcLoadAndSyncObtained(local);
  assert.deepEqual([...result], ["Pikachu"]);
});

await checkAsync("wcLoadAndSyncObtained merges local and cloud sets -- the real fix for Phoenix's bug: a fresh Chrome profile's empty local set now picks up everything the account has in the cloud", async () => {
  const context = freshContext();
  const { client, calls } = makeMockSupabase({ cloudRows: [{ species: "Garchomp" }, { species: "Steelix" }] });
  context.window = makeWindow({ supabase: client });
  // Simulates the exact reported scenario: a brand new Chrome profile has
  // NOTHING locally (empty local set), but the account has a real,
  // previously-saved Pokedex in the cloud.
  const local = new Set();
  const result = await context.wcLoadAndSyncObtained(local);
  assert.deepEqual([...result].sort(), ["Garchomp", "Steelix"]);
  // Nothing local-only, so nothing should have been uploaded.
  assert.equal(calls.upserts.length, 0);
});

await checkAsync("wcLoadAndSyncObtained is a real union, never drops a locally-marked Pokemon the cloud doesn't have yet", async () => {
  const context = freshContext();
  const { client } = makeMockSupabase({ cloudRows: [{ species: "Garchomp" }] });
  context.window = makeWindow({ supabase: client });
  const local = new Set(["Pikachu", "Garchomp"]); // Pikachu: local-only; Garchomp: in both
  const result = await context.wcLoadAndSyncObtained(local);
  assert.deepEqual([...result].sort(), ["Garchomp", "Pikachu"]);
});

await checkAsync("wcLoadAndSyncObtained uploads exactly the local-only names, so the account's cloud copy catches up to the merged set", async () => {
  const context = freshContext();
  const { client, calls } = makeMockSupabase({ cloudRows: [{ species: "Garchomp" }] });
  context.window = makeWindow({ supabase: client });
  const local = new Set(["Pikachu", "Absol", "Garchomp"]);
  await context.wcLoadAndSyncObtained(local);
  assert.equal(calls.upserts.length, 1);
  const uploadedRows = plain(calls.upserts[0].rows);
  const uploadedNames = uploadedRows.map((r) => r.species).sort();
  assert.deepEqual(uploadedNames, ["Absol", "Pikachu"]); // Garchomp already in the cloud -- not re-uploaded
  uploadedRows.forEach((r) => assert.equal(r.user_id, "user-1"));
  assert.deepEqual(plain(calls.upserts[0].opts), { onConflict: "user_id,species" });
});

await checkAsync("wcLoadAndSyncObtained fails safe to the local set on a select error, a timeout, or an upsert error -- never throws, never loses local marks", async () => {
  const context = freshContext();
  const local = new Set(["Pikachu"]);

  const { client: erroringClient } = makeMockSupabase({ selectError: "network hiccup" });
  context.window = makeWindow({ supabase: erroringClient });
  assert.deepEqual([...(await context.wcLoadAndSyncObtained(local))], ["Pikachu"]);

  const { client: hangingClient } = makeMockSupabase({ hangOnSelect: true });
  context.window = makeWindow({ supabase: hangingClient });
  assert.deepEqual([...(await context.wcLoadAndSyncObtained(local))], ["Pikachu"]);

  const { client: upsertFailClient } = makeMockSupabase({ cloudRows: [], upsertError: "write failed" });
  context.window = makeWindow({ supabase: upsertFailClient });
  // Local-only upload fails, but the merge itself (a pure union) still
  // succeeds and is still returned -- a failed upload never drops data.
  assert.deepEqual([...(await context.wcLoadAndSyncObtained(local))], ["Pikachu"]);
});

// ---------------------------------------------------------------------------
// wcSetObtainedInCloud
// ---------------------------------------------------------------------------

await checkAsync("wcSetObtainedInCloud upserts exactly one row when marking obtained", async () => {
  const context = freshContext();
  const { client, calls } = makeMockSupabase();
  context.window = makeWindow({ supabase: client });
  await context.wcSetObtainedInCloud("Zeraora", true);
  assert.equal(calls.upserts.length, 1);
  assert.deepEqual(plain(calls.upserts[0].rows), { user_id: "user-1", species: "Zeraora" });
  assert.deepEqual(plain(calls.upserts[0].opts), { onConflict: "user_id,species" });
  assert.equal(calls.deletes.length, 0);
});

await checkAsync("wcSetObtainedInCloud deletes exactly one row (scoped to both user_id and species) when un-marking obtained", async () => {
  const context = freshContext();
  const { client, calls } = makeMockSupabase();
  context.window = makeWindow({ supabase: client });
  await context.wcSetObtainedInCloud("Zeraora", false);
  assert.equal(calls.deletes.length, 1);
  assert.equal(calls.deletes[0], "Zeraora");
  assert.equal(calls.upserts.length, 0);
});

await checkAsync("wcSetObtainedInCloud is a genuine no-op while signed out -- never calls Supabase at all", async () => {
  const context = freshContext();
  const { client, calls } = makeMockSupabase();
  context.window = makeWindow({ supabase: client, signedIn: false });
  await context.wcSetObtainedInCloud("Zeraora", true);
  await context.wcSetObtainedInCloud("Zeraora", false);
  assert.equal(calls.upserts.length, 0);
  assert.equal(calls.deletes.length, 0);
});

await checkAsync("wcSetObtainedInCloud never throws even when Supabase itself errors out", async () => {
  const context = freshContext();
  const { client: upsertFailClient } = makeMockSupabase({ upsertError: "write failed" });
  context.window = makeWindow({ supabase: upsertFailClient });
  await context.wcSetObtainedInCloud("Zeraora", true); // must not throw

  const { client: deleteFailClient } = makeMockSupabase({ deleteError: "write failed" });
  context.window = makeWindow({ supabase: deleteFailClient });
  await context.wcSetObtainedInCloud("Zeraora", false); // must not throw
});

console.log(`\nAll ${checksRun} checks passed.`);
