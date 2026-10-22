-- v34.57 (speed): the app's start in one request. Every track and every layout (both readable by anyone already) come back as one JSON,
-- with a stamp of the state they are in (how many rows and the last change of each table); the app keeps the answer on the device and
-- next time sends the stamp back: unchanged → {same: true}, nothing else travels. Before this the start read the two tables in six
-- requests of a thousand rows each, one after another, before anything was drawn.
create or replace function public.hutka_boot(p_stamp text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with st as (
    select md5(coalesce((select count(*) || '|' || max(updated_at) from tracks), '') || '/' || coalesce((select count(*) || '|' || max(updated_at) from layouts), '')) as stamp
  )
  select case when p_stamp is not null and p_stamp = st.stamp then jsonb_build_object('same', true, 'stamp', st.stamp)
    else jsonb_build_object('stamp', st.stamp,
      'tracks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'data', data) order by id), '[]'::jsonb) from tracks),
      'layouts', (select coalesce(jsonb_agg(jsonb_build_object('t', track_id, 'id', id, 'data', data) order by track_id, id), '[]'::jsonb) from layouts))
  end from st;
$$;
revoke all on function public.hutka_boot(text) from public;
grant execute on function public.hutka_boot(text) to anon, authenticated;
