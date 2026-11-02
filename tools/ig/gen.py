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
    model = os.environ.get("IMG_MODEL", "gpt-image-2")
    h = {"Authorization": f"Bearer {OA}"}
    f = {"model": model, "prompt": j["prompt"], "size": j.get("size", "1024x1536"), "quality": j.get("quality", "high"), "n": "1"}
    if j.get("background"): f["background"] = j["background"]
    if j.get("ref"):
        body, ct = multipart(f, [("image[]", r) for r in ([j["ref"]] if isinstance(j["ref"], str) else j["ref"])])
        r = post("https://api.openai.com/v1/images/edits", body, h, ct)
    else:
        r = post("https://api.openai.com/v1/images/generations", json.dumps({**f, "n": 1}).encode(), h)
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

def sat_ref(sat, path):
    """Satellite crop (Esri World Imagery) centred on lat/lon → PNG used as the generator's reference."""
    import math, io
    from PIL import Image
    lat, lon, z, px = sat["lat"], sat["lon"], sat.get("zoom", 19), sat.get("px", 1024)
    n = 2**z; fx = (lon + 180)/360*n; fy = (1 - math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
    half = px/2/256; x0, x1 = int(fx - half), int(fx + half); y0, y1 = int(fy - half), int(fy + half)
    W = Image.new("RGB", ((x1 - x0 + 1)*256, (y1 - y0 + 1)*256))
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{ty}/{tx}"
            req = urllib.request.Request(url, headers={"User-Agent": "hutka-ig/1.0"})
            W.paste(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert("RGB"), ((tx - x0)*256, (ty - y0)*256))
    import statistics
    if statistics.pstdev(list(W.convert("L").resize((64, 64)).getdata())) < 6:      # "Map data not yet available" tiles → one zoom out
        if z <= 17: raise RuntimeError("no imagery")
        return sat_ref({**sat, "zoom": z - 1, "px": max(128, px//2)}, path)
    cx, cy = (fx - x0)*256, (fy - y0)*256
    W.crop((int(cx - px/2), int(cy - px/2), int(cx + px/2), int(cy + px/2))).resize((1024, 1024)).save(path)

for j in jobs:
    if j.get("sat"):
        ref = f"{OUT}/{j['id']}.sat.png"
        if not os.path.exists(ref):
            try: sat_ref(j["sat"], ref)
            except Exception as e:
                open(f"{OUT}/{j['id']}.error.txt", "w").write(f"satellite: {e}"); continue
        j["ref"] = ref
    png = f"{OUT}/{j['id']}.png"
    if os.path.exists(png) and not j.get("force"): print("skip", j["id"]); continue
    try:
        img, model = (openai if OA else gemini)(j)
    except SystemExit as e:
        msg = str(e)
        if OA:
            try:
                req = urllib.request.Request("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {OA}"})
                ms = [m["id"] for m in json.load(urllib.request.urlopen(req, timeout=60))["data"]]
                msg += "\nimage models: " + ", ".join(sorted(m for m in ms if "image" in m or "dall" in m))
            except Exception as e2: msg += f"\nmodels list failed: {e2}"
        open(f"{OUT}/{j['id']}.error.txt", "w").write(msg); print("error", j["id"], msg); continue
    open(png, "wb").write(img)
    if os.path.exists(f"{OUT}/{j['id']}.error.txt"): os.remove(f"{OUT}/{j['id']}.error.txt")
    json.dump({"prompt": j["prompt"], "model": model, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, open(f"{OUT}/{j['id']}.json", "w"), indent=1)
    print("ok", j["id"], len(img))
