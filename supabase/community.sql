-- Hutka v23 — community tracks, kart classes, helpful / not helpful votes.
-- Run once in the SQL editor of the existing project (after update.sql and ai.sql). Safe to run again.

-- 1) tracks and layouts can be added by any signed-in driver (whoever uploads the first session there);
--    the person who added a track edits it, admins edit everything, only admins delete
alter table tracks add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table layouts add column if not exists created_by uuid references auth.users(id) on delete set null;

create or replace function can_edit_track(tid text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (select 1 from tracks t where t.id = tid and t.created_by = auth.uid());
$$;
grant execute on function can_edit_track(text) to anon, authenticated;

drop policy if exists "tracks admin write" on tracks;
drop policy if exists "tracks insert" on tracks;
create policy "tracks insert" on tracks for insert with check (auth.uid() is not null and (is_admin() or created_by = auth.uid()));
drop policy if exists "tracks edit" on tracks;
create policy "tracks edit" on tracks for update using (can_edit_track(id)) with check (can_edit_track(id));
drop policy if exists "tracks delete" on tracks;
create policy "tracks delete" on tracks for delete using (is_admin());

drop policy if exists "layouts admin write" on layouts;
drop policy if exists "layouts write" on layouts;
create policy "layouts write" on layouts for all using (can_edit_track(track_id)) with check (can_edit_track(track_id));

-- media paths look like tracks/<track id>/... — the track's editor manages its pictures
drop policy if exists "media admin write" on media;
drop policy if exists "media write" on media;
create policy "media write" on media for all using (can_edit_track(split_part(path, '/', 2))) with check (can_edit_track(split_part(path, '/', 2)));

-- 2) votes: a like becomes "helpful" (+1) or "not helpful" (−1)
alter table likes add column if not exists vote smallint not null default 1;
alter table likes drop constraint if exists likes_vote_check;
alter table likes add constraint likes_vote_check check (vote in (-1, 1));
