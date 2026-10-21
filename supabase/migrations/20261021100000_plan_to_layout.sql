-- v34.54: a venue's plan read for a layout nobody has driven or drawn is kept on that layout for everyone, by any signed-in driver (not
-- only the venue's editors): the drawing (the picture's line in its pixels, its size in metres, the start), the way round, the size when
-- it is known, the line the AI read, the picture under it. Only an empty layout — no session on it, no drawing, no map line — or one this
-- same driver filled from a plan before (his own fill, read again or turned the other way round). The first session uploaded there makes
-- the line exact; the venue's editors change anything as before. Returns the layout's data as saved, or null when it is not empty.
create or replace function public.hutka_layout_from_plan(p_tid text, p_lid text, p_trace jsonb, p_direction text, p_length_m integer,
  p_photo_line jsonb, p_picture text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); d jsonb; tr jsonb; pts jsonb; n integer; len numeric;
begin
  if uid is null then raise exception 'sign in' using errcode = '42501'; end if;
  select data into d from layouts where track_id = p_tid and id = p_lid for update;
  if not found then raise exception 'no such layout' using errcode = 'P0002'; end if;
  if jsonb_typeof(d->'line') = 'object' then return null; end if;
  if coalesce(d->'trace'->>'closed', 'false') = 'true' and not (d->'trace'->>'from' = 'photo' and d->'trace'->>'by' = uid::text) then return null; end if;
  select count(*) into n from sessions where track_id = p_tid and layout_id = p_lid;
  if n > 0 then return null; end if;
  pts := p_trace->'pts';
  if jsonb_typeof(pts) is distinct from 'array' or jsonb_array_length(pts) < 8 or jsonb_array_length(pts) > 1000 or octet_length(p_trace::text) > 80000 then
    raise exception 'bad drawing' using errcode = '22023'; end if;
  len := (p_trace->>'lengthM')::numeric;
  if len is null or len < 100 or len > 8000 then raise exception 'bad drawing' using errcode = '22023'; end if;
  if p_photo_line is not null and (jsonb_typeof(p_photo_line->'pts') is distinct from 'array' or octet_length(p_photo_line::text) > 200000) then
    raise exception 'bad line' using errcode = '22023'; end if;
  if p_picture is not null and (octet_length(p_picture) > 1400000 or p_picture !~ '^data:image/(jpeg|png|webp);base64,') then
    raise exception 'bad picture' using errcode = '22023'; end if;
  tr := jsonb_build_object('closed', true, 'pts', pts, 'lengthM', len, 'startU', coalesce((p_trace->>'startU')::numeric, 0), 'reverse', false,
    'w', (p_trace->>'w')::numeric, 'h', (p_trace->>'h')::numeric, 'from', 'photo', 'by', uid::text,
    'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  d := d || jsonb_build_object('trace', tr, 'updatedAt', (extract(epoch from now()) * 1000)::bigint);
  if p_direction in ('cw', 'ccw') then d := d || jsonb_build_object('direction', p_direction); end if;
  if p_length_m between 200 and 6000 and coalesce((d->>'lengthM')::numeric, 0) = 0 then d := d || jsonb_build_object('lengthM', p_length_m); end if;
  if p_photo_line is not null then d := d || jsonb_build_object('photoLine', p_photo_line); end if;
  update layouts set data = d, updated_at = now() where track_id = p_tid and id = p_lid;
  if p_picture is not null then
    insert into media (path, data, updated_at) values ('tracks/' || p_tid || '/layouts/' || p_lid || '/media/trace', p_picture, now())
      on conflict (path) do update set data = excluded.data, updated_at = excluded.updated_at;
  end if;
  return d;
end $$;
revoke all on function public.hutka_layout_from_plan(text, text, jsonb, text, integer, jsonb, text) from public, anon;
grant execute on function public.hutka_layout_from_plan(text, text, jsonb, text, integer, jsonb, text) to authenticated;
