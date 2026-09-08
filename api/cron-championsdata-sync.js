// WinCon — api/cron-championsdata-sync.js (Milestone 53: the
// championsbattledata.com pipeline)
//
// A second Vercel Cron job, alongside api/cron-limitless-sync.js (Milestone
// 34). Once a day it pulls real, current Pokemon Champions battle data from
// championsbattledata.com's free, no-auth, CORS-enabled API and upserts it
// into live_champions_stats (see supabase/migrations/0009_live_champions_stats.sql
// for why this needed its own table rather than reusing live_meta_builds).
//
// Simpler than the Limitless pipeline on purpose: Limitless's tournament
// API only ever returns raw per-tournament standings, so that job has to
// fold individual player records into a running aggregate itself. This
// source's own `/api` index endpoint ALREADY returns each of the ~236
// species' current top-1 move/held_item/teammate/stat_alignment/
// stat_points/ability, per format, pre-aggregated (confirmed live during
// Milestone 53's research: fetch("https://championsbattledata.com/api")
// -> pokemon[].summary.battleSummary.Current.{Doubles,Singles}.top.*) --
// one fetch, no per-tournament cursor, no folding math needed. This is
// deliberately an MVP scope: the source's per-species /api/battle/:format/
// :name endpoint can also return each category's full top-10 (not just
// rank 1), which would need up to 236 x 2 more requests per run -- left
// for a future pipeline run to add (see live_champions_stats' own `rank`
// column, already shaped to hold it) since the real goal this milestone
// -- Stat Points -- is already fully served by the index alone.
//
// THE REAL FIND: this source's `stat_points` category gives a real,
// current Stat Point spread (hp_points/attack_points/defense_points/
// sp_atk_points/sp_def_points/speed_points, 0-32 each) per species --
// exactly WinCon's own Stat Point system, and something Limitless's
// decklist data structurally cannot provide (no EV/Stat-Point field
// anywhere -- see 0007_live_limitless_meta.sql's own header). That's the
// signal strategy.js's wcRealStatPointSpreadFor reads out of this table.
//
// No raw sample-count is exposed anywhere in this API, only a real
// percentage per top pick -- confidence gating on the read side
// (wcRealStatPointSpreadFor) uses a real, computed percentage floor
// instead of a sample-count one for that reason. See this milestone's
// README section for the actual numbers that floor was computed from.
//
// Security/dry-run/secrets: identical contract to api/cron-limitless-sync.js
// -- a `?dryRun=1` request never writes anything and needs no secret; a
// real run requires a Bearer token matching CRON_SECRET (the same
// environment variable the Limitless job already uses -- no new secret to
// configure) and SUPABASE_SERVICE_ROLE_KEY.

const CHAMPIONSDATA_API_BASE = "https://championsbattledata.com/api";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://cmxozkvlttwwnisetdid.supabase.co"; // same public project URL already committed in supabase-config.js — not a secret
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // MUST be set as a Vercel env var — never commit this value anywhere

// The 6 real per-category top-1 fields this source's index embeds per
// species per format (battleSummary.Current.{format}.top.<key>) — mapped
// 1:1 onto live_champions_stats.category. Order is cosmetic only.
const CHAMPIONSDATA_CATEGORIES = ["move", "held_item", "teammate", "stat_alignment", "stat_points", "ability"];

// The source capitalizes its format names ("Doubles"/"Singles"); every
// other live_* table (and the rest of this app) uses lowercase — mapped
// here once so the rest of this file only ever deals in WinCon's own
// convention.
const CHAMPIONSDATA_FORMAT_TO_WC = { Doubles: "doubles", Singles: "singles" };

// ---------------------------------------------------------------------------
// Small fetch helpers — same shape as api/cron-limitless-sync.js's own.
// ---------------------------------------------------------------------------

async function fetchChampionsData(path) {
  const res = await fetch(`${CHAMPIONSDATA_API_BASE}${path}`);
  if (!res.ok) throw new Error(`championsbattledata.com API ${path} returned HTTP ${res.status}`);
  return res.json();
}

function supabaseHeaders(extra) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseUpsert(table, rows, onConflict) {
  if (rows.length === 0) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: supabaseHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert into ${table} returned HTTP ${res.status}: ${await res.text()}`);
}

async function supabaseInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: supabaseHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase insert into ${table} returned HTTP ${res.status}: ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Transform — pure, no network/DB calls, so this half is directly
// unit-testable against a canned index fixture (see
// tools/test-championsdata-pipeline.mjs), same spirit as
// api/cron-limitless-sync.js's foldPlayerIntoAggregates/mergeRunningAverage.
// ---------------------------------------------------------------------------

/**
 * One species' `battleSummary.Current.<Format>.top` object -> up to 6
 * live_champions_stats rows (one per real category present). A category
 * missing from `top` (can happen for a species with too little logged
 * data for that one category) is simply skipped, not written as a null
 * row — same "silently a no-op until real data exists" contract every
 * other live_* table in this project already follows.
 */
function rowsFromSpeciesTop(species, wcFormat, top) {
  if (!top) return [];
  const rows = [];
  CHAMPIONSDATA_CATEGORIES.forEach((category) => {
    const entry = top[category];
    if (!entry) return;
    rows.push({
      species,
      format: wcFormat,
      category,
      rank: 1,
      name: entry.name || null,
      percentage_value: entry.percentage_value == null ? null : entry.percentage_value,
      // Only the stat_points category ever carries a real spread — every
      // other category's row keeps these six columns null, matching
      // 0009_live_champions_stats.sql's own header comment.
      hp_points: category === "stat_points" ? entry.hp_points ?? null : null,
      attack_points: category === "stat_points" ? entry.attack_points ?? null : null,
      defense_points: category === "stat_points" ? entry.defense_points ?? null : null,
      sp_atk_points: category === "stat_points" ? entry.sp_atk_points ?? null : null,
      sp_def_points: category === "stat_points" ? entry.sp_def_points ?? null : null,
      speed_points: category === "stat_points" ? entry.speed_points ?? null : null,
      updated_at: new Date().toISOString(),
    });
  });
  return rows;
}

/**
 * The whole `/api` index response -> every live_champions_stats row it
 * implies, across every species and both real formats. Pure and
 * network-free — the handler below is the only thing that actually calls
 * fetchChampionsData and supabaseUpsert.
 */
function rowsFromIndex(index) {
  const rows = [];
  const pokemonList = Array.isArray(index && index.pokemon) ? index.pokemon : [];
  pokemonList.forEach((entry) => {
    const battleSummary = entry.summary && entry.summary.battleSummary && entry.summary.battleSummary.Current;
    if (!battleSummary || !entry.name) return;
    Object.keys(CHAMPIONSDATA_FORMAT_TO_WC).forEach((sourceFormat) => {
      const wcFormat = CHAMPIONSDATA_FORMAT_TO_WC[sourceFormat];
      const top = battleSummary[sourceFormat] && battleSummary[sourceFormat].top;
      rows.push(...rowsFromSpeciesTop(entry.name, wcFormat, top));
    });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

async function handler(req, res) {
  const isDryRun = req.query && (req.query.dryRun === "1" || req.query.dryRun === "true");

  if (!isDryRun) {
    if (!process.env.CRON_SECRET) {
      res.status(500).json({ error: "CRON_SECRET is not configured on this deployment — see the README's Milestone 34 section (this job reuses the same secret)." });
      return;
    }
    const authHeader = req.headers.authorization || "";
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: "Unauthorized. Real (non-dry-run) runs require Vercel's own Cron invocation, or a manual request carrying the matching Authorization header." });
      return;
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment — see the README's Milestone 34 section." });
      return;
    }
  }

  const summary = { dryRun: !!isDryRun, speciesSeen: 0, rowsWritten: 0, errors: [] };

  try {
    const index = await fetchChampionsData("");
    const rows = rowsFromIndex(index);
    summary.speciesSeen = Array.isArray(index && index.pokemon) ? index.pokemon.length : 0;
    summary.rowsWritten = rows.length;

    if (!isDryRun) {
      await supabaseUpsert("live_champions_stats", rows, "species,format,category,rank");
      await supabaseInsert("live_pipeline_runs", {
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: "success",
        tournaments_processed: 0, // not tournament-shaped — this field is Limitless-specific and left at its default
        tournaments_skipped: 0,
        source: "championsdata",
      });
    } else {
      summary.wouldWrite = rows;
    }

    res.status(200).json(summary);
  } catch (err) {
    summary.errors.push(err.message);
    if (!isDryRun && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        await supabaseInsert("live_pipeline_runs", {
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          status: "failed",
          tournaments_processed: 0,
          tournaments_skipped: 0,
          error: err.message.slice(0, 4000),
          source: "championsdata",
        });
      } catch {
        // Nothing more useful to do if even the failure log can't be written — the error is already in the HTTP response below.
      }
    }
    res.status(500).json(summary);
  }
}

module.exports = handler;
// Pure transform helpers, exposed for tools/test-championsdata-pipeline.mjs —
// neither touches the network or the database, so both are testable
// directly against a canned index fixture with zero mocking.
module.exports.rowsFromIndex = rowsFromIndex;
module.exports.rowsFromSpeciesTop = rowsFromSpeciesTop;
