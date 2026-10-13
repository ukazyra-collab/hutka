-- Hutka v27 — hardening. Run once in the SQL editor of the existing project (after community.sql). Safe to run again.
-- What it does: admins only with a confirmed email · ids and texts must look like ids and texts · size caps on every
-- user-written row · rate limits per driver (sessions, tracks, layouts, comments, votes, follows, claims) · orphan votes and
-- comments go away with their session.

-- 1) an admin is someone from admin_emails whose *confirmed* email matches — a fresh sign-up with an admin's address and no
--    confirmation does not count (the JWT email alone would)
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admin_emails a
    join auth.users u on lower(u.email) = lower(a.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;
grant execute on function is_admin() to anon, authenticated;

-- 2) ids are what the app generates (a letter and base36) or a slug: nothing else gets into links and markup
alter table tracks   drop constraint if exists tracks_id_format;   alter table tracks   add constraint tracks_id_format   check (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$') not valid;
alter table layouts  drop constraint if exists layouts_id_format;  alter table layouts  add constraint layouts_id_format  check (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$') not valid;
alter table sessions drop constraint if exists sessions_id_format; alter table sessions add constraint sessions_id_format check (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$') not valid;
alter table media    drop constraint if exists media_path_format;  alter table media    add constraint media_path_format  check (path ~ '^[a-z0-9][a-z0-9._/-]{0,255}$') not valid;

-- 3) size caps: a row cannot be a megabyte of garbage (and the app never writes anywhere near these)
alter table tracks   drop constraint if exists tracks_size;   alter table tracks   add constraint tracks_size   check (pg_column_size(data) <= 262144) not valid;           -- 256 KB
alter table layouts  drop constraint if exists layouts_size;  alter table layouts  add constraint layouts_size  check (pg_column_size(data) <= 1572864) not valid;          -- 1.5 MB (traces)
alter table media    drop constraint if exists media_size;    alter table media    add constraint media_size    check (data is null or length(data) <= 4000000) not valid;  -- ~3 MB picture
alter table sessions drop constraint if exists sessions_size; alter table sessions add constraint sessions_size check (pg_column_size(meta) <= 196608) not valid;          -- 192 KB
alter table sessions drop constraint if exists sessions_best_ms; alter table sessions add constraint sessions_best_ms check (best_ms is null or best_ms between 5000 and 1800000) not valid;
alter table session_data drop constraint if exists session_data_size; alter table session_data add constraint session_data_size check ((data is null or length(data) <= 16000000) and (enc is null or length(enc) <= 64)) not valid;
alter table profiles drop constraint if exists profiles_lengths; alter table profiles add constraint profiles_lengths check (char_length(racing_name) <= 60 and char_length(country) <= 8 and char_length(home_track) <= 80 and length(avatar) <= 600000) not valid;
alter table claims   drop constraint if exists claims_text_len; alter table claims add constraint claims_text_len check (char_length(text) <= 2000) not valid;
alter table chats    drop constraint if exists chats_title_len; alter table chats  add constraint chats_title_len check (char_length(title) <= 200) not valid;

-- 4) votes and comments belong to a session: no rows for sessions that do not exist, and they go when the session goes
delete from likes    where session_id not in (select id from sessions);
delete from comments where session_id not in (select id from sessions);
alter table likes    drop constraint if exists likes_session_fk;    alter table likes    add constraint likes_session_fk    foreign key (session_id) references sessions(id) on delete cascade;
alter table comments drop constraint if exists comments_session_fk; alter table comments add constraint comments_session_fk foreign key (session_id) references sessions(id) on delete cascade;

-- 5) rate limits per signed-in driver: counted on insert, before the row lands
create or replace function hutka_rate_limit(tbl regclass, col text, lim int, win interval) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or is_admin() then return; end if;   -- admins import whole countries at once
  execute format('select count(*) from %s where %I = $1 and created_at > now() - $2', tbl, col) into n using auth.uid(), win;
  if n >= lim then raise exception 'rate_limit: too many rows in % for this account (limit % per %)', tbl, lim, win using errcode = 'P0001'; end if;
end $$;

create or replace function trg_rate_sessions() returns trigger language plpgsql as $$ begin perform hutka_rate_limit('sessions', 'owner', 150, interval '1 day'); return new; end $$;
create or replace function trg_rate_tracks()   returns trigger language plpgsql as $$ begin perform hutka_rate_limit('tracks', 'created_by', 20, interval '1 day'); return new; end $$;
create or replace function trg_rate_layouts()  returns trigger language plpgsql as $$ begin perform hutka_rate_limit('layouts', 'created_by', 60, interval '1 day'); return new; end $$;
create or replace function trg_rate_comments() returns trigger language plpgsql as $$ begin perform hutka_rate_limit('comments', 'user_id', 60, interval '1 hour'); return new; end $$;
create or replace function trg_rate_likes()    returns trigger language plpgsql as $$ begin perform hutka_rate_limit('likes', 'user_id', 300, interval '1 hour'); return new; end $$;
create or replace function trg_rate_follows()  returns trigger language plpgsql as $$ begin perform hutka_rate_limit('follows', 'follower', 300, interval '1 day'); return new; end $$;
create or replace function trg_rate_claims()   returns trigger language plpgsql as $$ begin perform hutka_rate_limit('claims', 'by', 10, interval '1 day'); return new; end $$;

alter table tracks  add column if not exists created_at timestamptz not null default now();
alter table layouts add column if not exists created_at timestamptz not null default now();

drop trigger if exists rate_sessions on sessions; create trigger rate_sessions before insert on sessions for each row execute function trg_rate_sessions();
drop trigger if exists rate_tracks   on tracks;   create trigger rate_tracks   before insert on tracks   for each row execute function trg_rate_tracks();
drop trigger if exists rate_layouts  on layouts;  create trigger rate_layouts  before insert on layouts  for each row execute function trg_rate_layouts();
drop trigger if exists rate_comments on comments; create trigger rate_comments before insert on comments for each row execute function trg_rate_comments();
drop trigger if exists rate_likes    on likes;    create trigger rate_likes    before insert on likes    for each row execute function trg_rate_likes();
drop trigger if exists rate_follows  on follows;  create trigger rate_follows  before insert on follows  for each row execute function trg_rate_follows();
drop trigger if exists rate_claims   on claims;   create trigger rate_claims   before insert on claims   for each row execute function trg_rate_claims();

-- 6) a driver's own rows are theirs: the owner columns cannot be re-pointed at somebody else after the fact
create or replace function trg_keep_owner() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'sessions' and new.owner <> old.owner then raise exception 'owner is fixed'; end if;
  if tg_table_name = 'tracks' and new.created_by is distinct from old.created_by and not is_admin() then raise exception 'created_by is fixed'; end if;
  if tg_table_name = 'layouts' and new.created_by is distinct from old.created_by and not is_admin() then raise exception 'created_by is fixed'; end if;
  return new;
end $$;
drop trigger if exists keep_owner_sessions on sessions; create trigger keep_owner_sessions before update on sessions for each row execute function trg_keep_owner();
drop trigger if exists keep_owner_tracks   on tracks;   create trigger keep_owner_tracks   before update on tracks   for each row execute function trg_keep_owner();
drop trigger if exists keep_owner_layouts  on layouts;  create trigger keep_owner_layouts  before update on layouts  for each row execute function trg_keep_owner();

-- 7) the anon role writes nothing anywhere (RLS already says so; this closes the table grants too)
revoke insert, update, delete on all tables in schema public from anon;
