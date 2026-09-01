// WinCon — shared type-effectiveness helpers
//
// Used by matchup-score.js (scoring a team against reference threats) and
// strategy.js (picking moves that hit those same threats hard).

function wcEffectivenessOf(typeChart, attackType, defenderTypes) {
  const row = typeChart.chart[attackType];
  if (!row) return 1;
  return defenderTypes.reduce((mult, defType) => mult * (row[defType] ?? 1), 1);
}

/** Best (highest) effectiveness across a list of attacking types. */
function wcBestEffectiveness(typeChart, attackTypes, defenderTypes) {
  return Math.max(...attackTypes.map((t) => wcEffectivenessOf(typeChart, t, defenderTypes)));
}
