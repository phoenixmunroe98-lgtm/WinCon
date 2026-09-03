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
    else throw new Error(`battle-sim-worker: unknown message type "${type}"`);
    self.postMessage({ requestId, type: "result", result });
  } catch (err) {
    self.postMessage({ requestId, type: "error", error: (err && err.message) || String(err) });
  }
};
