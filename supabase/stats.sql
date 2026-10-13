-- Hutka v29 — site statistics for the admin panel. Run once in the SQL editor (safe to run again).
-- One function, admins only: drivers, sessions, laps, likes, comments, AI questions, sign-ups and uploads by day, top tracks.
create or replace function hutka_count(q text) returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  execute q into n; return coalesce(n, 0);
exception when others then return 0;   -- a table from a later SQL file that is not there yet counts as zero
end $$;
revoke all on function hutka_count(text) from public, anon, authenticated;
create or replace function hutka_json(q text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j jsonb;
begin
  execute q into j; return coalesce(j, '[]'::jsonb);
exception when others then return '[]'::jsonb;
end $$;
revoke all on function hutka_json(text) from public, anon, authenticated;

create or replace function hutka_stats() returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'drivers',        hutka_count('select count(*) from auth.users'),
    'drivers_7d',     hutka_count('select count(*) from auth.users where created_at > now() - interval ''7 days'''),
    'drivers_30d',    hutka_count('select count(*) from auth.users where created_at > now() - interval ''30 days'''),
    'active_7d',      hutka_count('select count(*) from auth.users where last_sign_in_at > now() - interval ''7 days'''),
    'active_30d',     hutka_count('select count(*) from auth.users where last_sign_in_at > now() - interval ''30 days'''),
    'profiles_done',  hutka_count('select count(*) from profiles where first_name <> '''' and country <> '''''),
    'sessions',       hutka_count('select count(*) from sessions'),
    'sessions_7d',    hutka_count('select count(*) from sessions where created_at > now() - interval ''7 days'''),
    'published',      hutka_count('select count(*) from sessions where published'),
    'laps',           hutka_count('select coalesce(sum(nullif(meta->>''nLaps'', '''')::int), 0) from sessions'),
    'tracks',         hutka_count('select count(*) from tracks'),
    'layouts',        hutka_count('select count(*) from layouts'),
    'likes',          hutka_count('select count(*) from likes'),
    'comments',       hutka_count('select count(*) from comments'),
    'follows',        hutka_count('select count(*) from follows'),
    'ai_questions',   hutka_count('select count(*) from messages where role = ''user'''),
    'ai_7d',          hutka_count('select count(*) from messages where role = ''user'' and created_at > now() - interval ''7 days'''),
    'signups_by_day', hutka_json('select jsonb_agg(jsonb_build_object(''d'', d, ''n'', n) order by d) from (select created_at::date d, count(*) n from auth.users where created_at > now() - interval ''30 days'' group by 1) x'),
    'uploads_by_day', hutka_json('select jsonb_agg(jsonb_build_object(''d'', d, ''n'', n) order by d) from (select created_at::date d, count(*) n from sessions where created_at > now() - interval ''30 days'' group by 1) x'),
    'top_tracks',     hutka_json('select jsonb_agg(jsonb_build_object(''track'', track_id, ''n'', n) order by n desc) from (select track_id, count(*) n from sessions where track_id <> '''' group by 1 order by 2 desc limit 8) x'),
    'at',             now()
  ) into o;
  return o;
end $$;
grant execute on function hutka_stats() to authenticated;
