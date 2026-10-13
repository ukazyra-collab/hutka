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
create policy "likes read" on likes for select using (true);
create policy "likes own" on likes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "comments read" on comments for select using (true);
create policy "comments insert" on comments for insert with check (user_id = auth.uid() and length(text) between 1 and 1000);
create policy "comments delete" on comments for delete using (user_id = auth.uid() or is_admin());
create policy "follows read" on follows for select using (true);
create policy "follows own" on follows for all using (follower = auth.uid()) with check (follower = auth.uid());
