-- Hutka v34.42 — tracks from OpenStreetMap, one area at a time (a country "FR", a US state "US-CA").
-- The edge function tracks-import does the work; this is its queue: a cron job calls hutka_import_step() every minute, which sends
-- the next pending area to the function through pg_net with a token made here and kept in the Vault (it never leaves the database;
-- the function checks it with hutka_import_token_ok). The function writes the area's result back into the queue.

create extension if not exists pg_net with schema extensions;

create table if not exists public.import_queue (
  area text primary key,                      -- 'FR', 'US-CA'
  dry boolean not null default false,         -- count and sample only, nothing written
  status text not null default 'pending',     -- pending · running · done · error
  tries int not null default 0,
  result jsonb,
  started_at timestamptz,
  finished_at timestamptz
);
alter table public.import_queue enable row level security;
drop policy if exists "import queue admins read" on public.import_queue;
create policy "import queue admins read" on public.import_queue for select using (public.is_admin());

-- the token: random, made once, kept in the Vault
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'tracks_import_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'tracks_import_token', 'tracks-import: the queue''s token');
  end if;
end $$;

create or replace function public.hutka_import_token_ok(t text) returns boolean
language sql stable security definer set search_path = public, vault as $$
  select coalesce(length(t) >= 32 and exists (select 1 from vault.decrypted_secrets where name = 'tracks_import_token' and decrypted_secret = t), false);
$$;
revoke all on function public.hutka_import_token_ok(text) from public, anon, authenticated;
grant execute on function public.hutka_import_token_ok(text) to service_role;

-- one step: a run older than 6 minutes counts as failed (tried again up to three times); while one runs, nothing; else the next area
create or replace function public.hutka_import_step() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare a text; d boolean; tok text;
begin
  update import_queue set status = 'error', result = coalesce(result, '{}'::jsonb) || jsonb_build_object('error', 'no answer in 6 minutes'), finished_at = now()
    where status = 'running' and started_at < now() - interval '6 minutes';
  if exists (select 1 from import_queue where status = 'running') then return 'busy'; end if;
  select area, dry into a, d from import_queue where status = 'pending' or (status = 'error' and tries < 3) order by (status = 'error'), area limit 1;
  if a is null then return 'idle'; end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'tracks_import_token';
  update import_queue set status = 'running', tries = tries + 1, started_at = now() where area = a;
  perform net.http_post(
    url := 'https://tqixfqrludqpxqxypiia.supabase.co/functions/v1/tracks-import',
    body := jsonb_build_object('area', a, 'dry', d),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-import-token', tok),
    timeout_milliseconds := 400000);
  return a;
end $$;
revoke all on function public.hutka_import_step() from public, anon, authenticated;
