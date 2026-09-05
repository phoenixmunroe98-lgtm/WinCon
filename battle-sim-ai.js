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
//
// Milestone 35, Task 3 — wcChooseAiMoveWeighted (bottom of this file) is a
// learnable sibling: every situational payoff below that wcSupportMoveScore/
// wcEvaluateDamagingMove used to hard-code as a bare number now lives in
// WC_DEFAULT_AI_WEIGHTS instead, threaded through as an optional trailing
// `weights` parameter. wcChooseAiMove's own body is untouched — it still
// calls these helpers with no weights argument, so it still runs on the
// exact same literal numbers as before, unconditionally. WC_DEFAULT_AI_WEIGHTS
// is that same set of numbers, just named and collected in one place, so
// data/policy-weights.json (a plain serialization of it) is a byte-for-byte
// faithful starting point for a weight search — see tools/selfplay-
// harness.mjs's --search mode. Nothing here is called by builder.js or
// battle-sim-worker.js except wcChooseAiMove itself; wcChooseAiMoveWeighted
// is dev-only, reachable only through the harness's policy registry.

const WC_STRUGGLE_MOVE = {
  name: "Struggle", type: "Normal", category: "Physical", power: 50, accuracy: null, priority: 0,
  target: "any-single", flags: { contact: true, protectable: true }, recoilFraction: 0.25,
};

/**
 * Milestone 35, Task 3 — every numeric payoff wcSupportMoveScore and
 * wcEvaluateDamagingMove used to hard-code inline, named and collected here.
 * These ARE the numbers wcChooseAiMove has always used (see each weight's
 * matching literal in this file's git history) — wcChooseAiMoveWeighted
 * called with this exact object makes identical decisions to wcChooseAiMove,
 * which is what makes it a safe starting point for a weight search rather
 * than a guess at reproducing the heuristic.
 *
 * tailwindAlreadyUpScore, trickRoomAlreadyUpScore, and statusUntargetableScore
 * are pinned at 0 and deliberately excluded from tools/selfplay-harness.mjs's
 * perturbable weight set (see WC_PERTURBABLE_AI_WEIGHT_KEYS there) — each is
 * the score for taking an already-redundant action (re-casting a field
 * effect that's already up, using a status move with no legal target), and
 * a search nudging one positive would be learning to reward wasting a turn,
 * not a real strategic discovery.
 *
 * Declared with `var`, not `const`: this file is loaded into a Node vm
 * context (see tools/selfplay-harness.mjs and the Web Worker's importScripts
 * equivalent), and only `var`/function declarations at a vm script's top
 * level become properties of that context's global object — a top-level
 * `const` stays purely lexical and is invisible to code outside that exact
 * vm.runInContext call. External tooling (the self-play harness's --search
 * mode, and its equivalence test) needs to read this exact object by name
 * from outside the context — e.g. to serialize it into data/policy-
 * weights.json — so it has to be a `var` here, same as every function in
 * this file already is.
 */
var WC_DEFAULT_AI_WEIGHTS = {
  expectedDamageWeight: 1,
  guaranteedKoBonus: 10000,
  protectLowHpScore: 60,
  protectHighHpScore: 15,
  protectRepeatMultiplier: 0.3,
  tailwindUpScore: 50,
  tailwindAlreadyUpScore: 0,
  trickRoomUpScore: 30,
  trickRoomAlreadyUpScore: 0,
  redirectAllyLowScore: 40,
  redirectDefaultScore: 20,
  helpingHandScore: 30,
  selfBoostHealthyScore: 35,
  selfBoostLowScore: 10,
  healLowHpScore: 40,
  healHighHpScore: 5,
  statusTargetableScore: 25,
  statusUntargetableScore: 0,
  hazardScore: 20,
  defaultSupportScore: 10,
  // Milestone 48: Light Screen/Reflect/Aurora Veil previously fell through
  // to defaultSupportScore like any uncovered status move -- no different
  // from, say, an unremarkable stat-drop move -- even though mechanically
  // they're now a real damage-halving field effect (see battle-sim-
  // engine.js's field.screens). screensAlreadyUpScore is pinned at 0 for
  // the same reason tailwindAlreadyUpScore/trickRoomAlreadyUpScore are --
  // recasting an already-active screen is a wasted turn, not a discovery
  // a weight search should be able to learn to reward.
  screensUpScore: 40,
  screensAlreadyUpScore: 0,
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
 *
 * `weights` (optional, defaults to WC_DEFAULT_AI_WEIGHTS — see Task 3's
 * header note) scales the accumulated expected-damage score and the
 * guaranteed-KO bonus. The guaranteed-KO check itself always uses the raw,
 * unweighted expected damage against the target's real HP — whether a hit
 * would actually KO is a fact about the battle, not something a scoring
 * weight should be able to change.
 */
function wcEvaluateDamagingMove(attacker, move, targets, field, data, restrictInfo, weights) {
  const w = weights || WC_DEFAULT_AI_WEIGHTS;
  let totalScore = 0;
  let anyGuaranteedKO = false;
  targets.forEach((target) => {
    if (!target || target.fainted) return;
    const accFactor = wcAccuracyFactor(move, attacker.stages.acc, target.stages.eva);
    const scoutedDefender = restrictInfo ? { ...target, ability: null, item: "" } : target;
    const estimate = wcResolveOneHit(attacker, move, scoutedDefender, field, data, wcEstimateRng);
    const expected = estimate.immune ? 0 : estimate.damage * accFactor;
    totalScore += expected * w.expectedDamageWeight;
    if (expected >= target.hp * 0.97) anyGuaranteedKO = true;
  });
  if (anyGuaranteedKO) totalScore += w.guaranteedKoBonus;
  return { score: totalScore, guaranteedKO: anyGuaranteedKO };
}

function wcBestSingleTarget(attacker, move, liveFoes, field, data, restrictInfo, weights) {
  let best = liveFoes[0];
  let bestScore = -Infinity;
  liveFoes.forEach((foe) => {
    const { score } = wcEvaluateDamagingMove(attacker, move, [foe], field, data, restrictInfo, weights);
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
 * baseline (`weights.defaultSupportScore`) rather than being unpickable.
 *
 * `weights` (optional, defaults to WC_DEFAULT_AI_WEIGHTS) supplies every
 * number below — see that constant's own doc comment.
 */
function wcSupportMoveScore(move, battler, allies, foes, field, weights) {
  const w = weights || WC_DEFAULT_AI_WEIGHTS;
  const isProtectMove = ["Protect", "Detect", "Baneful Bunker", "King's Shield", "Spiky Shield", "Wide Guard", "Quick Guard"].includes(move.name);
  if (isProtectMove) {
    const hpPct = battler.hp / battler.maxHp;
    const base = hpPct < 0.35 ? w.protectLowHpScore : w.protectHighHpScore;
    return battler.volatiles.protectStreak > 0 ? base * w.protectRepeatMultiplier : base;
  }
  if (move.fieldEffect && move.fieldEffect.type === "tailwind") return field.tailwindTurns[battler.side] > 0 ? w.tailwindAlreadyUpScore : w.tailwindUpScore;
  if (move.fieldEffect && move.fieldEffect.type === "trick-room") return field.trickRoomTurns > 0 ? w.trickRoomAlreadyUpScore : w.trickRoomUpScore;
  if (move.name === "Light Screen" || move.name === "Reflect" || move.name === "Aurora Veil") {
    const screens = field.screens && field.screens[battler.side];
    const alreadyCoversThis = Boolean(
      screens &&
        (move.name === "Aurora Veil"
          ? screens.physical > 0 && screens.special > 0
          : move.name === "Light Screen"
          ? screens.special > 0
          : screens.physical > 0)
    );
    return alreadyCoversThis ? w.screensAlreadyUpScore : w.screensUpScore;
  }
  if (move.name === "Follow Me" || move.name === "Rage Powder") {
    const alliesLow = allies.some((a) => a !== battler && !a.fainted && a.hp / a.maxHp < 0.4);
    return alliesLow ? w.redirectAllyLowScore : w.redirectDefaultScore;
  }
  if (move.name === "Helping Hand") return w.helpingHandScore;
  if (move.selfStatChange && move.selfStatChange.some((c) => c.stages > 0)) {
    return battler.hp / battler.maxHp > 0.6 ? w.selfBoostHealthyScore : w.selfBoostLowScore;
  }
  if (move.healFraction) return battler.hp / battler.maxHp < 0.6 ? w.healLowHpScore : w.healHighHpScore;
  if (move.statusInflicted) {
    const targetable = foes.some((f) => !f.fainted && !f.status);
    return targetable ? w.statusTargetableScore : w.statusUntargetableScore;
  }
  if (["Stealth Rock", "Spikes", "Toxic Spikes", "Sticky Web"].includes(move.name)) return w.hazardScore;
  return w.defaultSupportScore;
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
  // Milestone 48: a battler built for a specific detected game plan (see
  // wcBuildGamePlans/wcRoleWeightsFor, battle-sim-lineup.js) carries its
  // own roleWeights -- e.g. a Tailwind setter's own tailwindUpScore
  // boosted well above the generic default. Undefined for every battler
  // that isn't part of a plan (every reference/baseline opponent, every
  // existing Team-vs-Team or self-play-harness battler), in which case
  // every weights= argument below stays undefined and each helper falls
  // back to WC_DEFAULT_AI_WEIGHTS exactly as before -- this is a strict,
  // additive change to wcChooseAiMove, never a behavior change for a
  // battler with no roleWeights attached.
  const weights = battler.roleWeights || undefined;

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
      score = wcSupportMoveScore(move, battler, allies, foes, field, weights);
    } else if (move.target === "ally") {
      const target = liveAllies[0];
      if (!target) return;
      targets = [target];
      score = wcSupportMoveScore(move, battler, allies, foes, field, weights);
    } else if (move.category === "Status" && move.power === 0) {
      targets = move.target === "any-adjacent" || move.target === "all-adjacent-foes" ? liveFoes : [wcPickWeakestHp(liveFoes)];
      score = wcSupportMoveScore(move, battler, allies, foes, field, weights);
    } else {
      const isSpread = move.target === "all-adjacent-foes" || move.target === "all-adjacent";
      targets = isSpread ? liveFoes : [wcBestSingleTarget(battler, move, liveFoes, field, data, restrictInfo, weights)];
      const evaluated = wcEvaluateDamagingMove(battler, move, targets, field, data, restrictInfo, weights);
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

/**
 * Milestone 35, Task 3 — a learnable sibling to wcChooseAiMove. Identical
 * move-legality/target-selection scaffold (deliberately duplicated rather
 * than shared, so wcChooseAiMove above never has to change to support
 * this), but every call into wcSupportMoveScore/wcEvaluateDamagingMove/
 * wcBestSingleTarget passes `weights` through instead of leaving it
 * implicit — so the ONLY behavioral difference from wcChooseAiMove is
 * which numbers are attached to each situational score.
 *
 * Weight resolution order: `context.data.policyWeightsBySide[mySide]` (used
 * by tools/selfplay-harness.mjs's --search mode, which needs two different
 * weight sets active in the same battle — one per side), else
 * `context.data.policyWeights` (a single shared file, the normal case —
 * e.g. `--policy-a weighted` in the harness's non-search mode), else
 * WC_DEFAULT_AI_WEIGHTS. That default is what makes "no weights supplied"
 * a safe, defined fallback rather than a crash — this function called with
 * genuinely no configuration makes exactly the same decisions as
 * wcChooseAiMove.
 *
 * Never called by builder.js or battle-sim-worker.js — registered only by
 * the dev-only self-play harness as an alternative policy.
 */
function wcChooseAiMoveWeighted(battler, allies, foes, context) {
  const { data, field, rng, sheetMode, isFirstTurn, mySide } = context;
  const weights =
    (data.policyWeightsBySide && data.policyWeightsBySide[mySide]) ||
    data.policyWeights ||
    WC_DEFAULT_AI_WEIGHTS;

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
      score = wcSupportMoveScore(move, battler, allies, foes, field, weights);
    } else if (move.target === "ally") {
      const target = liveAllies[0];
      if (!target) return;
      targets = [target];
      score = wcSupportMoveScore(move, battler, allies, foes, field, weights);
    } else if (move.category === "Status" && move.power === 0) {
      targets = move.target === "any-adjacent" || move.target === "all-adjacent-foes" ? liveFoes : [wcPickWeakestHp(liveFoes)];
      score = wcSupportMoveScore(move, battler, allies, foes, field, weights);
    } else {
      const isSpread = move.target === "all-adjacent-foes" || move.target === "all-adjacent";
      targets = isSpread ? liveFoes : [wcBestSingleTarget(battler, move, liveFoes, field, data, restrictInfo, weights)];
      const evaluated = wcEvaluateDamagingMove(battler, move, targets, field, data, restrictInfo, weights);
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
