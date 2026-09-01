// WinCon — Singles/Doubles Builder (Milestone 14)
//
// This file is shared by singles-builder.html and doubles-builder.html — it
// used to be two separate files (team-builder.js + matchup-score.js) until
// this milestone merged "build your team" and "see how it stacks up" into
// one page per competitive format, per the user's own research into
// competitive play. Each HTML page sets `window.WINCON_BUILDER_FORMAT`
// ("singles" or "doubles") in an inline <script> BEFORE this file loads —
// that's the only thing that differs between the two pages' behavior.
//
// What this page does, in order:
//   1. Loads Pokémon/moves/items/natures/learnsets/base-stats/threats/
//      type-chart data (same fetch list team-builder.js always used —
//      matchup-score.js's needs were always a subset of it)
//   2. Loads the shared pool of up to 5 saved, named teams (teams.js),
//      showing only the ones tagged for THIS page's format — switching a
//      team's format (see "Move to Singles/Doubles builder") moves it to
//      the other page instead of duplicating it
//   3. Shows a picker of your "obtained" Pokémon so you can choose 6 for
//      whichever team is active on this page
//   4. Renders one build card per chosen Pokémon: Nature, item, up to 4
//      moves, and a Stat Point allocator — same as before, plus an
//      Expected/Tech tag on each filled move field once Open Team Sheet
//      mode is on (see the OTS section below)
//   5. Auto-generate buttons (strategy.js) that fill in builds and detect
//      a shared team strategy — unchanged from before
//   6. Matchup Score + Team type coverage + a results tracker, live
//      against whatever's currently picked/built above — this used to be
//      matchup-score.js reading a separately-selected saved team; now it's
//      always scoring the team you're actively editing on this page
//   7. "Your Rival" — synthesizes a hypothetical 6-Pokémon team from the
//      FULL roster (not just what you've obtained), picked specifically to
//      counter this team's typing/stats, plus an estimated success rate
//      for it against you
//   8. An Open Team Sheet (OTS) toggle — real VGC/competitive-play
//      concept: on the online ladder, nobody's ever seen your set before
//      Game 1; in tournament play, your opponent has your full team sheet
//      (species/items/abilities/moves) ahead of time, so a "tech" move
//      that only works as a surprise stops being one. Per your own
//      research notes, this toggle affects BOTH the Matchup Score/Your
//      Rival numbers (a move-dependent "favorable" verdict downgrades to
//      "even" — see wcScoreMatchup in strategy.js) AND the move
//      recommendations (Auto-build's move scoring penalizes an
//      off-type/non-Status filler pick, and every filled move field gets
//      an Expected/Tech tag so you can see at a glance which of your
//      moves are actually surprises worth keeping under Closed Sheet).

const OBTAINED_KEY = "wincon.obtained";
const SP_TOTAL_CAP = 66;
const SP_STAT_CAP = 32;
const STATS = [
  { key: "hp", label: "HP" },
  { key: "attack", label: "Attack" },
  { key: "defense", label: "Defense" },
  { key: "sp_attack", label: "Sp. Atk" },
  { key: "sp_defense", label: "Sp. Def" },
  { key: "speed", label: "Speed" },
];

/** Locked per-page — set by an inline <script> in singles-builder.html / doubles-builder.html BEFORE this file loads. Never changes at runtime; a team's own tagged format is what changes instead (see moveActiveTeamToOtherFormat). */
const WINCON_BUILDER_FORMAT = window.WINCON_BUILDER_FORMAT === "singles" ? "singles" : "doubles";

/** @type {{pokemon: any[], moves: any[], items: any[], natures: any[], learnsets: Record<string,string[]>, baseStats: any[], threats: any[], typeChart: any, abilities: Record<string,{ability: string, description: string, confidence?: string}>}} */
let data = {};

/** Full multi-team state: { teams: [...], activeId }. Shared across BOTH builder pages (and the Pokédex tracker's obtained-list, separately) via teams.js — up to 5 teams total, filtered per page by format below. */
let teamState = { teams: [], activeId: null };

/**
 * This PAGE's own idea of which team is active — deliberately separate
 * from teamState.activeId itself, since that's a single shared pointer and
 * a Singles team can't be "active" on the Doubles page. This only pushes
 * into teamState.activeId when the player actually interacts with a team
 * tab/creation/deletion/move HERE, so the other page's own active team
 * isn't yanked out from under it just by visiting this one.
 */
let activeId = null;

/** The 6 (or fewer, while picking) chosen Pokémon names, in order, for the ACTIVE team on this page. */
let chosen = [];

/** Per-Pokémon build state, keyed by name, for the ACTIVE team on this page. */
let builds = {};

/** Free-text notes for the ACTIVE team — read by Auto-build strategy (see wcApplyNotesBias in strategy.js). */
let notes = "";

/** "closed" | "open" — this team's Open/Closed Team Sheet setting (Milestone 14). See wcGetSheetMode in teams.js and the big comment at the top of this file. */
let sheetMode = "closed";

/** The last strategy analysis result from "Auto-build strategy", or null if none is showing / it's gone stale since a field changed. */
let pendingStrategy = null;

/** The last "Find Your Rival" result, or null if none is showing / it's gone stale since the team changed. See findYourRival() below. */
let pendingRival = null;

const teamTabsEl = document.getElementById("team-tabs");
const teamNameInput = document.getElementById("team-name-input");
const renameTeamBtn = document.getElementById("rename-team-btn");
const newTeamBtn = document.getElementById("new-team-btn");
const deleteTeamBtn = document.getElementById("delete-team-btn");
const moveFormatBtn = document.getElementById("move-format-btn");
const teamsHint = document.getElementById("teams-hint");
const sheetToggleEl = document.getElementById("sheet-toggle");
const teamNotesInput = document.getElementById("team-notes-input");
const matchRecordEl = document.getElementById("match-record-note");

const dreamTeamBtn = document.getElementById("dream-team-btn");
const dreamTeamNoteEl = document.getElementById("dream-team-note");
const pickerHint = document.getElementById("picker-hint");
const pickerGrid = document.getElementById("picker-grid");
const slotsSection = document.getElementById("slots-section");
const slotsEl = document.getElementById("slots");
const saveBtn = document.getElementById("save-btn");
const saveStatus = document.getElementById("save-status");
const autobuildBtn = document.getElementById("autobuild-btn");
const autostrategyBtn = document.getElementById("autostrategy-btn");
const autogenHint = document.getElementById("autogen-hint");
const autostrategyHint = document.getElementById("autostrategy-hint");
const strategyNoteEl = document.getElementById("strategy-note");
const modalOverlay = document.getElementById("changes-modal");
const modalTitle = document.getElementById("changes-modal-title");
const modalBody = document.getElementById("changes-modal-body");
const modalActions = document.getElementById("changes-modal-actions");

const scoreRivalHeaderRowEl = document.getElementById("score-rival-header-row");
const scoreSectionEl = document.getElementById("score-section");
const coverageSectionEl = document.getElementById("coverage-section");
const trackerSectionEl = document.getElementById("tracker-section");
const noTeamEl = document.getElementById("no-team");

const rivalSectionEl = document.getElementById("rival-section");
const rivalBtn = document.getElementById("rival-btn");
const rivalNoteEl = document.getElementById("rival-note");
const rivalResultEl = document.getElementById("rival-result");

init();

async function init() {
  const [pokemon, moves, items, natures, learnsets, baseStats, threats, typeChart, sprites, abilities] = await Promise.all([
    fetchJSON("data/pokemon.json"),
    fetchJSON("data/moves.json"),
    fetchJSON("data/items.json"),
    fetchJSON("data/natures.json"),
    fetchJSON("data/learnsets.json"),
    fetchJSON("data/base-stats.json"),
    fetchJSON("data/starter-threats.json"),
    fetchJSON("data/type-chart.json"),
    fetchJSON("data/sprites.json"),
    fetchJSON("data/abilities.json"),
  ]);
  data = { pokemon, moves, items, natures, learnsets, baseStats, threats, typeChart, sprites, abilities };

  teamState = wcLoadTeamState();
  activeId = teamState.activeId;
  ensureActiveTeam();
  loadActiveIntoWorkingState();

  renderTeamTabs();
  renderSheetToggle();
  renderTeamNotes();
  renderMatchRecord();
  renderPicker();
  renderSlots();

  saveBtn.addEventListener("click", saveDraft);
  renameTeamBtn.addEventListener("click", renameActiveTeam);
  newTeamBtn.addEventListener("click", addTeam);
  deleteTeamBtn.addEventListener("click", deleteActiveTeam);
  moveFormatBtn.addEventListener("click", moveActiveTeamToOtherFormat);
  autobuildBtn.addEventListener("click", autoBuildTeam);
  autostrategyBtn.addEventListener("click", autoBuildStrategy);
  dreamTeamBtn.addEventListener("click", generateDreamTeam);
  rivalBtn.addEventListener("click", findYourRival);
  sheetToggleEl.querySelectorAll(".format-option").forEach((btn) => {
    btn.addEventListener("click", () => setSheetMode(btn.dataset.sheet));
  });
  teamNotesInput.addEventListener("change", () => {
    notes = teamNotesInput.value;
    const active = getActiveTeam();
    if (active) {
      active.notes = notes;
      wcSaveTeamState(teamState);
    }
    invalidateComputedNotes();
  });

  setupOpponentGrid();
  document.getElementById("tracker-log-win-btn").addEventListener("click", () => logMatchResult("win"));
  document.getElementById("tracker-log-loss-btn").addEventListener("click", () => logMatchResult("loss"));
}

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Couldn't load ${path} (${response.status})`);
  return response.json();
}

function getObtainedNames() {
  try {
    const raw = localStorage.getItem(OBTAINED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

/** The reference threat list with each entry's real types attached — used by Matchup Score, Generate Dream Team, Auto-build team, and Auto-build strategy alike, so they never quietly disagree about what a threat's types are. */
function getThreatsWithTypes() {
  return data.threats.map((t) => {
    const p = data.pokemon.find((x) => x.name === t.name);
    return { ...t, types: p ? p.types : [] };
  });
}

// ---------------------------------------------------------------------------
// Multi-team management, filtered by this page's format (Milestone 14)
// ---------------------------------------------------------------------------

/** Every saved team tagged for THIS page's format — Singles Builder only ever shows/edits Singles-tagged teams, Doubles Builder only Doubles-tagged ones, out of the one shared pool of up to 5. */
function visibleTeams() {
  return teamState.teams.filter((t) => wcGetTeamFormat(t) === WINCON_BUILDER_FORMAT);
}

function getActiveTeam() {
  return teamState.teams.find((t) => t.id === activeId) || null;
}

function ensureActiveTeam() {
  const visible = visibleTeams();
  if (visible.length === 0) {
    const team = wcEmptyTeam(`Team ${teamState.teams.length + 1}`);
    team.format = WINCON_BUILDER_FORMAT;
    teamState.teams.push(team);
    activeId = team.id;
    teamState.activeId = activeId;
    wcSaveTeamState(teamState);
  } else if (!activeId || !visible.some((t) => t.id === activeId)) {
    activeId = visible[0].id;
    teamState.activeId = activeId;
    wcSaveTeamState(teamState);
  }
}

function loadActiveIntoWorkingState() {
  const active = getActiveTeam();
  chosen = active ? [...active.chosen] : [];
  builds = active ? JSON.parse(JSON.stringify(active.builds)) : {};
  notes = active && active.notes ? active.notes : "";
  sheetMode = wcGetSheetMode(active);
}

/** Writes the in-memory chosen/builds/notes/sheetMode back onto the active team object (chosen/builds/notes aren't persisted to localStorage until saveDraft() — sheetMode also saves immediately on its own toggle, see setSheetMode()). */
function syncWorkingStateIntoActiveTeam() {
  const active = getActiveTeam();
  if (!active) return;
  active.chosen = [...chosen];
  active.builds = builds;
  active.format = WINCON_BUILDER_FORMAT;
  active.notes = notes;
  active.sheetMode = sheetMode;
}

function renderTeamNotes() {
  teamNotesInput.value = notes;
}

// ---------------------------------------------------------------------------
// Win/loss stat pills — shared by the Matchup Score section's "Projected
// Win/Loss Ratio" (see renderRival()) and the results tracker's "actual"
// win/loss readout (see renderMatchTracker()). Two small pure helpers plus
// one DOM builder so both places render the exact same green/orange/red
// treatment instead of quietly drifting apart.
// ---------------------------------------------------------------------------

/** Buckets a 0-100 "goodness" percentage into the three-tier color scale. Kept as one tunable spot: 60+ reads as a real edge, 40-59 as a coin flip, under 40 as trouble. */
function wcStatTier(goodnessPercent) {
  if (goodnessPercent >= 60) return "good";
  if (goodnessPercent >= 40) return "mediocre";
  return "bad";
}

/** Win:loss expressed as a "wins per loss" ratio from two percentages that don't need to sum to 100 (the Projected block's win% and loss% are each their own independent estimate). Rounds to one decimal under 10:1, whole numbers above that so it doesn't get noisy. */
function wcFormatRatioFromPercents(winPct, lossPct) {
  if (winPct <= 0 && lossPct <= 0) return "—";
  if (lossPct <= 0) return "All wins";
  if (winPct <= 0) return "All losses";
  const ratio = winPct / lossPct;
  return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)} : 1`;
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

/** One labeled, color-coded stat box (a percentage or a ratio) for a winloss-row. */
function wcBuildWinLossStat(label, valueText, tier, extraClass) {
  const box = document.createElement("div");
  box.className = `winloss-stat is-${tier}${extraClass ? ` ${extraClass}` : ""}`;
  const lab = document.createElement("p");
  lab.className = "winloss-stat-label";
  lab.textContent = label;
  const val = document.createElement("p");
  val.className = "winloss-stat-value";
  val.textContent = valueText;
  box.append(lab, val);
  return box;
}

/** A compact "logged record" readout for the active team, sourced from the results tracker below. */
function renderMatchRecord() {
  const active = getActiveTeam();
  const summary = wcMatchRecordSummary(active);
  if (summary.total === 0) {
    matchRecordEl.textContent = "No logged results yet for this team — log wins/losses in the tracker below and they'll show up here for reference while you plan its strategy.";
  } else {
    matchRecordEl.textContent = `Logged record: ${summary.wins}W–${summary.losses}L (${summary.winRate}% win rate).`;
  }
}

function renderTeamTabs() {
  teamTabsEl.innerHTML = "";
  visibleTeams().forEach((team) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "team-tab" + (team.id === activeId ? " is-active" : "");
    tab.textContent = team.name || "Untitled team";
    tab.addEventListener("click", () => switchTeam(team.id));
    teamTabsEl.appendChild(tab);
  });

  const active = getActiveTeam();
  teamNameInput.value = active ? active.name : "";
  newTeamBtn.disabled = teamState.teams.length >= WINCON_MAX_TEAMS;

  const formatLabel = WINCON_BUILDER_FORMAT === "singles" ? "Singles" : "Doubles";
  const otherLabel = WINCON_BUILDER_FORMAT === "singles" ? "Doubles" : "Singles";
  moveFormatBtn.textContent = `Move to ${otherLabel} builder`;

  const visibleCount = visibleTeams().length;
  teamsHint.textContent =
    teamState.teams.length >= WINCON_MAX_TEAMS
      ? `${teamState.teams.length} of ${WINCON_MAX_TEAMS} teams saved across both builders — that's the max. Delete one to make room for another.`
      : `${visibleCount} ${formatLabel} team${visibleCount === 1 ? "" : "s"} here (${teamState.teams.length} of ${WINCON_MAX_TEAMS} saved across both builders).`;
}

function switchTeam(id) {
  if (id === activeId) return;
  syncWorkingStateIntoActiveTeam();
  activeId = id;
  teamState.activeId = activeId;
  wcSaveTeamState(teamState);
  loadActiveIntoWorkingState();
  invalidateComputedNotes();
  autogenHint.textContent = "";
  renderTeamTabs();
  renderSheetToggle();
  renderTeamNotes();
  renderMatchRecord();
  renderPicker();
  renderSlots();
  saveStatus.textContent = "";
}

function addTeam() {
  if (teamState.teams.length >= WINCON_MAX_TEAMS) return;
  syncWorkingStateIntoActiveTeam();
  wcSaveTeamState(teamState);
  const nextNumber = teamState.teams.length + 1;
  const team = wcEmptyTeam(`Team ${nextNumber}`);
  team.format = WINCON_BUILDER_FORMAT;
  teamState.teams.push(team);
  activeId = team.id;
  teamState.activeId = activeId;
  wcSaveTeamState(teamState);
  loadActiveIntoWorkingState();
  invalidateComputedNotes();
  autogenHint.textContent = "";
  renderTeamTabs();
  renderSheetToggle();
  renderTeamNotes();
  renderMatchRecord();
  renderPicker();
  renderSlots();
  saveStatus.textContent = "";
}

function renameActiveTeam() {
  const active = getActiveTeam();
  if (!active) return;
  const newName = teamNameInput.value.trim();
  active.name = newName || active.name;
  wcSaveTeamState(teamState);
  renderTeamTabs();
  saveStatus.textContent = "Team renamed.";
}

/** Milestone 14: deletion no longer requires keeping at least one team overall — confirm() is the only safety net — since a page with zero teams left for its own format just gets a fresh blank one from ensureActiveTeam() right after, same as first ever visiting this page. */
function deleteActiveTeam() {
  const active = getActiveTeam();
  if (!active) return;
  const confirmed = window.confirm(`Delete "${active.name}"? This can't be undone.`);
  if (!confirmed) return;
  teamState.teams = teamState.teams.filter((t) => t.id !== active.id);
  if (teamState.activeId === active.id) teamState.activeId = null;
  activeId = null;
  ensureActiveTeam();
  wcSaveTeamState(teamState);
  loadActiveIntoWorkingState();
  invalidateComputedNotes();
  autogenHint.textContent = "";
  renderTeamTabs();
  renderSheetToggle();
  renderTeamNotes();
  renderMatchRecord();
  renderPicker();
  renderSlots();
  saveStatus.textContent = "Team deleted.";
}

/** Milestone 14: a team is tagged Singles or Doubles, and each builder page only shows teams tagged for it — so "changing a team's format" now means moving it to the other page entirely, not just flipping a toggle in place here. */
function moveActiveTeamToOtherFormat() {
  const active = getActiveTeam();
  if (!active) return;
  const otherFormat = WINCON_BUILDER_FORMAT === "singles" ? "doubles" : "singles";
  const otherLabel = otherFormat === "singles" ? "Singles" : "Doubles";
  const teamName = active.name;
  syncWorkingStateIntoActiveTeam();
  active.format = otherFormat;
  activeId = null;
  ensureActiveTeam();
  wcSaveTeamState(teamState);
  loadActiveIntoWorkingState();
  invalidateComputedNotes();
  autogenHint.textContent = "";
  renderTeamTabs();
  renderSheetToggle();
  renderTeamNotes();
  renderMatchRecord();
  renderPicker();
  renderSlots();
  saveStatus.textContent = `Moved "${teamName}" to the ${otherLabel} builder — find it there now.`;
}

function saveDraft() {
  if (refreshItemValidation()) {
    saveStatus.textContent =
      "Can't save — two or more Pokémon on this team hold the same item. Fix the items highlighted in red first.";
    return;
  }
  syncWorkingStateIntoActiveTeam();
  const ok = wcSaveTeamState(teamState);
  saveStatus.textContent = ok
    ? "Saved just now."
    : "Couldn't save — your browser's storage may be full or unavailable.";
}

function emptyBuild() {
  const sp = {};
  STATS.forEach((s) => (sp[s.key] = 0));
  return { nature: "", item: "", moves: ["", "", "", ""], sp };
}

// ---------------------------------------------------------------------------
// Open Team Sheet / Closed Team Sheet toggle (Milestone 14)
// ---------------------------------------------------------------------------

function setSheetMode(newMode) {
  sheetMode = newMode === "open" ? "open" : "closed";
  const active = getActiveTeam();
  if (active) {
    active.sheetMode = sheetMode;
    wcSaveTeamState(teamState);
  }
  renderSheetToggle();
  invalidateRival();
  // Re-renders every move field's Expected/Tech tag and re-scores the live
  // Matchup Score / Your Rival sections under the new mode — see
  // wcScoreMatchup's opts.sheetMode and wcMoveIsExpected in strategy.js.
  renderSlots();
  saveStatus.textContent = `Sheet mode set to ${sheetMode === "open" ? "Open Team Sheet" : "Closed Team Sheet"}.`;
}

function renderSheetToggle() {
  sheetToggleEl.querySelectorAll(".format-option").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.sheet === sheetMode);
  });
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

/** Returns an <img> for this Pokémon's sprite, or null if none was resolved. */
function spriteImg(name, className) {
  const path = data.sprites && data.sprites[name];
  if (!path) return null;
  const img = document.createElement("img");
  img.src = `data/${path}`;
  img.alt = "";
  img.className = className;
  img.loading = "lazy";
  img.addEventListener("error", () => img.remove());
  return img;
}

// ---------------------------------------------------------------------------
// Step 1: the picker
// ---------------------------------------------------------------------------

function renderPicker() {
  const obtained = getObtainedNames();
  const obtainedList = data.pokemon.filter((p) => obtained.has(p.name) && !wcIsMegaForm(p));

  if (obtainedList.length === 0) {
    pickerHint.innerHTML =
      'No Pokémon marked as obtained yet. Go check some off on the <a href="pokedex.html">Pokédex tracker</a> first.';
  } else {
    pickerHint.textContent = `${chosen.length} of 6 selected — choose from the ${obtainedList.length} you've marked obtained.`;
  }

  pickerGrid.innerHTML = "";
  obtainedList.forEach((p) => {
    const isChosen = chosen.includes(p.name);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pick-chip" + (isChosen ? " is-chosen" : "");
    const sprite = spriteImg(p.name, "pick-chip-sprite");
    if (sprite) card.appendChild(sprite);
    const label = document.createElement("span");
    label.textContent = p.name;
    card.appendChild(label);
    card.disabled = !isChosen && chosen.length >= 6;
    card.addEventListener("click", () => togglePick(p.name));
    pickerGrid.appendChild(card);
  });
}

function togglePick(name) {
  const index = chosen.indexOf(name);
  if (index >= 0) {
    chosen.splice(index, 1);
    delete builds[name];
  } else {
    if (chosen.length >= 6) return;
    chosen.push(name);
    builds[name] = builds[name] || emptyBuild();
  }
  invalidateComputedNotes();
  autogenHint.textContent = "";
  renderPicker();
  renderSlots();
}

// ---------------------------------------------------------------------------
// Step 2: the build slots
// ---------------------------------------------------------------------------

function renderSlots() {
  slotsSection.hidden = chosen.length === 0;
  slotsEl.innerHTML = "";

  chosen.forEach((name) => {
    const pokemon = data.pokemon.find((p) => p.name === name);
    if (!pokemon) return;
    builds[name] = builds[name] || emptyBuild();
    slotsEl.appendChild(renderSlot(name, builds[name]));
  });

  refreshItemValidation();
  refreshStrategyAvailability();
  refreshDerivedSections();
}

function renderSlot(baseName, build) {
  const basePokemon = data.pokemon.find((p) => p.name === baseName);
  const effective = wcEffectivePokemon(data.pokemon, baseName, build.item) || basePokemon;
  const isMega = effective.name !== baseName;

  const card = document.createElement("article");
  card.className = "slot-card";

  const header = document.createElement("div");
  header.className = "slot-header";
  const sprite = spriteImg(effective.name, "slot-sprite");
  const title = document.createElement("div");
  title.className = "card-name";
  title.textContent = effective.name;
  if (isMega) {
    const megaTag = document.createElement("span");
    megaTag.className = "mega-badge";
    megaTag.textContent = "Mega Evolved";
    megaTag.title = `${baseName} holding ${build.item} — remove or change the item to revert to ${baseName}.`;
    title.appendChild(megaTag);
  }
  const types = document.createElement("div");
  types.className = "card-types";
  effective.types.forEach((type) => {
    const tag = document.createElement("span");
    tag.className = `type-tag type-${type.toLowerCase()}`;
    tag.textContent = type;
    types.appendChild(tag);
  });
  if (sprite) header.appendChild(sprite);
  header.append(title, types);

  const abilityInfo = data.abilities && data.abilities[effective.name];
  if (abilityInfo) {
    const abilityBadge = document.createElement("span");
    abilityBadge.className = "ability-badge";
    if (abilityInfo.confidence === "low") abilityBadge.classList.add("is-low-confidence");
    abilityBadge.textContent = `Ability: ${abilityInfo.ability}`;
    attachFieldHoverTooltip(abilityBadge, (el) => showAbilityFieldTooltip(el, abilityInfo));
    header.appendChild(abilityBadge);
  }

  const megaForms = wcMegaFormsOf(data.pokemon, baseName);
  if (megaForms.length > 0) {
    const megaHint = document.createElement("p");
    megaHint.className = "hint slot-mega-hint";
    const stoneList = megaForms
      .map((m) => WINCON_MEGA_STONES[m.name])
      .filter(Boolean)
      .join(", ");
    megaHint.textContent = isMega
      ? `Holding ${build.item} — this slot is ${effective.name}. Change the item to something else to revert to ${baseName}.`
      : `Has a Mega form — hold ${stoneList} in the item field below to Mega Evolve this slot.`;
    header.appendChild(megaHint);
  }

  const row1 = document.createElement("div");
  row1.className = "slot-row";
  row1.append(labeled("Nature", buildNatureSelect(build)), buildItemField(build, effective.name, baseName));

  const moveGrid = document.createElement("div");
  moveGrid.className = "move-grid";
  const learnset = data.learnsets[effective.name];
  if (!learnset) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent =
      "No confirmed learnset for this Pokémon yet (it's one of the Reg M-B additions) — showing the full Champions move list instead.";
    moveGrid.appendChild(note);
  }
  const moveOptions = learnset || data.moves.map((m) => m.name);
  const abilityName = abilityInfo && abilityInfo.ability;
  for (let i = 0; i < 4; i++) {
    moveGrid.appendChild(buildMoveField(build, i, moveOptions, effective, abilityName));
  }

  const spSection = buildStatPointAllocator(build);

  card.append(header, row1, moveGrid, spSection);
  return card;
}

function labeled(labelText, control) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.className = "field-label";
  span.textContent = labelText;
  wrap.append(span, control);
  return wrap;
}

function buildNatureSelect(build) {
  const select = document.createElement("select");
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "— choose —";
  select.appendChild(blank);
  data.natures.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n.name;
    opt.textContent = n.increasedStat
      ? `${n.name} (+${statLabel(n.increasedStat)} / −${statLabel(n.decreasedStat)})`
      : `${n.name} (neutral)`;
    if (n.name === build.nature) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => {
    build.nature = select.value;
    invalidateComputedNotes();
    refreshStrategyAvailability();
    refreshDerivedSections();
  });
  return select;
}

function statLabel(key) {
  return STATS.find((s) => s.key === key)?.label ?? key;
}

function buildItemField(build, pokemonName, baseName) {
  const wrap = document.createElement("label");
  wrap.className = "field";

  const span = document.createElement("span");
  span.className = "field-label";
  span.textContent = "Item";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "item-input";
  input.dataset.pokemonName = pokemonName;
  input.setAttribute("list", "item-options");
  input.value = build.item || "";
  input.placeholder = "Search items…";
  input.addEventListener("change", () => {
    build.item = input.value;
    invalidateComputedNotes();
    // The item decides whether this slot is currently its base form or a
    // Mega form (see wcEffectivePokemon) — a full re-render (which also
    // refreshes the derived Matchup Score/coverage sections) is needed so
    // a Mega Stone typed here swaps the card right away.
    renderSlots();
  });
  attachFieldHoverTooltip(input, showItemFieldTooltip);
  ensureItemDatalist();

  const error = document.createElement("small");
  error.className = "field-error";
  error.hidden = true;

  wrap.append(span, input, error);
  return wrap;
}

function refreshItemValidation() {
  const inputs = [...slotsEl.querySelectorAll(".item-input")];
  const groups = new Map();
  inputs.forEach((input) => {
    const value = input.value.trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(input);
  });

  let hasDuplicate = false;
  inputs.forEach((input) => {
    const value = input.value.trim();
    const group = value ? groups.get(value.toLowerCase()) : null;
    const isDuplicate = Boolean(group && group.length > 1);
    input.classList.toggle("is-duplicate", isDuplicate);
    const error = input.parentElement.querySelector(".field-error");
    if (error) {
      if (isDuplicate) {
        const others = group
          .filter((i) => i !== input)
          .map((i) => i.dataset.pokemonName)
          .join(", ");
        error.textContent = `Also held by ${others} — items must be unique on a team.`;
        error.hidden = false;
      } else {
        error.hidden = true;
        error.textContent = "";
      }
    }
    if (isDuplicate) hasDuplicate = true;
  });

  return hasDuplicate;
}

function ensureItemDatalist() {
  if (document.getElementById("item-options")) return;
  const datalist = document.createElement("datalist");
  datalist.id = "item-options";
  data.items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.name;
    datalist.appendChild(opt);
  });
  document.body.appendChild(datalist);
}

/**
 * Move field + a "Type · Category" meta line, plus (Milestone 14) an
 * Expected/Tech tag once Open Team Sheet mode is on — see
 * wcMoveIsExpected in strategy.js. Under Closed Sheet the tag stays
 * hidden entirely: a tech move only matters once an opponent can see it
 * coming, so there's nothing useful to flag before that.
 */
function buildMoveField(build, index, moveOptions, effectivePokemon, abilityName) {
  const wrap = document.createElement("label");
  wrap.className = "field";

  const span = document.createElement("span");
  span.className = "field-label";
  span.textContent = `Move ${index + 1}`;

  const meta = document.createElement("small");
  meta.className = "move-meta";

  const tag = document.createElement("small");
  tag.className = "move-tag";
  tag.hidden = true;

  const input = buildMoveInput(build, index, moveOptions, meta, tag, effectivePokemon, abilityName);
  refreshMoveMeta(input, meta, tag, effectivePokemon, abilityName);

  wrap.append(span, input, meta, tag);
  return wrap;
}

function refreshMoveMeta(input, meta, tag, effectivePokemon, abilityName) {
  input.classList.remove(...[...input.classList].filter((c) => c.startsWith("type-")));
  const move = data.moves.find((m) => m.name === input.value);
  if (!move) {
    meta.textContent = "";
    meta.hidden = true;
    tag.hidden = true;
    return;
  }

  input.classList.add(`type-${move.type.toLowerCase()}`);
  meta.textContent = `${move.type} · ${move.category}`;
  meta.hidden = false;

  if (sheetMode === "open" && effectivePokemon) {
    const expected = wcMoveIsExpected(move, effectivePokemon.name, effectivePokemon.types, abilityName);
    tag.textContent = expected ? "Expected" : "Tech";
    tag.className = `move-tag ${expected ? "move-tag-expected" : "move-tag-tech"}`;
    tag.title = expected
      ? "Fits this Pokémon's own typing/STAB, a known real set, or is a Status move — an opponent who has scouted your Open Team Sheet won't be surprised by this one."
      : "Off-type coverage — under an Open Team Sheet, your opponent has already seen this coming and can bring the right switch-in before Game 1.";
    tag.hidden = false;
  } else {
    tag.hidden = true;
  }
}

function buildMoveInput(build, index, moveOptions, meta, tag, effectivePokemon, abilityName) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "move-input";
  input.autocomplete = "off";
  input.value = build.moves[index] || "";
  input.placeholder = "Click to see available moves…";

  const commit = (value) => commitMoveValue(input, meta, tag, build, index, value, effectivePokemon, abilityName);

  input.addEventListener("focus", () => openMoveDropdown(input, moveOptions, commit));
  input.addEventListener("click", () => openMoveDropdown(input, moveOptions, commit));
  input.addEventListener("input", () => {
    if (isMoveDropdownOpenFor(input)) renderMoveDropdownRows(input, moveOptions, commit);
  });
  input.addEventListener("change", () => commit(input.value));
  attachFieldHoverTooltip(input, showMoveFieldTooltip);
  return input;
}

function commitMoveValue(input, meta, tag, build, index, value, effectivePokemon, abilityName) {
  input.value = value;
  build.moves[index] = value;
  refreshMoveMeta(input, meta, tag, effectivePokemon, abilityName);
  invalidateComputedNotes();
  refreshStrategyAvailability();
  refreshDerivedSections();
}

// ---------------------------------------------------------------------------
// Move dropdown (Milestone 12) — one shared floating panel
// ---------------------------------------------------------------------------

let moveDropdownEl = null;
let moveDropdownAnchor = null;

function ensureMoveDropdownEl() {
  if (moveDropdownEl) return moveDropdownEl;
  moveDropdownEl = document.createElement("div");
  moveDropdownEl.id = "move-dropdown";
  moveDropdownEl.className = "move-dropdown";
  moveDropdownEl.hidden = true;
  document.body.appendChild(moveDropdownEl);
  return moveDropdownEl;
}

function isMoveDropdownOpenFor(input) {
  return moveDropdownAnchor === input && moveDropdownEl && !moveDropdownEl.hidden;
}

function closeMoveDropdown() {
  moveDropdownAnchor = null;
  if (moveDropdownEl) moveDropdownEl.hidden = true;
}

function positionMoveDropdown(input) {
  const el = ensureMoveDropdownEl();
  const margin = 4;
  const rect = input.getBoundingClientRect();
  el.style.left = `${rect.left}px`;
  el.style.width = `${Math.max(rect.width, 320)}px`;
  const maxHeight = 280;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < maxHeight + margin && rect.top > spaceBelow) {
    el.style.top = "";
    el.style.bottom = `${window.innerHeight - rect.top + margin}px`;
    el.style.maxHeight = `${Math.min(maxHeight, rect.top - margin - 4)}px`;
  } else {
    el.style.bottom = "";
    el.style.top = `${rect.bottom + margin}px`;
    el.style.maxHeight = `${Math.min(maxHeight, spaceBelow - margin - 4)}px`;
  }
}

function renderMoveDropdownRows(input, moveOptions, commit) {
  const el = ensureMoveDropdownEl();
  el.innerHTML = "";
  const query = input.value.trim().toLowerCase();
  const rows = moveOptions
    .map((name) => data.moves.find((m) => m.name === name))
    .filter(Boolean)
    .filter((m) => !query || m.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "move-dropdown-empty";
    empty.textContent = "No learnable move matches that.";
    el.appendChild(empty);
    return;
  }

  rows.forEach((move) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "move-option";

    const name = document.createElement("span");
    name.className = "move-option-name";
    name.textContent = move.name;

    const metaWrap = document.createElement("span");
    metaWrap.className = "move-option-meta";

    const typeTag = document.createElement("span");
    typeTag.className = `type-tag type-${move.type.toLowerCase()}`;
    typeTag.textContent = move.type;

    const cat = document.createElement("span");
    cat.className = "move-option-cat";
    cat.textContent = move.category;

    const pow = document.createElement("span");
    pow.className = "move-option-pow";
    pow.textContent = move.power > 0 ? `Pow ${move.power}` : "—";

    metaWrap.append(typeTag, cat, pow);
    row.append(name, metaWrap);
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      commit(move.name);
      closeMoveDropdown();
    });
    el.appendChild(row);
  });
}

function openMoveDropdown(input, moveOptions, commit) {
  hideFieldTooltip();
  moveDropdownAnchor = input;
  ensureMoveDropdownEl().hidden = false;
  positionMoveDropdown(input);
  renderMoveDropdownRows(input, moveOptions, commit);
}

document.addEventListener("mousedown", (event) => {
  if (!moveDropdownEl || moveDropdownEl.hidden) return;
  if (moveDropdownEl.contains(event.target)) return;
  if (moveDropdownAnchor === event.target) return;
  closeMoveDropdown();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMoveDropdown();
});
window.addEventListener("scroll", () => {
  if (moveDropdownAnchor) positionMoveDropdown(moveDropdownAnchor);
}, true);
window.addEventListener("resize", () => {
  if (moveDropdownAnchor) positionMoveDropdown(moveDropdownAnchor);
});

function buildStatPointAllocator(build) {
  const wrap = document.createElement("div");
  wrap.className = "sp-allocator";

  const heading = document.createElement("div");
  heading.className = "sp-heading";
  const label = document.createElement("span");
  label.textContent = "Stat Points";
  const totalBadge = document.createElement("span");
  totalBadge.className = "sp-total";
  heading.append(label, totalBadge);
  wrap.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "sp-grid";

  function refreshTotal() {
    const total = STATS.reduce((sum, s) => sum + (build.sp[s.key] || 0), 0);
    totalBadge.textContent = `${total} / ${SP_TOTAL_CAP}`;
    totalBadge.classList.toggle("sp-over", total > SP_TOTAL_CAP);
  }

  STATS.forEach((s) => {
    const field = document.createElement("label");
    field.className = "sp-field";
    const name = document.createElement("span");
    name.textContent = s.label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = String(SP_STAT_CAP);
    input.value = String(build.sp[s.key] || 0);
    input.addEventListener("input", () => {
      let value = parseInt(input.value, 10);
      if (Number.isNaN(value) || value < 0) value = 0;
      if (value > SP_STAT_CAP) value = SP_STAT_CAP;
      input.value = String(value);
      build.sp[s.key] = value;
      refreshTotal();
      invalidateComputedNotes();
      refreshStrategyAvailability();
      refreshDerivedSections();
    });
    field.append(name, input);
    grid.appendChild(field);
  });

  wrap.appendChild(grid);
  refreshTotal();
  return wrap;
}

// ---------------------------------------------------------------------------
// Generate Dream Team (Milestone 8)
// ---------------------------------------------------------------------------

function megaFormsFor(baseName) {
  return wcMegaFormsOf(data.pokemon, baseName)
    .map((m) => ({ name: m.name, types: m.types, baseStats: data.baseStats.find((b) => b.name === m.name) }))
    .filter((m) => m.baseStats);
}

function effectiveMemberFor(baseName, baseTypes, baseStats, learnableNames, build) {
  const effective = wcEffectivePokemon(data.pokemon, baseName, build && build.item);
  if (!effective || effective.name === baseName) {
    return { name: baseName, slotName: baseName, types: baseTypes, baseStats, learnableNames };
  }
  const effectiveBaseStats = data.baseStats.find((b) => b.name === effective.name) || baseStats;
  return { name: effective.name, slotName: baseName, types: effective.types, baseStats: effectiveBaseStats, learnableNames };
}

function eligibleObtainedMembers() {
  const obtained = getObtainedNames();
  const eligible = [];
  obtained.forEach((name) => {
    const pokemon = data.pokemon.find((p) => p.name === name);
    const baseStats = data.baseStats.find((b) => b.name === name);
    const learnableNames = data.learnsets[name];
    if (pokemon && baseStats && learnableNames) {
      eligible.push({ name, types: pokemon.types, baseStats, learnableNames, megaForms: megaFormsFor(name) });
    }
  });
  return eligible;
}

function generateDreamTeam() {
  const eligible = eligibleObtainedMembers();

  if (eligible.length < 6) {
    dreamTeamNoteEl.hidden = false;
    dreamTeamNoteEl.innerHTML = "";
    const p = document.createElement("p");
    p.textContent =
      `Generate Dream Team needs at least 6 obtained Pokémon with confirmed base-stat/learnset data — you have ${eligible.length} right now. ` +
      `Mark more as obtained on the Pokédex tracker (or, for the newest Reg M-B additions, that data isn't confirmed yet — see README.md).`;
    dreamTeamNoteEl.appendChild(p);
    return;
  }

  const threatsWithTypes = getThreatsWithTypes();

  const { chosen: picked, reasoning, megaNote, excludedNames } = wcPickDreamTeam(eligible, threatsWithTypes, data.typeChart, 6, notes);

  if (picked.length < 6) {
    dreamTeamNoteEl.hidden = false;
    dreamTeamNoteEl.innerHTML = "";
    const p = document.createElement("p");
    const excludedText = excludedNames && excludedNames.length ? ` after leaving out ${excludedNames.join(", ")} per your team notes` : "";
    p.textContent =
      `Generate Dream Team needs at least 6 eligible Pokémon${excludedText} -- only ${picked.length} ${picked.length === 1 ? "is" : "are"} left. ` +
      `Mark more as obtained, or adjust your notes.`;
    dreamTeamNoteEl.appendChild(p);
    return;
  }

  const members = picked.map((name) => eligible.find((m) => m.name === name));

  chosen = picked;
  const { builds: generated } = wcGenerateTeamBuilds(members, data.moves, threatsWithTypes, data.typeChart, WINCON_BUILDER_FORMAT, data.abilities, sheetMode);
  builds = generated;

  invalidateComputedNotes();

  renderPicker();
  renderSlots();
  renderDreamTeamNote(reasoning, megaNote, excludedNames);

  autogenHint.textContent = "";
  saveStatus.textContent = "Dream Team picked and built — click Auto-build strategy below when you're ready to see a recommended team strategy, then Save team when you're happy with it.";
}

function renderDreamTeamNote(reasoning, megaNote, excludedNames) {
  dreamTeamNoteEl.innerHTML = "";
  dreamTeamNoteEl.hidden = false;

  if (excludedNames && excludedNames.length) {
    const excludedP = document.createElement("p");
    excludedP.className = "hint dream-team-excluded-note";
    excludedP.textContent = `Left out per your team notes: ${excludedNames.join(", ")}.`;
    dreamTeamNoteEl.appendChild(excludedP);
  }

  const heading = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = "Why these six";
  heading.appendChild(strong);
  dreamTeamNoteEl.appendChild(heading);

  const list = document.createElement("ol");
  reasoning.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    list.appendChild(li);
  });
  dreamTeamNoteEl.appendChild(list);

  if (megaNote) {
    const mega = document.createElement("p");
    mega.className = "hint dream-team-mega-note";
    mega.textContent = megaNote;
    dreamTeamNoteEl.appendChild(mega);
  }
}

// ---------------------------------------------------------------------------
// Step 3a: Auto-build team
// ---------------------------------------------------------------------------

function autoBuildTeam() {
  if (chosen.length < 6) {
    autogenHint.textContent = `Pick all 6 Pokémon first — you have ${chosen.length} so far.`;
    invalidateComputedNotes();
    return;
  }

  const members = [];
  const skipped = [];
  chosen.forEach((name) => {
    const pokemon = data.pokemon.find((p) => p.name === name);
    const baseStats = data.baseStats.find((b) => b.name === name);
    const learnableNames = data.learnsets[name];
    if (!pokemon || !baseStats || !learnableNames) {
      skipped.push(name);
      return;
    }
    members.push({ name, types: pokemon.types, baseStats, learnableNames, megaForms: megaFormsFor(name) });
  });

  if (members.length === 0) {
    autogenHint.textContent =
      "None of your 6 have complete base-stat/learnset data yet, so nothing could be auto-built. Fill these in manually for now.";
    invalidateComputedNotes();
    return;
  }

  const threatsWithTypes = getThreatsWithTypes();

  const { builds: generated } = wcGenerateTeamBuilds(members, data.moves, threatsWithTypes, data.typeChart, WINCON_BUILDER_FORMAT, data.abilities, sheetMode);

  Object.entries(generated).forEach(([name, build]) => {
    builds[name] = build;
  });

  invalidateComputedNotes();
  renderSlots();

  const megaCount = chosen.filter((name) => {
    const build = generated[name];
    return build && Object.values(WINCON_MEGA_STONES).some((stone) => stone.toLowerCase() === (build.item || "").trim().toLowerCase());
  }).length;
  const megaMention =
    megaCount >= 2
      ? ` ${megaCount} of them opted into a real Mega build — you can choose which one to actually Mega Evolve depending on the matchup.`
      : megaCount === 1
        ? ` One of them opted into a real Mega build.`
        : ` None of these six have a real, tournament-informed Mega build yet (only Mega Charizard Y, Mega Floette, and Mega Staraptor do right now) — pick one of your obtained Pokémon with a Mega form and hold its own Mega Stone in the item field if you want to build around one by hand.`;

  const formatLabel = WINCON_BUILDER_FORMAT === "singles" ? "Singles" : "Doubles";
  autogenHint.textContent =
    skipped.length > 0
      ? `Auto-built ${members.length} of 6 for your ${formatLabel} team — skipped ${skipped.join(", ")} (missing base-stat/learnset data for these Reg M-B additions; build them by hand for now).`
      : `Auto-built all 6 for your ${formatLabel} team, independently — no shared strategy applied yet.${megaMention} Review and tweak anything, then use Auto-build strategy once every field is filled in.`;
}

// ---------------------------------------------------------------------------
// Step 3b: Auto-build strategy
// ---------------------------------------------------------------------------

function isTeamComplete() {
  if (chosen.length !== 6) return false;
  const noItemClash = !refreshItemValidation();
  const allFieldsFilled = chosen.every((name) => {
    const build = builds[name];
    if (!build) return false;
    const spTotal = STATS.reduce((sum, s) => sum + (build.sp[s.key] || 0), 0);
    const movesFilled = build.moves.filter(Boolean).length === 4;
    return Boolean(build.nature) && Boolean(build.item) && movesFilled && spTotal === SP_TOTAL_CAP;
  });
  return noItemClash && allFieldsFilled;
}

function refreshStrategyAvailability() {
  const complete = isTeamComplete();
  autostrategyBtn.disabled = !complete;
  autostrategyHint.textContent = complete
    ? ""
    : "Complete every field for all 6 Pokémon first — Nature, item, all 4 moves, all 66 Stat Points, and no duplicate items — to unlock strategy analysis.";
}

function invalidateStrategyNote() {
  pendingStrategy = null;
  strategyNoteEl.hidden = true;
}

/** Milestone 14: also clears "Your Rival" whenever the team changes — a rival synthesized against the OLD team's typing/stats could be stale (and even scored against the wrong sheetMode) the instant anything here changes, so it's re-earned with a fresh click of "Find Your Rival" rather than silently going wrong quietly in the background. */
function invalidateRival() {
  pendingRival = null;
  if (rivalResultEl) rivalResultEl.hidden = true;
  if (rivalNoteEl) rivalNoteEl.hidden = true;
}

function invalidateComputedNotes() {
  invalidateStrategyNote();
  invalidateRival();
}

function autoBuildStrategy() {
  if (!isTeamComplete()) {
    refreshStrategyAvailability();
    return;
  }

  const members = [];
  chosen.forEach((name) => {
    const pokemon = data.pokemon.find((p) => p.name === name);
    const baseStats = data.baseStats.find((b) => b.name === name);
    const learnableNames = data.learnsets[name];
    if (pokemon && baseStats && learnableNames) {
      members.push(effectiveMemberFor(name, pokemon.types, baseStats, learnableNames, builds[name]));
    }
  });

  if (members.length < chosen.length) {
    autogenHint.textContent =
      "Some of your 6 are missing base-stat/learnset data (Reg M-B additions without confirmed data yet), so a team-wide strategy can't be analyzed until those are filled in by hand.";
    return;
  }

  const threatsWithTypes = getThreatsWithTypes();

  const result = wcAnalyzeTeamStrategy(members, builds, data.moves, threatsWithTypes, data.typeChart, WINCON_BUILDER_FORMAT, notes, data.abilities);
  pendingStrategy = result;
  autogenHint.textContent = "";
  renderStrategyNote(result);
}

function renderStrategyOption(container, option, headingText, metaSynergy) {
  const heading = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent =
    option.archetype === "balanced" ? `${headingText}: none detected` : `${headingText}: ${archetypeLabel(option.archetype)}`;
  heading.appendChild(strong);
  container.appendChild(heading);

  const note = document.createElement("p");
  note.textContent = option.note;
  container.appendChild(note);

  if (metaSynergy) {
    const metaNote = document.createElement("p");
    metaNote.className = "meta-synergy-note";
    const metaLabel = document.createElement("strong");
    metaLabel.textContent = "Real tournament synergy: ";
    metaNote.appendChild(metaLabel);
    metaNote.appendChild(document.createTextNode(metaSynergy.note));
    container.appendChild(metaNote);
  }
}

function renderStrategyNote(strategy) {
  strategyNoteEl.innerHTML = "";
  strategyNoteEl.hidden = false;

  renderStrategyOption(strategyNoteEl, strategy, "Recommended strategy", strategy.metaSynergy);

  if (strategy.amendments && strategy.amendments.length > 0) {
    const changeBtn = document.createElement("button");
    changeBtn.type = "button";
    changeBtn.id = "make-changes-btn";
    changeBtn.className = "btn-secondary";
    changeBtn.textContent = "Make changes";
    changeBtn.addEventListener("click", handleMakeChanges);
    strategyNoteEl.appendChild(changeBtn);
  } else if (strategy.archetype !== "balanced") {
    const already = document.createElement("p");
    already.className = "hint";
    already.textContent = "Your current build already fits this strategy — no changes needed.";
    strategyNoteEl.appendChild(already);
  }

  if (strategy.alternative) {
    const altBox = document.createElement("div");
    altBox.className = "strategy-alternative";
    const altIntro = document.createElement("p");
    altIntro.className = "hint strategy-alt-intro";
    altIntro.textContent = "Not feeling that one? Here's another strategy this team also supports:";
    altBox.appendChild(altIntro);
    renderStrategyOption(altBox, strategy.alternative, "Alternative strategy", null);

    const switchBtn = document.createElement("button");
    switchBtn.type = "button";
    switchBtn.className = "btn-secondary";
    switchBtn.textContent = "Use this instead";
    switchBtn.addEventListener("click", () => {
      const swapped = {
        ...strategy.alternative,
        metaSynergy: strategy.metaSynergy,
        alternative: { archetype: strategy.archetype, setterName: strategy.setterName, note: strategy.note, amendments: strategy.amendments },
      };
      pendingStrategy = swapped;
      renderStrategyNote(swapped);
    });
    altBox.appendChild(switchBtn);
    strategyNoteEl.appendChild(altBox);
  }
}

function archetypeLabel(archetype) {
  switch (archetype) {
    case "trickroom":
      return "Trick Room";
    case "tailwind":
      return "Tailwind";
    case "sun":
      return "Sun (weather)";
    case "rain":
      return "Rain (weather)";
    case "redirect":
      return "Redirection (Follow Me / Rage Powder)";
    case "hazards":
      return "Entry hazards";
    default:
      return archetype;
  }
}

// ---------------------------------------------------------------------------
// "Make changes" — applying a strategy's amendments
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

function handleMakeChanges() {
  if (!pendingStrategy || !pendingStrategy.amendments || pendingStrategy.amendments.length === 0) return;
  const hasOpenSlot = teamState.teams.length < WINCON_MAX_TEAMS;
  const active = getActiveTeam();
  const teamLabel = active ? active.name : "this team";

  if (hasOpenSlot) {
    showModal({
      title: "Apply strategy changes",
      body: `Apply the ${archetypeLabel(pendingStrategy.archetype)} changes to "${teamLabel}", or save them to a new, separate team slot and leave "${teamLabel}" exactly as it is?`,
      actions: [
        { label: `Apply to "${teamLabel}"`, primary: true, onClick: () => applyAmendments(pendingStrategy, "current") },
        { label: "Apply to a new team slot", onClick: () => applyAmendments(pendingStrategy, "new") },
        { label: "Cancel", onClick: hideModal },
      ],
    });
  } else {
    showModal({
      title: "No open team slots",
      body: `You already have all ${WINCON_MAX_TEAMS} team slots saved, so there's nowhere else to put this — applying these changes will overwrite "${teamLabel}"'s current build. Continue?`,
      actions: [
        { label: "Overwrite this team", primary: true, onClick: () => applyAmendments(pendingStrategy, "current") },
        { label: "Cancel", onClick: hideModal },
      ],
    });
  }
}

function applyAmendmentsToBuilds(amendments) {
  (amendments || []).forEach((amendment) => {
    const build = builds[amendment.pokemon];
    if (!build) return;
    if (amendment.moves) build.moves[amendment.moves.slotIndex] = amendment.moves.to;
    if (amendment.role) {
      build.nature = amendment.role.natureTo;
      build.sp = { ...amendment.role.spTo };
    }
    if (amendment.item) build.item = amendment.item.to;
  });
}

function applyAmendments(strategy, target) {
  hideModal();

  applyAmendmentsToBuilds(strategy.amendments);

  if (target === "new") {
    const nextNumber = teamState.teams.length + 1;
    const newTeam = wcEmptyTeam(`Team ${nextNumber}`);
    newTeam.chosen = [...chosen];
    newTeam.builds = JSON.parse(JSON.stringify(builds));
    newTeam.format = WINCON_BUILDER_FORMAT;
    newTeam.notes = notes;
    newTeam.sheetMode = sheetMode;
    teamState.teams.push(newTeam);
    activeId = newTeam.id;
    teamState.activeId = activeId;
    wcSaveTeamState(teamState);
    loadActiveIntoWorkingState();
    renderTeamTabs();
    renderSheetToggle();
    renderTeamNotes();
    renderMatchRecord();
    renderPicker();
    invalidateComputedNotes();
    renderSlots();
    saveStatus.textContent = `Strategy applied to new team "${newTeam.name}" — that team is saved and ready for the next stage of the build.`;
  } else {
    invalidateComputedNotes();
    renderSlots();
    syncWorkingStateIntoActiveTeam();
    const ok = wcSaveTeamState(teamState);
    saveStatus.textContent = ok
      ? "Strategy applied and saved — this team is ready for the next stage of the build."
      : "Strategy applied, but saving failed — your browser's storage may be full or unavailable.";
  }
}

// ---------------------------------------------------------------------------
// Matchup Score + Team type coverage + results tracker (Milestone 2a/3,
// merged into this page and made live in Milestone 14 — see
// refreshDerivedSections(), called every time renderSlots() runs)
// ---------------------------------------------------------------------------

function effectivePokemonFor(name, build) {
  return wcEffectivePokemon(data.pokemon, name, build && build.item) || data.pokemon.find((p) => p.name === name);
}

/**
 * The shared scoring pipeline behind both the main Matchup Score section
 * (threatsList = the reference list, data/starter-threats.json) and Your
 * Rival's success rate (threatsList = the synthesized rival's own 6) — see
 * wcScoreMatchup in strategy.js, which is where the Open Team Sheet
 * downgrade rule actually lives. Always scores the CURRENT chosen/builds
 * under this team's own sheetMode.
 */
function scoreAgainstThreats(threatsList) {
  const roster = chosen
    .map((name) => {
      const build = builds[name] || {};
      const pokemon = effectivePokemonFor(name, build);
      const baseStats = pokemon && data.baseStats.find((b) => b.name === pokemon.name);
      return pokemon ? { pokemon, build, baseStats } : null;
    })
    .filter(Boolean);

  const perThreat = threatsList.map((threat) => {
    const threatBaseStats = data.baseStats.find((b) => b.name === threat.name);
    const results = roster.map(({ pokemon, build, baseStats }) => ({
      pokemon,
      result: wcScoreMatchup(pokemon, build, baseStats, threat, threatBaseStats, data.natures, data.typeChart, data.moves, { sheetMode }),
    }));
    const best = results.reduce((a, b) => (b.result.points > a.result.points ? b : a));
    return { threat, results, best };
  });

  const favorableCount = perThreat.filter((t) => t.best.result.verdict === "favorable").length;
  const toughCount = perThreat.filter((t) => t.best.result.verdict === "unfavorable").length;
  const score = perThreat.length > 0 ? Math.round((favorableCount / perThreat.length) * 100) : 0;

  return { roster, perThreat, favorableCount, toughCount, score };
}

function refreshDerivedSections() {
  const hasTeam = chosen.length > 0;
  noTeamEl.hidden = hasTeam;
  scoreRivalHeaderRowEl.hidden = !hasTeam;
  scoreSectionEl.hidden = !hasTeam;
  coverageSectionEl.hidden = !hasTeam;
  trackerSectionEl.hidden = !hasTeam;
  rivalSectionEl.hidden = !hasTeam;
  if (!hasTeam) return;

  const result = scoreAgainstThreats(getThreatsWithTypes());
  renderScoreHero(result.score, result.favorableCount, result.toughCount, result.perThreat.length);
  renderToughList(document.getElementById("tough-list"), result.perThreat.filter((t) => t.best.result.verdict === "unfavorable"));
  renderMatrix(result.roster, result.perThreat);
  renderTypeCoverage();
  renderMatchTracker();
}

function renderScoreHero(score, favorableCount, toughCount, total) {
  document.getElementById("score-number").textContent = score;
  const ring = document.getElementById("score-ring");
  ring.style.setProperty("--score", score);
  document.getElementById("score-summary").textContent =
    `Favorable answers to ${favorableCount} of ${total} reference threats, ` +
    `no clear answer to ${toughCount} of them. This is a matchup score against a placeholder list — not a win rate.` +
    (sheetMode === "open" ? " Scored under your Open Team Sheet — move-dependent edges are already discounted." : "");

  renderScoreWinLoss(score, toughCount, total);
}

/**
 * The same "Projected Win/Loss Ratio" pill treatment as Your Rival's block
 * (see renderRival()), but against the generic 16-Pokémon reference list
 * instead of one synthesized rival: win rate = the score itself (the
 * favorable share), loss rate = that same list's unfavorable share. The
 * two don't have to sum to 100 -- an "even" verdict is neither favorable
 * nor unfavorable -- so this reuses the percent-based ratio formatter,
 * same as Your Rival.
 */
function renderScoreWinLoss(score, toughCount, total) {
  const mount = document.getElementById("score-winloss-mount");
  if (!mount) return;
  mount.innerHTML = "";
  if (total === 0) return;

  const winPct = score;
  const lossPct = Math.round((toughCount / total) * 100);
  const winTier = wcStatTier(winPct);
  const lossTier = wcStatTier(100 - lossPct);
  const ratioTier = winTier;

  const block = document.createElement("div");
  block.className = "winloss-block";
  const heading = document.createElement("h3");
  heading.className = "section-title";
  heading.textContent = "Projected Win/Loss Ratio";
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "From your Matchup Score against the 16-Pokémon reference list — a heuristic estimate, not a simulated battle or a measured win rate.";
  const row = document.createElement("div");
  row.className = "winloss-row";
  row.append(
    wcBuildWinLossStat("Your win rate", `${winPct}%`, winTier),
    wcBuildWinLossStat("Your loss rate", `${lossPct}%`, lossTier),
    wcBuildWinLossStat("Win ratio", wcFormatRatioFromPercents(winPct, lossPct), ratioTier)
  );
  block.append(heading, hint, row);
  mount.appendChild(block);
}

function renderToughList(container, toughEntries) {
  container.innerHTML = "";
  if (toughEntries.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "None — your team has at least an even answer to every one of these.";
    container.appendChild(p);
    return;
  }
  toughEntries.forEach(({ threat, best }) => {
    const card = document.createElement("div");
    card.className = "tough-card";
    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = threat.name;
    const role = document.createElement("div");
    role.className = "hint";
    role.textContent = threat.role || "";
    const bestNote = document.createElement("div");
    bestNote.className = "tough-best";
    bestNote.textContent = `Your best answer: ${best.pokemon.name} (still unfavorable)`;
    card.append(name, role, bestNote);
    container.appendChild(card);
  });
}

function verdictSymbol(verdict) {
  if (verdict === "favorable") return "+";
  if (verdict === "unfavorable") return "−";
  return "·";
}

function renderMatrix(roster, perThreat) {
  const table = document.getElementById("matrix");
  table.innerHTML = "";

  const headRow = document.createElement("tr");
  headRow.appendChild(document.createElement("th"));
  roster.forEach(({ pokemon }) => {
    const th = document.createElement("th");
    th.textContent = pokemon.name;
    headRow.appendChild(th);
  });
  table.appendChild(headRow);

  perThreat.forEach(({ threat, results }) => {
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.className = "row-label";
    label.textContent = threat.name;
    row.appendChild(label);
    results.forEach(({ result }) => {
      const cell = document.createElement("td");
      cell.className = `verdict-${result.verdict}`;
      cell.textContent = verdictSymbol(result.verdict);
      cell.title = result.statsKnown
        ? `offense ${result.offense}×, defense ${result.defense}×`
        : "no base-stat data for this Pokémon yet — offense/defense only";
      row.appendChild(cell);
    });
    table.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Team type coverage
// ---------------------------------------------------------------------------

const COVERAGE_TOP_N = 3;

function formatMult(mult) {
  const lookup = { 0: "0×", 0.25: "¼×", 0.5: "½×", 1: "1×", 2: "2×", 4: "4×" };
  return lookup[mult] ?? `${mult}×`;
}

function multClass(mult) {
  if (mult === 0) return "typemult-immune";
  if (mult < 1) return "typemult-resist";
  if (mult > 1) return "typemult-weak";
  return "typemult-neutral";
}

function renderTypeCoverage() {
  const members = chosen.map((name) => effectivePokemonFor(name, builds[name] || {})).filter(Boolean);
  if (members.length === 0) {
    coverageSectionEl.hidden = true;
    return;
  }

  const perType = data.typeChart.types.map((type) => {
    const memberMultipliers = members.map((m) => ({
      name: m.name,
      mult: wcEffectivenessOf(data.typeChart, type, m.types),
    }));
    const weak = memberMultipliers.filter((m) => m.mult > 1);
    const resistOrImmune = memberMultipliers.filter((m) => m.mult < 1);
    return { type, memberMultipliers, weak, resistOrImmune, netScore: resistOrImmune.length - weak.length };
  });

  const strengths = [...perType]
    .filter((t) => t.resistOrImmune.length > 0)
    .sort((a, b) => b.netScore - a.netScore || b.resistOrImmune.length - a.resistOrImmune.length)
    .slice(0, COVERAGE_TOP_N);

  const weaknesses = [...perType]
    .filter((t) => t.weak.length > 0)
    .sort((a, b) => a.netScore - b.netScore || b.weak.length - a.weak.length)
    .slice(0, COVERAGE_TOP_N);

  renderCoverageList(document.getElementById("coverage-strengths"), strengths, "resistOrImmune", "resist or are immune to this", members.length);
  renderCoverageList(document.getElementById("coverage-weaknesses"), weaknesses, "weak", "are weak (2× or worse) to this", members.length);
  renderCoverageTable(members, perType);
}

function renderCoverageList(container, entries, groupKey, verbPhrase, totalMembers) {
  container.innerHTML = "";
  if (entries.length === 0) {
    const li = document.createElement("li");
    li.className = "coverage-item";
    li.textContent = "None stand out — fairly even across the board.";
    container.appendChild(li);
    return;
  }
  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "coverage-item";
    const tag = document.createElement("span");
    tag.className = `type-tag type-${entry.type.toLowerCase()}`;
    tag.textContent = entry.type;
    const names = entry[groupKey].map((m) => m.name);
    li.appendChild(tag);
    li.appendChild(document.createTextNode(`${names.length} of ${totalMembers} ${verbPhrase}`));
    const detail = document.createElement("span");
    detail.className = "coverage-detail";
    detail.textContent = names.join(", ");
    li.appendChild(detail);
    container.appendChild(li);
  });
}

function renderCoverageTable(members, perType) {
  const table = document.getElementById("coverage-table");
  table.innerHTML = "";

  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = "Attack type";
  headRow.appendChild(corner);
  members.forEach((m) => {
    const th = document.createElement("th");
    th.textContent = m.name;
    headRow.appendChild(th);
  });
  table.appendChild(headRow);

  perType.forEach(({ type, memberMultipliers }) => {
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.className = "row-label";
    const tag = document.createElement("span");
    tag.className = `type-tag type-${type.toLowerCase()}`;
    tag.textContent = type;
    label.appendChild(tag);
    row.appendChild(label);
    memberMultipliers.forEach(({ mult }) => {
      const cell = document.createElement("td");
      cell.className = multClass(mult);
      cell.textContent = formatMult(mult);
      row.appendChild(cell);
    });
    table.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Track your results
// ---------------------------------------------------------------------------

const trackerNoteInput = document.getElementById("tracker-note-input");
const trackerSummaryEl = document.getElementById("tracker-summary");
const trackerLogListEl = document.getElementById("tracker-log-list");
const trackerOpponentGrid = document.getElementById("tracker-opponent-grid");
const trackerOpponentDetails = document.getElementById("tracker-opponent-details");
const OPPONENT_SLOT_COUNT = 6;

function setupOpponentGrid() {
  const datalistId = "tracker-opponent-options";
  if (!document.getElementById(datalistId)) {
    const datalist = document.createElement("datalist");
    datalist.id = datalistId;
    data.pokemon.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.name;
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

function logMatchResult(result) {
  const team = getActiveTeam();
  if (!team) return;
  wcRecordMatchResult(team, result, trackerNoteInput.value, collectOpponentTeam());
  trackerNoteInput.value = "";
  clearOpponentTeam();
  wcSaveTeamState(teamState);
  renderMatchRecord();
  renderMatchTracker();
}

function deleteMatchResult(index) {
  const team = getActiveTeam();
  if (!team) return;
  wcDeleteMatchResult(team, index);
  wcSaveTeamState(teamState);
  renderMatchRecord();
  renderMatchTracker();
}

function renderMatchTracker() {
  const team = getActiveTeam();
  if (!team) return;
  const summary = wcMatchRecordSummary(team);
  trackerSummaryEl.innerHTML = "";

  if (summary.total === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.style.margin = "0";
    p.textContent = "No results logged yet for this team.";
    trackerSummaryEl.appendChild(p);
  } else {
    // winRate is already rounded by wcMatchRecordSummary; lossRate is its
    // own independent rounding of losses/total, so the two don't always
    // sum to exactly 100 — a normal, minor artifact of rounding two
    // integers separately, not a bug.
    const lossRate = Math.round((summary.losses / summary.total) * 100);
    const winTier = wcStatTier(summary.winRate);
    const lossTier = wcStatTier(100 - lossRate);
    const ratioTier = winTier;

    const caption = document.createElement("p");
    caption.className = "hint";
    caption.style.margin = "0 0 8px";
    caption.textContent = `${summary.wins}W – ${summary.losses}L across ${summary.total} logged game${summary.total === 1 ? "" : "s"}.`;

    const row = document.createElement("div");
    row.className = "winloss-row";
    row.append(
      wcBuildWinLossStat("Win rate", `${summary.winRate}%`, winTier),
      wcBuildWinLossStat("Loss rate", `${lossRate}%`, lossTier),
      wcBuildWinLossStat("Win ratio", wcFormatRatioFromCounts(summary.wins, summary.losses), ratioTier)
    );

    trackerSummaryEl.append(caption, row);
  }

  trackerLogListEl.innerHTML = "";
  const log = Array.isArray(team.matchLog) ? team.matchLog : [];
  const RECENT_LIMIT = 10;
  const recentIndexed = log.map((entry, index) => ({ entry, index })).slice(-RECENT_LIMIT).reverse();

  if (log.length > RECENT_LIMIT) {
    const olderNote = document.createElement("li");
    olderNote.className = "hint";
    olderNote.textContent = `Showing the ${RECENT_LIMIT} most recent of ${log.length} logged games.`;
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
    deleteBtn.addEventListener("click", () => deleteMatchResult(index));
    li.appendChild(deleteBtn);

    trackerLogListEl.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Your Rival (Milestone 14) — synthesized from the full roster, not just
// what you've obtained, specifically to counter THIS team
// ---------------------------------------------------------------------------

/**
 * Every roster Pokémon (Mega forms excluded — they're never independently
 * picked, same rule as the picker above) with enough data to actually
 * build a set, excluding whatever's already on YOUR team (a rival that's
 * just your own team back at you isn't much of a rival).
 */
function buildRivalPool() {
  const excluded = new Set(chosen);
  const pool = [];
  data.pokemon.forEach((p) => {
    if (wcIsMegaForm(p)) return;
    if (excluded.has(p.name)) return;
    const baseStats = data.baseStats.find((b) => b.name === p.name);
    const learnableNames = data.learnsets[p.name];
    if (!baseStats || !learnableNames) return;
    pool.push({ name: p.name, types: p.types, baseStats, learnableNames, megaForms: megaFormsFor(p.name) });
  });
  return pool;
}

/** Your current 6 (effective identity — Mega-aware), shaped as a "threats" list so wcPickDreamTeam can pick a team that scores well specifically against IT, in reverse. */
function myTeamAsThreats() {
  return chosen
    .map((name) => effectivePokemonFor(name, builds[name] || {}))
    .filter(Boolean)
    .map((p) => ({ name: p.name, types: p.types, role: "Your team" }));
}

function findYourRival() {
  if (chosen.length === 0) {
    rivalNoteEl.hidden = false;
    rivalNoteEl.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = "Pick your six first — Your Rival is synthesized specifically to counter the team you've built.";
    rivalNoteEl.appendChild(p);
    rivalResultEl.hidden = true;
    return;
  }

  const pool = buildRivalPool();
  if (pool.length < 6) {
    rivalNoteEl.hidden = false;
    rivalNoteEl.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = `Not enough roster data yet to synthesize a rival (found ${pool.length} eligible Pokémon with confirmed base stats and a learnset — need at least 6).`;
    rivalNoteEl.appendChild(p);
    rivalResultEl.hidden = true;
    return;
  }

  const myThreats = myTeamAsThreats();
  // Same greedy "Dream Team" picker used to build YOUR best 6 (Milestone
  // 8) — run here in reverse, with the pool being the WHOLE roster and
  // the "threats" being your own team, so it picks a 6 that specifically
  // answers your typing/stats well instead of a generic reference list.
  const { chosen: rivalNames, reasoning } = wcPickDreamTeam(pool, myThreats, data.typeChart, 6);
  const rivalMembers = rivalNames.map((name) => pool.find((m) => m.name === name));
  // The rival's own moveset is generated for narrative/display only — it
  // never feeds the numeric score below (wcScoreMatchup only reads the
  // opposing side's types + base Speed, never its moves), so it's always
  // synthesized as a normal Closed-Sheet build regardless of YOUR sheetMode.
  const { builds: rivalBuilds } = wcGenerateTeamBuilds(rivalMembers, data.moves, myThreats, data.typeChart, WINCON_BUILDER_FORMAT, data.abilities, "closed");

  const rivalAsThreats = rivalMembers.map((m) => ({ name: m.name, types: m.types, role: "Your Rival" }));
  const myResult = scoreAgainstThreats(rivalAsThreats);
  const rivalSuccessRate = 100 - myResult.score;

  pendingRival = { rivalMembers, rivalBuilds, reasoning, rivalSuccessRate, myResult };
  renderRival(pendingRival);
}

function renderRival(rival) {
  rivalNoteEl.hidden = true;
  rivalResultEl.hidden = false;
  rivalResultEl.innerHTML = "";

  // rival.myResult.score and rival.rivalSuccessRate are two ends of the
  // same head-to-head estimate (they're defined as complements of each
  // other — see findYourRival()), so the second number doubles as "your
  // loss rate against this specific rival" without any extra scoring work.
  const winPct = rival.myResult.score;
  const lossPct = rival.rivalSuccessRate;
  const winTier = wcStatTier(winPct);
  const lossTier = wcStatTier(100 - lossPct);
  const ratioTier = winTier;

  const winlossBlock = document.createElement("div");
  winlossBlock.className = "winloss-block";
  const winlossHeading = document.createElement("h3");
  winlossHeading.className = "section-title";
  winlossHeading.textContent = "Projected Win/Loss Ratio";
  const winlossHint = document.createElement("p");
  winlossHint.className = "hint";
  winlossHint.textContent =
    "From your Matchup Score against this specific synthesized rival — a heuristic estimate, not a simulated battle or a measured win rate.";
  const winlossRow = document.createElement("div");
  winlossRow.className = "winloss-row";
  winlossRow.append(
    wcBuildWinLossStat("Your win rate", `${winPct}%`, winTier),
    wcBuildWinLossStat("Your loss rate", `${lossPct}%`, lossTier),
    wcBuildWinLossStat("Win ratio", wcFormatRatioFromPercents(winPct, lossPct), ratioTier)
  );
  winlossBlock.append(winlossHeading, winlossHint, winlossRow);
  rivalResultEl.appendChild(winlossBlock);

  const hero = document.createElement("div");
  hero.className = "score-hero";

  const ring = document.createElement("div");
  ring.className = "score-ring";
  ring.id = "rival-score-ring";
  ring.style.setProperty("--score", rival.rivalSuccessRate);
  const num = document.createElement("span");
  num.textContent = rival.rivalSuccessRate;
  ring.appendChild(num);

  const meta = document.createElement("div");
  meta.className = "score-meta";
  const heading = document.createElement("h3");
  heading.className = "section-title";
  heading.textContent = "Your Rival's estimated success rate";
  const summary = document.createElement("p");
  summary.className = "hint";
  summary.textContent =
    `Synthesized from the full roster specifically to counter this team — estimated to beat you ${rival.rivalSuccessRate}% of the time ` +
    `(your own Matchup Score against them: ${rival.myResult.score}%).` +
    (sheetMode === "open"
      ? " Scored with your Open Team Sheet in effect — your own move-dependent edges are already discounted."
      : "");
  meta.append(heading, summary);
  hero.append(ring, meta);
  rivalResultEl.appendChild(hero);

  const reasonHeading = document.createElement("p");
  const reasonStrong = document.createElement("strong");
  reasonStrong.textContent = "Why this rival beats you";
  reasonHeading.appendChild(reasonStrong);
  rivalResultEl.appendChild(reasonHeading);
  const list = document.createElement("ol");
  rival.reasoning.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    list.appendChild(li);
  });
  rivalResultEl.appendChild(list);

  const rosterHeading = document.createElement("p");
  const rosterStrong = document.createElement("strong");
  rosterStrong.textContent = "Their roster";
  rosterHeading.appendChild(rosterStrong);
  rivalResultEl.appendChild(rosterHeading);

  const rosterGrid = document.createElement("div");
  rosterGrid.className = "slots rival-roster";
  rival.rivalMembers.forEach((member) => {
    const build = rival.rivalBuilds[member.name] || emptyBuild();
    const effective = wcEffectivePokemon(data.pokemon, member.name, build.item) || member;
    const card = document.createElement("article");
    card.className = "slot-card rival-card";

    const header = document.createElement("div");
    header.className = "slot-header";
    const sprite = spriteImg(effective.name, "slot-sprite");
    if (sprite) header.appendChild(sprite);
    const title = document.createElement("div");
    title.className = "card-name";
    title.textContent = effective.name;
    const types = document.createElement("div");
    types.className = "card-types";
    (effective.types || member.types).forEach((type) => {
      const tag = document.createElement("span");
      tag.className = `type-tag type-${type.toLowerCase()}`;
      tag.textContent = type;
      types.appendChild(tag);
    });
    header.append(title, types);

    const abilityInfo = data.abilities && data.abilities[effective.name];
    if (abilityInfo) {
      const badge = document.createElement("span");
      badge.className = "ability-badge";
      if (abilityInfo.confidence === "low") badge.classList.add("is-low-confidence");
      badge.textContent = `Ability: ${abilityInfo.ability}`;
      header.appendChild(badge);
    }

    const detail = document.createElement("p");
    detail.className = "hint rival-card-detail";
    const moveList = (build.moves || []).filter(Boolean).join(", ") || "no confirmed moveset";
    detail.textContent = `${build.item ? `Holding ${build.item}. ` : ""}${moveList}`;

    card.append(header, detail);
    rosterGrid.appendChild(card);
  });
  rivalResultEl.appendChild(rosterGrid);

  const worstAgainstMe = rival.myResult.perThreat.filter((t) => t.best.result.verdict === "unfavorable");
  const toughHeading = document.createElement("p");
  const toughStrong = document.createElement("strong");
  toughStrong.textContent = "Your hardest matchups against them";
  toughHeading.appendChild(toughStrong);
  rivalResultEl.appendChild(toughHeading);
  const toughContainer = document.createElement("div");
  toughContainer.className = "tough-list";
  rivalResultEl.appendChild(toughContainer);
  renderToughList(toughContainer, worstAgainstMe);
}

/*
 * Hover tooltips for the Item and Move fields (unchanged from Milestone 9),
 * plus the ability badge tooltip (Milestone 13).
 */
let fieldTooltipEl = null;
let currentTooltipAnchor = null;

function ensureFieldTooltipEl() {
  if (fieldTooltipEl) return fieldTooltipEl;
  fieldTooltipEl = document.createElement("div");
  fieldTooltipEl.id = "field-tooltip";
  fieldTooltipEl.style.display = "none";
  document.body.appendChild(fieldTooltipEl);
  return fieldTooltipEl;
}

function hideFieldTooltip() {
  currentTooltipAnchor = null;
  if (!fieldTooltipEl) return;
  fieldTooltipEl.style.display = "none";
}

function repositionFieldTooltipIfVisible() {
  if (currentTooltipAnchor) positionFieldTooltip(currentTooltipAnchor);
}

function positionFieldTooltip(anchorEl) {
  currentTooltipAnchor = anchorEl;
  const el = ensureFieldTooltipEl();
  const margin = 8;
  el.style.visibility = "hidden";
  el.style.display = "block";
  const rect = anchorEl.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  let top = rect.top - height - margin;
  if (top < margin) top = rect.bottom + margin;
  let left = rect.left;
  const maxLeft = window.innerWidth - width - margin;
  if (left > maxLeft) left = Math.max(margin, maxLeft);
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.visibility = "visible";
}

function showMoveFieldTooltip(input) {
  const move = data.moves.find((m) => m.name === input.value);
  if (!move) {
    hideFieldTooltip();
    return;
  }
  const el = ensureFieldTooltipEl();
  el.className = `field-tooltip type-tooltip-${move.type.toLowerCase()}`;
  el.innerHTML = "";

  const name = document.createElement("div");
  name.className = "field-tooltip-name";
  name.textContent = move.name;

  const typeLine = document.createElement("div");
  typeLine.className = "field-tooltip-type";
  typeLine.textContent = `${move.type} · ${move.category}`;

  const stats = document.createElement("div");
  stats.className = "field-tooltip-stats";
  const power = move.power > 0 ? move.power : "—";
  const accuracy = move.accuracy == null ? "—" : `${move.accuracy}%`;
  stats.textContent = `Power ${power} · Accuracy ${accuracy} · PP ${move.pp}`;

  const desc = document.createElement("p");
  desc.className = "field-tooltip-desc";
  desc.textContent = move.description || "No additional effect.";

  el.append(name, typeLine, stats, desc);
  positionFieldTooltip(input);
}

function showItemFieldTooltip(input) {
  const raw = input.value.trim();
  if (!raw) {
    hideFieldTooltip();
    return;
  }
  const item =
    data.items.find((i) => i.name === raw) ||
    data.items.find((i) => i.name.toLowerCase() === raw.toLowerCase());
  if (!item) {
    hideFieldTooltip();
    return;
  }
  const el = ensureFieldTooltipEl();
  el.className = "field-tooltip";
  el.innerHTML = "";

  const name = document.createElement("div");
  name.className = "field-tooltip-name";
  name.textContent = item.name;

  const desc = document.createElement("p");
  desc.className = "field-tooltip-desc";
  desc.textContent = item.description || "No listed effect.";

  el.append(name, desc);
  positionFieldTooltip(input);
}

function showAbilityFieldTooltip(el, abilityInfo) {
  const tip = ensureFieldTooltipEl();
  tip.className = "field-tooltip";
  tip.innerHTML = "";

  const name = document.createElement("div");
  name.className = "field-tooltip-name";
  name.textContent = abilityInfo.ability;

  const desc = document.createElement("p");
  desc.className = "field-tooltip-desc";
  desc.textContent = abilityInfo.description || "No additional effect listed.";
  tip.append(name, desc);

  if (abilityInfo.confidence === "low") {
    const lowConf = document.createElement("p");
    lowConf.className = "field-tooltip-desc field-tooltip-lowconf";
    lowConf.textContent =
      "Best-available pick — sourcing was genuinely ambiguous between two real, commonly-used abilities for this Pokémon.";
    tip.appendChild(lowConf);
  }

  positionFieldTooltip(el);
}

function attachFieldHoverTooltip(input, showFn) {
  input.addEventListener("mouseenter", () => showFn(input));
  input.addEventListener("mouseleave", hideFieldTooltip);
  input.addEventListener("input", () => {
    if (fieldTooltipEl && fieldTooltipEl.style.display !== "none") showFn(input);
  });
}

window.addEventListener("scroll", repositionFieldTooltipIfVisible, true);
window.addEventListener("resize", repositionFieldTooltipIfVisible);
