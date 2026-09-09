// WinCon — tools/test-auth-session-change-dispatch.mjs
//
// Milestone 65: Phoenix reported that while setting up a new team in the
// Team Builder (adding moves/items/ability changes across several Pokemon
// before saving), the page would periodically refresh and wipe her unsaved
// in-progress edits -- forcing her to save after every single Pokemon
// instead of finishing the whole team first.
//
// Root cause, confirmed by reading the real code (not assumed): auth.js's
// wcHandleSessionChange() -- the single place that dispatches the
// "wc:auth-changed" window event every other page listens for -- used to
// fire that dispatch unconditionally on every raw Supabase
// onAuthStateChange callback, including TOKEN_REFRESHED (which Supabase's
// client fires automatically roughly hourly, and also whenever a
// backgrounded tab regains focus -- well within the time it takes to set
// up moves/items/abilities across 6 Pokemon) and USER_UPDATED, neither of
// which represents an actual sign-in/sign-out/account-switch. builder.js's
// own "wc:auth-changed" listener (see init(), builder.js) treats every
// firing as "an account just (dis)connected -- reload its real saved team
// over whatever's currently in the working state" via
// wcSyncTeamStateForAuth(), which is exactly the reported symptom.
//
// The fix (see auth.js's wcHandleSessionChange) compares the signed-in
// user's id before and after each callback and only dispatches
// "wc:auth-changed" when it has genuinely changed -- sign-in, sign-out, or
// switching accounts -- never for a same-user token refresh or profile
// update.
//
// auth.js itself has never been unit-tested in this project -- like
// builder.js (see tools/test-pool-scope-toggle.mjs's file header), its
// top-level code reaches for real DOM elements and a real window.wcSupabase
// client the instant it loads. Rather than fake up that whole DOM, this
// file extracts wcHandleSessionChange()'s exact real source text out of
// the live auth.js (by matching its opening "async function
// wcHandleSessionChange(session) {" and brace-counting to the matching
// close) and runs THAT real function body against a minimal mock of just
// the handful of names it actually references -- so this test would fail
// the moment the shipped function's real dispatch logic regresses, not
// just a hand-written mirror of it.
//
// Run: node tools/test-auth-session-change-dispatch.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function extractFunctionSource(fileText, signature) {
  const start = fileText.indexOf(signature);
  assert.ok(start !== -1, `could not find "${signature}" in the file`);
  const openBraceIndex = start + signature.length - 1;
  assert.equal(fileText[openBraceIndex], "{", "expected signature to end just before the opening brace");
  let depth = 0;
  let i = openBraceIndex;
  for (; i < fileText.length; i += 1) {
    if (fileText[i] === "{") depth += 1;
    else if (fileText[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  assert.ok(depth === 0, "brace matching failed to close");
  return fileText.slice(start, i + 1);
}

const authSrc = fs.readFileSync(path.join(ROOT, "auth.js"), "utf8");
const wcHandleSessionChangeSrc = extractFunctionSource(
  authSrc,
  "async function wcHandleSessionChange(session) {"
);

let checks = 0;
async function check(description, fn) {
  await fn();
  checks += 1;
  console.log(`OK  ${description}`);
}

// Builds a fresh harness each time: a real Node vm context providing only
// the handful of names wcHandleSessionChange's real body references
// (mirroring auth.js's own module-level state and helper calls), plus
// instrumentation recording every "wc:auth-changed" dispatch.
function makeHarness() {
  const dispatched = [];
  const context = {
    wcCurrentSession: null,
    wcCurrentProfile: null,
    wcRecoveryMode: false,
    wcLoadProfile: async (userId) => ({ id: userId }),
    wcCloseAuthModal: () => {},
    wcRenderAccountWidget: () => {},
    wcMaybeShowAgeGate: () => {},
    window: {
      dispatchEvent: (evt) => dispatched.push(evt.detail),
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(`${wcHandleSessionChangeSrc}\nthis.wcHandleSessionChange = wcHandleSessionChange;`, context);
  return { context, dispatched };
}

function session(userId, extra = {}) {
  return { user: { id: userId, ...extra }, access_token: `token-for-${userId}-${Math.random()}` };
}

// ---------------------------------------------------------------------------

await check("a fresh sign-in (previously signed out) dispatches wc:auth-changed", async () => {
  const { context, dispatched } = makeHarness();
  await context.wcHandleSessionChange(session("phoenix-1"));
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].session.user.id, "phoenix-1");
});

await check("Milestone 65 bug fix: a same-user TOKEN_REFRESHED-style re-fire (new session object, same user id) does NOT dispatch wc:auth-changed", async () => {
  const { context, dispatched } = makeHarness();
  await context.wcHandleSessionChange(session("phoenix-1"));
  assert.equal(dispatched.length, 1, "sanity: the initial sign-in itself should dispatch once");
  // Supabase issues a brand-new session object (new access_token) on every
  // token refresh, but the SAME user.id -- this is exactly what used to
  // wipe Phoenix's in-progress Team Builder edits.
  await context.wcHandleSessionChange(session("phoenix-1"));
  assert.equal(dispatched.length, 1, "a same-user token refresh must not trigger a second dispatch");
});

await check("a same-user USER_UPDATED-style re-fire (extra profile fields changed, same user id) does NOT dispatch wc:auth-changed", async () => {
  const { context, dispatched } = makeHarness();
  await context.wcHandleSessionChange(session("phoenix-1"));
  await context.wcHandleSessionChange(session("phoenix-1", { email: "new-email@example.com" }));
  assert.equal(dispatched.length, 1);
});

await check("switching to a genuinely different signed-in user still dispatches wc:auth-changed", async () => {
  const { context, dispatched } = makeHarness();
  await context.wcHandleSessionChange(session("phoenix-1"));
  await context.wcHandleSessionChange(session("someone-else"));
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].session.user.id, "someone-else");
});

await check("signing out (session becomes null) still dispatches wc:auth-changed", async () => {
  const { context, dispatched } = makeHarness();
  await context.wcHandleSessionChange(session("phoenix-1"));
  await context.wcHandleSessionChange(null);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].session, null);
});

await check("the initial page-load resolution confirming \"still signed out\" does NOT dispatch a redundant wc:auth-changed", async () => {
  const { context, dispatched } = makeHarness();
  // wcCurrentSession starts as null (see auth.js's module-level
  // declaration) -- this is the very first wcHandleSessionChange call of
  // the page's life, resolving to "yes, still signed out", exactly what
  // every page already assumed by default before this async check
  // resolved.
  await context.wcHandleSessionChange(null);
  assert.equal(dispatched.length, 0);
});

console.log(`\n${checks} checks passed.`);
