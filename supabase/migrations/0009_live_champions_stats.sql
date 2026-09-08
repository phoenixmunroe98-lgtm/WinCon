-- WinCon — Milestone 53: the championsbattledata.com pipeline.
--
-- Phoenix asked WinCon to pull in current-meta info from Pikalytics,
-- LabMaus, Silph Scope, and Limitless. Limitless was already fully wired
-- in (Milestone 34 -- see 0007_live_limitless_meta.sql); the other three
-- turned out to have no free, scriptable public API (Pikalytics' team-
-- builder backend isn't documented as public, Silph Scope's usage page is
-- a client-rendered SPA with no documented endpoint, LabMaus is Patreon
-- video/write-up content, not structured data). This migration is for a
-- FIFTH source that turned up during that research: championsbattledata.com
-- -- the free, no-auth, CORS-enabled API this project's own README already
-- flagged as worth another attempt ("Two honesty notes on the Matchup
-- Score" -- a previous fetch hit a tool permission timeout, not a real
-- dead end).
--
-- Why this one earns a whole new table instead of reusing
-- live_meta_builds (0007): Limitless's decklist data stops at
-- {species, item, ability, moves, nature, tera} -- confirmed by Milestone
-- 34's own research, no Stat Points/EV-equivalent field anywhere, which
-- is exactly why live_reference_teams was never wired into Simulated Win
-- Rate ("Task 5, deferred until/unless a stat-spread source is ever
-- found" -- see that migration's header). championsbattledata.com's `/api`
-- index endpoint DOES carry a real, current top Stat Point spread per
-- species (hp_points/attack_points/defense_points/sp_atk_points/
-- sp_def_points/speed_points, 0-32 each -- exactly WinCon's own system),
-- alongside its top move/item/teammate/nature/ability, each with a real
-- percentage showing how many logged builds agree. It also isn't shaped
-- like a "build signature" (live_meta_builds' species+ability+item+
-- nature+moves unique key) -- it's six independent per-category top-1
-- rows, which is why this gets its own table rather than forcing a shape
-- mismatch onto the existing one.
--
-- Refreshed by api/cron-championsdata-sync.js, once a day (see vercel.json).
-- That file's own header explains why this pipeline is simpler than
-- Limitless's: the source's `/api` index endpoint already returns each
-- species' current top-1 per category, pre-aggregated -- one fetch, no
-- per-tournament folding needed.
--
-- Paste this whole file into Supabase's SQL Editor and click Run once,
-- after 0001 through 0008.

-- ---------------------------------------------------------------------------
-- live_champions_stats -- one row per (species, format, category, rank).
-- MVP scope only ever writes rank=1 (the single current top pick per
-- category) -- the source's per-species /api/battle endpoint can return a
-- full top-10 per category too, but that's not fetched yet (see
-- api/cron-championsdata-sync.js's own header for why: the index alone
-- already unlocks this milestone's real goal, real Stat Points, at 1/236th
-- the request volume). The `rank` column exists now so a future pipeline
-- run can start writing rank 2-10 without a schema change.
-- ---------------------------------------------------------------------------
create table if not exists public.live_champions_stats (
  species              text not null,
  format               text not null check (format in ('singles', 'doubles')),
  category             text not null check (category in ('move', 'held_item', 'teammate', 'stat_alignment', 'stat_points', 'ability')),
  rank                 int not null default 1,
  name                 text,              -- the move/item/teammate/nature/ability name; null for stat_points (that category has no single "name", just the spread below)
  percentage_value     numeric,           -- real percentage of logged builds agreeing on this pick, straight from the source
  hp_points            int,               -- populated only for category = 'stat_points'; null for every other category
  attack_points        int,
  defense_points       int,
  sp_atk_points        int,
  sp_def_points        int,
  speed_points         int,
  updated_at           timestamptz not null default now(),
  primary key (species, format, category, rank)
);

alter table public.live_champions_stats enable row level security;

drop policy if exists "Anyone signed in can read live champions stats" on public.live_champions_stats;
create policy "Anyone signed in can read live champions stats"
  on public.live_champions_stats for select
  using (auth.role() = 'authenticated');
-- (No insert/update/delete policy -- only the service role, which
-- bypasses RLS, is meant to write here -- same shape as every other
-- live_* table.)

-- ---------------------------------------------------------------------------
-- live_pipeline_runs (0007) now logs runs from more than one source, so it
-- needs to say which. Existing Limitless rows have no value here yet --
-- backfilled to 'limitless' (its only source until today) rather than
-- left null, so every historical row still reads correctly.
-- ---------------------------------------------------------------------------
alter table public.live_pipeline_runs add column if not exists source text not null default 'limitless';

comment on column public.live_pipeline_runs.source is 'Which pipeline wrote this run row -- ''limitless'' (api/cron-limitless-sync.js) or ''championsdata'' (api/cron-championsdata-sync.js, Milestone 53).';
