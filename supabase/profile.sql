-- Hutka v29 — registration profile. Run once in the SQL editor (safe to run again).
-- First and last name, birth year and weight on the profile; the racing name stays as the display name ("First Last").
alter table profiles add column if not exists first_name text not null default '';
alter table profiles add column if not exists last_name  text not null default '';
alter table profiles add column if not exists birth_year integer;
alter table profiles add column if not exists weight_kg  integer;
alter table profiles drop constraint if exists profiles_person;
alter table profiles add constraint profiles_person check (
  char_length(first_name) <= 40 and char_length(last_name) <= 40
  and (birth_year is null or birth_year between 1900 and 2100)
  and (weight_kg is null or weight_kg between 20 and 200)
) not valid;
