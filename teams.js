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

/** Every saved team for a given format, in whatever order the account/local state already has them — used by the Battle Tracker's Team vs Team matchup picker (battle-tracker.js), which is the first place that ever needed a per-format team LIST rather than one active team. */
function wcListTeamsByFormat(state, format) {
  const teams = (state && Array.isArray(state.teams) && state.teams) || [];
  return teams.filter((t) => wcGetTeamFormat(t) === format);
}

/**
 * The real "bring N of 6" team-preview count for a format (Simulated Win
 * Rate feature): Doubles brings 6, selects 4 — the actual tournament/
 * Worlds format. Singles brings 6, selects 3 — Singles has no official
 * tournament ruleset (it's ladder-only), but 3 is the real number there.
 * See the Simulated Win Rate plan's "Bring-N rule" for the research this
 * is based on.
 */
function wcRequiredBringCount(format) {
  return format === "singles" ? 3 : 4;
}

/** Sorted, pipe-joined combo key for a lineup — matches the SQL backfill in supabase/migrations/0006_lineup_scope_and_combo_synergy.sql exactly, so a client-computed key and a server-backfilled one for the same lineup always agree. */
function wcComputeLineupKey(lineupNames) {
  return [...(lineupNames || [])].filter(Boolean).sort().join("|");
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
//
// Milestone 28: this real per-game history now lives on its own page
// (battle-tracker.html/battle-tracker.js) instead of Team Builder, which
// only keeps the compact win/loss percentage (see wcMatchRecordSummary
// below, still read from the same team.matchLog). Every logged result
// also feeds the shared, cross-user meta_usage_stats table (see "Cloud
// sync of individual results" further down) -- not just this one team's
// own record.

/** A note over this length gets silently trimmed -- also enforced as the tracker-note-input's own maxlength in battle-tracker.html, this is the defensive backstop for anything that reaches this function some other way. */
const WC_MATCH_NOTE_MAX_LEN = 250;

/**
 * Appends one logged result to `team.matchLog`, initializing it if this
 * team was saved before Milestone 11. `opponent`, if given, is an array
 * of opponent Pokémon names the player chose to note down — entirely
 * optional, never required to log a result. Does not save to
 * localStorage itself — callers save the whole team state afterward,
 * same as every other team mutation in this file.
 *
 * Milestone 28: every entry now gets a real id (so a later delete can
 * remove the matching cloud row, not just splice the local array — see
 * wcDeleteMatchResult below), and — fire-and-forget, exactly like every
 * other cloud call in this file — gets pushed to the shared
 * match_results table with a snapshot of this team's CURRENT roster
 * (`team.chosen` at this exact moment), since the roster can change after
 * this game is logged and the cross-user aggregate needs what was
 * actually played, not whatever the team looks like later. Returns the
 * new entry so a caller (battle-tracker.js) can reference its id.
 *
 * Simulated Win Rate feature: `lineupUsed` is the real 4 (Doubles) / 3
 * (Singles) Pokémon actually brought to this battle — required, unlike
 * `opponent` which stays optional. battle-tracker.js's log form is what
 * enforces the right count before ever calling this (via
 * wcRequiredBringCount); this function trims/dedupes defensively but
 * does not itself block on a short list, since a caller who skips that
 * check is a bug in the caller, not something to silently paper over
 * here by guessing which 4 to credit.
 */
function wcRecordMatchResult(team, result, note, opponent, lineupUsed) {
  if (!team) return null;
  if (!Array.isArray(team.matchLog)) team.matchLog = [];
  const cleanOpponent = Array.isArray(opponent) ? opponent.map((n) => (n || "").trim()).filter(Boolean) : [];
  const cleanLineup = Array.isArray(lineupUsed) ? lineupUsed.map((n) => (n || "").trim()).filter(Boolean) : [];
  const entry = {
    id: wcNewTeamId(),
    result: result === "loss" ? "loss" : "win",
    note: (note || "").trim().slice(0, WC_MATCH_NOTE_MAX_LEN),
    opponent: cleanOpponent,
    lineupUsed: cleanLineup,
    loggedAt: new Date().toISOString(),
  };
  team.matchLog.push(entry);
  wcPushMatchResultToCloud(entry, team.id, wcGetTeamFormat(team), [...(team.chosen || [])], cleanLineup).catch(() => {});
  return entry;
}

/** Removes one logged entry by its index in `team.matchLog`, and (Milestone 28, fire-and-forget) the matching row in the shared match_results table. Returns the removed entry, or null if there was nothing at that index. */
function wcDeleteMatchResult(team, index) {
  if (!team || !Array.isArray(team.matchLog)) return null;
  const [removed] = team.matchLog.splice(index, 1);
  if (removed && removed.id) wcDeleteMatchResultFromCloud(removed.id).catch(() => {});
  return removed || null;
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

// ---------------------------------------------------------------------------
// Milestone 28: cloud sync of INDIVIDUAL logged results, into a normalized
// match_results table -- separate from the whole-team upsert above, and
// from team.matchLog's own JSON-column mirror (0004_team_match_log.sql,
// still how a team's own history round-trips to another device). This is
// what a database trigger (supabase/migrations/0005_meta_usage_stats.sql)
// re-aggregates into meta_usage_stats: an anonymized, cross-user table of
// "how often is this species used/faced, and how often does it win" that
// Dream Team, Auto-build team, and Auto-build strategy all read as a real-
// world supplement to the hand-curated threat list (see
// wcAugmentThreatsWithMetaUsage/wcMetaUsageCandidateBonus in strategy.js).
//
// Logging (and therefore this) already requires a signed-in account --
// see wcRequireAccount's guard on every "log a result" button -- so every
// call here always has a real userId. Fire-and-forget, same shape as
// every other cloud call in this file: a network hiccup must never block
// or fail a log/delete that already succeeded locally.
// ---------------------------------------------------------------------------

async function wcPushMatchResultToCloud(entry, teamId, format, teamSnapshot, lineupUsed) {
  if (typeof window === "undefined" || !window.wcSupabase) return;
  const userId = window.wcAuth && window.wcAuth.isSignedIn() ? window.wcAuth.getUserId() : null;
  if (!userId) return;
  try {
    const { error } = await window.wcSupabase.from("match_results").insert({
      id: entry.id,
      team_id: teamId,
      user_id: userId,
      result: entry.result,
      note: entry.note,
      opponent: entry.opponent,
      format,
      team_snapshot: teamSnapshot,
      lineup_used: lineupUsed || [],
      lineup_key: wcComputeLineupKey(lineupUsed),
      logged_at: entry.loggedAt,
    });
    if (error) console.warn("WinCon: this result saved to your team, but couldn't sync to the shared stats", error.message);
  } catch (err) {
    console.warn("WinCon: this result saved to your team, but couldn't sync to the shared stats", err && err.message);
  }
}

async function wcDeleteMatchResultFromCloud(entryId) {
  if (typeof window === "undefined" || !window.wcSupabase) return;
  const userId = window.wcAuth && window.wcAuth.isSignedIn() ? window.wcAuth.getUserId() : null;
  if (!userId) return;
  try {
    const { error } = await window.wcSupabase.from("match_results").delete().eq("id", entryId).eq("user_id", userId);
    if (error) console.warn("WinCon: deleted locally, but couldn't remove this result from the shared stats", error.message);
  } catch (err) {
    console.warn("WinCon: deleted locally, but couldn't remove this result from the shared stats", err && err.message);
  }
}

/**
 * The anonymized, cross-user aggregate every logged battle feeds (see
 * supabase/migrations/0005_meta_usage_stats.sql) -- read-only to any
 * signed-in account by that table's own RLS policy, so this is never
 * called while signed out (Dream Team/Auto-build/Auto-build strategy are
 * already sign-in-only). Returns a plain lookup keyed by species name --
 * {timesUsed, winRateUsed, timesFaced, winRateFaced} -- for
 * wcAugmentThreatsWithMetaUsage/wcMetaUsageCandidateBonus (strategy.js) to
 * read. Never throws; an empty object on any error/timeout/missing SDK
 * reads to every caller exactly like "not enough data logged yet," which
 * early on (a brand new site, or just a handful of games) is often
 * literally true.
 */
async function wcFetchMetaUsageStats(format) {
  if (typeof window === "undefined" || !window.wcSupabase) return {};
  try {
    const selectResult = await wcWithTimeout(
      window.wcSupabase.from("meta_usage_stats").select("species, times_used, times_faced, win_rate_used, win_rate_faced").eq("format", format),
      5000
    );
    if (!selectResult) return {};
    const { data: rows, error } = selectResult;
    if (error || !rows) return {};
    const lookup = {};
    rows.forEach((row) => {
      lookup[row.species] = {
        timesUsed: row.times_used || 0,
        timesFaced: row.times_faced || 0,
        winRateUsed: row.win_rate_used,
        winRateFaced: row.win_rate_faced,
      };
    });
    return lookup;
  } catch {
    return {};
  }
}

/**
 * Simulated Win Rate feature: the combo-level sibling of
 * wcFetchMetaUsageStats above, reading the new combo_synergy_stats table
 * (supabase/migrations/0006_lineup_scope_and_combo_synergy.sql). Keyed
 * by combo_key (see wcComputeLineupKey) rather than a single species —
 * consumed by strategy.js's wcComboSynergyBonus, both as a lineup-
 * ranking nudge (battle-sim-lineup.js) and as an Auto-build signal.
 * Same defensive shape as every other cloud read in this file: any
 * failure just returns an empty lookup rather than blocking anything.
 */
async function wcFetchComboSynergyStats(format) {
  if (typeof window === "undefined" || !window.wcSupabase) return {};
  try {
    const selectResult = await wcWithTimeout(
      window.wcSupabase.from("combo_synergy_stats").select("combo_key, times_used, win_rate").eq("format", format),
      5000
    );
    if (!selectResult) return {};
    const { data: rows, error } = selectResult;
    if (error || !rows) return {};
    const lookup = {};
    rows.forEach((row) => {
      lookup[row.combo_key] = { timesUsed: row.times_used || 0, winRate: row.win_rate };
    });
    return lookup;
  } catch {
    return {};
  }
}

/**
 * Milestone 34 (the Limitless pipeline): the live, cross-user usage/win-rate
 * lookup sourced from real Regulation M-B tournament results, kept fresh by
 * the api/cron-limitless-sync.js Vercel Cron job — NOT by anything this
 * page does directly. Reads live_tier_stats (supabase/migrations/
 * 0007_live_limitless_meta.sql), same read-only-to-signed-in RLS shape and
 * same defensive "never throws, {} on any failure" contract as
 * wcFetchMetaUsageStats above. Keyed by species name -> {timesUsed,
 * winRate} for wcAugmentThreatsWithLiveMeta (strategy.js) to read.
 *
 * IMPORTANT: Limitless only tracks Doubles (game=VGC) tournaments — there
 * is no official Singles tournament format to pull from (see README's
 * Milestone 34 section). A `format: "singles"` call always resolves to {}
 * for that reason, not because of any fetch failure — Singles keeps
 * relying entirely on data/meta-baseline.json's curated fallback and
 * WinCon's own logged battles, exactly as before this milestone existed.
 */
async function wcFetchLiveTierStats(format) {
  if (format === "singles") return {};
  if (typeof window === "undefined" || !window.wcSupabase) return {};
  try {
    const selectResult = await wcWithTimeout(
      window.wcSupabase.from("live_tier_stats").select("species, times_used, win_rate").eq("format", format),
      5000
    );
    if (!selectResult) return {};
    const { data: rows, error } = selectResult;
    if (error || !rows) return {};
    const lookup = {};
    rows.forEach((row) => {
      lookup[row.species] = { timesUsed: row.times_used || 0, winRate: row.win_rate };
    });
    return lookup;
  } catch {
    return {};
  }
}

/**
 * Milestone 34 sibling to wcFetchLiveTierStats above, reading full real
 * tournament teams from live_reference_teams instead of per-species
 * aggregates. NOT currently wired into any UI or into Simulated Win Rate's
 * opponent pool — Milestone 34's own research confirmed a Limitless
 * decklist has no Stat Points/EV-equivalent field, so a row here can't be
 * turned into a battle-ready spec the way battle-sim-lineup.js's
 * wcBattlerSpecForSlot needs (see that migration's own header comment).
 * This exists now so a future feature (e.g. "real teams from this event")
 * has a ready-to-use fetch helper the moment one's built, following this
 * file's existing pattern exactly. Same Doubles-only / defensive-empty-
 * object contract as wcFetchLiveTierStats.
 */
async function wcFetchLiveReferenceTeams(format) {
  if (format === "singles") return [];
  if (typeof window === "undefined" || !window.wcSupabase) return [];
  try {
    const selectResult = await wcWithTimeout(
      window.wcSupabase
        .from("live_reference_teams")
        .select("source_tournament_name, placement, record_wins, record_losses, record_ties, members")
        .eq("format", format)
        .order("captured_at", { ascending: false })
        .limit(50),
      5000
    );
    if (!selectResult) return [];
    const { data: rows, error } = selectResult;
    if (error || !rows) return [];
    return rows;
  } catch {
    return [];
  }
}

/**
 * "Untapped gem" follow-up to Milestone 34: Auto-build/Dream Team only
 * ever proactively opts a base species into one of its own Mega forms
 * when there's a real, verified set behind that Mega -- historically
 * only WINCON_META_KNOWN_SETS (strategy.js), a short hand-curated list.
 * This reads live_meta_builds -- the same table wcFetchLiveTierStats
 * reads from a different angle -- so a Mega WinCon hasn't hand-curated
 * yet can still get proactively picked once real Regulation M-B
 * tournament results actually confirm someone's fielding it (see
 * wcLiveMegaSetFor in strategy.js for how a build row here, which is
 * keyed by the BASE species name since that's how a real decklist names
 * a Pokémon that Mega Evolves in-battle, gets matched back to a specific
 * Mega form via its own Mega Stone item).
 *
 * Returns { [baseSpeciesName]: [{ item, moves, timesUsed, winRate }, ...] }
 * -- every distinct real build signature seen for that species, not just
 * Mega-stone ones, so wcLiveMegaSetFor can filter for the stone it cares
 * about itself. Same Doubles-only / defensive-empty-object contract as
 * wcFetchLiveTierStats -- {} whenever there's nothing to offer yet.
 */
async function wcFetchLiveMetaBuilds(format) {
  if (format === "singles") return {};
  if (typeof window === "undefined" || !window.wcSupabase) return {};
  try {
    const selectResult = await wcWithTimeout(
      window.wcSupabase.from("live_meta_builds").select("species, item, moves, times_used, win_rate").eq("format", format),
      5000
    );
    if (!selectResult) return {};
    const { data: rows, error } = selectResult;
    if (error || !rows) return {};
    const bySpecies = {};
    rows.forEach((row) => {
      if (!bySpecies[row.species]) bySpecies[row.species] = [];
      bySpecies[row.species].push({
        item: row.item || "",
        moves: Array.isArray(row.moves) ? row.moves : [],
        timesUsed: row.times_used || 0,
        winRate: row.win_rate,
      });
    });
    return bySpecies;
  } catch {
    return {};
  }
}
