-- Hutka v31.2 — e-mail notifications: "someone liked / commented on your session". Run once in the SQL editor (safe to run again).
-- Likes and comments drop a row into notify_queue (triggers); the edge function `notify` (called by the site itself, see functions/notify)
-- groups the pending rows per driver and sends one e-mail through Resend — at most one per driver per hour, nothing for your own actions,
-- nothing for downvotes. profiles.notify = false turns the e-mails off for a driver (the Profile page).
create table if not exists notify_queue (
  id bigserial primary key,
  owner uuid not null,
  actor uuid,
  kind text not null,                 -- like | comment
  session_id text,
  comment_id bigint,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notify_queue_owner_idx on notify_queue (owner, sent_at);
alter table notify_queue enable row level security;   -- no policies on purpose: only the function (service role) reads and writes it
alter table profiles add column if not exists notify boolean not null default true;

create or replace function trg_notify_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  if new.vote <> 1 then return new; end if;
  if tg_op = 'UPDATE' and old.vote = 1 then return new; end if;
  select owner into o from sessions where id = new.session_id and published;
  if o is null or o = new.user_id then return new; end if;
  insert into notify_queue (owner, actor, kind, session_id) values (o, new.user_id, 'like', new.session_id);
  return new;
end $$;
drop trigger if exists notify_like on likes;
create trigger notify_like after insert or update on likes for each row execute function trg_notify_like();

create or replace function trg_notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  select owner into o from sessions where id = new.session_id;
  if o is null or o = new.user_id then return new; end if;
  insert into notify_queue (owner, actor, kind, session_id, comment_id) values (o, new.user_id, 'comment', new.session_id, new.id);
  return new;
end $$;
drop trigger if exists notify_comment on comments;
create trigger notify_comment after insert on comments for each row execute function trg_notify_comment();
