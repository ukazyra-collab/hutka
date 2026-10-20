-- Hutka v34.48 — six pages that were one venue twice (OK from Uladzislau, 20 Oct 2026). None has a session, a chat, a claim or a
-- home-track mark; layouts go with their track (on delete cascade), anything kept in media under the page goes too.
--  · an SWS page known by its town only and the same venue from the map: the map's page stays (its spot, its line) and gets the SWS mark
--    and the name SWS uses — Pitstop Karting (Lebanon), Karting Racing Dakart Valencia, SkyMall Karting Kyiv (GoKart Kyiv, in the mall)
--  · two SWS pages of one circuit: Harbor Circuit Makuhari stays, Harbor Circuit goes
--  · Al Forsan: the page with its five sessions stays, a driver's second page with none goes
--  · Karting Town: our page (its description, phone, hours, SWS mark) moves to the venue the map has, 7.9 km off where it stood, and
--    takes its map element (the import knows it from now on); the map's copy goes

-- the SWS mark on the map's pages
update public.tracks t set data = t.data || jsonb_build_object('sws', true, 'swsName', v.sws, 'updatedAt', (extract(epoch from now()) * 1000)::bigint), updated_at = now()
from (values
  ('osm-w475318479', 'Pitstop Karting'),
  ('osm-n4699154213', 'Karting Racing Dakart Valencia'),
  ('osm-w1478791613', 'SkyMall Karting Kyiv')
) v(id, sws)
where t.id = v.id;

-- Karting Town: onto the venue the map has
update public.tracks set data = data || jsonb_build_object('lat', 25.35017, 'lon', 55.4891, 'osm', 'w1508788733', 'updatedAt', (extract(epoch from now()) * 1000)::bigint), updated_at = now()
where id = 'karting-town-sharjah' and exists (select 1 from public.tracks where id = 'osm-w1508788733');

-- the second pages
with gone(id) as (values
  ('sws-pitstop-karting'), ('sws-karting-racing-dakart-valencia'), ('sws-skymall-karting-kyiv'), ('sws-harbor-circuit'), ('txmvc0p64btelr1'), ('osm-w1508788733')
), safe as (
  select g.id from gone g where not exists (select 1 from public.sessions s where s.track_id = g.id)
), m as (
  delete from public.media using safe where public.media.path like 'tracks/' || safe.id || '/%' returning 1
)
delete from public.tracks where id in (select id from safe);
