-- Hutka v32.5 — the counter on the home page: site-wide totals instead of a slice of the feed.
-- Before this the hero tiles were computed from the 30 most recent published sessions, so one driver uploading 30 files
-- turned the counter into "30 sessions · 1 driver". Now one public function returns the real totals (aggregates only,
-- nothing per session). Applied as supabase/migrations/20261015180000_counts.sql; safe to run again.
create or replace function hutka_counts() returns jsonb
language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'tracks',    (select count(*) from tracks),
    'layouts',   (select count(*) from layouts),
    'sessions',  (select count(*) from sessions where coalesce(meta->>'moderated', '') <> 'true'),
    'published', (select count(*) from sessions where published),
    'drivers',   (select count(distinct owner) from sessions where coalesce(meta->>'moderated', '') <> 'true'),
    'laps',      (select coalesce(sum(case when meta->>'nLaps' ~ '^\d+$' then (meta->>'nLaps')::int else 0 end), 0) from sessions where coalesce(meta->>'moderated', '') <> 'true'),
    'at',        now());
$$;
revoke all on function hutka_counts() from public;
grant execute on function hutka_counts() to anon, authenticated;
