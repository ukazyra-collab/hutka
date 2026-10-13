-- Hutka — one update file for an existing project: social layer + AI coach + profile extras. Safe to run more than once.
-- (It contains social.sql and ai.sql; if you already ran those, nothing breaks.)

-- Hutka v16 — social layer: likes, comments, follows. Run once in the SQL editor of the existing project (after setup.sql).

create table if not exists likes (
  session_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create table if not exists comments (
  id bigserial primary key,
  session_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists follows (
  follower uuid not null references auth.users(id) on delete cascade,
  followee uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee)
);
create index if not exists comments_session_idx on comments (session_id, created_at);
create index if not exists follows_followee_idx on follows (followee);
create index if not exists sessions_published_created_idx on sessions (published, created_at desc);

alter table likes enable row level security;
alter table comments enable row level security;
alter table follows enable row level security;

-- everyone reads; each person manages their own likes and follows; comments can be deleted by their author or an admin
drop policy if exists "likes read" on likes;
create policy "likes read" on likes for select using (true);
drop policy if exists "likes own" on likes;
create policy "likes own" on likes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "comments read" on comments;
create policy "comments read" on comments for select using (true);
drop policy if exists "comments insert" on comments;
create policy "comments insert" on comments for insert with check (user_id = auth.uid() and length(text) between 1 and 1000);
drop policy if exists "comments delete" on comments;
create policy "comments delete" on comments for delete using (user_id = auth.uid() or is_admin());
drop policy if exists "follows read" on follows;
create policy "follows read" on follows for select using (true);
drop policy if exists "follows own" on follows;
create policy "follows own" on follows for all using (follower = auth.uid()) with check (follower = auth.uid());


-- Hutka v18 — the racing AI: chats, messages, credits. Run once in the SQL editor (after setup.sql and social.sql).

create table if not exists chats (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  session_id text,
  track_id text,
  layout_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists messages (
  id bigserial primary key,
  chat_id bigint not null references chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  credits integer not null default 0,
  created_at timestamptz not null default now()
);
-- one wallet per person: prepaid credits and/or an active plan
create table if not exists wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 0,
  plan text not null default 'free',
  plan_until timestamptz,
  stripe_customer text,
  stripe_subscription text,
  updated_at timestamptz not null default now()
);
create table if not exists ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null default '',
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists chats_user_idx on chats (user_id, updated_at desc);
create index if not exists messages_chat_idx on messages (chat_id, created_at);
create index if not exists ledger_user_idx on ledger (user_id, created_at desc);
create unique index if not exists ledger_ref_idx on ledger (ref) where ref is not null;

alter table chats enable row level security;
alter table messages enable row level security;
alter table wallets enable row level security;
alter table ledger enable row level security;

-- chats and messages are private to their owner; replies and billing are written by the edge functions (service role)
drop policy if exists "chats own" on chats;
create policy "chats own" on chats for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "messages own read" on messages;
create policy "messages own read" on messages for select using (user_id = auth.uid());
drop policy if exists "messages own delete" on messages;
create policy "messages own delete" on messages for delete using (user_id = auth.uid());
drop policy if exists "wallet own read" on wallets;
create policy "wallet own read" on wallets for select using (user_id = auth.uid());
drop policy if exists "ledger own read" on ledger;
create policy "ledger own read" on ledger for select using (user_id = auth.uid());


-- profile extras: SWS link and results, contacts, coach flag
alter table profiles add column if not exists sws_url text not null default '';
alter table profiles add column if not exists sws_results jsonb;
alter table profiles add column if not exists instagram text not null default '';
alter table profiles add column if not exists contact text not null default '';
alter table profiles add column if not exists coach boolean not null default false;
alter table profiles add column if not exists bio text not null default '';


-- ===== v23: community tracks, kart classes, votes (same as community.sql) =====

-- 1) tracks and layouts can be added by any signed-in driver (whoever uploads the first session there);
--    the person who added a track edits it, admins edit everything, only admins delete
alter table tracks add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table layouts add column if not exists created_by uuid references auth.users(id) on delete set null;

create or replace function can_edit_track(tid text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (select 1 from tracks t where t.id = tid and t.created_by = auth.uid());
$$;
grant execute on function can_edit_track(text) to anon, authenticated;

drop policy if exists "tracks admin write" on tracks;
drop policy if exists "tracks insert" on tracks;
create policy "tracks insert" on tracks for insert with check (auth.uid() is not null and (is_admin() or created_by = auth.uid()));
drop policy if exists "tracks edit" on tracks;
create policy "tracks edit" on tracks for update using (can_edit_track(id)) with check (can_edit_track(id));
drop policy if exists "tracks delete" on tracks;
create policy "tracks delete" on tracks for delete using (is_admin());

drop policy if exists "layouts admin write" on layouts;
drop policy if exists "layouts write" on layouts;
create policy "layouts write" on layouts for all using (can_edit_track(track_id)) with check (can_edit_track(track_id));

-- media paths look like tracks/<track id>/... — the track's editor manages its pictures
drop policy if exists "media admin write" on media;
drop policy if exists "media write" on media;
create policy "media write" on media for all using (can_edit_track(split_part(path, '/', 2))) with check (can_edit_track(split_part(path, '/', 2)));

-- 2) votes: a like becomes "helpful" (+1) or "not helpful" (−1)
alter table likes add column if not exists vote smallint not null default 1;
alter table likes drop constraint if exists likes_vote_check;
alter table likes add constraint likes_vote_check check (vote in (-1, 1));

-- 3) the AI coach in the free beta: fair-use counters and an admin view of the spend
alter table messages add column if not exists ip text;
create index if not exists messages_user_role_time_idx on messages (user_id, role, created_at desc);
create index if not exists messages_role_time_idx on messages (role, created_at desc);
create index if not exists messages_ip_time_idx on messages (ip, created_at desc) where ip is not null;

-- per-day usage (questions, drivers, tokens) — admins only
create or replace function ai_usage(days int default 30)
returns table (day date, questions bigint, drivers bigint, tokens_in bigint, tokens_out bigint)
language sql stable security definer set search_path = public as $$
  select (m.created_at at time zone 'UTC')::date as day,
         count(*) filter (where m.role = 'user') as questions,
         count(distinct m.user_id) as drivers,
         coalesce(sum(m.tokens_in), 0)::bigint as tokens_in,
         coalesce(sum(m.tokens_out), 0)::bigint as tokens_out
  from messages m
  where is_admin() and m.created_at > now() - make_interval(days => greatest(1, least(days, 365)))
  group by 1 order by 1 desc;
$$;
grant execute on function ai_usage(int) to authenticated;

-- per-driver usage over the period — admins only
create or replace function ai_usage_by_user(days int default 30)
returns table (user_id uuid, racing_name text, questions bigint, tokens_in bigint, tokens_out bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(p.racing_name, '') as racing_name,
         count(*) filter (where m.role = 'user') as questions,
         coalesce(sum(m.tokens_in), 0)::bigint, coalesce(sum(m.tokens_out), 0)::bigint, max(m.created_at) as last_at
  from messages m left join profiles p on p.id = m.user_id
  where is_admin() and m.created_at > now() - make_interval(days => greatest(1, least(days, 365)))
  group by m.user_id, p.racing_name order by questions desc limit 200;
$$;
grant execute on function ai_usage_by_user(int) to authenticated;
