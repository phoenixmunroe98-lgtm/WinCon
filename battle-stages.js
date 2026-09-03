// WinCon — battle-stages.js (Simulated Win Rate)
//
// Real Pokémon stat-stage multiplier tables (-6..+6). The battle simulator
// (battle-sim-*.js) uses these to turn a computed base stat (from stats.js's
// wcCalcStat) into the stat actually in play during a simulated turn, once
// battle-only stage boosts/drops (Swords Dance, Intimidate, Tailwind's own
// effective-Speed doubling handled separately by the engine, etc.) apply.
// Nothing like this existed anywhere in WinCon before this feature —
// wcScoreMatchup (strategy.js) only ever compared raw, unboosted stats.
//
// Two separate tables, both real Pokémon-game formulas (not WinCon
// inventions): the 5 standard battle stats (Atk/Def/SpA/SpD/Spe) use the
// classic (2+n)/2 boost / 2/(2-n) drop table; accuracy/evasion use a
// shallower (3+n)/3 / 3/(3-n) table, and combine the attacker's accuracy
// stage with the defender's evasion stage into one effective stage first.

const WC_STAGE_TABLE = {
  "-6": 2 / 8, "-5": 2 / 7, "-4": 2 / 6, "-3": 2 / 5, "-2": 2 / 4, "-1": 2 / 3,
  "0": 1,
  "1": 3 / 2, "2": 4 / 2, "3": 5 / 2, "4": 6 / 2, "5": 7 / 2, "6": 8 / 2,
};

const WC_ACC_STAGE_TABLE = {
  "-6": 3 / 9, "-5": 3 / 8, "-4": 3 / 7, "-3": 3 / 6, "-2": 3 / 5, "-1": 3 / 4,
  "0": 1,
  "1": 4 / 3, "2": 5 / 3, "3": 6 / 3, "4": 7 / 3, "5": 8 / 3, "6": 9 / 3,
};

/** Clamps a stat stage into the real -6..+6 battle range. */
function wcClampStage(n) {
  return Math.max(-6, Math.min(6, n || 0));
}

/** Multiplier for one of the 5 standard battle stats at a given stage. */
function wcStageMultiplier(stage) {
  return WC_STAGE_TABLE[String(wcClampStage(stage))];
}

/**
 * Accuracy is the one stat where both sides matter: the attacker's own
 * accuracy stage and the defender's evasion stage combine into a single
 * effective stage (accStage - evaStage) before the shallower table applies.
 */
function wcAccuracyStageMultiplier(accStage, evaStage) {
  return WC_ACC_STAGE_TABLE[String(wcClampStage((accStage || 0) - (evaStage || 0)))];
}

/**
 * Applies a stage to an already-computed (Level 50 + Stat Points + nature,
 * per stats.js's wcCalcStat) stat. Never rounds below 1 — a Pokémon's
 * effective stat can't hit zero from stat drops alone.
 */
function wcApplyStatStage(computedStat, stage) {
  return Math.max(1, Math.floor(computedStat * wcStageMultiplier(stage)));
}
