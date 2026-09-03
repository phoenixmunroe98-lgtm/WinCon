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

/** Same Stat-Point constants as builder.js (SP_TOTAL_CAP/STATS) -- duplicated here rather than shared, same small-duplicated-helper pattern as wcBuildWinLossStat above, since this page has no other reason to load builder.js. Used only by wcTeamIsSimReady() below. */
const SP_TOTAL_CAP = 66;
const STAT_KEYS = ["hp", "attack", "defense", "sp_attack", "sp_defense", "speed"];

let teamState = { teams: [], activeId: null };
let selectedTeamId = null;
let signedIn = false;
let allPokemonNames = [];

// Simulated Win Rate: the bring-N lineup the player is about to log a
// result for (Milestone 33) -- reset whenever the selected team changes.
// See renderLineupPicker()/toggleLineupPick() below.
let selectedLineup = [];

// Simulated Win Rate: static data this page needs ONLY to run the Team vs
// Team matchup simulator (battle-sim-worker.js) -- none of it is needed
// for logging results/history, which is why this page never fetched any
// of it before Milestone 33. Loaded once in init(), alongside the
// existing allPokemonNames fetch.
let matchupPokemonList = [];
let matchupBaseStatsData = [];
let matchupAbilitiesData = {};
let matchupMovesData = [];
let matchupNaturesData = [];
let matchupTypeChartData = null;
let matchupMoveEffectsData = {};
let matchupAbilityEffectsData = {};
let matchupItemEffectsData = {};

// Simulated Win Rate: Team vs Team matchup state -- which format's teams
// are being offered, which two are picked, and (per format) the real
// cross-user combo-synergy lookup used to help rank each side's own best
// lineup (same data combo_synergy_stats feeds Auto-build's scoring with
// on the Builder pages -- see wcFetchComboSynergyStats in teams.js).
let matchupFormat = "doubles";
let matchupTeamAId = null;
let matchupTeamBId = null;
let matchupComboLookupByFormat = {};
let matchupInFlight = false;

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

const trackerLineupHintEl = document.getElementById("tracker-lineup-hint");
const trackerLineupGridEl = document.getElementById("tracker-lineup-grid");
const trackerLogWinBtn = document.getElementById("tracker-log-win-btn");
const trackerLogLossBtn = document.getElementById("tracker-log-loss-btn");

const matchupFormatToggleEl = document.getElementById("matchup-format-toggle");
const matchupTeamASelect = document.getElementById("matchup-team-a");
const matchupTeamBSelect = document.getElementById("matchup-team-b");
const matchupRunBtn = document.getElementById("matchup-run-btn");
const matchupHintEl = document.getElementById("matchup-hint");
const matchupLoadingEl = document.getElementById("matchup-loading");
const matchupResultEl = document.getElementById("matchup-result");

const modalOverlay = document.getElementById("changes-modal");
const modalTitle = document.getElementById("changes-modal-title");
const modalBody = document.getElementById("changes-modal-body");
const modalActions = document.getElementById("changes-modal-actions");

init();

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Couldn't load ${path} (${response.status})`);
  return response.json();
}

async function init() {
  try {
    const [pokemon, moves, natures, baseStats, typeChart, abilities, moveEffects, abilityEffects, itemEffects] = await Promise.all([
      fetchJSON("data/pokemon.json"),
      fetchJSON("data/moves.json"),
      fetchJSON("data/natures.json"),
      fetchJSON("data/base-stats.json"),
      fetchJSON("data/type-chart.json"),
      fetchJSON("data/abilities.json"),
      fetchJSON("data/move-effects.json"),
      fetchJSON("data/ability-effects.json"),
      fetchJSON("data/item-effects.json"),
    ]);
    allPokemonNames = pokemon.map((p) => p.name);
    matchupPokemonList = pokemon;
    matchupMovesData = moves;
    matchupNaturesData = natures;
    matchupBaseStatsData = baseStats;
    matchupTypeChartData = typeChart;
    matchupAbilitiesData = abilities;
    matchupMoveEffectsData = moveEffects;
    matchupAbilityEffectsData = abilityEffects;
    matchupItemEffectsData = itemEffects;
  } catch {
    // The opponent-name datalist just won't autocomplete, and Team vs Team
    // won't be able to run -- logging results/history still works either
    // way, since neither depends on any of this.
    allPokemonNames = [];
  }
  setupOpponentGrid();

  trackerLogWinBtn.addEventListener("click", () => logResult("win"));
  trackerLogLossBtn.addEventListener("click", () => logResult("loss"));
  if (matchupFormatToggleEl) {
    matchupFormatToggleEl.querySelectorAll(".format-option").forEach((btn) => {
      btn.addEventListener("click", () => setMatchupFormat(btn.dataset.format));
    });
  }
  if (matchupRunBtn) matchupRunBtn.addEventListener("click", runMatchup);
  if (matchupTeamASelect) matchupTeamASelect.addEventListener("change", () => { matchupTeamAId = matchupTeamASelect.value; });
  if (matchupTeamBSelect) matchupTeamBSelect.addEventListener("change", () => { matchupTeamBId = matchupTeamBSelect.value; });
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

  const previousSelectedTeamId = selectedTeamId;
  if (!selectedTeamId || !teamState.teams.some((t) => t.id === selectedTeamId)) {
    selectedTeamId = (teamState.activeId && teamState.teams.some((t) => t.id === teamState.activeId) ? teamState.activeId : teamState.teams[0].id);
  }
  if (selectedTeamId !== previousSelectedTeamId) selectedLineup = [];

  renderAll();
}

function getSelectedTeam() {
  return teamState.teams.find((t) => t.id === selectedTeamId) || null;
}

function renderAll() {
  renderCombinedSummary();
  renderTeamTabs();
  renderTeamSection();
  renderLineupPicker();
  renderHistory();
  refreshMatchupTeamOptions();
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
      selectedLineup = []; // a different team's own 6 -- any lineup picked for the old one no longer applies
      renderTeamTabs();
      renderTeamSection();
      renderLineupPicker();
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

/**
 * Milestone 33 (Simulated Win Rate): the required bring-N picker -- chips
 * for the selected team's own 6 (or however many it actually has, for an
 * older/incomplete team), capped at wcRequiredBringCount(format) selected
 * at once. Log a win/Log a loss stay disabled (see updateLogButtonsEnabled
 * below) until exactly that many are picked, so a result can never be
 * logged against the wrong number of Pokémon or silently credited to all 6.
 */
function renderLineupPicker() {
  const team = getSelectedTeam();
  trackerLineupGridEl.innerHTML = "";
  if (!team) {
    trackerLineupHintEl.textContent = "";
    updateLogButtonsEnabled();
    return;
  }

  const format = wcGetTeamFormat(team);
  const required = wcRequiredBringCount(format);
  const roster = Array.isArray(team.chosen) ? team.chosen : [];
  selectedLineup = selectedLineup.filter((name) => roster.includes(name));

  trackerLineupHintEl.textContent =
    roster.length === 0
      ? "This team doesn't have any Pokémon picked yet — build it on the Builder page first."
      : `Which ${required} of your ${roster.length} did you actually bring this game? (${selectedLineup.length} of ${required} picked)`;

  roster.forEach((name) => {
    const isChosen = selectedLineup.includes(name);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "pick-chip" + (isChosen ? " is-chosen" : "");
    chip.textContent = name;
    chip.disabled = !isChosen && selectedLineup.length >= required;
    chip.addEventListener("click", () => toggleLineupPick(name, required));
    trackerLineupGridEl.appendChild(chip);
  });

  updateLogButtonsEnabled();
}

function toggleLineupPick(name, required) {
  const index = selectedLineup.indexOf(name);
  if (index >= 0) {
    selectedLineup.splice(index, 1);
  } else if (selectedLineup.length < required) {
    selectedLineup.push(name);
  }
  renderLineupPicker();
}

/** Log a win/Log a loss only ever unlock once the lineup picker above has exactly the real bring-N count selected -- never "all 6" (per Phoenix's own request: "look at the 4 selected pokemon... dont offer all 6"). */
function updateLogButtonsEnabled() {
  const team = getSelectedTeam();
  const required = team ? wcRequiredBringCount(wcGetTeamFormat(team)) : 0;
  const ready = Boolean(team) && selectedLineup.length === required;
  trackerLogWinBtn.disabled = !ready;
  trackerLogLossBtn.disabled = !ready;
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
  const required = wcRequiredBringCount(wcGetTeamFormat(team));
  if (selectedLineup.length !== required) return; // belt-and-suspenders -- the buttons are disabled until this holds, see updateLogButtonsEnabled()
  wcRecordMatchResult(team, result, trackerNoteInput.value, collectOpponentTeam(), [...selectedLineup]);
  trackerNoteInput.value = "";
  clearOpponentTeam();
  selectedLineup = [];
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

// ---------------------------------------------------------------------------
// Simulated Win Rate: Team vs Team matchup table (Milestone 33). Two of
// the player's own saved teams, same format, simulated head-to-head with
// the real mechanical battle engine (battle-sim-worker.js/battle-sim-
// lineup.js's wcSimulateTeamVsTeam) -- each side gets its own best bring-N
// lineup chosen specifically against the OTHER team, not a general
// reference field. Entirely independent of the single-team log/history
// flow above; see matchupFormat/matchupTeamAId/matchupTeamBId state near
// the top of this file.
// ---------------------------------------------------------------------------

function setMatchupFormat(format) {
  matchupFormat = format === "singles" ? "singles" : "doubles";
  matchupTeamAId = null;
  matchupTeamBId = null;
  matchupResultEl.hidden = true;
  matchupResultEl.innerHTML = "";
  matchupHintEl.textContent = "";
  refreshMatchupTeamOptions();
}

/** Rebuilds both team <select>s from wcListTeamsByFormat(teamState, matchupFormat), preserving each side's current pick when it's still valid for this format. Called on every renderAll() (a team could get renamed/deleted/moved format at any time) and whenever the format toggle changes. */
function refreshMatchupTeamOptions() {
  if (!matchupFormatToggleEl) return;
  matchupFormatToggleEl.querySelectorAll(".format-option").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.format === matchupFormat);
  });

  const teams = wcListTeamsByFormat(teamState, matchupFormat);
  const fillSelect = (select, currentId) => {
    select.innerHTML = "";
    teams.forEach((team) => {
      const opt = document.createElement("option");
      opt.value = team.id;
      opt.textContent = team.name || "Untitled team";
      select.appendChild(opt);
    });
    if (currentId && teams.some((t) => t.id === currentId)) {
      select.value = currentId;
      return currentId;
    }
    return teams.length > 0 ? teams[0].id : null;
  };

  matchupTeamAId = fillSelect(matchupTeamASelect, matchupTeamAId);
  // Default Team B to the second team when nothing's picked yet, so the
  // two selects don't just silently start on the same team.
  const preferredB = matchupTeamBId || (teams.length > 1 ? teams[1].id : teams[0] && teams[0].id) || null;
  matchupTeamBId = fillSelect(matchupTeamBSelect, preferredB);

  if (teams.length === 0) {
    matchupHintEl.textContent = `You don't have any saved ${matchupFormat === "singles" ? "Singles" : "Doubles"} teams yet.`;
  } else if (teams.length === 1) {
    matchupHintEl.textContent = `You only have one saved ${matchupFormat === "singles" ? "Singles" : "Doubles"} team — save a second one to run a matchup.`;
  } else {
    matchupHintEl.textContent = "";
  }
  matchupRunBtn.disabled = teams.length < 2;
}

/**
 * The same completeness bar as builder.js's isTeamComplete() (Nature,
 * item, all 4 moves, all 66 Stat Points on every one of the 6) -- small
 * duplicated helper, same pattern as wcBuildWinLossStat above, since this
 * page has no other reason to load builder.js. Doesn't re-check for
 * duplicate items across the team the way isTeamComplete() does; a team
 * built on the Builder page would already have been blocked from saving
 * with a clash, so that check would only ever catch a team edited by hand
 * outside this app -- not worth the extra complexity here.
 */
function wcTeamIsSimReady(team) {
  const chosen = Array.isArray(team && team.chosen) ? team.chosen : [];
  if (chosen.length !== 6) return false;
  const builds = (team && team.builds) || {};
  return chosen.every((name) => {
    const build = builds[name];
    if (!build || !build.sp) return false;
    const spTotal = STAT_KEYS.reduce((sum, key) => sum + (build.sp[key] || 0), 0);
    const movesFilled = Array.isArray(build.moves) ? build.moves.filter(Boolean).length : 0;
    return Boolean(build.nature) && Boolean(build.item) && movesFilled === 4 && spTotal === SP_TOTAL_CAP;
  });
}

/** Builds one side's { chosen, builds, label } payload for wcSimulateTeamVsTeam. */
function buildMatchupTeamPayload(team) {
  return { chosen: [...team.chosen], builds: team.builds, label: team.name || "Untitled team" };
}

async function runMatchup() {
  if (matchupInFlight) return;
  const teamA = teamState.teams.find((t) => t.id === matchupTeamAId);
  const teamB = teamState.teams.find((t) => t.id === matchupTeamBId);
  matchupResultEl.hidden = true;
  matchupResultEl.innerHTML = "";

  if (!teamA || !teamB) {
    matchupHintEl.textContent = "Pick two saved teams first.";
    return;
  }
  if (teamA.id === teamB.id) {
    matchupHintEl.textContent = "Pick two different teams to run a matchup.";
    return;
  }
  if (!wcTeamIsSimReady(teamA) || !wcTeamIsSimReady(teamB)) {
    matchupHintEl.textContent =
      "Both teams need every field filled in first (Nature, item, all 4 moves, all 66 Stat Points on all 6) — finish building them on the Builder page, then come back here.";
    return;
  }
  if (!matchupTypeChartData) {
    matchupHintEl.textContent = "Reference data hasn't finished loading yet — try again in a moment.";
    return;
  }

  matchupInFlight = true;
  matchupRunBtn.disabled = true;
  matchupHintEl.textContent = "";
  matchupLoadingEl.hidden = false;

  try {
    if (!(matchupFormat in matchupComboLookupByFormat)) {
      matchupComboLookupByFormat[matchupFormat] = signedIn ? await wcFetchComboSynergyStats(matchupFormat) : {};
    }
    const payload = {
      teamA: buildMatchupTeamPayload(teamA),
      teamB: buildMatchupTeamPayload(teamB),
      format: matchupFormat,
      sheetMode: "closed", // Milestone 33: Team vs Team always assumes a fair, fully-informed sim on both sides -- neither team is "the ladder opponent" here, both are the player's own builds
      pokemonList: matchupPokemonList,
      baseStatsData: matchupBaseStatsData,
      abilitiesData: matchupAbilitiesData,
      movesData: matchupMovesData,
      moveEffects: matchupMoveEffectsData,
      abilityEffects: matchupAbilityEffectsData,
      itemEffects: matchupItemEffectsData,
      typeChart: matchupTypeChartData,
      natures: matchupNaturesData,
      comboLookup: matchupComboLookupByFormat[matchupFormat],
    };
    const result = await wcRunSimAsync("teamVsTeam", payload);
    renderMatchupResult(result, teamA.name || "Team A", teamB.name || "Team B");
  } catch (err) {
    matchupHintEl.textContent = "The simulation didn't finish — try Run Matchup again, or reload the page if it keeps failing.";
  } finally {
    matchupInFlight = false;
    matchupRunBtn.disabled = false;
    matchupLoadingEl.hidden = true;
  }
}

function renderMatchupResult(result, labelA, labelB) {
  matchupResultEl.innerHTML = "";
  matchupResultEl.hidden = false;

  const lineupPara = document.createElement("p");
  lineupPara.className = "hint matchup-lineups";
  lineupPara.textContent =
    `${labelA}'s best bring-${result.lineupA.length}-of-6 lineup: ${result.lineupA.join(", ")}. ` +
    `${labelB}'s best bring-${result.lineupB.length}-of-6 lineup: ${result.lineupB.join(", ")}.`;
  matchupResultEl.appendChild(lineupPara);

  if (result.grid.length === 1) {
    const winRateA = result.grid[0].winRateA;
    const pctA = Math.round(winRateA * 100);
    const pctB = 100 - pctA;
    const winner = pctA >= pctB ? labelA : labelB;
    const banner = document.createElement("div");
    banner.className = "winloss-block matchup-winner-banner";
    const heading = document.createElement("h3");
    heading.className = "section-title";
    heading.textContent = `${winner} is favored`;
    const row = document.createElement("div");
    row.className = "winloss-row";
    row.append(
      wcBuildWinLossStat(`${labelA}'s win rate`, `${pctA}%`, pctA),
      wcBuildWinLossStat(`${labelB}'s win rate`, `${pctB}%`, pctB)
    );
    banner.append(heading, row);
    matchupResultEl.appendChild(banner);
    return;
  }

  // Either side had 2 (or, capped, up to 3) Mega-eligible members -- show
  // the full grid instead of collapsing to one number, so neither team's
  // dual-Mega scenarios get silently averaged together.
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = `${labelA} has a choice of Mega Evolution here — each combination is simulated separately below (rows: ${labelA}, columns: ${labelB}). Percentages are ${labelA}'s win rate.`;
  matchupResultEl.appendChild(note);

  const megasA = [...new Set(result.grid.map((cell) => cell.megaA))];
  const megasB = [...new Set(result.grid.map((cell) => cell.megaB))];
  const table = document.createElement("table");
  table.className = "matchup-grid-table";
  const headRow = document.createElement("tr");
  headRow.appendChild(document.createElement("th"));
  megasB.forEach((megaB) => {
    const th = document.createElement("th");
    th.textContent = megaB ? `${labelB} Mega Evolves ${megaB}` : `${labelB}, no Mega`;
    headRow.appendChild(th);
  });
  table.appendChild(headRow);

  megasA.forEach((megaA) => {
    const row = document.createElement("tr");
    const rowLabel = document.createElement("th");
    rowLabel.textContent = megaA ? `${labelA} Mega Evolves ${megaA}` : `${labelA}, no Mega`;
    row.appendChild(rowLabel);
    megasB.forEach((megaB) => {
      const cellData = result.grid.find((c) => c.megaA === megaA && c.megaB === megaB);
      const td = document.createElement("td");
      td.textContent = cellData ? `${Math.round(cellData.winRateA * 100)}%` : "—";
      row.appendChild(td);
    });
    table.appendChild(row);
  });
  matchupResultEl.appendChild(table);
}
