-- Hutka v18 — the racing AI: chats, messages, credits. Run once in the SQL editor (after setup.sql and social.sql).

create table if not exists chats (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  session_id text,
  track_id text,
  layout_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists messages (
  id bigserial primary key,
  chat_id bigint not null references chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  credits integer not null default 0,
  created_at timestamptz not null default now()
);
-- one wallet per person: prepaid credits and/or an active plan
create table if not exists wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 0,
  plan text not null default 'free',
  plan_until timestamptz,
  stripe_customer text,
  stripe_subscription text,
  updated_at timestamptz not null default now()
);
create table if not exists ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null default '',
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists chats_user_idx on chats (user_id, updated_at desc);
create index if not exists messages_chat_idx on messages (chat_id, created_at);
create index if not exists ledger_user_idx on ledger (user_id, created_at desc);
create unique index if not exists ledger_ref_idx on ledger (ref) where ref is not null;

alter table chats enable row level security;
alter table messages enable row level security;
alter table wallets enable row level security;
alter table ledger enable row level security;

-- chats and messages are private to their owner; replies and billing are written by the edge functions (service role)
create policy "chats own" on chats for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "messages own read" on messages for select using (user_id = auth.uid());
create policy "messages own delete" on messages for delete using (user_id = auth.uid());
create policy "wallet own read" on wallets for select using (user_id = auth.uid());
create policy "ledger own read" on ledger for select using (user_id = auth.uid());
