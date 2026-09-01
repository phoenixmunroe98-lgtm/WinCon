// WinCon — Mega Pokémon derivation (Milestone 11)
//
// Until this milestone, every "Mega X" entry in data/pokemon.json (75 of
// them) was a fully independent, separately-obtainable roster entry — its
// own Pokédex tracker checkbox, its own Team Builder picker chip, its own
// build slot. That's not how Mega Evolution actually works in-game: you
// obtain the BASE Pokémon, and it only becomes its Mega form mid-battle by
// holding that species' own Mega Stone. This file is the single source of
// truth for that relationship, used by app.js (tracker), builder.js (the
// Singles/Doubles Builder pages, formerly team-builder.js + matchup-score.js
// — see builder.js's own Milestone 14 header comment), and strategy.js so
// none of them can drift apart on it.
//
// A base species and its Mega form(s) always share the same `dexNumber` in
// pokemon.json; the base entry itself is the one with `form === "Base"`
// (not just "not a Mega form" — a couple of species also have a `Regional`
// form sharing that dexNumber, e.g. Slowbro/Galarian Slowbro, and Mega
// Slowbro's own stats/typing match the plain `Base` entry, not the
// Regional one). Verified programmatically: all 75 Mega-like entries
// (`form` of `Mega`, `Mega X`, or `Mega Y`) resolve to exactly one `Base`
// entry sharing their dexNumber — see data/AUDIT.md.
//
// Every function here is pure (no DOM) so it can be tested with plain Node
// against the real data files, same as strategy.js.

/** True if this pokemon.json entry is some Mega form (plain "Mega", or the split "Mega X"/"Mega Y" forms a couple of species use). */
function wcIsMegaForm(pokemon) {
  return Boolean(pokemon && typeof pokemon.form === "string" && pokemon.form.indexOf("Mega") === 0);
}

/**
 * Species name -> the Mega Stone item that actually belongs to it (derived
 * straight from each stone's own "If held by a/an X, this item allows it to
 * Mega Evolve in battle." text in data/items.json — see data/AUDIT.md for
 * how this was built and verified: every one of the 75 Mega-like roster
 * entries resolves to exactly one real stone this way). Moved here from
 * strategy.js in Milestone 11 since the tracker and Team Builder now need
 * it too, not just the auto-build engine.
 */
const WINCON_MEGA_STONES = {
  "Mega Venusaur": "Venusaurite", "Mega Charizard X": "Charizardite X", "Mega Charizard Y": "Charizardite Y",
  "Mega Blastoise": "Blastoisinite", "Mega Beedrill": "Beedrillite", "Mega Pidgeot": "Pidgeotite",
  "Mega Raichu X": "Raichunite X", "Mega Raichu Y": "Raichunite Y", "Mega Clefable": "Clefablite",
  "Mega Alakazam": "Alakazite", "Mega Victreebel": "Victreebelite", "Mega Slowbro": "Slowbronite",
  "Mega Gengar": "Gengarite", "Mega Kangaskhan": "Kangaskhanite", "Mega Starmie": "Starminite",
  "Mega Pinsir": "Pinsirite", "Mega Gyarados": "Gyaradosite", "Mega Aerodactyl": "Aerodactylite",
  "Mega Dragonite": "Dragoninite", "Mega Meganium": "Meganiumite", "Mega Feraligatr": "Feraligite",
  "Mega Ampharos": "Ampharosite", "Mega Steelix": "Steelixite", "Mega Scizor": "Scizorite",
  "Mega Heracross": "Heracronite", "Mega Skarmory": "Skarmorite", "Mega Houndoom": "Houndoominite",
  "Mega Tyranitar": "Tyranitarite", "Mega Sceptile": "Sceptilite", "Mega Blaziken": "Blazikenite",
  "Mega Swampert": "Swampertite", "Mega Gardevoir": "Gardevoirite", "Mega Sableye": "Sablenite",
  "Mega Mawile": "Mawilite", "Mega Aggron": "Aggronite", "Mega Medicham": "Medichamite",
  "Mega Manectric": "Manectite", "Mega Sharpedo": "Sharpedonite", "Mega Camerupt": "Cameruptite",
  "Mega Altaria": "Altarianite", "Mega Banette": "Banettite", "Mega Chimecho": "Chimechite",
  "Mega Absol": "Absolite", "Mega Glalie": "Glalitite", "Mega Metagross": "Metagrossite",
  "Mega Staraptor": "Staraptite", "Mega Lopunny": "Lopunnite", "Mega Garchomp": "Garchompite",
  "Mega Lucario": "Lucarionite", "Mega Abomasnow": "Abomasite", "Mega Gallade": "Galladite",
  "Mega Froslass": "Froslassite", "Mega Emboar": "Emboarite", "Mega Excadrill": "Excadrite",
  "Mega Audino": "Audinite", "Mega Scolipede": "Scolipite", "Mega Scrafty": "Scraftinite",
  "Mega Eelektross": "Eelektrossite", "Mega Chandelure": "Chandelurite", "Mega Golurk": "Golurkite",
  "Mega Chesnaught": "Chesnaughtite", "Mega Delphox": "Delphoxite", "Mega Greninja": "Greninjite",
  "Mega Pyroar": "Pyroarite", "Mega Floette": "Floettite", "Mega Meowstic": "Meowsticite",
  "Mega Malamar": "Malamarite", "Mega Barbaracle": "Barbaracite", "Mega Dragalge": "Dragalgite",
  "Mega Hawlucha": "Hawluchanite", "Mega Crabominable": "Crabominite", "Mega Drampa": "Drampanite",
  "Mega Falinks": "Falinksite", "Mega Scovillain": "Scovillainite", "Mega Glimmora": "Glimmoranite",
};

/** Every Mega-form roster entry belonging to this base species' dexNumber ([] if `baseName` isn't a base-form Pokémon, or it has no Mega form). `pokemonList` is the raw data/pokemon.json array. */
function wcMegaFormsOf(pokemonList, baseName) {
  const base = pokemonList.find((p) => p.name === baseName && p.form === "Base");
  if (!base) return [];
  return pokemonList.filter((p) => wcIsMegaForm(p) && p.dexNumber === base.dexNumber);
}

/** The base-species roster entry for a Mega form's name, or null if `megaName` isn't a Mega form (or its base can't be found). */
function wcBaseFormOf(pokemonList, megaName) {
  const mega = pokemonList.find((p) => p.name === megaName && wcIsMegaForm(p));
  if (!mega) return null;
  return pokemonList.find((p) => p.dexNumber === mega.dexNumber && p.form === "Base") || null;
}

/**
 * The Pokémon a team slot should actually be treated as, given the base
 * species it was picked as (`baseName`) and whatever item its build
 * currently holds: its Mega form if that item is exactly the Mega Stone
 * belonging to one of `baseName`'s own Mega forms, otherwise the base
 * form itself. This is the one function every consumer (Team Builder's
 * slot cards, Matchup Score's stat/type lookups, strategy.js's build
 * generator) should call rather than re-deriving this relationship —
 * "Mega-ness" is a live, item-driven property of a slot, not a separate
 * pick, so nothing should cache it past a build's current `item` value.
 */
function wcEffectivePokemon(pokemonList, baseName, item) {
  const base = pokemonList.find((p) => p.name === baseName);
  if (!base) return null;
  const trimmedItem = (item || "").trim();
  if (!trimmedItem) return base;
  const megaForms = wcMegaFormsOf(pokemonList, baseName);
  const match = megaForms.find(
    (m) => WINCON_MEGA_STONES[m.name] && WINCON_MEGA_STONES[m.name].toLowerCase() === trimmedItem.toLowerCase()
  );
  return match || base;
}
