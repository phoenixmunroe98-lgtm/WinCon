// WinCon — Pokédex tracker (Milestone 0)
//
// This file does four jobs, in this order:
//   1. Fetch the Pokémon list from data/pokemon.json
//   2. Draw one card per Pokémon into #grid
//   3. Read/write "obtained" state to localStorage, so it survives a refresh
//   4. Wire up the search box and the two dropdown filters
//
// Nothing here talks to a server — localStorage is a small key/value store
// that the browser keeps for this one page, on this one device. That's the
// right amount of "saving" for Milestone 0. A real account/sync layer (so
// your progress follows you to another device) is a Phase 1 upgrade, once
// there's a backend to sync to.

const STORAGE_KEY = "wincon.obtained";

/** @type {{name: string, dexNumber: number, types: string[], form: string}[]} */
let allPokemon = [];

/** The full, unfiltered data/pokemon.json list (Mega forms included) — kept around only for looking up a base Pokémon's own Mega form names (see megas.js) for the "has a Mega form" note on its card. */
let fullPokemonList = [];

/** name -> "sprites/xyz.png", from data/sprites.json (Milestone 4). Missing entries just render without a sprite. */
let sprites = {};

/** Set of names the user has marked as obtained. Loaded from localStorage. */
let obtained = loadObtained();

const grid = document.getElementById("grid");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search");
const typeFilter = document.getElementById("type-filter");
const statusFilter = document.getElementById("status-filter");
const caughtCountEl = document.getElementById("caught-count");
const totalCountEl = document.getElementById("total-count");
const progressFillEl = document.getElementById("progress-fill");

init();

async function init() {
  const [pokemonList, spriteManifest] = await Promise.all([fetchJSON("data/pokemon.json"), fetchJSON("data/sprites.json")]);
  fullPokemonList = pokemonList;
  // Milestone 11: Mega forms are no longer tracked/obtained separately —
  // you obtain the base species, and its Mega form(s) (if any) become
  // available automatically in the Team Builder once you have. Filtering
  // them out of the tracker's own list (not just hiding them) keeps the
  // progress bar, search, and type filter all about the roster you can
  // actually check off one by one — see megas.js for the base<->Mega
  // relationship this and every other page now shares.
  allPokemon = pokemonList.filter((p) => !wcIsMegaForm(p));
  sprites = spriteManifest;
  totalCountEl.textContent = allPokemon.length;
  pruneLegacyMegaObtained();

  populateTypeFilter(allPokemon);
  render();

  searchInput.addEventListener("input", render);
  typeFilter.addEventListener("change", render);
  statusFilter.addEventListener("change", render);
}

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Couldn't load ${path} (${response.status})`);
  }
  return response.json();
}

function loadObtained() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    // If localStorage is unavailable (e.g. private browsing) or the saved
    // data is corrupted, fail safe with an empty set rather than crashing.
    return new Set();
  }
}

function saveObtained() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...obtained]));
  } catch {
    // Storage full or unavailable — the checkbox still works for this
    // session, it just won't persist. Not worth interrupting the user.
  }
}

/** One-time cleanup for anyone who obtained a Mega Pokémon directly before Milestone 11 removed that as an option — those entries just wouldn't render any more, but leaving them in localStorage would still make old saves technically wrong (e.g. a stale, inflated obtained count if this filtering logic ever changed). Silent — there's nothing for the player to do about it. */
function pruneLegacyMegaObtained() {
  const megaNames = new Set(fullPokemonList.filter((p) => wcIsMegaForm(p)).map((p) => p.name));
  let changed = false;
  obtained.forEach((name) => {
    if (megaNames.has(name)) {
      obtained.delete(name);
      changed = true;
    }
  });
  if (changed) saveObtained();
}

function populateTypeFilter(pokemonList) {
  const types = new Set();
  pokemonList.forEach((p) => p.types.forEach((t) => types.add(t)));
  [...types].sort().forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    typeFilter.appendChild(option);
  });
}

function render() {
  const query = searchInput.value.trim().toLowerCase();
  const typeQuery = typeFilter.value;
  const statusQuery = statusFilter.value;

  const visible = allPokemon.filter((p) => {
    const matchesQuery = p.name.toLowerCase().includes(query);
    const matchesType = !typeQuery || p.types.includes(typeQuery);
    const isObtained = obtained.has(p.name);
    const matchesStatus =
      statusQuery === "all" ||
      (statusQuery === "obtained" && isObtained) ||
      (statusQuery === "missing" && !isObtained);
    return matchesQuery && matchesType && matchesStatus;
  });

  grid.innerHTML = "";
  visible.forEach((p) => grid.appendChild(renderCard(p)));

  emptyState.hidden = visible.length > 0;
  updateProgress();
}

function renderCard(pokemon) {
  const isObtained = obtained.has(pokemon.name);

  const card = document.createElement("label");
  card.className = "card" + (isObtained ? " is-obtained" : "");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isObtained;
  checkbox.addEventListener("change", () => toggleObtained(pokemon.name, card));

  const spritePath = sprites[pokemon.name];
  let sprite = null;
  if (spritePath) {
    sprite = document.createElement("img");
    sprite.src = `data/${spritePath}`;
    sprite.alt = "";
    sprite.className = "card-sprite";
    sprite.loading = "lazy";
    sprite.addEventListener("error", () => sprite.remove());
  }

  const info = document.createElement("div");
  info.className = "card-info";

  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = pokemon.name;

  const types = document.createElement("div");
  types.className = "card-types";
  pokemon.types.forEach((type) => {
    const tag = document.createElement("span");
    tag.className = `type-tag type-${type.toLowerCase()}`;
    tag.textContent = type;
    types.appendChild(tag);
  });

  info.append(name, types);

  const megaForms = wcMegaFormsOf(fullPokemonList, pokemon.name);
  if (megaForms.length > 0) {
    const megaNote = document.createElement("div");
    megaNote.className = "card-mega-note";
    megaNote.textContent = `Has ${megaForms.length > 1 ? "Mega forms" : "a Mega form"} (${megaForms.map((m) => m.name).join(", ")}) — available in the Team Builder once obtained.`;
    info.appendChild(megaNote);
  }

  card.append(checkbox);
  if (sprite) card.append(sprite);
  card.append(info);
  return card;
}

function toggleObtained(name, cardEl) {
  if (obtained.has(name)) {
    obtained.delete(name);
    cardEl.classList.remove("is-obtained");
  } else {
    obtained.add(name);
    cardEl.classList.add("is-obtained");
  }
  saveObtained();
  updateProgress();
}

function updateProgress() {
  caughtCountEl.textContent = obtained.size;
  const percent = allPokemon.length ? (obtained.size / allPokemon.length) * 100 : 0;
  progressFillEl.style.width = `${percent}%`;
}
