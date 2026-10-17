-- Hutka v34.16 — bookmarks and favourites: a driver's private marks on sessions. corner 0 = the session is a favourite; corner n ≥ 1 = a
-- bookmark on that corner, with a note. A driver reads and writes only their own rows; at most 500 rows a driver. Idempotent, no DROP.
create table if not exists marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  corner integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, session_id, corner),
  constraint marks_shape check (char_length(note) <= 200 and corner >= 0 and corner <= 99 and char_length(session_id) <= 40)
);
alter table marks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marks' and policyname = 'marks own') then
    create policy "marks own" on marks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
grant select, insert, update, delete on marks to authenticated;
create or replace function hutka_marks_cap() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from marks where user_id = new.user_id) >= 500 then raise exception 'too many marks' using errcode = '53400'; end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'marks_cap' and tgrelid = 'public.marks'::regclass) then
    create trigger marks_cap before insert on marks for each row execute function hutka_marks_cap();
  end if;
end $$;
