"""Publish an approved carousel from promo/ig/<slug>/ to Instagram (@hutkaai).

Images must already be live at https://hutka.ai/promo/ig/<slug>/NN.jpg (GitHub Pages).
Env: IG_TOKEN (Instagram API with Instagram Login, long-lived, scope instagram_business_content_publish).
Writes promo/ig/<slug>/published.json; a slug that already has it is skipped.
"""
import json, os, sys, time, glob, urllib.request, urllib.parse, urllib.error

API = "https://graph.instagram.com/" + (os.environ.get("IG_API_VERSION", "").strip("/") + "/" if os.environ.get("IG_API_VERSION") else "")
SITE = os.environ.get("IG_SITE", "https://hutka.ai")
TOKEN = os.environ.get("IG_TOKEN", "")

def call(method, path, **params):
    params["access_token"] = TOKEN
    data = urllib.parse.urlencode(params).encode()
    url = API + path
    req = urllib.request.Request(url + ("?" + data.decode() if method == "GET" else ""), data=None if method == "GET" else data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path}: {e.code} {e.read().decode()[:500]}")

def wait_ready(cid, what):
    for _ in range(60):
        st = call("GET", cid, fields="status_code").get("status_code")
        if st == "FINISHED": return
        if st in ("ERROR", "EXPIRED"): sys.exit(f"{what} container {cid}: {st}")
        time.sleep(5)
    sys.exit(f"{what} container {cid}: timeout")

def wait_live(url):
    for _ in range(60):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=20) as r:
                if r.status == 200: return
        except Exception: pass
        time.sleep(10)
    sys.exit(f"not live: {url}")

def publish(slug):
    d = f"promo/ig/{slug}"
    if os.path.exists(f"{d}/published.json"):
        print(f"{slug}: already published, skip"); return
    imgs = sorted(os.path.basename(p) for p in glob.glob(f"{d}/[0-9][0-9].jpg"))
    if not 2 <= len(imgs) <= 10: sys.exit(f"{slug}: need 2–10 slides, found {len(imgs)}")
    caption = open(f"{d}/caption.txt", encoding="utf-8").read().strip()
    urls = [f"{SITE}/{d}/{n}" for n in imgs]
    for u in urls: wait_live(u)
    me = call("GET", "me", fields="user_id,username")
    uid = me.get("user_id") or me.get("id")
    kids = []
    for u in urls:
        cid = call("POST", f"{uid}/media", image_url=u, is_carousel_item="true")["id"]
        wait_ready(cid, u); kids.append(cid)
    car = call("POST", f"{uid}/media", media_type="CAROUSEL", children=",".join(kids), caption=caption)["id"]
    wait_ready(car, "carousel")
    mid = call("POST", f"{uid}/media_publish", creation_id=car)["id"]
    link = call("GET", mid, fields="permalink").get("permalink", "")
    json.dump({"media_id": mid, "permalink": link, "account": me.get("username"), "slides": len(urls),
               "published_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, open(f"{d}/published.json", "w"), indent=1)
    print(f"{slug}: published {link}")

if __name__ == "__main__":
    if not TOKEN: sys.exit("IG_TOKEN secret is not set")
    for s in sys.argv[1:]: publish(s)
