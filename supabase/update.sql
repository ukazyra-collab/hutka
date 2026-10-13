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
