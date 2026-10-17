-- Hutka v34.4 — quotas and snapshots: nobody drains the telemetry or floods the tables, and every night the data is copied inside the database.
-- Applied as supabase/migrations/20261017090000_limits.sql (safe to run again).

-- ----- one counter per key per day (an upsert, no counting queries) -----
create table if not exists quota (day date not null, key text not null, n int not null default 0, primary key (day, key));
create or replace function hutka_bump(k text, lim int, by int default 1) returns boolean   -- true while within the limit
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into quota (day, key, n) values (current_date, k, by) on conflict (day, key) do update set n = quota.n + excluded.n returning n into c;
  return c <= lim;
end $$;
revoke all on function hutka_bump(text, int, int) from public, anon, authenticated;

-- who is asking: the account, else the address behind the gateway, else the visitor id the page keeps in localStorage
create or replace function hutka_who(vid text default '') returns text
language plpgsql stable set search_path = public as $$
declare h json; ip text;
begin
  if auth.uid() is not null then return 'u:' || auth.uid()::text; end if;
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  if h is not null then ip := coalesce(h->>'cf-connecting-ip', split_part(h->>'x-forwarded-for', ',', 1), h->>'x-real-ip'); end if;
  if ip is not null and ip <> '' then return 'ip:' || md5(ip); end if;
  if vid ~ '^[A-Za-z0-9_-]{8,64}$' then return 'v:' || vid; end if;
  return 'anon';
end $$;

-- ----- the telemetry: a published session's data only through this function, counted per account (600 a day) or per address (150 a day);
-- one's own sessions and admins are not counted. The table itself is readable only by the owner from now on. -----
create or replace function hutka_session_data(sid text, vid text default '') returns text
language plpgsql security definer set search_path = public as $$
declare s record; d text; who text; lim int;
begin
  select id, owner, published into s from sessions where id = sid;
  if s.id is null then return null; end if;
  if s.owner = auth.uid() or is_admin() then select data into d from session_data where id = sid; return d; end if;
  if not s.published then raise exception 'not allowed' using errcode = '42501'; end if;
  who := hutka_who(vid); lim := case when auth.uid() is null then 150 else 600 end;
  if not hutka_bump('sd:' || who, lim) then raise exception 'quota' using errcode = 'P0001', detail = 'session_data'; end if;
  select data into d from session_data where id = sid; return d;
end $$;
revoke all on function hutka_session_data(text, text) from public;
grant execute on function hutka_session_data(text, text) to anon, authenticated;
alter policy "session_data read" on session_data using (exists (select 1 from sessions s where s.id = session_data.id and s.owner = auth.uid()));

-- ----- writes: a ceiling per account per day on every table a driver can add rows to (admins exempt) -----
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
    else return new;
  end case;
  if not hutka_bump(k || ':' || u, lim) then raise exception 'quota' using errcode = 'P0001', detail = tg_table_name; end if;
  -- comments and likes also per minute: a burst is a script, not a driver
  if tg_table_name in ('comments', 'likes') and not hutka_bump(k || 'm:' || u || ':' || to_char(now(), 'HH24MI'), 15) then raise exception 'quota' using errcode = 'P0001', detail = tg_table_name || ' per minute'; end if;
  return new;
end $$;
create or replace trigger sessions_quota before insert on sessions for each row execute function hutka_quota_guard();
create or replace trigger comments_quota before insert on comments for each row execute function hutka_quota_guard();
create or replace trigger likes_quota before insert on likes for each row execute function hutka_quota_guard();
create or replace trigger follows_quota before insert on follows for each row execute function hutka_quota_guard();
create or replace trigger flags_quota before insert on flags for each row execute function hutka_quota_guard();
create or replace trigger blocks_quota before insert on blocks for each row execute function hutka_quota_guard();
create or replace trigger tracks_quota before insert on tracks for each row execute function hutka_quota_guard();
create or replace trigger layouts_quota before insert on layouts for each row execute function hutka_quota_guard();
create or replace trigger claims_quota before insert on claims for each row execute function hutka_quota_guard();
create or replace trigger chats_quota before insert on chats for each row execute function hutka_quota_guard();

-- ----- the anonymous counters: a visitor id gets 3000 events and 300 visits a day, beyond that the calls are dropped silently -----
create or replace function hutka_event(vid text, visit text, name text, props jsonb default '{}'::jsonb, dev text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if vid is null or vid !~ '^[A-Za-z0-9_-]{8,64}$' or visit is null or visit !~ '^[A-Za-z0-9_-]{8,64}$' then return; end if;
  if name is null or name !~ '^[a-z_]{2,24}$' then return; end if;
  if props is null or jsonb_typeof(props) <> 'object' or pg_column_size(props) > 1500 then props := '{}'::jsonb; end if;
  if not hutka_bump('ev:' || vid, 3000) then return; end if;
  if (select count(*) from events where at > now() - interval '1 day') > 500000 then return; end if;   -- a flood guard
  insert into events (visitor, visit, user_id, name, props, device) values (vid, visit, auth.uid(), name, props, left(coalesce(dev, ''), 40));
end $$;
create or replace function hutka_visit(vid text, dev text default '') returns void
language plpgsql security definer set search_path = public as $$
declare fd date;
begin
  if vid is null or length(vid) < 8 or length(vid) > 64 or vid !~ '^[A-Za-z0-9_-]+$' then return; end if;
  if not hutka_bump('vis:' || vid, 300) then return; end if;
  if (select count(*) from visits where day = current_date) > 50000 then return; end if;   -- a flood guard
  select min(day) into fd from visits where visitor = vid or (auth.uid() is not null and user_id = auth.uid());
  insert into visits (day, visitor, user_id, device, first_day)
  values (current_date, vid, auth.uid(), left(coalesce(dev, ''), 40), coalesce(fd, current_date))
  on conflict (day, visitor) do update
    set user_id = coalesce(excluded.user_id, visits.user_id), n = visits.n + 1,
        device = case when visits.device = '' then excluded.device else visits.device end,
        first_day = least(visits.first_day, excluded.first_day);
end $$;

-- the admin panel: who is near a limit today (the quota table is readable by admins)
alter table quota enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'quota' and policyname = 'quota admin read') then
    create policy "quota admin read" on quota for select using (is_admin());
  end if;
end $$;

-- ----- snapshots: every night a copy of every table inside the database (schema `backup`), the telemetry kept 3 days, the rest 7 -----
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create or replace function hutka_snapshot() returns text
language plpgsql security definer set search_path = public as $$
declare t text; stamp text := to_char(now(), 'YYYYMMDD'); r record; n int := 0; keep int;
begin
  foreach t in array array['tracks', 'layouts', 'media', 'sessions', 'session_data', 'profiles', 'likes', 'comments', 'follows', 'chats', 'messages', 'wallets', 'ledger', 'claims', 'flags', 'blocks', 'push_tokens', 'notify_queue', 'reports', 'admin_emails'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop table if exists backup.%I', 'd' || stamp || '_' || t);
    execute format('create table backup.%I as select * from public.%I', 'd' || stamp || '_' || t, t);
    n := n + 1;
  end loop;
  -- retention: the telemetry copies are the big ones
  for r in select tablename from pg_tables where schemaname = 'backup' loop
    keep := case when r.tablename like '%\_session\_data' then 3 else 7 end;
    if substring(r.tablename from 2 for 8) < to_char(now() - (keep || ' days')::interval, 'YYYYMMDD') then execute format('drop table backup.%I', r.tablename); end if;
  end loop;
  return stamp || ': ' || n || ' tables';
end $$;
revoke all on function hutka_snapshot() from public, anon, authenticated;
-- the quota counters: two days are enough
create or replace function hutka_quota_sweep() returns void
language sql security definer set search_path = public as $$ delete from quota where day < current_date - 2; $$;
revoke all on function hutka_quota_sweep() from public, anon, authenticated;
-- pg_cron: 02:20 UTC every night (06:20 Dubai), the counters swept at 03:00
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('hutka-snapshot', 'hutka-quota-sweep');
  perform cron.schedule('hutka-snapshot', '20 2 * * *', 'select public.hutka_snapshot()');
  perform cron.schedule('hutka-quota-sweep', '0 3 * * *', 'select public.hutka_quota_sweep()');
end $$;
-- the admin panel reads the list of snapshots
create or replace function hutka_snapshots() returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('day', substring(tablename from 2 for 8), 'table', substring(tablename from 11), 'bytes', pg_total_relation_size(('backup.' || quote_ident(tablename))::regclass)) order by tablename desc), '[]'::jsonb) into o from pg_tables where schemaname = 'backup';
  return o;
end $$;
revoke all on function hutka_snapshots() from public, anon;
grant execute on function hutka_snapshots() to authenticated;
