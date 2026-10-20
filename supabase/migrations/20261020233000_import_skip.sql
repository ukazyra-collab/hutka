-- Hutka v34.52 — the map elements whose pages were taken out by a person (import_skip): the track import never makes them again,
-- whatever its rules say then (a rule can miss: the Perm yard loop came back as a new page in a dry run — its 59 m loop sits on a 93 m
-- pitch, so by size it is not a children's ride). Read by tracks-import (index.ts: known as "skip:<osm>"); nobody else reads or writes
-- it (no policies: the service role only).
create table if not exists public.import_skip (
  osm text primary key,                  -- the element as the import names it: "w123", "n456", "r789"
  reason text not null default '',
  created_at timestamptz not null default now()
);
alter table public.import_skip enable row level security;
-- the 11 pages removed on 20 Oct 2026 (OK from Uladzislau, migration 20261020230000_import_junk.sql)
insert into public.import_skip (osm, reason) values
  ('w169070054', 'soap-box derby (USA)'), ('w100484503', 'soap-box derby (USA)'), ('w518046635', 'soap-box derby (USA)'),
  ('w248950907', 'a driving school''s practice ground (Nogliki)'),
  ('w1281232316', 'a children''s ride (DriftCar, Yeysk)'), ('w427229350', 'a children''s ride (Kotovsk)'),
  ('w246775592', 'a children''s ride (Temryuk)'), ('w1443843241', 'a children''s ride (Perm)'),
  ('w493762127', 'a children''s ride (Kislovodsk)'), ('w1367908671', 'a children''s ride (Go, Tyumen)'),
  ('w1424954897', 'a children''s ride (Live Drive, Tyumen)')
on conflict (osm) do nothing;
