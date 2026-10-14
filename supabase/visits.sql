-- Hutka v30.1 — visits: who opens the site each day (signed in or not), so the admin panel shows daily visitors, returning
-- visitors and retention. Run once in the SQL editor (safe to run again). Days are UTC.
create table if not exists visits (
  day date not null,
  visitor text not null,                            -- a random id the browser keeps (localStorage), one per browser
  user_id uuid references auth.users(id) on delete set null,
  device text not null default '',                  -- phone / tablet / desktop, "app" when inside the native app
  first_day date not null default current_date,     -- the visitor's (or the signed-in user's) first day — cohorts
  n int not null default 1,                         -- opens that day
  primary key (day, visitor)
);
create index if not exists visits_user_idx on visits (user_id, day);
create index if not exists visits_first_idx on visits (first_day);
alter table visits enable row level security;       -- no policies on purpose: nothing reads or writes the table directly

-- the page calls this once per open (anonymous or signed in)
create or replace function hutka_visit(vid text, dev text default '') returns void
language plpgsql security definer set search_path = public as $$
declare fd date;
begin
  if vid is null or length(vid) < 8 or length(vid) > 64 or vid !~ '^[A-Za-z0-9_-]+$' then return; end if;
  if (select count(*) from visits where day = current_date) > 50000 then return; end if;   -- a flood guard
  select min(day) into fd from visits where visitor = vid or (auth.uid() is not null and user_id = auth.uid());
  insert into visits (day, visitor, user_id, device, first_day)
  values (current_date, vid, auth.uid(), left(coalesce(dev, ''), 40), coalesce(fd, current_date))
  on conflict (day, visitor) do update
    set user_id = coalesce(excluded.user_id, visits.user_id), n = visits.n + 1,
        device = case when visits.device = '' then excluded.device else visits.device end,
        first_day = least(visits.first_day, excluded.first_day);
end $$;
revoke all on function hutka_visit(text, text) from public;
grant execute on function hutka_visit(text, text) to anon, authenticated;

-- the admin panel: today / yesterday, 7 and 30 days, visitors by day, cohorts (first day → came back next day / within 7 days), devices
create or replace function hutka_visits() returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'today',     (select jsonb_build_object('visitors', count(*), 'users', count(user_id), 'new', count(*) filter (where first_day = day), 'opens', coalesce(sum(n), 0)) from visits where day = current_date),
    'yesterday', (select jsonb_build_object('visitors', count(*), 'users', count(user_id), 'new', count(*) filter (where first_day = day), 'opens', coalesce(sum(n), 0)) from visits where day = current_date - 1),
    'wau',       (select count(distinct visitor) from visits where day > current_date - 7),
    'mau',       (select count(distinct visitor) from visits where day > current_date - 30),
    'users_7d',  (select count(distinct user_id) from visits where day > current_date - 7 and user_id is not null),
    'days',      coalesce((select jsonb_agg(jsonb_build_object('d', d, 'n', n, 'u', u, 'new', nw) order by d) from (select day d, count(*) n, count(user_id) u, count(*) filter (where first_day = day) nw from visits where day > current_date - 30 group by 1) x), '[]'::jsonb),
    'cohorts',   coalesce((select jsonb_agg(jsonb_build_object('d', first_day, 'size', size, 'd1', d1, 'd7', d7) order by first_day) from (
                   select c.first_day, count(*) size,
                     count(*) filter (where exists (select 1 from visits v where v.visitor = c.visitor and v.day = c.first_day + 1)) d1,
                     count(*) filter (where exists (select 1 from visits v where v.visitor = c.visitor and v.day between c.first_day + 1 and c.first_day + 7)) d7
                   from (select distinct first_day, visitor from visits where first_day > current_date - 30) c group by 1) y), '[]'::jsonb),
    'devices',   coalesce((select jsonb_agg(jsonb_build_object('device', device, 'n', n) order by n desc) from (select device, count(distinct visitor) n from visits where day > current_date - 30 group by 1) z), '[]'::jsonb),
    'at',        now()
  ) into o;
  return o;
end $$;
revoke all on function hutka_visits() from public, anon;
grant execute on function hutka_visits() to authenticated;
