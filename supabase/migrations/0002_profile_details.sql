-- WinCon — Milestone 16 follow-up: collect a real name, age, a chosen (or
-- auto-generated) username, and a starting avatar at sign-up.
--
-- Paste this whole file into Supabase's SQL Editor (same place you ran
-- 0001_init.sql) and click Run once. It only ALTERs what 0001 already
-- created — safe to run after 0001, not a replacement for it.
--
-- Design notes:
--   - `username` replaces the old `display_name` column on both `profiles`
--     and `profile_public` (same idea, better name now that it's a real,
--     unique, publicly-shown handle rather than a placeholder string).
--   - `first_name`, `last_name`, and `age` live ONLY on the private
--     `profiles` table — never copied to `profile_public`. Friends see
--     your username and avatar, never your real name or age. That's a
--     deliberate privacy choice, not an oversight.
--   - `avatar_species` already existed on `profile_public` from 0001; it
--     now also gets set the moment an account is created (a Pokémon
--     pulled from the chosen username if one's hiding in there, otherwise
--     a random one) rather than staying empty until Milestone 18's
--     "most-used Pokémon" logic takes over.
--   - `is_username_available()` is a new function anyone (even a
--     signed-out visitor) can call to check if a username is taken,
--     without exposing anything else about the account that has it — the
--     private `profiles` table itself stays fully locked down.

alter table public.profiles
  add column first_name text,
  add column last_name text,
  add column age integer,
  add column avatar_species text;

alter table public.profiles
  add constraint profiles_age_range check (age is null or (age between 13 and 120));

alter table public.profiles rename column display_name to username;
alter table public.profiles alter column username drop default;
alter table public.profiles add constraint profiles_username_unique unique (username);

alter table public.profile_public rename column display_name to username;
alter table public.profile_public alter column username drop default;
alter table public.profile_public add constraint profile_public_username_unique unique (username);

-- ---------------------------------------------------------------------------
-- Anyone can check whether a username is taken (needed so the sign-up form
-- can validate live) without being able to read anything else about who
-- holds it — `profiles` itself stays owner-only via its existing RLS policy.
-- ---------------------------------------------------------------------------
create or replace function public.is_username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(candidate)
  );
$$;

grant execute on function public.is_username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- New-user bootstrap, updated for the new fields. All of them arrive as
-- sign-up metadata (supabase.auth.signUp({ options: { data: {...} } })) —
-- see auth.js. If a required field is somehow missing, this still can't
-- fail: a username is generated from the account's own id, and age simply
-- ends up null (age_confirmed then stays false, so the mandatory in-app
-- age-gate modal catches it before any signed-in feature is usable).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), 'Trainer-' || substr(new.id::text, 1, 8));
  v_age integer := nullif(new.raw_user_meta_data->>'age', '')::integer;
  v_avatar text := nullif(new.raw_user_meta_data->>'avatar_species', '');
  v_age_ok boolean := v_age is not null and v_age >= 16;
begin
  insert into public.profiles (id, username, first_name, last_name, age, avatar_species, age_confirmed, age_confirmed_at)
  values (
    new.id,
    v_username,
    nullif(trim(new.raw_user_meta_data->>'first_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'last_name'), ''),
    v_age,
    v_avatar,
    v_age_ok,
    case when v_age_ok then now() else null end
  );

  insert into public.profile_public (user_id, username, avatar_species)
  values (new.id, v_username, v_avatar);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Keep profile_public's username/avatar/favourite-team in sync with the
-- private profiles row whenever any of those three change.
-- ---------------------------------------------------------------------------
create or replace function public.sync_profile_public()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profile_public
  set username = new.username,
      favourite_team_id = new.favourite_team_id,
      avatar_species = new.avatar_species,
      updated_at = now()
  where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists on_profile_updated on public.profiles;
create trigger on_profile_updated
  after update of username, favourite_team_id, avatar_species on public.profiles
  for each row execute function public.sync_profile_public();
