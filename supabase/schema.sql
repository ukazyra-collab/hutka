-- Hutka — database schema for Supabase (run once in the SQL editor).
-- Public reading for everyone; writing only for signed-in users (their own sessions and profile) and site admins (tracks).

create table if not exists admin_emails (email text primary key);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_emails a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function is_admin() to anon, authenticated;

create table if not exists tracks (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists layouts (
  track_id text not null references tracks(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (track_id, id)
);
create table if not exists media (
  path text primary key,
  data text,
  updated_at timestamptz not null default now()
);
create table if not exists sessions (
  id text primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  track_id text not null default '',
  layout_id text not null default 'custom',
  published boolean not null default false,
  best_ms integer,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists session_data (
  id text primary key references sessions(id) on delete cascade,
  enc text,
  data text
);
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  racing_name text not null default '',
  country text not null default '',
  home_track text not null default '',
  avatar text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists claims (
  id bigserial primary key,
  track_id text,
  by uuid,
  text text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists sessions_owner_idx on sessions (owner);
create index if not exists sessions_track_pub_idx on sessions (track_id, published);
create index if not exists sessions_track_layout_idx on sessions (track_id, layout_id, published);
create index if not exists profiles_name_idx on profiles (lower(racing_name));

alter table tracks enable row level security;
alter table layouts enable row level security;
alter table media enable row level security;
alter table sessions enable row level security;
alter table session_data enable row level security;
alter table profiles enable row level security;
alter table claims enable row level security;
alter table admin_emails enable row level security;

-- catalogue: everyone reads, admins write
create policy "tracks read" on tracks for select using (true);
create policy "tracks admin write" on tracks for all using (is_admin()) with check (is_admin());
create policy "layouts read" on layouts for select using (true);
create policy "layouts admin write" on layouts for all using (is_admin()) with check (is_admin());
create policy "media read" on media for select using (true);
create policy "media admin write" on media for all using (is_admin()) with check (is_admin());
-- sessions: published ones are public, private ones only to their owner; owners manage their own
create policy "sessions read" on sessions for select using (published or owner = auth.uid());
create policy "sessions own" on sessions for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy "session_data read" on session_data for select using (exists (select 1 from sessions s where s.id = session_data.id and (s.published or s.owner = auth.uid())));
create policy "session_data own" on session_data for all using (exists (select 1 from sessions s where s.id = session_data.id and s.owner = auth.uid())) with check (exists (select 1 from sessions s where s.id = session_data.id and s.owner = auth.uid()));
-- profiles: public, each person edits their own
create policy "profiles read" on profiles for select using (true);
create policy "profiles own" on profiles for all using (id = auth.uid()) with check (id = auth.uid());
-- claim requests: any signed-in person can send one, admins read and delete
create policy "claims insert" on claims for insert with check (auth.uid() is not null and by = auth.uid());
create policy "claims admin read" on claims for select using (is_admin());
create policy "claims admin delete" on claims for delete using (is_admin());
-- the admin list itself is private
create policy "admins read own" on admin_emails for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- >>> put your own email here, then you are the site admin as soon as you sign in <<<
-- insert into admin_emails (email) values ('you@example.com');
