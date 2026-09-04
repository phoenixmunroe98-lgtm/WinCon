-- WinCon — locked builds: a permanent, per-species Nature/Stat Points/
-- moveset that every team reuses instead of regenerating.
--
-- Every build-generating flow (per-slot Autofill, Auto-build team, Dream
-- Team, and Auto-build strategy's amendments) could previously overwrite
-- a Pokémon's Nature/Stat Points/moves with no way to say "this is
-- Charizard's build, permanently, everywhere." This table is that: one
-- row per (user, species, format), read by wcGenerateBuild (strategy.js)
-- to short-circuit its own Nature/Stat-Point/move-picking logic, and
-- written/deleted directly by the signed-in user from the Builder page
-- (builder.js's lock/unlock UI) via teams.js's wcSaveLockedBuild/
-- wcDeleteLockedBuild.
--
-- Deliberately per-FORMAT (a player can want a different locked
-- Charizard build for Singles vs. Doubles) but NOT per-team — locking is
-- global to the species, by design (see README.md's write-up of this
-- feature for the full rationale).
--
-- `item` and `ability` are deliberately absent from this table: they are
-- never locked. Item stays free for auto-build/strategy to adjust
-- (including Mega Stone swaps), and ability was already a pure UI-time
-- default/override, untouched by wcGenerateBuild in the first place.
--
-- Same RLS shape as `teams` (0001_init.sql) — a normal user-owned,
-- user-writable table — NOT the read-only-to-everyone/service-role-write
-- shape used by the live-data tables in 0007_live_limitless_meta.sql.
--
-- Paste this whole file into Supabase's SQL Editor and click Run once,
-- after 0001 through 0007.
create table if not exists public.locked_builds (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  species     text not null,
  format      text not null check (format in ('singles', 'doubles')),
  nature      text not null,
  sp          jsonb not null default '{}'::jsonb,
  moves       text[] not null default '{}',
  updated_at  timestamptz not null default now(),
  unique (user_id, species, format)
);

create index if not exists locked_builds_user_format_idx on public.locked_builds (user_id, format);

alter table public.locked_builds enable row level security;

drop policy if exists "Users manage their own locked builds" on public.locked_builds;
create policy "Users manage their own locked builds"
  on public.locked_builds for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
