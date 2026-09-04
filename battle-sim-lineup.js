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

/**
 * Top-level entry point for the Builder's Simulated Win Rate. `payload`
 * carries the user's built 6 (`chosenSix` + `builds`), format/sheetMode,
 * every data file the engine needs, and the Worlds-grounded reference
 * field (`metaBaseline`, see data/meta-baseline.json + battle-sim-
 * baseline.js). Picks the best lineup via a real-engine successive-
 * halving search (wcSelectBestLineupBySuccessiveHalving, Milestone 35
 * Task 1 -- see its own doc comment for why), then runs the real Monte
 * Carlo simulation at full accuracy on it once per Mega scenario — see
 * the plan's "Bring-N lineup selection" section for why only the
 * winning combo gets the expensive full simulation.
 */
function wcSimulateTeamWinRate(payload) {
  const {
    chosenSix, builds, format, sheetMode,
    pokemonList, baseStatsData, abilitiesData, movesData,
    moveEffects, abilityEffects, itemEffects, typeChart, natures,
    metaBaseline, comboLookup,
  } = payload;
  const n = format === "singles" ? 3 : 4;
  const lineups = wcEnumerateLineups(chosenSix, n);

  const specsByName = {};
  chosenSix.forEach((name) => {
    specsByName[name] = wcBattlerSpecForSlot(name, builds[name], pokemonList, baseStatsData, abilitiesData);
  });

  const referenceTeamDefs = (metaBaseline && metaBaseline[format]) || [];
  const referenceTeams = referenceTeamDefs.map((team) => wcResolveBaselineTeam(team, pokemonList, baseStatsData, abilitiesData));

  const oppPool = referenceTeamDefs.map((team, i) => ({ id: team.id, label: team.label, specs: referenceTeams[i] }));
  const simData = { movesData, moveEffects, abilityEffects, itemEffects, typeChart, natures, sheetMode };

  const bestLineup = wcSelectBestLineupBySuccessiveHalving(lineups, specsByName, oppPool, format, simData, comboLookup);

  const scenarios = wcBuildMegaScenarios(bestLineup, builds, pokemonList, baseStatsData, abilitiesData);
  const scenarioResults = scenarios.map((scenario) => ({
    megaName: scenario.megaName,
    ...wcRunMonteCarlo(scenario.specs, oppPool, WC_REFERENCE_RUNS_PER_OPPONENT, format, simData),
  }));

  return { lineup: bestLineup, format, scenarios: scenarioResults };
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

  const simData = { movesData, moveEffects, abilityEffects, itemEffects, typeChart, natures, sheetMode };
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
