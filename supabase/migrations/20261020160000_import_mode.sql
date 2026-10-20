-- Hutka v34.44 — the track import queue learns a mode: 'import' (new venues only, as before) or 'update' (new venues, and the import's
-- own tracks get what the rules give now: a line where they had none, the corners of the line they have, their other names).
-- And it waits out the map database being down: an area that met it down (result.down) stays pending, costs no try, and the queue asks
-- again in 5 minutes — one question then, not the whole queue failing in a minute.
alter table public.import_queue add column if not exists mode text not null default 'import';
alter table public.import_queue add column if not exists prio int not null default 0;   -- higher first (new countries before a re-run of the old ones)

create or replace function public.hutka_import_step() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare a text; d boolean; m text; tok text;
begin
  update import_queue set status = 'error', result = coalesce(result, '{}'::jsonb) || jsonb_build_object('error', 'no answer in 6 minutes'), finished_at = now()
    where status = 'running' and started_at < now() - interval '6 minutes';
  if exists (select 1 from import_queue where status = 'running') then return 'busy'; end if;
  if exists (select 1 from import_queue where status = 'pending' and coalesce((result->>'down')::boolean, false) and finished_at > now() - interval '5 minutes') then return 'waiting'; end if;
  select area, dry, mode into a, d, m from import_queue where (status = 'pending' and tries < 8) or (status = 'error' and tries < 3) order by (status = 'error'), prio desc, area limit 1;
  if a is null then return 'idle'; end if;
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
