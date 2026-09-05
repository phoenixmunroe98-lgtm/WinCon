// WinCon — battle-sim-lineup.js (Simulated Win Rate)
//
// Decides WHICH 4-of-6 (Doubles) / 3-of-6 (Singles) WinCon actually
// simulates (WinCon picks, automatically — see the plan's "Bring-N
// lineup selection" section for why: the ask is "predict win rate" of
// the already-built 6, not a manual team-preview step), and handles the
// "only one Mega per battle" rule by branching into 1-3 separate
// scenarios. This is the top-level orchestration the Web Worker calls
// into (see battle-sim-worker.js) — everything here is pure and takes
// its data explicitly (pokemonList, baseStatsData, ...) rather than
// reading any page-global, since a Worker has no DOM and no access to
// builder.js's own module-level `data` object.
//
// wcResolveSlotIdentity below is the same item-driven-Mega-with-manual-
// override mechanism builder.js's wcSlotEffective (Milestone 32)
// implements — re-expressed here in a portable, parameterized form so it
// can run inside the Worker; both ultimately call megas.js's
// wcEffectivePokemon and are never meant to disagree.

const WC_REFERENCE_RUNS_PER_OPPONENT = 200;
const WC_TEAMVSTEAM_RUNS_PER_OPPONENT = 3000;

// Milestone 35, Task 1: how many lineups the two narrowing rounds below
// keep sampling before the caller spends the full
// WC_REFERENCE_RUNS_PER_OPPONENT count on a single finalist. Deliberately
// small -- these rounds only need to be accurate enough to tell a clearly
// weak lineup from a clearly strong one, not to produce a reportable win
// rate on their own.
const WC_SEARCH_ROUND1_RUNS_PER_OPPONENT = 20;
const WC_SEARCH_ROUND2_RUNS_PER_OPPONENT = 60;

/** Portable equivalent of builder.js's wcSlotEffective. */
function wcResolveSlotIdentity(baseName, build, pokemonList) {
  const itemDerived = wcEffectivePokemon(pokemonList, baseName, build && build.item);
  if (!itemDerived || itemDerived.name === baseName) return itemDerived;
  if (build && build.megaView === "base") {
    return pokemonList.find((p) => p.name === baseName) || itemDerived;
  }
  return itemDerived;
}

/** Builds a battle-sim-engine.js-ready spec for one real team slot, resolving Mega/base identity exactly like the Builder's own slot card does. `forcedMegaView` ("mega"/"base") overrides the build's own megaView — used to force each side of a dual-Mega scenario (see wcBuildMegaScenarios) without ever mutating the user's real build. */
function wcBattlerSpecForSlot(baseName, build, pokemonList, baseStatsData, abilitiesData, forcedMegaView) {
  const effectiveBuild = forcedMegaView ? { ...build, megaView: forcedMegaView } : build;
  const identity = wcResolveSlotIdentity(baseName, effectiveBuild, pokemonList) || pokemonList.find((p) => p.name === baseName);
  const baseStats = (identity && baseStatsData.find((b) => b.name === identity.name)) || baseStatsData.find((b) => b.name === baseName);
  const ability = wcAbilityOf(abilitiesData, (identity && identity.name) || baseName) || wcAbilityOf(abilitiesData, baseName);
  return {
    name: (identity && identity.name) || baseName,
    types: (identity && identity.types) || [],
    baseStats,
    ability,
    build: effectiveBuild,
  };
}

/** True if this slot's item currently matches one of baseName's own Mega Stones — the same "is this slot Mega-eligible" check builder.js's renderSlot uses. */
function wcIsMegaEligible(baseName, build, pokemonList) {
  const itemDerived = wcEffectivePokemon(pokemonList, baseName, build && build.item);
  return Boolean(itemDerived && itemDerived.name !== baseName);
}

/** All C(6,n) lineups of a 6-name roster, as arrays of names. n=4 (Doubles, C(6,4)=15) or n=3 (Singles, C(6,3)=20). */
function wcEnumerateLineups(chosenSix, n) {
  const results = [];
  const combo = [];
  function recurse(start) {
    if (combo.length === n) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < chosenSix.length; i += 1) {
      combo.push(chosenSix[i]);
      recurse(i + 1);
      combo.pop();
    }
  }
  recurse(0);
  return results;
}

/**
 * Cheap ranking pass (no Monte Carlo): scores every candidate lineup by
 * reusing wcScoreMatchup (strategy.js) against every member of every
 * sampled reference team, averaged, plus wcComboSynergyBonus
 * (strategy.js, real logged-battle data — guarded, since it may not be
 * loaded in every context that reuses this ranker) when a combo lookup
 * is supplied. Returns lineups sorted best-first.
 */
function wcRankLineupsHeuristic(lineupCombos, specsByName, referenceTeams, data, comboLookup) {
  const { typeChart, natures, movesData, sheetMode } = data;
  const scored = lineupCombos.map((names) => {
    let total = 0;
    let count = 0;
    referenceTeams.forEach((team) => {
      team.forEach((threat) => {
        names.forEach((name) => {
          const spec = specsByName[name];
          if (!spec) return;
          const result = wcScoreMatchup(
            { name: spec.name, types: spec.types },
            spec.build,
            spec.baseStats,
            { name: threat.name, types: threat.types },
            threat.baseStats,
            natures,
            typeChart,
            movesData,
            { sheetMode }
          );
          total += result.points;
          count += 1;
        });
      });
    });
    const heuristicAvg = count > 0 ? total / count : 0;
    const synergyBonus = comboLookup && typeof wcComboSynergyBonus === "function" ? wcComboSynergyBonus(names, comboLookup) : 0;
    return { names, score: heuristicAvg + synergyBonus };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Finds Mega-eligible members of a candidate lineup and produces the 1-3
 * scenarios battle-sim-engine.js should actually simulate: 0 or 1
 * eligible -> one scenario (Mega'd if eligible, per the real "only one
 * Mega per battle" rule there's nothing to branch on); exactly 2 -> two
 * scenarios, one forcing each member Mega with the other forced to base;
 * 3+ -> capped at 3 scenarios (one per candidate, each with just that
 * one forced Mega and the rest forced base).
 */
function wcBuildMegaScenarios(lineupNames, buildsByName, pokemonList, baseStatsData, abilitiesData) {
  const eligible = lineupNames.filter((name) => wcIsMegaEligible(name, buildsByName[name], pokemonList));
  const buildScenario = (megaName) => ({
    megaName: megaName || null,
    specs: lineupNames.map((name) =>
      wcBattlerSpecForSlot(
        name,
        buildsByName[name],
        pokemonList,
        baseStatsData,
        abilitiesData,
        name === megaName ? "mega" : eligible.includes(name) ? "base" : undefined
      )
    ),
  });
  if (eligible.length === 0) return [buildScenario(null)];
  if (eligible.length === 1) return [buildScenario(eligible[0])];
  return eligible.slice(0, 3).map((name) => buildScenario(name));
}

/**
 * Milestone 35, Task 1 -- replaces the old "rank once with the cheap
 * non-mechanical wcScoreMatchup heuristic, simulate only its #1 pick"
 * shortcut. wcScoreMatchup never sees abilities, items, or a real damage
 * roll (type effectiveness + Speed only), so its ranking can be wrong --
 * and a wrong ranking meant the true best lineup was never even
 * simulated, while WinCon reported a confident win rate for one that
 * wasn't actually the best.
 *
 * This narrows the candidate lineups in two rounds, using the REAL
 * mechanical engine (wcRunMonteCarlo) at every round instead of the cheap
 * proxy -- a lineup is only ever eliminated by an actual (if lightly
 * sampled) simulated result, never by a metric that can't see abilities
 * or items. A real logged-battle combo bonus (wcComboSynergyBonus, when a
 * comboLookup is available) is folded into each round's score too, so a
 * combination with a real proven track record still gets its usual nudge
 * -- this is the same signal the old heuristic-only ranking used, just
 * layered on top of real simulated results instead of replacing them.
 *
 * Round 1 samples every candidate lightly and keeps the top half; round 2
 * samples those survivors more heavily and keeps a single winner. The
 * caller then spends the full WC_REFERENCE_RUNS_PER_OPPONENT count on
 * that one lineup (see wcSimulateTeamWinRate) -- total budget lands in
 * the low thousands of simulated battles, not the ~15,000-20,000 a true
 * brute force over every candidate at full accuracy would take.
 */
function wcSelectBestLineupBySuccessiveHalving(lineups, specsByName, oppPool, format, simData, comboLookup, rng) {
  const scoreRound = (candidateLineups, runsPerOpponent) =>
    candidateLineups
      .map((names) => {
        const specs = names.map((name) => specsByName[name]);
        const result = wcRunMonteCarlo(specs, oppPool, runsPerOpponent, format, simData, rng);
        const synergyBonus = comboLookup && typeof wcComboSynergyBonus === "function" ? wcComboSynergyBonus(names, comboLookup) : 0;
        return { names, score: result.winRate + synergyBonus };
      })
      .sort((a, b) => b.score - a.score);

  const round1 = scoreRound(lineups, WC_SEARCH_ROUND1_RUNS_PER_OPPONENT);
  const round1Survivors = round1.slice(0, Math.max(1, Math.ceil(round1.length / 2))).map((r) => r.names);
  if (round1Survivors.length === 1) return round1Survivors[0];

  const round2 = scoreRound(round1Survivors, WC_SEARCH_ROUND2_RUNS_PER_OPPONENT);
  return round2[0].names;
}


// ---------------------------------------------------------------------------
// Milestone 48 -- game plans (Phoenix: "look at how an individual team's
// strategy would actually be played, then sim the battles after looking at
// how the strategy is implemented, including alternate strategies").
//
// A "game plan" is a concrete, real answer to "how would this team's real
// synergy actually be played" -- which member sets up first, who's along
// for support, and who's the payoff (the carry) -- built from exactly the
// same archetype detection already trusted for the Meta Analyst
// (wcActiveArchetypesForBuiltTeam, wcAntiTrickRoomAudit -- strategy.js).
// wcSimulateTeamWinRate below simulates EVERY detected plan separately and
// reports a win rate for each, instead of one blended number from a single
// generic-AI battle -- so a team that can genuinely run more than one real
// line (Phoenix's example team can lead Tailwind into either Mega Sceptile
// or Mega Charizard Y) gets both reported side by side.
//
// This deliberately does NOT give the simulator any new "on purpose"
// switching mid-battle (no scripted U-turn pivot, no mid-battle Mega-evolve
// decision) -- Phoenix's own scope choice for this milestone. What it DOES
// change: (1) which two Pokemon actually lead (wcOrderLineupForPlan sorts a
// plan's lineup so its setter/screener go out first, its carry only enters
// once a lead has fainted -- the engine's only real switch mechanism), and
// (2) how much each battler's own AI values the moves that make its role
// real (wcRoleWeightsFor -- a Tailwind setter now actually prioritizes
// casting Tailwind well above the generic default, a screener actually
// prioritizes screens now that screens do something mechanically, see
// battle-sim-ai.js/battle-sim-engine.js's own Milestone 48 comments).
// ---------------------------------------------------------------------------

/**
 * Per-role AI weight overlays, merged onto WC_DEFAULT_AI_WEIGHTS. Kept
 * small and conservative -- same "hand-picked, not exhaustive" convention
 * as the rest of this project -- rather than trying to retune every
 * situational score for every role.
 */
const WC_GAME_PLAN_ROLE_WEIGHT_OVERRIDES = {
  setter: { tailwindUpScore: 90, trickRoomUpScore: 70, screensUpScore: 60, protectLowHpScore: 75, protectHighHpScore: 45 },
  screener: { screensUpScore: 75, protectLowHpScore: 75, protectHighHpScore: 45 },
  carry: { selfBoostHealthyScore: 45, selfBoostLowScore: 20 },
  support: {},
  neutral: {},
};

/** Merged { ...WC_DEFAULT_AI_WEIGHTS, ...override } for a role, or null for a role with no override (so the spec doesn't carry a pointless identical-to-default weights object). */
function wcRoleWeightsFor(role) {
  const overrides = WC_GAME_PLAN_ROLE_WEIGHT_OVERRIDES[role];
  if (!overrides || Object.keys(overrides).length === 0) return null;
  return { ...WC_DEFAULT_AI_WEIGHTS, ...overrides };
}

/** Lead-priority rank (lower = sent out first) for a plan's roles -- setter/screener need to act turn 1, the carry is the payoff that should only come in once the field's actually set (or a lead has fainted -- the engine's only real switch mechanism, see this file's header comment). */
const WC_GAME_PLAN_ROLE_LEAD_RANK = { setter: 0, screener: 1, support: 2, carry: 3, neutral: 4 };

/** Reorders one candidate lineup's names so wcRunOneBattle's `.slice(0, activeCount)` leads with this plan's setter/screener first, its carry last -- a stable sort, so members sharing a role (or a team with no plan at all) keep their original relative order. */
function wcOrderLineupForPlan(lineupNames, plan) {
  return [...lineupNames].sort((a, b) => {
    const rankA = WC_GAME_PLAN_ROLE_LEAD_RANK[plan.roleByName[a] || "neutral"];
    const rankB = WC_GAME_PLAN_ROLE_LEAD_RANK[plan.roleByName[b] || "neutral"];
    return rankA - rankB;
  });
}

/**
 * Detects the concrete game plans a built 6 can genuinely run. Always
 * returns at least one plan -- a team with no real speed-control
 * archetype and no real anti-Trick-Room tooling gets exactly one back
 * (the "Standard" fallback, every role "neutral", no lineup filtering),
 * never a fabricated one, matching this project's honesty convention.
 *
 * Offensive plans (one per real Tailwind/Trick Room setter x each real
 * carry candidate on the team): the setter is whoever actually knows the
 * archetype's move (wcPreferredSetter picks among them exactly like the
 * Auto-build-strategy UI does); a teammate that also knows Light Screen
 * or Reflect joins as "screener" and leads alongside the setter; every
 * Mega-eligible member is a real carry candidate (falling back to any
 * hard hitter, Atk or SpA >= 100, if the team has no Mega at all) --
 * Phoenix's own example team gets a separate plan per Mega (Sceptile,
 * Charizard Y), not one plan that arbitrarily picks a single carry.
 *
 * Defensive plan ("Trick Room defence"): reuses wcAntiTrickRoomAudit's
 * existing four-tool check (Taunt/Fake Out/a real 0-Speed pivot/Safety
 * Goggles) directly -- a plan is only built when the team genuinely has
 * at least two of those four real answers, since one alone is a single
 * move on a single set, not a coherent defensive game plan. Leads with
 * whoever can Taunt and/or set screens; the 0-Speed pivot and a real
 * carry follow.
 */
function wcBuildGamePlans(chosenSix, builds, pokemonList, baseStatsData, abilitiesData) {
  const members = chosenSix.map((name) => ({ name }));
  const activeArchetypes = wcActiveArchetypesForBuiltTeam(members, builds, abilitiesData);
  const plans = [];

  const hardHitters = chosenSix.filter((name) => {
    const stats = baseStatsData.find((b) => b.name === name);
    return stats && Math.max(stats.atk || 0, stats.spa || 0) >= 100;
  });
  const megaEligible = chosenSix.filter((name) => wcIsMegaEligible(name, builds[name], pokemonList));
  const carryCandidates = megaEligible.length ? megaEligible : hardHitters;

  ["tailwind", "trickroom"].forEach((archetypeKey) => {
    if (!activeArchetypes.includes(archetypeKey)) return;
    const definingMove = WINCON_STRATEGY_MOVES[archetypeKey][0];
    const setterPool = chosenSix.filter((name) => (builds[name].moves || []).includes(definingMove));
    if (!setterPool.length) return;
    const { setter } = wcPreferredSetter(setterPool.map((name) => ({ name })), "", (pool) => pool[0]);

    const screenerPool = chosenSix.filter(
      (name) => name !== setter.name && (builds[name].moves || []).some((mv) => WINCON_STRATEGY_MOVES.screens.includes(mv))
    );
    const screener = screenerPool[0] || null;
    const archetypeLabel = archetypeKey === "tailwind" ? "Tailwind" : "Trick Room";

    carryCandidates
      .filter((name) => name !== setter.name && name !== screener)
      .forEach((carryName) => {
        const roleByName = {};
        roleByName[setter.name] = "setter";
        if (screener) roleByName[screener] = "screener";
        roleByName[carryName] = "carry";
        chosenSix.forEach((name) => { if (!roleByName[name]) roleByName[name] = "support"; });
        plans.push({
          key: `${archetypeKey}__${carryName}`,
          label: `${archetypeLabel} (carry: ${carryName})`,
          archetypeKeys: [archetypeKey],
          roleByName,
          requiredNames: [setter.name, carryName],
        });
      });
  });

  const primaryArchetype = activeArchetypes.includes("trickroom") ? "trickroom" : activeArchetypes[0] || null;
  const audit = wcAntiTrickRoomAudit(members, builds, primaryArchetype);
  if (audit.audited && audit.confirmations.length >= 2) {
    const tauntUser = chosenSix.find((name) => (builds[name].moves || []).includes("Taunt"));
    const screenerPool = chosenSix.filter((name) => (builds[name].moves || []).some((mv) => WINCON_STRATEGY_MOVES.screens.includes(mv)));
    const screener = screenerPool[0] || null;
    const fakeOutUser = chosenSix.find((name) => (builds[name].moves || []).includes("Fake Out"));
    const minSpeedPivot = chosenSix.find((name) => builds[name].sp && builds[name].sp.speed === 0);

    const leads = [tauntUser, screener].filter(Boolean);
    if (leads.length) {
      const roleByName = {};
      leads.forEach((name) => { roleByName[name] = name === screener ? "screener" : "setter"; });
      if (fakeOutUser && !roleByName[fakeOutUser]) roleByName[fakeOutUser] = "setter";
      if (minSpeedPivot && !roleByName[minSpeedPivot]) roleByName[minSpeedPivot] = "support";
      const carryName = carryCandidates.find((name) => !roleByName[name]);
      if (carryName) roleByName[carryName] = "carry";
      chosenSix.forEach((name) => { if (!roleByName[name]) roleByName[name] = "support"; });

      plans.push({
        key: "trickroomdefense",
        label: "Trick Room defence",
        archetypeKeys: ["trickroomdefense"],
        roleByName,
        requiredNames: [...new Set(leads)],
      });
    }
  }

  if (!plans.length) {
    const roleByName = {};
    chosenSix.forEach((name) => { roleByName[name] = "neutral"; });
    plans.push({ key: "default", label: "Standard", archetypeKeys: [], roleByName, requiredNames: [] });
  }

  return plans;
}

/**
 * Simulates one detected game plan end to end: filters the candidate
 * lineups down to only those containing every one of the plan's
 * requiredNames (a real efficiency win, not just a correctness one --
 * with 2 required names fixed, a Doubles search is only C(4,2)=6 lineups
 * instead of the full C(6,4)=15), reorders each survivor so the plan's
 * setter/screener lead (wcOrderLineupForPlan), attaches each member's
 * role-derived AI weights (wcRoleWeightsFor) to its spec, then runs the
 * exact same successive-halving search + Mega-scenario branching
 * wcSimulateTeamWinRate always has. Returns null (never a fabricated
 * result) if this plan's required pieces genuinely can't all fit in one
 * lineup for this format -- callers filter those out.
 */
function wcSimulatePlan(plan, chosenSix, builds, format, n, pokemonList, baseStatsData, abilitiesData, oppPool, simData, comboLookup) {
  const allLineups = wcEnumerateLineups(chosenSix, n);
  const eligibleLineups = plan.requiredNames.length
    ? allLineups.filter((names) => plan.requiredNames.every((req) => names.includes(req)))
    : allLineups;
  if (!eligibleLineups.length) return null;

  const orderedLineups = eligibleLineups.map((names) => wcOrderLineupForPlan(names, plan));

  const specsByName = {};
  chosenSix.forEach((name) => {
    const base = wcBattlerSpecForSlot(name, builds[name], pokemonList, baseStatsData, abilitiesData);
    const roleWeights = wcRoleWeightsFor(plan.roleByName[name] || "neutral");
    specsByName[name] = roleWeights ? { ...base, roleWeights } : base;
  });

  const bestLineup = wcSelectBestLineupBySuccessiveHalving(orderedLineups, specsByName, oppPool, format, simData, comboLookup);

  // wcBuildMegaScenarios rebuilds specs from scratch (it needs to force
  // each scenario's Mega/base identity), so it never sees specsByName's
  // roleWeights above -- reattach them here the same way.
  const scenarios = wcBuildMegaScenarios(bestLineup, builds, pokemonList, baseStatsData, abilitiesData).map((scenario) => ({
    megaName: scenario.megaName,
    specs: scenario.specs.map((spec) => {
      const roleWeights = wcRoleWeightsFor(plan.roleByName[spec.name] || "neutral");
      return roleWeights ? { ...spec, roleWeights } : spec;
    }),
  }));
  const scenarioResults = scenarios.map((scenario) => ({
    megaName: scenario.megaName,
    ...wcRunMonteCarlo(scenario.specs, oppPool, WC_REFERENCE_RUNS_PER_OPPONENT, format, simData),
  }));

  return { key: plan.key, label: plan.label, archetypeKeys: plan.archetypeKeys, lineup: bestLineup, scenarios: scenarioResults };
}

/**
 * Top-level entry point for the Builder's Simulated Win Rate. `payload`
 * carries the user's built 6 (`chosenSix` + `builds`), format/sheetMode,
 * every data file the engine needs, the Worlds-grounded reference field
 * (`metaBaseline`, see data/meta-baseline.json + battle-sim-
 * baseline.js), and (Milestone 34 follow-up) `liveTierStats` -- the same
 * live_tier_stats lookup that already augments the threats list
 * (wcFetchLiveTierStats in teams.js), used here to weight how often each
 * reference team gets sampled, never to add a new one (see
 * wcLiveUsageWeightForTeam in strategy.js).
 *
 * Milestone 48: rather than picking one lineup for the whole built 6 and
 * running one generic-AI simulation, this now detects every real game
 * plan the team can run (wcBuildGamePlans) and simulates each separately
 * (wcSimulatePlan -- same real-engine successive-halving search
 * (Milestone 35 Task 1) + Mega-scenario branching as always, just scoped
 * to that plan's own lineups and role-weighted AI). A team with no real
 * archetype/anti-Trick-Room signal still gets exactly one plan back
 * ("Standard", see wcBuildGamePlans), so `plans` is never empty and the
 * return shape below is uniform regardless of how many real plans exist.
 */
function wcSimulateTeamWinRate(payload) {
  const {
    chosenSix, builds, format, sheetMode,
    pokemonList, baseStatsData, abilitiesData, movesData,
    moveEffects, abilityEffects, itemEffects, typeChart, natures,
    metaBaseline, comboLookup, liveTierStats,
  } = payload;
  const n = format === "singles" ? 3 : 4;

  const referenceTeamDefs = (metaBaseline && metaBaseline[format]) || [];
  const referenceTeams = referenceTeamDefs.map((team) => wcResolveBaselineTeam(team, pokemonList, baseStatsData, abilitiesData));

  // Milestone 34 follow-up: a reference team whose real members are
  // currently winning a lot in live Regulation M-B tournaments gets
  // sampled somewhat more often (see wcLiveUsageWeightForTeam in
  // strategy.js) -- never a new opponent, just how often an already-
  // trusted one gets battled. Neutral (1) with no live data, so this is
  // exactly today's behavior until the pipeline has something to offer.
  const oppPool = referenceTeamDefs.map((team, i) => ({
    id: team.id,
    label: team.label,
    specs: referenceTeams[i],
    weight: wcLiveUsageWeightForTeam(team.members, liveTierStats),
  }));
  // format included so screens (Light Screen/Reflect/Aurora Veil) apply
  // the real Doubles/Singles-correct damage reduction -- see
  // wcResolveOneHit/wcScreensModifierFor, battle-sim-engine.js.
  const simData = { movesData, moveEffects, abilityEffects, itemEffects, typeChart, natures, sheetMode, format };

  const plans = wcBuildGamePlans(chosenSix, builds, pokemonList, baseStatsData, abilitiesData)
    .map((plan) => wcSimulatePlan(plan, chosenSix, builds, format, n, pokemonList, baseStatsData, abilitiesData, oppPool, simData, comboLookup))
    .filter(Boolean);

  return { format, plans };
}

/** Picks a team's own best lineup using the OTHER team's real built 6 as the reference set — a real head-to-head, not the general meta-baseline field. Used by wcSimulateTeamVsTeam (Battle Tracker). */
function wcBestLineupAgainstReference(chosenSix, builds, referenceChosen, referenceBuilds, format, data) {
  const n = format === "singles" ? 3 : 4;
  const lineups = wcEnumerateLineups(chosenSix, n);
  const specsByName = {};
  chosenSix.forEach((name) => {
    specsByName[name] = wcBattlerSpecForSlot(name, builds[name], data.pokemonList, data.baseStatsData, data.abilitiesData);
  });
  const referenceSpecs = referenceChosen.map((name) =>
    wcBattlerSpecForSlot(name, referenceBuilds[name], data.pokemonList, data.baseStatsData, data.abilitiesData)
  );
  const ranked = wcRankLineupsHeuristic(lineups, specsByName, [referenceSpecs], data, data.comboLookup);
  return ranked[0].names;
}

/**
 * Top-level entry point for the Battle Tracker's Team vs Team matchup
 * table: two real, user-built teams head-to-head (not vs. the
 * meta-baseline field). `payload.teamA`/`teamB` are { chosen, builds,
 * label }. Returns a small win-rate grid — 1 cell normally, up to a 2x2
 * grid when either side has 2 Mega scenarios.
 */
function wcSimulateTeamVsTeam(payload) {
  const {
    teamA, teamB, format, sheetMode,
    pokemonList, baseStatsData, abilitiesData, movesData,
    moveEffects, abilityEffects, itemEffects, typeChart, natures, comboLookup,
  } = payload;
  const data = { pokemonList, baseStatsData, abilitiesData, movesData, typeChart, natures, sheetMode, comboLookup };

  const lineupA = wcBestLineupAgainstReference(teamA.chosen, teamA.builds, teamB.chosen, teamB.builds, format, data);
  const lineupB = wcBestLineupAgainstReference(teamB.chosen, teamB.builds, teamA.chosen, teamA.builds, format, data);

  const scenariosA = wcBuildMegaScenarios(lineupA, teamA.builds, pokemonList, baseStatsData, abilitiesData);
  const scenariosB = wcBuildMegaScenarios(lineupB, teamB.builds, pokemonList, baseStatsData, abilitiesData);

  // Milestone 48: `format` is threaded through so screens (Light Screen/
  // Reflect/Aurora Veil) apply the real Doubles/Singles-correct damage
  // reduction here too, not just in the new game-plan-aware Simulated Win
  // Rate below -- see wcResolveOneHit/wcScreensModifierFor, battle-sim-
  // engine.js.
  const simData = { movesData, moveEffects, abilityEffects, itemEffects, typeChart, natures, sheetMode, format };
  const grid = [];
  scenariosA.forEach((sa) => {
    scenariosB.forEach((sb) => {
      const result = wcRunMonteCarlo(
        sa.specs,
        [{ id: "opponent", label: teamB.label || "Opponent", specs: sb.specs }],
        WC_TEAMVSTEAM_RUNS_PER_OPPONENT,
        format,
        simData
      );
      grid.push({ megaA: sa.megaName, megaB: sb.megaName, winRateA: result.winRate });
    });
  });

  return { lineupA, lineupB, format, grid };
}
