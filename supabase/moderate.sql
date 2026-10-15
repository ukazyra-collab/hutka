-- Hutka v31.2 — moderation: an admin hides someone's published session from the public (a broken recording, a wrong layout).
-- The session stays in its owner's library, unpublished and marked meta.moderated; the owner cannot republish it, an admin can show it again.
-- Run once in the SQL editor (safe to run again).
create or replace function hutka_set_published(sid text, pub boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update sessions
    set published = pub, updated_at = now(),
        meta = (case when pub then (meta - 'moderated') else (meta || '{"moderated": true}'::jsonb) end) || jsonb_build_object('published', pub)
    where id = sid;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function hutka_set_published(text, boolean) from public, anon;
grant execute on function hutka_set_published(text, boolean) to authenticated;

-- the admin panel lists what is hidden (admins cannot read unpublished sessions of others through the normal policies)
create or replace function hutka_moderated() returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'owner', s.owner, 'label', coalesce(nullif(s.meta->>'label', ''), s.meta->>'name'), 'track', s.track_id, 'layout', s.layout_id, 'bestMs', (s.meta->>'bestMs')::numeric, 'date', s.meta->>'date', 'at', s.updated_at) order by s.updated_at desc), '[]'::jsonb)
    into o from sessions s where (s.meta->>'moderated') = 'true' and not s.published;
  return o;
end $$;
revoke all on function hutka_moderated() from public, anon;
grant execute on function hutka_moderated() to authenticated;
