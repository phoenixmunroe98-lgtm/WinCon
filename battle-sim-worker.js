// WinCon — battle-sim-worker.js (Simulated Win Rate)
//
// Runs the actual simulation off the main thread — a Simulated Win Rate
// scenario is ~2,800 simulated mini-battles (see battle-sim-lineup.js's
// WC_REFERENCE_RUNS_PER_OPPONENT) and a Team vs Team matchup is ~3,000+,
// which would visibly freeze the page if run inline. Classic Worker
// (importScripts, no bundler) — matches this repo's plain <script src>
// architecture; no build step changes needed.
//
// Every file here is already DOM-free (the same reason strategy.js/
// stats.js/type-utils.js can be loaded standalone in a plain Node `vm`
// context for testing — see /opt/node-tools/test-strategy-m6.mjs), so
// nothing needed to change to make them Worker-safe.

importScripts(
  "type-utils.js",
  "stats.js",
  "megas.js",
  "strategy.js",
  "battle-stages.js",
  "battle-damage.js",
  "battle-turn-order.js",
  "battle-sim-baseline.js",
  "battle-sim-engine.js",
  "battle-sim-ai.js",
  "battle-sim-lineup.js"
);

self.onmessage = (event) => {
  const { requestId, type, payload } = (event && event.data) || {};
  try {
    let result;
    if (type === "simulateWinRate") result = wcSimulateTeamWinRate(payload);
    else if (type === "teamVsTeam") result = wcSimulateTeamVsTeam(payload);
    else if (type === "matchupRead") {
      // Milestone 54, Part C: narrates an ALREADY-COMPUTED teamVsTeam
      // result (payload.result) -- runs no new simulation, just builds
      // the same real wcBattlerSpecForSlot specs the simulator itself
      // used and hands them to wcMatchupReadReport (battle-sim-lineup.js).
      const { teamA, teamB, result: simResult, pokemonList, baseStatsData, abilitiesData, natures, typeChart } = payload;
      const specsFor = (lineup, team) =>
        lineup.map((name) => wcBattlerSpecForSlot(name, team.builds[name], pokemonList, baseStatsData, abilitiesData));
      const teamASpecs = specsFor(simResult.lineupA, teamA);
      const teamBSpecs = specsFor(simResult.lineupB, teamB);
      result = wcMatchupReadReport(simResult, teamA.label || "Team A", teamB.label || "Team B", teamASpecs, teamBSpecs, natures, typeChart);
    } else if (type === "battlePlan") {
      // Milestone 54, Part D -- wcBattlePlanReport lives in strategy.js
      // (only loaded here in the worker, see this file's own header), so
      // this routes through the same postMessage pattern as the other
      // report types above rather than duplicating it on the main thread.
      const { userMembers, userBuilds, opponentThreats, movesData, typeChart, format, abilitiesData, natures } = payload;
      result = wcBattlePlanReport(userMembers, userBuilds, opponentThreats, movesData, typeChart, format, abilitiesData, natures);
    } else throw new Error(`battle-sim-worker: unknown message type "${type}"`);
    self.postMessage({ requestId, type: "result", result });
  } catch (err) {
    self.postMessage({ requestId, type: "error", error: (err && err.message) || String(err) });
  }
};
