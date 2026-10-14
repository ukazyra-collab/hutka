-- Hutka v29.9 — feed cards for older sessions. Run once in the SQL editor (safe to run again).
-- Every driver's browser computes the analysis card (meta.card) for their own sessions; this lets an admin's browser
-- do it for everyone's *published* sessions too, so the whole feed gets the lap line and the reserves at once.
create or replace function hutka_set_card(sid text, card jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if card is null or jsonb_typeof(card) <> 'object' or length(card::text) > 20000 then raise exception 'bad card'; end if;
  update sessions set meta = meta || jsonb_build_object('card', card), updated_at = now() where id = sid and published;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function hutka_set_card(text, jsonb) from public, anon;
grant execute on function hutka_set_card(text, jsonb) to authenticated;
