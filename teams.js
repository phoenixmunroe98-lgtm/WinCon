// WinCon — shared multi-team storage (Milestone 3)
//
// Team drafts used to live under one localStorage key holding a single
// team (wincon.teamDraft). This app now supports up to 5 named, saved
// teams under one key (wincon.teams) — Team Builder, Matchup Score, and
// any future page all read/write this same shape so they never drift
// apart, and a first-time visit with an old single draft is migrated
// into "Team 1" automatically.

const WINCON_TEAMS_KEY = "wincon.teams";
const WINCON_LEGACY_DRAFT_KEY = "wincon.teamDraft";
const WINCON_MAX_TEAMS = 5;

let wcTeamIdCounter = 0;
function wcNewTeamId() {
  wcTeamIdCounter += 1;
  return `team-${Date.now()}-${wcTeamIdCounter}`;
}

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

function wcSaveTeamState(state) {
  try {
    localStorage.setItem(WINCON_TEAMS_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function wcGetActiveTeam(state) {
  if (!state.activeId) return null;
  return state.teams.find((t) => t.id === state.activeId) || null;
}
