-- Hutka: one-shot setup for a fresh Supabase project. Paste the whole file into SQL Editor → Run.

-- Hutka — database schema for Supabase (run once in the SQL editor).
-- Public reading for everyone; writing only for signed-in users (their own sessions and profile) and site admins (tracks).

create table if not exists admin_emails (email text primary key);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_emails a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function is_admin() to anon, authenticated;

create table if not exists tracks (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists layouts (
  track_id text not null references tracks(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (track_id, id)
);
create table if not exists media (
  path text primary key,
  data text,
  updated_at timestamptz not null default now()
);
create table if not exists sessions (
  id text primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  track_id text not null default '',
  layout_id text not null default 'custom',
  published boolean not null default false,
  best_ms integer,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists session_data (
  id text primary key references sessions(id) on delete cascade,
  enc text,
  data text
);
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  racing_name text not null default '',
  country text not null default '',
  home_track text not null default '',
  avatar text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists claims (
  id bigserial primary key,
  track_id text,
  by uuid,
  text text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists sessions_owner_idx on sessions (owner);
create index if not exists sessions_track_pub_idx on sessions (track_id, published);
create index if not exists sessions_track_layout_idx on sessions (track_id, layout_id, published);
create index if not exists profiles_name_idx on profiles (lower(racing_name));

alter table tracks enable row level security;
alter table layouts enable row level security;
alter table media enable row level security;
alter table sessions enable row level security;
alter table session_data enable row level security;
alter table profiles enable row level security;
alter table claims enable row level security;
alter table admin_emails enable row level security;

-- catalogue: everyone reads, admins write
create policy "tracks read" on tracks for select using (true);
create policy "tracks admin write" on tracks for all using (is_admin()) with check (is_admin());
create policy "layouts read" on layouts for select using (true);
create policy "layouts admin write" on layouts for all using (is_admin()) with check (is_admin());
create policy "media read" on media for select using (true);
create policy "media admin write" on media for all using (is_admin()) with check (is_admin());
-- sessions: published ones are public, private ones only to their owner; owners manage their own
create policy "sessions read" on sessions for select using (published or owner = auth.uid());
create policy "sessions own" on sessions for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy "session_data read" on session_data for select using (exists (select 1 from sessions s where s.id = session_data.id and (s.published or s.owner = auth.uid())));
create policy "session_data own" on session_data for all using (exists (select 1 from sessions s where s.id = session_data.id and s.owner = auth.uid())) with check (exists (select 1 from sessions s where s.id = session_data.id and s.owner = auth.uid()));
-- profiles: public, each person edits their own
create policy "profiles read" on profiles for select using (true);
create policy "profiles own" on profiles for all using (id = auth.uid()) with check (id = auth.uid());
-- claim requests: any signed-in person can send one, admins read and delete
create policy "claims insert" on claims for insert with check (auth.uid() is not null and by = auth.uid());
create policy "claims admin read" on claims for select using (is_admin());
create policy "claims admin delete" on claims for delete using (is_admin());
-- the admin list itself is private
create policy "admins read own" on admin_emails for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- >>> put your own email here, then you are the site admin as soon as you sign in <<<

-- site admins (sign in with this email to get the Admin panel)
insert into admin_emails (email) values ('u.kazyra@kozyramedia.com') on conflict do nothing;

-- Hutka: UAE tracks seed (run after schema.sql). Edit anything later in the Admin Panel.
insert into tracks (id, data) values
  ('dubai-kartdrome', '{"name": "Dubai Outdoor Kartdrome", "city": "Dubai", "country": "AE", "lat": 25.0444, "lon": 55.2401, "address": "Dubai Autodrome, Dubai Motor City (26WR+323, Al Hebiah First)", "phone": "800 KARTING (800 527 8464)", "website": "https://dubaiautodrome.ae/kartdrome-main/arrive-drive-2/", "booking": "https://bookings.dubaiautodrome.com/", "video": "", "open": "09:00", "close": "00:00", "lengthM": 1200, "corners": 17, "vmax": 85, "sessMin": 20, "fia": true, "instagram": "https://www.instagram.com/dubaiautodrome/", "youtube": "https://www.youtube.com/user/dubaiautodrome", "facebook": "https://www.facebook.com/DubaiAutodrome/", "tiktok": "", "description": "Flood-lit 1.2 km outdoor circuit with 17 corners, a tunnel and a bridge, FIA sanctioned. Arrive & drive sessions of 15 or 20 minutes (3 minutes paced), 13+. Walk-in AED 160/199, online 9 AM offer AED 99. Open daily 9 AM to midnight.", "logo": "", "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('dubai-indoor-kartdrome', '{"name": "Dubai Indoor Kartdrome", "city": "Dubai", "country": "AE", "lat": 25.0475, "lon": 55.2385, "address": "Dubai Autodrome, Dubai Motor City", "phone": "800 KARTING (800 527 8464)", "website": "https://dubaiautodrome.ae/kartdrome-main/arrive-drive-2/", "booking": "https://bookings.dubaiautodrome.com/karting/indoor-circuit", "video": "", "open": "14:00", "close": "22:00", "lengthM": 620, "corners": null, "vmax": null, "sessMin": 15, "fia": "", "instagram": "https://www.instagram.com/dubaiautodrome/", "youtube": "https://www.youtube.com/user/dubaiautodrome", "facebook": "https://www.facebook.com/DubaiAutodrome/", "tiktok": "", "description": "620 m indoor circuit for up to 10 karts, 7+ (min. height 125 cm). 15-minute sessions. Mon–Thu 2 PM–10 PM, Fri–Sun and public holidays 9 AM–midnight.", "logo": "", "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('chaos-karts-uae', '{"name": "Chaos Karts UAE", "city": "Dubai", "country": "AE", "lat": 25.140972, "lon": 55.2244295, "address": "Al Quoz, Dubai", "phone": "+971 4 328 7571", "website": "https://chaoskarts.com", "booking": "https://fever.pxf.io/55bx73", "video": "", "open": "10:00", "close": "22:00", "lengthM": null, "corners": null, "vmax": null, "sessMin": 20, "fia": "", "instagram": "", "youtube": "", "facebook": "", "tiktok": "", "description": "Immersive indoor karting with augmented-reality circuits, virtual obstacles and power-ups; no helmets or suits needed. 9+. Mon–Fri AED 140/180, Sat–Sun AED 180/220; private 20-minute sessions for 2–8.", "logo": "", "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('karting-town-sharjah', '{"name": "Karting Town", "city": "Sharjah", "country": "AE", "lat": 25.322, "lon": 55.561, "address": "Near Sharjah Golf and Shooting Club, Sharjah", "phone": "600 58 77 77", "website": "", "booking": "", "video": "", "open": "12:00", "close": "00:00", "lengthM": null, "corners": null, "vmax": null, "sessMin": null, "fia": "", "instagram": "", "youtube": "", "facebook": "", "tiktok": "", "description": "Six track layouts, Sodi-powered karts. Mon–Thu 12 PM–midnight, Fri–Sun 12 PM–1 AM (hours may change with private bookings).", "logo": "", "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('sharjah-kart-track', '{"name": "Sharjah Kart Track", "city": "Sharjah", "country": "AE", "lat": 24.995, "lon": 55.73, "address": "Sahara Amusement, E-44 Dubai–Hatta Road, Al Badayer, Sharjah", "phone": "+971 56 577 6001 (bookings +971 56 577 6012)", "website": "", "booking": "", "video": "", "open": "15:00", "close": "23:00", "lengthM": 1200, "corners": null, "vmax": null, "sessMin": null, "fia": "", "instagram": "", "youtube": "", "facebook": "", "tiktok": "", "description": "1.2 km track with four configurations (two directions, two routes each), Sodi RT8 karts with adjustable seats and pedals. Mon–Fri 3 PM–11 PM, Sat, Sun and holidays 10 AM–11 PM. Free helmets, prayer area, showers.", "logo": "", "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('rak-track', '{"name": "RAK Track", "city": "Ras Al Khaimah", "country": "AE", "lat": 25.6865, "lon": 55.7903, "address": "E11 Sheikh Mohamed Bin Salem Road, Ras Al Khaimah", "phone": "+971 7 222 2128", "website": "https://www.raktrack.com", "booking": "https://www.raktrack.com", "video": "", "open": "15:00", "close": "23:00", "lengthM": null, "corners": null, "vmax": null, "sessMin": 15, "fia": "", "instagram": "", "youtube": "", "facebook": "", "tiktok": "", "description": "T-shaped circuit (IAME Series UAE venue). Karts from Sodi LR5 (5 hp) and RX8 (9 hp) to 2Drive 390cc (11 hp), BirelART 125cc (20 hp) and RX250 KA100 (22 hp); 15-minute sessions, 7+ or 120 cm. Open six days a week from 3–4 PM to 11 PM–midnight.", "logo": "", "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('yas-kartzone', '{"name": "Yas Kartzone", "city": "Abu Dhabi", "country": "AE", "lat": 24.4705, "lon": 54.6035, "address": "Yas Marina Circuit, West Gate 20, Yas Island, Abu Dhabi", "phone": "", "website": "https://www.yasmarinacircuit.com", "booking": "https://www.yasmarinacircuit.com", "video": "", "open": "09:00", "close": "00:00", "lengthM": 1000, "corners": null, "vmax": 60, "sessMin": 30, "fia": "", "instagram": "", "youtube": "", "facebook": "", "tiktok": "", "description": "1 km track at Yas Marina Circuit with three configurations that run separately or combined; lap tracking system, karts up to 60 km/h, bambino sessions from age 5. Open 9 AM to midnight.", "logo": "", "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('al-forsan', '{"name": "Al Forsan International Sports Resort", "city": "Abu Dhabi", "country": "AE", "lat": 24.4325, "lon": 54.599, "address": "Street No. 12, near Abu Dhabi Golf Club, Khalifa City, Abu Dhabi", "phone": "+971 2 656 5656", "website": "https://www.alforsan.com", "booking": "https://www.alforsan.com", "video": "", "open": "10:00", "close": "23:00", "lengthM": 1200, "corners": null, "vmax": null, "sessMin": null, "fia": true, "instagram": "", "youtube": "", "facebook": "", "tiktok": "", "description": "1.2 km CIK-FIA-approved karting track with a karting academy; electric karts for 3–6, junior karts for 7–12, high-speed sessions 13+. From AED 130. Open daily 10 AM–11 PM; Emirates ID required at admission.", "logo": "", "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb)
on conflict (id) do update set data = excluded.data, updated_at = now();
insert into layouts (track_id, id, data) values
  ('dubai-kartdrome', 'standard', '{"name": "Standard", "order": 0, "lengthM": 1200, "corners": 17, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('dubai-kartdrome', 'extended', '{"name": "Extended", "order": 1, "lengthM": null, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('dubai-kartdrome', 'reverse', '{"name": "Reverse", "order": 2, "lengthM": null, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('sharjah-kart-track', 'forward-a', '{"name": "Forward A", "order": 0, "lengthM": null, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('sharjah-kart-track', 'forward-b', '{"name": "Forward B", "order": 1, "lengthM": null, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('sharjah-kart-track', 'reverse-a', '{"name": "Reverse A", "order": 2, "lengthM": null, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('sharjah-kart-track', 'reverse-b', '{"name": "Reverse B", "order": 3, "lengthM": null, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('yas-kartzone', 'full', '{"name": "Full (combined)", "order": 0, "lengthM": 1000, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('dubai-indoor-kartdrome', 'indoor', '{"name": "Indoor", "order": 0, "lengthM": 620, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 80, "widthM": 7, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('al-forsan', 'full', '{"name": "Full track", "order": 0, "lengthM": 1200, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('rak-track', 'main', '{"name": "Main", "order": 0, "lengthM": null, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb),
  ('karting-town-sharjah', 'main', '{"name": "Main", "order": 0, "lengthM": null, "corners": null, "direction": "", "note": "", "refSession": "", "cornerR": 110, "widthM": 8, "createdAt": 1791875201213, "updatedAt": 1791875201213}'::jsonb)
on conflict (track_id, id) do update set data = excluded.data, updated_at = now();
