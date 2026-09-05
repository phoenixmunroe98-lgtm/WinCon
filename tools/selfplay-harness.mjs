#!/usr/bin/env node
// WinCon — tools/selfplay-harness.mjs (Milestone 35, Tasks 2 & 3)
//
// Dev-only CLI. Never imported by the site's HTML pages, never loaded by
// battle-sim-worker.js — this exists purely so battle simulation can be
// exercised, and (as of Task 3) trained against itself, outside a browser.
//
// battle-sim-engine.js and battle-sim-ai.js are already pure, DOM-free
// JavaScript — built that way so they can run inside a Web Worker with no
// access to the DOM (see those files' own header comments, and battle-sim-
// worker.js's importScripts list). That also means they run directly under
// plain Node with no browser at all: this script loads the exact same
// module files the real Worker loads (via fs.readFileSync into one shared
// vm context, in the same order) and calls the exact same wcRunOneBattle
// the Worker's Monte Carlo aggregation uses.
//
// Two modes:
//   node tools/selfplay-harness.mjs [normal flags]
//     Plain battle mode (Task 2): runs --battles battles between --team-a
//     and --team-b, each side using an independently-named policy
//     ("heuristic" — wcChooseAiMove unmodified, or "weighted" — the Task 3
//     learnable sibling, wcChooseAiMoveWeighted, fed weights from
//     --policy-weights or data/policy-weights.json). Reports win/loss/draw.
//
//   node tools/selfplay-harness.mjs --search [search flags]
//     Weight-search mode (Task 3): hill-climbs data/policy-weights.json
//     against itself via self-play, then gates any improvement against the
//     real, unmodified production heuristic before ever touching the file
//     on disk. See the "Weight search (Task 3)" section below for the full
//     algorithm and every flag's meaning.
//
// Usage:
//   node tools/selfplay-harness.mjs
//   node tools/selfplay-harness.mjs --battles 1000 \
//     --team-a tools/fixtures/team-kingambit-sun.json \
//     --team-b tools/fixtures/team-hyper-offense.json \
//     --sheet-mode closed --seed 42
//   node tools/selfplay-harness.mjs --search --search-iterations 60 \
//     --gate-battles 3000
//
// Run with no arguments and it battles the two bundled example fixtures
// 200 times. --help prints the full flag list.
//
// ---------------------------------------------------------------------------
// Testability (Task 3)
//
// Everything below that touches process.argv, the filesystem beyond the
// pure-data loads, or prints to the console lives inside main(), which only
// runs when this file is executed directly (see the isMainModule guard at
// the bottom) — importing this module (e.g. from a test file) never parses
// CLI args, never runs a battle, and never writes anything.
//
// The pure weight-search/gate math — perturbOneWeight, acceptRound, and
// computeGateVerdict — is exported and has zero dependency on the vm
// context, the battle engine, or the filesystem: each takes plain numbers/
// objects and returns plain numbers/objects, so a test can exercise the
// search algorithm itself with fully controlled, fake win/loss counts,
// exactly the way tools/test-lineup-search.mjs stubs wcRunMonteCarlo to
// test wcSelectBestLineupBySuccessiveHalving's own logic in isolation. See
// tools/test-weight-search.mjs.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Pure weight-search / gate logic — no vm, no fs, no battle engine. See the
// "Testability" note above.
// ---------------------------------------------------------------------------

/**
 * Milestone 35, Task 3 — payoffs that are pinned at 0 in WC_DEFAULT_AI_WEIGHTS
 * because they score an already-redundant action (see battle-sim-ai.js's own
 * doc comment on WC_DEFAULT_AI_WEIGHTS). A multiplicative perturbation can't
 * move a 0 anyway, so this exists to document the exclusion explicitly
 * rather than leave it as an accidental side effect of the perturbation math.
 */
export const WC_NON_PERTURBABLE_AI_WEIGHT_KEYS = new Set(["tailwindAlreadyUpScore", "trickRoomAlreadyUpScore", "statusUntargetableScore", "screensAlreadyUpScore"]);

/**
 * The searchable subset of a weights object's own keys — every key except
 * the pinned-at-zero ones above. Computed from whatever weights object is
 * actually in use (not hardcoded against WC_DEFAULT_AI_WEIGHTS's exact key
 * list) so a future new weight automatically becomes perturbable without
 * this file needing an edit.
 */
export function perturbableKeysOf(weights) {
  return Object.keys(weights).filter((key) => !WC_NON_PERTURBABLE_AI_WEIGHT_KEYS.has(key));
}

/**
 * One hill-climbing step: pick a single random key from `keys` and return a
 * NEW weights object (never mutates `weights`) with that one key multiplied
 * by `1 + (rng()*2-1) * step` — e.g. step=0.2 moves the chosen weight by up
 * to ±20%. Single-key perturbation (rather than jittering every weight at
 * once) keeps each round easy to reason about and log: "round 7 tried
 * protectLowHpScore ×1.14" is a legible experiment; jittering all 20 numbers
 * every round would not be.
 *
 * `rng` must return a float in [0, 1) — takes one draw for which key to
 * perturb and one draw for the perturbation factor.
 */
export function perturbOneWeight(weights, keys, step, rng) {
  if (keys.length === 0) throw new Error("perturbOneWeight: no perturbable keys given");
  const key = keys[Math.floor(rng() * keys.length) % keys.length];
  const factor = 1 + (rng() * 2 - 1) * step;
  const candidate = { ...weights, [key]: weights[key] * factor };
  return { weights: candidate, key, factor };
}

/**
 * The literal acceptance rule from the task: "keep the perturbation only if
 * it wins more than the current best over N battles." Draws count for
 * neither side — a round where the candidate doesn't strictly out-win the
 * current best is rejected, including exact ties.
 */
export function acceptRound(candidateWins, currentBestWins) {
  return candidateWins > currentBestWins;
}

/**
 * The strict evaluation gate: a candidate only clears it if it beats the
 * real, unmodified production heuristic by a REAL, STATED margin (percentage
 * points of win rate), not by an amount noise alone could produce. Win rates
 * are 0..1 fractions; `marginPercentagePoints` and the returned
 * `deltaPercentagePoints` are on the 0..100 scale, since "3 percentage
 * points" reads far more clearly in a log line than "0.03".
 */
export function computeGateVerdict(candidateWinRate, baselineWinRate, marginPercentagePoints) {
  const deltaPercentagePoints = (candidateWinRate - baselineWinRate) * 100;
  return { pass: deltaPercentagePoints >= marginPercentagePoints, deltaPercentagePoints };
}

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — deterministic and dependency-free; good enough
// for reproducible harness runs, not intended as a cryptographic or
// statistically rigorous generator.
// ---------------------------------------------------------------------------

export function makeSeededRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A gate must always be reproducible even if the caller never passes
// --gate-seed — this is the "fixed rng seed set so every comparison is
// reproducible" the task asks for, baked in as a real default rather than
// silently falling back to Math.random the way plain-battle-mode's --seed
// does. Value has no special meaning beyond being a fixed constant.
export const WC_DEFAULT_GATE_SEED = 20260826;

// ---------------------------------------------------------------------------
// CLI help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `WinCon self-play harness (dev-only, not part of the site)

Runs full simulated battles outside the browser, reusing the real
battle-sim-engine.js/battle-sim-ai.js unmodified.

Usage:
  node tools/selfplay-harness.mjs [options]
  node tools/selfplay-harness.mjs --search [search options]

Plain battle mode:
  --battles, -n <int>     How many battles to run (default: 200)
  --team-a <path>         Team A's lineup JSON (default: bundled fixture)
  --team-b <path>         Team B's lineup JSON (default: bundled fixture)
  --policy-a <name>       Team A's move-selection policy (default: heuristic)
  --policy-b <name>       Team B's move-selection policy (default: heuristic)
  --policy-weights <path> Weights JSON for any side using "weighted"
                           (default: data/policy-weights.json)
  --sheet-mode <mode>     "open" or "closed" (default: open)
  --format <fmt>          "doubles" or "singles" — overrides both team files'
                           own "format" field if given; otherwise both team
                           files must agree
  --seed <int>            Seed a deterministic RNG (default: unseeded,
                           Math.random — results vary run to run)

Available policies: heuristic, weighted (Milestone 35, Task 3 — see
data/policy-weights.json and battle-sim-ai.js's wcChooseAiMoveWeighted).

Weight-search mode (--search):
  Hill-climbs a candidate weights file against itself via self-play
  (--team-a mirrored against itself), then gates any accumulated
  improvement against the real, unmodified heuristic — over a large,
  fixed-seed battle gauntlet vs --team-b — before ever writing
  data/policy-weights.json. Never auto-applies a candidate that doesn't
  clear the gate. Every candidate's exact win-rate delta and battle count
  is logged, pass or fail.

  --search                Run weight-search mode instead of a plain battle
  --search-iterations <n> Hill-climbing rounds to attempt (default: 40)
  --search-battles <n>    Self-play battles per round's acceptance test
                           (default: 30)
  --search-step <float>   Multiplicative perturbation size, e.g. 0.2 = ±20%
                           (default: 0.2)
  --search-seed <int>     Seed the search's own exploration rng (default:
                           unseeded — which weight gets perturbed, and by
                           how much, varies run to run; the final gate is
                           ALWAYS seeded regardless, see --gate-seed)
  --gate-battles <int>    Battles per gate series (candidate and baseline
                           each run this many against --team-b) (default:
                           3000)
  --gate-margin <float>   Minimum required win-rate improvement over the
                           real heuristic, in percentage points (default: 3)
  --gate-seed <int>       Seed for the gate's two battle series (default:
                           ${WC_DEFAULT_GATE_SEED} — always seeded even if
                           this flag is omitted, so every gate comparison is
                           reproducible)
  --weights-in <path>     Starting weights to search from (default:
                           data/policy-weights.json if it exists, else the
                           committed WC_DEFAULT_AI_WEIGHTS baseline)
  --weights-out <path>    Where to write the candidate if the gate passes
                           (default: data/policy-weights.json)

  --team-a/--team-b/--sheet-mode/--format above also apply to --search:
  --team-a is the lineup whose weights get searched, --team-b is the fixed
  gate opponent (always running the real, unmodified heuristic).

  --help, -h              Show this help and exit

A team JSON file looks like:
  {
    "label": "...",
    "format": "doubles",
    "lineup": ["Kingambit", "Sneasler", "Basculegion", "Garchomp"],
    "builds": {
      "Kingambit": {
        "nature": "Adamant", "item": "Life Orb",
        "moves": ["Kowtow Cleave", "Sucker Punch", "Swords Dance", "Protect"],
        "sp": { "hp": 32, "attack": 32, "defense": 0, "sp_attack": 0, "sp_defense": 2, "speed": 0 }
      }
      // ...one entry per name in "lineup"
    }
  }
`;

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      battles: { type: "string", short: "n" },
      "team-a": { type: "string" },
      "team-b": { type: "string" },
      "policy-a": { type: "string", default: "heuristic" },
      "policy-b": { type: "string", default: "heuristic" },
      "policy-weights": { type: "string" },
      "sheet-mode": { type: "string", default: "open" },
      format: { type: "string" },
      seed: { type: "string" },
      search: { type: "boolean", default: false },
      "search-iterations": { type: "string" },
      "search-battles": { type: "string" },
      "search-step": { type: "string" },
      "search-seed": { type: "string" },
      "gate-battles": { type: "string" },
      "gate-margin": { type: "string" },
      "gate-seed": { type: "string" },
      "weights-in": { type: "string" },
      "weights-out": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });
  return values;
}

function requirePositiveInt(raw, flagName, fallback) {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flagName} must be a positive integer, got "${raw}"`);
  return n;
}

function requirePositiveFloat(raw, flagName, fallback) {
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flagName} must be a positive number, got "${raw}"`);
  return n;
}

// gate-margin alone is allowed to be exactly 0 (a "beat it by any amount, or
// tie" configuration) — every other numeric flag using requirePositiveFloat
// genuinely needs to be > 0 (a zero step size or zero iterations is
// meaningless), but "the minimum required improvement" is coherent at 0.
function requireNonNegativeFloat(raw, flagName, fallback) {
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flagName} must be zero or a positive number, got "${raw}"`);
  return n;
}

// ---------------------------------------------------------------------------
// vm context + data loading — shared by both modes. Kept as plain functions
// (not run at module scope) so importing this file for its pure exports
// never touches the filesystem or spins up a vm context.
// ---------------------------------------------------------------------------

const SCRIPT_FILES = [
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
  "battle-sim-lineup.js",
];

function loadEngineContext() {
  const context = vm.createContext({ console });
  SCRIPT_FILES.forEach((file) => {
    const code = fs.readFileSync(path.join(ROOT, file), "utf8");
    vm.runInContext(code, context, { filename: file });
  });
  return context;
}

function loadJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function loadTeamAbsolute(context, pokemonList, baseStatsData, abilitiesData, absPath) {
  const raw = JSON.parse(fs.readFileSync(absPath, "utf8"));
  if (!raw.lineup || !Array.isArray(raw.lineup) || raw.lineup.length === 0) {
    throw new Error(`${absPath}: missing or empty "lineup" array`);
  }
  if (!raw.builds) throw new Error(`${absPath}: missing "builds"`);
  const specs = raw.lineup.map((name) => {
    const build = raw.builds[name];
    if (!build) throw new Error(`${absPath}: "lineup" names "${name}" but "builds" has no entry for it`);
    return context.wcBattlerSpecForSlot(name, build, pokemonList, baseStatsData, abilitiesData);
  });
  return { label: raw.label || path.basename(absPath), format: raw.format, lineup: raw.lineup, specs };
}

/**
 * context.WC_DEFAULT_AI_WEIGHTS is an object created inside the vm context's
 * own realm — a JSON round-trip yields an equivalent plain object in this
 * module's realm, which is all a read-only weights bag ever needs to be
 * (see battle-sim-ai.js's own comment on why WC_DEFAULT_AI_WEIGHTS is a
 * `var`, and tools/test-weighted-policy-equivalence.mjs's matching comment
 * on why cross-realm objects need this normalization before comparison).
 */
function defaultWeightsFrom(context) {
  return JSON.parse(JSON.stringify(context.WC_DEFAULT_AI_WEIGHTS));
}

// ---------------------------------------------------------------------------
// Plain battle mode (Task 2, extended in Task 3 with the "weighted" policy)
// ---------------------------------------------------------------------------

function runPlainBattleMode(cli, context, data, teamA, teamB, format) {
  const battles = requirePositiveInt(cli.battles, "--battles", 200);

  const POLICIES = {
    heuristic: context.wcChooseAiMove,
    weighted: context.wcChooseAiMoveWeighted,
  };
  function resolvePolicy(name) {
    const policy = POLICIES[name];
    if (!policy) throw new Error(`Unknown policy "${name}". Available: ${Object.keys(POLICIES).join(", ")}`);
    return policy;
  }

  const policyForSide = {
    me: resolvePolicy(cli["policy-a"]),
    opp: resolvePolicy(cli["policy-b"]),
  };
  context.wcChooseAiMove = function dispatchChooseAiMove(battler, activeSide, foeSide, ctx) {
    return policyForSide[ctx.mySide](battler, activeSide, foeSide, ctx);
  };

  let policyWeights;
  if (cli["policy-a"] === "weighted" || cli["policy-b"] === "weighted") {
    const weightsPath = cli["policy-weights"] ? path.resolve(process.cwd(), cli["policy-weights"]) : path.join(ROOT, "data", "policy-weights.json");
    if (!fs.existsSync(weightsPath)) {
      throw new Error(`--policy-a/--policy-b "weighted" needs a weights file, but ${weightsPath} does not exist. Pass --policy-weights, or run --search to create data/policy-weights.json.`);
    }
    policyWeights = JSON.parse(fs.readFileSync(weightsPath, "utf8"));
  }

  const rng = cli.seed !== undefined ? makeSeededRng(Number.parseInt(cli.seed, 10)) : Math.random;
  const simData = { ...data, policyWeights };

  let wins = 0;
  let losses = 0;
  let draws = 0;

  const startedAt = Date.now();
  for (let i = 0; i < battles; i += 1) {
    const result = context.wcRunOneBattle(teamA.specs, teamB.specs, format, simData, rng);
    if (result === "win") wins += 1;
    else if (result === "loss") losses += 1;
    else draws += 1;
  }
  const elapsedMs = Date.now() - startedAt;

  const winRate = wins / battles;
  const battlesPerSec = battles / (elapsedMs / 1000);

  console.log(`Team A: ${teamA.label} [${teamA.lineup.join(", ")}] (policy: ${cli["policy-a"]})`);
  console.log(`Team B: ${teamB.label} [${teamB.lineup.join(", ")}] (policy: ${cli["policy-b"]})`);
  console.log(`Format: ${format}  Sheet mode: ${cli["sheet-mode"]}  Seed: ${cli.seed !== undefined ? cli.seed : "(none — Math.random)"}`);
  console.log("");
  console.log(`${battles} battles in ${elapsedMs}ms  (${battlesPerSec.toFixed(0)} battles/sec)`);
  console.log(`Team A: ${wins}W ${losses}L ${draws}D  —  win rate ${(winRate * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------------------
// Weight-search mode (Task 3)
// ---------------------------------------------------------------------------

/**
 * One self-play hill-climbing round: `mySpecs` mirrored against itself,
 * "me" side scored with `candidateWeights`, "opp" side with
 * `currentBestWeights` — both sides call the exact same wcChooseAiMoveWeighted,
 * differing only in which weights data.policyWeightsBySide hands them (see
 * that function's own doc comment in battle-sim-ai.js for the resolution
 * order this relies on). This is deliberately ONLY ever used for the cheap
 * per-round acceptance test, never for the final gate — see this file's
 * header note on why self-play alone can't be trusted to prove a real
 * improvement (it can learn to beat itself in ways that don't generalize).
 */
function runSelfMirrorRound(context, data, mySpecs, format, candidateWeights, currentBestWeights, battles, rng) {
  context.wcChooseAiMove = context.wcChooseAiMoveWeighted;
  const simData = { ...data, policyWeightsBySide: { me: candidateWeights, opp: currentBestWeights } };
  let candidateWins = 0;
  let currentBestWins = 0;
  let draws = 0;
  for (let i = 0; i < battles; i += 1) {
    const result = context.wcRunOneBattle(mySpecs, mySpecs, format, simData, rng);
    if (result === "win") candidateWins += 1;
    else if (result === "loss") currentBestWins += 1;
    else draws += 1;
  }
  return { candidateWins, currentBestWins, draws };
}

/**
 * One gate series: `mySpecs` (using `myPolicy`, either the real heuristic or
 * weighted-with-a-specific-weights-object) against `oppSpecs` (ALWAYS the
 * real, unmodified production heuristic — the thing the task says a
 * candidate must beat) over `battles` battles with a freshly-seeded rng.
 * Returns the win rate (0..1). Called twice by runWeightSearch with an
 * identically-seeded rng each time — once for the candidate, once for the
 * baseline — so both series see the exact same sequence of turn-order/
 * damage/accuracy rolls and the only thing that can make them diverge is
 * the weights themselves.
 */
function runGateSeries(context, data, mySpecs, oppSpecs, format, myWeights, battles, seed) {
  context.wcChooseAiMove = function dispatchChooseAiMove(battler, activeSide, foeSide, ctx) {
    if (ctx.mySide === "me") return context.wcChooseAiMoveWeighted(battler, activeSide, foeSide, ctx);
    return context.wcChooseAiMoveRealHeuristic(battler, activeSide, foeSide, ctx);
  };
  const simData = { ...data, policyWeights: myWeights };
  const rng = makeSeededRng(seed);
  let wins = 0;
  for (let i = 0; i < battles; i += 1) {
    const result = context.wcRunOneBattle(mySpecs, oppSpecs, format, simData, rng);
    if (result === "win") wins += 1;
  }
  return wins / battles;
}

function loadStartingWeights(context, cli) {
  const explicitPath = cli["weights-in"] ? path.resolve(process.cwd(), cli["weights-in"]) : path.join(ROOT, "data", "policy-weights.json");
  if (fs.existsSync(explicitPath)) {
    console.log(`Starting from weights in ${path.relative(ROOT, explicitPath) || explicitPath}`);
    return JSON.parse(fs.readFileSync(explicitPath, "utf8"));
  }
  console.log(`${explicitPath} does not exist yet — starting from the committed WC_DEFAULT_AI_WEIGHTS baseline (identical to the real heuristic).`);
  return defaultWeightsFrom(context);
}

function runWeightSearch(cli, context, data, teamA, teamB, format) {
  const iterations = requirePositiveInt(cli["search-iterations"], "--search-iterations", 40);
  const battlesPerRound = requirePositiveInt(cli["search-battles"], "--search-battles", 30);
  const step = requirePositiveFloat(cli["search-step"], "--search-step", 0.2);
  const gateBattles = requirePositiveInt(cli["gate-battles"], "--gate-battles", 3000);
  const gateMargin = requireNonNegativeFloat(cli["gate-margin"], "--gate-margin", 3);
  const gateSeed = cli["gate-seed"] !== undefined ? requirePositiveInt(cli["gate-seed"], "--gate-seed", WC_DEFAULT_GATE_SEED) : WC_DEFAULT_GATE_SEED;
  const searchRng = cli["search-seed"] !== undefined ? makeSeededRng(Number.parseInt(cli["search-seed"], 10)) : Math.random;
  const weightsOutPath = cli["weights-out"] ? path.resolve(process.cwd(), cli["weights-out"]) : path.join(ROOT, "data", "policy-weights.json");

  // The gate must always compare against the REAL, unmodified production
  // function — captured once, before anything below ever reassigns
  // context.wcChooseAiMove, and never overwritten again.
  context.wcChooseAiMoveRealHeuristic = context.wcChooseAiMove;

  let currentBest = loadStartingWeights(context, cli);
  const keys = perturbableKeysOf(currentBest);

  console.log(`Hill-climbing ${teamA.label} [${teamA.lineup.join(", ")}] against itself — ${iterations} rounds, ${battlesPerRound} self-play battles/round, step ±${(step * 100).toFixed(0)}%, seed: ${cli["search-seed"] !== undefined ? cli["search-seed"] : "(none — Math.random)"}`);
  console.log(`Perturbable weights (${keys.length}): ${keys.join(", ")}`);
  console.log("");

  let accepted = 0;
  for (let round = 1; round <= iterations; round += 1) {
    const { weights: candidate, key, factor } = perturbOneWeight(currentBest, keys, step, searchRng);
    const result = runSelfMirrorRound(context, data, teamA.specs, format, candidate, currentBest, battlesPerRound, searchRng);
    const isAccepted = acceptRound(result.candidateWins, result.currentBestWins);
    console.log(
      `round ${String(round).padStart(String(iterations).length)}/${iterations}: perturbed ${key} ×${factor.toFixed(3)} — ` +
        `candidate ${result.candidateWins}W vs current-best ${result.currentBestWins}W (${result.draws}D) over ${battlesPerRound} battles — ` +
        (isAccepted ? "ACCEPTED" : "rejected")
    );
    if (isAccepted) {
      currentBest = candidate;
      accepted += 1;
    }
  }

  console.log("");
  console.log(`Search complete: ${accepted}/${iterations} perturbations accepted.`);
  console.log("");
  console.log(`Evaluation gate — candidate vs the REAL, unmodified production heuristic, ${gateBattles} fixed-seed battles each (seed ${gateSeed}), gauntlet opponent: ${teamB.label} [${teamB.lineup.join(", ")}]`);

  const candidateWinRate = runGateSeries(context, data, teamA.specs, teamB.specs, format, currentBest, gateBattles, gateSeed);
  const baselineWinRate = runGateSeries(context, data, teamA.specs, teamB.specs, format, defaultWeightsFrom(context), gateBattles, gateSeed);
  // baselineWinRate above always uses default weights, which Task 3's own
  // equivalence test (tools/test-weighted-policy-equivalence.mjs) proves are
  // behaviorally identical to the real heuristic — but the gate's "opp" side
  // (context.wcChooseAiMoveRealHeuristic) is always the literal, untouched
  // production function regardless, so this measurement never depends on
  // that equivalence holding.
  const verdict = computeGateVerdict(candidateWinRate, baselineWinRate, gateMargin);

  console.log(`  Candidate weights win rate: ${(candidateWinRate * 100).toFixed(2)}%  (${Math.round(candidateWinRate * gateBattles)}/${gateBattles})`);
  console.log(`  Production heuristic win rate: ${(baselineWinRate * 100).toFixed(2)}%  (${Math.round(baselineWinRate * gateBattles)}/${gateBattles})`);
  console.log(`  Delta: ${verdict.deltaPercentagePoints >= 0 ? "+" : ""}${verdict.deltaPercentagePoints.toFixed(2)} percentage points over ${gateBattles} battles each  (gate requires >= +${gateMargin})`);

  if (verdict.pass) {
    fs.writeFileSync(weightsOutPath, JSON.stringify(currentBest, null, 2) + "\n");
    console.log(`  PASS — wrote ${path.relative(ROOT, weightsOutPath) || weightsOutPath}`);
  } else {
    console.log(`  FAIL — gate not cleared. ${path.relative(ROOT, weightsOutPath) || weightsOutPath} left unchanged.`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const cli = parseCliArgs(process.argv.slice(2));

  if (cli.help) {
    console.log(HELP_TEXT);
    return;
  }

  const teamAPath = cli["team-a"] ? path.resolve(process.cwd(), cli["team-a"]) : path.join(__dirname, "fixtures", "team-kingambit-sun.json");
  const teamBPath = cli["team-b"] ? path.resolve(process.cwd(), cli["team-b"]) : path.join(__dirname, "fixtures", "team-hyper-offense.json");

  const context = loadEngineContext();

  const pokemonList = loadJSON("data/pokemon.json");
  const baseStatsData = loadJSON("data/base-stats.json");
  const abilitiesData = loadJSON("data/abilities.json");
  const movesData = loadJSON("data/moves.json");
  const typeChart = loadJSON("data/type-chart.json");
  const natures = loadJSON("data/natures.json");
  const moveEffects = loadJSON("data/move-effects.json");
  const abilityEffects = loadJSON("data/ability-effects.json");
  const itemEffects = loadJSON("data/item-effects.json");

  // Everything below can throw a plain Error for a bad flag or a malformed
  // team file — caught here and printed as a short message instead of a raw
  // Node stack trace, since this tool is meant to be usable from a terminal
  // without needing to read a stack trace to find the problem.
  try {
    const teamA = loadTeamAbsolute(context, pokemonList, baseStatsData, abilitiesData, teamAPath);
    const teamB = loadTeamAbsolute(context, pokemonList, baseStatsData, abilitiesData, teamBPath);

    const format = cli.format || teamA.format || teamB.format;
    if (!format || (format !== "doubles" && format !== "singles")) {
      throw new Error(`Could not determine a valid format ("doubles"/"singles") — pass --format explicitly. Team A says "${teamA.format}", Team B says "${teamB.format}".`);
    }
    if (teamA.format && teamA.format !== format) {
      console.warn(`Warning: --format=${format} overrides Team A's own "${teamA.format}"`);
    }
    if (teamB.format && teamB.format !== format) {
      console.warn(`Warning: --format=${format} overrides Team B's own "${teamB.format}"`);
    }

    const expectedN = format === "singles" ? 3 : 4;
    [["Team A", teamA], ["Team B", teamB]].forEach(([label, team]) => {
      if (team.lineup.length !== expectedN) {
        throw new Error(`${label} ("${team.label}") has ${team.lineup.length} Pokémon in its lineup, but ${format} needs exactly ${expectedN}.`);
      }
    });

    if (cli["sheet-mode"] !== "open" && cli["sheet-mode"] !== "closed") {
      throw new Error(`--sheet-mode must be "open" or "closed", got "${cli["sheet-mode"]}"`);
    }

    const data = { movesData, moveEffects, abilityEffects, itemEffects, typeChart, natures, sheetMode: cli["sheet-mode"] };

    if (cli.search) {
      runWeightSearch(cli, context, data, teamA, teamB, format);
    } else {
      runPlainBattleMode(cli, context, data, teamA, teamB, format);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}
