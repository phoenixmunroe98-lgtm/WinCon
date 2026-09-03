// WinCon — battle-sim-ai.js (Simulated Win Rate)
//
// Chooses what each simulated battler does on its turn. This is
// deliberately NOT perfect play (no minimax/lookahead across the whole
// battle) — it's a competent, explainable heuristic: score every legal
// move (damaging moves by real expected damage, support moves by a
// small set of situational rules) and take the best-scoring one, with a
// guaranteed-KO always taking priority. That's enough to make the Monte
// Carlo win rate meaningful (both sides play sensibly) without building
// a second, much larger project (a real battle AI). Both "my" side and
// the simulated opponent side use this exact same function — the only
// asymmetry is `sheetMode` (see wcChooseAiMove), which is a property of
// the matchup, not of one side being smarter than the other.
//
// Reuses wcResolveOneHit (battle-sim-engine.js) with a fixed rng that
// always returns 0.5 for its EV estimate — that's the same damage
// formula real execution uses, just without a real random draw or a
// crit, so planning and execution can never quietly drift apart into two
// different formulas.

const WC_STRUGGLE_MOVE = {
  name: "Struggle", type: "Normal", category: "Physical", power: 50, accuracy: null, priority: 0,
  target: "any-single", flags: { contact: true, protectable: true }, recoilFraction: 0.25,
};

function wcEstimateRng() {
  return 0.5;
}

function wcAccuracyFactor(move, accStage, evaStage) {
  if (move.accuracy == null) return 1;
  return Math.min(1, (move.accuracy * wcAccuracyStageMultiplier(accStage, evaStage)) / 100);
}

function wcPickWeakestHp(list) {
  return list.reduce((weakest, candidate) => ((candidate.hp / candidate.maxHp <= weakest.hp / weakest.maxHp) ? candidate : weakest));
}

/**
 * Expected-value score for one damaging move against one or more targets
 * (a spread move sums across all live targets it would hit). `restrictInfo`
 * is the sheetMode simplification: true only for the opponent AI's very
 * first move of the battle under a Closed Team Sheet, and strips the
 * defender's ability/item from the estimate (not from real execution —
 * see wcExecuteMove) to approximate "hasn't seen this exact set yet."
 */
function wcEvaluateDamagingMove(attacker, move, targets, field, data, restrictInfo) {
  let totalScore = 0;
  let anyGuaranteedKO = false;
  targets.forEach((target) => {
    if (!target || target.fainted) return;
    const accFactor = wcAccuracyFactor(move, attacker.stages.acc, target.stages.eva);
    const scoutedDefender = restrictInfo ? { ...target, ability: null, item: "" } : target;
    const estimate = wcResolveOneHit(attacker, move, scoutedDefender, field, data, wcEstimateRng);
    const expected = estimate.immune ? 0 : estimate.damage * accFactor;
    totalScore += expected;
    if (expected >= target.hp * 0.97) anyGuaranteedKO = true;
  });
  if (anyGuaranteedKO) totalScore += 10000;
  return { score: totalScore, guaranteedKO: anyGuaranteedKO };
}

function wcBestSingleTarget(attacker, move, liveFoes, field, data, restrictInfo) {
  let best = liveFoes[0];
  let bestScore = -Infinity;
  liveFoes.forEach((foe) => {
    const { score } = wcEvaluateDamagingMove(attacker, move, [foe], field, data, restrictInfo);
    if (score > bestScore) {
      bestScore = score;
      best = foe;
    }
  });
  return best;
}

/**
 * A hand-picked situational score for non-damaging moves, roughly on the
 * same numeric scale as a typical mid-power damaging move's EV (see the
 * header comment) so the two compete fairly in wcChooseAiMove's unified
 * ranking. Not exhaustive — an uncovered status move still gets a modest
 * baseline (1) rather than being unpickable.
 */
function wcSupportMoveScore(move, battler, allies, foes, field) {
  const isProtectMove = ["Protect", "Detect", "Baneful Bunker", "King's Shield", "Spiky Shield", "Wide Guard", "Quick Guard"].includes(move.name);
  if (isProtectMove) {
    const hpPct = battler.hp / battler.maxHp;
    const base = hpPct < 0.35 ? 60 : 15;
    return battler.volatiles.protectStreak > 0 ? base * 0.3 : base;
  }
  if (move.fieldEffect && move.fieldEffect.type === "tailwind") return field.tailwindTurns[battler.side] > 0 ? 0 : 50;
  if (move.fieldEffect && move.fieldEffect.type === "trick-room") return field.trickRoomTurns > 0 ? 0 : 30;
  if (move.name === "Follow Me" || move.name === "Rage Powder") {
    const alliesLow = allies.some((a) => a !== battler && !a.fainted && a.hp / a.maxHp < 0.4);
    return alliesLow ? 40 : 20;
  }
  if (move.name === "Helping Hand") return 30;
  if (move.selfStatChange && move.selfStatChange.some((c) => c.stages > 0)) {
    return battler.hp / battler.maxHp > 0.6 ? 35 : 10;
  }
  if (move.healFraction) return battler.hp / battler.maxHp < 0.6 ? 40 : 5;
  if (move.statusInflicted) {
    const targetable = foes.some((f) => !f.fainted && !f.status);
    return targetable ? 25 : 0;
  }
  if (["Stealth Rock", "Spikes", "Toxic Spikes", "Sticky Web"].includes(move.name)) return 20;
  return 10;
}

/**
 * @param battler The actor choosing a move.
 * @param allies This actor's own side's active battlers (includes itself).
 * @param foes The opposing side's active battlers.
 * @param context { data, field, rng, sheetMode, isFirstTurn, mySide }.
 *   `mySide` is "me" or "opp" — which side `battler` is on, used only to
 *   decide whether the sheetMode restriction applies (it only ever
 *   restricts the simulated opponent's knowledge of the user's real
 *   team, never the reverse).
 * @returns { move, targets } — targets is an array of live battler
 *   objects (possibly empty for a self/field move), or { move: null,
 *   targets: [] } if this battler has nothing legal to do (fainted, or
 *   no live foes left this instant).
 */
function wcChooseAiMove(battler, allies, foes, context) {
  const { data, field, rng, sheetMode, isFirstTurn, mySide } = context;
  if (battler.fainted) return { move: null, targets: [] };
  const restrictInfo = mySide === "opp" && isFirstTurn && sheetMode === "closed";

  let legalMoves = battler.moves;
  const itemEffect = wcItemEffect(battler, data.itemEffects);
  if (itemEffect && itemEffect.lockMove && battler.volatiles.choiceLockedMove) {
    const locked = legalMoves.find((m) => m.name === battler.volatiles.choiceLockedMove);
    if (locked) legalMoves = [locked];
  }
  if (itemEffect && itemEffect.statusMoveLocked) {
    const damagingOnly = legalMoves.filter((m) => m.category !== "Status");
    if (damagingOnly.length > 0) legalMoves = damagingOnly;
  }
  if (legalMoves.length === 0) legalMoves = [WC_STRUGGLE_MOVE];

  const liveFoes = foes.filter((f) => !f.fainted);
  if (liveFoes.length === 0) return { move: null, targets: [] };
  const liveAllies = allies.filter((a) => a !== battler && !a.fainted);

  let best = null;
  legalMoves.forEach((move) => {
    let targets;
    let score;
    let guaranteedKO = false;

    if (move.target === "self" || move.target === "self-side" || move.name === "Follow Me" || move.name === "Rage Powder") {
      targets = move.target === "self" ? [battler] : [];
      score = wcSupportMoveScore(move, battler, allies, foes, field);
    } else if (move.target === "ally") {
      const target = liveAllies[0];
      if (!target) return;
      targets = [target];
      score = wcSupportMoveScore(move, battler, allies, foes, field);
    } else if (move.category === "Status" && move.power === 0) {
      targets = move.target === "any-adjacent" || move.target === "all-adjacent-foes" ? liveFoes : [wcPickWeakestHp(liveFoes)];
      score = wcSupportMoveScore(move, battler, allies, foes, field);
    } else {
      const isSpread = move.target === "all-adjacent-foes" || move.target === "all-adjacent";
      targets = isSpread ? liveFoes : [wcBestSingleTarget(battler, move, liveFoes, field, data, restrictInfo)];
      const evaluated = wcEvaluateDamagingMove(battler, move, targets, field, data, restrictInfo);
      score = evaluated.score;
      guaranteedKO = evaluated.guaranteedKO;
    }

    score += rng() * 0.01; // tiny jitter so exact ties don't always resolve the same way
    if (!best || score > best.score) best = { move, targets, score, guaranteedKO };
  });

  if (best && itemEffect && itemEffect.lockMove && !battler.volatiles.choiceLockedMove) {
    battler.volatiles.choiceLockedMove = best.move.name;
  }
  return best || { move: null, targets: [] };
}
