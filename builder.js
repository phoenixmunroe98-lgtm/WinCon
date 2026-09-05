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

/**
 * @type {{pokemon: any[], moves: any[], items: any[], natures: any[], learnsets: Record<string,string[]>, baseStats: any[], threats: any[], typeChart: any,
 *   abilities: Record<string,{ability: string, description: string, confidence?: string}>,
 *   abilityOptions: Record<string,{name: string, isHidden: boolean}[]>,
 *   abilityDex: Record<string,string>}}
 *
 * abilities is the site's single "best/most-common" pick per species (Milestone 13) --
 * still what auto-build/auto-strategy/Matchup Score assume. abilityOptions (Milestone 17)
 * is the real, full Ability 1/Ability 2/Hidden Ability list per species -- present only
 * for the 221 non-Mega roster entries, since a Mega Evolution's ability is fixed with no
 * alternates to pick from. abilityDex is the shared name -> description pool every ability
 * name (in either abilities or abilityOptions) resolves against, same pattern as moves.json.
 */
let data = {};

/** Milestone 28: data.pokemon keyed by name, built once data loads — a lookup wcAugmentThreatsWithMetaUsage (strategy.js) needs to attach real types to any species meta_usage_stats names that isn't already in the curated threat list. */
let pokemonByName = {};

/** Milestone 28: the real, cross-user usage/win-rate lookup from meta_usage_stats (see wcFetchMetaUsageStats in teams.js) for THIS page's format — {} (meaning "no real data yet, defer entirely to the curated heuristics") until init() below resolves it, and again whenever nobody's signed in (meta_usage_stats is read-only to signed-in accounts only, same as the rest of this page's toolkit). */
let metaUsageLookup = {};

/** Simulated Win Rate: the real, cross-user combo (bring-4/3 lineup) win-rate lookup from combo_synergy_stats (see wcFetchComboSynergyStats in teams.js) for THIS page's format — {} until init() resolves it or whenever signed out, same gating as metaUsageLookup. Consumed by wcComboSynergyBonus (strategy.js) when ranking candidate lineups in battle-sim-lineup.js. */
let comboSynergyLookup = {};

/** Milestone 34 (the Limitless pipeline): the live, cross-user usage/win-rate lookup from live_tier_stats (see wcFetchLiveTierStats in teams.js) for THIS page's format -- {} until init()/wcSyncTeamStateForAuth() resolves it, whenever signed out, or always for Singles (Limitless has no official Singles tournament data -- see wcFetchLiveTierStats's own comment). Consumed by wcAugmentThreatsWithLiveMeta (strategy.js), slotted between the real-logged-data and curated-baseline threat layers in getThreatsWithTypes() below. */
let liveMetaLookup = {};

/** "Untapped gem" follow-up to Milestone 34: the live_meta_builds lookup (see wcFetchLiveMetaBuilds in teams.js) for THIS page's format -- same lifecycle/gating as liveMetaLookup just above (refreshed alongside it in wcSyncTeamStateForAuth(), {} while signed out or for Singles). Consumed by wcLiveMegaSetFor (strategy.js, via wcHasKnownMegaOption/wcPickAutoMegaForm) so Dream Team/Auto-build/autofill can proactively opt into a Mega form with real, live-confirmed tournament usage even when it isn't on the hand-curated WINCON_META_KNOWN_SETS list. */
let liveMetaBuildsLookup = {};

/**
 * Locked builds: a permanent, per-species Nature/Stat Points/moveset the
 * signed-in user has pinned (see supabase/migrations/0008_locked_builds.sql
 * and wcFetchLockedBuilds/wcSaveLockedBuild/wcDeleteLockedBuild in
 * teams.js). {[species]: {nature, sp, moves}} for THIS page's format --
 * refreshed alongside every other per-format lookup in
 * wcSyncTeamStateForAuth(), {} while signed out. Read by every build-
 * generation call site (autoBuildSingle/autoBuildTeam/generateDreamTeam,
 * but deliberately NOT Your Rival's own synthesized-opponent generation)
 * so a locked species' build is reused instead of regenerated, and by
 * renderSlot/applyAmendmentsToBuilds to gate manual editing and redirect
 * would-be strategy-amendment changes into a Current/Recommended preview
 * (build.recommendedBuild/build.buildView) instead of silently applying.
 */
let lockedBuildsLookup = {};

/** Simulated Win Rate: data/meta-baseline.json's curated Worlds-2026-grounded reference teams for THIS page's format ({doubles:[...], singles:[...]} — only this page's own array is read from). Static file, not auth-gated, loaded once in init() alongside the rest of data/*.json. Feeds wcMetaBaselineSynergyNote/wcMetaBaselineArchetypeBonus/wcAugmentThreatsWithMetaBaseline (strategy.js) and is the opponent pool battle-sim-lineup.js samples against for the Simulated Win Rate itself. */
let metaBaselineData = { doubles: [], singles: [] };

/** Simulated Win Rate: the three curated mechanical-effect overlay files (data/move-effects.json, ability-effects.json, item-effects.json) — keyed lookups merged onto data.moves/data.abilities/data.items by battle-sim-engine.js at battler-build time. Loaded once in init(); empty objects until then (every lookup in the engine already defaults safely to a no-op for any name absent from these). */
let moveEffectsData = {};
let abilityEffectsData = {};
let itemEffectsData = {};

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

/** "obtained" | "full" — which candidate pool Generate Dream Team draws from: your own Pokédex tracker's "obtained" list, or the whole roster (Milestone 40). See wcGetPoolScope in teams.js. */
let poolScope = "obtained";

/** The last strategy analysis result from "Auto-build strategy", or null if none is showing / it's gone stale since a field changed. */
let pendingStrategy = null;
// Milestone 45: holds both generated Dream Team candidates -- 
// { option1, option2 (or null), activeOption } -- see
// generateDreamTeam/selectDreamTeamOption/renderDreamTeamOptionsControl.
let dreamTeamOptionsState = null;

/** The last "Find Your Rival" result, or null if none is showing / it's gone stale since the team changed. See findYourRival() below. */
let pendingRival = null;

/** Simulated Win Rate state -- see refreshSimulatedWinRate()/runSimulatedWinRate() below.
 * simWinRateResult: the last { lineup, format, scenarios } from wcRunSimAsync("simulateWinRate", ...), or null if none has run yet for the current complete-team streak.
 * simWinRateNeedsRerun: true once an edit has happened since simWinRateResult was computed -- shows a "team has changed" note on the Re-run button rather than silently re-simulating.
 * simWinRateWasComplete: isTeamComplete()'s value the last time refreshSimulatedWinRate() checked it -- the one-shot "incomplete -> complete" transition detector that triggers the auto-run.
 * simWinRateInFlight: guards against overlapping runs (e.g. a stray extra click on Re-run while one is already running). */
let simWinRateResult = null;
let simWinRateNeedsRerun = false;
let simWinRateWasComplete = false;
let simWinRateInFlight = false;

const teamTabsEl = document.getElementById("team-tabs");
const teamNameInput = document.getElementById("team-name-input");
const renameTeamBtn = document.getElementById("rename-team-btn");
const newTeamBtn = document.getElementById("new-team-btn");
const deleteTeamBtn = document.getElementById("delete-team-btn");
const moveFormatBtn = document.getElementById("move-format-btn");
const exportTeamBtn = document.getElementById("export-team-btn");
const importTeamBtn = document.getElementById("import-team-btn");
const exportModal = document.getElementById("export-modal");
const exportModalText = document.getElementById("export-modal-text");
const exportModalCopyBtn = document.getElementById("export-modal-copy-btn");
const exportModalCloseBtn = document.getElementById("export-modal-close-btn");
const importModal = document.getElementById("import-modal");
const importModalText = document.getElementById("import-modal-text");
const importModalPreview = document.getElementById("import-modal-preview");
const importModalParseBtn = document.getElementById("import-modal-parse-btn");
const importModalApplyBtn = document.getElementById("import-modal-apply-btn");
const importModalCloseBtn = document.getElementById("import-modal-close-btn");
const teamsHint = document.getElementById("teams-hint");
const sheetToggleEl = document.getElementById("sheet-toggle");
const poolScopeToggleEl = document.getElementById("pool-scope-toggle");
const teamNotesInput = document.getElementById("team-notes-input");
const matchRecordEl = document.getElementById("match-record-note");

const dreamTeamBtn = document.getElementById("dream-team-btn");
const dreamTeamNoteEl = document.getElementById("dream-team-note");
const dreamTeamOptionsEl = document.getElementById("dream-team-options");
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
const pilotGuideNoteEl = document.getElementById("pilot-guide-note");
const modalOverlay = document.getElementById("changes-modal");
const modalTitle = document.getElementById("changes-modal-title");
const modalBody = document.getElementById("changes-modal-body");
const modalActions = document.getElementById("changes-modal-actions");

// Simulated Win Rate: replaces the old #score-winloss-section/#score-
// matrix-section (both deleted from the DOM, along with their
// renderScoreHero/renderScoreWinLoss/renderMatrix rendering functions) --
// see refreshSimulatedWinRate()/runSimulatedWinRate() below.
const simulatedWinrateSectionEl = document.getElementById("simulated-winrate-section");
const simwinrateHintEl = document.getElementById("simwinrate-hint");
const simwinrateLoadingEl = document.getElementById("simwinrate-loading");
const simwinrateScenariosEl = document.getElementById("simwinrate-scenarios");
const simwinrateRerunBtn = document.getElementById("simwinrate-rerun-btn");
const simwinrateMethodologyEl = document.getElementById("simwinrate-methodology");

/** Milestone 18 named this "score-rival-header-row" back when Matchup Score's own ring sat here too; Simulated Win Rate replacing that section made it just Your Rival's compact intro/button, so the id was simplified to match -- see #rival-header-row in singles-builder.html/doubles-builder.html. */
const rivalHeaderRowEl = document.getElementById("rival-header-row");
const coverageSectionEl = document.getElementById("coverage-section");
/** Comparison-driven additions (see renderTeamThreats()/renderSpeedTiers() below): pokemon-zone.com's Team Builder equivalents of these are its "Threats" and "Speed" tabs. Gated the same way as coverageSectionEl in refreshDerivedSections() -- visible once a team's been started and the player is signed in, no need to wait for a complete team. */
const teamThreatsSectionEl = document.getElementById("team-threats-section");
const speedTiersSectionEl = document.getElementById("speed-tiers-section");
const noTeamEl = document.getElementById("no-team");

const rivalSectionEl = document.getElementById("rival-section");
const rivalBtn = document.getElementById("rival-btn");
const rivalNoteEl = document.getElementById("rival-note");
const rivalResultEl = document.getElementById("rival-result");

init();

async function init() {
  const [pokemon, moves, items, natures, learnsets, baseStats, threats, typeChart, sprites, abilities, abilityOptions, abilityDex, metaBaseline, moveEffects, abilityEffects, itemEffects] = await Promise.all([
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
    fetchJSON("data/ability-options.json"),
    fetchJSON("data/ability-dex.json"),
    fetchJSON("data/meta-baseline.json"),
    fetchJSON("data/move-effects.json"),
    fetchJSON("data/ability-effects.json"),
    fetchJSON("data/item-effects.json"),
  ]);
  data = { pokemon, moves, items, natures, learnsets, baseStats, threats, typeChart, sprites, abilities, abilityOptions, abilityDex };
  pokemonByName = {};
  pokemon.forEach((p) => { pokemonByName[p.name] = p; });
  // Simulated Win Rate: static overlay/reference data, not auth-gated --
  // loaded once here alongside the rest of data/*.json (see the module-level
  // doc comments above these four variables' declarations for what each feeds).
  metaBaselineData = metaBaseline || { doubles: [], singles: [] };
  moveEffectsData = moveEffects || {};
  abilityEffectsData = abilityEffects || {};
  itemEffectsData = itemEffects || {};

  // Milestone 22: pulls in any teams saved to this account from another
  // device before anything else runs -- specifically before
  // ensureActiveTeam() below, which can itself trigger a save. Doing the
  // cloud merge first matters: a save that goes out BEFORE this device's
  // local (possibly empty) team list has been reconciled with the
  // account's would look, from the cloud's side, exactly like the account
  // just deleted every team it had (see wcPushTeamsToCloudIfSignedIn's
  // delete-diff in teams.js).
  // Milestone 26: wcSyncTeamStateForAuth() wraps that same cloud merge and
  // additionally decides -- via a direct, race-free session check, not the
  // possibly-not-yet-resolved window.wcAuth.isSignedIn() -- whether it's
  // actually safe to load any of it into view (see that function's own
  // comment for why this matters).
  await wcSyncTeamStateForAuth();

  renderTeamTabs();
  renderSheetToggle();
  renderPoolScopeToggle();
  renderTeamNotes();
  renderMatchRecord();
  renderPicker();
  renderSlots();

  saveBtn.addEventListener("click", saveDraft);
  renameTeamBtn.addEventListener("click", renameActiveTeam);
  newTeamBtn.addEventListener("click", addTeam);
  deleteTeamBtn.addEventListener("click", deleteActiveTeam);
  moveFormatBtn.addEventListener("click", moveActiveTeamToOtherFormat);
  exportTeamBtn.addEventListener("click", openExportModal);
  exportModalCopyBtn.addEventListener("click", copyExportModalText);
  exportModalCloseBtn.addEventListener("click", closeExportModal);
  importTeamBtn.addEventListener("click", openImportModal);
  importModalParseBtn.addEventListener("click", previewImportModalText);
  importModalApplyBtn.addEventListener("click", applyImportModalText);
  importModalCloseBtn.addEventListener("click", closeImportModal);
  autobuildBtn.addEventListener("click", autoBuildTeam);
  autostrategyBtn.addEventListener("click", autoBuildStrategy);
  dreamTeamBtn.addEventListener("click", generateDreamTeam);
  rivalBtn.addEventListener("click", findYourRival);
  if (simwinrateRerunBtn) simwinrateRerunBtn.addEventListener("click", () => runSimulatedWinRate());
  sheetToggleEl.querySelectorAll(".format-option").forEach((btn) => {
    btn.addEventListener("click", () => setSheetMode(btn.dataset.sheet));
  });
  poolScopeToggleEl.querySelectorAll(".format-option").forEach((btn) => {
    btn.addEventListener("click", () => setPoolScope(btn.dataset.pool));
  });
  teamNotesInput.addEventListener("change", () => {
    if (!wcRequireAccount((msg) => { teamsHint.textContent = msg; }, "add team notes")) {
      teamNotesInput.value = notes;
      return;
    }
    notes = teamNotesInput.value;
    const active = getActiveTeam();
    if (active) {
      active.notes = notes;
      wcSaveTeamState(teamState);
    }
    invalidateComputedNotes();
  });

  // Milestone 28: logging a result (and its history) now lives on
  // battle-tracker.html -- see that page's own script for the form/list
  // this used to mount here.

  const analysisLockedSigninBtn = document.getElementById("analysis-locked-signin-btn");
  if (analysisLockedSigninBtn) {
    analysisLockedSigninBtn.addEventListener("click", () => {
      if (window.wcAuth && window.wcAuth.openModal) window.wcAuth.openModal("signup");
    });
  }

  // Milestone 25: re-render the moment sign-in state changes (sign in,
  // sign out, or the initial session check resolving after this page's
  // own first render already ran signed-out-by-default) so every lock
  // above lifts live, with no reload needed. Guarded on wcInitDone since
  // this listener is registered once at module load (see below) and can
  // fire before this init() has finished its own first render.
  // Milestone 26: also re-runs wcSyncTeamStateForAuth() first, so signing
  // in loads this account's real teams into view (and signing out clears
  // whatever was showing) instead of just re-rendering whatever was
  // already sitting in the working state.
  window.addEventListener("wc:auth-changed", async () => {
    if (!wcInitDone) return;
    await wcSyncTeamStateForAuth();
    invalidateComputedNotes();
    autogenHint.textContent = "";
    saveStatus.textContent = "";
    wcUpdateSignedOutBodyClass();
    renderTeamTabs();
    renderSheetToggle();
    renderPoolScopeToggle();
    renderTeamNotes();
    renderMatchRecord();
    renderPicker();
    renderSlots();
  });

  wcInitDone = true;
  wcUpdateSignedOutBodyClass();
}

/** Set once init()'s first render has completed -- see the wc:auth-changed listener above, registered before this can be guaranteed true. */
let wcInitDone = false;

/** Milestone 25: toggles a body-level class the stylesheet uses to visually dim every locked control/button at once (see "Milestone 25: sign-up gate" in styles.css) -- kept separate from the actual click/change guards below, which are what really enforce the lock; this only makes that state visible before a player tries to interact. */
function wcUpdateSignedOutBodyClass() {
  document.body.classList.toggle("wc-signed-out", !wcIsSignedIn());
}

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Couldn't load ${path} (${response.status})`);
  return response.json();
}

/**
 * Milestone 27: while signed out, this reads sessionStorage rather than
 * the real, long-lived localStorage -- the same read-leak fix Milestone 26
 * applied to team data, applied here to the picker's pool of obtained
 * Pokémon. sessionStorage (not an in-memory variable, and not
 * localStorage) specifically so marking obtained on the Pokédex tracker
 * page while signed out (see app.js's wcLoadSignedOutObtained()) still
 * shows up here after navigating over -- both pages agree on the exact
 * same key, just in a store that forgets itself once this browser
 * tab/session ends rather than remembering indefinitely. Reads
 * wcTeamDataSignedIn (set by wcSyncTeamStateForAuth(), which always runs
 * before this is called from renderPicker()) rather than re-checking
 * sign-in itself.
 */
function getObtainedNames() {
  try {
    const raw = wcTeamDataSignedIn ? localStorage.getItem(OBTAINED_KEY) : sessionStorage.getItem(OBTAINED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

/** The curated 16-Pokémon reference threat list (data/starter-threats.json) with each entry's real types attached — still used by Generate Dream Team, Auto-build team, and Auto-build strategy, so their picks/roles never quietly disagree about what a threat's types are. (Milestone 20 grew a separate, literally-every-Pokémon list for the old Matchup Score section's own win/loss display, since this curated 16 was found too skewed toward Mega forms for that purpose — that whole section, and the list built for it, were retired outright once Simulated Win Rate shipped; this curated list lives on for the picking/building features above, which are about a team's shape, not a win-rate figure.) Milestone 28: also layered with any real, cross-user "frequently faced and genuinely scary" species from meta_usage_stats (see wcAugmentThreatsWithMetaUsage in strategy.js and metaUsageLookup below), then (Milestone 34) with real Regulation M-B tournament results from live_tier_stats (see wcAugmentThreatsWithLiveMeta in strategy.js and liveMetaLookup below), then with data/meta-baseline.json's curated Worlds-grounded reference field (see wcAugmentThreatsWithMetaBaseline in strategy.js and metaBaselineData below) — all three silently a no-op until real data/curated entries are actually there to add. */
function getThreatsWithTypes() {
  const curated = data.threats.map((t) => {
    const p = data.pokemon.find((x) => x.name === t.name);
    const baseStats = data.baseStats.find((b) => b.name === t.name);
    const ability = wcAbilityOf(data.abilities, t.name);
    return { ...t, types: p ? p.types : [], baseStats, ability };
  });
  const withRealUsage = wcAugmentThreatsWithMetaUsage(curated, metaUsageLookup, pokemonByName);
  const withLiveMeta = wcAugmentThreatsWithLiveMeta(withRealUsage, liveMetaLookup, pokemonByName);
  return wcAugmentThreatsWithMetaBaseline(withLiveMeta, metaBaselineData, WINCON_BUILDER_FORMAT, pokemonByName);
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
  poolScope = wcGetPoolScope(active);
  // Simulated Win Rate: a freshly-loaded team (switching tabs, a new/moved
  // team, etc.) is a different build entirely -- forgetting any prior
  // result here (rather than just invalidateSimulatedWinRate()'s lighter
  // "mark stale" treatment) means a newly-loaded already-complete team
  // still gets its own honest auto-run instead of showing another team's
  // leftover numbers with a stale note slapped on them.
  simWinRateResult = null;
  simWinRateNeedsRerun = false;
  simWinRateWasComplete = false;
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
  active.poolScope = poolScope;
}

function renderTeamNotes() {
  teamNotesInput.value = notes;
}

// ---------------------------------------------------------------------------
// Win/loss stat pills — used by Your Rival's own "Projected Win/Loss
// Ratio" (see renderRival()) on this page. Milestone 28: the
// results tracker's own "actual" win/loss readout that used to share
// this moved to battle-tracker.js, which keeps its own small copy of
// these same pure helpers (same duplicated-small-helper pattern as
// wcShowAccountPopup elsewhere in this project) so both places still
// render the exact same green/orange/red treatment without this page
// needing to export anything.
// ---------------------------------------------------------------------------

/**
 * Turns a 0-100 "goodness" percentage into a smooth red -> yellow -> green
 * gradient, instead of three flat buckets with a hard snap between them:
 * pure red at 0%, pure yellow at 35%, gradually shifting to pure green by
 * 80% and staying green from there up to 100% -- same anchor points as
 * the site's original green/yellow/red rule, just continuous now. Built
 * with CSS color-mix() so it automatically follows each color's own
 * light/dark value (see --stat-positive/--mediocre/--negative in
 * styles.css :root) without any separate dark-mode math needed here, and
 * kept as one tunable spot, applied identically everywhere a win/loss/
 * ratio pill shows up. Uses --stat-positive rather than --positive on
 * purpose -- --positive is re-picked as each color theme's own brand
 * color (e.g. blue under Charizard's dark mode), while --stat-positive
 * is never touched by a theme block, so these pills stay a genuine
 * green regardless of the active theme.
 */
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

/** One labeled, gradient-colored stat box (a percentage or a ratio) for a winloss-row. goodnessPercent (0-100) drives where on the red->yellow->green gradient this box's color/background lands -- see wcStatGradientVars(). */
function wcBuildWinLossStat(label, valueText, goodnessPercent, extraClass) {
  const box = document.createElement("div");
  box.className = `winloss-stat${extraClass ? ` ${extraClass}` : ""}`;
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

/** A compact "logged record" readout for the active team, sourced from the results tracker below. */
function renderMatchRecord() {
  const active = getActiveTeam();
  const summary = wcMatchRecordSummary(active);
  if (summary.total === 0) {
    matchRecordEl.innerHTML = 'No logged results yet for this team — log wins/losses on the <a href="battle-tracker.html">Battle Tracker</a> page and they\'ll show up here for reference while you plan its strategy.';
  } else {
    matchRecordEl.textContent = `Logged record: ${summary.wins}W–${summary.losses}L (${summary.winRate}% win rate).`;
  }
}

function renderTeamTabs() {
  // Milestone 26: no confirmed signed-in session means there is no team
  // data safe to show or manage here -- not even the list of tabs, since
  // that would reveal how many teams/what they're named without an
  // account. Same allowance as everywhere else on this page: nothing to
  // manage until a real session is confirmed.
  //
  // newTeamBtn is deliberately left enabled (not .disabled = true) here --
  // unlike the legitimate "5 of 5 teams saved" disable below, this isn't
  // "nothing more you could ever do," it's an auth gate, and every other
  // auth gate on this page (item/move/ability fields, sheet toggle,
  // notes, tracker buttons) stays clickable and explains itself via
  // wcRequireAccount()'s hint + popup on click rather than going inertly
  // disabled. addTeam() already gates on wcRequireAccount() independently
  // of this render, so leaving the button live keeps that same consistent
  // click-and-get-told-why experience.
  if (!wcTeamDataSignedIn) {
    teamTabsEl.innerHTML = "";
    teamNameInput.value = "";
    newTeamBtn.disabled = false;
    teamsHint.textContent =
      "Sign in or sign up to save, name, and manage teams — picking your six above stays free, but nothing is remembered until then.";
    return;
  }

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

/**
 * Milestone 26: reversed from Milestone 25's original comment here, which
 * left this open as "read-only navigation" on the theory that switching
 * tabs changes nothing. It actually does: syncWorkingStateIntoActiveTeam()
 * and loadActiveIntoWorkingState() below both read and write whatever's in
 * teamState, which while signed out is empty/blank by design (see
 * wcSyncTeamStateForAuth()) -- so there is no other team's data to
 * navigate to, and no tabs are rendered to click in the first place once
 * !wcTeamDataSignedIn (see renderTeamTabs()). This guard is defense in
 * depth for that.
 */
function switchTeam(id) {
  if (!wcTeamDataSignedIn) return;
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
  renderPoolScopeToggle();
  renderTeamNotes();
  renderMatchRecord();
  renderPicker();
  renderSlots();
  saveStatus.textContent = "";
}

function addTeam() {
  if (!wcRequireAccount((msg) => { teamsHint.textContent = msg; }, "create another team")) return;
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
  renderPoolScopeToggle();
  renderTeamNotes();
  renderMatchRecord();
  renderPicker();
  renderSlots();
  saveStatus.textContent = "";
}

function renameActiveTeam() {
  if (!wcRequireAccount((msg) => { teamsHint.textContent = msg; }, "rename a team")) return;
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
  if (!wcRequireAccount((msg) => { teamsHint.textContent = msg; }, "delete a team")) return;
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
  renderPoolScopeToggle();
  renderTeamNotes();
  renderMatchRecord();
  renderPicker();
  renderSlots();
  saveStatus.textContent = "Team deleted.";
}

/** Milestone 14: a team is tagged Singles or Doubles, and each builder page only shows teams tagged for it — so "changing a team's format" now means moving it to the other page entirely, not just flipping a toggle in place here. */
function moveActiveTeamToOtherFormat() {
  if (!wcRequireAccount((msg) => { teamsHint.textContent = msg; }, "move a team to the other builder")) return;
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
  renderPoolScopeToggle();
  renderTeamNotes();
  renderMatchRecord();
  renderPicker();
  renderSlots();
  saveStatus.textContent = `Moved "${teamName}" to the ${otherLabel} builder — find it there now.`;
}

// ---------------------------------------------------------------------------
// Export/Import modals (Milestone 29) — see wcExportTeamText/
// wcParseShowdownTeam above for the actual text<->build translation.
// ---------------------------------------------------------------------------

function openExportModal() {
  exportModalText.value = wcExportTeamText(chosen, builds);
  exportModal.hidden = false;
  exportModalText.focus();
  exportModalText.select();
}

function closeExportModal() {
  exportModal.hidden = true;
}

function copyExportModalText() {
  exportModalText.focus();
  exportModalText.select();
  const restoreLabel = "Copy to clipboard";
  const showResult = (label) => {
    exportModalCopyBtn.textContent = label;
    setTimeout(() => {
      exportModalCopyBtn.textContent = restoreLabel;
    }, 2000);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(exportModalText.value)
      .then(() => showResult("Copied!"))
      .catch(() => showResult("Couldn't copy — select the text above and copy it yourself."));
    return;
  }
  // Clipboard API unavailable (older browser, or a permissions-restricted
  // context) — the text above is already selected by the focus()/select()
  // calls above, so falling back to the older execCommand still gets most
  // browsers there, and worst case the user can just Cmd/Ctrl+C it.
  try {
    showResult(document.execCommand("copy") ? "Copied!" : "Select the text above and copy it yourself.");
  } catch {
    showResult("Select the text above and copy it yourself.");
  }
}

/** The last wcParseShowdownTeam() result shown in the Import modal's preview, or null before Preview has been clicked (or after the text has changed since) — Replace team applies exactly this, never a fresh re-parse, so what's on screen is always what gets applied. */
let importParseResult = null;

function openImportModal() {
  if (!wcRequireAccount((msg) => { teamsHint.textContent = msg; }, "import a team")) return;
  importModalText.value = "";
  importModalPreview.hidden = true;
  importModalPreview.innerHTML = "";
  importModalApplyBtn.disabled = true;
  importParseResult = null;
  importModal.hidden = false;
  importModalText.focus();
}

function closeImportModal() {
  importModal.hidden = true;
}

function previewImportModalText() {
  const result = wcParseShowdownTeam(importModalText.value);
  importParseResult = result;
  importModalPreview.hidden = false;
  importModalPreview.innerHTML = "";

  if (result.mons.length === 0) {
    const p = document.createElement("p");
    p.textContent = "Nothing recognizable was found to import — check the pasted text and try again.";
    importModalPreview.appendChild(p);
    importModalApplyBtn.disabled = true;
    return;
  }

  const summary = document.createElement("p");
  summary.textContent = `Ready to import ${result.mons.length} Pokémon${result.mons.length === 1 ? "" : "s"}:`;
  importModalPreview.appendChild(summary);

  result.mons.forEach(({ name, build }) => {
    const row = document.createElement("div");
    row.className = "import-preview-mon";
    const nameEl = document.createElement("div");
    nameEl.className = "import-preview-mon-name";
    nameEl.textContent = name + (build.item ? ` @ ${build.item}` : "");
    row.appendChild(nameEl);
    const detail = document.createElement("div");
    const moveText = build.moves.filter(Boolean).join(", ") || "no moves recognized";
    detail.textContent = `${build.nature ? build.nature + " Nature, " : ""}${moveText}`;
    row.appendChild(detail);
    importModalPreview.appendChild(row);
  });

  const issues = [...result.blockers, ...result.warnings];
  if (issues.length) {
    const warnHeading = document.createElement("p");
    warnHeading.className = "import-preview-warning";
    warnHeading.textContent = "Heads up:";
    importModalPreview.appendChild(warnHeading);
    issues.forEach((msg) => {
      const p = document.createElement("p");
      p.className = "import-preview-warning";
      p.textContent = msg;
      importModalPreview.appendChild(p);
    });
  }

  importModalApplyBtn.disabled = false;
}

function applyImportModalText() {
  if (!importParseResult || importParseResult.mons.length === 0) return;
  if (!wcRequireAccount((msg) => { teamsHint.textContent = msg; }, "import a team")) return;

  const importedNames = importParseResult.mons.map((m) => m.name);
  // A pasted set can freely include a Pokémon that isn't marked obtained
  // yet — importing it is itself a clear declaration of intent to use it,
  // and there's no other way to remove a not-obtained Pokémon from a
  // slot once it's chosen (Step 1's picker only shows/toggles obtained
  // ones), so leaving it un-obtained would strand it in the build below
  // with no way back out. Same OBTAINED_KEY/storage contract
  // getObtainedNames() itself reads.
  wcMarkObtainedFromImport(importedNames);

  chosen = importedNames;
  builds = {};
  importParseResult.mons.forEach((m) => {
    builds[m.name] = m.build;
  });

  invalidateComputedNotes();
  autogenHint.textContent = "";
  renderPicker();
  renderSlots();
  closeImportModal();
  saveStatus.textContent = `Imported ${chosen.length} Pokémon from pasted text — click Save team below when you're happy with it.`;
}

/** See applyImportModalText's own comment for why an import needs this at all. Mirrors getObtainedNames()'s exact storage contract (same OBTAINED_KEY, same signed-in-vs-not choice of localStorage/sessionStorage) so a name marked here is guaranteed to show up there. */
function wcMarkObtainedFromImport(names) {
  try {
    const obtained = getObtainedNames();
    let changed = false;
    names.forEach((name) => {
      if (!obtained.has(name)) {
        obtained.add(name);
        changed = true;
      }
    });
    if (!changed) return;
    const json = JSON.stringify([...obtained]);
    if (wcTeamDataSignedIn) {
      localStorage.setItem(OBTAINED_KEY, json);
    } else {
      sessionStorage.setItem(OBTAINED_KEY, json);
    }
  } catch {
    // Storage full/unavailable — the import above still applies; the only
    // loss is that these won't also show as obtained/chosen in Step 1's
    // picker grid until marked obtained there by hand.
  }
}

/**
 * Milestone 25: the only things a signed-out player can do on this page
 * are pick up to 6 obtained Pokémon into slots (Step 1) and see the
 * resulting cards -- everything else (building the details on each slot,
 * every team-management action, Save/Dream Team/Auto-build/Auto-strategy,
 * and the whole Matchup Score/coverage/Your Rival/results-tracker
 * analysis) requires a signed-in account. Widened from Milestone 24, which
 * only gated Save/Dream Team/Auto-build team/Auto-build strategy and
 * deliberately left Find Your Rival and the Matchup Score/coverage
 * displays open as "read-only exploration" -- that carve-out is gone: with
 * no account there's nowhere for a team to persist beyond this one browser
 * tab anyway, so the simpler, more explainable rule is that an account is
 * what unlocks the actual toolkit, not just saving.
 */
function wcIsSignedIn() {
  return Boolean(window.wcAuth && window.wcAuth.isSignedIn());
}

/**
 * Milestone 26: true only once wcSyncTeamStateForAuth() below has confirmed
 * -- via a direct Supabase session check, not the racy wcIsSignedIn() --
 * that the team data currently sitting in teamState/chosen/builds/notes
 * really does belong to a signed-in account and is safe to show, save over,
 * or navigate between. renderTeamTabs() and switchTeam() gate on this
 * specifically (rather than wcIsSignedIn()) because what's at stake there
 * is whether previously-stored team data gets displayed or persisted at
 * all, not just whether an editing control looks locked.
 */
let wcTeamDataSignedIn = false;

/**
 * Milestone 26: loads/merges this account's teams as usual, but first asks
 * Supabase directly (via wcHasRealSession() in teams.js) whether there's
 * really a signed-in session right now, rather than trusting
 * window.wcAuth.isSignedIn() -- which depends on auth.js's own async init
 * having already resolved and can still read "false" for a genuinely
 * signed-in player for a moment after this page's own init() starts.
 * Guessing wrong in that direction here wouldn't just show a locked-looking
 * button for a beat (the acceptable, self-healing race the other Milestone
 * 25 gates allow) -- it would mean loading and displaying somebody's actual
 * team data. So when there's no confirmed real session, this page starts
 * (or reverts to) a completely blank working state instead: nothing
 * remembered from a previous signed-in session on this device, and nothing
 * saved back out, until a real session is confirmed.
 */
async function wcSyncTeamStateForAuth() {
  // Milestone 26: a player who picked Pokémon while signed out (M25 always
  // allowed that, precisely so a visitor has something worth signing up
  // to keep) has a real, unsaved, in-progress build sitting in this page's
  // memory right now. If they then sign up/in in this same session --
  // without ever reloading -- losing that the instant sign-in resolves
  // would undo the entire point of letting them pick for free: it's the
  // exact moment they were hoping to keep going, not start over blank.
  // Captured before teamState/activeId get reassigned below.
  const hadInProgressPicks = chosen.length > 0;

  teamState = await wcLoadAndSyncTeamState();
  wcTeamDataSignedIn = await wcHasRealSession();
  // Milestone 28: refreshed alongside the sign-in check above (same
  // function, same event -- init() and every later wc:auth-changed) since
  // meta_usage_stats is read-only to signed-in accounts only, exactly
  // like everything else this page locks behind sign-in. {} while signed
  // out means getThreatsWithTypes()/wcPickDreamTeam's calls below defer
  // entirely to the existing curated heuristics -- the same behavior as
  // before this milestone existed.
  metaUsageLookup = wcTeamDataSignedIn ? await wcFetchMetaUsageStats(WINCON_BUILDER_FORMAT) : {};
  // Simulated Win Rate: combo_synergy_stats is gated behind sign-in the
  // same way meta_usage_stats is (see wcFetchComboSynergyStats in
  // teams.js) -- refreshed on the exact same schedule/event as
  // metaUsageLookup just above, for the same reason.
  comboSynergyLookup = wcTeamDataSignedIn ? await wcFetchComboSynergyStats(WINCON_BUILDER_FORMAT) : {};
  // Milestone 34: live_tier_stats is gated behind sign-in the same way
  // meta_usage_stats/combo_synergy_stats are (see wcFetchLiveTierStats in
  // teams.js) -- refreshed on the exact same schedule/event as the two
  // lookups just above, for the same reason.
  liveMetaLookup = wcTeamDataSignedIn ? await wcFetchLiveTierStats(WINCON_BUILDER_FORMAT) : {};
  // "Untapped gem" follow-up: refreshed on the exact same schedule/event
  // as liveMetaLookup just above, for the same reason.
  liveMetaBuildsLookup = wcTeamDataSignedIn ? await wcFetchLiveMetaBuilds(WINCON_BUILDER_FORMAT) : {};
  // Locked builds: refreshed on the exact same schedule/event as every
  // lookup above, for the same reason -- see wcFetchLockedBuilds in
  // teams.js.
  lockedBuildsLookup = wcTeamDataSignedIn ? await wcFetchLockedBuilds(WINCON_BUILDER_FORMAT) : {};
  if (wcTeamDataSignedIn) {
    activeId = teamState.activeId;
    // Checked BEFORE ensureActiveTeam() below (which can itself create a
    // team, making visibleTeams() non-empty) -- this is "did the account
    // already have a real saved team for this format" at the moment of
    // sign-in, not after.
    const accountAlreadyHadATeam = visibleTeams().length > 0;
    ensureActiveTeam();
    if (hadInProgressPicks && !accountAlreadyHadATeam) {
      // Nothing on the account to conflict with -- keep the in-progress
      // picks in the working state exactly as they are (now attached to
      // the fresh team ensureActiveTeam() just created/pointed activeId
      // at) rather than loading that brand-new team's own blank data over
      // them. Still unsaved until Save is clicked, same as always.
    } else {
      // Either nothing was in progress (a normal sign-in/page load, load
      // the account's real data as usual), or the account already has a
      // real saved team for this format -- in that case, silently
      // overwriting it with whatever was picked while signed out would be
      // a worse surprise than losing the in-progress picks, so this loads
      // the real saved team instead.
      loadActiveIntoWorkingState();
    }
  } else {
    activeId = null;
    chosen = [];
    builds = {};
    notes = "";
    sheetMode = "closed";
  }
}

/**
 * A small dismissible notification (not the full sign-in/sign-up modal --
 * see wcRequireAccount's comment for why) telling the player an account is
 * needed, with its own button to open that modal on demand. Reused by
 * every gate on this page instead of each one building its own; calling
 * it again while already showing just resets its auto-dismiss timer
 * rather than stacking a second copy.
 */
let wcAccountPopupEl = null;
let wcAccountPopupTimer = null;

function wcEnsureAccountPopupEl() {
  if (wcAccountPopupEl) return wcAccountPopupEl;
  const el = document.createElement("div");
  el.id = "wc-account-popup";
  el.className = "wc-account-popup";
  el.hidden = true;
  el.setAttribute("role", "alert");
  el.innerHTML = `
    <button type="button" class="wc-account-popup-close" aria-label="Dismiss">×</button>
    <p class="wc-account-popup-title">Sign in required</p>
    <p class="wc-account-popup-body">Create a free account to unlock the full toolkit — building your team's details, Matchup Score, Your Rival, and saving across devices. Picking your six stays free.</p>
    <div class="wc-account-popup-actions">
      <button type="button" class="btn-primary wc-account-popup-signin">Sign In / Sign Up</button>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector(".wc-account-popup-close").addEventListener("click", wcHideAccountPopup);
  el.querySelector(".wc-account-popup-signin").addEventListener("click", () => {
    wcHideAccountPopup();
    if (window.wcAuth && window.wcAuth.openModal) window.wcAuth.openModal("signup");
  });
  wcAccountPopupEl = el;
  return el;
}

function wcHideAccountPopup() {
  if (wcAccountPopupEl) wcAccountPopupEl.hidden = true;
  if (wcAccountPopupTimer) {
    clearTimeout(wcAccountPopupTimer);
    wcAccountPopupTimer = null;
  }
}

function wcShowAccountPopup() {
  const el = wcEnsureAccountPopupEl();
  el.hidden = false;
  if (wcAccountPopupTimer) clearTimeout(wcAccountPopupTimer);
  wcAccountPopupTimer = setTimeout(wcHideAccountPopup, 7000);
}

/**
 * Returns true (and does nothing) if already signed in. Otherwise shows
 * `message` via the caller's own `showMessage` callback -- reusing
 * whatever feedback element that action already has (saveStatus,
 * autogenHint, teamsHint, the Dream Team note) rather than adding a new
 * one for each -- plus the shared popup above, and returns false so the
 * caller bails out before doing any real work. Unlike Milestone 24, this
 * no longer force-opens the sign-up modal immediately: the popup's own
 * button does that on demand, which reads as a notification rather than
 * an interruption on every single locked click.
 */
function wcRequireAccount(showMessage, actionLabel) {
  if (wcIsSignedIn()) return true;
  showMessage(`Sign up free to ${actionLabel} — it only takes a minute, and your teams follow you to any device once you're signed in.`);
  wcShowAccountPopup();
  return false;
}

function saveDraft() {
  if (!wcRequireAccount((msg) => { saveStatus.textContent = msg; }, "save a team")) return;
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
  return { nature: "", item: "", moves: ["", "", "", ""], sp, ability: "" };
}

// ---------------------------------------------------------------------------
// Showdown-format Import/Export (Milestone 29)
// ---------------------------------------------------------------------------
//
// Pokémon Showdown's plain-text set format is what the rest of the
// competitive community actually shares teams in -- Discord messages,
// PokePaste links, tournament reports, Pikalytics/Limitless pages. WinCon
// speaks it only at this boundary: internally a build still stores Stat
// Points (see the Milestone 29 note atop stats.js for why that's correct,
// not an approximation that needed replacing), and wcExportTeamText/
// wcParseShowdownTeam below are the translation layer in each direction,
// built on wcSpToEv/wcEvToSp (stats.js).
//
// A pasted or exported set always names the BASE species with a Mega
// Stone as its held item, never the Mega form's own name -- that's how
// Showdown format has always worked (Mega Evolution happens mid-battle,
// not at team-build time), and it's also exactly what wcEffectivePokemon
// (megas.js) already assumes everywhere else in this file, so staying on
// base names throughout gets Mega handling for free in both directions.

/** case-insensitive Showdown stat label ("Atk", "SpA", a couple of longer spellings some other tools use) -> WinCon's own STATS key. Built once from WINCON_STAT_ORDER (stats.js) rather than hand-duplicated, so the two tables can't quietly drift apart. */
const SHOWDOWN_STAT_LABEL_TO_KEY = (() => {
  const map = {};
  WINCON_STAT_ORDER.forEach((s) => {
    map[s.showdownLabel.toLowerCase()] = s.key;
  });
  map["sp. atk"] = "sp_attack";
  map["sp. def"] = "sp_defense";
  map["special attack"] = "sp_attack";
  map["special defense"] = "sp_defense";
  return map;
})();

/** The ability a build actually has right now -- the same "does this build have a valid override, else fall back to the default" logic buildAbilityControl uses to decide what to show, pulled out here so Export can use exactly the same answer instead of a second guess. */
function wcCurrentAbilityName(build, baseName) {
  const abilityInfo = data.abilities && data.abilities[baseName];
  if (!abilityInfo) return "";
  const options = data.abilityOptions && data.abilityOptions[baseName];
  const hasValidOverride = Boolean(build.ability) && options && options.some((o) => o.name === build.ability);
  return hasValidOverride ? build.ability : abilityInfo.ability;
}

/** Turns this team's chosen Pokémon + builds into Pokémon Showdown's plain-text export format, ready to paste anywhere sets get shared. `namesList` is a team's `chosen` array (base species names) and `buildsMap` its `builds` object. */
function wcExportTeamText(namesList, buildsMap) {
  return namesList
    .map((name) => {
      const build = buildsMap[name] || emptyBuild();
      const lines = [];
      lines.push(build.item ? `${name} @ ${build.item}` : name);
      const ability = wcCurrentAbilityName(build, name);
      if (ability) lines.push(`Ability: ${ability}`);
      lines.push(`Level: ${WINCON_LEVEL}`);
      const evParts = WINCON_STAT_ORDER.map((s) => ({
        label: s.showdownLabel,
        ev: wcSpToEv(build.sp && build.sp[s.key]),
      })).filter((p) => p.ev > 0);
      if (evParts.length) lines.push(`EVs: ${evParts.map((p) => `${p.ev} ${p.label}`).join(" / ")}`);
      // No IVs line: every Champions Pokémon has fixed 31s, which is also
      // Showdown's own default when a set omits the line entirely.
      if (build.nature) lines.push(`${build.nature} Nature`);
      (build.moves || []).forEach((m) => {
        if (m) lines.push(`- ${m}`);
      });
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Parses Pokémon Showdown's plain-text team export format into WinCon
 * builds. Never throws -- always returns { mons, warnings, blockers } so
 * the Import modal can show exactly what would happen before anything's
 * actually applied.
 *
 * `mons` is capped at 6 (a WinCon team's max) and only ever contains
 * species this roster actually has, as `{ name, build }` pairs in the
 * order they appeared. `blockers` lists whole Pokémon that couldn't be
 * matched to anything in the roster at all (skipped, but never fatal to
 * the rest of the paste). `warnings` covers everything smaller that still
 * produced a usable build: an unrecognized move/nature/ability, EVs on a
 * stat WinCon didn't recognize, non-31 IVs (Champions doesn't have a
 * variable to set there), a Tera Type line (not legal in the current
 * regulation -- see README's Milestone 20/28 meta-tracking notes), or a
 * species repeated within the same paste.
 */
function wcParseShowdownTeam(text) {
  const warnings = [];
  const blockers = [];
  const mons = [];
  const seenNames = new Set();

  const blocks = (text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const usedBlocks = blocks.slice(0, 6);
  if (blocks.length > 6) {
    warnings.push("Only the first 6 Pokémon were imported — a WinCon team can't hold more than 6.");
  }

  usedBlocks.forEach((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const headerLine = lines[0];

    const atMatch = headerLine.match(/^(.*?)\s*@\s*(.+)$/);
    let namePart = (atMatch ? atMatch[1] : headerLine).trim();
    let itemName = atMatch ? atMatch[2].trim() : "";
    namePart = namePart.replace(/\s*\((?:M|F)\)\s*$/i, "").trim();
    const nickMatch = namePart.match(/^.*\(([^()]+)\)\s*$/);
    const speciesGuess = (nickMatch ? nickMatch[1] : namePart).trim();

    let resolvedName = null;
    const direct = data.pokemon.find((p) => p.form === "Base" && p.name.toLowerCase() === speciesGuess.toLowerCase());
    if (direct) {
      resolvedName = direct.name;
    } else {
      const asMega = data.pokemon.find((p) => p.name.toLowerCase() === speciesGuess.toLowerCase());
      if (asMega && wcIsMegaForm(asMega)) {
        const base = wcBaseFormOf(data.pokemon, asMega.name);
        if (base) {
          resolvedName = base.name;
          if (!itemName) itemName = WINCON_MEGA_STONES[asMega.name] || "";
        }
      }
    }

    if (!resolvedName) {
      blockers.push(`"${speciesGuess}" doesn't match any Pokémon in WinCon's roster — skipped.`);
      return;
    }
    if (seenNames.has(resolvedName)) {
      warnings.push(`${resolvedName} appeared more than once in the pasted team — only the first copy was kept.`);
      return;
    }

    const build = emptyBuild();
    build.item = itemName;

    let abilityLine = null;
    let natureLine = null;
    let evLine = null;
    let ivLine = null;
    let sawTera = false;
    const moves = [];

    lines.slice(1).forEach((line) => {
      if (/^ability:/i.test(line)) { abilityLine = line.replace(/^ability:/i, "").trim(); return; }
      if (/^evs:/i.test(line)) { evLine = line.replace(/^evs:/i, "").trim(); return; }
      if (/^ivs:/i.test(line)) { ivLine = line.replace(/^ivs:/i, "").trim(); return; }
      if (/^level:/i.test(line)) return; // Champions is always Level 50
      if (/^shiny:/i.test(line)) return; // WinCon doesn't track Shiny
      if (/^tera type:/i.test(line)) { sawTera = true; return; }
      if (/^happiness:/i.test(line)) return;
      if (/nature$/i.test(line)) { natureLine = line.replace(/nature$/i, "").trim(); return; }
      if (/^-\s*/.test(line)) { moves.push(line.replace(/^-\s*/, "").trim()); return; }
    });

    if (abilityLine) {
      const abilityInfo = data.abilities && data.abilities[resolvedName];
      const options = data.abilityOptions && data.abilityOptions[resolvedName];
      const matchOpt = options && options.find((o) => o.name.toLowerCase() === abilityLine.toLowerCase());
      const matchesDefault = abilityInfo && abilityInfo.ability && abilityInfo.ability.toLowerCase() === abilityLine.toLowerCase();
      if (matchOpt) {
        build.ability = matchOpt.name;
      } else if (matchesDefault) {
        build.ability = abilityInfo.ability;
      } else {
        warnings.push(
          `${resolvedName}: pasted ability "${abilityLine}" isn't one WinCon recognizes for it — left as ${
            abilityInfo ? abilityInfo.ability : "default"
          }.`
        );
      }
    }

    if (natureLine) {
      const matchNature = data.natures.find((n) => n.name.toLowerCase() === natureLine.toLowerCase());
      if (matchNature) {
        build.nature = matchNature.name;
      } else {
        warnings.push(`${resolvedName}: pasted nature "${natureLine}" wasn't recognized — left unset.`);
      }
    }

    if (evLine) {
      evLine.split("/").forEach((part) => {
        const m = part.trim().match(/^(\d+)\s+(.+)$/);
        if (!m) return;
        const key = SHOWDOWN_STAT_LABEL_TO_KEY[m[2].trim().toLowerCase()];
        if (!key) {
          warnings.push(`${resolvedName}: didn't recognize the EV stat "${m[2].trim()}" — skipped.`);
          return;
        }
        build.sp[key] = wcEvToSp(parseInt(m[1], 10));
      });
    }

    if (ivLine) {
      const nonDefault = ivLine.split("/").some((part) => {
        const m = part.trim().match(/^(\d+)\s+/);
        return m && parseInt(m[1], 10) !== 31;
      });
      if (nonDefault) {
        warnings.push(`${resolvedName}: pasted IVs weren't all 31 — Champions fixes every Pokémon's IVs at 31, so they were ignored.`);
      }
    }

    if (sawTera) {
      warnings.push(`${resolvedName}: pasted Tera Type was ignored — Terastallization isn't legal in the current regulation.`);
    }

    const learnset = data.learnsets[resolvedName];
    moves.slice(0, 4).forEach((moveName, i) => {
      const matchMove = data.moves.find((mv) => mv.name.toLowerCase() === moveName.toLowerCase());
      if (!matchMove) {
        warnings.push(`${resolvedName}: didn't recognize the move "${moveName}" — left blank.`);
        return;
      }
      if (learnset && !learnset.includes(matchMove.name)) {
        warnings.push(`${resolvedName}: "${matchMove.name}" isn't in its known movepool — added anyway.`);
      }
      build.moves[i] = matchMove.name;
    });

    seenNames.add(resolvedName);
    mons.push({ name: resolvedName, build });
  });

  return { mons, warnings, blockers };
}

// ---------------------------------------------------------------------------
// Open Team Sheet / Closed Team Sheet toggle (Milestone 14)
// ---------------------------------------------------------------------------

function setSheetMode(newMode) {
  if (!wcRequireAccount((msg) => { teamsHint.textContent = msg; }, "switch Team Sheet mode")) return;
  sheetMode = newMode === "open" ? "open" : "closed";
  const active = getActiveTeam();
  if (active) {
    active.sheetMode = sheetMode;
    wcSaveTeamState(teamState);
  }
  renderSheetToggle();
  renderPoolScopeToggle();
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
// My Pokédex / Full Pokédex toggle (Milestone 40)
// ---------------------------------------------------------------------------

/**
 * Gated behind an account the same way setSheetMode() is -- this only
 * ever affects Generate Dream Team, which itself already requires
 * sign-in, so there's no real "signed-out full-dex" state to support.
 */
function setPoolScope(newScope) {
  if (!wcRequireAccount((msg) => { teamsHint.textContent = msg; }, "switch the candidate pool")) return;
  poolScope = newScope === "full" ? "full" : "obtained";
  const active = getActiveTeam();
  if (active) {
    active.poolScope = poolScope;
    wcSaveTeamState(teamState);
  }
  renderPoolScopeToggle();
  saveStatus.textContent =
    poolScope === "full"
      ? "Candidate pool set to Full Pokédex — Generate Dream Team can now pick from every species, not just what you've marked obtained."
      : "Candidate pool set to My Pokédex — Generate Dream Team is back to picking from what you've marked obtained.";
}

function renderPoolScopeToggle() {
  poolScopeToggleEl.querySelectorAll(".format-option").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.pool === poolScope);
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

/** Milestone 25: the "sign in to build the details" hint, mirrored on both builder pages. */
const buildLockHintEl = document.getElementById("build-lock-hint");

function renderSlots() {
  // Defense in depth alongside the wc:auth-changed listener in init() --
  // keeps the CSS-only "everything's dimmed" cue honest even if sign-in
  // state ever changes without that event firing (e.g. a test stubbing
  // window.wcAuth directly), since this runs on every team edit anyway.
  wcUpdateSignedOutBodyClass();
  slotsSection.hidden = chosen.length === 0;
  if (buildLockHintEl) buildLockHintEl.hidden = wcIsSignedIn();
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

// Milestone 32: the 3 Paldean Tauros breeds (Combat/Blaze/Aqua) are
// separately-obtainable roster entries (see data/AUDIT.md's Sept 3
// re-audit) but share identical base stats, ability options, and
// learnset — so switching a slot between them is just a typing change,
// not really a fresh pick. "Paldean Tauros" itself (unlabeled, for
// backwards-compatibility reasons — see the same audit) is Combat Breed.
const WINCON_TAUROS_BREEDS = [
  { name: "Paldean Tauros", label: "Combat Breed" },
  { name: "Paldean Tauros (Blaze Breed)", label: "Blaze Breed" },
  { name: "Paldean Tauros (Aqua Breed)", label: "Aqua Breed" },
];

function wcTaurosBreedFor(name) {
  return WINCON_TAUROS_BREEDS.some((b) => b.name === name) ? WINCON_TAUROS_BREEDS : null;
}

/**
 * Swaps which roster entry this slot represents, in place — used by the
 * Paldean Tauros breed dropdown. The in-progress build (Nature/item/
 * moves/Stat Points/ability) carries over untouched, since every breed
 * shares identical base stats/learnset/ability options; only the name
 * (and its typing) changes. Mirrors togglePick's own mutation style
 * (chosen/builds only — no explicit save call needed here either; see
 * syncWorkingStateIntoActiveTeam's own comment for why).
 */
function wcSwitchSlotSpecies(oldName, newName) {
  if (oldName === newName) return;
  const index = chosen.indexOf(oldName);
  if (index === -1) return;
  chosen[index] = newName;
  builds[newName] = builds[oldName] || emptyBuild();
  delete builds[oldName];
  invalidateComputedNotes();
  renderSlots();
}

/** Only offers breeds actually marked obtained on the Pokédex tracker — same rule as every other way a Pokémon gets onto a team — but always keeps this slot's own current breed in the list even on the off chance it's since been un-obtained, so the dropdown never hides what's actually on the team right now. Returns null (render nothing) when there's nothing to switch to. */
function buildBreedSelect(baseName, breedGroup) {
  const obtained = getObtainedNames();
  const availableBreeds = breedGroup.filter((b) => obtained.has(b.name) || b.name === baseName);
  if (availableBreeds.length < 2) return null;

  const select = document.createElement("select");
  select.className = "breed-select";
  select.title = "Switch which Paldean Tauros breed this slot is — only breeds you've marked obtained on the Pokédex are offered here.";
  availableBreeds.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b.name;
    opt.textContent = b.label;
    if (b.name === baseName) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("mousedown", (event) => {
    if (!wcIsSignedIn()) {
      event.preventDefault();
      wcShowAccountPopup();
    }
  });
  select.addEventListener("change", () => {
    if (!wcIsSignedIn()) {
      select.value = baseName;
      wcShowAccountPopup();
      return;
    }
    wcSwitchSlotSpecies(baseName, select.value);
  });
  return select;
}

/**
 * Milestone 32: the one place every consumer should go through instead of
 * calling wcEffectivePokemon directly (Your Rival's own synthesized
 * roster at the bottom of this file is the one deliberate exception — its
 * Mega/base choice is decided by wcGenerateBuild itself, never the user,
 * so it has nothing to toggle). Layers build.megaView's manual override
 * on top of the item-driven eligibility wcEffectivePokemon already
 * computes: the item is still what UNLOCKS a Mega form at all (holding
 * nothing/the wrong item always means base, same as before), but once
 * unlocked, megaView lets that one slot be viewed/built as its base stats
 * instead — e.g. to plan around a Pokémon's pre-Mega-Evolution stats,
 * since it starts a battle in base form and only transforms mid-battle.
 * Every consumer (the slot card, Matchup Score, team coverage, Auto-
 * build strategy) goes through this so they all agree on which stat
 * block a slot is currently using.
 */
function wcSlotEffective(baseName, build) {
  const itemDerived = wcEffectivePokemon(data.pokemon, baseName, build && build.item);
  if (!itemDerived || itemDerived.name === baseName) return itemDerived;
  if (build && build.megaView === "base") {
    return data.pokemon.find((p) => p.name === baseName) || itemDerived;
  }
  return itemDerived;
}

/** The Base/Mega toggle itself — only rendered once a slot's item actually matches one of its own Mega Stones (see isMegaEligible in renderSlot). Reuses the same .format-toggle/.format-option pill styling as the page-level Open/Closed Team Sheet toggle, sized down for the card header (see .mega-view-toggle in styles.css). */
function buildMegaViewToggle(build, baseName, megaName) {
  const wrap = document.createElement("div");
  wrap.className = "format-toggle mega-view-toggle";

  const isBaseView = build.megaView === "base";
  [
    { key: "mega", label: "Mega", title: `View and build ${megaName}'s Mega stats/typing.` },
    { key: "base", label: "Base", title: `View and build ${baseName}'s base stats/typing, even while holding its Mega Stone.` },
  ].forEach(({ key, label, title }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const isActive = (key === "base") === isBaseView;
    btn.className = "format-option" + (isActive ? " is-active" : "");
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener("click", () => {
      if (!wcIsSignedIn()) {
        wcShowAccountPopup();
        return;
      }
      const nextView = key === "base" ? "base" : "mega";
      if ((build.megaView === "base") === (nextView === "base")) return;
      build.megaView = nextView;
      invalidateComputedNotes();
      renderSlots();
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

/**
 * Locked builds: mirrors a species' permanent lock (lockedBuildsLookup,
 * refreshed in wcSyncTeamStateForAuth() from wcFetchLockedBuilds in
 * teams.js) onto this slot's OWN build object, so `build` itself is
 * never stale relative to the lock -- meaning Export and every other
 * direct reader of build.nature/.sp/.moves sees locked values for free,
 * with zero changes anywhere else. A no-op when this species isn't
 * locked. Called at the very top of renderSlot, every render.
 */
function wcApplyLockedBuildIfAny(baseName, build) {
  const locked = lockedBuildsLookup[baseName];
  if (!locked) return;
  build.nature = locked.nature;
  build.sp = { ...locked.sp };
  build.moves = [...locked.moves];
}

/**
 * The Nature/Stat Points/moves a slot is CURRENTLY SHOWING/scoring with
 * right now -- mirrors wcSlotEffective's role for Mega/base, but for the
 * locked-build Recommended preview instead. Returns build.recommendedBuild's
 * fields while build.buildView === "recommended" and a recommendation
 * exists (see applyAmendmentsToBuilds), else this slot's own (already
 * lock-synced, if applicable) fields. Every consumer that reads
 * build.nature/.sp/.moves for a CALCULATION (Matchup Score, Speed tiers,
 * Simulated Win Rate) goes through this, exactly the way every Mega-
 * aware consumer goes through wcSlotEffective.
 */
function wcEffectiveBuildFields(baseName, build) {
  if (build && build.buildView === "recommended" && build.recommendedBuild) {
    const rec = build.recommendedBuild;
    return { nature: rec.nature, sp: { ...rec.sp }, moves: [...rec.moves] };
  }
  return { nature: build.nature, sp: build.sp, moves: build.moves };
}

/** The Current/Recommended toggle itself — only rendered once a slot actually has a pending recommendation (build.recommendedBuild, set by applyAmendmentsToBuilds when a strategy amendment would have touched a locked species' moves/nature/Stat Points). Reuses the same .format-toggle/.format-option pill styling as the Mega/Base toggle above. */
function buildLockedBuildViewToggle(build, baseName) {
  const wrap = document.createElement("div");
  wrap.className = "format-toggle locked-build-view-toggle";

  const isRecommended = build.buildView === "recommended";
  [
    { key: "current", label: "Current", title: `View and use ${baseName}'s locked build.` },
    { key: "recommended", label: "Recommended", title: `Preview the strategy-recommended change to ${baseName}'s build without touching the lock.` },
  ].forEach(({ key, label, title }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const isActive = (key === "recommended") === isRecommended;
    btn.className = "format-option" + (isActive ? " is-active" : "");
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener("click", () => {
      const nextView = key === "recommended" ? "recommended" : "current";
      if ((build.buildView === "recommended") === (nextView === "recommended")) return;
      build.buildView = nextView;
      invalidateComputedNotes();
      renderSlots();
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

function isSlotBuildLockable(build) {
  const spTotal = STATS.reduce((sum, s) => sum + (build.sp[s.key] || 0), 0);
  const movesFilled = build.moves.filter(Boolean).length === 4;
  return Boolean(build.nature) && movesFilled && spTotal === SP_TOTAL_CAP;
}

/** Locks/unlocks a species' build globally — see supabase/migrations/0008_locked_builds.sql and wcSaveLockedBuild/wcDeleteLockedBuild in teams.js. The local lockedBuildsLookup is updated immediately regardless of whether the cloud save/delete succeeds (fire-and-forget, same contract as every other cloud write in this project), so the UI never waits on network round-trip. */
async function toggleLockedBuild(baseName, build) {
  if (!wcRequireAccount((msg) => { autogenHint.textContent = msg; }, "lock a build")) return;
  if (lockedBuildsLookup[baseName]) {
    delete lockedBuildsLookup[baseName];
    await wcDeleteLockedBuild(baseName, WINCON_BUILDER_FORMAT);
  } else {
    if (!isSlotBuildLockable(build)) {
      autogenHint.textContent = `Fill in ${baseName}'s Nature, all 4 moves, and all ${SP_TOTAL_CAP} Stat Points before locking it.`;
      return;
    }
    const fields = { nature: build.nature, sp: { ...build.sp }, moves: [...build.moves] };
    lockedBuildsLookup[baseName] = fields;
    await wcSaveLockedBuild(baseName, WINCON_BUILDER_FORMAT, fields);
  }
  invalidateComputedNotes();
  renderSlots();
}

/** Adopts a previewed Recommended build as the new permanent lock for this species — the only way a strategy amendment's suggestion actually changes what "locked" means going forward (see applyAmendmentsToBuilds). */
async function adoptRecommendedBuild(baseName, build) {
  const rec = build.recommendedBuild;
  if (!rec) return;
  lockedBuildsLookup[baseName] = { nature: rec.nature, sp: { ...rec.sp }, moves: [...rec.moves] };
  build.recommendedBuild = null;
  build.buildView = "current";
  await wcSaveLockedBuild(baseName, WINCON_BUILDER_FORMAT, lockedBuildsLookup[baseName]);
  invalidateComputedNotes();
  renderSlots();
}

function renderSlot(baseName, build) {
  wcApplyLockedBuildIfAny(baseName, build);
  const isLocked = Boolean(lockedBuildsLookup[baseName]);
  const isPreviewing = build.buildView === "recommended" && Boolean(build.recommendedBuild);
  const readOnlyBuildFields = isLocked || isPreviewing;
  const previewFields = isPreviewing ? wcEffectiveBuildFields(baseName, build) : null;
  const basePokemon = data.pokemon.find((p) => p.name === baseName);
  const itemDerivedEffective = wcEffectivePokemon(data.pokemon, baseName, build.item) || basePokemon;
  const isMegaEligible = itemDerivedEffective.name !== baseName;
  const effective = wcSlotEffective(baseName, build) || basePokemon;
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
    megaTag.title = `${baseName} holding ${build.item} — use the Base/Mega toggle above to preview base stats, or remove/change the item to revert to ${baseName} for good.`;
    title.appendChild(megaTag);
  }

  const breedGroup = wcTaurosBreedFor(baseName);
  if (breedGroup) {
    const breedSelect = buildBreedSelect(baseName, breedGroup);
    if (breedSelect) title.appendChild(breedSelect);
  }

  if (isMegaEligible) {
    title.appendChild(buildMegaViewToggle(build, baseName, itemDerivedEffective.name));
  }

  if (build.recommendedBuild) {
    title.appendChild(buildLockedBuildViewToggle(build, baseName));
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
  const abilityControl = buildAbilityControl(build, effective, abilityInfo);
  if (abilityControl) header.appendChild(abilityControl.el);

  const megaForms = wcMegaFormsOf(data.pokemon, baseName);
  if (megaForms.length > 0) {
    const megaHint = document.createElement("p");
    megaHint.className = "hint slot-mega-hint";
    const stoneList = megaForms
      .map((m) => WINCON_MEGA_STONES[m.name])
      .filter(Boolean)
      .join(", ");
    if (isMega) {
      megaHint.textContent = `Holding ${build.item} — this slot is ${effective.name}. Use the Base/Mega toggle above to preview its base stats without losing the item, or change the item itself to revert to ${baseName} for good.`;
    } else if (isMegaEligible) {
      megaHint.textContent = `Holding ${build.item} — toggled to view ${baseName}'s base stats above. Switch the toggle back to Mega to build around ${itemDerivedEffective.name} instead.`;
    } else {
      megaHint.textContent = `Has a Mega form — hold ${stoneList} in the item field below to Mega Evolve this slot.`;
    }
    header.appendChild(megaHint);
  }

  // Milestone 31: a lightweight "just fill in a good set for this one" —
  // reuses the same wcGenerateBuild engine as Auto-build team (below),
  // scoped to a single slot, for anyone who already picked their 6 by
  // hand and just wants a real starting point for one of them rather
  // than regenerating (and losing tweaks on) the other five.
  const autofillBtn = document.createElement("button");
  autofillBtn.type = "button";
  autofillBtn.className = "btn-secondary slot-autofill-btn";
  autofillBtn.textContent = "Auto-fill this Pokémon";
  autofillBtn.title = `Fill in a real, tournament-informed Nature/item/moves/Stat Points build for ${baseName} — respects Item Clause against your other slots' items. Item still fills in even while locked; Nature/moves/Stat Points stay whatever's locked.`;
  autofillBtn.addEventListener("click", () => autoBuildSingle(baseName));
  header.appendChild(autofillBtn);

  // Locked builds: a permanent, per-species Nature/Stat Points/moveset
  // (see wcApplyLockedBuildIfAny above and supabase/migrations/
  // 0008_locked_builds.sql) — the lock button is hidden while previewing
  // a Recommended change, since "lock what, exactly" would be ambiguous
  // before that preview is either adopted or dismissed.
  const lockStatus = document.createElement("p");
  lockStatus.className = "hint slot-lock-hint";
  if (isPreviewing) {
    lockStatus.textContent = `Previewing a recommended change to ${baseName}'s locked build — Nature/Stat Points/moves are read-only while previewing. Adopt it to make this the new lock, or switch back to Current to change nothing.`;
    header.appendChild(lockStatus);
  } else if (isLocked) {
    lockStatus.textContent = `🔒 ${baseName}'s Nature/Stat Points/moves are locked — every team using ${baseName} reuses this exact build. Item and Ability stay free to edit or auto-fill.`;
    header.appendChild(lockStatus);
  }

  if (!isPreviewing) {
    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "btn-secondary slot-lock-btn";
    lockBtn.textContent = isLocked ? "🔓 Unlock this build" : "🔒 Lock this build";
    lockBtn.title = isLocked
      ? `Unlock ${baseName}'s build — every team using it goes back to normal auto-generation/manual editing.`
      : `Lock ${baseName}'s current Nature/Stat Points/moves globally — every team that picks ${baseName} will use this exact build (item/ability stay free).`;
    lockBtn.addEventListener("click", () => toggleLockedBuild(baseName, build));
    header.appendChild(lockBtn);
  } else {
    const adoptBtn = document.createElement("button");
    adoptBtn.type = "button";
    adoptBtn.className = "btn-secondary slot-adopt-btn";
    adoptBtn.textContent = "Adopt this build";
    adoptBtn.title = `Make this recommended Nature/Stat Points/moves the new permanent lock for ${baseName}.`;
    adoptBtn.addEventListener("click", () => adoptRecommendedBuild(baseName, build));
    header.appendChild(adoptBtn);
  }

  const spSection = buildStatPointAllocator(build, effective, readOnlyBuildFields, previewFields);

  const row1 = document.createElement("div");
  row1.className = "slot-row";
  row1.append(
    labeled("Nature", buildNatureSelect(build, spSection.refreshFinalStats, readOnlyBuildFields, previewFields && previewFields.nature)),
    buildItemField(build, effective.name, baseName)
  );

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
  const abilityName = abilityControl ? abilityControl.name : abilityInfo && abilityInfo.ability;
  for (let i = 0; i < 4; i++) {
    moveGrid.appendChild(buildMoveField(build, i, moveOptions, effective, abilityName, readOnlyBuildFields, previewFields && previewFields.moves[i]));
  }

  card.append(header, row1, moveGrid, spSection.el);
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

function buildNatureSelect(build, onNatureChange, readOnly, previewNature) {
  const select = document.createElement("select");
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "— choose —";
  select.appendChild(blank);
  const displayNature = previewNature !== undefined && previewNature !== null ? previewNature : build.nature;
  data.natures.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n.name;
    opt.textContent = n.increasedStat
      ? `${n.name} (+${statLabel(n.increasedStat)} / −${statLabel(n.decreasedStat)})`
      : `${n.name} (neutral)`;
    if (n.name === displayNature) opt.selected = true;
    select.appendChild(opt);
  });
  select.disabled = Boolean(readOnly);
  select.title = readOnly ? "Locked or previewing a recommendation — unlock, or switch back to Current, to edit." : "";
  select.addEventListener("mousedown", (event) => {
    if (!wcIsSignedIn()) {
      event.preventDefault();
      wcShowAccountPopup();
    }
  });
  select.addEventListener("change", () => {
    if (!wcIsSignedIn()) {
      select.value = build.nature || "";
      wcShowAccountPopup();
      return;
    }
    build.nature = select.value;
    // Milestone 29: Nature feeds the live final-stats readout next to the
    // Stat Points inputs below (wcCalcStat) — unlike Item, changing Nature
    // doesn't need a full renderSlots() (it never changes the Mega-form
    // question that Item's own change handler exists to catch), so this
    // just updates that one readout directly rather than rebuilding the
    // whole card and losing focus/scroll position for no reason.
    if (onNatureChange) onNatureChange();
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
  input.addEventListener("mousedown", (event) => {
    if (!wcIsSignedIn()) {
      event.preventDefault();
      wcShowAccountPopup();
    }
  });
  input.addEventListener("change", () => {
    if (!wcIsSignedIn()) {
      input.value = build.item || "";
      wcShowAccountPopup();
      return;
    }
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
 * The "Ability: X" badge on each build slot card (Milestone 13), now
 * editable in place (Milestone 17) for any species with more than one real
 * ability to choose from -- Ability 1/Ability 2/Hidden Ability, sourced
 * from data/ability-options.json (see the data JSDoc near the top of this
 * file). A Mega form has no entry there at all -- Mega Evolution locks to
 * one fixed ability with no alternates in-game -- and 19 base-form species
 * only ever had one real option to begin with, so both fall back to the
 * original plain, hover-only badge with nothing to pick from.
 *
 * Returns { el, name } -- the DOM node to place in the header, and the
 * effective ability name in play for this slot right now (the player's own
 * pick if they've made one, else the site's own best-available default) --
 * or null if this species has no ability data sourced at all.
 *
 * This only feeds the badge/tooltip and each move field's Expected/Tech
 * tag (see wcMoveIsExpected in strategy.js). Auto-build, Auto-strategy,
 * and Matchup Score still score every Pokémon against the site's single
 * recommended ability (data.abilities) regardless of what's picked here,
 * same as before Milestone 17 -- changing a hand-built slot's ability here
 * is a reference/planning tool for that one slot, not a retroactive
 * rescore of generated content.
 */
function buildAbilityControl(build, effective, abilityInfo) {
  if (!abilityInfo) return null;
  const options = data.abilityOptions && data.abilityOptions[effective.name];
  const defaultName = abilityInfo.ability;
  const hasValidOverride = Boolean(build.ability) && options && options.some((o) => o.name === build.ability);
  const currentName = hasValidOverride ? build.ability : defaultName;
  const currentDescription = (data.abilityDex && data.abilityDex[currentName]) || abilityInfo.description || "";
  const showConfidence = currentName === defaultName && abilityInfo.confidence === "low";

  if (!options || options.length < 2) {
    const badge = document.createElement("span");
    badge.className = "ability-badge";
    if (showConfidence) badge.classList.add("is-low-confidence");
    badge.textContent = `Ability: ${currentName}`;
    attachFieldHoverTooltip(badge, (el) =>
      showAbilityFieldTooltip(el, { ability: currentName, description: currentDescription, confidence: showConfidence ? "low" : undefined })
    );
    return { el: badge, name: currentName };
  }

  const select = document.createElement("select");
  select.className = "ability-badge";
  if (showConfidence) select.classList.add("is-low-confidence");
  options.forEach((opt) => {
    const optionEl = document.createElement("option");
    optionEl.value = opt.name;
    optionEl.textContent = opt.isHidden ? `${opt.name} (Hidden Ability)` : opt.name;
    if (opt.name === currentName) optionEl.selected = true;
    select.appendChild(optionEl);
  });

  attachFieldHoverTooltip(select, (el) =>
    showAbilityFieldTooltip(el, { ability: currentName, description: currentDescription, confidence: showConfidence ? "low" : undefined })
  );

  select.addEventListener("mousedown", (event) => {
    if (!wcIsSignedIn()) {
      event.preventDefault();
      wcShowAccountPopup();
    }
  });
  select.addEventListener("change", () => {
    if (!wcIsSignedIn()) {
      select.value = currentName;
      wcShowAccountPopup();
      return;
    }
    build.ability = select.value;
    invalidateComputedNotes();
    // The chosen ability feeds each move field's Expected/Tech tag (see
    // wcMoveIsExpected in strategy.js) and the tooltip's own text, both
    // rendered inside this same card -- a full re-render is the simplest
    // way to keep everything in sync, same as buildItemField's onChange.
    renderSlots();
  });

  return { el: select, name: currentName };
}

/**
 * Move field + a "Type · Category" meta line, plus (Milestone 14) an
 * Expected/Tech tag once Open Team Sheet mode is on — see
 * wcMoveIsExpected in strategy.js. Under Closed Sheet the tag stays
 * hidden entirely: a tech move only matters once an opponent can see it
 * coming, so there's nothing useful to flag before that.
 */
function buildMoveField(build, index, moveOptions, effectivePokemon, abilityName, readOnly, previewMove) {
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

  const input = buildMoveInput(build, index, moveOptions, meta, tag, effectivePokemon, abilityName, readOnly, previewMove);
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

function buildMoveInput(build, index, moveOptions, meta, tag, effectivePokemon, abilityName, readOnly, previewMove) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "move-input";
  input.autocomplete = "off";
  input.value = (previewMove !== undefined && previewMove !== null ? previewMove : build.moves[index]) || "";
  input.placeholder = "Click to see available moves…";
  input.disabled = Boolean(readOnly);
  input.title = readOnly ? "Locked or previewing a recommendation — unlock, or switch back to Current, to edit." : "";

  const commit = (value) => commitMoveValue(input, meta, tag, build, index, value, effectivePokemon, abilityName);

  input.addEventListener("focus", () => {
    if (!wcIsSignedIn()) {
      input.blur();
      wcShowAccountPopup();
      return;
    }
    openMoveDropdown(input, moveOptions, commit);
  });
  input.addEventListener("click", () => {
    if (!wcIsSignedIn()) {
      wcShowAccountPopup();
      return;
    }
    openMoveDropdown(input, moveOptions, commit);
  });
  input.addEventListener("input", () => {
    if (!wcIsSignedIn()) return;
    if (isMoveDropdownOpenFor(input)) renderMoveDropdownRows(input, moveOptions, commit);
  });
  input.addEventListener("change", () => {
    if (!wcIsSignedIn()) {
      input.value = build.moves[index] || "";
      return;
    }
    commit(input.value);
  });
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

/**
 * `effectivePokemon` is the slot's Mega-aware Pokémon (see wcEffectivePokemon
 * in megas.js) — its own base stats, not the base species', are what a Mega
 * Evolution's Stat Points actually apply to. Returns `{ el, refreshFinalStats }`
 * rather than a bare element: buildNatureSelect (row1, built right after this)
 * needs `refreshFinalStats` too, since Nature also feeds the live stat below
 * but changes it in place rather than triggering a full renderSlots().
 */
function buildStatPointAllocator(build, effectivePokemon, readOnly, previewFields) {
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

  const baseStats = data.baseStats.find((b) => b.name === effectivePokemon.name);
  const finalStatEls = {};
  // Locked builds: while previewing a Recommended change, every read
  // below goes through the preview's sp/nature instead of the real
  // (locked) build fields — see wcEffectiveBuildFields. Outside of a
  // preview this is just build.sp/build.nature, same as always.
  const displaySp = previewFields ? previewFields.sp : build.sp;

  function refreshTotal() {
    const sp = previewFields ? previewFields.sp : build.sp;
    const total = STATS.reduce((sum, s) => sum + (sp[s.key] || 0), 0);
    totalBadge.textContent = `${total} / ${SP_TOTAL_CAP}`;
    totalBadge.classList.toggle("sp-over", total > SP_TOTAL_CAP);
  }

  /**
   * Milestone 29: the actual level-50 stat this Stat Points + Nature
   * combination produces right now, shown live next to the input that
   * drives it — the exact same wcCalcStat formula (stats.js) Matchup
   * Score itself uses, so what's on screen here is never a separate
   * guess that could quietly disagree with it. Silently a no-op if this
   * slot's base stats aren't known (shouldn't happen — data/base-
   * stats.json covers the full roster — but this is display code, not
   * worth a hard failure over).
   */
  function refreshFinalStats() {
    if (!baseStats) return;
    const sp = previewFields ? previewFields.sp : build.sp;
    const nature = previewFields ? previewFields.nature : build.nature;
    WINCON_STAT_ORDER.forEach((s) => {
      const el = finalStatEls[s.key];
      if (!el) return;
      el.textContent = String(wcCalcStat(baseStats[s.baseStatKey], s.key, sp[s.key], nature, data.natures));
    });
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
    input.value = String(displaySp[s.key] || 0);
    input.disabled = Boolean(readOnly);
    input.title = readOnly ? "Locked or previewing a recommendation — unlock, or switch back to Current, to edit." : "";
    input.addEventListener("mousedown", (event) => {
      if (!wcIsSignedIn()) event.preventDefault();
    });
    input.addEventListener("input", () => {
      if (!wcIsSignedIn()) {
        input.value = String(build.sp[s.key] || 0);
        wcShowAccountPopup();
        return;
      }
      let value = parseInt(input.value, 10);
      if (Number.isNaN(value) || value < 0) value = 0;
      if (value > SP_STAT_CAP) value = SP_STAT_CAP;
      input.value = String(value);
      build.sp[s.key] = value;
      refreshTotal();
      refreshFinalStats();
      invalidateComputedNotes();
      refreshStrategyAvailability();
      refreshDerivedSections();
    });
    const finalStat = document.createElement("span");
    finalStat.className = "sp-final-stat";
    finalStat.title = "The actual stat this many Stat Points (plus Nature) works out to at Level 50 — same math Matchup Score uses.";
    finalStatEls[s.key] = finalStat;
    field.append(name, input, finalStat);
    grid.appendChild(field);
  });

  wrap.appendChild(grid);
  refreshTotal();
  refreshFinalStats();
  return { el: wrap, refreshFinalStats };
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
  const effective = wcSlotEffective(baseName, build);
  if (!effective || effective.name === baseName) {
    return { name: baseName, slotName: baseName, types: baseTypes, baseStats, learnableNames };
  }
  const effectiveBaseStats = data.baseStats.find((b) => b.name === effective.name) || baseStats;
  return { name: effective.name, slotName: baseName, types: effective.types, baseStats: effectiveBaseStats, learnableNames };
}

/**
 * Milestone 40: "My Pokédex" mode (poolScope === "obtained", the default
 * and the only behavior that existed before this milestone) -- every
 * species marked obtained on the Pokédex tracker with confirmed
 * base-stat/learnset data, exactly as before. "Full Pokédex" mode
 * (poolScope === "full") drops the ownership filter entirely and returns
 * every Base-form species in the game with that same data, so a newer
 * player can see (and Generate Dream Team can build) a genuinely
 * competitive team before they've caught/trained a single one of these
 * six in-game -- the point raised alongside Phoenix's reference-team
 * request: "the aim is to help beginners be able to build a competitive
 * team." Mega forms are excluded the same way buildRivalPool() (Your
 * Rival's own full-roster pool, elsewhere in this file) already excludes
 * them -- they're never independently picked, only opted into per-slot
 * via wcPickAutoMegaForm. wcPickDreamTeam and every scoring/archetype
 * function downstream are handed the exact same shape of pool either way
 * and have no idea which mode built it.
 */
function eligibleObtainedMembers() {
  if (poolScope === "full") {
    const eligible = [];
    data.pokemon.forEach((pokemon) => {
      if (wcIsMegaForm(pokemon)) return;
      const baseStats = data.baseStats.find((b) => b.name === pokemon.name);
      const learnableNames = data.learnsets[pokemon.name];
      if (baseStats && learnableNames) {
        eligible.push({ name: pokemon.name, types: pokemon.types, baseStats, learnableNames, megaForms: megaFormsFor(pokemon.name) });
      }
    });
    return eligible;
  }

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

/**
 * Milestone 42: "how much has this player already used species X" --
 * there's no direct per-species usage-frequency field anywhere in this
 * app, so this derives one from what's already real and already saved:
 * every team in this account's teamState (any format -- this is about
 * the PLAYER's real familiarity with a species, not a per-format count)
 * that includes species X contributes that team's own real logged
 * win+loss count (wcMatchRecordSummary, the same count renderMatchRecord()
 * already shows) to X's total. A team with nothing logged yet
 * contributes 0 to every species on it -- same silently-a-no-op-until-
 * real-data contract as metaUsage/liveMeta elsewhere in this file. Feeds
 * wcExperienceDiversityBonus (strategy.js) via wcPickDreamTeam's new
 * experienceLookup param, Generate Dream Team only -- Your Rival's pool
 * is an adversarial pick meant to challenge the player, not a "help this
 * player try something new" one, so it isn't threaded in there.
 */
function buildExperienceLookup() {
  const lookup = {};
  (teamState.teams || []).forEach((team) => {
    const total = wcMatchRecordSummary(team).total;
    if (!total) return;
    (team.chosen || []).forEach((name) => {
      lookup[name] = (lookup[name] || 0) + total;
    });
  });
  return lookup;
}

function generateDreamTeam() {
  const signedIn = wcRequireAccount((msg) => {
    dreamTeamNoteEl.hidden = false;
    dreamTeamNoteEl.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = msg;
    dreamTeamNoteEl.appendChild(p);
  }, "generate a Dream Team");
  if (!signedIn) return;

  const eligible = eligibleObtainedMembers();

  if (eligible.length < 6) {
    dreamTeamNoteEl.hidden = false;
    dreamTeamNoteEl.innerHTML = "";
    const p = document.createElement("p");
    p.textContent =
      poolScope === "full"
        ? `Generate Dream Team needs at least 6 Pokémon with confirmed base-stat/learnset data — only ${eligible.length} exist in the full Pokédex right now (the newest Reg M-B additions don't have confirmed data yet — see README.md).`
        : `Generate Dream Team needs at least 6 obtained Pokémon with confirmed base-stat/learnset data — you have ${eligible.length} right now. ` +
          `Mark more as obtained on the Pokédex tracker (or, for the newest Reg M-B additions, that data isn't confirmed yet — see README.md), or switch to Full Pokédex above.`;
    dreamTeamNoteEl.appendChild(p);
    return;
  }

  const threatsWithTypes = getThreatsWithTypes();

  // Milestone 19: keep whatever's already picked in the builder's own
  // slots (that's still eligible) so Dream Team builds the rest around it
  // instead of replacing the whole team outright.
  const keepFromCurrentPick = chosen.filter((name) => eligible.some((m) => m.name === name));

  // Milestone 42: real per-species "how much has this player already
  // used it" data, feeding wcExperienceDiversityBonus in strategy.js --
  // see buildExperienceLookup's own comment above.
  const experienceLookup = buildExperienceLookup();

  // Milestone 45: two genuinely different candidate teams instead of one.
  // wcPickDreamTeamOptions runs wcPickDreamTeam once normally to get
  // Option 1, then re-runs it with Option 1's own mechanism-defining
  // picks excluded from the pool -- its guaranteed-Mega core plus
  // whichever setter Milestone 43's baked-in wcAssignTeamSynergy chose
  // for its primary archetype -- so Option 2 is forced to find a
  // genuinely different Mega core and a different mechanism, not just
  // reshuffle whichever flex slots were left over. See
  // wcPickDreamTeamOptions's own doc comment in strategy.js for the full
  // reasoning, and buildDreamTeamOptionRenderData/selectDreamTeamOption
  // below for how each option becomes a real, fully-built, fully-
  // strategized team a click away from the other.
  const dreamOptions = wcPickDreamTeamOptions(
    eligible,
    threatsWithTypes,
    data.typeChart,
    6,
    notes,
    keepFromCurrentPick,
    data.natures,
    data.moves,
    data.abilities,
    metaUsageLookup,
    metaBaselineData,
    WINCON_BUILDER_FORMAT,
    liveMetaLookup,
    liveMetaBuildsLookup,
    experienceLookup,
    sheetMode,
    lockedBuildsLookup
  );

  const option1Pick = dreamOptions.option1.pick;

  if (option1Pick.chosen.length < 6) {
    dreamTeamNoteEl.hidden = false;
    dreamTeamNoteEl.innerHTML = "";
    const p = document.createElement("p");
    const excludedText =
      option1Pick.excludedNames && option1Pick.excludedNames.length
        ? ` after leaving out ${option1Pick.excludedNames.join(", ")} per your team notes`
        : "";
    p.textContent =
      `Generate Dream Team needs at least 6 eligible Pokémon${excludedText} -- only ${option1Pick.chosen.length} ${option1Pick.chosen.length === 1 ? "is" : "are"} left. ` +
      `Mark more as obtained, or adjust your notes.`;
    dreamTeamNoteEl.appendChild(p);
    return;
  }

  const option1Data = buildDreamTeamOptionRenderData(option1Pick, dreamOptions.option1.builds, eligible, threatsWithTypes);
  const option2Data = dreamOptions.option2
    ? buildDreamTeamOptionRenderData(dreamOptions.option2.pick, dreamOptions.option2.builds, eligible, threatsWithTypes)
    : null;

  dreamTeamOptionsState = { option1: option1Data, option2: option2Data, activeOption: 1 };

  selectDreamTeamOption(1);
}

/**
 * Milestone 45: everything that used to happen inline in
 * generateDreamTeam for its single result, now factored out so it can run
 * once per candidate option -- the team-notes trade-off/exclusion notes,
 * the effectiveMemberFor conversion (so a member's ACTUAL Mega form, if
 * any, is what strategy analysis and Mega-matchup advice see -- consistent
 * with every other real call site), Milestone 43/44's strategy analysis
 * and pilot-guide assembly. Deliberately does NOT call
 * applyAmendmentsToBuilds here (that function reads/mutates the MODULE-
 * LEVEL `builds` global directly by design -- see its own definition --
 * so calling it against an option that isn't the currently-committed one
 * would either mutate the wrong object or silently no-op); the amendments
 * for whichever option gets selected are applied in
 * selectDreamTeamOption below, once `builds` actually points at that
 * option's own build set.
 */
function buildDreamTeamOptionRenderData(pickResult, optionBuilds, eligible, threatsWithTypes) {
  const picked = pickResult.chosen;
  const members = picked.map((name) => eligible.find((m) => m.name === name));

  // The team notes can name a real Pokémon that just isn't obtained/
  // eligible yet -- wcPickDreamTeam only ever matches inclusion requests
  // against the eligible pool, so check the full roster too, purely to
  // explain the gap in the note below rather than silently ignoring it.
  const mentionedAnywhere = wcNotesMentionedSpecies(notes, data.pokemon.map((p) => p.name));
  const mentionedButNotEligible = mentionedAnywhere.filter(
    (name) => !pickResult.notesIncludedNames.includes(name) && !pickResult.excludedNames.includes(name)
  );

  // Milestone (Phoenix's Tailwind/Staraptor/screens request): a Pokemon
  // you just mentioned by name in your notes -- not necessarily hard
  // "must include" -- that carried a real archetype signal but didn't
  // make this particular option's final team gets an honest trade-off
  // note instead of silence, see wcSoftPreferenceTradeoffNote.
  const softMentionedNotIncluded = wcNotesPlainMentionedNames(notes, eligible.map((m) => m.name)).filter(
    (name) => !picked.includes(name)
  );
  const tradeoffNotes = softMentionedNotIncluded
    .map((name) => wcSoftPreferenceTradeoffNote(eligible.find((m) => m.name === name), members, WINCON_BUILDER_FORMAT, data.abilities))
    .filter(Boolean);

  const strategyMembers = picked.map((name) => {
    const pokemon = data.pokemon.find((p) => p.name === name);
    const baseStats = data.baseStats.find((b) => b.name === name);
    const learnableNames = data.learnsets[name];
    return effectiveMemberFor(name, pokemon.types, baseStats, learnableNames, optionBuilds[name]);
  });
  const strategyResult = wcAnalyzeTeamStrategy(strategyMembers, optionBuilds, data.moves, threatsWithTypes, data.typeChart, WINCON_BUILDER_FORMAT, notes, data.abilities, metaBaselineData);
  const megaAdvice = wcMegaMatchupAdvice(strategyMembers, threatsWithTypes, data.typeChart);
  // Milestone 41: the hand-picked ability/item checks and the fully-
  // computable shared-weakness audit render in the exact same slot -- two
  // sources feeding one combined warnings list.
  const antiSynergyWarnings = [
    ...wcAntiSynergyWarnings(strategyMembers, optionBuilds, data.abilities),
    ...wcSharedWeaknessWarnings(strategyMembers, data.typeChart),
  ];
  // Milestone 44's "how to pilot this team" data, reused here in
  // condensed form for this option's own mini strategy-bubble preview
  // card (renderDreamTeamOptionsControl) so the two mechanisms are
  // genuinely comparable before either one is committed.
  const guide = wcAssemblePilotGuide(strategyResult, megaAdvice, antiSynergyWarnings);

  return {
    chosen: picked,
    builds: optionBuilds,
    reasoning: pickResult.reasoning,
    megaNote: pickResult.megaNote,
    excludedNames: pickResult.excludedNames,
    droppedForcedNames: pickResult.droppedForcedNames,
    mentionedButNotEligible,
    tradeoffNotes,
    strategyResult,
    megaAdvice,
    antiSynergyWarnings,
    guide,
  };
}

/**
 * Milestone 45: swaps the working chosen/builds over to one of the two
 * generated options and renders it exactly the way a single-option Dream
 * Team result always has (renderDreamTeamNote/renderStrategyNote, which
 * itself ends with Milestone 44's full pilot-guide bubble) -- the two
 * options only ever differ in WHICH pre-computed data they commit, never
 * in how that data gets displayed once committed. Safe to call again for
 * the option that's already active (e.g. re-clicking the same card):
 * applyAmendmentsToBuilds is idempotent (it sets fields to their target
 * values, it doesn't toggle them), so nothing double-applies.
 */
function selectDreamTeamOption(n) {
  if (!dreamTeamOptionsState) return;
  const optionData = n === 1 ? dreamTeamOptionsState.option1 : dreamTeamOptionsState.option2;
  if (!optionData) return;

  dreamTeamOptionsState.activeOption = n;

  chosen = optionData.chosen;
  builds = optionData.builds;
  // Milestone 36's established sequencing: builds must already point at
  // THIS option's own build set before applying its amendments, since
  // applyAmendmentsToBuilds mutates the module-level `builds` global
  // directly rather than taking one as a parameter.
  applyAmendmentsToBuilds(optionData.strategyResult.amendments);

  invalidateComputedNotes();
  pendingStrategy = optionData.strategyResult;

  renderPicker();
  renderSlots();
  renderDreamTeamOptionsControl();
  renderDreamTeamNote(
    optionData.reasoning,
    optionData.megaNote,
    optionData.excludedNames,
    optionData.droppedForcedNames,
    optionData.mentionedButNotEligible,
    optionData.tradeoffNotes,
    optionData.antiSynergyWarnings
  );
  renderStrategyNote(optionData.strategyResult, true, optionData.megaAdvice, optionData.antiSynergyWarnings);

  autogenHint.textContent = "";
  saveStatus.textContent =
    optionData.strategyResult.archetype === "balanced"
      ? "Dream Team picked and built — no single shared strategy stood out for this roster, so it's playing as six strong independent attackers. Save team when you're happy with it."
      : `Dream Team picked, built, and strategized around ${archetypeLabel(optionData.strategyResult.archetype)} — Save team when you're happy with it.`;
}

/**
 * Milestone 45: the small "Option 1 / Option 2" UI control at the top of
 * the generated team card. Hidden entirely when there's no genuinely
 * different Option 2 to offer (wcPickDreamTeamOptions returned option2:
 * null -- an honest "there wasn't room for a second real mechanism after
 * excluding the first one's core" rather than forcing a worse option).
 * Each card is a condensed preview built from that option's own
 * wcAssemblePilotGuide data -- deliberately NOT the full pilot-guide
 * bubble (that's reserved for whichever option is actually committed,
 * rendered via the existing renderStrategyNote/renderPilotGuideNote
 * pipeline in selectDreamTeamOption above) -- just enough of a "mini
 * version" to tell the two mechanisms apart before committing one.
 */
function renderDreamTeamOptionsControl() {
  if (!dreamTeamOptionsEl) return;
  if (!dreamTeamOptionsState || !dreamTeamOptionsState.option2) {
    dreamTeamOptionsEl.hidden = true;
    dreamTeamOptionsEl.innerHTML = "";
    return;
  }

  dreamTeamOptionsEl.innerHTML = "";
  dreamTeamOptionsEl.hidden = false;

  const intro = document.createElement("p");
  intro.className = "hint dream-team-options-intro";
  intro.textContent = "Two genuinely different builds came out of this generation — pick whichever mechanism you'd rather play, then Save team when you're happy.";
  dreamTeamOptionsEl.appendChild(intro);

  const row = document.createElement("div");
  row.className = "dream-team-options-row";

  [1, 2].forEach((n) => {
    const optionData = n === 1 ? dreamTeamOptionsState.option1 : dreamTeamOptionsState.option2;
    const guide = optionData.guide;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "dream-team-option-card" + (dreamTeamOptionsState.activeOption === n ? " is-active" : "");
    card.addEventListener("click", () => selectDreamTeamOption(n));

    const label = document.createElement("div");
    label.className = "option-label";
    label.textContent = `Option ${n}`;
    card.appendChild(label);

    const mechanism = document.createElement("div");
    mechanism.className = "option-mechanism";
    mechanism.textContent =
      guide && guide.archetypeLabel
        ? `${guide.archetypeLabel}${guide.setterName ? ` — ${guide.setterName}` : ""}`
        : "Balanced — no single shared mechanism";
    card.appendChild(mechanism);

    if (guide && guide.counterNote) {
      const counter = document.createElement("div");
      counter.className = "option-counter";
      counter.textContent = `Countered by: ${guide.counterNote}`;
      card.appendChild(counter);
    }

    row.appendChild(card);
  });

  dreamTeamOptionsEl.appendChild(row);
}
function renderDreamTeamNote(reasoning, megaNote, excludedNames, droppedForcedNames, mentionedButNotEligible, tradeoffNotes, antiSynergyWarnings) {
  dreamTeamNoteEl.innerHTML = "";
  dreamTeamNoteEl.hidden = false;

  // Milestone 40: built from poolScope directly (module-level, not
  // threaded through as a parameter) -- the one caveat that matters most
  // when this team came from the full roster instead of what's actually
  // obtained: some of these six may not be caught/trained yet.
  if (poolScope === "full") {
    const fullDexP = document.createElement("p");
    fullDexP.className = "hint dream-team-excluded-note";
    fullDexP.textContent =
      "Built from the full Pokédex, not just what you've marked obtained — some of these six may still need catching or training in-game before you can actually use this build. Switch back to \u201cMy Pokédex\u201d above once you're ready to build from what you actually own.";
    dreamTeamNoteEl.appendChild(fullDexP);
  }

  if (antiSynergyWarnings && antiSynergyWarnings.length) {
    antiSynergyWarnings.forEach((text) => {
      const warningP = document.createElement("p");
      warningP.className = "hint dream-team-excluded-note anti-synergy-warning";
      warningP.textContent = text;
      dreamTeamNoteEl.appendChild(warningP);
    });
  }

  if (tradeoffNotes && tradeoffNotes.length) {
    tradeoffNotes.forEach((text) => {
      const tradeoffP = document.createElement("p");
      tradeoffP.className = "hint dream-team-excluded-note";
      tradeoffP.textContent = text;
      dreamTeamNoteEl.appendChild(tradeoffP);
    });
  }

  if (excludedNames && excludedNames.length) {
    const excludedP = document.createElement("p");
    excludedP.className = "hint dream-team-excluded-note";
    excludedP.textContent = `Left out per your team notes: ${excludedNames.join(", ")}.`;
    dreamTeamNoteEl.appendChild(excludedP);
  }

  if (mentionedButNotEligible && mentionedButNotEligible.length) {
    const isOne = mentionedButNotEligible.length === 1;
    const mentionedP = document.createElement("p");
    mentionedP.className = "hint dream-team-excluded-note";
    mentionedP.textContent =
      `Your notes ask for ${mentionedButNotEligible.join(", ")}, but ${isOne ? "it isn't" : "they aren't"} marked obtained yet (or ${isOne ? "doesn't" : "don't"} have confirmed base-stat/learnset data) -- mark ${isOne ? "it" : "them"} obtained on the Pokédex tracker to have Dream Team actually include ${isOne ? "it" : "them"}.`;
    dreamTeamNoteEl.appendChild(mentionedP);
  }

  if (droppedForcedNames && droppedForcedNames.length) {
    const droppedP = document.createElement("p");
    droppedP.className = "hint dream-team-excluded-note";
    droppedP.textContent = `Couldn't fit everyone you already had picked/asked for into a 6-Pokémon team -- left out ${droppedForcedNames.join(", ")} for space.`;
    dreamTeamNoteEl.appendChild(droppedP);
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

/**
 * Milestone 31: single-slot version of Auto-build team, below — fills in
 * one Pokémon's Nature/item/moves/Stat Points via the same wcGenerateBuild
 * engine, without touching any other slot. Item Clause is enforced against
 * this slot's SIBLINGS (the other chosen slots' current items), not a
 * fresh empty Set the way a whole-team generation starts — so this won't
 * hand out an item one of your other 5 is already holding, but it also
 * won't retroactively flag/change anything already on the team.
 */
function autoBuildSingle(baseName) {
  if (!wcRequireAccount((msg) => { autogenHint.textContent = msg; }, "auto-fill a moveset")) return;

  const pokemon = data.pokemon.find((p) => p.name === baseName);
  const baseStats = data.baseStats.find((b) => b.name === baseName);
  const learnableNames = data.learnsets[baseName];
  if (!pokemon || !baseStats || !learnableNames) {
    autogenHint.textContent = `${baseName} doesn't have complete base-stat/learnset data yet (one of the Reg M-B additions) — build it by hand for now.`;
    invalidateComputedNotes();
    return;
  }

  const usedItems = new Set();
  chosen.forEach((name) => {
    if (name === baseName) return;
    const item = builds[name] && builds[name].item;
    if (item) usedItems.add(item.trim());
  });

  const threatsWithTypes = getThreatsWithTypes();
  const generated = wcGenerateBuild(
    { name: baseName, types: pokemon.types },
    baseStats,
    learnableNames,
    data.moves,
    threatsWithTypes,
    data.typeChart,
    {
      format: WINCON_BUILDER_FORMAT,
      usedItems,
      megaForms: megaFormsFor(baseName),
      abilitiesData: data.abilities,
      sheetMode,
      liveMetaBuilds: liveMetaBuildsLookup,
      lockedBuild: lockedBuildsLookup[baseName],
      notes,
    }
  );

  builds[baseName] = generated;
  invalidateComputedNotes();
  renderSlots();

  const isMegaBuild = Object.values(WINCON_MEGA_STONES).some(
    (stone) => stone.toLowerCase() === (generated.item || "").trim().toLowerCase()
  );
  autogenHint.textContent = isMegaBuild
    ? `Auto-filled ${baseName} with a real Mega build — review and tweak anything, or change its item to revert to the base form.`
    : `Auto-filled ${baseName}. Review and tweak anything — Nature, item, moves, and Stat Points are all editable.`;
}

function autoBuildTeam() {
  if (!wcRequireAccount((msg) => { autogenHint.textContent = msg; }, "auto-build a moveset")) return;
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

  const { builds: generated } = wcGenerateTeamBuilds(members, data.moves, threatsWithTypes, data.typeChart, WINCON_BUILDER_FORMAT, data.abilities, sheetMode, liveMetaBuildsLookup, lockedBuildsLookup, notes);

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
        : ` None of these six have a real, tournament-informed Mega build yet — either hand-curated or confirmed by real Regulation M-B tournament results — pick one of your obtained Pokémon with a Mega form and hold its own Mega Stone in the item field if you want to build around one by hand.`;

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
  invalidateSimulatedWinRate();
}

/**
 * Simulated Win Rate: called (via invalidateComputedNotes()) on every real
 * edit to the working team. Doesn't clear the last computed result outright
 * -- unlike Rival/Strategy, which fully forget theirs and require a fresh
 * manual click either way -- since the whole point of "auto-runs once on
 * the incomplete->complete transition, a manual button covers later edits"
 * (see refreshSimulatedWinRate()) is that the previous numbers stay on
 * screen, just marked as no longer reflecting the current build, until
 * Re-run simulation is clicked (or the team goes incomplete and back to
 * complete again, which IS a fresh transition and re-triggers on its own).
 */
function invalidateSimulatedWinRate() {
  if (simWinRateResult) simWinRateNeedsRerun = true;
}

function autoBuildStrategy() {
  if (!wcRequireAccount((msg) => { autogenHint.textContent = msg; }, "auto-build a strategy")) return;
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

  const result = wcAnalyzeTeamStrategy(members, builds, data.moves, threatsWithTypes, data.typeChart, WINCON_BUILDER_FORMAT, notes, data.abilities, metaBaselineData);
  pendingStrategy = result;
  autogenHint.textContent = "";
  // Milestone 41: same combined warnings list as generateDreamTeam() above.
  const antiSynergyWarnings = [
    ...wcAntiSynergyWarnings(members, builds, data.abilities),
    ...wcSharedWeaknessWarnings(members, data.typeChart),
  ];
  renderStrategyNote(result, false, wcMegaMatchupAdvice(members, threatsWithTypes, data.typeChart), antiSynergyWarnings);
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

function renderStrategyNote(strategy, alreadyApplied, megaAdvice, antiSynergyWarnings) {
  strategyNoteEl.innerHTML = "";
  strategyNoteEl.hidden = false;

  renderStrategyOption(strategyNoteEl, strategy, "Recommended strategy", strategy.metaSynergy);

  if (megaAdvice) {
    const megaAdviceP = document.createElement("p");
    megaAdviceP.className = "meta-synergy-note mega-matchup-advice";
    const megaAdviceLabel = document.createElement("strong");
    megaAdviceLabel.textContent = "Mega matchup advisor: ";
    megaAdviceP.appendChild(megaAdviceLabel);
    megaAdviceP.appendChild(document.createTextNode(megaAdvice.note));
    strategyNoteEl.appendChild(megaAdviceP);
  }

  if (antiSynergyWarnings && antiSynergyWarnings.length) {
    antiSynergyWarnings.forEach((text) => {
      const warningP = document.createElement("p");
      warningP.className = "meta-synergy-note anti-synergy-warning";
      const warningLabel = document.createElement("strong");
      warningLabel.textContent = "Possible conflict: ";
      warningP.appendChild(warningLabel);
      warningP.appendChild(document.createTextNode(text));
      strategyNoteEl.appendChild(warningP);
    });
  }

  if (alreadyApplied && strategy.amendments && strategy.amendments.length > 0) {
    const appliedNote = document.createElement("p");
    appliedNote.className = "hint";
    appliedNote.textContent = "Applied automatically as part of Dream Team — no extra click needed.";
    strategyNoteEl.appendChild(appliedNote);
  } else if (strategy.amendments && strategy.amendments.length > 0) {
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
      renderStrategyNote(swapped, false, megaAdvice, antiSynergyWarnings);
    });
    altBox.appendChild(switchBtn);
    strategyNoteEl.appendChild(altBox);
  }

  renderPilotGuideNote(strategy, megaAdvice, antiSynergyWarnings);
}

/**
 * Milestone 44: "how to pilot this team" -- a single explainer bubble
 * combining everything already computed elsewhere: the team's actual
 * primary mechanism and its setter (genuinely applied to the build since
 * Milestone 43, not just suggested), wcMegaMatchupAdvice's existing
 * guidance on which Mega to bring, the combined anti-synergy/shared-
 * weakness warnings, and the new stated-counter line. Called as the last
 * step of renderStrategyNote above so it's always in sync with whichever
 * strategy is currently active -- including after "Use this instead"
 * swaps to the alternative. All the real logic (what to say, in what
 * order) lives in strategy.js's wcAssemblePilotGuide -- this is a thin
 * DOM renderer over that pure object.
 */
function renderPilotGuideNote(strategy, megaAdvice, antiSynergyWarnings) {
  if (!pilotGuideNoteEl) return;
  const guide = wcAssemblePilotGuide(strategy, megaAdvice, antiSynergyWarnings);
  if (!guide) {
    pilotGuideNoteEl.hidden = true;
    return;
  }

  pilotGuideNoteEl.innerHTML = "";
  pilotGuideNoteEl.hidden = false;

  const heading = document.createElement("h3");
  heading.textContent = "How to pilot this team";
  pilotGuideNoteEl.appendChild(heading);

  const mechanismP = document.createElement("p");
  if (!guide.archetypeLabel) {
    mechanismP.textContent =
      "No single shared mechanism stands out for this roster -- play it as six strong independent attackers and lean on individual matchups.";
  } else {
    const strong = document.createElement("strong");
    strong.textContent = `${guide.archetypeLabel}${guide.setterName ? ` (${guide.setterName})` : ""}: `;
    mechanismP.appendChild(strong);
    mechanismP.appendChild(document.createTextNode(guide.mechanismNote));
  }
  pilotGuideNoteEl.appendChild(mechanismP);

  if (guide.megaAdviceNote) {
    const megaP = document.createElement("p");
    const megaLabel = document.createElement("strong");
    megaLabel.textContent = "Which Mega to bring: ";
    megaP.appendChild(megaLabel);
    megaP.appendChild(document.createTextNode(guide.megaAdviceNote));
    pilotGuideNoteEl.appendChild(megaP);
  }

  if (guide.warnings && guide.warnings.length) {
    const warnP = document.createElement("p");
    const warnLabel = document.createElement("strong");
    warnLabel.textContent = "Watch for: ";
    warnP.appendChild(warnLabel);
    warnP.appendChild(document.createTextNode(guide.warnings.join(" ")));
    pilotGuideNoteEl.appendChild(warnP);
  }

  if (guide.counterNote) {
    const counterP = document.createElement("p");
    counterP.className = "pilot-guide-counter";
    const counterLabel = document.createElement("strong");
    counterLabel.textContent = "How an opponent might counter this: ";
    counterP.appendChild(counterLabel);
    counterP.appendChild(document.createTextNode(guide.counterNote));
    pilotGuideNoteEl.appendChild(counterP);
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

/**
 * Locked builds: a strategy amendment's moves/role change is NEVER
 * applied directly to a locked species' build -- that's the whole point
 * of "permanent." Instead it's overlaid (via wcApplyAmendmentToFields in
 * strategy.js) onto a build.recommendedBuild preview, discoverable via
 * the Current/Recommended toggle (buildLockedBuildViewToggle) rendered
 * in renderSlot. Item is never locked, so an item amendment always
 * applies directly regardless of lock status. Called from both
 * handleMakeChanges()'s manual "Make changes" flow and
 * generateDreamTeam()'s auto-apply-on-finish flow, unchanged.
 */
function applyAmendmentsToBuilds(amendments) {
  (amendments || []).forEach((amendment) => {
    const build = builds[amendment.pokemon];
    if (!build) return;
    if (amendment.item) build.item = amendment.item.to;

    const isLocked = Boolean(lockedBuildsLookup[amendment.pokemon]);
    if (!isLocked) {
      if (amendment.moves) build.moves[amendment.moves.slotIndex] = amendment.moves.to;
      if (amendment.role) {
        build.nature = amendment.role.natureTo;
        build.sp = { ...amendment.role.spTo };
      }
      return;
    }

    if (!amendment.moves && !amendment.role) return;
    const baseFields = build.recommendedBuild || { nature: build.nature, sp: build.sp, moves: build.moves };
    build.recommendedBuild = wcApplyAmendmentToFields(baseFields, amendment);
    if (build.buildView !== "recommended") build.buildView = "current";
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
    newTeam.poolScope = poolScope;
    teamState.teams.push(newTeam);
    activeId = newTeam.id;
    teamState.activeId = activeId;
    wcSaveTeamState(teamState);
    loadActiveIntoWorkingState();
    renderTeamTabs();
    renderSheetToggle();
    renderPoolScopeToggle();
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
  return wcSlotEffective(name, build) || data.pokemon.find((p) => p.name === name);
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
      const rawBuild = builds[name] || {};
      const pokemon = effectivePokemonFor(name, rawBuild);
      const baseStats = pokemon && data.baseStats.find((b) => b.name === pokemon.name);
      // Locked builds: while previewing a Recommended change, Matchup
      // Score should score with the preview's Nature/Stat Points/moves,
      // exactly like it already follows build.megaView for Mega/base --
      // see wcEffectiveBuildFields. Item/ability/megaView etc. are
      // untouched (spread first, then overridden).
      const build = { ...rawBuild, ...wcEffectiveBuildFields(name, rawBuild) };
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

/** Milestone 25: the analysis-locked callout, mirrored on both builder pages -- see refreshDerivedSections() below. */
const analysisLockedEl = document.getElementById("analysis-locked");

function refreshDerivedSections() {
  const hasTeam = chosen.length > 0;
  const signedIn = wcIsSignedIn();

  noTeamEl.hidden = hasTeam;
  if (analysisLockedEl) analysisLockedEl.hidden = !(hasTeam && !signedIn);
  const showAnalysis = hasTeam && signedIn;
  rivalHeaderRowEl.hidden = !showAnalysis;
  coverageSectionEl.hidden = !showAnalysis;
  if (teamThreatsSectionEl) teamThreatsSectionEl.hidden = !showAnalysis;
  if (speedTiersSectionEl) speedTiersSectionEl.hidden = !showAnalysis;
  rivalSectionEl.hidden = !showAnalysis;
  if (simulatedWinrateSectionEl) simulatedWinrateSectionEl.hidden = !showAnalysis;
  if (!showAnalysis) {
    simWinRateWasComplete = false;
    return;
  }

  renderTypeCoverage();
  renderTeamThreats();
  renderSpeedTiers();
  refreshSimulatedWinRate();
}

// ---------------------------------------------------------------------------
// Simulated Win Rate -- the real mechanical battle simulator (Web Worker,
// see battle-sim-client.js/battle-sim-worker.js) that replaced the old
// Matchup Score ring/win-loss pill/full matrix above. Gated strictly on
// isTeamComplete() (every field on all 6 filled in), auto-run once on the
// incomplete->complete transition, with a manual "Re-run simulation"
// covering every edit after that -- see the module-level simWinRate*
// variables' own doc comment near pendingRival for the full state model.
// ---------------------------------------------------------------------------

/** Shows/hides the section and either the incomplete hint, the last computed result, or (on a fresh incomplete->complete transition) kicks off a new simulation. Called from refreshDerivedSections() every time the team re-renders. */
function refreshSimulatedWinRate() {
  if (!simulatedWinrateSectionEl) return;

  const complete = isTeamComplete();
  if (!complete) {
    simWinRateWasComplete = false;
    simwinrateHintEl.hidden = false;
    simwinrateHintEl.textContent =
      "Complete every field for all 6 Pokémon first — Nature, item, all 4 moves, all 66 Stat Points, and no duplicate items — to unlock the Simulated Win Rate.";
    simwinrateLoadingEl.hidden = true;
    simwinrateScenariosEl.hidden = true;
    simwinrateScenariosEl.innerHTML = "";
    simwinrateRerunBtn.hidden = true;
    simwinrateMethodologyEl.hidden = true;
    return;
  }

  const justCompleted = !simWinRateWasComplete;
  simWinRateWasComplete = true;

  if (simWinRateResult) {
    renderSimulatedWinRateResult(simWinRateResult);
    return;
  }

  if (justCompleted || !simWinRateInFlight) runSimulatedWinRate();
}

/** Gathers everything the Worker needs from this page's own data/state -- see wcSimulateTeamWinRate's own doc comment in battle-sim-lineup.js for the exact shape. */
function buildSimulatedWinRatePayload() {
  // Locked builds: the Worker should simulate with whatever's actually
  // being VIEWED right now, same as Matchup Score/Speed tiers above --
  // a chosen member currently previewing a Recommended change gets that
  // preview's Nature/Stat Points/moves, everyone else is unaffected.
  const effectiveBuilds = {};
  chosen.forEach((name) => {
    const build = builds[name] || {};
    effectiveBuilds[name] = { ...build, ...wcEffectiveBuildFields(name, build) };
  });
  return {
    chosenSix: chosen,
    builds: effectiveBuilds,
    format: WINCON_BUILDER_FORMAT,
    sheetMode,
    pokemonList: data.pokemon,
    baseStatsData: data.baseStats,
    abilitiesData: data.abilities,
    movesData: data.moves,
    moveEffects: moveEffectsData,
    abilityEffects: abilityEffectsData,
    itemEffects: itemEffectsData,
    typeChart: data.typeChart,
    natures: data.natures,
    metaBaseline: metaBaselineData,
    comboLookup: comboSynergyLookup,
    liveTierStats: liveMetaLookup,
  };
}

/** Actually runs (or re-runs) the simulation via the Worker. Shared by the auto-run-on-transition path and the manual "Re-run simulation" button. */
async function runSimulatedWinRate() {
  if (simWinRateInFlight) return;
  simWinRateInFlight = true;
  simwinrateHintEl.hidden = true;
  simwinrateScenariosEl.hidden = true;
  simwinrateRerunBtn.hidden = true;
  simwinrateMethodologyEl.hidden = true;
  simwinrateLoadingEl.hidden = false;

  try {
    const result = await wcRunSimAsync("simulateWinRate", buildSimulatedWinRatePayload());
    simWinRateResult = result;
    simWinRateNeedsRerun = false;
    renderSimulatedWinRateResult(result);
  } catch (err) {
    simwinrateHintEl.hidden = false;
    simwinrateHintEl.textContent =
      "The simulation didn't finish — this can happen on an older/slower device. Try Re-run simulation, or reload the page if it keeps failing.";
    simwinrateRerunBtn.hidden = false;
  } finally {
    simWinRateInFlight = false;
    simwinrateLoadingEl.hidden = true;
  }
}

function renderSimulatedWinRateResult(result) {
  simwinrateHintEl.hidden = true;
  simwinrateLoadingEl.hidden = true;
  simwinrateScenariosEl.hidden = false;
  simwinrateScenariosEl.innerHTML = "";
  simwinrateRerunBtn.hidden = false;
  simwinrateRerunBtn.textContent = simWinRateNeedsRerun ? "Re-run simulation (your team has changed)" : "Re-run simulation";
  simwinrateMethodologyEl.hidden = false;

  const lineupNote = document.createElement("p");
  lineupNote.className = "hint simwinrate-lineup-note";
  lineupNote.textContent =
    `WinCon's own best bring-${result.lineup.length}-of-6 lineup for this team: ${result.lineup.join(", ")}.` +
    (sheetMode === "open" ? " Scored under your Open Team Sheet — the opponent AI gets full information from turn 1." : "");
  simwinrateScenariosEl.appendChild(lineupNote);

  result.scenarios.forEach((scenario) => {
    simwinrateScenariosEl.appendChild(renderSimwinrateCard(scenario));
  });
}

function renderSimwinrateCard(scenario) {
  const card = document.createElement("div");
  card.className = "simwinrate-card";

  const pct = Math.round(scenario.winRate * 100);
  const hero = document.createElement("div");
  hero.className = "score-hero";
  const ring = document.createElement("div");
  ring.className = "score-ring";
  ring.style.setProperty("--score", pct);
  const num = document.createElement("span");
  num.textContent = `${pct}%`;
  ring.appendChild(num);
  const meta = document.createElement("div");
  meta.className = "score-meta";
  const heading = document.createElement("h3");
  heading.className = "section-title";
  heading.textContent = scenario.megaName ? `Mega Evolving ${scenario.megaName}` : "No Mega Evolution";
  const summary = document.createElement("p");
  summary.className = "hint";
  summary.textContent = `Won ${scenario.wins} of ${scenario.totalRuns} simulated battles (${scenario.draws} draws) against the reference field.`;
  meta.append(heading, summary);
  hero.append(ring, meta);
  card.appendChild(hero);

  const toughest = [...(scenario.perOpponent || [])].sort((a, b) => a.winRate - b.winRate).slice(0, 3);
  if (toughest.length > 0) {
    const toughPara = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = "Toughest reference matchups: ";
    toughPara.appendChild(strong);
    toughPara.appendChild(
      document.createTextNode(toughest.map((t) => `${t.label} (${Math.round(t.winRate * 100)}% win rate)`).join(", "))
    );
    card.appendChild(toughPara);
  }

  return card;
}

/**
 * Shared by Your Rival's own "Toughest matchups against them" list
 * (renderRival()) -- kept here since it's just a small pure DOM helper,
 * not tied to any one section any more now that the old full-roster
 * Matchup Score list that used to also call this is gone.
 */
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
// Comparison-driven additions (Sep 2026): after comparing WinCon's Builder
// against pokemon-zone.com's Pokémon Champions Team Builder, two of its
// small, self-contained widgets were genuinely good ideas WinCon didn't
// have yet -- neither needed new data or a new heuristic, just a new way
// to look at data WinCon already computes elsewhere (getThreatsWithTypes()
// for the threats list, wcCalcStat for stats). Both render every time
// refreshDerivedSections() does, right alongside Team type coverage above.
// ---------------------------------------------------------------------------

/** How many named threats renderTeamThreats() shows at most -- same idea as COVERAGE_TOP_N above, just applied to the threats list instead of the 18-type chart. */
const TEAM_THREATS_TOP_N = 8;

/**
 * pokemon-zone.com's "Threats" tab, adapted: for every named Pokémon in
 * WinCon's own threats list (getThreatsWithTypes() -- the curated roster in
 * data/starter-threats.json, plus anything real logged battles show is
 * genuinely dangerous, plus data/meta-baseline.json's Worlds-2026-grounded
 * rosters), count how many of the CURRENT six are weak to that threat's own
 * typing, and show the ones that hit the most of your team hardest first.
 * Deliberately just a type chart lookup (wcBestEffectiveness, same helper
 * Team type coverage above uses) -- not a simulated battle, and not trying
 * to be one. Simulated Win Rate below is the actual predicted-win-rate
 * feature; this is meant to be read in the second it takes to render, as a
 * first-pass warning sign before that heavier simulation even runs.
 */
function renderTeamThreats() {
  const container = document.getElementById("team-threats-list");
  if (!container) return;
  const members = chosen.map((name) => effectivePokemonFor(name, builds[name] || {})).filter(Boolean);
  container.innerHTML = "";
  if (members.length === 0) return;

  const threats = getThreatsWithTypes();
  const scored = threats
    .map((threat) => {
      if (!threat.types || threat.types.length === 0) return null;
      const weakMembers = members.filter((m) => wcBestEffectiveness(data.typeChart, threat.types, m.types) > 1);
      return weakMembers.length > 0 ? { threat, weakMembers } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.weakMembers.length - a.weakMembers.length)
    .slice(0, TEAM_THREATS_TOP_N);

  if (scored.length === 0) {
    const li = document.createElement("li");
    li.className = "coverage-item";
    li.textContent = "Nothing in WinCon's Worlds-grounded reference list stands out against this team right now.";
    container.appendChild(li);
    return;
  }

  scored.forEach(({ threat, weakMembers }) => {
    const li = document.createElement("li");
    li.className = "coverage-item";
    const nameEl = document.createElement("strong");
    nameEl.textContent = threat.name;
    li.appendChild(nameEl);
    li.appendChild(document.createTextNode(" "));
    (threat.types || []).forEach((t) => {
      const tag = document.createElement("span");
      tag.className = `type-tag type-${t.toLowerCase()}`;
      tag.textContent = t;
      li.appendChild(tag);
    });
    li.appendChild(document.createTextNode(`${weakMembers.length} of ${members.length} of your team are weak to this`));
    const detail = document.createElement("span");
    detail.className = "coverage-detail";
    detail.textContent = weakMembers.map((m) => m.name).join(", ");
    li.appendChild(detail);
    container.appendChild(li);
  });
}

/**
 * pokemon-zone.com's "Speed" tab, adapted: every current team member's
 * final Speed stat (Mega-aware, via effectivePokemonFor -- same as Team
 * type coverage above), plus what that same Speed becomes under Tailwind
 * (a flat x2 while it's up, on either format's field), all merged into one
 * list sorted fastest to slowest. Reading position in this list against a
 * known benchmark (a common Choice Scarf number, a rival's likely Speed) is
 * the whole point -- it's why the Tailwind row sits inline with the plain
 * rows rather than in a separate column. Purely a stat-math display, same
 * wcCalcStat formula (stats.js) every other final-stat number on this page
 * already uses -- no battle simulation involved.
 */
function renderSpeedTiers() {
  const table = document.getElementById("speed-tiers-table");
  if (!table) return;
  table.innerHTML = "";

  const members = chosen
    .map((name) => {
      const build = builds[name] || {};
      const pokemon = effectivePokemonFor(name, build);
      const baseStats = pokemon && data.baseStats.find((b) => b.name === pokemon.name);
      if (!pokemon || !baseStats || !build.sp) return null;
      // Locked builds: follows the Recommended preview while one's
      // active, same as scoreAgainstThreats above.
      const eff = wcEffectiveBuildFields(name, build);
      const speed = wcCalcStat(baseStats.spe, "speed", (eff.sp && eff.sp.speed) || 0, eff.nature, data.natures);
      return { name: pokemon.name, speed };
    })
    .filter(Boolean);
  if (members.length === 0) return;

  const entries = [];
  members.forEach((m) => {
    entries.push({ label: m.name, speed: m.speed });
    entries.push({ label: `${m.name} + Tailwind (×2)`, speed: m.speed * 2 });
  });
  entries.sort((a, b) => b.speed - a.speed);

  const headRow = document.createElement("tr");
  ["Pokémon", "Speed"].forEach((heading) => {
    const th = document.createElement("th");
    th.textContent = heading;
    headRow.appendChild(th);
  });
  table.appendChild(headRow);

  entries.forEach((entry) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.textContent = entry.label;
    const speedCell = document.createElement("td");
    speedCell.textContent = String(entry.speed);
    row.append(nameCell, speedCell);
    table.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Milestone 28: the full "Track your results" section (log form, summary,
// history list, delete) moved to its own page -- battle-tracker.html/
// battle-tracker.js -- so this page stays focused on building a team
// rather than also being where its game history lives. All that remains
// here is the compact win/loss percentage above (matchRecordEl /
// renderMatchRecord(), still reading the same team.matchLog) and the
// "log a result" entry points on that record, which now link over to
// Battle Tracker instead of opening an inline form.
// ---------------------------------------------------------------------------

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

/**
 * Your current 6 (effective identity — Mega-aware), shaped as a "threats"
 * list so wcPickDreamTeam can pick a team that scores well specifically
 * against IT, in reverse. Milestone 21: also carries baseStats/ability
 * (for the new per-pair coverage scoring) and the actual build (moves,
 * item) each slot already has -- this is the one threats list where a
 * real moveset is genuinely known, since it's the player's own built
 * team, so it's also the one place wcDetectWeatherArchetype can spot a
 * confirmed Rain Dance/Sunny Day rather than only an innate ability.
 */
function myTeamAsThreats() {
  return chosen
    .map((name) => {
      const build = builds[name] || {};
      const effective = effectivePokemonFor(name, build);
      if (!effective) return null;
      const baseStats = data.baseStats.find((b) => b.name === effective.name);
      const ability = wcAbilityOf(data.abilities, effective.name);
      return { name: effective.name, types: effective.types, role: "Your team", baseStats, ability, build };
    })
    .filter(Boolean);
}

function findYourRival() {
  // Defensive: #rival-section (which holds this button) is already hidden
  // whenever signed out (see refreshDerivedSections()), but this guards
  // the function itself too, same as the other analysis/build actions.
  if (!wcIsSignedIn()) {
    wcShowAccountPopup();
    return;
  }
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
  const { chosen: rivalNames, reasoning } = wcPickDreamTeam(pool, myThreats, data.typeChart, 6, undefined, undefined, data.natures, data.moves, data.abilities, metaUsageLookup, metaBaselineData, WINCON_BUILDER_FORMAT, liveMetaLookup, liveMetaBuildsLookup);
  const rivalMembers = rivalNames.map((name) => pool.find((m) => m.name === name));

  pendingRival = { rivalMembers, rivalBuilds: {}, reasoning, rivalSuccessRate: 0, myResult: null, customized: false };
  recomputeRivalScoring();
  renderRival(pendingRival);
}

/**
 * Milestone 20: (re)builds pendingRival.rivalBuilds/myResult/rivalSuccessRate
 * from pendingRival.rivalMembers as they currently stand — shared by
 * findYourRival()'s first synthesis and swapRivalMember()'s live recompute
 * after the player edits a slot, so both paths score exactly the same way.
 * The rival's own moveset is generated for narrative/display only — it
 * never feeds the numeric score (wcScoreMatchup only reads the opposing
 * side's types + base Speed, never its moves), so it's always synthesized
 * as a normal Closed-Sheet build regardless of YOUR sheetMode.
 */
function recomputeRivalScoring() {
  const myThreats = myTeamAsThreats();
  const { builds: rivalBuilds } = wcGenerateTeamBuilds(pendingRival.rivalMembers, data.moves, myThreats, data.typeChart, WINCON_BUILDER_FORMAT, data.abilities, "closed", liveMetaBuildsLookup);
  const rivalAsThreats = pendingRival.rivalMembers.map((m) => ({ name: m.name, types: m.types, role: "Your Rival" }));
  const myResult = scoreAgainstThreats(rivalAsThreats);
  pendingRival.rivalBuilds = rivalBuilds;
  pendingRival.myResult = myResult;
  pendingRival.rivalSuccessRate = 100 - myResult.score;
}

/**
 * Species selectable for one Your Rival slot's dropdown — the same
 * eligible pool as the original synthesis (buildRivalPool(): confirmed
 * data, never your own team, no Mega forms since those are never
 * independently picked), minus whichever species are on the rival's
 * OTHER five slots right now (so the roster can't end up with a
 * duplicate) — but never excluding this slot's OWN current pick, so it
 * always stays selectable in its own dropdown. Sorted alphabetically
 * since this is a plain browse-and-pick list, not a scored/ranked one.
 */
function buildRivalSpeciesOptions(rival, excludeIndex) {
  const usedByOtherSlots = new Set(rival.rivalMembers.filter((_, i) => i !== excludeIndex).map((m) => m.name));
  return buildRivalPool()
    .filter((m) => !usedByOtherSlots.has(m.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Milestone 20: swaps one slot of Your Rival's synthesized roster for a
 * different species the player picks from that slot's dropdown, then
 * rescores live — lets the player ask "what if the rival ran X instead"
 * without regenerating the whole rival from scratch. Marks the roster
 * customized so renderRival() stops presenting the original greedy-pick
 * reasoning as if it still fully describes what's on the team.
 */
function swapRivalMember(index, newName) {
  if (!pendingRival || !pendingRival.rivalMembers[index]) return;
  if (pendingRival.rivalMembers[index].name === newName) return;
  const pool = buildRivalPool();
  const newMember = pool.find((m) => m.name === newName);
  if (!newMember) return;
  pendingRival.rivalMembers[index] = newMember;
  pendingRival.customized = true;
  recomputeRivalScoring();
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
    wcBuildWinLossStat("Your win rate", `${winPct}%`, winPct),
    wcBuildWinLossStat("Your loss rate", `${lossPct}%`, 100 - lossPct),
    wcBuildWinLossStat("Win ratio", wcFormatRatioFromPercents(winPct, lossPct), winPct)
  );
  winlossBlock.append(winlossHeading, winlossHint, winlossRow);
  if (rival.customized) {
    const customNote = document.createElement("p");
    customNote.className = "hint rival-customized-note";
    customNote.textContent =
      "You've changed who's on this rival's roster below — the numbers above already reflect your edits, but \"Why this rival beats you\" still explains the original synthesized picks, not your changes.";
    winlossBlock.appendChild(customNote);
  }
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
  rival.rivalMembers.forEach((member, index) => {
    const build = rival.rivalBuilds[member.name] || emptyBuild();
    const effective = wcEffectivePokemon(data.pokemon, member.name, build.item) || member;
    const isMega = effective.name !== member.name;
    const card = document.createElement("article");
    card.className = "slot-card rival-card";

    const header = document.createElement("div");
    header.className = "slot-header";
    const sprite = spriteImg(effective.name, "slot-sprite");
    if (sprite) header.appendChild(sprite);

    // Milestone 20: this used to be a plain name — now a real <select> so
    // the player can swap this slot for a different species and see how
    // their team's win/loss numbers change against the edited rival (see
    // swapRivalMember()). The dropdown's own value always tracks the BASE
    // species picked for this slot (member.name), same as buildRivalPool()
    // -- Mega forms are never independently selected here either, same
    // rule as the player's own picker -- so when this slot's generated
    // build happens to Mega Evolve it (effective.name !== member.name),
    // that's shown with the same "Mega Evolved" badge/tooltip treatment
    // as the player's own slot cards use, right next to the dropdown.
    const select = document.createElement("select");
    select.className = "rival-species-select";
    select.setAttribute("aria-label", `Change this rival slot's Pokémon — currently ${member.name}`);
    buildRivalSpeciesOptions(rival, index).forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.name;
      opt.textContent = option.name;
      if (option.name === member.name) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => swapRivalMember(index, select.value));
    header.appendChild(select);

    if (isMega) {
      const megaTag = document.createElement("span");
      megaTag.className = "mega-badge";
      megaTag.textContent = "Mega Evolved";
      megaTag.title = `${member.name} holding ${build.item} — this slot is ${effective.name}.`;
      header.appendChild(megaTag);
    }

    const types = document.createElement("div");
    types.className = "card-types";
    (effective.types || member.types).forEach((type) => {
      const tag = document.createElement("span");
      tag.className = `type-tag type-${type.toLowerCase()}`;
      tag.textContent = type;
      types.appendChild(tag);
    });
    header.appendChild(types);

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
