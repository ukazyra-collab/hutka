-- Hutka v34.2 — community safety: a report on a session, a comment, a driver or a coach answer; blocking a driver; deleting one's own account.
-- Run once in the SQL editor (safe to run again).

-- ----- reports on content and people (the bug reports of v29.4 live in `reports`; these are about other users' content) -----
create table if not exists flags (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  reporter uuid not null references auth.users(id) on delete cascade,
  kind text not null,                      -- session | comment | profile | ai
  target text not null,                    -- the session id, the comment id, the driver's user id, the chat id
  reason text not null default 'other',    -- spam | abuse | wrong | other
  note text not null default '',
  status text not null default 'new',      -- new | done
  handled_at timestamptz,
  constraint flags_kind check (kind in ('session', 'comment', 'profile', 'ai')),
  constraint flags_reason check (reason in ('spam', 'abuse', 'wrong', 'other')),
  constraint flags_status check (status in ('new', 'done')),
  constraint flags_note check (char_length(note) <= 500 and char_length(target) <= 80),
  unique (reporter, kind, target)
);
create index if not exists flags_status_idx on flags (status, created_at desc);
alter table flags enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'flags' and policyname = 'flags insert') then
    create policy "flags insert" on flags for insert with check (reporter = auth.uid());
    create policy "flags own update" on flags for update using (reporter = auth.uid() or is_admin()) with check (reporter = auth.uid() or is_admin());
    create policy "flags read" on flags for select using (reporter = auth.uid() or is_admin());
    create policy "flags delete" on flags for delete using (reporter = auth.uid() or is_admin());
  end if;
end $$;

-- ----- blocking: the blocked driver's sessions and comments disappear for the blocker; the blocked driver cannot comment on or vote for the blocker's sessions -----
create table if not exists blocks (
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint blocks_self check (blocker <> blocked)
);
alter table blocks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'blocks' and policyname = 'blocks own') then
    create policy "blocks own" on blocks for all using (blocker = auth.uid()) with check (blocker = auth.uid());
  end if;
end $$;

-- is the current user blocked by the owner of this session? (security definer: a driver cannot read the block rows that concern them)
create or replace function hutka_blocked_on(sid text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from blocks b join sessions s on s.id = sid where b.blocker = s.owner and b.blocked = auth.uid());
$$;
revoke all on function hutka_blocked_on(text) from public, anon;
grant execute on function hutka_blocked_on(text) to authenticated;

alter policy "comments insert" on comments with check (user_id = auth.uid() and length(text) between 1 and 1000 and not hutka_blocked_on(session_id));
alter policy "likes own" on likes using (user_id = auth.uid()) with check (user_id = auth.uid() and not hutka_blocked_on(session_id));

-- ----- the account: everything of the signed-in driver goes at once (delete-account.html describes what goes and what stays) -----
create or replace function hutka_delete_account() returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'sign in' using errcode = '42501'; end if;
  delete from notify_queue where owner = u or actor = u;
  update events set user_id = null where user_id = u;          -- the usage counters stay anonymous
  begin update visits set user_id = null where user_id = u; exception when undefined_table or undefined_column then null; end;
  delete from claims where "by" = u;
  begin delete from storage.objects where bucket_id = 'cards' and name like u::text || '/%'; exception when others then null; end;
  delete from auth.users where id = u;                          -- cascades: sessions and their data, profile, likes, comments, follows, chats, wallet, push tokens, blocks, flags
  return true;
end $$;
revoke all on function hutka_delete_account() from public, anon;
grant execute on function hutka_delete_account() to authenticated;

-- the admin panel: open reports with what they point at
create or replace function hutka_flags(only_new boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o jsonb;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'at', f.created_at, 'kind', f.kind, 'target', f.target, 'reason', f.reason, 'note', f.note, 'status', f.status,
      'reporter', f.reporter, 'reporterName', coalesce(nullif(trim(coalesce(rp.first_name, '') || ' ' || coalesce(rp.last_name, '')), ''), rp.racing_name, ''),
      'sessionLabel', coalesce(nullif(s.meta->>'label', ''), s.meta->>'name', ''), 'sessionOwner', s.owner,
      'commentText', left(c.text, 300), 'commentUser', c.user_id, 'commentSession', c.session_id,
      'profileName', coalesce(nullif(trim(coalesce(pp.first_name, '') || ' ' || coalesce(pp.last_name, '')), ''), pp.racing_name, '')) order by f.created_at desc), '[]'::jsonb)
    into o
    from flags f
    left join profiles rp on rp.id = f.reporter
    left join sessions s on f.kind = 'session' and s.id = f.target
    left join comments c on f.kind = 'comment' and f.target ~ '^\d+$' and c.id = f.target::bigint
    left join profiles pp on f.kind = 'profile' and f.target ~ '^[0-9a-f-]{36}$' and pp.id = f.target::uuid
    where (not only_new) or f.status = 'new';
  return o;
end $$;
revoke all on function hutka_flags(boolean) from public, anon;
grant execute on function hutka_flags(boolean) to authenticated;
