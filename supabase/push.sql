-- Hutka v33 — pushes to the iPhone / Android app and the Activity list ("Greg liked your session", "Pavel commented: …").
-- The app registers its device token here (hutka_push_token); the edge function `notify` (functions/notify) sends the pending
-- notify_queue rows as pushes right away (APNs for iOS, FCM for Android) and the e-mails as before; the site shows the same rows as
-- the Activity list with an unread count (hutka_activity / hutka_activity_seen). profiles.push = false turns the pushes off.
-- Applied as supabase/migrations/20261015200000_push.sql; safe to run again.
create table if not exists push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default '',      -- ios | android
  device text not null default '',
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  failed int not null default 0
);
create index if not exists push_tokens_user_idx on push_tokens (user_id);
alter table push_tokens enable row level security;   -- no policies on purpose: the functions below and the service role only

alter table profiles add column if not exists push boolean not null default true;
alter table notify_queue add column if not exists pushed_at timestamptz;
alter table notify_queue add column if not exists seen_at timestamptz;
create index if not exists notify_queue_push_idx on notify_queue (created_at) where pushed_at is null;
create index if not exists notify_queue_unread_idx on notify_queue (owner) where seen_at is null;

-- the app, after the system permission: its token for this device (upsert — a token moves to whoever is signed in on the phone)
create or replace function hutka_push_token(token text, platform text default '', dev text default '') returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in' using errcode = '42501'; end if;
  if token is null or length(token) < 20 or length(token) > 4096 or token !~ '^[A-Za-z0-9:_\-]+$' then return false; end if;
  insert into push_tokens (token, user_id, platform, device) values (token, auth.uid(), left(coalesce(platform, ''), 16), left(coalesce(dev, ''), 80))
    on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, device = excluded.device, seen_at = now(), failed = 0;
  return true;
end $$;
revoke all on function hutka_push_token(text, text, text) from public, anon;
grant execute on function hutka_push_token(text, text, text) to authenticated;

-- signing out on the phone: no more pushes to that device
create or replace function hutka_push_forget(token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return false; end if;
  delete from push_tokens where push_tokens.token = hutka_push_forget.token and user_id = auth.uid();
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function hutka_push_forget(text) from public, anon;
grant execute on function hutka_push_forget(text) to authenticated;

-- the Activity list: what happened to my sessions, newest first, with who / which session / the comment text; unread = not opened yet
create or replace function hutka_activity(n int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb; u uuid := auth.uid();
begin
  if u is null then raise exception 'sign in' using errcode = '42501'; end if;
  select jsonb_build_object(
    'unread', (select count(*) from notify_queue where owner = u and seen_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', q.id, 'kind', q.kind, 'at', q.created_at, 'seen', q.seen_at is not null, 'actor', q.actor,
                 'name', coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.racing_name, ''), 'avatar', coalesce(p.avatar, ''),
                 'sid', q.session_id, 'label', coalesce(nullif(s.meta->>'label', ''), s.meta->>'name', ''), 'track', s.track_id, 'trackName', coalesce(s.meta->>'trackName', ''),
                 'bestMs', case when s.meta->>'bestMs' ~ '^\d+(\.\d+)?$' then (s.meta->>'bestMs')::numeric end,
                 'text', left(c.text, 200)) order by q.created_at desc)
       from (select * from notify_queue where owner = u order by created_at desc limit greatest(1, least(coalesce(n, 50), 200))) q
       left join profiles p on p.id = q.actor left join sessions s on s.id = q.session_id left join comments c on c.id = q.comment_id), '[]'::jsonb),
    'at', now()) into o;
  return o;
end $$;
revoke all on function hutka_activity(int) from public, anon;
grant execute on function hutka_activity(int) to authenticated;

-- opening the list marks everything as seen (the badge goes to zero)
create or replace function hutka_activity_seen() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  update notify_queue set seen_at = now() where owner = auth.uid() and seen_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function hutka_activity_seen() from public, anon;
grant execute on function hutka_activity_seen() to authenticated;
