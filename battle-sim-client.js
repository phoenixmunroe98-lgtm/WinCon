// WinCon — battle-sim-client.js (Simulated Win Rate)
//
// Thin Promise wrapper around battle-sim-worker.js, shared by both
// Builder pages (Simulated Win Rate) and the Battle Tracker (Team vs
// Team matchup table) so neither duplicates the postMessage/requestId
// bookkeeping. Lazily creates one Worker per page and reuses it.

let wcSimWorker = null;
let wcSimRequestCounter = 0;
const wcSimPending = new Map();

function wcGetSimWorker() {
  if (!wcSimWorker) {
    wcSimWorker = new Worker("battle-sim-worker.js");
    wcSimWorker.onmessage = (event) => {
      const { requestId, type, result, error } = (event && event.data) || {};
      const pending = wcSimPending.get(requestId);
      if (!pending) return;
      wcSimPending.delete(requestId);
      if (type === "error") pending.reject(new Error(error));
      else pending.resolve(result);
    };
    wcSimWorker.onerror = (event) => {
      // A worker-level (uncaught) error doesn't carry a requestId back —
      // reject every still-pending call rather than hanging the UI.
      wcSimPending.forEach((pending) => pending.reject(new Error((event && event.message) || "Simulation worker error")));
      wcSimPending.clear();
    };
  }
  return wcSimWorker;
}

/**
 * @param type "simulateWinRate" | "teamVsTeam" (see battle-sim-lineup.js's
 *   wcSimulateTeamWinRate / wcSimulateTeamVsTeam for the payload/result shapes).
 * @returns Promise resolving to that call's result, rejecting on any
 *   error the worker throws or a worker-level failure.
 */
function wcRunSimAsync(type, payload) {
  return new Promise((resolve, reject) => {
    const requestId = `sim-${(wcSimRequestCounter += 1)}`;
    wcSimPending.set(requestId, { resolve, reject });
    wcGetSimWorker().postMessage({ requestId, type, payload });
  });
}
