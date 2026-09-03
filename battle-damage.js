// WinCon — battle-damage.js (Simulated Win Rate)
//
// The real Pokémon damage formula, plus the accuracy check that gates it.
// Nothing like this existed anywhere in WinCon before this feature —
// wcScoreMatchup (strategy.js) only ever compared typing/Speed, never
// computed an actual damage number. Reuses the type chart exactly as-is
// via type-utils.js's wcEffectivenessOf (data/type-chart.json needs no
// changes for this feature).
//
// Every function here takes an injectable `rng` (default Math.random) so
// battle-sim-engine.js's Monte Carlo runs use real randomness while tests
// can pass a seeded/fixed rng for deterministic assertions.

/** Base critical-hit chance by crit stage (0 = no crit-boosting factor in play; 1 = a high-crit-ratio move or one stage of Focus Energy; stages stack). Real Pokémon-game table. */
const WC_CRIT_STAGE_RATES = { 0: 1 / 24, 1: 1 / 8, 2: 1 / 2, 3: 1 };

function wcCritChance(critStage) {
  const stage = Math.max(0, Math.min(3, critStage || 0));
  return WC_CRIT_STAGE_RATES[stage];
}

/**
 * STAB: 1.5x if the move's type matches one of the attacker's own types
 * (the WINCON_ALWAYS_STAB_ABILITIES case — Protean/Libero — is applied by
 * the caller before this, since it changes the attacker's own type rather
 * than the multiplier).
 */
function wcStabMultiplier(attackerTypes, moveType) {
  return (attackerTypes || []).includes(moveType) ? 1.5 : 1;
}

/**
 * One damage roll for a single hit of a damaging move.
 *
 * @param opts.level Battler level (always 50 in Champions — stats.js's WINCON_LEVEL).
 * @param opts.power The move's base power (data/moves.json's `power`).
 * @param opts.attackStat The attacker's already stage/ability/item-modified Atk or SpA.
 * @param opts.defenseStat The defender's already stage/ability/item-modified Def or SpD.
 * @param opts.category "Physical" | "Special" — Status moves should never reach this function.
 * @param opts.moveType The move's type (for STAB + type-effectiveness).
 * @param opts.attackerTypes The attacker's current types (for STAB).
 * @param opts.defenderTypes The defender's current types (for type-effectiveness).
 * @param opts.typeChart data/type-chart.json.
 * @param opts.isSpread True if this hit is landing as part of a spread move in Doubles (0.75x).
 * @param opts.weatherModifier Extra multiplier from weather (e.g. 1.5 sun-boosted Fire, 0.5 rain-weakened Fire) — 1 if none/not curated.
 * @param opts.extraModifiers Array of additional multipliers already resolved by the caller from ability-effects.json/item-effects.json (e.g. Life Orb's 1.3x, an ability's damage-dealt/taken multiplier) — multiplied in as-is.
 * @param opts.burnHalves True if the attacker is burned, the move is Physical, and no ability (e.g. Guts) cancels the halving.
 * @param opts.critStage See wcCritChance.
 * @param opts.rng Injectable RNG, default Math.random.
 * @returns { damage, isCrit, typeMod } — damage is 0 only on a type immunity (typeMod === 0); otherwise always >= 1.
 */
function wcCalcDamage(opts) {
  const {
    level = 50, power, attackStat, defenseStat, category,
    moveType, attackerTypes, defenderTypes, typeChart,
    isSpread = false, weatherModifier = 1, extraModifiers = [],
    burnHalves = false, critStage = 0, rng = Math.random,
  } = opts;

  const typeMod = wcBestTypeModifierForDamage(typeChart, moveType, defenderTypes);
  if (typeMod === 0) return { damage: 0, isCrit: false, typeMod };

  const isCrit = rng() < wcCritChance(critStage);
  const base = Math.floor(Math.floor((((2 * level) / 5 + 2) * power * attackStat) / defenseStat) / 50) + 2;
  const targetsMod = isSpread ? 0.75 : 1;
  const critMod = isCrit ? 1.5 : 1;
  const randMod = (85 + Math.floor(rng() * 16)) / 100; // 16 discrete rolls, 0.85..1.00
  const stabMod = wcStabMultiplier(attackerTypes, moveType);
  const burnMod = burnHalves && category === "Physical" ? 0.5 : 1;
  const extraMod = extraModifiers.reduce((mult, m) => mult * (m || 1), 1);

  const damage = Math.max(
    1,
    Math.floor(base * targetsMod * weatherModifier * critMod * randMod * stabMod * typeMod * burnMod * extraMod)
  );
  return { damage, isCrit, typeMod };
}

/** Thin wrapper so battle-damage.js doesn't need type-utils.js loaded in a specific order — falls back to a neutral 1x if the chart/type is missing rather than throwing mid-simulation. */
function wcBestTypeModifierForDamage(typeChart, moveType, defenderTypes) {
  if (!typeChart || !moveType || !defenderTypes) return 1;
  return wcEffectivenessOf(typeChart, moveType, defenderTypes);
}

/**
 * Accuracy check for one move use. `moveAccuracy` null/undefined (status
 * moves that list no accuracy in data/moves.json) always hits — matches
 * how the real games treat those moves' own listed effects (they still
 * apply their own separate rules, e.g. a still-inaccurate secondary
 * effect, which is out of scope for this fidelity level).
 */
function wcAccuracyRoll(moveAccuracy, accStage, evaStage, rng) {
  const roll = rng || Math.random;
  if (moveAccuracy == null) return true;
  const chance = Math.min(100, moveAccuracy * wcAccuracyStageMultiplier(accStage, evaStage));
  return roll() * 100 < chance;
}
