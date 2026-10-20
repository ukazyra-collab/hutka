-- Hutka v34.46 — the track import's queue goes round: an area whose map servers just failed (QLever down and VK's Overpass timing out
-- for it) goes to the back of the queue and the next area runs, instead of the whole queue waiting on it; the queue waits (5 minutes)
-- only when every area left failed in the last 5 minutes. Order otherwise as before: errors last, then priority, then the area tried
-- longest ago (never tried first), then the area's code.
create or replace function public.hutka_import_step() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare a text; d boolean; m text; tok text; w boolean;
begin
  update import_queue set status = 'error', result = coalesce(result, '{}'::jsonb) || jsonb_build_object('error', 'no answer in 6 minutes'), finished_at = now()
    where status = 'running' and started_at < now() - interval '6 minutes';
  if exists (select 1 from import_queue where status = 'running') then return 'busy'; end if;
  select q.area, q.dry, q.mode, q.recent into a, d, m, w from (
    select area, dry, mode, status, prio, finished_at,
      coalesce((result->>'down')::boolean, false) and finished_at > now() - interval '5 minutes' as recent
    from import_queue where (status = 'pending' and tries < 8) or (status = 'error' and tries < 3)) q
    order by (q.status = 'error'), q.recent, q.prio desc, q.finished_at nulls first, q.area limit 1;
  if a is null then   -- the queue is done: the cron job stops itself (switched on again when areas are queued: README)
    perform cron.alter_job(job_id := j.jobid, active := false) from cron.job j where j.jobname = 'hutka-tracks-import' and j.active;
    return 'idle';
  end if;
  if w then return 'waiting'; end if;   -- every area left failed a moment ago: the map servers get 5 minutes
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'tracks_import_token';
  update import_queue set status = 'running', tries = tries + case when status = 'pending' and coalesce((result->>'down')::boolean, false) then 0 else 1 end, started_at = now() where area = a;
  perform net.http_post(
    url := 'https://tqixfqrludqpxqxypiia.supabase.co/functions/v1/tracks-import',
    body := jsonb_build_object('area', a, 'dry', d, 'mode', m),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-import-token', tok),
    timeout_milliseconds := 400000);
  return a;
end $$;
revoke all on function public.hutka_import_step() from public, anon, authenticated;
