-- WinCon — Milestone 15: foundation schema (accounts, teams, match log,
-- friends, notifications, push subscriptions, and the meta-update admin
-- queue). Paste this whole file into Supabase's SQL Editor (your project
-- dashboard -> SQL Editor -> New query) and click Run once.
--
-- Design notes, so future-you (or Claude Code) knows WHY this looks the
-- way it does:
--   - `profiles` is PRIVATE (row-level security: only the owner can read
--     or write their own row). Never queried by anyone else's session.
--   - `profile_public` is a deliberately small, separately-synced table
--     holding only what a friend is allowed to see (display name,
--     favourite team, avatar species). This is the actual mechanism that
--     makes "friends only see your favourite team, nothing else"
--     enforced by the database itself, not just hidden in the UI.
--   - Every table uses Row Level Security. Nothing is readable by default
--     — each policy below is an explicit exception.
--   - Admin-only actions (the meta-update tool) go through the service
--     role key from an Edge Function, which bypasses RLS entirely — that
--     key must never reach client-side code.

-- ---------------------------------------------------------------------------
-- profiles — one private row per signed-up user
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text not null default 'New Trainer',
  age_confirmed     boolean not null default false,
  age_confirmed_at  timestamptz,
  favourite_team_id uuid,  -- fk added after `teams` exists, below
  is_admin          boolean not null default false,
  created_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users manage their own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- teams — mirrors the shape teams.js already stores in localStorage
-- ---------------------------------------------------------------------------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default 'Team 1',
  format      text not null default 'doubles' check (format in ('singles', 'doubles')),
  sheet_mode  text not null default 'closed' check (sheet_mode in ('open', 'closed')),
  chosen      jsonb not null default '[]'::jsonb,   -- array of Pokémon names
  builds      jsonb not null default '{}'::jsonb,   -- { [name]: { nature, item, moves, sp } }
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_favourite_team_fk
  foreign key (favourite_team_id) references public.teams(id) on delete set null;

alter table public.teams enable row level security;

create policy "Users manage their own teams"
  on public.teams for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- match_results — replaces each team's client-only matchLog array
-- ---------------------------------------------------------------------------
create table public.match_results (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  result      text not null check (result in ('win', 'loss')),
  note        text not null default '',
  opponent    jsonb not null default '[]'::jsonb,  -- array of Pokémon names
  format      text not null check (format in ('singles', 'doubles')),
  logged_at   timestamptz not null default now()
);

alter table public.match_results enable row level security;

create policy "Users manage their own match log"
  on public.match_results for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- meta_usage_stats — rebuilt by a scheduled Edge Function from
-- match_results across every user (anonymized aggregate) — this is what
-- eventually replaces data/starter-threats.json's hand-picked list.
-- Read-only to normal users; written only by the service role.
-- ---------------------------------------------------------------------------
create table public.meta_usage_stats (
  species         text not null,
  format          text not null check (format in ('singles', 'doubles')),
  times_used      int not null default 0,
  times_faced     int not null default 0,
  win_rate_used   numeric,
  win_rate_faced  numeric,
  updated_at      timestamptz not null default now(),
  primary key (species, format)
);

alter table public.meta_usage_stats enable row level security;

create policy "Anyone signed in can read usage stats"
  on public.meta_usage_stats for select
  using (auth.role() = 'authenticated');
-- (No insert/update/delete policy — only the service role, which bypasses
-- RLS, is meant to write here.)

-- ---------------------------------------------------------------------------
-- friend_requests — request/accept model, not an instant follow
-- ---------------------------------------------------------------------------
create table public.friend_requests (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references auth.users(id) on delete cascade,
  addressee_id   uuid not null references auth.users(id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at     timestamptz not null default now(),
  responded_at   timestamptz,
  constraint no_self_request check (requester_id <> addressee_id),
  constraint one_request_per_pair unique (requester_id, addressee_id)
);

alter table public.friend_requests enable row level security;

create policy "Both sides of a request can see it"
  on public.friend_requests for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Users can send requests as themselves"
  on public.friend_requests for insert
  with check (auth.uid() = requester_id);

create policy "Either side can update a request's status"
  on public.friend_requests for update
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Helper used by profile_public's policy below: true once a friend_request
-- between the two users exists with status = 'accepted', either direction.
create function public.is_friends_with(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friend_requests
    where status = 'accepted'
      and ((requester_id = a and addressee_id = b)
        or (requester_id = b and addressee_id = a))
  );
$$;

-- ---------------------------------------------------------------------------
-- profile_public — the ONLY thing a friend can ever see about you. Kept in
-- sync from profiles/teams by the trigger below rather than exposing any
-- column of the private `profiles` table directly.
-- ---------------------------------------------------------------------------
create table public.profile_public (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  display_name      text not null default 'New Trainer',
  favourite_team_id uuid references public.teams(id) on delete set null,
  avatar_species    text,   -- most-used Pokémon on the favourite team; filled in by application code for now (see Milestone 15 README note), not yet a live trigger
  updated_at        timestamptz not null default now()
);

alter table public.profile_public enable row level security;

create policy "You can always see your own public profile"
  on public.profile_public for select
  using (auth.uid() = user_id);

create policy "Accepted friends can see your public profile"
  on public.profile_public for select
  using (public.is_friends_with(auth.uid(), user_id));

create policy "Users maintain their own public profile row"
  on public.profile_public for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- notifications — update announcements + friend-request alerts. Delivery
-- (email via Resend/Postmark, push via OneSignal) is triggered by an Edge
-- Function watching inserts here — this table is just the durable record.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('friend_request', 'meta_update', 'system')),
  title        text not null,
  body         text not null default '',
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "Users read and update their own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "Users can mark their own notifications read"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- (No insert policy for normal users — notifications are created by
-- server-side logic using the service role key.)

-- ---------------------------------------------------------------------------
-- push_subscriptions — one row per device a user has enabled push on
-- (OneSignal's player/subscription id). A user can have several (phone +
-- laptop); deleting a row just stops that one device's notifications.
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  onesignal_player_id   text not null unique,
  device_label          text,
  created_at            timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "Users manage their own push subscriptions"
  on public.push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- meta_update_runs — the admin "meta update" tool's review queue. A run is
-- proposed by the research Edge Function, sits here as 'pending', and
-- never touches data/*.json until an admin explicitly approves it.
-- ---------------------------------------------------------------------------
create table public.meta_update_runs (
  id             uuid primary key default gen_random_uuid(),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'published')),
  summary        text not null default '',
  proposed_diff  jsonb not null default '{}'::jsonb,  -- structured changeset: additions/removals/edits + the research's own reasoning per change
  requested_by   uuid references auth.users(id),
  reviewed_by    uuid references auth.users(id),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);

alter table public.meta_update_runs enable row level security;

create policy "Admins manage meta update runs"
  on public.meta_update_runs for all
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

-- ---------------------------------------------------------------------------
-- New-user bootstrap: the moment someone signs up via Supabase Auth,
-- give them a profiles row and a profile_public row automatically.
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'New Trainer'));

  insert into public.profile_public (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'New Trainer'));

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Keep profile_public.display_name / favourite_team_id in sync whenever
-- the private profiles row changes, so the friend-visible copy never
-- silently drifts from what the owner actually set.
-- ---------------------------------------------------------------------------
create function public.sync_profile_public()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profile_public
  set display_name = new.display_name,
      favourite_team_id = new.favourite_team_id,
      updated_at = now()
  where user_id = new.id;
  return new;
end;
$$;

create trigger on_profile_updated
  after update of display_name, favourite_team_id on public.profiles
  for each row execute function public.sync_profile_public();
