"""Image generation job for the IG carousels (runs in GitHub Actions: the API is not reachable from the build box).

Reads promo/ig/_gen/jobs.json: [{"id": "...", "prompt": "...", "size": "1024x1536", "quality": "high", "ref": "optional/path.png"}]
Writes promo/ig/_gen/out/<id>.png and promo/ig/_gen/out/<id>.json (prompt, model, time); skips ids already generated.
Env: OPENAI_API_KEY (preferred) or GEMINI_API_KEY; IMG_MODEL to override the model.
"""
import base64, json, os, sys, time, urllib.request, urllib.error, mimetypes, uuid
ROOT = "promo/ig/_gen"; OUT = f"{ROOT}/out"; os.makedirs(OUT, exist_ok=True)
jobs = json.load(open(f"{ROOT}/jobs.json"))
OA, GE = os.environ.get("OPENAI_API_KEY", ""), os.environ.get("GEMINI_API_KEY", "")
if not (OA or GE):
    open(f"{OUT}/_error.txt", "w").write("no OPENAI_API_KEY / GEMINI_API_KEY secret"); sys.exit(0)

def post(url, body, headers, ctype="application/json"):
    req = urllib.request.Request(url, data=body, headers={**headers, "Content-Type": ctype}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=300) as r: return json.load(r)
    except urllib.error.HTTPError as e: raise SystemExit(f"{url}: {e.code} {e.read().decode()[:800]}")

def multipart(fields, files):
    b = uuid.uuid4().hex; out = b""
    for k, v in fields.items():
        out += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for k, p in files:
        out += (f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{os.path.basename(p)}\"\r\n"
                f"Content-Type: {mimetypes.guess_type(p)[0] or 'image/png'}\r\n\r\n").encode() + open(p, "rb").read() + b"\r\n"
    return out + f"--{b}--\r\n".encode(), f"multipart/form-data; boundary={b}"

def openai(j):
    model = os.environ.get("IMG_MODEL", "gpt-image-1")
    h = {"Authorization": f"Bearer {OA}"}
    f = {"model": model, "prompt": j["prompt"], "size": j.get("size", "1024x1536"), "quality": j.get("quality", "high"), "n": "1"}
    if j.get("ref"):
        body, ct = multipart(f, [("image[]", r) for r in ([j["ref"]] if isinstance(j["ref"], str) else j["ref"])])
        r = post("https://api.openai.com/v1/images/edits", body, h, ct)
    else:
        r = post("https://api.openai.com/v1/images/generations", json.dumps(f).encode(), h)
    return base64.b64decode(r["data"][0]["b64_json"]), model

def gemini(j):
    model = os.environ.get("IMG_MODEL", "gemini-2.5-flash-image")
    parts = [{"text": j["prompt"]}]
    for r in ([j["ref"]] if isinstance(j.get("ref"), str) else j.get("ref", [])):
        parts.append({"inline_data": {"mime_type": "image/png", "data": base64.b64encode(open(r, "rb").read()).decode()}})
    r = post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GE}",
             json.dumps({"contents": [{"parts": parts}]}).encode(), {})
    for p in r["candidates"][0]["content"]["parts"]:
        if "inlineData" in p: return base64.b64decode(p["inlineData"]["data"]), model
    raise SystemExit(f"gemini returned no image: {json.dumps(r)[:500]}")

for j in jobs:
    png = f"{OUT}/{j['id']}.png"
    if os.path.exists(png) and not j.get("force"): print("skip", j["id"]); continue
    try:
        img, model = (openai if OA else gemini)(j)
    except SystemExit as e:
        open(f"{OUT}/{j['id']}.error.txt", "w").write(str(e)); print("error", j["id"], e); continue
    open(png, "wb").write(img)
    json.dump({"prompt": j["prompt"], "model": model, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, open(f"{OUT}/{j['id']}.json", "w"), indent=1)
    print("ok", j["id"], len(img))
