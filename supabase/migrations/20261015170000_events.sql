-- Hutka v32.4 — product analytics: what people do on the site and for how long. The page sends small events (a page view, a Lab
-- open, a comparison, a replay, an AI question, an upload, a like, a comment, a heartbeat once a minute while the tab is in use);
-- the admin panel reads aggregates: visit length (median / average / p90), visits by day and by hour, which features a visit used,
-- engagement per driver, the most opened sessions. Applied as supabase/migrations/20261015170000_events.sql; safe to run again.
create table if not exists events (
  id bigserial primary key,
  at timestamptz not null default now(),
  visitor text not null,                 -- the browser (localStorage id, same as visits.visitor)
  visit text not null,                   -- one sitting: a tab, renewed after 30 minutes of silence
  user_id uuid,                          -- the signed-in driver, when there is one
  name text not null,                    -- page | lab | compare | third | replay | ask | upload | like | comment | publish | share | hb | signin
  props jsonb not null default '{}',     -- route / session id / mode — small
  device text not null default ''
);
create index if not exists events_at_idx on events (at);
create index if not exists events_visit_idx on events (visit, at);
create index if not exists events_user_idx on events (user_id, at);
create index if not exists events_name_idx on events (name, at);
alter table events enable row level security;   -- no policies: only the functions below touch it

create or replace function hutka_event(vid text, visit text, name text, props jsonb default '{}'::jsonb, dev text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if vid is null or vid !~ '^[A-Za-z0-9_-]{8,64}$' or visit is null or visit !~ '^[A-Za-z0-9_-]{8,64}$' then return; end if;
  if name is null or name !~ '^[a-z_]{2,24}$' then return; end if;
  if props is null or jsonb_typeof(props) <> 'object' or pg_column_size(props) > 1500 then props := '{}'::jsonb; end if;
  if (select count(*) from events where at > now() - interval '1 day') > 500000 then return; end if;   -- a flood guard
  insert into events (visitor, visit, user_id, name, props, device) values (vid, visit, auth.uid(), name, props, left(coalesce(dev, ''), 40));
end $$;
revoke all on function hutka_event(text, text, text, jsonb, text) from public;
grant execute on function hutka_event(text, text, text, jsonb, text) to anon, authenticated;

-- the admin panel: everything for the last `days` days (default 30)
create or replace function hutka_analytics(days int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb; d0 timestamptz := date_trunc('day', now()) - make_interval(days => greatest(1, least(coalesce(days, 30), 180)) - 1);
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  create temp table if not exists _v on commit drop as
    select visit, min(at) t0, max(at) t1, extract(epoch from max(at) - min(at)) dur, min(visitor) visitor, max(user_id::text)::uuid user_id, max(device) device,
           count(*) n, count(*) filter (where name = 'page') pages, bool_or(name = 'lab') lab, bool_or(name in ('compare', 'third')) cmp, bool_or(name = 'ask') ask,
           bool_or(name = 'upload') upl, bool_or(name in ('like', 'comment')) social, bool_or(name = 'replay') replay
    from events where at >= d0 group by visit;
  select jsonb_build_object(
    'days', days,
    'visits', (select count(*) from _v),
    'visitors', (select count(distinct visitor) from _v),
    'signed_in', (select count(distinct user_id) from _v where user_id is not null),
    'median_s', (select coalesce(percentile_cont(0.5) within group (order by dur), 0) from _v),
    'avg_s', (select coalesce(avg(dur), 0) from _v),
    'p90_s', (select coalesce(percentile_cont(0.9) within group (order by dur), 0) from _v),
    'bounce', (select count(*) from _v where dur < 10),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'n', n, 'u', u, 'avg_s', a, 'med_s', m) order by d) from (
                 select date(t0) d, count(*) n, count(distinct user_id) u, avg(dur) a, percentile_cont(0.5) within group (order by dur) m from _v group by 1) x), '[]'::jsonb),
    'by_hour', coalesce((select jsonb_agg(jsonb_build_object('h', h, 'n', n) order by h) from (select extract(hour from t0)::int h, count(*) n from _v group by 1) x), '[]'::jsonb),
    'features', jsonb_build_object(
       'lab', (select count(*) from _v where lab), 'compare', (select count(*) from _v where cmp), 'ask', (select count(*) from _v where ask),
       'upload', (select count(*) from _v where upl), 'social', (select count(*) from _v where social), 'replay', (select count(*) from _v where replay)),
    'events', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'n', n) order by n desc) from (select name, count(*) n from events where at >= d0 and name <> 'hb' group by 1) x), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', user_id, 'name', coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), p.racing_name, ''), 'visits', visits, 'min', mins, 'labs', labs, 'cmp', cmps, 'asks', asks, 'uploads', ups, 'social', soc, 'last', last) order by mins desc)
                from (select v.user_id, count(*) visits, round(sum(v.dur) / 60) mins, count(*) filter (where v.lab) labs, count(*) filter (where v.cmp) cmps, count(*) filter (where v.ask) asks, count(*) filter (where v.upl) ups, count(*) filter (where v.social) soc, max(v.t1) last
                      from _v v where v.user_id is not null group by 1 order by mins desc limit 40) u left join profiles p on p.id = u.user_id), '[]'::jsonb),
    'top_sessions', coalesce((select jsonb_agg(jsonb_build_object('sid', sid, 'n', n, 'visitors', vis, 'label', coalesce(nullif(s.meta->>'label', ''), s.meta->>'name'), 'owner', s.owner) order by n desc)
                from (select props->>'sid' sid, count(*) n, count(distinct visitor) vis from events where at >= d0 and name = 'lab' and props ? 'sid' group by 1 order by n desc limit 15) x left join sessions s on s.id = x.sid), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('device', device, 'n', n) order by n desc) from (select device, count(*) n from _v group by 1) x), '[]'::jsonb),
    'at', now()
  ) into o;
  return o;
end $$;
revoke all on function hutka_analytics(int) from public, anon;
grant execute on function hutka_analytics(int) to authenticated;
