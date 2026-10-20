-- Hutka v34.46 — the one-off place searches for the Sodi World Series list are done: their job table, step function and cron job go
-- (they were made by hand for that run: public.geo_jobs held the batches of questions, public.hutka_geo_step() sent one batch at a
-- time to the tracks-import function's "geocode" mode).
select cron.unschedule(jobid) from cron.job where jobname = 'hutka-geo';
drop function if exists public.hutka_geo_step();
drop table if exists public.geo_jobs;
