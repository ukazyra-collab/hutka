-- Hutka v30 — link previews for shared sessions. Run once in the SQL editor (safe to run again).
-- A public bucket for the share pictures (the card the Lab draws, 1200×630 PNG): everyone can read, a driver writes only
-- into their own folder cards/<their user id>/<session id>.png. The page itself is written to GitHub by functions/share-page.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cards', 'cards', true, 2097152, '{image/png}')
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = '{image/png}';
drop policy if exists "cards read" on storage.objects;
create policy "cards read" on storage.objects for select using (bucket_id = 'cards');
drop policy if exists "cards own" on storage.objects;
create policy "cards own" on storage.objects for all
  using (bucket_id = 'cards' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'cards' and auth.uid()::text = (storage.foldername(name))[1]);
-- an admin's browser builds the preview pages of other drivers' published sessions too (the picture only the owner can draw);
-- this records what was built in the session's meta, so a page is not rebuilt on every visit
create or replace function hutka_set_share(sid text, share jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if share is not null and (jsonb_typeof(share) <> 'object' or length(share::text) > 2000) then raise exception 'bad share'; end if;
  update sessions set meta = (case when share is null then meta - 'share' else meta || jsonb_build_object('share', share) end), updated_at = now() where id = sid and published;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function hutka_set_share(text, jsonb) from public, anon;
grant execute on function hutka_set_share(text, jsonb) to authenticated;
