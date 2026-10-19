-- v34.31 — the racing brain and Hutka AI (an admin-only preview first)
-- brain_atlas: what the fastest real passes teach, one compact row per layout and kart class (per corner: its shape, landmarks and what
--   the fastest drivers do there; the corner windows; the session its line comes from). Anyone reads it (the ideal lap of a layout, and the
--   corners a layout nobody has driven is read against); an admin's browser rebuilds a row when the layout's published sessions change.
-- ai_knowledge: what the AI knows besides the data — the coach's course. No policies: only the ask function (service role) reads it;
--   it never reaches a page.
-- ai_vision: one row per photo the AI looked at (which track is this?), for the daily limit of the ask function's photo lane.

create table if not exists brain_atlas (
  key text primary key,                -- track|layout|class
  track_id text not null,
  layout_id text not null,
  cls text not null default 'rental',
  ver int not null default 2,
  sig text not null default '',        -- the published sessions it was built from
  laps int not null default 0,
  drivers int not null default 0,
  best real,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists brain_atlas_cls on brain_atlas (cls);
alter table brain_atlas enable row level security;
create policy "brain_atlas: anyone reads" on brain_atlas for select using (true);
create policy "brain_atlas: admins add" on brain_atlas for insert with check (is_admin());
create policy "brain_atlas: admins update" on brain_atlas for update using (is_admin()) with check (is_admin());

create table if not exists ai_knowledge (
  id text primary key,
  body text not null,
  updated_at timestamptz not null default now()
);
alter table ai_knowledge enable row level security;

create table if not exists ai_vision (
  id bigserial primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_vision_user_at on ai_vision (user_id, created_at desc);
alter table ai_vision enable row level security;
