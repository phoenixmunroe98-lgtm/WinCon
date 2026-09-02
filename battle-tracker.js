// WinCon — Battle Tracker (Milestone 28)
//
// Everything about logging a real game's result, and its full history,
// used to live on the Singles/Doubles Builder pages (see builder.js's own
// Milestone 28 comment where that section used to be). This page is that
// whole feature, pulled out on its own: pick any one of your saved teams
// (either format), log a win/loss with an optional note and opponent
// lineup, see a combined summary across every team plus that one team's
// own record and history, and delete a mistaken entry (with a
// confirmation, so a stray click can't silently erase a real result).
//
// Logging a result still writes to that team's own team.matchLog (via
// wcRecordMatchResult in teams.js) -- this page doesn't introduce a new
// storage shape, it's the same data the Builder pages' compact win/loss
// percentage already reads, just with its own dedicated page for the
// detail. What IS new this milestone: every logged result also gets
// pushed (fire-and-forget, signed-in only) to the shared match_results
// table, which a database trigger re-aggregates into meta_usage_stats --
// an anonymized, cross-user "how often is this species used/faced, and
// how often does it win" table that Dream Team/Auto-build team/Auto-build
// strategy read as a real-world supplement to the curated matchup data
// (see wcAugmentThreatsWithMetaUsage/wcMetaUsageCandidateBonus in
// strategy.js). See supabase/migrations/0005_meta_usage_stats.sql for the
// full mechanics and README.md's Milestone 28 section for the writeup.
//
// This whole page requires a signed-in account -- same allowance as the
// rest of the toolkit past picking your six (Matchup Score, Your Rival,
// saving/naming teams): there's no meaningful "battle tracker" without an
// account to keep it attached to, so this doesn't offer a signed-out
// preview the way picking Pokémon does.

const OPPONENT_SLOT_COUNT = 6;
const HISTORY_RECENT_LIMIT = 25;

let teamState = { teams: [], activeId: null };
let selectedTeamId = null;
let signedIn = false;
let allPokemonNames = [];

const trackerLockedEl = document.getElementById("tracker-locked");
const trackerNoTeamEl = document.getElementById("tracker-no-team");
const trackerBodyEl = document.getElementById("tracker-body");
const combinedSummaryEl = document.getElementById("combined-summary");
const teamTabsEl = document.getElementById("tracker-team-tabs");
const teamSummaryTitleEl = document.getElementById("team-summary-title");
const teamSummaryEl = document.getElementById("team-summary");
const teamStreakEl = document.getElementById("team-streak");
const trackerNoteInput = document.getElementById("tracker-note-input");
const trackerOpponentDetails = document.getElementById("tracker-opponent-details");
const trackerOpponentGrid = document.getElementById("tracker-opponent-grid");
const trackerLogListEl = document.getElementById("tracker-log-list");

const modalOverlay = document.getElementById("changes-modal");
const modalTitle = document.getElementById("changes-modal-title");
const modalBody = document.getElementById("changes-modal-body");
const modalActions = document.getElementById("changes-modal-actions");

init();

async function init() {
  try {
    allPokemonNames = (await (await fetch("data/pokemon.json")).json()).map((p) => p.name);
  } catch {
    allPokemonNames = []; // the opponent-name datalist just won't autocomplete -- logging still works
  }
  setupOpponentGrid();

  document.getElementById("tracker-log-win-btn").addEventListener("click", () => logResult("win"));
  document.getElementById("tracker-log-loss-btn").addEventListener("click", () => logResult("loss"));
  const lockedSigninBtn = document.getElementById("tracker-locked-signin-btn");
  if (lockedSigninBtn) {
    lockedSigninBtn.addEventListener("click", () => {
      if (window.wcAuth && window.wcAuth.openModal) window.wcAuth.openModal("signup");
    });
  }

  await refreshForAuth();

  // Milestone 28: re-syncs live on sign-in/sign-out, same pattern as every
  // other page's wc:auth-changed listener -- signing in loads this
  // account's real teams/history into view; signing out clears the page
  // back to the locked callout.
  window.addEventListener("wc:auth-changed", refreshForAuth);
}

async function refreshForAuth() {
  signedIn = await wcHasRealSession();
  if (!signedIn) {
    trackerLockedEl.hidden = false;
    trackerNoTeamEl.hidden = true;
    trackerBodyEl.hidden = true;
    return;
  }
  trackerLockedEl.hidden = true;

  teamState = await wcLoadAndSyncTeamState();
  if (teamState.teams.length === 0) {
    trackerNoTeamEl.hidden = false;
    trackerBodyEl.hidden = true;
    return;
  }
  trackerNoTeamEl.hidden = true;
  trackerBodyEl.hidden = false;

  if (!selectedTeamId || !teamState.teams.some((t) => t.id === selectedTeamId)) {
    selectedTeamId = (teamState.activeId && teamState.teams.some((t) => t.id === teamState.activeId) ? teamState.activeId : teamState.teams[0].id);
  }

  renderAll();
}

function getSelectedTeam() {
  return teamState.teams.find((t) => t.id === selectedTeamId) || null;
}

function renderAll() {
  renderCombinedSummary();
  renderTeamTabs();
  renderTeamSection();
  renderHistory();
}

// ---------------------------------------------------------------------------
// Win/loss stat pills -- a small duplicated copy of builder.js's own
// helpers (same duplicated-small-helper pattern as wcShowAccountPopup
// elsewhere in this project), so this page renders the exact same
// green/orange/red treatment without builder.js needing to export
// anything to a page it doesn't otherwise share code with.
// ---------------------------------------------------------------------------

function wcStatGradientVars(goodnessPercent) {
  const pct = Math.max(0, Math.min(100, goodnessPercent));
  let fromColor, toColor, fromSoft, toSoft, mix;
  if (pct <= 35) {
    fromColor = "var(--negative)";
    toColor = "var(--mediocre)";
    fromSoft = "var(--negative-soft)";
    toSoft = "var(--mediocre-soft)";
    mix = (pct / 35) * 100;
  } else if (pct <= 80) {
    fromColor = "var(--mediocre)";
    toColor = "var(--stat-positive)";
    fromSoft = "var(--mediocre-soft)";
    toSoft = "var(--stat-positive-soft)";
    mix = ((pct - 35) / 45) * 100;
  } else {
    fromColor = "var(--stat-positive)";
    toColor = "var(--stat-positive)";
    fromSoft = "var(--stat-positive-soft)";
    toSoft = "var(--stat-positive-soft)";
    mix = 0;
  }
  return {
    color: `color-mix(in srgb, ${fromColor}, ${toColor} ${mix}%)`,
    soft: `color-mix(in srgb, ${fromSoft}, ${toSoft} ${mix}%)`,
  };
}

/** Win:loss expressed as a simplified whole-number ratio from actual logged game counts (e.g. 6 wins/3 losses -> "2 : 1"). */
function wcFormatRatioFromCounts(wins, losses) {
  if (wins === 0 && losses === 0) return "—";
  if (losses === 0) return "All wins";
  if (wins === 0) return "All losses";
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(wins, losses);
  return `${wins / g} : ${losses / g}`;
}

/** One labeled, gradient-colored stat box for a winloss-row. goodnessPercent (0-100) drives where on the red->yellow->green gradient this box's color/background lands. */
function wcBuildWinLossStat(label, valueText, goodnessPercent) {
  const box = document.createElement("div");
  box.className = "winloss-stat";
  const gradient = wcStatGradientVars(goodnessPercent);
  box.style.setProperty("--stat-color", gradient.color);
  box.style.setProperty("--stat-soft", gradient.soft);
  const lab = document.createElement("p");
  lab.className = "winloss-stat-label";
  lab.textContent = label;
  const val = document.createElement("p");
  val.className = "winloss-stat-value";
  val.textContent = valueText;
  box.append(lab, val);
  return box;
}

/** Renders a wcMatchRecordSummary()-shaped {wins, losses, total, winRate} into `mount` as a caption + winloss-row, or a "nothing logged yet" hint when total is 0. Shared by the combined summary and the per-team summary below so they read identically. */
function renderSummaryInto(mount, summary, nothingYetText) {
  mount.innerHTML = "";
  if (summary.total === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.style.margin = "0";
    p.textContent = nothingYetText;
    mount.appendChild(p);
    return;
  }
  const lossRate = Math.round((summary.losses / summary.total) * 100);
  const caption = document.createElement("p");
  caption.className = "hint";
  caption.style.margin = "0 0 8px";
  caption.textContent = `${summary.wins}W – ${summary.losses}L across ${summary.total} logged game${summary.total === 1 ? "" : "s"}.`;
  const row = document.createElement("div");
  row.className = "winloss-row";
  row.append(
    wcBuildWinLossStat("Win rate", `${summary.winRate}%`, summary.winRate),
    wcBuildWinLossStat("Loss rate", `${lossRate}%`, 100 - lossRate),
    wcBuildWinLossStat("Win ratio", wcFormatRatioFromCounts(summary.wins, summary.losses), summary.winRate)
  );
  mount.append(caption, row);
}

/** A streak line ("On a 3-game win streak.") from the tail of a matchLog, in chronological order -- empty string when there's nothing logged, so callers can just set textContent directly. */
function describeStreak(matchLog) {
  const log = Array.isArray(matchLog) ? matchLog : [];
  if (log.length === 0) return "";
  const last = log[log.length - 1].result;
  let streak = 0;
  for (let i = log.length - 1; i >= 0 && log[i].result === last; i--) streak++;
  if (streak <= 1) return "";
  return last === "win" ? `On a ${streak}-game win streak.` : `On a ${streak}-game losing streak.`;
}

function renderCombinedSummary() {
  const wins = teamState.teams.reduce((sum, t) => sum + (Array.isArray(t.matchLog) ? t.matchLog.filter((e) => e.result === "win").length : 0), 0);
  const losses = teamState.teams.reduce((sum, t) => sum + (Array.isArray(t.matchLog) ? t.matchLog.filter((e) => e.result === "loss").length : 0), 0);
  const total = wins + losses;
  const summary = { wins, losses, total, winRate: total > 0 ? Math.round((wins / total) * 100) : null };
  renderSummaryInto(combinedSummaryEl, summary, "Nothing logged yet across any of your teams — log your first result below.");
}

function renderTeamTabs() {
  teamTabsEl.innerHTML = "";
  teamState.teams.forEach((team) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "team-tab" + (team.id === selectedTeamId ? " is-active" : "");
    const formatLabel = wcGetTeamFormat(team) === "singles" ? "Singles" : "Doubles";
    tab.textContent = `${team.name || "Untitled team"} (${formatLabel})`;
    tab.addEventListener("click", () => {
      selectedTeamId = team.id;
      renderTeamTabs();
      renderTeamSection();
      renderHistory();
    });
    teamTabsEl.appendChild(tab);
  });
}

function renderTeamSection() {
  const team = getSelectedTeam();
  if (!team) return;
  teamSummaryTitleEl.textContent = `Record — ${team.name || "Untitled team"}`;
  const summary = wcMatchRecordSummary(team);
  renderSummaryInto(teamSummaryEl, summary, "No results logged yet for this team.");
  teamStreakEl.textContent = describeStreak(team.matchLog);
}

function setupOpponentGrid() {
  const datalistId = "tracker-opponent-options";
  if (!document.getElementById(datalistId)) {
    const datalist = document.createElement("datalist");
    datalist.id = datalistId;
    allPokemonNames.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      datalist.appendChild(opt);
    });
    document.body.appendChild(datalist);
  }

  trackerOpponentGrid.innerHTML = "";
  for (let i = 0; i < OPPONENT_SLOT_COUNT; i++) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tracker-opponent-input";
    input.setAttribute("list", datalistId);
    input.placeholder = `Opponent Pokémon ${i + 1} (optional)`;
    trackerOpponentGrid.appendChild(input);
  }
}

function collectOpponentTeam() {
  return [...trackerOpponentGrid.querySelectorAll(".tracker-opponent-input")].map((input) => input.value);
}

function clearOpponentTeam() {
  trackerOpponentGrid.querySelectorAll(".tracker-opponent-input").forEach((input) => (input.value = ""));
  trackerOpponentDetails.open = false;
}

function logResult(result) {
  const team = getSelectedTeam();
  if (!team || !signedIn) return;
  wcRecordMatchResult(team, result, trackerNoteInput.value, collectOpponentTeam());
  trackerNoteInput.value = "";
  clearOpponentTeam();
  wcSaveTeamState(teamState);
  renderAll();
}

// ---------------------------------------------------------------------------
// Delete a logged result -- with a confirmation, so a stray click can't
// silently erase a real one. Reuses the same generic modal markup/pattern
// builder.js's own "Apply strategy changes" flow uses (#changes-modal).
// ---------------------------------------------------------------------------

function showModal({ title, body, actions }) {
  modalTitle.textContent = title;
  modalBody.textContent = body;
  modalActions.innerHTML = "";
  actions.forEach((action) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = action.primary ? "btn-primary" : "btn-secondary";
    btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    modalActions.appendChild(btn);
  });
  modalOverlay.hidden = false;
}

function hideModal() {
  modalOverlay.hidden = true;
  modalActions.innerHTML = "";
}

function confirmDeleteResult(index) {
  showModal({
    title: "Delete log (I made a mistake)",
    body: "Confirm:",
    actions: [
      {
        label: "Yes",
        primary: true,
        onClick: () => {
          hideModal();
          deleteResult(index);
        },
      },
      { label: "No", onClick: hideModal },
    ],
  });
}

function deleteResult(index) {
  const team = getSelectedTeam();
  if (!team) return;
  wcDeleteMatchResult(team, index);
  wcSaveTeamState(teamState);
  renderAll();
}

function renderHistory() {
  const team = getSelectedTeam();
  trackerLogListEl.innerHTML = "";
  if (!team) return;

  const log = Array.isArray(team.matchLog) ? team.matchLog : [];
  const recentIndexed = log.map((entry, index) => ({ entry, index })).slice(-HISTORY_RECENT_LIMIT).reverse();

  if (log.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "No results logged yet for this team.";
    trackerLogListEl.appendChild(li);
    return;
  }

  if (log.length > HISTORY_RECENT_LIMIT) {
    const olderNote = document.createElement("li");
    olderNote.className = "hint";
    olderNote.textContent = `Showing the ${HISTORY_RECENT_LIMIT} most recent of ${log.length} logged games.`;
    trackerLogListEl.appendChild(olderNote);
  }

  recentIndexed.forEach(({ entry, index }) => {
    const li = document.createElement("li");
    li.className = `tracker-log-entry tracker-log-${entry.result}`;

    const resultTag = document.createElement("span");
    resultTag.className = "tracker-log-result";
    resultTag.textContent = entry.result === "win" ? "Win" : "Loss";
    li.appendChild(resultTag);

    if (entry.note) {
      const noteSpan = document.createElement("span");
      noteSpan.className = "tracker-log-note";
      noteSpan.textContent = entry.note;
      li.appendChild(noteSpan);
    }

    if (Array.isArray(entry.opponent) && entry.opponent.length > 0) {
      const opponentSpan = document.createElement("span");
      opponentSpan.className = "tracker-log-opponent";
      opponentSpan.textContent = `vs. ${entry.opponent.join(", ")}`;
      li.appendChild(opponentSpan);
    }

    const dateSpan = document.createElement("span");
    dateSpan.className = "tracker-log-date";
    const parsed = new Date(entry.loggedAt);
    dateSpan.textContent = Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString();
    li.appendChild(dateSpan);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "tracker-log-delete";
    deleteBtn.setAttribute("aria-label", "Delete this logged result");
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", () => confirmDeleteResult(index));
    li.appendChild(deleteBtn);

    trackerLogListEl.appendChild(li);
  });
}
