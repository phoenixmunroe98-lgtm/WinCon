// WinCon — shared stat math
//
// Used by both matchup-score.js (to know how strong a built Pokémon really
// is) and strategy.js (to decide what a good build looks like). Kept in one
// place so the two never quietly drift apart.
//
// Honesty note, repeated from matchup-score.html: this is the standard
// Pokémon stat formula with Stat Points treated as roughly EV/8 (so 32 SP
// ≈ 252 EV). The community dataset's own mechanics notes say the exact
// SP-to-stat mapping in Champions is still unverified — this is the best
// available approximation, not a confirmed-accurate one.

const WINCON_LEVEL = 50;
const WINCON_IV = 31; // fixed in Champions

function wcSpToEv(sp) {
  return Math.min(252, (sp || 0) * 8);
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
