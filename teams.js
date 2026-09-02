// WinCon — shared multi-team storage (Milestone 3)
//
// Team drafts used to live under one localStorage key holding a single
// team (wincon.teamDraft). This app now supports up to 5 named, saved
// teams under one key (wincon.teams) — Team Builder, Matchup Score, and
// any future page all read/write this same shape so they never drift
// apart, and a first-time visit with an old single draft is migrated
// into "Team 1" automatically.
//
// Milestone 22: teams also sync to a signed-in user's Supabase account, so
// they follow you to any device/browser you log into (see "Cloud sync"
// below, near wcLoadAndSyncTeamState/wcPushTeamsToCloudIfSignedIn) — a
// signed-out visitor's teams still live only in this browser's
// localStorage, exactly as before.

const WINCON_TEAMS_KEY = "wincon.teams";
const WINCON_LEGACY_DRAFT_KEY = "wincon.teamDraft";
const WINCON_MAX_TEAMS = 5;

// Milestone 22: team ids are now real UUIDs (matching the `teams.id uuid`
// column already sitting in supabase/migrations/0001_init.sql) rather than
// a `team-<timestamp>-<n>` string, so a team saved in the cloud and one
// saved locally can be told apart -- or recognized as the same team -- by
// id alone, with no separate mapping table anywhere. `crypto.randomUUID()`
// covers every real browser this app targets; the manual fallback below
// only matters on a non-secure context (e.g. opening index.html straight
// off disk instead of through a server -- see the README's "Running it"
// section) where that API doesn't exist.
function wcNewTeamId() {
  // `typeof window !== "undefined"` first -- this file is also loaded
  // directly in plain Node (no browser/DOM at all) by several of this
  // project's own test scripts (see test-meta-strategy.mjs), so a bare
  // `window.crypto` reference would throw ReferenceError there instead of
  // just falling through to the manual UUID below.
  if (typeof window !== "undefined" && window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
const WC_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wcEmptyTeamState() {
  return { teams: [], activeId: null };
}

function wcEmptyTeam(name) {
  return { id: wcNewTeamId(), name, format: "doubles", sheetMode: "closed", chosen: [], builds: {}, notes: "", matchLog: [] };
}

/** A team saved before Milestone 4 has no `format` field — default it to Doubles (Champions' ranked ladder format) rather than requiring a migration pass. */
function wcGetTeamFormat(team) {
  return team && team.format === "singles" ? "singles" : "doubles";
}

/**
 * Milestone 14: Open Team Sheet vs. Closed Team Sheet — a real VGC/
 * competitive-play distinction (see README.md's Milestone 14 section).
 * Defaults to "closed" (the ladder default: no assumed foreknowledge of
 * your set) for a team saved before this milestone, or if the field is
 * ever something unexpected, same defensive pattern as wcGetTeamFormat.
 */
function wcGetSheetMode(team) {
  return team && team.sheetMode === "open" ? "open" : "closed";
}

// ---------------------------------------------------------------------------
// Real-time win/loss tracker (Milestone 11)
// ---------------------------------------------------------------------------
//
// A team saved before this milestone has no `matchLog` — every read below
// defaults to [] rather than requiring a migration pass, same pattern as
// `format` above. Logging a result never REQUIRES anything beyond a
// win/loss — the note and the opponent's team (below) are both optional,
// so a quick log-and-go always stays one click. The opponent's team, when
// added, is just a free-text list of names the player recognized — not
// validated against the roster and not fed automatically into Auto-build
// strategy's scoring: a bare win/loss (or even a logged opponent lineup)
// doesn't say WHY a game was won or lost, and guessing would be exactly
// the kind of unexplainable heuristic this project has avoided everywhere
// else. It's stored for the strategist to reference (e.g. in that team's
// own notes field on the Team Builder page), not reasoned about here.

/** Appends one logged result to `team.matchLog`, initializing it if this team was saved before Milestone 11. `opponent`, if given, is an array of opponent Pokémon names the player chose to note down — entirely optional, never required to log a result. Does not save to localStorage itself — callers save the whole team state afterward, same as every other team mutation in this file. */
function wcRecordMatchResult(team, result, note, opponent) {
  if (!team) return;
  if (!Array.isArray(team.matchLog)) team.matchLog = [];
  const cleanOpponent = Array.isArray(opponent) ? opponent.map((n) => (n || "").trim()).filter(Boolean) : [];
  team.matchLog.push({
    result: result === "loss" ? "loss" : "win",
    note: (note || "").trim(),
    opponent: cleanOpponent,
    loggedAt: new Date().toISOString(),
  });
}

/** Removes one logged entry by its index in `team.matchLog`. */
function wcDeleteMatchResult(team, index) {
  if (!team || !Array.isArray(team.matchLog)) return;
  team.matchLog.splice(index, 1);
}

/** Wins/losses/total/win-rate-percent for a team's logged record — `winRate` is null when there's nothing logged yet, rather than 0, so callers can tell "no data" apart from "0%". */
function wcMatchRecordSummary(team) {
  const log = (team && Array.isArray(team.matchLog) && team.matchLog) || [];
  const wins = log.filter((e) => e.result === "win").length;
  const losses = log.filter((e) => e.result === "loss").length;
  const total = wins + losses;
  return { wins, losses, total, winRate: total > 0 ? Math.round((wins / total) * 100) : null };
}

/**
 * Reads the saved multi-team state, migrating a pre-Milestone-3 single
 * draft (wincon.teamDraft) into it the first time this runs if one exists.
 * Never throws — falls back to an empty state on corrupt/unavailable storage.
 */
function wcLoadTeamState() {
  try {
    const raw = localStorage.getItem(WINCON_TEAMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.teams)) return parsed;
    }
  } catch {
    // fall through to migration/empty below
  }

  try {
    const legacyRaw = localStorage.getItem(WINCON_LEGACY_DRAFT_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      if (legacy && Array.isArray(legacy.chosen) && legacy.chosen.length > 0) {
        const team = wcEmptyTeam("Team 1");
        team.chosen = legacy.chosen;
        team.builds = legacy.builds || {};
        const migrated = { teams: [team], activeId: team.id };
        wcSaveTeamState(migrated);
        return migrated;
      }
    }
  } catch {
    // ignore — fall through to a plain empty state
  }

  return wcEmptyTeamState();
}

/** Gives any legacy `team-<timestamp>-<n>` id (saved before Milestone 22) a real UUID in place, so it's something the `teams.id uuid` column will accept once cloud sync tries to upsert it. Keeps `state.activeId` pointing at the right team through the swap. A no-op for every team that already has a real UUID, which after this milestone ships is every team from the moment it's created. */
function wcAssignCloudCompatibleIds(state) {
  state.teams.forEach((t) => {
    if (t.id && WC_UUID_RE.test(t.id)) return;
    const oldId = t.id;
    t.id = wcNewTeamId();
    if (state.activeId === oldId) state.activeId = t.id;
  });
}

function wcSaveTeamState(state) {
  wcAssignCloudCompatibleIds(state);
  try {
    localStorage.setItem(WINCON_TEAMS_KEY, JSON.stringify(state));
  } catch {
    return false;
  }
  // Fire-and-forget: a signed-in user's teams also get pushed to their
  // account so the next device they log into can pull them back down (see
  // wcLoadAndSyncTeamState below). Never awaited from here and never lets
  // an error escape -- exactly like every other Supabase call in this
  // project, cloud sync is an enhancement on top of localStorage, not a
  // replacement for it, so a network hiccup must never block or fail a
  // save that already succeeded locally.
  // The extra .catch() here is belt-and-suspenders: everything inside
  // wcPushTeamsToCloudIfSignedIn already catches its own errors, but a
  // fire-and-forget async call with NOTHING watching its returned promise
  // becomes an unhandled promise rejection (which crashes plain Node,
  // e.g. this project's own vm-based test scripts) the moment anything
  // throws before that function's own try/catch is reached.
  wcPushTeamsToCloudIfSignedIn(state).catch(() => {});
  return true;
}

function wcGetActiveTeam(state) {
  if (!state.activeId) return null;
  return state.teams.find((t) => t.id === state.activeId) || null;
}

// ---------------------------------------------------------------------------
// Cloud sync (Milestone 22) -- an account's teams now travel with it.
// ---------------------------------------------------------------------------
//
// Two directions, both funneled through the two functions everything else
// in the app already calls (wcLoadTeamState/wcSaveTeamState), so nothing
// in builder.js/home.js needed to change to get this:
//
//   PULL (wcLoadAndSyncTeamState): called once, awaited, at the top of
//   every page's init() in place of the old bare wcLoadTeamState() call.
//   Reads local storage first (instant, works offline), and if signed in,
//   merges in anything the account has saved from another device before
//   the page does anything else -- crucially, before ensureActiveTeam()
//   or any other save could otherwise run first and make the PUSH side
//   below think a brand new device's empty/default-only team list is the
//   whole truth, wiping out real teams saved elsewhere. The merge is a
//   plain union by id: a team only locally known gets uploaded, a team
//   only the cloud knows gets downloaded, nothing is ever deleted by the
//   merge itself.
//
//   PUSH (wcPushTeamsToCloudIfSignedIn): called from inside every
//   wcSaveTeamState(), so every one of the ~20 existing call sites across
//   builder.js gets cloud sync for free. Upserts every locally-saved team
//   and deletes any cloud team no longer present locally (e.g. the user
//   pressed Delete Team) -- a full reconciliation each time rather than a
//   diff, which is fine since team saves are discrete user actions
//   (Save/Delete/Rename/log a result), never a per-keystroke event.
//
// Both directions no-op immediately (return null / do nothing) if the
// Supabase CDN didn't load or nobody's signed in -- see wcHasSupabase's
// own comment in auth.js for why that's the correct default, not an
// error state.

/**
 * Which signed-in user (if any) wcLoadAndSyncTeamState has actually pulled
 * a full cloud picture for THIS page view. wcPushTeamsToCloudIfSignedIn's
 * delete-diff (below) only runs once this matches the current user --
 * otherwise a save that happens to fire before the merge has ever run
 * (e.g. someone signs in through the header widget without navigating
 * anywhere afterward, then edits the one local-only team already on
 * screen) would see a `state.teams` that's still missing every team the
 * account actually has in the cloud, and "clean up anything not in my
 * local list" would wipe them out. Uploading (upsert) never has this
 * problem -- it only ever adds/updates rows -- so that half still runs
 * regardless; only the destructive half waits for a real merge first.
 * Resets to null on every fresh page load by design (each page's own
 * init() is expected to await wcLoadAndSyncTeamState() before its first
 * save can happen -- see builder.js/home.js).
 */
let wcCloudSyncEstablishedForUserId = null;

/** Resolves to `null` instead of hanging forever if `promise` takes longer than `ms` -- a flaky connection to Supabase must never block a page from loading (or a save from completing locally), it should just fall back to "couldn't reach the cloud this time." */
function wcWithTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * Milestone 26: a direct, reliable check for whether a real Supabase
 * session exists right now. Unlike `window.wcAuth.isSignedIn()`, which
 * depends on auth.js's own async init (kicked off on DOMContentLoaded)
 * having already resolved, this asks Supabase directly -- the same call
 * wcLoadAndSyncTeamState() below already makes for its own merge decision.
 * A page uses this specifically to decide whether it's safe to show
 * whatever's sitting in this browser's local storage (this account's team
 * from an earlier signed-in session on this device, or -- shared computer
 * -- a different account's entirely) or whether it must start blank
 * instead: guessing "signed out" from a `window.wcAuth` check that simply
 * hasn't caught up yet would flash someone's real team, which is exactly
 * the leak this exists to prevent. Resolves false (never "unknown") on
 * any error/timeout/missing SDK -- when in doubt, don't show anything.
 */
async function wcHasRealSession() {
  if (typeof window === "undefined" || !window.wcSupabase) return false;
  try {
    const sessionResult = await wcWithTimeout(window.wcSupabase.auth.getSession(), 5000);
    return Boolean(sessionResult && sessionResult.data && sessionResult.data.session);
  } catch {
    return false;
  }
}

function wcCloudRowToTeam(row) {
  return {
    id: row.id,
    name: row.name || "Untitled team",
    format: row.format,
    sheetMode: row.sheet_mode,
    chosen: Array.isArray(row.chosen) ? row.chosen : [],
    builds: row.builds && typeof row.builds === "object" ? row.builds : {},
    notes: row.notes || "",
    matchLog: Array.isArray(row.match_log) ? row.match_log : [],
  };
}

function wcTeamToCloudRow(team, userId) {
  return {
    id: team.id,
    user_id: userId,
    name: team.name || "Untitled team",
    format: wcGetTeamFormat(team),
    sheet_mode: wcGetSheetMode(team),
    chosen: Array.isArray(team.chosen) ? team.chosen : [],
    builds: team.builds && typeof team.builds === "object" ? team.builds : {},
    notes: team.notes || "",
    match_log: Array.isArray(team.matchLog) ? team.matchLog : [],
    updated_at: new Date().toISOString(),
  };
}

/**
 * Reads local team state and, if a Supabase session already exists,
 * merges in anything the account has saved elsewhere. Checked directly
 * against Supabase's own getSession() rather than window.wcAuth -- auth.js
 * runs its own async init on DOMContentLoaded and may not have resolved
 * yet by the time a page's init() gets here, and this can't afford to
 * guess "not signed in" just because it asked too early.
 *
 * Always returns a usable state (never throws) -- local-only if signed
 * out, if the Supabase CDN didn't load, or if the network call times out.
 */
async function wcLoadAndSyncTeamState() {
  const local = wcLoadTeamState();
  if (typeof window === "undefined" || !window.wcSupabase) return local;

  try {
    const sessionResult = await wcWithTimeout(window.wcSupabase.auth.getSession(), 5000);
    const session = sessionResult && sessionResult.data && sessionResult.data.session;
    if (!session) return local;

    const userId = session.user.id;
    const selectResult = await wcWithTimeout(
      window.wcSupabase.from("teams").select("*").eq("user_id", userId).order("created_at"),
      5000
    );
    if (!selectResult) return local; // timed out -- stay local-only for this page view
    const { data: rows, error } = selectResult;
    if (error) {
      console.warn("WinCon: couldn't load your saved teams from your account", error.message);
      return local;
    }

    const cloudTeams = (rows || []).map(wcCloudRowToTeam);
    const localIds = new Set(local.teams.map((t) => t.id));
    const merged = [...local.teams];
    let droppedForSpace = 0;
    cloudTeams.forEach((ct) => {
      if (localIds.has(ct.id)) return;
      if (merged.length >= WINCON_MAX_TEAMS) {
        droppedForSpace += 1;
        return;
      }
      merged.push(ct);
    });
    if (droppedForSpace > 0) {
      console.warn(`WinCon: ${droppedForSpace} team(s) from your account didn't fit locally (max ${WINCON_MAX_TEAMS}) -- delete one to make room, then reload.`);
    }

    const activeStillThere = local.activeId && merged.some((t) => t.id === local.activeId);
    const mergedState = { teams: merged, activeId: activeStillThere ? local.activeId : merged[0] ? merged[0].id : null };
    // From this point on, this page view has a real, complete picture of
    // this user's cloud teams -- safe for wcPushTeamsToCloudIfSignedIn's
    // delete-diff to act on (see wcCloudSyncEstablishedForUserId's comment).
    wcCloudSyncEstablishedForUserId = userId;
    // Saves the merge back to localStorage AND (since we know we're signed
    // in) pushes any local-only team up to the cloud in the same call --
    // see wcSaveTeamState/wcPushTeamsToCloudIfSignedIn above.
    wcSaveTeamState(mergedState);
    return mergedState;
  } catch (err) {
    console.warn("WinCon: cloud team sync failed, continuing locally", err && err.message);
    return local;
  }
}

async function wcPushTeamsToCloudIfSignedIn(state) {
  if (typeof window === "undefined" || !window.wcSupabase) return;
  const userId = window.wcAuth && window.wcAuth.isSignedIn() ? window.wcAuth.getUserId() : null;
  if (!userId) return;

  try {
    if (state.teams.length > 0) {
      const rows = state.teams.map((t) => wcTeamToCloudRow(t, userId));
      const { error: upsertError } = await window.wcSupabase.from("teams").upsert(rows);
      if (upsertError) {
        console.warn("WinCon: couldn't sync your teams to your account", upsertError.message);
        return; // don't risk deleting anything cloud-side off a partial/failed picture
      }
    }

    // Removes any cloud team no longer saved locally (deleted, or moved
    // out from under a format that no longer exists) -- a full
    // reconciliation, not just an insert/update. An empty local team list
    // legitimately means "delete every cloud team too" (see the file-level
    // comment above), which is exactly what an unfiltered delete below
    // does when state.teams is empty. Skipped entirely until a real cloud
    // merge has run THIS page view (see wcCloudSyncEstablishedForUserId) --
    // uploading is always safe, but "delete anything not in my local list"
    // isn't, until that local list is known to be the full picture.
    if (userId !== wcCloudSyncEstablishedForUserId) return;

    let del = window.wcSupabase.from("teams").delete().eq("user_id", userId);
    if (state.teams.length > 0) {
      const keepIds = state.teams.map((t) => t.id);
      del = del.not("id", "in", `(${keepIds.join(",")})`);
    }
    const { error: deleteError } = await del;
    if (deleteError) {
      console.warn("WinCon: couldn't clean up a removed team in your account", deleteError.message);
    }
  } catch (err) {
    console.warn("WinCon: cloud team sync failed", err && err.message);
  }
}
