-- WinCon — Milestone 22: saved teams now sync to your account (see
-- teams.js's "Cloud sync" section), so they follow you to any device you
-- log into instead of staying stuck in one browser's localStorage.
--
-- Paste this whole file into Supabase's SQL Editor (same place you ran
-- 0001/0002/0003) and click Run once. It only ALTERs what 0001 already
-- created — safe to run after it, not a replacement for it.
--
-- Design note: `public.teams` (0001_init.sql) already covers everything a
-- team needs EXCEPT its logged win/loss history — that's stored locally
-- as `team.matchLog`, an array of { result, note, opponent, loggedAt }.
-- 0001 anticipated a fully separate, normalized `match_results` table for
-- this (one row per game, feeding the future cross-user meta_usage_stats
-- table) — that's a bigger, separate feature (real per-game analytics
-- across every player) that this milestone deliberately leaves alone.
-- For now, match_log is just mirrored onto `teams` as one JSON column,
-- exactly the shape it already has locally, so a team's logged record
-- travels with it across devices with no separate wiring.

alter table public.teams
  add column match_log jsonb not null default '[]'::jsonb;
