-- WinCon — Milestone 34: the Limitless pipeline.
--
-- WinCon's competitive grounding today is two things: meta_usage_stats
-- (0005_meta_usage_stats.sql — real, but only as good as how many games
-- WinCon's own users have logged) and data/meta-baseline.json (a small,
-- hand-curated, point-in-time set of reference teams). This migration adds
-- a third, live tier in between: real Regulation M-B tournament results
-- pulled from Limitless's public tournaments API
-- (https://play.limitlesstcg.com/api), refreshed on a schedule by a new
-- Vercel Cron job (see api/cron-limitless-sync.js) — not by anything this
-- migration itself runs.
--
-- Paste this whole file into Supabase's SQL Editor (same place every prior
-- migration was run) and click Run once, after 0001 through 0006. It only
-- adds new tables — nothing here touches match_results, meta_usage_stats,
-- or combo_synergy_stats.
--
-- Four new tables, all read-only to normal users and written only by the
-- pipeline job's service-role key (same RLS shape as meta_usage_stats —
-- see 0001_init.sql's own comment on why: "Read-only to normal users;
-- written only by the service role."):
--
--   1. live_pipeline_runs — one row per pipeline run: when it ran, how
--      many tournaments it processed/skipped, whether it succeeded, and
--      the newest tournament date it actually finished processing (the
--      pipeline job's own cursor for "what's new since last time" — see
--      that file's header comment). Observability, not app-facing.
--
--   2. live_tier_stats — per-species usage share and win rate, aggregated
--      across every real tournament entrant the pipeline has processed
--      for this format. Structural sibling of meta_usage_stats (same
--      species+format primary key), but there is no "times_faced" side
--      here — Limitless's standings payload is a decklist plus an overall
--      win/loss record, not a per-matchup opponent breakdown, so there's
--      nothing to aggregate on the "faced" side the way match_results'
--      own `opponent` column allows.
--
--   3. live_meta_builds — the real ability/item/nature/move combinations
--      actually played, per species, with how often and how well each
--      one did. Pokémon Zone's own "Meta Builds" breakdown is built on
--      the same idea.
--
--   4. live_reference_teams — full real 6-member tournament teams, kept
--      as candidate reference opponents for Simulated Win Rate. IMPORTANT:
--      Milestone 34's own Task 1 research confirmed a Limitless decklist
--      entry stops at {species, item, ability, moves, nature, tera} — no
--      Stat Points/EV-equivalent field exists anywhere in the API. That
--      means a row here can describe *what* a real team ran, but never
--      the full stat allocation Simulated Win Rate's engine needs to
--      actually battle it (see battle-sim-lineup.js's wcBattlerSpecForSlot,
--      which requires a full `sp` block). This table is populated by the
--      pipeline job starting now, but is NOT wired into the Simulated Win
--      Rate opponent pool in this migration or in Milestone 34's Task 4 —
--      that's explicitly Task 5, deferred until/unless a stat-spread
--      source is ever found. For now this feeds live_tier_stats/
--      live_meta_builds' aggregation and is available for a future
--      "real teams from this event" display.

-- ---------------------------------------------------------------------------
-- live_pipeline_runs
-- ---------------------------------------------------------------------------
create table if not exists public.live_pipeline_runs (
  id                      uuid primary key default gen_random_uuid(),
  started_at              timestamptz not null default now(),
  finished_at             timestamptz,
  status                  text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  tournaments_processed   int not null default 0,
  tournaments_skipped     int not null default 0,
  newest_tournament_date  timestamptz,  -- the pipeline job's own "since" cursor for next run — see api/cron-limitless-sync.js
  error                   text
);

alter table public.live_pipeline_runs enable row level security;

drop policy if exists "Anyone signed in can read pipeline run history" on public.live_pipeline_runs;
create policy "Anyone signed in can read pipeline run history"
  on public.live_pipeline_runs for select
  using (auth.role() = 'authenticated');
-- (No insert/update/delete policy — only the service role, which bypasses
-- RLS, is meant to write here.)

-- ---------------------------------------------------------------------------
-- live_tier_stats — structural sibling of meta_usage_stats (0001_init.sql),
-- but sourced from real tournament results instead of WinCon's own logged
-- battles, and with no "faced" side (see header comment above).
-- ---------------------------------------------------------------------------
create table if not exists public.live_tier_stats (
  species              text not null,
  format               text not null check (format in ('singles', 'doubles')),
  times_used           int not null default 0,
  win_rate             numeric,
  sample_tournaments   int not null default 0,  -- how many distinct tournaments this aggregate is drawn from
  updated_at           timestamptz not null default now(),
  primary key (species, format)
);

alter table public.live_tier_stats enable row level security;

drop policy if exists "Anyone signed in can read live tier stats" on public.live_tier_stats;
create policy "Anyone signed in can read live tier stats"
  on public.live_tier_stats for select
  using (auth.role() = 'authenticated');
-- (No insert/update/delete policy — service role only, same as above.)

-- ---------------------------------------------------------------------------
-- live_meta_builds — one row per distinct real build signature seen for a
-- species (species+format+ability+item+nature+moves), upserted by the
-- pipeline job as it re-aggregates. `moves` is stored sorted so two
-- decklists naming the same four moves in a different order upsert onto
-- the same row rather than creating a duplicate.
-- ---------------------------------------------------------------------------
create table if not exists public.live_meta_builds (
  id           uuid primary key default gen_random_uuid(),
  species      text not null,
  format       text not null check (format in ('singles', 'doubles')),
  ability      text,
  item         text,
  nature       text,
  moves        text[] not null default '{}',
  times_used   int not null default 0,
  win_rate     numeric,
  updated_at   timestamptz not null default now(),
  unique (species, format, ability, item, nature, moves)
);

alter table public.live_meta_builds enable row level security;

drop policy if exists "Anyone signed in can read live meta builds" on public.live_meta_builds;
create policy "Anyone signed in can read live meta builds"
  on public.live_meta_builds for select
  using (auth.role() = 'authenticated');
-- (No insert/update/delete policy — service role only, same as above.)

-- ---------------------------------------------------------------------------
-- live_reference_teams — see header comment (point 4) for why `members`
-- deliberately has no stat-spread field. `source_tournament_id` +
-- `placement` together make a run idempotent: re-processing the same
-- tournament upserts the same rows instead of duplicating them.
-- NOTE: this column is named `placement`, not `placing` — PLACING is a
-- reserved PostgreSQL keyword (it's part of the standard OVERLAY(...
-- PLACING ... FROM ...) function syntax) and cannot be used as a bare
-- column identifier; using it here throws "syntax error at or near
-- placing". `player.placing` from Limitless's own API is unaffected —
-- only this table's own outgoing column is renamed (see
-- api/cron-limitless-sync.js).
-- ---------------------------------------------------------------------------
create table if not exists public.live_reference_teams (
  id                       uuid primary key default gen_random_uuid(),
  format                   text not null check (format in ('singles', 'doubles')),
  source_tournament_id     text not null,
  source_tournament_name   text,
  placement                int,
  record_wins              int,
  record_losses            int,
  record_ties              int,
  members                  jsonb not null default '[]'::jsonb,  -- [{name, item, ability, moves, nature, tera}, ...] — see header comment on why there's no per-member stat spread
  captured_at              timestamptz not null default now(),
  unique (format, source_tournament_id, placement)
);

alter table public.live_reference_teams enable row level security;

drop policy if exists "Anyone signed in can read live reference teams" on public.live_reference_teams;
create policy "Anyone signed in can read live reference teams"
  on public.live_reference_teams for select
  using (auth.role() = 'authenticated');
-- (No insert/update/delete policy — service role only, same as above.)
