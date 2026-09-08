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

// wcEnumerateLineups/wcRankLineupsHeuristic moved to strategy.js
// (Milestone 56) -- they have zero real battle-sim dependency (only
// wcScoreMatchup/wcComboSynergyBonus, both already in strategy.js), and
// Team Strategy Report/Rival Breakdown need them on the Builder page's
// main thread, which never loads this file. strategy.js loads before
// this file everywhere it matters (this Worker's own importScripts
// list included), so every call below still resolves exactly as before.

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
// wcSimulateTeamWinRate below fully simulates every real n-of-6 lineup
// combination directly (Milestone 57) -- a plan's own role-weighted AI and
// lead order (wcPlansForCombo/wcSimulateOneCombo) are applied to whichever
// specific real combo genuinely satisfies that plan's required pieces, so
// a team that can genuinely run more than one real line (Phoenix's example
// team can lead Tailwind into either Mega Sceptile or Mega Charizard Y --
// or, Milestone 60, a single dual-move setter that can genuinely run
// EITHER Tailwind or Trick Room off the same four Pokemon) gets each of
// its real combos -- and, per combo, each real matching plan -- reported
// on its own honest simulated merits, never blended into one generic-AI
// number and never narrowed to a single plan per combo before simulating
// it.
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
 * situational score for every role. The setter's own up-score boost
 * (Tailwind vs Trick Room) is scoped separately below, by archetype --
 * see WC_SETTER_ARCHETYPE_UP_SCORE.
 */
const WC_GAME_PLAN_ROLE_WEIGHT_OVERRIDES = {
  setter: { screensUpScore: 60, protectLowHpScore: 75, protectHighHpScore: 45 },
  screener: { screensUpScore: 75, protectLowHpScore: 75, protectHighHpScore: 45 },
  carry: { selfBoostHealthyScore: 45, selfBoostLowScore: 20 },
  support: {},
  neutral: {},
};

/**
 * Milestone 60 (Phoenix: a real dual-purpose setter -- Whimsicott built
 * with BOTH Tailwind and Trick Room, on purpose, so the same Pokemon can
 * slot into either her real Tailwind team or her real Trick Room team).
 * The setter role's up-score boost used to be one flat object boosting
 * BOTH tailwindUpScore and trickRoomUpScore together, regardless of
 * which archetype a plan actually represented -- so a dual-move
 * setter's simulated battle always favored Tailwind (its higher
 * WC_DEFAULT_AI_WEIGHTS baseline) no matter which plan label was
 * nominally attached, making "Trick Room (carry: X)" a cosmetic label
 * with no real behavioral difference underneath it. Scoped by archetype
 * instead: a tailwind__X plan's setter gets ONLY its tailwindUpScore
 * boosted, a trickroom__X plan's setter gets ONLY its trickRoomUpScore
 * boosted -- so the AI genuinely prioritizes casting the ONE move the
 * plan it's actually running is built around.
 */
const WC_SETTER_ARCHETYPE_UP_SCORE = {
  tailwind: { tailwindUpScore: 90 },
  trickroom: { trickRoomUpScore: 90 },
};

/** Merged { ...WC_DEFAULT_AI_WEIGHTS, ...override } for a role, or null when there's no real override to apply (so the spec doesn't carry a pointless identical-to-default weights object). `archetypeKey` (the winning plan's own archetypeKeys[0], e.g. "tailwind"/"trickroom") scopes the setter's own up-score boost to whichever ONE archetype this specific plan is actually built around -- see WC_SETTER_ARCHETYPE_UP_SCORE above; any other role, or a setter with no matching archetype entry (e.g. the defensive "trickroomdefense" plan's lead), just gets the flat role override with no up-score boost added. */
function wcRoleWeightsFor(role, archetypeKey) {
  const baseOverride = WC_GAME_PLAN_ROLE_WEIGHT_OVERRIDES[role];
  const setterArchetypeOverride = role === "setter" ? WC_SETTER_ARCHETYPE_UP_SCORE[archetypeKey] : null;
  const merged = { ...(baseOverride || {}), ...(setterArchetypeOverride || {}) };
  if (Object.keys(merged).length === 0) return null;
  return { ...WC_DEFAULT_AI_WEIGHTS, ...merged };
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
function wcBuildGamePlans(chosenSix, builds, pokemonList, baseStatsData, abilitiesData, notes) {
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
    // Milestone 49: team notes now genuinely influence which real setter
    // candidate gets the role, same mechanism (wcPreferredSetter) the
    // Auto-build-strategy UI already trusts elsewhere in this project --
    // this used to hardcode "" here, so a user's own notes had zero
    // effect on the new game-plan simulation specifically (a real gap,
    // now closed).
    const { setter } = wcPreferredSetter(setterPool.map((name) => ({ name })), notes, (pool) => pool[0]);

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
 * Milestone 57 (Phoenix: "run a win rate for each combination of 4...
 * ensure that you attempt the sim with all combinations"). Which
 * already-detected real game plan(s) can THIS EXACT raw combo genuinely
 * run -- checked directly against the combo's own real member names,
 * not against whichever single lineup a search happened to settle on.
 *
 * Milestone 60 (Phoenix: a real dual-purpose setter -- Whimsicott built
 * with BOTH Tailwind and Trick Room on purpose, so the same Pokemon can
 * anchor either her real Tailwind team or her real Trick Room team).
 * When a setter has two signature moves built, wcBuildGamePlans pushes
 * TWO separate plan objects for the same carry (tailwind__X and
 * trickroom__X) with byte-identical requiredNames -- so a combo genuinely
 * qualifies for BOTH at once. The old version of this function used
 * `Array.prototype.find`, which always returns the FIRST match in
 * wcBuildGamePlans's own push order (tailwind is always pushed before
 * trickroom) -- meaning Trick Room could structurally never be chosen
 * for a dual-move setter's combos, no matter how well it would actually
 * perform. Returns EVERY real matching plan now (or `[null]` when none
 * match -- still simulated for real below, just with no role-weighted
 * AI/lead order applied), so wcSimulateOneCombo can genuinely simulate
 * each candidate and report whichever one actually wins the most.
 */
function wcPlansForCombo(comboNames, plans) {
  const matches = plans.filter((plan) => plan.requiredNames.every((req) => comboNames.includes(req)));
  return matches.length ? matches : [null];
}

/**
 * Simulates one real n-of-6 combination end to end with the real engine
 * -- no shortcut, no proxy score, no elimination round. Orders its
 * members (wcOrderLineupForPlan) and attaches role-weighted AI
 * (wcRoleWeightsFor) only when this exact combo genuinely matches a real
 * detected plan; otherwise it's simulated with the plain default AI,
 * same as the "Standard" case always was. Builds the real 1-3 Mega
 * scenarios (wcBuildMegaScenarios -- exactly one real Mega per battle,
 * never two at once) and runs the full WC_REFERENCE_RUNS_PER_OPPONENT-
 * per-opponent simulation for EVERY scenario; this combo's own reported
 * result is whichever scenario scored highest, the same "which Mega, if
 * any, is genuinely best for this exact lineup" question Battle Plan/
 * Battle Tracker already settle by real simulated result rather than a
 * guess.
 *
 * Milestone 60 (Phoenix: a real dual-purpose setter carrying both
 * Tailwind and Trick Room). A combo can now genuinely match MORE THAN
 * ONE real plan at once (wcPlansForCombo) -- e.g. the same four
 * Pokemon read as a Tailwind lineup or a Trick Room lineup depending on
 * which move the setter actually opens with. Rather than picking one
 * label arbitrarily, this runs a REAL simulation for every candidate
 * plan (each with its own archetype-scoped AI weights, via the new
 * `archetypeKey` passed to wcRoleWeightsFor -- a Trick Room plan's
 * setter genuinely prioritizes casting Trick Room, not Tailwind, in
 * battle) crossed with every real Mega scenario, and reports whichever
 * single (plan x Mega) combination actually won the most -- so a plan
 * label like "Trick Room" reflects a genuine simulated outcome, never
 * just array order.
 */
function wcSimulateOneCombo(rawNames, builds, format, pokemonList, baseStatsData, abilitiesData, oppPool, simData, plans) {
  const candidatePlans = wcPlansForCombo(rawNames, plans);

  const scenarioResults = candidatePlans.flatMap((plan) => {
    const orderedNames = plan ? wcOrderLineupForPlan(rawNames, plan) : rawNames;
    const archetypeKey = plan && plan.archetypeKeys && plan.archetypeKeys[0];

    return wcBuildMegaScenarios(orderedNames, builds, pokemonList, baseStatsData, abilitiesData).map((scenario) => {
      const specs = scenario.specs.map((spec) => {
        const roleWeights = plan ? wcRoleWeightsFor(plan.roleByName[spec.name] || "neutral", archetypeKey) : null;
        return roleWeights ? { ...spec, roleWeights } : spec;
      });
      return {
        planLabel: plan ? plan.label : null,
        lineup: orderedNames,
        megaName: scenario.megaName,
        ...wcRunMonteCarlo(specs, oppPool, WC_REFERENCE_RUNS_PER_OPPONENT, format, simData),
      };
    });
  });
  const best = scenarioResults.reduce((a, b) => (b.winRate > a.winRate ? b : a));

  return {
    lineup: best.lineup,
    planLabel: best.planLabel,
    megaName: best.megaName,
    winRate: best.winRate,
    wins: best.wins,
    losses: best.losses,
    draws: best.draws,
    totalRuns: best.totalRuns,
    perOpponent: best.perOpponent,
  };
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
 * Milestone 57 (Phoenix: her own two real, tournament-successful lineups
 * never showed up under the old Milestone 35/48 approach -- a cheap
 * heuristic search narrowed 15/20 real candidates down to one lineup per
 * detected plan before ever running a full simulation, so a real lineup
 * either got eliminated by the light sampling rounds or was never even a
 * candidate because it didn't match whichever single setter/carry
 * pairing that plan required). This now runs the real engine on every
 * single real C(6,4)=15 (Doubles) or C(6,3)=20 (Singles) combination
 * directly -- nothing narrowed, nothing excluded for not fitting one
 * detected strategy. Each combo still gets real, archetype-aware AI/lead
 * order for EVERY real detected game plan it genuinely qualifies for
 * (wcBuildGamePlans/wcPlansForCombo/wcSimulateOneCombo -- Milestone 60: a
 * combo can genuinely qualify for more than one plan at once, e.g. a
 * dual-move Tailwind+Trick Room setter, and each is really simulated
 * rather than the first one arbitrarily winning), crossed with its own
 * real Mega-scenario branching exactly as before -- only the "narrow
 * down to one via a cheap search" step is gone, replaced with "simulate
 * all of them, honestly, and rank what comes back." `combos` always has exactly
 * C(6,4)/C(6,3) entries, sorted by real win rate (most successful
 * first); `averageWinRate` is the plain mean across all of them. Note:
 * `payload.comboLookup` (the cross-user logged-battle combo synergy
 * lookup) is no longer consumed here -- it existed only to nudge the old
 * cheap search toward proven combos before a full simulation could run;
 * now every combo gets a full, real simulation directly, so the real
 * result itself is the authoritative signal and no proxy nudge is
 * needed. wcRankLineupsHeuristic/wcBestLineupAgainstReference (used by
 * the Battle Tracker's Team vs Team tool) still use it as before.
 */
function wcSimulateTeamWinRate(payload) {
  const {
    chosenSix, builds, format, sheetMode, notes,
    pokemonList, baseStatsData, abilitiesData, movesData,
    moveEffects, abilityEffects, itemEffects, typeChart, natures,
    metaBaseline, liveTierStats,
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

  const plans = wcBuildGamePlans(chosenSix, builds, pokemonList, baseStatsData, abilitiesData, notes);
  const allLineups = wcEnumerateLineups(chosenSix, n);
  const combos = allLineups
    .map((rawNames) => wcSimulateOneCombo(rawNames, builds, format, pokemonList, baseStatsData, abilitiesData, oppPool, simData, plans))
    .sort((a, b) => b.winRate - a.winRate);

  const averageWinRate = combos.length ? combos.reduce((sum, c) => sum + c.winRate, 0) / combos.length : 0;

  return { format, n, combos, averageWinRate };
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


// ---------------------------------------------------------------------------
// Milestone 54, Part C: Matchup Read -- a WinCon-native answer to a
// request for a "Win Rate Calculator AI," with no external AI involved
// (see README's Milestone 54 section). Per this session's own earlier
// decision, this narrates the REAL simulated result wcSimulateTeamVsTeam
// just above already computed -- nothing here runs a new simulation,
// guesses a number, or reasons independently about the matchup; it only
// reads the real grid back out in plain English, plus a confidence read
// computed from that grid's own real spread and a real Speed/type
// comparison between the two chosen lineups.
// ---------------------------------------------------------------------------

/**
 * @param result - wcSimulateTeamVsTeam's own return value ({lineupA, lineupB, format, grid})
 * @param teamASpecs/teamBSpecs - wcBattlerSpecForSlot(...) for every member of result.lineupA/lineupB (name/types/baseStats/build)
 */
function wcMatchupReadReport(result, teamALabel, teamBLabel, teamASpecs, teamBSpecs, natures, typeChart) {
  const grid = result && result.grid;
  if (!grid || grid.length === 0) return null;

  // The headline: the "neither side has committed to a Mega" cell when
  // one exists (the real, unforced default), else just the grid's own
  // first real cell.
  const defaultCell = grid.find((c) => !c.megaA && !c.megaB) || grid[0];
  const headlinePct = Math.round(defaultCell.winRateA * 100);

  // Confidence: the real spread across every already-computed cell's win
  // rate. A tight spread means the Mega choice barely moves the number
  // (high confidence in the headline); a wide spread means the headline
  // depends heavily on a Mega decision that hasn't happened yet in-game
  // (honestly lower confidence in that one number, not in the engine).
  const winRates = grid.map((c) => c.winRateA);
  const spreadPct = (Math.max(...winRates) - Math.min(...winRates)) * 100;
  const confidence = spreadPct <= 10 ? "high" : spreadPct <= 25 ? "medium" : "low";

  // ---- Simulation Logic ----
  const simulationLogicLines = [];
  const speedOf = (spec) => {
    if (!spec || !spec.build || !spec.build.sp || !spec.baseStats) return null;
    return wcCalcStat(spec.baseStats.spe, "speed", spec.build.sp.speed || 0, spec.build.nature, natures);
  };
  const speedsA = (teamASpecs || []).map((s) => ({ name: s.name, speed: speedOf(s) })).filter((s) => s.speed != null);
  const speedsB = (teamBSpecs || []).map((s) => ({ name: s.name, speed: speedOf(s) })).filter((s) => s.speed != null);
  if (speedsA.length && speedsB.length) {
    const fastestA = speedsA.reduce((a, b) => (b.speed > a.speed ? b : a));
    const fastestB = speedsB.reduce((a, b) => (b.speed > a.speed ? b : a));
    if (fastestA.speed === fastestB.speed) {
      simulationLogicLines.push(
        `${teamALabel}'s fastest real Speed (${fastestA.name}, ${fastestA.speed}) exactly ties ${teamBLabel}'s fastest (${fastestB.name}, ${fastestB.speed}) -- a real speed tie, decided by the game's own tiebreak rather than a clean edge.`
      );
    } else if (fastestA.speed > fastestB.speed) {
      simulationLogicLines.push(
        `${teamALabel}'s fastest real Speed (${fastestA.name}, ${fastestA.speed}) outpaces ${teamBLabel}'s fastest (${fastestB.name}, ${fastestB.speed}) -- a real Speed-tier edge on paper.`
      );
    } else {
      simulationLogicLines.push(
        `${teamBLabel}'s fastest real Speed (${fastestB.name}, ${fastestB.speed}) outpaces ${teamALabel}'s fastest (${fastestA.name}, ${fastestA.speed}) -- ${teamALabel} is at a real Speed-tier disadvantage on paper.`
      );
    }
  }

  if (typeChart && teamASpecs && teamBSpecs) {
    let favorsA = 0;
    let favorsB = 0;
    teamASpecs.forEach((a) => {
      teamBSpecs.forEach((b) => {
        const aAdvantage = (a.types || []).some((t) => wcEffectivenessOf(typeChart, t, b.types) > 1);
        const bAdvantage = (b.types || []).some((t) => wcEffectivenessOf(typeChart, t, a.types) > 1);
        if (aAdvantage && !bAdvantage) favorsA += 1;
        else if (bAdvantage && !aAdvantage) favorsB += 1;
      });
    });
    simulationLogicLines.push(
      favorsA === favorsB
        ? `Type matchups across both lineups are roughly balanced by typing alone (${favorsA} pairings favor ${teamALabel}, ${favorsB} favor ${teamBLabel}).`
        : favorsA > favorsB
          ? `${teamALabel}'s typing has more real one-sided advantages across this matchup (${favorsA} pairings favor ${teamALabel} by typing vs. ${favorsB} for ${teamBLabel}).`
          : `${teamBLabel}'s typing has more real one-sided advantages across this matchup (${favorsB} pairings favor ${teamBLabel} by typing vs. ${favorsA} for ${teamALabel}).`
    );
  }

  // ---- Pivot Points ----
  // Not invented -- read directly off the real grid. Every other cell
  // already computed becomes a candidate pivot sentence; the ones with
  // the largest real delta from the headline are surfaced.
  const pivotCandidates = grid
    .filter((c) => c !== defaultCell)
    .map((c) => ({ cell: c, newPct: Math.round(c.winRateA * 100), deltaPct: Math.round(c.winRateA * 100) - headlinePct }))
    .filter((p) => p.deltaPct !== 0)
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 3);

  const pivotPointLines = pivotCandidates.map((p) => {
    const megaAText = p.cell.megaA ? `${teamALabel} Mega-Evolves ${p.cell.megaA}` : null;
    const megaBText = p.cell.megaB ? `${teamBLabel} Mega-Evolves ${p.cell.megaB}` : null;
    const conditionText = [megaAText, megaBText].filter(Boolean).join(" and ");
    const directionWord = p.deltaPct > 0 ? "rises to" : "drops to";
    return conditionText
      ? `If ${conditionText}, ${teamALabel}'s win rate ${directionWord} ~${p.newPct}%.`
      : `A different real scenario in the simulated grid moves the win rate to ~${p.newPct}%.`;
  });
  if (pivotPointLines.length === 0) {
    pivotPointLines.push(
      "No Mega-Evolution choice meaningfully changes the win rate here -- every scenario this app actually simulated landed close to the headline number."
    );
  }

  return {
    headlinePct,
    confidence,
    confidenceNote: `A simulated estimate from ${grid.length * WC_TEAMVSTEAM_RUNS_PER_OPPONENT} real battles (${WC_TEAMVSTEAM_RUNS_PER_OPPONENT} Monte-Carlo runs per real Mega scenario), not a guaranteed outcome.`,
    simulationLogicLines,
    pivotPointLines,
  };
}
