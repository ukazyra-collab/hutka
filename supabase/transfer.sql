-- Hutka v32.3 — admins hand a session to another driver (uploaded on someone's behalf, with their consent) and can set a driver's name.
-- Applied by the Supabase ↔ GitHub integration as supabase/migrations/20261015120000_transfer.sql; safe to run again by hand.

-- the session moves to the new owner: the row, meta.owner, likes/comments stay with it, the link preview is rebuilt on the next visit
create or replace function hutka_transfer_session(sid text, new_owner uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = new_owner) then raise exception 'no such driver' using errcode = 'P0002'; end if;
  update sessions
    set owner = new_owner, updated_at = now(),
        meta = (meta - 'share') || jsonb_build_object('owner', new_owner::text)
    where id = sid;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function hutka_transfer_session(text, uuid) from public, anon;
grant execute on function hutka_transfer_session(text, uuid) to authenticated;

-- a driver's name, set by an admin (a profile created from an e-mail stub, a misspelling)
create or replace function hutka_set_driver_name(uid uuid, first text, last text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int; f text := left(trim(coalesce(first, '')), 40); l text := left(trim(coalesce(last, '')), 40);
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if f = '' then raise exception 'first name required' using errcode = '22023'; end if;
  update profiles set first_name = f, last_name = l, racing_name = trim(f || ' ' || l) where id = uid;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function hutka_set_driver_name(uuid, text, text) from public, anon;
grant execute on function hutka_set_driver_name(uuid, text, text) to authenticated;
