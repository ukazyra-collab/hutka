-- Hutka v34.13 — the pictures of the link previews. supabase/share.sql was never applied: the `cards` bucket did not exist, so the
-- upload of the card failed quietly and every hutka.ai/s/<id> page carried the site's generic og.png. Idempotent, no DROP.
-- The bucket: public read, PNG up to 2 MB. A driver writes into cards/<own uid>/<session id>.png; an admin writes into any folder of
-- the bucket (the admin's browser draws the pictures of other drivers' published sessions in the background on Home).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cards', 'cards', true, 2097152, '{image/png}')
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = '{image/png}';
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cards read') then
    create policy "cards read" on storage.objects for select using (bucket_id = 'cards');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cards own') then
    create policy "cards own" on storage.objects for all
      using (bucket_id = 'cards' and auth.uid()::text = (storage.foldername(name))[1])
      with check (bucket_id = 'cards' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cards admin') then
    create policy "cards admin" on storage.objects for all
      using (bucket_id = 'cards' and public.is_admin())
      with check (bucket_id = 'cards' and public.is_admin());
  end if;
end $$;
-- an admin's browser builds the preview pages (and now the pictures) of other drivers' published sessions too; this records what
-- was built in the session's meta, so a page is not rebuilt on every visit
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
