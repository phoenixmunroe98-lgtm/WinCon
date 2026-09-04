// WinCon — battle-sim-engine.js (Simulated Win Rate)
//
// The battle simulator's core: turning a built team into live "battler"
// state, resolving one full simulated battle turn by turn, and Monte
// Carlo-aggregating many such battles into a win rate. This is entirely
// new — nothing like it existed anywhere in WinCon before this feature
// (see battle-sim-ai.js's header comment for the "why Monte Carlo, why a
// greedy AI and not perfect play" reasoning).
//
// SCOPE NOTE (read this before assuming a mechanic is modeled): this
// engine implements real turn order, a real damage formula, stat stages,
// status conditions, and the specific ability/item/move effects curated
// in data/ability-effects.json / data/item-effects.json / data/move-
// effects.json. Anything NOT curated in those overlay files, and a few
// mechanics explicitly out of scope for this build (confusion's self-hit
// chance is modeled simply; multi-target accuracy is rolled once per move
// rather than once per target; PP is not tracked, a move is always
// "available"), are deliberate, documented simplifications — see the
// plan's Verification section and the in-app methodology note for the
// user-facing version of this same honesty. Every overlay lookup below
// defaults to "no extra effect" rather than throwing, so an uncurated
// Pokémon/ability/item/move is still a fully valid, simulatable battler.

const WC_MAX_TURNS = 50;

// ---------------------------------------------------------------------------
// Move + battler construction
// ---------------------------------------------------------------------------

/**
 * Merges one data/moves.json entry with its data/move-effects.json overlay
 * (if any) into the shape the engine actually uses. Falls back to a
 * reasonable default target (Status -> self; damaging -> spread if the
 * move is in strategy.js's own WINCON_SPREAD_MOVES, else single-target)
 * when the move isn't in the overlay file yet.
 */
function wcResolveMove(name, movesData, moveEffects) {
  const base = movesData.find((m) => m.name === name);
  if (!base) return null;
  const overlay = (moveEffects && moveEffects[name]) || {};
  const isKnownSpread = typeof WINCON_SPREAD_MOVES !== "undefined" && WINCON_SPREAD_MOVES.has(name);
  const target = overlay.target || (base.category === "Status" ? "self" : isKnownSpread ? "all-adjacent-foes" : "any-single");
  return {
    name: base.name,
    type: base.type,
    category: base.category,
    power: base.power || 0,
    accuracy: base.accuracy,
    priority: base.priority || 0,
    target,
    flags: overlay.flags || { contact: base.category === "Physical", protectable: true },
    secondary: overlay.secondary || null,
    selfStatChange: overlay.selfStatChange || null,
    targetStatChange: overlay.targetStatChange || null,
    fieldEffect: overlay.fieldEffect || null,
    recoilFraction: overlay.recoilFraction || null,
    drainFraction: overlay.drainFraction || null,
    healFraction: overlay.healFraction || null,
    multiHit: overlay.multiHit || null,
    statusInflicted: overlay.statusInflicted || null,
  };
}

function wcComputeBattlerStats(baseStats, build, natures) {
  return {
    hp: wcCalcStat(baseStats.hp, "hp", build.sp.hp, build.nature, natures),
    atk: wcCalcStat(baseStats.atk, "attack", build.sp.attack, build.nature, natures),
    def: wcCalcStat(baseStats.def, "defense", build.sp.defense, build.nature, natures),
    spa: wcCalcStat(baseStats.spa, "sp_attack", build.sp.sp_attack, build.nature, natures),
    spd: wcCalcStat(baseStats.spd, "sp_defense", build.sp.sp_defense, build.nature, natures),
    spe: wcCalcStat(baseStats.spe, "speed", build.sp.speed, build.nature, natures),
  };
}

/**
 * @param spec { name, types, baseStats, ability, build: {nature, item, moves, sp} }
 *   — the common shape both a real slot (via battle-sim-lineup.js's
 *   wcBattlerSpecForSlot) and a meta-baseline reference opponent (via
 *   battle-sim-baseline.js's wcResolveBaselineMember) produce, so this
 *   function never needs to know which kind it's building.
 */
function wcMakeBattler(spec, movesData, moveEffects, natures) {
  const stats = wcComputeBattlerStats(spec.baseStats, spec.build, natures);
  const moves = (spec.build.moves || [])
    .filter(Boolean)
    .map((name) => wcResolveMove(name, movesData, moveEffects))
    .filter(Boolean);
  return {
    name: spec.name,
    types: spec.types,
    ability: spec.ability,
    item: (spec.build.item || "").trim(),
    stats,
    maxHp: stats.hp,
    hp: stats.hp,
    stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    status: null, // { kind: "burn"|"paralyze"|"poison"|"badly-poison"|"sleep"|"freeze", turns }
    volatiles: {
      flinched: false,
      protectedThisTurn: false,
      protectStreak: 0,
      confused: false,
      helpingHandThisTurn: false,
      redirectingThisTurn: false,
      choiceLockedMove: null,
      sashConsumed: false,
    },
    moves,
    fainted: false,
  };
}

// ---------------------------------------------------------------------------
// Ability / item modifier lookups — only the curated subset is honored;
// anything else in the overlay files with an `effect` this engine doesn't
// recognize is silently skipped (see the SCOPE NOTE above).
// ---------------------------------------------------------------------------

function wcAbilityEffect(battler, abilityEffects) {
  return (battler.ability && abilityEffects && abilityEffects[battler.ability]) || null;
}

function wcItemEffect(battler, itemEffects) {
  return (battler.item && itemEffects && itemEffects[battler.item]) || null;
}

/** Passive ability/item stat multipliers (Huge Power, Choice Band's onStat, etc.) for one of the 4 offense/defense stats. */
function wcPassiveStatMult(battler, statKey, abilityEffects, itemEffects) {
  let mult = 1;
  const ae = wcAbilityEffect(battler, abilityEffects);
  if (ae && ae.trigger === "passive") {
    if (ae.effect === "statMult" && ae.stat === statKey) mult *= ae.mult;
    if (ae.effect === "statMultIfStatused" && ae.stat === statKey && battler.status) {
      if (!(statKey === "atk" && battler.status.kind === "burn" && ae.alsoIgnoresBurnDrop)) mult *= ae.mult;
      else mult *= ae.mult; // Guts: boosted AND ignores the burn halving (handled separately in damage calc)
    }
  }
  const ie = wcItemEffect(battler, itemEffects);
  if (ie && ie.onStat && ie.onStat.stat === statKey && !battler.volatiles.sashConsumed) mult *= ie.onStat.mult;
  return mult;
}

/** A battler's fully effective stat this instant: base(computed) -> stage -> passive ability/item multiplier. */
function wcEffectiveStat(battler, statKey, stageKey, abilityEffects, itemEffects) {
  const staged = wcApplyStatStage(battler.stats[statKey], battler.stages[stageKey]);
  return Math.max(1, Math.floor(staged * wcPassiveStatMult(battler, statKey, abilityEffects, itemEffects)));
}

function wcEffectiveSpeedFor(battler, field, abilityEffects, itemEffects) {
  const base = wcEffectiveStat(battler, "spe", "spe", abilityEffects, itemEffects);
  return wcEffectiveSpeed(base, { paralyzed: battler.status && battler.status.kind === "paralyze", tailwind: field.tailwindTurns[battler.side] > 0 });
}

// ---------------------------------------------------------------------------
// Damage resolution
// ---------------------------------------------------------------------------

function wcWeatherModifierFor(moveType, field) {
  if (field.weather === "sun") {
    if (moveType === "Fire") return 1.5;
    if (moveType === "Water") return 0.5;
  }
  if (field.weather === "rain") {
    if (moveType === "Water") return 1.5;
    if (moveType === "Fire") return 0.5;
  }
  return 1;
}

/** True if `defenderTypes` are immune to `moveType` via a curated ability (Levitate/Ground, Water Absorb/Water, etc.). */
function wcHasTypeImmunity(defender, moveType, abilityEffects) {
  const ae = wcAbilityEffect(defender, abilityEffects);
  return Boolean(ae && ae.trigger === "passive" && ae.effect === "typeImmunity" && ae.type === moveType);
}

function wcResolveOneHit(attacker, move, defender, field, data, rng) {
  const { typeChart, abilityEffects, itemEffects } = data;
  if (wcHasTypeImmunity(defender, move.type, abilityEffects)) return { damage: 0, isCrit: false, immune: true };

  const attackerAbility = wcAbilityEffect(attacker, abilityEffects);
  let attackerTypes = attacker.types;
  if (attackerAbility && attackerAbility.trigger === "passive" && attackerAbility.effect === "stabMult") {
    // Adaptability doesn't change types, just the STAB multiplier applied below via extraModifiers.
  }
  const alwaysStab = typeof WINCON_ALWAYS_STAB_ABILITIES !== "undefined" && WINCON_ALWAYS_STAB_ABILITIES.has(attacker.ability);
  const effectiveMoveType =
    typeof WINCON_ABILITY_TYPE_CONVERSION !== "undefined" && WINCON_ABILITY_TYPE_CONVERSION[attacker.ability] && move.type === "Normal"
      ? WINCON_ABILITY_TYPE_CONVERSION[attacker.ability]
      : move.type;

  const isPhysical = move.category === "Physical";
  const atkStat = wcEffectiveStat(attacker, isPhysical ? "atk" : "spa", isPhysical ? "atk" : "spa", abilityEffects, itemEffects);
  const defStat = wcEffectiveStat(defender, isPhysical ? "def" : "spd", isPhysical ? "def" : "spd", abilityEffects, itemEffects);

  const extraModifiers = [];
  if (attackerAbility && attackerAbility.trigger === "passive" && attackerAbility.effect === "stabMult" && attackerTypes.includes(effectiveMoveType)) {
    extraModifiers.push(attackerAbility.mult / 1.5); // stack on top of the normal 1.5 STAB the formula already applies
  }
  if (attackerAbility && attackerAbility.trigger === "passive" && attackerAbility.effect === "damageDealtMultIfLowPower" && move.power > 0 && move.power <= attackerAbility.powerThreshold) {
    extraModifiers.push(attackerAbility.mult);
  }
  const attackerItem = wcItemEffect(attacker, itemEffects);
  if (attackerItem && typeof attackerItem.onDamageDealtMult === "number") extraModifiers.push(attackerItem.onDamageDealtMult);

  const defenderAbility = wcAbilityEffect(defender, abilityEffects);
  if (defenderAbility && defenderAbility.trigger === "passive" && defenderAbility.effect === "damageTakenMult") {
    if (defenderAbility.condition !== "fullHp" || defender.hp === defender.maxHp) extraModifiers.push(defenderAbility.mult);
  }

  const burnHalves = Boolean(
    attacker.status && attacker.status.kind === "burn" && isPhysical &&
      !(attackerAbility && attackerAbility.trigger === "passive" && attackerAbility.effect === "statMultIfStatused" && attackerAbility.alsoIgnoresBurnDrop)
  );

  const result = wcCalcDamage({
    power: move.power,
    attackStat: atkStat,
    defenseStat: defStat,
    category: move.category,
    moveType: effectiveMoveType,
    attackerTypes: alwaysStab ? [effectiveMoveType] : attackerTypes,
    defenderTypes: defender.types,
    typeChart,
    isSpread: move.target === "all-adjacent-foes" || move.target === "all-adjacent",
    weatherModifier: wcWeatherModifierFor(effectiveMoveType, field),
    extraModifiers,
    burnHalves,
    critStage: move.flags && move.flags.highCrit ? 1 : 0,
    rng,
  });
  return { ...result, immune: false };
}

/** Applies incoming damage, respecting Focus Sash / Sturdy-style "survive at 1 HP" from a curated item/ability. Returns the actual HP lost. */
function wcApplyDamage(defender, rawDamage, abilityEffects, itemEffects) {
  const wasFull = defender.hp === defender.maxHp;
  let damage = Math.min(rawDamage, defender.hp);
  if (damage >= defender.hp && wasFull) {
    const ae = wcAbilityEffect(defender, abilityEffects);
    const ie = wcItemEffect(defender, itemEffects);
    const surviveByAbility = ae && ae.trigger === "passive" && ae.effect === "surviveOneHitAtFullHp";
    const surviveByItem = ie && ie.surviveOneHitAtFullHp && !defender.volatiles.sashConsumed;
    if (surviveByAbility || surviveByItem) {
      damage = defender.hp - 1;
      if (surviveByItem) defender.volatiles.sashConsumed = true;
    }
  }
  defender.hp = Math.max(0, defender.hp - damage);
  if (defender.hp === 0) defender.fainted = true;
  return damage;
}

// ---------------------------------------------------------------------------
// One turn
// ---------------------------------------------------------------------------

function wcRollStatus(kind) {
  return { kind, turns: 0 };
}

function wcApplyStatChanges(target, changes, rng) {
  if (!changes) return;
  changes.forEach((c) => {
    if (c.stat in target.stages) target.stages[c.stat] = Math.max(-6, Math.min(6, target.stages[c.stat] + c.stages));
  });
}

/**
 * True redirect (Follow Me/Rage Powder) can only be resolved at
 * execution time, not when moves are chosen at the start of the turn —
 * the redirecting Pokémon usually acts first (both moves have high
 * priority) but whether it's still alive/redirecting is only known once
 * we're actually walking the turn in order. Only overrides single-target
 * foe-targeting moves ("any-single") — spread moves, self/ally/field
 * moves are never affected.
 */
function wcRedirectSingleTarget(move, targets, foeSide) {
  if (move.target !== "any-single" || !foeSide) return targets;
  const redirecter = foeSide.find((f) => f && !f.fainted && f.volatiles.redirectingThisTurn);
  if (redirecter && targets && targets[0] !== redirecter) return [redirecter];
  return targets;
}

/** Executes one battler's chosen move this turn. `context` carries field state and rng; `foeSide` is the opposing side's CURRENT active roster (for redirect resolution — see wcRedirectSingleTarget). */
function wcExecuteMove(actor, choice, context, foeSide) {
  const { move } = choice;
  const targets = wcRedirectSingleTarget(move, choice.targets, foeSide);
  const { field, data, rng, log } = context;
  if (actor.fainted) return;

  if (actor.status && (actor.status.kind === "sleep" || actor.status.kind === "freeze")) {
    if (rng() > 0.25) return; // ~75% chance to stay asleep/frozen this turn
    actor.status = null;
  }
  if (actor.volatiles.flinched) {
    actor.volatiles.flinched = false;
    return;
  }
  if (actor.status && actor.status.kind === "paralyze" && rng() < 0.25) return; // full paralysis
  if (actor.volatiles.confused) {
    if (rng() < 0.33) {
      const selfHit = wcCalcDamage({
        power: 40, attackStat: wcEffectiveStat(actor, "atk", "atk", data.abilityEffects, data.itemEffects),
        defenseStat: wcEffectiveStat(actor, "def", "def", data.abilityEffects, data.itemEffects),
        category: "Physical", moveType: "Normal", attackerTypes: [], defenderTypes: [], typeChart: data.typeChart,
        weatherModifier: 1, rng,
      });
      wcApplyDamage(actor, selfHit.damage, data.abilityEffects, data.itemEffects);
      return;
    }
  }

  const isProtectMove = ["Protect", "Detect", "Baneful Bunker", "King's Shield", "Spiky Shield", "Wide Guard", "Quick Guard"].includes(move.name);
  if (isProtectMove) {
    const chance = Math.max(0, 1 - actor.volatiles.protectStreak * 0.66);
    if (rng() < chance) {
      actor.volatiles.protectedThisTurn = true;
      actor.volatiles.protectStreak += 1;
    } else {
      actor.volatiles.protectStreak = 0;
    }
    return;
  }
  actor.volatiles.protectStreak = 0;

  if (move.target === "self-side" && move.fieldEffect) {
    if (move.fieldEffect.type === "tailwind") field.tailwindTurns[actor.side] = move.fieldEffect.duration || 4;
    if (move.fieldEffect.type === "trick-room") field.trickRoomTurns = field.trickRoomTurns > 0 ? 0 : move.fieldEffect.duration || 5;
    if (move.fieldEffect.type === "weather-sun") { field.weather = "sun"; field.weatherTurns = move.fieldEffect.duration || 5; }
    if (move.fieldEffect.type === "weather-rain") { field.weather = "rain"; field.weatherTurns = move.fieldEffect.duration || 5; }
    return;
  }
  if (move.name === "Follow Me" || move.name === "Rage Powder") {
    actor.volatiles.redirectingThisTurn = true;
    return;
  }
  if (move.target === "ally") {
    const ally = targets[0];
    if (ally && !ally.fainted && move.name === "Helping Hand") ally.volatiles.helpingHandThisTurn = true;
    return;
  }
  if (move.target === "self" && move.power === 0) {
    // A pure self-targeted move (Swords Dance, Dragon Dance, Recover,
    // Roost, ...): no accuracy roll, no Protect interaction, always
    // resolves against the user itself.
    wcApplyStatChanges(actor, move.selfStatChange, rng);
    if (move.healFraction) actor.hp = Math.min(actor.maxHp, actor.hp + Math.floor(actor.maxHp * move.healFraction));
    return;
  }

  const liveTargets = (targets || []).filter((t) => t && !t.fainted);
  if (liveTargets.length === 0) return;
  const accStage = actor.stages.acc;

  if (move.category === "Status" && move.power === 0) {
    // A foe-targeted status move (Will-O-Wisp, Thunder Wave, Toxic,
    // Screech, ...): real accuracy roll and Protect interaction, but no
    // damage calculation at all — dealt with separately from the
    // damaging-move loop below so a 0-power move can never accidentally
    // compute a nonzero "hit" off the damage formula's flat +2 term.
    liveTargets.forEach((target) => {
      if (target.volatiles.protectedThisTurn && move.flags && move.flags.protectable !== false) return;
      if (!wcAccuracyRoll(move.accuracy, accStage, target.stages.eva, rng)) return;
      wcApplyStatChanges(target, move.targetStatChange, rng);
      if (move.statusInflicted && !target.status && rng() * 100 < move.statusInflicted.chance) {
        target.status = wcRollStatus(move.statusInflicted.status);
      }
    });
    return;
  }

  let anyHit = false;
  const helpingHandBoost = actor.volatiles.helpingHandThisTurn ? 1.5 : 1;
  liveTargets.forEach((target) => {
    if (target.volatiles.protectedThisTurn && move.flags && move.flags.protectable !== false) return;
    if (!wcAccuracyRoll(move.accuracy, accStage, target.stages.eva, rng)) return;
    anyHit = true;
    const hits = move.multiHit ? Math.floor(move.multiHit.min + rng() * (move.multiHit.max - move.multiHit.min + 1)) : 1;
    let totalDealt = 0;
    for (let i = 0; i < hits; i += 1) {
      if (target.fainted) break;
      const result = wcResolveOneHit(actor, move, target, field, data, rng);
      if (result.immune) continue;
      const dealt = wcApplyDamage(target, Math.floor(result.damage * helpingHandBoost), data.abilityEffects, data.itemEffects);
      totalDealt += dealt;
      const itemOnContact = wcItemEffect(target, data.itemEffects);
      if (move.flags && move.flags.contact && itemOnContact && itemOnContact.onContactTakenDamage && !actor.fainted) {
        wcApplyDamage(actor, Math.floor(actor.maxHp * itemOnContact.onContactTakenDamage.fraction), data.abilityEffects, data.itemEffects);
      }
      if (move.flags && move.flags.contact && target.ability === "Rough Skin" && !actor.fainted) {
        wcApplyDamage(actor, Math.floor(actor.maxHp * 0.125), data.abilityEffects, data.itemEffects);
      }
      const onSwitchInAbility = wcAbilityEffect(target, data.abilityEffects);
      if (onSwitchInAbility && onSwitchInAbility.trigger === "onHitByPhysical" && move.category === "Physical" && onSwitchInAbility.effect === "statChange") {
        wcApplyStatChanges(target, [{ stat: onSwitchInAbility.stat, stages: onSwitchInAbility.stages }], rng);
        if (onSwitchInAbility.andAlso) wcApplyStatChanges(target, [onSwitchInAbility.andAlso], rng);
      }
    }
    if (move.recoilFraction && !actor.fainted) wcApplyDamage(actor, Math.floor(totalDealt * move.recoilFraction) || Math.floor(actor.maxHp * move.recoilFraction * 0.01), data.abilityEffects, data.itemEffects);
    if (move.drainFraction) actor.hp = Math.min(actor.maxHp, actor.hp + Math.floor(totalDealt * move.drainFraction));
    wcApplyStatChanges(target, move.targetStatChange, rng);
    if (move.secondary && rng() * 100 < move.secondary.chance) {
      if (move.secondary.effect === "flinch") target.volatiles.flinched = true;
      if (move.secondary.effect === "paralyze" && !target.status) target.status = wcRollStatus("paralyze");
      if (move.secondary.effect === "confuse") target.volatiles.confused = true;
    }
    if (move.statusInflicted && !target.status && rng() * 100 < move.statusInflicted.chance) {
      target.status = wcRollStatus(move.statusInflicted.status);
    }
    const attackerItem = wcItemEffect(actor, data.itemEffects);
    if (attackerItem && attackerItem.onAttackerHpLoss && !actor.fainted) {
      wcApplyDamage(actor, Math.floor(actor.maxHp * attackerItem.onAttackerHpLoss.fraction), data.abilityEffects, data.itemEffects);
    }
    // NOTE (scope): Weakness Policy's onSuperEffectiveHitStatChange and
    // similar "reacts to the type-effectiveness of the hit it just took"
    // item effects are curated in data/item-effects.json but not yet
    // wired up here — they'd need the per-hit typeMod threaded out of
    // wcResolveOneHit, which the current per-target loop doesn't expose.
    // A curated-but-unimplemented effect is a safe no-op, same as an
    // uncurated one (see this file's SCOPE NOTE).
  });
  if (anyHit && move.selfStatChange) wcApplyStatChanges(actor, move.selfStatChange, rng);
  if (log) log.push(`${actor.name} used ${move.name}${anyHit ? "" : " (missed)"}`);
}

function wcApplyEndOfTurn(battler, field, side, abilityEffects, itemEffects) {
  if (battler.fainted) return;
  if (battler.status) {
    if (battler.status.kind === "burn") wcApplyDamage(battler, Math.floor(battler.maxHp / 16), abilityEffects, itemEffects);
    if (battler.status.kind === "poison") wcApplyDamage(battler, Math.floor(battler.maxHp / 8), abilityEffects, itemEffects);
    if (battler.status.kind === "badly-poison") {
      battler.status.turns += 1;
      wcApplyDamage(battler, Math.floor((battler.maxHp * battler.status.turns) / 16), abilityEffects, itemEffects);
    }
  }
  const ie = wcItemEffect(battler, itemEffects);
  if (ie && ie.onEndOfTurnHeal && !battler.fainted) battler.hp = Math.min(battler.maxHp, battler.hp + Math.floor(battler.maxHp * ie.onEndOfTurnHeal.fraction));
  battler.volatiles.protectedThisTurn = false;
  battler.volatiles.helpingHandThisTurn = false;
  battler.volatiles.redirectingThisTurn = false;
  if (field.tailwindTurns[side] > 0) field.tailwindTurns[side] -= 1;
}

// ---------------------------------------------------------------------------
// One full battle
// ---------------------------------------------------------------------------

/**
 * @param mySide Array of battler specs (already resolved via
 *   battle-sim-lineup.js / battle-sim-baseline.js) — the lineup actually
 *   brought (length 4 Doubles / 3 Singles).
 * @param oppSide Same shape, the opponent's brought lineup.
 * @param format "singles" | "doubles".
 * @param data { movesData, moveEffects, abilityEffects, itemEffects, typeChart, natures, sheetMode }.
 * @param rng Injectable RNG, default Math.random.
 * @returns "win" | "loss" | "draw" (from mySide's perspective).
 */
function wcRunOneBattle(mySideSpecs, oppSideSpecs, format, data, rng) {
  const roll = rng || Math.random;
  const activeCount = format === "singles" ? 1 : 2;
  const myTeam = mySideSpecs.map((s) => wcMakeBattler(s, data.movesData, data.moveEffects, data.natures));
  const oppTeam = oppSideSpecs.map((s) => wcMakeBattler(s, data.movesData, data.moveEffects, data.natures));
  myTeam.forEach((b) => (b.side = "me"));
  oppTeam.forEach((b) => (b.side = "opp"));

  const field = { weather: null, weatherTurns: 0, trickRoomTurns: 0, tailwindTurns: { me: 0, opp: 0 } };

  const bench = { me: myTeam.slice(activeCount), opp: oppTeam.slice(activeCount) };
  const active = { me: myTeam.slice(0, activeCount), opp: oppTeam.slice(0, activeCount) };

  wcApplySwitchInAbilities(active.me, active.opp, data.abilityEffects, roll);
  wcApplySwitchInAbilities(active.opp, active.me, data.abilityEffects, roll);

  const context = { field, data, rng: roll, log: null };

  for (let turn = 0; turn < WC_MAX_TURNS; turn += 1) {
    const actors = [];
    active.me.forEach((b, i) => { if (!b.fainted) actors.push({ battler: b, side: "me", slot: i }); });
    active.opp.forEach((b, i) => { if (!b.fainted) actors.push({ battler: b, side: "opp", slot: i }); });
    if (actors.length === 0) break;

    const choices = actors.map((a) => {
      const foeSide = a.side === "me" ? active.opp : active.me;
      return {
        a,
        foeSide,
        choice: wcChooseAiMove(a.battler, a.side === "me" ? active.me : active.opp, foeSide, {
          data, field, rng: roll, sheetMode: data.sheetMode, isFirstTurn: turn === 0, mySide: a.side,
        }),
      };
    });

    const orderInput = choices.map(({ a, choice, foeSide }) => ({
      id: a.battler.name + a.slot + a.side,
      priority: choice.move ? choice.move.priority : 0,
      effectiveSpeed: wcEffectiveSpeedFor(a.battler, field, data.abilityEffects, data.itemEffects),
      ref: { a, choice, foeSide },
    }));
    if (field.trickRoomTurns > 0) orderInput.forEach((o) => (o.effectiveSpeed = -o.effectiveSpeed));
    const ordered = wcResolveTurnOrder(orderInput, roll);

    ordered.forEach(({ ref }) => {
      const { a, choice, foeSide } = ref;
      if (a.battler.fainted || !choice.move) return;
      wcExecuteMove(a.battler, choice, context, foeSide);
    });

    ["me", "opp"].forEach((side) => {
      active[side].forEach((b) => wcApplyEndOfTurn(b, field, side, data.abilityEffects, data.itemEffects));
    });
    if (field.weatherTurns > 0) { field.weatherTurns -= 1; if (field.weatherTurns === 0) field.weather = null; }
    if (field.trickRoomTurns > 0) field.trickRoomTurns -= 1;

    ["me", "opp"].forEach((side) => {
      active[side].forEach((b, i) => {
        if (b.fainted && bench[side].length > 0) {
          const next = bench[side].shift();
          active[side][i] = next;
          next.side = side;
          wcApplySwitchInAbilities([next], active[side === "me" ? "opp" : "me"], data.abilityEffects, roll);
        }
      });
    });

    const myAlive = active.me.some((b) => !b.fainted) || bench.me.some((b) => !b.fainted);
    const oppAlive = active.opp.some((b) => !b.fainted) || bench.opp.some((b) => !b.fainted);
    if (!myAlive || !oppAlive) {
      if (!myAlive && !oppAlive) return "draw";
      return myAlive ? "win" : "loss";
    }
  }

  const myHpPct = wcTeamHpPercent(myTeam);
  const oppHpPct = wcTeamHpPercent(oppTeam);
  if (Math.abs(myHpPct - oppHpPct) < 0.01) return "draw";
  return myHpPct > oppHpPct ? "win" : "loss";
}

function wcTeamHpPercent(team) {
  const total = team.reduce((sum, b) => sum + b.maxHp, 0);
  const remaining = team.reduce((sum, b) => sum + b.hp, 0);
  return total > 0 ? remaining / total : 0;
}

function wcApplySwitchInAbilities(incoming, opposing, abilityEffects, rng) {
  incoming.forEach((b) => {
    if (b.fainted) return;
    const ae = wcAbilityEffect(b, abilityEffects);
    if (ae && ae.trigger === "onSwitchIn" && ae.effect === "statChange") {
      const foes = ae.target === "all-adjacent-foes" ? opposing.filter((f) => !f.fainted) : [];
      foes.forEach((f) => wcApplyStatChanges(f, [{ stat: ae.stat, stages: ae.stages }], rng));
    }
  });
}

// ---------------------------------------------------------------------------
// Monte Carlo aggregation
// ---------------------------------------------------------------------------

/**
 * @param myLineupSpecs This side's resolved 4/3-lineup battler specs.
 * @param oppLineupPool Array of { id, label, specs, weight? } — one entry
 *   per sampled opponent team (the meta-baseline field, or a single real
 *   opponent team for the Battle Tracker's Team vs Team matchup).
 *   `weight` (Milestone 34 follow-up, optional) scales this opponent's
 *   own share of `runsPerOpponent` -- see wcLiveUsageWeightForTeam in
 *   strategy.js. Missing/falsy `weight` behaves exactly as before (1x),
 *   so every existing caller that never sets it is unaffected.
 * @param runsPerOpponent Baseline number of simulated battles per pool
 *   entry (battle-sim-lineup.js picks the concrete number) -- an
 *   individual opponent's actual run count is this scaled by its own
 *   `weight`.
 */
function wcRunMonteCarlo(myLineupSpecs, oppLineupPool, runsPerOpponent, format, data, rng) {
  const roll = rng || Math.random;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let totalRuns = 0;
  const perOpponent = oppLineupPool.map((opp) => {
    const opponentRuns = Math.max(1, Math.round(runsPerOpponent * (opp.weight || 1)));
    let oppWins = 0;
    for (let i = 0; i < opponentRuns; i += 1) {
      const result = wcRunOneBattle(myLineupSpecs, opp.specs, format, data, roll);
      if (result === "win") { wins += 1; oppWins += 1; }
      else if (result === "loss") losses += 1;
      else draws += 1;
    }
    totalRuns += opponentRuns;
    return { id: opp.id, label: opp.label, winRate: oppWins / opponentRuns };
  });
  return { winRate: totalRuns > 0 ? wins / totalRuns : 0, wins, losses, draws, totalRuns, perOpponent };
}
