-- WinCon — Simulated Win Rate: scoped battle logging + combo-synergy
-- learning loop.
--
-- Paste this whole file into Supabase's SQL Editor (same place you ran
-- 0001/0004/0005) and click Run once. It only adds to / corrects what
-- those already created — safe to run after them, not a replacement.
--
-- Background: match_results.team_snapshot (0005) captures a team's FULL
-- 6-Pokémon roster at the moment a result was logged — but only 4 of
-- those 6 (3 in Singles) were actually brought and battled with; the
-- other 2 (or 3) sat on the bench the whole game. Crediting a win/loss
-- to Pokémon that never played is exactly the gap Phoenix's own request
-- called out ("look at the 4 selected pokemon... don't offer all 6").
-- This migration:
--
--   1. Adds match_results.lineup_used (the real bring-4/3, written by
--      the Battle Tracker's log form — see battle-tracker.js/teams.js)
--      and match_results.lineup_key, a sorted/pipe-joined text version
--      of the same list computed CLIENT-SIDE at insert time (teams.js).
--      Client-side is simpler than a DB trigger here and just as
--      reliable, since the client already has the exact array in hand
--      when it builds the insert payload.
--   2. Fixes wc_recompute_meta_usage_for_species (0005) to read
--      lineup_used instead of team_snapshot for the "used" half, so the
--      per-species real-battle nudge (wcMetaUsageCandidateBonus,
--      strategy.js) only ever credits Pokémon that were truly brought.
--      team_snapshot itself is untouched — still shown historically,
--      just no longer what the stats trigger reads.
--   3. Adds combo_synergy_stats — a structural mirror of meta_usage_stats
--      (0005), but keyed on a whole 4/3-Pokémon combination instead of
--      one species — "the synergy for that combination of pokemon team"
--      Phoenix asked for. Nothing like this existed before this
--      migration; see strategy.js's wcComboSynergyBonus for the consumer.
--   4. Backfills every pre-existing row (lineup_used defaults to '[]',
--      so any row still at that default gets team_snapshot copied in as
--      an explicit, honest approximation — old rows never captured the
--      true bring-4/3), then re-aggregates both stats tables from
--      scratch so existing numbers reflect the fix immediately rather
--      than waiting for the next insert/delete.

alter table public.match_results
  add column if not exists lineup_used jsonb not null default '[]'::jsonb,
  add column if not exists lineup_key text;

-- ---------------------------------------------------------------------------
-- Fix: the "used" half now reads lineup_used (the real bring-4/3)
-- instead of team_snapshot (the full 6). The "faced" half (`opponent`,
-- the post-hoc free-text field battle-tracker.js's log form already
-- collects) is unrelated to this fix and stays exactly as 0005 had it.
-- ---------------------------------------------------------------------------
create or replace function public.wc_recompute_meta_usage_for_species(p_species text, p_format text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_times_used int;
  v_win_rate_used numeric;
  v_times_faced int;
  v_win_rate_faced numeric;
begin
  select count(*), round(100.0 * sum((mr.result = 'win')::int) / count(*), 1)
    into v_times_used, v_win_rate_used
    from public.match_results mr, jsonb_array_elements_text(mr.lineup_used) as s
    where s = p_species and mr.format = p_format;

  select count(*), round(100.0 * sum((mr.result = 'win')::int) / count(*), 1)
    into v_times_faced, v_win_rate_faced
    from public.match_results mr, jsonb_array_elements_text(mr.opponent) as s
    where s = p_species and mr.format = p_format;

  if coalesce(v_times_used, 0) = 0 and coalesce(v_times_faced, 0) = 0 then
    delete from public.meta_usage_stats where species = p_species and format = p_format;
    return;
  end if;

  insert into public.meta_usage_stats (species, format, times_used, times_faced, win_rate_used, win_rate_faced, updated_at)
  values (p_species, p_format, coalesce(v_times_used, 0), coalesce(v_times_faced, 0), v_win_rate_used, v_win_rate_faced, now())
  on conflict (species, format) do update
    set times_used = excluded.times_used,
        times_faced = excluded.times_faced,
        win_rate_used = excluded.win_rate_used,
        win_rate_faced = excluded.win_rate_faced,
        updated_at = now();
end;
$$;

-- Same trigger-glue shape as 0005 — now also walks lineup_used (in
-- addition to opponent) so the existing meta_usage_stats trigger stays
-- correct against the fixed function above.
create or replace function public.wc_match_results_touch_meta_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.match_results%rowtype;
  species text;
begin
  if TG_OP = 'DELETE' then
    r := OLD;
  else
    r := NEW;
  end if;

  for species in select jsonb_array_elements_text(r.lineup_used) loop
    perform public.wc_recompute_meta_usage_for_species(species, r.format);
  end loop;
  for species in select jsonb_array_elements_text(r.opponent) loop
    perform public.wc_recompute_meta_usage_for_species(species, r.format);
  end loop;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- combo_synergy_stats — the new combination-level table. Structural
-- mirror of meta_usage_stats (species+format PK -> combo_key+format PK).
-- ---------------------------------------------------------------------------
create table if not exists public.combo_synergy_stats (
  combo_key   text not null,   -- sorted, pipe-joined species names (see lineup_key above)
  format      text not null check (format in ('singles', 'doubles')),
  times_used  int not null default 0,
  win_rate    numeric,
  updated_at  timestamptz not null default now(),
  primary key (combo_key, format)
);

alter table public.combo_synergy_stats enable row level security;

drop policy if exists "Anyone signed in can read combo synergy stats" on public.combo_synergy_stats;
create policy "Anyone signed in can read combo synergy stats"
  on public.combo_synergy_stats for select
  using (auth.role() = 'authenticated');
-- (No insert/update/delete policy — same as meta_usage_stats, only the
-- trigger function below (security definer) writes here.)

create or replace function public.wc_recompute_combo_synergy(p_combo_key text, p_format text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_times_used int;
  v_win_rate numeric;
begin
  select count(*), round(100.0 * sum((mr.result = 'win')::int) / count(*), 1)
    into v_times_used, v_win_rate
    from public.match_results mr
    where mr.lineup_key = p_combo_key and mr.format = p_format;

  if coalesce(v_times_used, 0) = 0 then
    delete from public.combo_synergy_stats where combo_key = p_combo_key and format = p_format;
    return;
  end if;

  insert into public.combo_synergy_stats (combo_key, format, times_used, win_rate, updated_at)
  values (p_combo_key, p_format, v_times_used, v_win_rate, now())
  on conflict (combo_key, format) do update
    set times_used = excluded.times_used,
        win_rate = excluded.win_rate,
        updated_at = now();
end;
$$;

create or replace function public.wc_match_results_touch_combo_synergy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.match_results%rowtype;
begin
  if TG_OP = 'DELETE' then
    r := OLD;
  else
    r := NEW;
  end if;

  if r.lineup_key is not null and r.lineup_key <> '' then
    perform public.wc_recompute_combo_synergy(r.lineup_key, r.format);
  end if;

  return null;
end;
$$;

drop trigger if exists wc_match_results_combo_synergy_trigger on public.match_results;
create trigger wc_match_results_combo_synergy_trigger
  after insert or delete on public.match_results
  for each row execute function public.wc_match_results_touch_combo_synergy();

-- ---------------------------------------------------------------------------
-- One-time backfill + re-aggregation. Safe to run more than once — the
-- WHERE clause only touches rows that never got a real lineup_used, and
-- every recompute call is idempotent (full re-aggregation, not an
-- incremental bump).
-- ---------------------------------------------------------------------------
update public.match_results
set
  lineup_used = team_snapshot,
  lineup_key = (
    select string_agg(val, '|' order by val)
    from jsonb_array_elements_text(team_snapshot) as val
  )
where lineup_used = '[]'::jsonb;

do $$
declare
  rec record;
begin
  for rec in
    select distinct species, format from (
      select jsonb_array_elements_text(lineup_used) as species, format from public.match_results
      union
      select jsonb_array_elements_text(opponent) as species, format from public.match_results
    ) all_species
  loop
    perform public.wc_recompute_meta_usage_for_species(rec.species, rec.format);
  end loop;

  for rec in
    select distinct lineup_key as combo_key, format from public.match_results
    where lineup_key is not null and lineup_key <> ''
  loop
    perform public.wc_recompute_combo_synergy(rec.combo_key, rec.format);
  end loop;
end $$;
