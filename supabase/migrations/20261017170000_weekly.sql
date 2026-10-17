-- Hutka v34.18 — the weekly digest: who got which week (functions/notify, lane 3). Service role only — no policies, RLS on. Idempotent.
create table if not exists weekly_digests (
  user_id uuid not null,
  week text not null,
  channel text not null default '',
  sent_at timestamptz not null default now(),
  primary key (user_id, week)
);
alter table weekly_digests enable row level security;
