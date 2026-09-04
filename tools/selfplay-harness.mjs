#!/usr/bin/env node
// WinCon — tools/selfplay-harness.mjs (Milestone 35, Task 2)
//
// Dev-only CLI. Never imported by the site's HTML pages, never loaded by
// battle-sim-worker.js — this exists purely so battle simulation can be
// exercised, and eventually trained against itself, outside a browser.
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
// This task is ONLY about proving that harness runs many battles quickly
// and correctly outside the browser — not about anything learning yet. Both
// sides default to "heuristic" (WinCon's existing hand-tuned move-picker,
// wcChooseAiMove, completely unmodified). The one piece of new plumbing is
// a small policy dispatcher (see "Policy dispatch" below) that lets each
// side's move choice route to an independently-named policy function —
// wired up now, with only "heuristic" registered, specifically so a later
// task can register a second (learned) policy without touching this file's
// battle loop or CLI surface again.
//
// Usage:
//   node tools/selfplay-harness.mjs
//   node tools/selfplay-harness.mjs --battles 1000 \
//     --team-a tools/fixtures/team-kingambit-sun.json \
//     --team-b tools/fixtures/team-hyper-offense.json \
//     --sheet-mode closed --seed 42
//
// Run with no arguments and it battles the two bundled example fixtures
// 200 times. --help prints the full flag list.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP_TEXT = `WinCon self-play harness (dev-only, not part of the site)

Runs many full simulated battles between two lineups outside the browser,
reusing the real battle-sim-engine.js/battle-sim-ai.js unmodified.

Usage:
  node tools/selfplay-harness.mjs [options]

Options:
  --battles, -n <int>     How many battles to run (default: 200)
  --team-a <path>         Team A's lineup JSON (default: bundled fixture)
  --team-b <path>         Team B's lineup JSON (default: bundled fixture)
  --policy-a <name>       Team A's move-selection policy (default: heuristic)
  --policy-b <name>       Team B's move-selection policy (default: heuristic)
  --sheet-mode <mode>     "open" or "closed" (default: open)
  --format <fmt>          "doubles" or "singles" — overrides both team files'
                           own "format" field if given; otherwise both team
                           files must agree
  --seed <int>            Seed a deterministic RNG (default: unseeded,
                           Math.random — results vary run to run)
  --help, -h              Show this help and exit

Available policies: ${"heuristic"} (more are registered by later tasks — see
the "Policy dispatch" section of this file's header comment).

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
      "sheet-mode": { type: "string", default: "open" },
      format: { type: "string" },
      seed: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });
  return values;
}

const cli = parseCliArgs(process.argv.slice(2));

if (cli.help) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const battles = cli.battles ? Number.parseInt(cli.battles, 10) : 200;
if (!Number.isInteger(battles) || battles < 1) {
  console.error(`--battles must be a positive integer, got "${cli.battles}"`);
  process.exit(1);
}

const teamAPath = cli["team-a"] ? path.resolve(process.cwd(), cli["team-a"]) : path.join(__dirname, "fixtures", "team-kingambit-sun.json");
const teamBPath = cli["team-b"] ? path.resolve(process.cwd(), cli["team-b"]) : path.join(__dirname, "fixtures", "team-hyper-offense.json");

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — only used when --seed is given. Deterministic
// and dependency-free; good enough for reproducible harness runs, not
// intended as a cryptographic or statistically rigorous generator.
// ---------------------------------------------------------------------------

function makeSeededRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = cli.seed !== undefined ? makeSeededRng(Number.parseInt(cli.seed, 10)) : Math.random;

// ---------------------------------------------------------------------------
// Load the real, unmodified simulation modules — same files, same order, as
// battle-sim-worker.js's importScripts list.
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

const context = vm.createContext({ console });
SCRIPT_FILES.forEach((file) => {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  vm.runInContext(code, context, { filename: file });
});

function loadJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

const pokemonList = loadJSON("data/pokemon.json");
const baseStatsData = loadJSON("data/base-stats.json");
const abilitiesData = loadJSON("data/abilities.json");
const movesData = loadJSON("data/moves.json");
const typeChart = loadJSON("data/type-chart.json");
const natures = loadJSON("data/natures.json");
const moveEffects = loadJSON("data/move-effects.json");
const abilityEffects = loadJSON("data/ability-effects.json");
const itemEffects = loadJSON("data/item-effects.json");

// ---------------------------------------------------------------------------
// Policy dispatch
//
// wcRunOneBattle calls the single global wcChooseAiMove for both sides,
// distinguishing them only via `ctx.mySide` ("me" | "opp") — see battle-sim-
// engine.js. To let each side use an independently-named policy without
// editing that shared production file, this captures the real heuristic
// under its own name, then replaces the context's wcChooseAiMove with a
// small dispatcher that routes each call to whichever policy this run
// configured for that side. A later task registers a second (learned)
// policy here; the battle loop and CLI never need to change for that.
// ---------------------------------------------------------------------------

const POLICIES = {
  heuristic: context.wcChooseAiMove,
};

function resolvePolicy(name) {
  const policy = POLICIES[name];
  if (!policy) {
    throw new Error(`Unknown policy "${name}". Available: ${Object.keys(POLICIES).join(", ")}`);
  }
  return policy;
}

// Everything below can throw a plain Error for a bad flag or a malformed
// team file — caught at the bottom and printed as a short message instead
// of a raw Node stack trace, since this tool is meant to be usable from a
// terminal without needing to read a stack trace to find the problem.
try {
  runHarness();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

function runHarness() {
  const policyForSide = {
    me: resolvePolicy(cli["policy-a"]),
    opp: resolvePolicy(cli["policy-b"]),
  };

  context.wcChooseAiMove = function dispatchChooseAiMove(battler, activeSide, foeSide, ctx) {
    const policy = policyForSide[ctx.mySide];
    return policy(battler, activeSide, foeSide, ctx);
  };

  // ---------------------------------------------------------------------------
  // Load the two teams and resolve them into engine-ready battler specs via
  // battle-sim-lineup.js's own wcBattlerSpecForSlot — the same function the
  // real Builder/Worker path uses, so a fixture's Mega/base identity
  // resolution behaves identically to a real user's team.
  // ---------------------------------------------------------------------------

  // loadJSON above resolves relative to ROOT; team files can be given as
  // absolute paths or relative to the caller's cwd (see teamAPath/teamBPath),
  // so this reads them directly rather than routing through loadJSON's
  // ROOT-relative join.
  function loadTeamAbsolute(absPath) {
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

  const teamA = loadTeamAbsolute(teamAPath);
  const teamB = loadTeamAbsolute(teamBPath);

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

  // ---------------------------------------------------------------------------
  // Run the battles — reusing wcRunOneBattle directly, exactly the way
  // battle-sim-engine.js's own wcRunMonteCarlo does internally, just against
  // one fixed opponent (Team B) rather than a sampled reference pool.
  // ---------------------------------------------------------------------------

  const simData = { movesData, moveEffects, abilityEffects, itemEffects, typeChart, natures, sheetMode: cli["sheet-mode"] };

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
} // end runHarness()
