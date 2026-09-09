-- WinCon — obtained Pokémon now follow the signed-in ACCOUNT, not just one
-- browser (Milestone 62).
--
-- The bug this fixes: app.js/home.js/builder.js have always kept a
-- player's "obtained" (marked-caught) Pokémon under one localStorage key
-- ("wincon.obtained") in whichever browser marked them, with no cloud copy
-- at all -- unlike teams (0001_init.sql) and locked builds
-- (0008_locked_builds.sql), which do sync to the account. Switching Chrome
-- PROFILES (each with its own entirely separate localStorage, exactly like
-- switching to a different browser or device) and signing into the same
-- account showed whatever THAT profile's own storage already held --
-- nothing, or a stale snapshot left over from some earlier, unrelated
-- visit -- never the account's real, current Pokédex. This is the same
-- class of bug 0003_color_theme.sql already fixed for the theme picker.
--
-- Shape mirrors `locked_builds` (0008), not `teams`' one-JSONB-blob-per-
-- team shape: "obtained" is naturally a flat set of names with nothing
-- else to carry per entry, so one row per (user, species) is the natural
-- fit -- marking/unmarking a single Pokémon upserts or deletes exactly one
-- row (see wcSetObtainedInCloud in teams.js), never a full-table
-- reconciliation sweep on every checkbox click.
--
-- Paste this whole file into Supabase's SQL Editor and click Run once,
-- after 0001 through 0009.

create table if not exists public.obtained_pokemon (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  species     text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, species)
);

create index if not exists obtained_pokemon_user_idx on public.obtained_pokemon (user_id);

alter table public.obtained_pokemon enable row level security;

drop policy if exists "Users manage their own obtained Pokemon" on public.obtained_pokemon;
create policy "Users manage their own obtained Pokemon"
  on public.obtained_pokemon for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
