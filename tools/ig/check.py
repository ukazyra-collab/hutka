"""Token check without publishing: writes promo/ig/_check/result.json (no secrets)."""
import json, os, time, urllib.request, urllib.parse, urllib.error
T = os.environ.get("IG_TOKEN", ""); UID = os.environ.get("IG_USER_ID", "17841480760751955")
def get(path, **p):
    p["access_token"] = T
    try:
        with urllib.request.urlopen("https://graph.facebook.com/" + path + "?" + urllib.parse.urlencode(p), timeout=30) as r: return json.load(r)
    except urllib.error.HTTPError as e: return {"error": e.read().decode()[:400]}
out = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "token_set": bool(T), "token_len": len(T)}
if T:
    out["me"] = get("me", fields="id,name")
    out["hutkaai"] = get(UID, fields="username,followers_count,media_count")
    out["publish_limit"] = get(f"{UID}/content_publishing_limit", fields="quota_usage,config")
os.makedirs("promo/ig/_check", exist_ok=True)
json.dump(out, open("promo/ig/_check/result.json", "w"), indent=1); print(json.dumps(out, indent=1))
