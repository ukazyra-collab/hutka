-- Hutka — the test junk out, on the owner's word (18 Oct 2026). Two sessions from the lap-timer tests of 17 Oct with broken data:
-- sxmvcchakh1u2w9 "from device test" (28-second laps, on a track that test created) and sxmvcco8qnjl1yb "test device desktop" (published
-- on Dubai Outdoor Kartdrome, Monaco Switchback); that track, txmvccha9b5luki "DUBAI", with its one layout lxmvcchagji0kuu; the like, the
-- two corner marks and the queued notification on those two sessions. By exact ids only, so it is idempotent and touches nothing else (the
-- analytics events that mention them stay as history). session_data goes with the sessions by cascade.
delete from likes where session_id in ('sxmvcchakh1u2w9', 'sxmvcco8qnjl1yb');
delete from marks where session_id in ('sxmvcchakh1u2w9', 'sxmvcco8qnjl1yb');
delete from notify_queue where session_id in ('sxmvcchakh1u2w9', 'sxmvcco8qnjl1yb');
delete from sessions where id in ('sxmvcchakh1u2w9', 'sxmvcco8qnjl1yb');
delete from layouts where id = 'lxmvcchagji0kuu' and track_id = 'txmvccha9b5luki';
delete from tracks where id = 'txmvccha9b5luki';
