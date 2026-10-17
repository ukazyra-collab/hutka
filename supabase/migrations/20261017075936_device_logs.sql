-- Hutka v34.6 — device explorer logs: what a lap timer exposed and said over Bluetooth, sent from the device window (the material the drivers are written from).
create table if not exists device_logs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  owner uuid references auth.users(id) on delete set null,
  device text not null default '',
  data jsonb not null default '{}'::jsonb,
  constraint device_logs_size check (pg_column_size(data) < 3000000)
);
create index if not exists device_logs_at_idx on device_logs (created_at desc);
alter table device_logs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'device_logs' and policyname = 'device_logs insert') then
    create policy "device_logs insert" on device_logs for insert with check (owner = auth.uid());
    create policy "device_logs read" on device_logs for select using (owner = auth.uid() or is_admin());
    create policy "device_logs admin delete" on device_logs for delete using (is_admin());
  end if;
end $$;
-- the daily ceiling, like every other table a driver writes to (hutka_quota_guard, limits.sql): 40 logs a day
create or replace function hutka_quota_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare u text := coalesce(auth.uid()::text, 'anon'); k text; lim int;
begin
  if auth.role() = 'service_role' or is_admin() then return new; end if;   -- the edge functions (service role) and admins are not counted
  case tg_table_name
    when 'sessions' then k := 'ses'; lim := 60;
    when 'comments' then k := 'cmt'; lim := 200;
    when 'likes' then k := 'like'; lim := 500;
    when 'follows' then k := 'fol'; lim := 200;
    when 'flags' then k := 'flag'; lim := 50;
    when 'blocks' then k := 'blk'; lim := 100;
    when 'tracks' then k := 'trk'; lim := 20;
    when 'layouts' then k := 'lay'; lim := 40;
    when 'claims' then k := 'clm'; lim := 10;
    when 'chats' then k := 'chat'; lim := 100;
    when 'device_logs' then k := 'dlog'; lim := 40;
    else return new;
  end case;
  if not hutka_bump(k || ':' || u, lim) then raise exception 'quota' using errcode = 'P0001', detail = tg_table_name; end if;
  -- comments and likes also per minute: a burst is a script, not a driver
  if tg_table_name in ('comments', 'likes') and not hutka_bump(k || 'm:' || u || ':' || to_char(now(), 'HH24MI'), 15) then raise exception 'quota' using errcode = 'P0001', detail = tg_table_name || ' per minute'; end if;
  return new;
end $$;
create or replace trigger device_logs_quota before insert on device_logs for each row execute function hutka_quota_guard();
