// WinCon — Homepage dashboard.
//
// index.html used to BE the Pokédex tracker; that page moved to
// pokedex.html unchanged, and this file is what actually runs on the new
// front door. Nothing here owns any data of its own — it's read-only over
// state other pages already write: saved teams and their match logs
// (teams.js, written by builder.js) and the obtained-Pokémon set (the
// same "wincon.obtained" localStorage key app.js/builder.js use). This
// page adds exactly one write path of its own: the small search box that
// adds a Pokémon straight to your Pokédex without leaving this page.
//
// Six pieces, each with its own render function below:
//   1. Overall win/loss record — every logged match, every saved team,
//      both formats combined.
//   2. Your best Singles team and best Doubles team — "best" = highest
//      logged win rate; a team with no logged record loses to any team
//      that has one; among ties (including "nobody has a record"), the
//      most recently CREATED team wins, since a team's local storage
//      shape has no last-edited timestamp to sort by (see wcTopTeamOf's
//      own comment).
//   3. Your 5 most-used Pokémon — by how many saved teams (any format)
//      they're picked onto, not by any team's performance.
//   4. An obtained-Pokémon carousel, with a search box that adds to your
//      Pokédex right here.
//   5. A "Wishlist" carousel: not-yet-obtained Pokémon that would most
//      improve your best team(s)' matchup against the same reference
//      threat list Matchup Score/Dream Team use — literally
//      wcDreamTeamCandidateScore from strategy.js, run against your
//      EXISTING team instead of building a new one. With no saved team
//      to improve, this instead rotates the roster's Mega Pokémon as a
//      neutral showcase, per the explicit fallback this was asked for.

const HOME_OBTAINED_KEY = "wincon.obtained";

/** Milestone 27: while signed out, marking obtained (via the search box below) is capped at 6 -- same free-preview limit as pokedex.html's own tracker. */
const WC_OBTAINED_FREE_LIMIT = 6;

let homeData = null; // { pokemon, baseStats, sprites, threats, typeChart }
let homeNonMegaPokemon = [];

init();

async function init() {
  const [pokemon, baseStats, sprites, threats, typeChart] = await Promise.all([
    fetchJSON("data/pokemon.json"),
    fetchJSON("data/base-stats.json"),
    fetchJSON("data/sprites.json"),
    fetchJSON("data/starter-threats.json"),
    fetchJSON("data/type-chart.json"),
  ]);
  homeData = { pokemon, baseStats, sprites, threats, typeChart };
  homeNonMegaPokemon = pokemon.filter((p) => !wcIsMegaForm(p));

  await homeRenderAccountSections();
  wcHomeMountAddSearch();

  // Milestone 26: re-render the account-derived sections the moment
  // sign-in state changes (sign in, sign out, or the initial session check
  // resolving after this page's own first render already ran
  // signed-out-by-default) -- same pattern as builder.js's own
  // wc:auth-changed listener. Guarded on homeInitDone since this listener
  // is registered once at module load and can fire before this init() has
  // finished its own first render.
  window.addEventListener("wc:auth-changed", () => {
    if (!homeInitDone) return;
    homeRenderAccountSections();
  });

  homeInitDone = true;
}

/** Set once init()'s first render has completed -- see the wc:auth-changed listener above, registered before this can be guaranteed true. */
let homeInitDone = false;

/**
 * Milestone 26: true only once a direct Supabase session check (not the
 * possibly-not-yet-resolved window.wcAuth.isSignedIn()) has confirmed
 * there's really a signed-in account right now. wcHomeMountAddSearch()'s
 * own wishlist re-render below reads this instead of re-checking directly,
 * so it stays in sync with whatever homeRenderAccountSections() last
 * decided rather than risking a second, differently-timed check.
 */
let homeTeamDataSignedIn = false;

/**
 * Milestone 27: true only once the same direct Supabase session check
 * (shared with homeTeamDataSignedIn -- see homeRenderAccountSections()
 * below, which computes it once for both) has confirmed there's really a
 * signed-in account right now. Gates whether the obtained-Pokémon
 * carousel/progress bar show real saved data, and whether the free
 * 6-Pokémon cap applies to the "add to Pokédex" search box -- mirrors
 * pokedex.html's own wcObtainedSignedIn in app.js.
 */
let homeObtainedSignedIn = false;

/**
 * Milestone 22: home.js never saves a team itself, but still awaits the
 * cloud merge here (rather than the plain local-only read wcHomeMountAddSearch()
 * uses for its own quick wishlist refresh below) so the overview/top-teams/
 * wishlist sections reflect teams saved from another device, not just this
 * browser's own history.
 *
 * Milestone 26: also confirms, via wcHasRealSession() (a direct Supabase
 * check -- see its own comment in teams.js), whether there's really a
 * signed-in session before showing any of that data at all. Without a
 * confirmed real session this renders a completely empty team state
 * instead -- so a Pokémon/team history saved during an earlier signed-in
 * session on this device (or, shared computer, a different account's
 * entirely) never shows up on the homepage while signed out.
 *
 * Milestone 27: the same confirmed-session boolean now also drives the
 * obtained-Pokémon carousel/progress bar (renderOwnedSection()) -- reusing
 * one wcHasRealSession() check for both rather than asking twice. Any
 * Pokémon marked obtained via the search box while signed out (sitting in
 * sessionStorage -- see homeGetObtainedSet()'s own comment) get folded
 * into the real saved set the moment a real session is confirmed here, the
 * same non-destructive merge wcSyncObtainedForAuth() does in app.js -- a
 * flat set can only ever gain entries this way, never silently overwrite
 * anything.
 */
async function homeRenderAccountSections() {
  const rawTeamState = await wcLoadAndSyncTeamState();
  const signedIn = await wcHasRealSession();
  homeTeamDataSignedIn = signedIn;
  if (signedIn) {
    const sessionObtained = homeLoadSignedOutObtained();
    if (sessionObtained.size > 0) {
      homeObtainedSignedIn = true; // so homeGetObtainedSet() below reads real storage
      const stored = homeGetObtainedSet();
      sessionObtained.forEach((name) => stored.add(name));
      homeSaveObtainedSet(stored);
      try {
        sessionStorage.removeItem(HOME_OBTAINED_KEY);
      } catch {
        // ignore
      }
    }
  }
  homeObtainedSignedIn = signedIn;
  const teamState = homeTeamDataSignedIn ? rawTeamState : wcEmptyTeamState();

  renderOverview(teamState);
  renderTopTeams(teamState);
  renderMostUsed(teamState);
  renderWishlist(teamState);
  renderOwnedSection();
}

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Couldn't load ${path} (${response.status})`);
  return response.json();
}

function homeSpriteImg(name, className) {
  const spritePath = homeData.sprites[name];
  const img = document.createElement("img");
  img.alt = name;
  img.loading = "lazy";
  if (className) img.className = className;
  if (spritePath) {
    img.src = `data/${spritePath}`;
    img.addEventListener("error", () => img.remove());
  }
  return img;
}

/**
 * Milestone 27: while signed out, this reads sessionStorage instead of the
 * real, long-lived localStorage -- same read-leak fix Milestone 26 applied
 * to team data, applied here to the obtained-Pokémon set every section on
 * this page derives from (the carousel, the progress bar, and the
 * wishlist's "what's not obtained yet" scoring). sessionStorage rather
 * than an in-memory variable specifically so a Pokémon marked obtained via
 * the Pokédex tracker page (app.js) while signed out shows up here too,
 * and vice versa, as long as it's the same browser tab/session -- see
 * app.js's wcLoadSignedOutObtained() for the fuller reasoning.
 */
function homeGetObtainedSet() {
  if (!homeObtainedSignedIn) return homeLoadSignedOutObtained();
  try {
    const raw = localStorage.getItem(HOME_OBTAINED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function homeLoadSignedOutObtained() {
  try {
    const raw = sessionStorage.getItem(HOME_OBTAINED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

/** Milestone 27: while signed out, saves to sessionStorage instead of persisting to localStorage (see homeGetObtainedSet()'s comment) -- addPokemon() below is what actually enforces the free 6-Pokémon cap before this is ever called. */
function homeSaveObtainedSet(set) {
  if (!homeObtainedSignedIn) {
    try {
      sessionStorage.setItem(HOME_OBTAINED_KEY, JSON.stringify([...set]));
    } catch {
      // ignore -- this page view's search box still works, it just won't
      // carry over to another page.
    }
    return true;
  }
  try {
    localStorage.setItem(HOME_OBTAINED_KEY, JSON.stringify([...set]));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1. Overall win/loss record
// ---------------------------------------------------------------------------

function homeOverallRecord(teamState) {
  let wins = 0;
  let losses = 0;
  teamState.teams.forEach((t) => {
    (t.matchLog || []).forEach((entry) => {
      if (entry.result === "win") wins += 1;
      else if (entry.result === "loss") losses += 1;
    });
  });
  const total = wins + losses;
  return { wins, losses, total, winRate: total > 0 ? Math.round((wins / total) * 100) : null };
}

function renderOverview(teamState) {
  const record = homeOverallRecord(teamState);
  const valueEl = document.getElementById("home-winrate");
  const subEl = document.getElementById("home-winrate-sub");
  if (record.total === 0) {
    valueEl.textContent = "—";
    subEl.textContent = "No matches logged yet — log a result on either Builder page's tracker.";
  } else {
    valueEl.textContent = `${record.winRate}%`;
    subEl.textContent = `${record.wins}W – ${record.losses}L across ${record.total} logged game${record.total === 1 ? "" : "s"}, both formats combined.`;
  }
}

// ---------------------------------------------------------------------------
// 2. Top Singles/Doubles team
// ---------------------------------------------------------------------------

/** The numeric creation time embedded in a locally-generated team id (`team-<ms>-<n>`) — the closest thing to a "how recent" signal this data model has, since a team has no last-edited timestamp. 0 for anything else (e.g. a legacy-migrated team's id, or any future id shape), so those just sort as "oldest". */
function homeTeamCreationTime(team) {
  const match = /^team-(\d+)-/.exec(team.id || "");
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Picks the "top" team out of every team saved for one format: the
 * highest logged win rate wins outright; a team with a logged record
 * always beats one without; among ties (including "neither has logged
 * anything yet"), the most recently created team wins. Returns null if
 * `teamsForFormat` is empty.
 */
function homeTopTeamOf(teamsForFormat) {
  let best = null;
  let bestSummary = null;
  teamsForFormat.forEach((team) => {
    const summary = wcMatchRecordSummary(team);
    if (!best) {
      best = team;
      bestSummary = summary;
      return;
    }
    const hasData = summary.winRate !== null;
    const bestHasData = bestSummary.winRate !== null;
    if (hasData && !bestHasData) {
      best = team;
      bestSummary = summary;
      return;
    }
    if (!hasData && bestHasData) return;
    if (hasData && bestHasData && summary.winRate !== bestSummary.winRate) {
      if (summary.winRate > bestSummary.winRate) {
        best = team;
        bestSummary = summary;
      }
      return;
    }
    // Tied on win rate (or both have none) — recency breaks the tie.
    if (homeTeamCreationTime(team) > homeTeamCreationTime(best)) {
      best = team;
      bestSummary = summary;
    }
  });
  return best;
}

function renderTopTeams(teamState) {
  renderOneTopTeam("singles", teamState);
  renderOneTopTeam("doubles", teamState);
}

function renderOneTopTeam(format, teamState) {
  const teams = teamState.teams.filter((t) => wcGetTeamFormat(t) === format);
  const team = homeTopTeamOf(teams);

  const nameEl = document.getElementById(`home-${format}-name`);
  const slotsEl = document.getElementById(`home-${format}-slots`);
  const recordEl = document.getElementById(`home-${format}-record`);
  const emptyEl = document.getElementById(`home-${format}-empty`);
  slotsEl.innerHTML = "";

  if (!team) {
    nameEl.textContent = "";
    recordEl.textContent = "";
    slotsEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.innerHTML = `No ${format === "singles" ? "Singles" : "Doubles"} team saved yet. <a href="${format}-builder.html">Build one →</a>`;
    return;
  }

  slotsEl.hidden = false;
  emptyEl.hidden = true;
  nameEl.textContent = team.name;

  const chosen = team.chosen || [];
  if (chosen.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "No Pokémon picked onto this team yet.";
    slotsEl.appendChild(p);
  } else {
    chosen.forEach((name) => {
      const slot = document.createElement("div");
      slot.className = "home-team-slot";
      slot.appendChild(homeSpriteImg(name, "home-team-slot-sprite"));
      const label = document.createElement("span");
      label.className = "home-team-slot-name";
      label.textContent = name;
      slot.appendChild(label);
      slotsEl.appendChild(slot);
    });
    if (chosen.length < 6) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = `${chosen.length}/6 picked so far.`;
      slotsEl.appendChild(note);
    }
  }

  const summary = wcMatchRecordSummary(team);
  recordEl.textContent =
    summary.total === 0
      ? "No matches logged yet."
      : `${summary.wins}W – ${summary.losses}L (${summary.winRate}% win rate) across ${summary.total} logged game${summary.total === 1 ? "" : "s"}.`;
}

// ---------------------------------------------------------------------------
// 3. Most-used Pokémon
// ---------------------------------------------------------------------------

function homeMostUsedPokemon(teamState, limit) {
  const counts = new Map();
  teamState.teams.forEach((team) => {
    (team.chosen || []).forEach((name) => {
      counts.set(name, (counts.get(name) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function renderMostUsed(teamState) {
  const listEl = document.getElementById("home-most-used-list");
  const emptyEl = document.getElementById("home-most-used-empty");
  const ranked = homeMostUsedPokemon(teamState, 5);
  listEl.innerHTML = "";

  if (ranked.length === 0) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }

  listEl.hidden = false;
  emptyEl.hidden = true;
  ranked.forEach((entry, i) => {
    const li = document.createElement("li");
    li.className = "home-ranked-item";
    const rank = document.createElement("span");
    rank.className = "home-ranked-number";
    rank.textContent = String(i + 1);
    li.appendChild(rank);
    li.appendChild(homeSpriteImg(entry.name, "home-ranked-sprite"));
    const name = document.createElement("span");
    name.className = "home-ranked-name";
    name.textContent = entry.name;
    li.appendChild(name);
    const count = document.createElement("span");
    count.className = "home-ranked-count";
    count.textContent = `on ${entry.count} team${entry.count === 1 ? "" : "s"}`;
    li.appendChild(count);
    listEl.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// 4. Obtained-Pokémon carousel + add-to-Pokédex search
// ---------------------------------------------------------------------------

function renderOwnedSection() {
  const obtained = homeGetObtainedSet();
  const total = homeNonMegaPokemon.length;
  document.getElementById("home-total-count").textContent = total;
  document.getElementById("home-caught-count").textContent = obtained.size;
  document.getElementById("home-progress-fill").style.width = `${total ? (obtained.size / total) * 100 : 0}%`;
  updateHomeObtainedLockHint(obtained);

  const carousel = document.getElementById("home-owned-carousel");
  const emptyEl = document.getElementById("home-owned-empty");
  const ownedNames = homeNonMegaPokemon.filter((p) => obtained.has(p.name)).map((p) => p.name);

  if (ownedNames.length === 0) {
    carousel.hidden = true;
    emptyEl.hidden = false;
    if (homeOwnedCarousel) homeOwnedCarousel.stop();
    return;
  }

  carousel.hidden = false;
  emptyEl.hidden = true;
  homeOwnedCarousel = wcMountCarousel(carousel, ownedNames, (name) => homeCarouselItem(name));
}

function homeCarouselItem(name) {
  const item = document.createElement("div");
  item.className = "home-carousel-item";
  item.appendChild(homeSpriteImg(name, "home-carousel-sprite"));
  const label = document.createElement("span");
  label.className = "home-carousel-name";
  label.textContent = name;
  item.appendChild(label);
  return item;
}

let homeOwnedCarousel = null;

function wcHomeMountAddSearch() {
  const input = document.getElementById("home-add-search-input");
  const suggestionsEl = document.getElementById("home-add-suggestions");

  function closeSuggestions() {
    suggestionsEl.hidden = true;
    suggestionsEl.innerHTML = "";
  }

  function addPokemon(name) {
    const obtained = homeGetObtainedSet();
    // Milestone 27: same free 6-Pokémon preview as pokedex.html's own
    // toggleObtained() in app.js -- this quick-add box is a second entry
    // point to the same obtained set, so it needs the same cap.
    if (!homeObtainedSignedIn && obtained.size >= WC_OBTAINED_FREE_LIMIT) {
      wcShowAccountPopup(
        `Sign up free to mark more than ${WC_OBTAINED_FREE_LIMIT} Pokémon obtained — it only takes a minute, and your progress follows you to any device once you're signed in.`
      );
      return;
    }
    obtained.add(name);
    homeSaveObtainedSet(obtained);
    input.value = "";
    closeSuggestions();
    renderOwnedSection();
    // Milestone 26: mirrors homeRenderAccountSections()'s own gate -- this
    // quick refresh intentionally skips the cloud-merge round trip (see the
    // Milestone 22 comment above homeRenderAccountSections()), but must
    // still not show real team data while signed out.
    renderWishlist(homeTeamDataSignedIn ? wcLoadTeamState() : wcEmptyTeamState());
  }

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    suggestionsEl.innerHTML = "";
    if (!query) {
      closeSuggestions();
      return;
    }
    const obtained = homeGetObtainedSet();
    const matches = homeNonMegaPokemon.filter((p) => !obtained.has(p.name) && p.name.toLowerCase().includes(query)).slice(0, 8);

    if (matches.length === 0) {
      const li = document.createElement("li");
      li.className = "home-add-suggestion-empty";
      li.textContent = "No match (or you already have it).";
      suggestionsEl.appendChild(li);
      suggestionsEl.hidden = false;
      return;
    }

    matches.forEach((p) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "home-add-suggestion-item";
      button.appendChild(homeSpriteImg(p.name, "home-add-suggestion-sprite"));
      const label = document.createElement("span");
      label.textContent = p.name;
      button.appendChild(label);
      button.addEventListener("click", () => addPokemon(p.name));
      li.appendChild(button);
      suggestionsEl.appendChild(li);
    });
    suggestionsEl.hidden = false;
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSuggestions();
  });

  // A click landing inside the suggestions list is handled by each
  // button's own listener above; anything else closes the dropdown.
  // Delayed slightly so a suggestion's own click still registers first.
  document.addEventListener("click", (e) => {
    if (e.target === input || suggestionsEl.contains(e.target)) return;
    closeSuggestions();
  });
}

// ---------------------------------------------------------------------------
// 5. Wishlist
// ---------------------------------------------------------------------------

function homeThreatsWithTypes() {
  return homeData.threats.map((t) => {
    const p = homeData.pokemon.find((x) => x.name === t.name);
    return { ...t, types: p ? p.types : [] };
  });
}

/**
 * Every obtained Pokémon from both formats' TOP teams combined (see
 * homeTopTeamOf), shaped as `{ types }` objects -- the reference "team so
 * far" the wishlist scores candidates against. [] if neither format has a
 * team with anything picked.
 *
 * Milestone 21 note: wcDreamTeamCandidateScore's `team` argument does
 * `team.map((m) => m.types)` internally (it expects team MEMBER objects,
 * not a bare list of type arrays) -- this used to return the bare type
 * arrays directly, which silently produced a list of `undefined` once
 * Milestone 21 shipped, and crashed the Wishlist section the moment a
 * real team existed (`.reduce` on `undefined` deeper inside the scoring
 * chain). Wrapping each entry in `{ types }` here is the fix.
 */
function homeReferenceTeamMembers(teamState) {
  const members = [];
  ["singles", "doubles"].forEach((format) => {
    const team = homeTopTeamOf(teamState.teams.filter((t) => wcGetTeamFormat(t) === format));
    if (!team) return;
    (team.chosen || []).forEach((name) => {
      const p = homeData.pokemon.find((x) => x.name === name);
      if (p) members.push({ types: p.types });
    });
  });
  return members;
}

function homeWishlistCandidates(teamMembers) {
  const threats = homeThreatsWithTypes();
  const allTypes = homeData.typeChart.types;
  const obtained = homeGetObtainedSet();

  const candidates = [];
  homeNonMegaPokemon.forEach((p) => {
    if (obtained.has(p.name)) return;
    const baseStats = homeData.baseStats.find((b) => b.name === p.name);
    if (!baseStats) return;
    candidates.push({ name: p.name, types: p.types, baseStats });
  });

  return candidates
    .map((c) => ({ ...c, score: wcDreamTeamCandidateScore(c, teamMembers, threats, homeData.typeChart, allTypes) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function homeMegaRotation() {
  return homeData.pokemon.filter((p) => wcIsMegaForm(p)).map((p) => p.name);
}

let homeWishlistCarousel = null;

function renderWishlist(teamState) {
  const noteEl = document.getElementById("home-wishlist-note");
  const carousel = document.getElementById("home-wishlist-carousel");
  const teamMembers = homeReferenceTeamMembers(teamState);

  let names;
  if (teamMembers.length === 0) {
    names = homeMegaRotation();
    noteEl.textContent =
      "You don't have a saved team with any Pokémon picked yet, so here's a rotation of Mega Pokémon to aim for instead — build a Singles or Doubles team to get suggestions tailored to it.";
  } else {
    names = homeWishlistCandidates(teamMembers).map((c) => c.name);
    noteEl.textContent =
      "Not-yet-obtained Pokémon ranked by how much they'd improve your top team's matchup against WinCon's reference threat list (the same one Matchup Score and Generate Dream Team use) — offense, defense, and covering types your team doesn't already answer well.";
    if (names.length === 0) {
      // Every eligible (has confirmed base-stat data) Pokémon is already obtained.
      names = homeMegaRotation();
      noteEl.textContent = "You already have every Pokémon with confirmed data — here's a rotation of Mega Pokémon instead.";
    }
  }

  if (homeWishlistCarousel) homeWishlistCarousel.stop();
  homeWishlistCarousel = wcMountCarousel(carousel, names, (name) => homeCarouselItem(name));
}

// ---------------------------------------------------------------------------
// Small auto-advancing carousel, shared by the owned and wishlist sections.
// No library — a horizontally scrolling flex track with scroll-snap, plus
// prev/next buttons and a timer that scrolls by one item, wrapping around
// at either end. Pauses while hovered or focused so it never fights a
// visitor trying to read or click something in it.
// ---------------------------------------------------------------------------

function wcMountCarousel(container, items, renderItem, options) {
  const opts = options || {};
  const intervalMs = opts.intervalMs || 3200;
  const track = container.querySelector(".home-carousel-track");
  const prevBtn = container.querySelector(".home-carousel-prev");
  const nextBtn = container.querySelector(".home-carousel-next");

  track.innerHTML = "";
  items.forEach((item) => track.appendChild(renderItem(item)));

  function stepWidth() {
    const first = track.firstElementChild;
    if (!first) return 0;
    const style = getComputedStyle(track);
    const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
    return first.getBoundingClientRect().width + gap;
  }

  function advance(direction) {
    const width = stepWidth();
    if (!width) return;
    const atEnd = direction > 0 && track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    const atStart = direction < 0 && track.scrollLeft <= 2;
    if (atEnd) track.scrollTo({ left: 0, behavior: "smooth" });
    else if (atStart) track.scrollTo({ left: track.scrollWidth, behavior: "smooth" });
    else track.scrollBy({ left: direction * width, behavior: "smooth" });
  }

  let timer = null;
  function start() {
    stop();
    if (items.length > 1) timer = setInterval(() => advance(1), intervalMs);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  if (prevBtn) prevBtn.onclick = () => advance(-1);
  if (nextBtn) nextBtn.onclick = () => advance(1);
  container.onmouseenter = stop;
  container.onmouseleave = start;
  container.onfocusin = stop;
  container.onfocusout = start;

  start();
  return { start, stop };
}

/** Milestone 27: the "sign in to keep more than 6" hint above this section's search box, mirrored on the full Pokédex tracker (pokedex.html). */
function updateHomeObtainedLockHint(obtained) {
  const el = document.getElementById("home-obtained-lock-hint");
  if (!el) return;
  el.hidden = homeObtainedSignedIn;
  if (homeObtainedSignedIn) return;
  el.textContent =
    obtained.size >= WC_OBTAINED_FREE_LIMIT
      ? `${WC_OBTAINED_FREE_LIMIT} of ${WC_OBTAINED_FREE_LIMIT} free obtained slots used — sign in or sign up to mark more, and to keep this list instead of losing it when you leave.`
      : `Sign in or sign up to mark more than ${WC_OBTAINED_FREE_LIMIT} Pokémon obtained — everything you check off here is lost when you leave unless you're signed in.`;
}

// ---------------------------------------------------------------------------
// Milestone 27: shared sign-in-required popup -- mirrors builder.js's own
// wcEnsureAccountPopupEl/wcShowAccountPopup/wcHideAccountPopup (and
// app.js's identical copy for pokedex.html), reusing the same
// .wc-account-popup CSS classes from styles.css.
// ---------------------------------------------------------------------------
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
    <p class="wc-account-popup-body"></p>
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

function wcShowAccountPopup(message) {
  const el = wcEnsureAccountPopupEl();
  el.querySelector(".wc-account-popup-body").textContent = message;
  el.hidden = false;
  if (wcAccountPopupTimer) clearTimeout(wcAccountPopupTimer);
  wcAccountPopupTimer = setTimeout(wcHideAccountPopup, 7000);
}
