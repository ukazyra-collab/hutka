-- Hutka v29.4 — bug reports (the button in the corner). Run once in the SQL editor; safe to run again.
create table if not exists reports (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null default '',
  name text not null default '',
  text text not null,
  page text not null default '',
  ua text not null default '',
  screen text not null default '',
  version text not null default '',
  session_id text,
  errors jsonb not null default '[]'::jsonb,
  shot text,
  ip_hash text not null default '',
  status text not null default 'new',
  constraint reports_sizes check (char_length(text) <= 4000 and (shot is null or length(shot) <= 900000) and status in ('new', 'done'))
);
create index if not exists reports_created_idx on reports (created_at desc);
create index if not exists reports_ip_idx on reports (ip_hash, created_at);
alter table reports enable row level security;
-- written only by the `report` function (service role); admins read, close and delete
drop policy if exists "reports admin read" on reports;   create policy "reports admin read"   on reports for select using (is_admin());
drop policy if exists "reports admin update" on reports; create policy "reports admin update" on reports for update using (is_admin()) with check (is_admin());
drop policy if exists "reports admin delete" on reports; create policy "reports admin delete" on reports for delete using (is_admin());
revoke insert on reports from anon, authenticated;
