// WinCon — Pokédex tracker (Milestone 0)
//
// This file does four jobs, in this order:
//   1. Fetch the Pokémon list from data/pokemon.json
//   2. Draw one card per Pokémon into #grid
//   3. Read/write "obtained" state, so it survives a refresh
//   4. Wire up the search box and the two dropdown filters
//
// Nothing here talks to a server — localStorage is a small key/value store
// that the browser keeps for this one page, on this one device. That's the
// right amount of "saving" for Milestone 0. A real account/sync layer (so
// your progress follows you to another device) is a Phase 1 upgrade, once
// there's a backend to sync to.
//
// Milestone 27: "obtained" state is no longer always localStorage. A
// signed-in account's marks still live there, same as always. A
// signed-out visitor's marks (capped at 6 -- see WC_OBTAINED_FREE_LIMIT
// below) live in sessionStorage instead, under the same key: that keeps
// "mark up to 6 here, then pick them in the Team Builder" working across
// that page navigation within one visit, while still forgetting itself
// once this browser tab/session ends, and never showing whatever a
// previous signed-in session (or a different account on a shared
// computer) left in the real localStorage. See wcSyncObtainedForAuth() and
// wcLoadSignedOutObtained() below for the full mechanics.

const STORAGE_KEY = "wincon.obtained";

/** @type {{name: string, dexNumber: number, types: string[], form: string}[]} */
let allPokemon = [];

/** The full, unfiltered data/pokemon.json list (Mega forms included) — kept around only for looking up a base Pokémon's own Mega form names (see megas.js) for the "has a Mega form" note on its card. */
let fullPokemonList = [];

/** name -> "sprites/xyz.png", from data/sprites.json (Milestone 4). Missing entries just render without a sprite. */
let sprites = {};

/**
 * Set of names the user has marked as obtained.
 *
 * Milestone 27: this used to be loaded straight from localStorage
 * unconditionally, the same read-leak Milestone 26 fixed for team data --
 * a signed-out visitor (or a different account on a shared computer) could
 * still see, and keep adding to, whatever had already been marked obtained
 * during an earlier signed-in session on this device. Starts blank here;
 * wcSyncObtainedForAuth() (called from init() and on every wc:auth-changed
 * event) decides whether to load the real saved set or keep this blank,
 * exactly like wcSyncTeamStateForAuth() does for team data in builder.js.
 */
let obtained = new Set();

/**
 * Milestone 27: true only once a direct Supabase session check (not the
 * possibly-not-yet-resolved window.wcAuth.isSignedIn()) has confirmed
 * there's really a signed-in account right now. Gates both whether
 * `obtained` gets persisted at all (see saveObtained()) and the free
 * 6-Pokémon cap on marking anything obtained while signed out (see
 * toggleObtained()) -- matches the same free-preview-then-sign-up shape
 * the Team Builder pages already use for picking a team.
 */
let wcObtainedSignedIn = false;

/** Milestone 27: while signed out, marking obtained is capped at 6 -- same free-preview limit as picking a team. */
const WC_OBTAINED_FREE_LIMIT = 6;

const grid = document.getElementById("grid");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search");
const typeFilter = document.getElementById("type-filter");
const statusFilter = document.getElementById("status-filter");
const caughtCountEl = document.getElementById("caught-count");
const totalCountEl = document.getElementById("total-count");
const progressFillEl = document.getElementById("progress-fill");
const progressCursorEl = document.getElementById("progress-cursor");
const progressCursorSpriteEl = document.getElementById("progress-cursor-sprite");

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

  // Milestone 27: decides whether `obtained` loads the real saved set or
  // stays blank, before anything below reads it.
  await wcSyncObtainedForAuth();
  pruneLegacyMegaObtained();

  populateTypeFilter(allPokemon);
  render();

  searchInput.addEventListener("input", render);
  typeFilter.addEventListener("change", render);
  statusFilter.addEventListener("change", render);

  // Milestone 27: re-syncs on every sign-in/sign-out, live -- e.g. a
  // signed-out visitor who marks up to 6 obtained and then signs up right
  // here keeps those 6 (merged into their account) rather than losing them;
  // signing out clears the grid back to blank. Also covers what the
  // pre-existing listener below used to handle on its own (the progress
  // cursor depending on the profile's avatar, resolved asynchronously).
  window.addEventListener("wc:auth-changed", async () => {
    await wcSyncObtainedForAuth();
    render();
  });
}

/**
 * Milestone 27: mirrors wcSyncTeamStateForAuth() in builder.js, but for the
 * flat obtained-Pokémon set rather than named teams. Since this is just a
 * Set (not a named team someone might already be relying on), merging is
 * always safe here -- unlike teams, there's no "silently overwrite an
 * existing save" risk to avoid, so any signed-out, in-progress obtained
 * marks always get folded into the real saved set the moment a real
 * session is confirmed, rather than only when the account had nothing yet.
 */
async function wcSyncObtainedForAuth() {
  wcObtainedSignedIn = await wcHasRealSession();
  if (wcObtainedSignedIn) {
    const stored = loadObtained();
    const sessionObtained = wcLoadSignedOutObtained();
    sessionObtained.forEach((name) => stored.add(name));
    obtained = stored;
    saveObtained();
    // Merged into the real account now -- nothing left for a later
    // signed-out visit in this tab to see.
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  } else {
    obtained = wcLoadSignedOutObtained();
  }
}

/**
 * Milestone 27: a signed-out visitor's obtained marks live in
 * sessionStorage, not localStorage -- deliberately, so that the "select up
 * to 6 on the Pokédex, then pick those same 6 in the Team Builder" flow
 * (both are separate page loads) still works within one visit, while a
 * brand new browser session (tab/window closed and reopened, or a
 * different device) never sees them. This is why marking obtained while
 * signed out survives a plain page reload but a fresh visit later starts
 * blank -- unlike the Team Builder's own in-progress picks, which are
 * pure in-memory (see wcSyncTeamStateForAuth() in builder.js) because
 * that flow never needs to survive a page navigation. builder.js's own
 * getObtainedNames() reads from the exact same sessionStorage key while
 * signed out, so a Pokémon marked here really does show up there.
 */
function wcLoadSignedOutObtained() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function wcSaveSignedOutObtained(set) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Storage full/unavailable — the checkbox still works for this page
    // view, it just won't carry over to another page. Not worth
    // interrupting the user.
  }
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
  // Milestone 27: never write to the real, long-lived localStorage while
  // signed out -- this is what actually makes a signed-out visitor's marks
  // forgotten once this browser tab/session ends, matching the same rule
  // Milestone 26 applies to team data. They still get saved to
  // sessionStorage instead (see wcSaveSignedOutObtained()), which is what
  // lets "mark obtained here, then pick them in the Team Builder" keep
  // working across that page navigation within this one visit.
  if (!wcObtainedSignedIn) {
    wcSaveSignedOutObtained(obtained);
    return;
  }
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
  updateObtainedLockHint();
}

function renderCard(pokemon) {
  const isObtained = obtained.has(pokemon.name);

  const card = document.createElement("label");
  card.className = "card" + (isObtained ? " is-obtained" : "");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isObtained;
  checkbox.addEventListener("change", () => toggleObtained(pokemon.name, card, checkbox));

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

function toggleObtained(name, cardEl, checkboxEl) {
  if (obtained.has(name)) {
    obtained.delete(name);
    cardEl.classList.remove("is-obtained");
    saveObtained();
    updateProgress();
    updateObtainedLockHint();
    return;
  }

  // Milestone 27: signed-out visitors get the same free 6-Pokémon preview
  // the Team Builder pages already offer for picking a team, not unlimited
  // tracking -- sign up to keep going past that.
  if (!wcObtainedSignedIn && obtained.size >= WC_OBTAINED_FREE_LIMIT) {
    checkboxEl.checked = false;
    wcShowAccountPopup(
      `Sign up free to mark more than ${WC_OBTAINED_FREE_LIMIT} Pokémon obtained — it only takes a minute, and your progress follows you to any device once you're signed in.`
    );
    return;
  }

  obtained.add(name);
  cardEl.classList.add("is-obtained");
  saveObtained();
  updateProgress();
  updateObtainedLockHint();
}

/** Milestone 27: the "sign in to keep more than 6" hint above the grid, mirrored on the homepage's own Pokédex section. */
const obtainedLockHintEl = document.getElementById("obtained-lock-hint");

function updateObtainedLockHint() {
  if (!obtainedLockHintEl) return;
  obtainedLockHintEl.hidden = wcObtainedSignedIn;
  if (wcObtainedSignedIn) return;
  obtainedLockHintEl.textContent =
    obtained.size >= WC_OBTAINED_FREE_LIMIT
      ? `${WC_OBTAINED_FREE_LIMIT} of ${WC_OBTAINED_FREE_LIMIT} free obtained slots used — sign in or sign up to mark more, and to keep this list instead of losing it when you leave.`
      : `Sign in or sign up to mark more than ${WC_OBTAINED_FREE_LIMIT} Pokémon obtained — everything you check off here is lost when you leave unless you're signed in.`;
}

function updateProgress() {
  caughtCountEl.textContent = obtained.size;
  const percent = allPokemon.length ? (obtained.size / allPokemon.length) * 100 : 0;
  progressFillEl.style.width = `${percent}%`;
  updateProgressCursor(percent);
}

/**
 * Moves the little sprite marker at the progress bar's leading edge to
 * match the current fill percentage, using whatever Pokémon the signed-in
 * user picked as their account avatar (see auth.js's avatar picker/
 * profiles.avatar_species). Hidden entirely — bar looks exactly like it
 * always has — whenever nobody's signed in or a signed-in account hasn't
 * picked an avatar yet, rather than showing some placeholder sprite.
 */
function updateProgressCursor(percent) {
  if (!progressCursorEl) return;
  const profile = window.wcAuth && window.wcAuth.isSignedIn() && window.wcAuth.getProfile();
  const species = profile && profile.avatar_species;
  const spritePath = species && sprites[species];
  if (!spritePath) {
    progressCursorEl.hidden = true;
    return;
  }
  progressCursorSpriteEl.src = `data/${spritePath}`;
  progressCursorSpriteEl.alt = species;
  progressCursorEl.style.left = `${percent}%`;
  progressCursorEl.hidden = false;
}

// Milestone 27: the progress-cursor re-check this used to do on its own
// (the avatar cursor depends on the profile, resolved asynchronously after
// this page's first render) now happens as part of init()'s own
// wc:auth-changed listener above, via its render() -> updateProgress() ->
// updateProgressCursor() chain -- kept as one listener instead of two so
// the obtained-set sync always runs first.

// ---------------------------------------------------------------------------
// Milestone 27: shared sign-in-required popup (mirrors builder.js's own
// wcEnsureAccountPopupEl/wcShowAccountPopup/wcHideAccountPopup, reusing the
// same .wc-account-popup CSS classes from styles.css) -- duplicated here
// rather than imported since this page doesn't otherwise share any code
// with builder.js, and the whole thing is a dozen lines.
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
