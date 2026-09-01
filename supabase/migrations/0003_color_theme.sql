-- ---------------------------------------------------------------------------
-- Color theme follows the signed-in ACCOUNT, not just one browser.
--
-- Until now, the theme picker (Default/Charizard/Fairy/Water/Grass/
-- Pikachu -- see theme.js) only ever lived in that browser's localStorage,
-- so logging in on a different device or browser reset it. This adds a
-- column so a signed-in user's choice is saved to their account and
-- follows them anywhere they log in.
--
-- It's a personal UI preference, not something friends need to see, so it
-- lives on the private `profiles` table only -- never copied to the
-- friend-visible `profile_public` -- the same privacy boundary already
-- used for first_name/last_name/age (see 0002_profile_details.sql).
--
-- `not null default 'default'` backfills every existing row to "default"
-- automatically; no data migration needed. The existing "Users manage
-- their own profile" RLS policy (`for all ... using (auth.uid() = id)`)
-- already covers updating this column -- no policy change needed either.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column color_theme text not null default 'default'
  check (color_theme in ('default', 'charizard', 'fairy', 'water', 'grass', 'electric'));
