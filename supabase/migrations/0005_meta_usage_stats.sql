-- WinCon — Milestone 28: logged battles now feed a real, cross-user
-- meta_usage_stats table -- not just the single player who logged them.
--
-- public.match_results and public.meta_usage_stats were both created
-- back in 0001_init.sql, anticipating exactly this ("meta_usage_stats --
-- rebuilt... from match_results across every user (anonymized aggregate)
-- -- this is what eventually replaces data/starter-threats.json's
-- hand-picked list"), but nothing ever wrote to match_results -- Milestone
-- 22 took the simpler shortcut of mirroring each team's log onto
-- teams.match_log as one JSON column instead (see 0004_team_match_log.sql's
-- own comment, which explicitly called this bigger feature out and
-- deferred it). This migration is that deferred feature.
--
-- Paste this whole file into Supabase's SQL Editor (same place you ran
-- 0001/0002/0003/0004) and click Run once. It only adds to what those
-- already created -- safe to run after them, not a replacement.
--
-- What this adds:
--   1. match_results.team_snapshot -- the Pokémon on the team AT THE
--      MOMENT a result was logged. Needed because a team's roster can
--      change after a game is logged; without a snapshot, "which
--      Pokémon were actually used in this game" would silently drift to
--      whatever the team looks like today instead of what was played.
--   2. A trigger that keeps meta_usage_stats current the moment a row is
--      inserted into or deleted from match_results: for every species in
--      team_snapshot, times_used/win_rate_used get recomputed from every
--      logged game across every player (not just this one); for every
--      species in `opponent`, times_faced/win_rate_faced likewise. Every
--      number is anonymized aggregate -- no user_id, no opponent
--      identity, nothing but a species name, a format, and a count --
--      exactly what meta_usage_stats' own read policy already assumed
--      ("Anyone signed in can read usage stats").
--
-- teams.js's wcPushMatchResultToCloud/wcDeleteMatchResultFromCloud (both
-- fire-and-forget, same shape as every other cloud call in this app) are
-- what write/delete match_results rows in the first place -- logging (or
-- deleting) a result already requires a signed-in account, so every row
-- here always has a real, RLS-checked user_id, even though nothing
-- downstream of the trigger ever surfaces it.
--
-- Dream Team, Auto-build team, and Auto-build strategy read the result
-- (see wcAugmentThreatsWithMetaUsage and wcMetaUsageCandidateBonus in
-- strategy.js) as a real-world supplement to the hand-curated
-- data/starter-threats.json list -- gated on a minimum sample size
-- (WC_META_USAGE_MIN_SAMPLE) so a species with one or two logged games
-- doesn't get over-weighted. Early on, with only a handful of games
-- logged across the whole site, this will mostly sit quiet and defer to
-- the existing curated heuristics -- it gets more useful as more games
-- get logged, by any player, not just you. See README.md's Milestone 28
-- section.

alter table public.match_results
  add column if not exists team_snapshot jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Recomputes ONE species/format row in meta_usage_stats from scratch, by
-- re-aggregating match_results directly -- simpler and less error-prone
-- than maintaining a running average incrementally, and cheap enough at
-- this project's scale to just re-run on every insert/delete. Deletes the
-- row entirely once a species has zero games logged either way (e.g. the
-- one player who'd ever logged it deletes that result), rather than
-- leaving a stale 0/0 row behind.
--
-- security definer: meta_usage_stats' own RLS only allows the service
-- role to write to it (see 0001_init.sql) -- this function runs as its
-- owner (whichever privileged role runs this migration), which is what
-- lets a normal signed-in user's INSERT into match_results still update
-- the aggregate without opening meta_usage_stats up to direct writes
-- from anyone.
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
    from public.match_results mr, jsonb_array_elements_text(mr.team_snapshot) as s
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

-- ---------------------------------------------------------------------------
-- Trigger glue: on INSERT, recompute every species the NEW row touches.
-- On DELETE (a player deleting a logged result -- see teams.js's
-- wcDeleteMatchResult), recompute every species the REMOVED row touched,
-- so a deleted mistake doesn't linger in the shared aggregate. No UPDATE
-- case -- the app never edits a logged row in place, only inserts or
-- deletes whole ones.
-- ---------------------------------------------------------------------------
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

  for species in select jsonb_array_elements_text(r.team_snapshot) loop
    perform public.wc_recompute_meta_usage_for_species(species, r.format);
  end loop;
  for species in select jsonb_array_elements_text(r.opponent) loop
    perform public.wc_recompute_meta_usage_for_species(species, r.format);
  end loop;

  return null; -- AFTER trigger; return value is ignored either way
end;
$$;

drop trigger if exists wc_match_results_meta_usage_trigger on public.match_results;
create trigger wc_match_results_meta_usage_trigger
  after insert or delete on public.match_results
  for each row execute function public.wc_match_results_touch_meta_usage();
