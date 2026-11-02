"""Pick the next carousel to publish: approved, not yet published, oldest approval first,
and only if the last publication is at least IG_GAP_HOURS old (default 6). Prints the slug or nothing."""
import glob, json, os, sys, time, calendar
GAP = float(os.environ.get("IG_GAP_HOURS", "6")) * 3600
def ts(s): return calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ"))
last = max([ts(json.load(open(p))["published_at"]) for p in glob.glob("promo/ig/*/published.json")] or [0])
if time.time() - last < GAP: sys.exit(0)
queue = sorted((os.path.getmtime(a), os.path.basename(os.path.dirname(a))) for a in glob.glob("promo/ig/*/approved")
               if not os.path.exists(os.path.join(os.path.dirname(a), "published.json")))
# mtime is checkout time in CI, so order by the commit that added 'approved'
import subprocess
def added(slug):
    out = subprocess.run(["git", "log", "--diff-filter=A", "--format=%ct", "-1", "--", f"promo/ig/{slug}/approved"], capture_output=True, text=True).stdout.strip()
    return int(out or 0)
queue = sorted((added(s), s) for _, s in queue)
if queue: print(queue[0][1])
