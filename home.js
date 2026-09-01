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

  const teamState = wcLoadTeamState();

  renderOverview(teamState);
  renderTopTeams(teamState);
  renderMostUsed(teamState);
  renderOwnedSection();
  wcHomeMountAddSearch();
  renderWishlist(teamState);
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

function homeGetObtainedSet() {
  try {
    const raw = localStorage.getItem(HOME_OBTAINED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function homeSaveObtainedSet(set) {
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
    obtained.add(name);
    homeSaveObtainedSet(obtained);
    input.value = "";
    closeSuggestions();
    renderOwnedSection();
    renderWishlist(wcLoadTeamState());
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

/** Every obtained Pokémon's `.types`, from both formats' TOP teams combined (see homeTopTeamOf) -- the reference "team so far" the wishlist scores candidates against. [] if neither format has a team with anything picked. */
function homeReferenceTeamTypes(teamState) {
  const typesList = [];
  ["singles", "doubles"].forEach((format) => {
    const team = homeTopTeamOf(teamState.teams.filter((t) => wcGetTeamFormat(t) === format));
    if (!team) return;
    (team.chosen || []).forEach((name) => {
      const p = homeData.pokemon.find((x) => x.name === name);
      if (p) typesList.push(p.types);
    });
  });
  return typesList;
}

function homeWishlistCandidates(teamTypesList) {
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
    .map((c) => ({ ...c, score: wcDreamTeamCandidateScore(c, teamTypesList, threats, homeData.typeChart, allTypes) }))
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
  const teamTypesList = homeReferenceTeamTypes(teamState);

  let names;
  if (teamTypesList.length === 0) {
    names = homeMegaRotation();
    noteEl.textContent =
      "You don't have a saved team with any Pokémon picked yet, so here's a rotation of Mega Pokémon to aim for instead — build a Singles or Doubles team to get suggestions tailored to it.";
  } else {
    names = homeWishlistCandidates(teamTypesList).map((c) => c.name);
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
