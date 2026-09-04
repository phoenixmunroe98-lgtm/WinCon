// WinCon — api/cron-limitless-sync.js (Milestone 34: the Limitless pipeline)
//
// A Vercel Cron job: the one piece of WinCon that runs on a schedule
// instead of only when someone has the site open. Once a day it pulls
// real Regulation M-B tournament results from Limitless's public
// tournaments API (https://play.limitlesstcg.com/api — no key required at
// this tier) and upserts aggregated stats into the four tables added by
// supabase/migrations/0007_live_limitless_meta.sql. The app's own client
// code (teams.js's wcFetchLiveTierStats/wcFetchLiveReferenceTeams) only
// ever READS those tables — this file is the only thing that writes them.
//
// Deliberately plain Node with zero npm dependencies (no @supabase/
// supabase-js) — WinCon has no build step and no package.json today, and
// this doesn't need one: Node 18+'s built-in fetch is enough to both call
// Limitless and call Supabase's own REST API (PostgREST) directly with the
// service-role key. See the README's Milestone 34 section for the exact
// Vercel setup steps (the CRON_SECRET and SUPABASE_SERVICE_ROLE_KEY
// environment variables this file requires).
//
// IMPORTANT SCOPE NOTE: Limitless's game=VGC tournaments are Doubles only —
// Champions Singles has no official tournament format to pull from (see
// Milestone 35's own README note: Singles is ladder-only). This pipeline
// therefore only ever writes format="doubles" rows. Singles keeps relying
// entirely on data/meta-baseline.json's curated fallback and WinCon's own
// logged battles, exactly as it did before this migration — nothing about
// Singles' data changes.
//
// ALSO IMPORTANT: a Limitless decklist entry is {species, item, ability,
// moves, nature, tera} — confirmed by hand, live, against the real API —
// with no Stat Points/EV-equivalent field anywhere. live_reference_teams
// rows below are real, but are NOT battle-ready for Simulated Win Rate's
// engine (which needs a full `sp` allocation per member) and are not wired
// into it. That's Milestone 35/34's own Task 5, deliberately deferred
// unless a stat-spread source ever turns up.
//
// Security: this endpoint WRITES to the database with a maximally
// privileged key, so real (non-dry-run) invocations require a Bearer
// token matching the CRON_SECRET environment variable — Vercel
// automatically attaches this header on its own scheduled invocations
// once that env var is set on the project (see Vercel's Cron Jobs docs).
// A `?dryRun=1` request skips that check entirely (and never writes
// anything) so it's safe to test from a plain browser tab before trusting
// the real schedule.

const LIMITLESS_API_BASE = "https://play.limitlesstcg.com/api";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://cmxozkvlttwwnisetdid.supabase.co"; // same public project URL already committed in supabase-config.js — not a secret
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // MUST be set as a Vercel env var — never commit this value anywhere

// How many not-yet-processed tournaments a single run will fetch full
// standings for. Kept modest on purpose: Vercel's default serverless
// function time limit is short, Limitless's real rate limits aren't
// documented (Milestone 34's own research couldn't confirm a number), and
// this job runs once a day — a backlog bigger than this just gets picked
// up across a few more days rather than risking one run timing out or
// hammering Limitless. Raise it later if a real rate-limit figure ever
// gets confirmed and daily volume is consistently bigger than this.
const MAX_TOURNAMENTS_PER_RUN = 20;

// Only tournaments' top N finishers get stored as a full
// live_reference_teams row — a "meta-defining teams" cutoff, the same
// spirit as data/meta-baseline.json's own Worlds-2026-top-8 entries,
// rather than storing every single entrant's team from every tournament
// forever.
const REFERENCE_TEAM_PLACING_CUTOFF = 8;

const WC_FORMAT = "doubles"; // see the file header's scope note — Limitless has no Singles tournament data to pull

// ---------------------------------------------------------------------------
// Small fetch helpers
// ---------------------------------------------------------------------------

async function fetchLimitless(path) {
  const res = await fetch(`${LIMITLESS_API_BASE}${path}`);
  if (!res.ok) throw new Error(`Limitless API ${path} returned HTTP ${res.status}`);
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

async function supabaseSelect(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: supabaseHeaders() });
  if (!res.ok) throw new Error(`Supabase select on ${table} returned HTTP ${res.status}: ${await res.text()}`);
  return res.json();
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
// Aggregation — pure, no network/DB calls, so this half is easy to reason
// about and (in principle) unit-test on a canned standings fixture.
// `existingTierStats`/`existingMetaBuilds` are the CURRENT rows from the
// database (species/build-signature -> {timesUsed, winRate}), since each
// new tournament's numbers fold into a running aggregate rather than
// replacing it.
// ---------------------------------------------------------------------------

function buildKeyFor(species, ability, item, nature, moves) {
  return [species, ability || "", item || "", nature || "", [...moves].sort().join(",")].join("::");
}

function foldPlayerIntoAggregates(player, tierStats, metaBuilds) {
  const totalGames = player.record.wins + player.record.losses + player.record.ties;
  if (totalGames === 0) return; // a dropped/no-show entrant with no real games played tells us nothing about how any of these builds actually performed
  const playerWinRate = (100 * player.record.wins) / totalGames;

  const seenSpeciesThisPlayer = new Set(); // a player can't use the same species twice on one team, but guards against malformed data either way
  (player.decklist || []).forEach((member) => {
    if (!member || !member.name || seenSpeciesThisPlayer.has(member.name)) return;
    seenSpeciesThisPlayer.add(member.name);

    if (!tierStats[member.name]) tierStats[member.name] = { timesUsed: 0, winRateSum: 0 };
    tierStats[member.name].timesUsed += 1;
    tierStats[member.name].winRateSum += playerWinRate;

    const moves = member.attacks || [];
    const buildKey = buildKeyFor(member.name, member.ability, member.item, member.nature, moves);
    if (!metaBuilds[buildKey]) {
      metaBuilds[buildKey] = { species: member.name, ability: member.ability || null, item: member.item || null, nature: member.nature || null, moves: [...moves].sort(), timesUsed: 0, winRateSum: 0 };
    }
    metaBuilds[buildKey].timesUsed += 1;
    metaBuilds[buildKey].winRateSum += playerWinRate;
  });
}

/**
 * A running weighted average: `existing` is the row already in the
 * database (or undefined for a species/build never seen before this run),
 * `additionalCount`/`additionalWinRateSum` are what THIS run's processing
 * contributed. Kept as one small pure function rather than inlined twice
 * (tier stats and meta builds both need it) so the averaging math only
 * has to be gotten right in one place.
 */
function mergeRunningAverage(existing, additionalCount, additionalWinRateSum) {
  const existingCount = (existing && existing.times_used) || 0;
  const existingSum = existingCount * ((existing && existing.win_rate) || 0);
  const newCount = existingCount + additionalCount;
  const newWinRate = newCount > 0 ? Math.round(((existingSum + additionalWinRateSum) / newCount) * 10) / 10 : null;
  return { timesUsed: newCount, winRate: newWinRate };
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

async function handler(req, res) {
  const isDryRun = req.query && (req.query.dryRun === "1" || req.query.dryRun === "true");

  if (!isDryRun) {
    if (!process.env.CRON_SECRET) {
      res.status(500).json({ error: "CRON_SECRET is not configured on this deployment — see the README's Milestone 34 section." });
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

  const summary = { dryRun: !!isDryRun, tournamentsProcessed: 0, tournamentsSkipped: 0, speciesUpdated: 0, buildsUpdated: 0, referenceTeamsUpserted: 0, errors: [] };

  try {
    // "Since last time" cursor — the newest tournament date any PAST
    // successful run finished processing. Absent one (first run ever, or
    // every past run failed), every tournament Limitless currently
    // returns is a candidate, bounded by MAX_TOURNAMENTS_PER_RUN below.
    let sinceDate = null;
    if (SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const lastSuccess = await supabaseSelect("live_pipeline_runs", "status=eq.success&order=newest_tournament_date.desc&limit=1&select=newest_tournament_date");
        if (lastSuccess.length > 0 && lastSuccess[0].newest_tournament_date) sinceDate = new Date(lastSuccess[0].newest_tournament_date);
      } catch (err) {
        summary.errors.push(`Couldn't read last run cursor, treating this as a first run: ${err.message}`);
      }
    }

    const allTournaments = await fetchLimitless(`/tournaments?game=VGC&format=M-B`); // Limitless's own regulation code for M-B, independent of WC_FORMAT's naming
    const candidateTournaments = (Array.isArray(allTournaments) ? allTournaments : [])
      .filter((t) => !sinceDate || new Date(t.date) > sinceDate)
      .sort((a, b) => new Date(a.date) - new Date(b.date)) // oldest-first, so the cursor advances steadily even if a run gets cut short by the per-run cap
      .slice(0, MAX_TOURNAMENTS_PER_RUN);

    const tierStats = {}; // species -> {timesUsed, winRateSum} — this run's contribution only
    const metaBuilds = {}; // buildKey -> {..., timesUsed, winRateSum} — this run's contribution only
    const referenceTeamRows = [];
    let newestProcessedDate = sinceDate;

    for (const tournament of candidateTournaments) {
      try {
        const standings = await fetchLimitless(`/tournaments/${tournament.id}/standings`);
        (Array.isArray(standings) ? standings : []).forEach((player) => {
          foldPlayerIntoAggregates(player, tierStats, metaBuilds);
          if (player.placing && player.placing <= REFERENCE_TEAM_PLACING_CUTOFF) {
            referenceTeamRows.push({
              format: WC_FORMAT,
              source_tournament_id: String(tournament.id),
              source_tournament_name: tournament.name || null,
              // NOTE: the outgoing DB column is `placement`, not `placing` —
              // PLACING is a reserved PostgreSQL keyword and can't be a bare
              // column name (see 0007_live_limitless_meta.sql). player.placing
              // itself is Limitless's own API field name and stays as-is.
              placement: player.placing,
              record_wins: player.record.wins,
              record_losses: player.record.losses,
              record_ties: player.record.ties,
              members: (player.decklist || []).map((m) => ({ name: m.name, item: m.item || null, ability: m.ability || null, moves: m.attacks || [], nature: m.nature || null, tera: m.tera || null })),
            });
          }
        });
        summary.tournamentsProcessed += 1;
        const tDate = new Date(tournament.date);
        if (!newestProcessedDate || tDate > newestProcessedDate) newestProcessedDate = tDate;
      } catch (err) {
        // Fail soft, per tournament — one bad response never aborts the
        // whole run (see this file's header comment and Milestone 34's
        // own task description: "fail soft per-tournament").
        summary.tournamentsSkipped += 1;
        summary.errors.push(`Tournament ${tournament.id} (${tournament.name}): ${err.message}`);
      }
    }

    if (!isDryRun) {
      // Fold this run's tournament-scoped sums onto whatever's already in
      // the database (mergeRunningAverage), then upsert.
      const existingTierRows = await supabaseSelect("live_tier_stats", `format=eq.${WC_FORMAT}&select=species,times_used,win_rate`);
      const existingTierByName = Object.fromEntries(existingTierRows.map((r) => [r.species, r]));
      const tierUpsertRows = Object.entries(tierStats).map(([species, agg]) => {
        const merged = mergeRunningAverage(existingTierByName[species], agg.timesUsed, agg.winRateSum);
        const sampleTournamentsSoFar = (existingTierByName[species] && existingTierByName[species].sample_tournaments) || 0;
        return { species, format: WC_FORMAT, times_used: merged.timesUsed, win_rate: merged.winRate, sample_tournaments: sampleTournamentsSoFar + summary.tournamentsProcessed, updated_at: new Date().toISOString() };
      });
      await supabaseUpsert("live_tier_stats", tierUpsertRows, "species,format");
      summary.speciesUpdated = tierUpsertRows.length;

      const existingBuildRows = await supabaseSelect("live_meta_builds", `format=eq.${WC_FORMAT}&select=species,ability,item,nature,moves,times_used,win_rate`);
      const existingBuildByKey = Object.fromEntries(existingBuildRows.map((r) => [buildKeyFor(r.species, r.ability, r.item, r.nature, r.moves || []), r]));
      const buildUpsertRows = Object.entries(metaBuilds).map(([key, agg]) => {
        const merged = mergeRunningAverage(existingBuildByKey[key], agg.timesUsed, agg.winRateSum);
        return { species: agg.species, format: WC_FORMAT, ability: agg.ability, item: agg.item, nature: agg.nature, moves: agg.moves, times_used: merged.timesUsed, win_rate: merged.winRate, updated_at: new Date().toISOString() };
      });
      await supabaseUpsert("live_meta_builds", buildUpsertRows, "species,format,ability,item,nature,moves");
      summary.buildsUpdated = buildUpsertRows.length;

      await supabaseUpsert("live_reference_teams", referenceTeamRows, "format,source_tournament_id,placement");
      summary.referenceTeamsUpserted = referenceTeamRows.length;

      await supabaseInsert("live_pipeline_runs", {
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: summary.tournamentsSkipped > 0 && summary.tournamentsProcessed === 0 ? "failed" : summary.tournamentsSkipped > 0 ? "partial" : "success",
        tournaments_processed: summary.tournamentsProcessed,
        tournaments_skipped: summary.tournamentsSkipped,
        newest_tournament_date: newestProcessedDate ? newestProcessedDate.toISOString() : null,
        error: summary.errors.length ? summary.errors.join(" | ").slice(0, 4000) : null,
      });
    } else {
      // Dry run: report exactly what WOULD have been written, without a
      // single call to Supabase's write endpoints.
      summary.speciesUpdated = Object.keys(tierStats).length;
      summary.buildsUpdated = Object.keys(metaBuilds).length;
      summary.referenceTeamsUpserted = referenceTeamRows.length;
      summary.wouldWrite = { tierStats, metaBuilds: Object.values(metaBuilds), referenceTeamRows };
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
          tournaments_processed: summary.tournamentsProcessed,
          tournaments_skipped: summary.tournamentsSkipped,
          error: err.message.slice(0, 4000),
        });
      } catch {
        // Nothing more useful to do if even the failure log can't be written — the error is already in the HTTP response below.
      }
    }
    res.status(500).json(summary);
  }
}

module.exports = handler;
// Pure aggregation helpers, exposed for tools/test-limitless-pipeline.mjs —
// none of these touch the network or the database, so they're testable
// directly against a canned standings fixture with zero mocking.
module.exports.foldPlayerIntoAggregates = foldPlayerIntoAggregates;
module.exports.mergeRunningAverage = mergeRunningAverage;
module.exports.buildKeyFor = buildKeyFor;
