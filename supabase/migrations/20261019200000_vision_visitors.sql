-- v34.38: the ask function reads a signed-out visitor's photo too (which track is this?), a few a day per network address:
-- such a row has no driver, only the short hash of the address it came from.
alter table ai_vision alter column user_id drop not null;
alter table ai_vision add column if not exists ip text;
create index if not exists ai_vision_ip_at on ai_vision (ip, created_at desc);
