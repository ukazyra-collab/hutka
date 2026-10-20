-- Hutka v34.51 — pages the track import brought that are not karting (OK from Uladzislau, 20 Oct 2026: «Да»). None has a session, a
-- chat, a claim or a home-track mark; layouts go with their track (on delete cascade), the map line kept in media goes too. The import
-- leaves such places out from now on (tracks-import lib.ts: NOT_KARTING, tinyVenue), so they do not come back.
--  · soap-box derby hills (USA): Salem, Cleveland, Sanford
--  · a driving school's practice ground: "Учебный автодром" (Nogliki)
--  · children's rides — every piece of the place within 70 m: DriftCar (Yeysk, 26 m), "Площадка для картинга" (Kotovsk, 35 m),
--    "Картинг" (Temryuk, 50 m), "Трасса для картинга" (Perm, 58 m), "Картинг" (Kislovodsk, 58 m), "Go" (Tyumen, 64 m),
--    "Live Drive" (Tyumen, 66 m)
-- Kept: the other pages with plain names ("Картодром", "Картинг", "Автодром" — 70 m to 0.5 km, real circuits by their size).
with gone(id) as (values
  ('osm-w169070054'), ('osm-w100484503'), ('osm-w518046635'),
  ('osm-w248950907'),
  ('osm-w1281232316'), ('osm-w427229350'), ('osm-w246775592'), ('osm-w1443843241'), ('osm-w493762127'), ('osm-w1367908671'), ('osm-w1424954897')
), safe as (
  select g.id from gone g where not exists (select 1 from public.sessions s where s.track_id = g.id)
), m as (
  delete from public.media using safe where public.media.path like 'tracks/' || safe.id || '/%' returning 1
)
delete from public.tracks where id in (select id from safe) and data->>'source' = 'osm';
