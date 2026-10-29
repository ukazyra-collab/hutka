-- Sign in with Apple with "Hide My Email" gives a @privaterelay.appleid.com address, so a driver who already has a Google /
-- e-mail account gets a second, empty account. merge_apple_identity moves that Apple identity onto the real account and
-- removes the empty one. Called only by the merge-apple edge function (service role) after it has checked both tokens.
create or replace function public.merge_apple_identity(a uuid, b uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if a is null or b is null or a = b then raise exception 'bad ids'; end if;
  if exists (select 1 from auth.identities where user_id = b and provider = 'apple') then raise exception 'target already has an apple identity'; end if;
  if (select count(*) from auth.identities where user_id = a) <> 1
     or not exists (select 1 from auth.identities where user_id = a and provider = 'apple') then raise exception 'source is not an apple-only account'; end if;
  if (select created_at from auth.users where id = a) < now() - interval '7 days' then raise exception 'source is too old'; end if;
  if exists (select 1 from public.sessions where owner = a) or exists (select 1 from public.comments where user_id = a)
     or exists (select 1 from public.likes where user_id = a) or exists (select 1 from public.chats where user_id = a) then raise exception 'source has data'; end if;
  update auth.identities set user_id = b, updated_at = now() where user_id = a and provider = 'apple';
  delete from public.profiles where id = a;
  delete from public.visits where user_id = a;
  delete from public.events where user_id = a;
  delete from auth.users where id = a;
end $$;
revoke all on function public.merge_apple_identity(uuid, uuid) from public, anon, authenticated;
