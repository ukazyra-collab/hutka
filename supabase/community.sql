-- Hutka v23 — community tracks, kart classes, helpful / not helpful votes.
-- Run once in the SQL editor of the existing project (after update.sql and ai.sql). Safe to run again.

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
