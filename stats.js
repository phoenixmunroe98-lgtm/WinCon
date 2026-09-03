// WinCon — shared stat math
//
// Used by both matchup-score.js (to know how strong a built Pokémon really
// is) and strategy.js (to decide what a good build looks like). Kept in one
// place so the two never quietly drift apart.
//
// Honesty note, repeated from matchup-score.html: this is the standard
// Pokémon stat formula with Stat Points treated as roughly EV/8 (so 32 SP
// ≈ 252 EV). Cross-checked against two independent Pokémon Champions
// mechanics guides while researching Showdown-format import/export
// (Milestone 29): Champions really does replace EVs/IVs with exactly this
// Stat Points system (66 total, 32/stat cap, IVs fixed at 31 for every
// Pokémon), and each SP is worth ~8 of the old EV-style points under the
// hood — so this was never an approximation that needed fixing, just an
// as-yet-uncited one. Still not sourced from an official Game Freak/
// Pokémon Company document, so kept as "well-corroborated" rather than
// "confirmed."
//
// Milestone 29 also added the reverse direction (wcEvToSp) and the label
// tables below, both needed to translate a WinCon build to and from the
// plain-text set format the rest of the competitive community shares
// teams in (Pokémon Showdown's export format) — see wcExportTeamText/
// wcParseShowdownTeam in builder.js.

const WINCON_LEVEL = 50;
const WINCON_IV = 31; // fixed in Champions

/** WinCon's build.sp keys, in the fixed order every stat list/EV line uses, alongside the label Showdown's text format uses for each and the abbreviated key data/base-stats.json uses for each (see wcEvToSp/wcSpToEv above and wcCalcStat below). */
const WINCON_STAT_ORDER = [
  { key: "hp", showdownLabel: "HP", baseStatKey: "hp" },
  { key: "attack", showdownLabel: "Atk", baseStatKey: "atk" },
  { key: "defense", showdownLabel: "Def", baseStatKey: "def" },
  { key: "sp_attack", showdownLabel: "SpA", baseStatKey: "spa" },
  { key: "sp_defense", showdownLabel: "SpD", baseStatKey: "spd" },
  { key: "speed", showdownLabel: "Spe", baseStatKey: "spe" },
];

function wcSpToEv(sp) {
  return Math.min(252, (sp || 0) * 8);
}

/** The reverse of wcSpToEv, for reading a pasted Showdown-format set's `EVs:` line back into WinCon's Stat Points — rounds to the nearest SP rather than floors, so a pasted "252 Atk" (the real, common max) round-trips to the true 32 SP cap instead of landing one short at 31. */
function wcEvToSp(ev) {
  const clampedEv = Math.max(0, Math.min(252, ev || 0));
  return Math.max(0, Math.min(32, Math.round(clampedEv / 8)));
}

function wcNatureModifier(natureName, statKey, natures) {
  const nature = natures.find((n) => n.name === natureName);
  if (!nature || !nature.increasedStat) return 1;
  if (nature.increasedStat === statKey) return 1.1;
  if (nature.decreasedStat === statKey) return 0.9;
  return 1;
}

function wcCalcStat(base, statKey, sp, natureName, natures) {
  const ev = wcSpToEv(sp);
  if (statKey === "hp") {
    return Math.floor(((2 * base + WINCON_IV + Math.floor(ev / 4)) * WINCON_LEVEL) / 100 + WINCON_LEVEL + 10);
  }
  const raw = Math.floor(((2 * base + WINCON_IV + Math.floor(ev / 4)) * WINCON_LEVEL) / 100 + 5);
  return Math.floor(raw * wcNatureModifier(natureName, statKey, natures));
}
