// WinCon — battle-turn-order.js (Simulated Win Rate)
//
// Resolves the order actors act in during one simulated turn: priority
// bracket first, then effective Speed, then a real coin-flip for ties.
// Nothing like this existed anywhere in WinCon before this feature —
// wcScoreMatchup (strategy.js) only ever compared two Pokémon's raw
// Speed as a single boolean ("outspeeds"), never read a move's
// `priority` field (data/moves.json has it; it was simply never
// consumed), and never resolved a real multi-actor turn.
//
// This function only orders — it doesn't compute effectiveSpeed itself.
// The caller (battle-sim-engine.js) is responsible for baking stat
// stages, paralysis (0.5x), and Tailwind (2x, side-wide) into each
// actor's effectiveSpeed before calling this.

/**
 * @param actors Array of { id, priority, effectiveSpeed, side, slotIndex }.
 *   Doubles passes up to 4 actors per turn (2 per side); Singles passes 2.
 * @param rng Injectable RNG, default Math.random — used only to break
 *   real speed ties, so tests can force a specific tie-break outcome.
 * @returns A new array, `actors` sorted fastest-effective-turn-order first.
 */
function wcResolveTurnOrder(actors, rng) {
  const roll = rng || Math.random;
  return [...actors].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.effectiveSpeed !== b.effectiveSpeed) return b.effectiveSpeed - a.effectiveSpeed;
    return roll() < 0.5 ? -1 : 1;
  });
}

/** Paralysis halves Speed; Tailwind doubles it for the whole side while active. Composed here so every caller applies them the same way and order (stage first, then status, then field). */
function wcEffectiveSpeed(stageAppliedSpeed, opts) {
  const options = opts || {};
  let speed = stageAppliedSpeed;
  if (options.paralyzed) speed = Math.floor(speed * 0.5);
  if (options.tailwind) speed = Math.floor(speed * 2);
  return Math.max(1, speed);
}
