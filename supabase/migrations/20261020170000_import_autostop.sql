-- Hutka v34.44 — the track import's cron job switches itself off when the queue has nothing left to do (no idle ticks every 10 seconds
-- for days); queuing areas again means switching it on: select cron.alter_job((select jobid from cron.job where jobname =
-- 'hutka-tracks-import'), active := true);
create or replace function public.hutka_import_step() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare a text; d boolean; m text; tok text;
begin
  update import_queue set status = 'error', result = coalesce(result, '{}'::jsonb) || jsonb_build_object('error', 'no answer in 6 minutes'), finished_at = now()
    where status = 'running' and started_at < now() - interval '6 minutes';
  if exists (select 1 from import_queue where status = 'running') then return 'busy'; end if;
  if exists (select 1 from import_queue where status = 'pending' and coalesce((result->>'down')::boolean, false) and finished_at > now() - interval '5 minutes') then return 'waiting'; end if;
  select area, dry, mode into a, d, m from import_queue where (status = 'pending' and tries < 8) or (status = 'error' and tries < 3) order by (status = 'error'), prio desc, area limit 1;
  if a is null then   -- the queue is done: the cron job stops itself (switched on again when areas are queued: README)
    perform cron.alter_job(job_id := j.jobid, active := false) from cron.job j where j.jobname = 'hutka-tracks-import' and j.active;
    return 'idle';
  end if;
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
