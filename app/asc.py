#!/usr/bin/env python3
"""App Store Connect for Hutka, from the command line, with an App Store Connect API key — no PyPI packages (JWT signed with the
system's openssl). The key never leaves the machine: it is read from ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 (where
altool looks too) or from ASC_KEY_PATH.

  export ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-xxxx-...        # from App Store Connect → Users and Access → Integrations → API
  python3 asc.py whoami                      the team's apps and whether the key works
  python3 asc.py bundle                      registers ai.hutka.app (with Push Notifications) if it is not there yet; prints the Team ID (seedId)
  python3 asc.py metadata                    app info, age rating, version 1.4, the English texts, the review details (listing.json)
  python3 asc.py screenshots DIR             uploads DIR/iphone67/*.png (1290x2796) and DIR/ipad129/*.png (2048x2732) to version 1.4
  python3 asc.py build [--wait]              the newest build of 1.4: its state; --wait until Apple has processed it; attaches it to the version
  python3 asc.py submit                      sends version 1.4 to App Review
  python3 asc.py status                      where the version stands

The app record itself (My Apps → + → New App) cannot be made through the API: Apple keeps that in the website. Everything after it can."""
import base64, hashlib, json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error, urllib.parse

API = 'https://api.appstoreconnect.apple.com'
BUNDLE = 'ai.hutka.app'; VERSION = os.environ.get('HUTKA_VERSION', '1.4'); LOCALE = 'en-US'
HERE = os.path.dirname(os.path.abspath(__file__))

# ---- the token: ES256 JWT, signed by openssl (DER → raw r||s)
def b64u(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def key_path():
    kid = os.environ.get('ASC_KEY_ID') or sys.exit('ASC_KEY_ID is not set')
    p = os.environ.get('ASC_KEY_PATH') or os.path.expanduser(f'~/.appstoreconnect/private_keys/AuthKey_{kid}.p8')
    if not os.path.exists(p): sys.exit(f'the key file is not at {p} — put the .p8 from App Store Connect there')
    return p
_tok = {'t': 0, 'v': ''}
def token():
    if time.time() - _tok['t'] < 15 * 60: return _tok['v']
    kid = os.environ['ASC_KEY_ID']; iss = os.environ.get('ASC_ISSUER_ID') or sys.exit('ASC_ISSUER_ID is not set')
    now = int(time.time()); head = b64u(json.dumps({'alg': 'ES256', 'kid': kid, 'typ': 'JWT'}).encode()); body = b64u(json.dumps({'iss': iss, 'iat': now, 'exp': now + 19 * 60, 'aud': 'appstoreconnect-v1'}).encode())
    msg = f'{head}.{body}'.encode()
    with tempfile.NamedTemporaryFile(delete=False) as f: f.write(msg); mp = f.name
    der = subprocess.check_output(['openssl', 'dgst', '-sha256', '-sign', key_path(), mp]); os.unlink(mp)
    # DER SEQUENCE { INTEGER r, INTEGER s } → 32-byte r || 32-byte s
    i = 2 if der[1] < 0x80 else 3; assert der[i] == 2; lr = der[i + 1]; r = der[i + 2:i + 2 + lr]; j = i + 2 + lr; assert der[j] == 2; ls = der[j + 1]; s = der[j + 2:j + 2 + ls]
    r = r.lstrip(b'\0').rjust(32, b'\0'); s = s.lstrip(b'\0').rjust(32, b'\0')
    _tok.update({'t': time.time(), 'v': f'{head}.{body}.{b64u(r + s)}'}); return _tok['v']

def api(method, path, body=None, raw=False):
    url = path if path.startswith('http') else API + path
    req = urllib.request.Request(url, method=method, headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json', 'Accept': 'application/json'}, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r: t = r.read(); return json.loads(t) if t and not raw else t
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors='replace'); sys.exit(f'{method} {path} → {e.code}: {msg[:1200]}')
def get_all(path):
    out = []; url = path
    while url:
        d = api('GET', url); out += d.get('data', []); url = (d.get('links') or {}).get('next')
    return out
def rel(t, i): return {'data': {'type': t, 'id': i}}

# ---- the app, the version
def app():
    d = api('GET', f'/v1/apps?filter[bundleId]={BUNDLE}&limit=1').get('data') or []
    if not d: sys.exit(f'no app with bundle id {BUNDLE} in App Store Connect yet — make it on the website: My Apps → + → New App (iOS, Hutka, English (U.S.), {BUNDLE}, SKU hutka), then run again')
    return d[0]
def version(create=True):
    a = app(); vs = api('GET', f"/v1/apps/{a['id']}/appStoreVersions?filter[platform]=IOS&filter[versionString]={VERSION}&limit=1").get('data') or []
    if vs: return a, vs[0]
    if not create: return a, None
    # App Store Connect makes a first version (1.0) together with the app record; a second one cannot be added while it is unreleased — rename it instead
    allv = api('GET', f"/v1/apps/{a['id']}/appStoreVersions?filter[platform]=IOS&limit=10").get('data') or []
    ed = [x for x in allv if (x['attributes'].get('appStoreState') or x['attributes'].get('appVersionState')) in ('PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY')]
    if ed:
        v = api('PATCH', f"/v1/appStoreVersions/{ed[0]['id']}", {'data': {'type': 'appStoreVersions', 'id': ed[0]['id'], 'attributes': {'versionString': VERSION}}})['data']
        print('version', ed[0]['attributes'].get('versionString'), 'renamed to', VERSION); return a, v
    v = api('POST', '/v1/appStoreVersions', {'data': {'type': 'appStoreVersions', 'attributes': {'platform': 'IOS', 'versionString': VERSION, 'releaseType': 'AFTER_APPROVAL'}, 'relationships': {'app': rel('apps', a['id'])}}})['data']
    print('version', VERSION, 'created'); return a, v

def cmd_whoami():
    apps = get_all('/v1/apps?limit=50'); print('the key works;', len(apps), 'apps:')
    for a in apps: print(' ', a['id'], a['attributes']['bundleId'], '·', a['attributes']['name'], '· sku', a['attributes'].get('sku'))

def cmd_bundle():
    d = api('GET', f'/v1/bundleIds?filter[identifier]={BUNDLE}&limit=1').get('data') or []
    if d: b = d[0]; print('bundle id registered:', b['attributes']['identifier'], 'team (seedId):', b['attributes'].get('seedId'))
    else:
        b = api('POST', '/v1/bundleIds', {'data': {'type': 'bundleIds', 'attributes': {'identifier': BUNDLE, 'name': 'Hutka', 'platform': 'IOS'}}})['data']; print('bundle id registered now:', BUNDLE, 'team (seedId):', b['attributes'].get('seedId'))
    caps = api('GET', f"/v1/bundleIds/{b['id']}/bundleIdCapabilities").get('data') or []
    have = {c['attributes']['capabilityType'] for c in caps}
    if 'PUSH_NOTIFICATIONS' not in have:
        api('POST', '/v1/bundleIdCapabilities', {'data': {'type': 'bundleIdCapabilities', 'attributes': {'capabilityType': 'PUSH_NOTIFICATIONS'}, 'relationships': {'bundleId': rel('bundleIds', b['id'])}}}); print('Push Notifications enabled on the App ID')
    else: print('Push Notifications already on')
    print('TEAM_ID=' + str(b['attributes'].get('seedId')))

def cmd_metadata():
    L = json.load(open(os.path.join(HERE, 'listing.json'), encoding='utf-8'))
    a, v = version()
    # the app: content rights
    api('PATCH', f"/v1/apps/{a['id']}", {'data': {'type': 'apps', 'id': a['id'], 'attributes': {'contentRightsDeclaration': 'DOES_NOT_USE_THIRD_PARTY_CONTENT'}}})
    # app info: categories, the English name/subtitle/privacy policy
    infos = api('GET', f"/v1/apps/{a['id']}/appInfos").get('data') or []
    info = next((i for i in infos if i['attributes'].get('appStoreState') not in ('READY_FOR_SALE', 'REPLACED_WITH_NEW_INFO')), infos[0])
    api('PATCH', f"/v1/appInfos/{info['id']}", {'data': {'type': 'appInfos', 'id': info['id'], 'relationships': {'primaryCategory': rel('appCategories', 'SPORTS'), 'secondaryCategory': rel('appCategories', 'UTILITIES')}}})
    locs = api('GET', f"/v1/appInfos/{info['id']}/appInfoLocalizations").get('data') or []
    loc = next((l for l in locs if l['attributes']['locale'] == LOCALE), None)
    attrs = {'name': L['name'], 'subtitle': L['subtitle'], 'privacyPolicyUrl': L['privacyPolicyUrl']}
    if loc: api('PATCH', f"/v1/appInfoLocalizations/{loc['id']}", {'data': {'type': 'appInfoLocalizations', 'id': loc['id'], 'attributes': attrs}})
    else: api('POST', '/v1/appInfoLocalizations', {'data': {'type': 'appInfoLocalizations', 'attributes': dict(attrs, locale=LOCALE), 'relationships': {'appInfo': rel('appInfos', info['id'])}}})
    # age rating: nothing in it → 4+
    ar = api('GET', f"/v1/appInfos/{info['id']}/ageRatingDeclaration")['data']
    api('PATCH', f"/v1/ageRatingDeclarations/{ar['id']}", {'data': {'type': 'ageRatingDeclarations', 'id': ar['id'], 'attributes': {'alcoholTobaccoOrDrugUseOrReferences': 'NONE', 'contests': 'NONE', 'gamblingSimulated': 'NONE', 'horrorOrFearThemes': 'NONE', 'matureOrSuggestiveThemes': 'NONE', 'medicalOrTreatmentInformation': 'NONE', 'profanityOrCrudeHumor': 'NONE', 'sexualContentGraphicAndNudity': 'NONE', 'sexualContentOrNudity': 'NONE', 'violenceCartoonOrFantasy': 'NONE', 'violenceRealistic': 'NONE', 'violenceRealisticProlongedGraphicOrSadistic': 'NONE', 'gunsOrOtherWeapons': 'NONE', 'gambling': False, 'unrestrictedWebAccess': False, 'kidsAgeBand': None, 'lootBox': False, 'advertising': False, 'healthOrWellnessTopics': False, 'parentalControls': False, 'ageAssurance': False, 'messagingAndChat': False, 'userGeneratedContent': True, 'socialMedia': True, 'socialMediaAgeRestricted': False}}})
    print('app info: Sports / Utilities, name, subtitle, privacy policy, age rating 4+')
    # the version's English texts
    vl = api('GET', f"/v1/appStoreVersions/{v['id']}/appStoreVersionLocalizations").get('data') or []
    loc = next((l for l in vl if l['attributes']['locale'] == LOCALE), None)
    attrs = {'description': L['description'], 'keywords': L['keywords'], 'supportUrl': L['supportUrl'], 'marketingUrl': L['marketingUrl'], 'promotionalText': L['promotionalText'], 'whatsNew': L['whatsNew']}
    # the first version of an app has no "What's New" — Apple refuses the attribute, so it goes in from the second version on
    rel_before = [x for x in (api('GET', f"/v1/apps/{a['id']}/appStoreVersions?filter[platform]=IOS&limit=20").get('data') or []) if x['id'] != v['id'] and (x['attributes'].get('appStoreState') or x['attributes'].get('appVersionState')) in ('READY_FOR_SALE', 'READY_FOR_DISTRIBUTION', 'REPLACED_WITH_NEW_VERSION', 'PROCESSING_FOR_APP_STORE', 'PENDING_DEVELOPER_RELEASE')]
    if not rel_before: attrs.pop('whatsNew'); print('first release: no What\'s New')
    if loc: api('PATCH', f"/v1/appStoreVersionLocalizations/{loc['id']}", {'data': {'type': 'appStoreVersionLocalizations', 'id': loc['id'], 'attributes': attrs}})
    else: api('POST', '/v1/appStoreVersionLocalizations', {'data': {'type': 'appStoreVersionLocalizations', 'attributes': dict(attrs, locale=LOCALE), 'relationships': {'appStoreVersion': rel('appStoreVersions', v['id'])}}})
    api('PATCH', f"/v1/appStoreVersions/{v['id']}", {'data': {'type': 'appStoreVersions', 'id': v['id'], 'attributes': {'copyright': L.get('copyright', '2026 Kozyra Media Group')}}})
    print('version texts: description, keywords, urls, what\'s new, copyright')
    # the review details: contact, demo account, notes
    R = L['review']; pw = os.environ.get('HUTKA_REVIEW_PASSWORD') or sys.exit('HUTKA_REVIEW_PASSWORD (the demo account\'s password) is not set')
    rd = api('GET', f"/v1/appStoreVersions/{v['id']}/appStoreReviewDetail").get('data')
    # the contact and the demo account come from the environment, never from the repository (it is public)
    need = lambda k: os.environ.get(k) or sys.exit(f'{k} is not set')
    attrs = {'contactFirstName': R['firstName'], 'contactLastName': R['lastName'], 'contactPhone': need('HUTKA_REVIEW_PHONE'), 'contactEmail': need('HUTKA_REVIEW_EMAIL'), 'demoAccountName': need('HUTKA_REVIEW_ACCOUNT'), 'demoAccountPassword': pw, 'demoAccountRequired': True, 'notes': R['notes']}
    if rd: api('PATCH', f"/v1/appStoreReviewDetails/{rd['id']}", {'data': {'type': 'appStoreReviewDetails', 'id': rd['id'], 'attributes': attrs}})
    else: api('POST', '/v1/appStoreReviewDetails', {'data': {'type': 'appStoreReviewDetails', 'attributes': attrs, 'relationships': {'appStoreVersion': rel('appStoreVersions', v['id'])}}})
    print('review details: contact, demo account, notes')

SETS = {'iphone67': 'APP_IPHONE_67', 'ipad129': 'APP_IPAD_PRO_3GEN_129'}
def cmd_screenshots(d):
    a, v = version(); vl = api('GET', f"/v1/appStoreVersions/{v['id']}/appStoreVersionLocalizations").get('data') or []
    loc = next((l for l in vl if l['attributes']['locale'] == LOCALE), None) or sys.exit('run metadata first (the English localization)')
    sets = api('GET', f"/v1/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets").get('data') or []
    for sub, kind in SETS.items():
        folder = os.path.join(d, sub); files = sorted(f for f in os.listdir(folder) if f.lower().endswith('.png')) if os.path.isdir(folder) else []
        if not files: print(sub, 'no files'); continue
        st = next((s for s in sets if s['attributes']['screenshotDisplayType'] == kind), None)
        if not st: st = api('POST', '/v1/appScreenshotSets', {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': kind}, 'relationships': {'appStoreVersionLocalization': rel('appStoreVersionLocalizations', loc['id'])}}})['data']
        have = api('GET', f"/v1/appScreenshotSets/{st['id']}/appScreenshots").get('data') or []
        for s in have: api('DELETE', f"/v1/appScreenshots/{s['id']}")   # the set is replaced whole, in our order
        for f in files:
            p = os.path.join(folder, f); data = open(p, 'rb').read()
            sc = api('POST', '/v1/appScreenshots', {'data': {'type': 'appScreenshots', 'attributes': {'fileName': f, 'fileSize': len(data)}, 'relationships': {'appScreenshotSet': rel('appScreenshotSets', st['id'])}}})['data']
            for op in sc['attributes']['uploadOperations']:
                chunk = data[op['offset']:op['offset'] + op['length']]
                req = urllib.request.Request(op['url'], method=op['method'], data=chunk, headers={h['name']: h['value'] for h in op['requestHeaders']})
                with urllib.request.urlopen(req, timeout=300) as r: r.read()
            api('PATCH', f"/v1/appScreenshots/{sc['id']}", {'data': {'type': 'appScreenshots', 'id': sc['id'], 'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
            print(sub, f, 'uploaded')
    print('screenshots done')

def cmd_build(wait=False):
    a, v = version()
    while True:
        bs = api('GET', f"/v1/builds?filter[app]={a['id']}&filter[preReleaseVersion.version]={VERSION}&sort=-uploadedDate&limit=5").get('data') or []
        if bs:
            b = bs[0]; st = b['attributes']['processingState']; print('build', b['attributes']['version'], st, b['attributes'].get('uploadedDate'))
            if st == 'VALID':
                if b['attributes'].get('usesNonExemptEncryption') is None: api('PATCH', f"/v1/builds/{b['id']}", {'data': {'type': 'builds', 'id': b['id'], 'attributes': {'usesNonExemptEncryption': False}}})
                api('PATCH', f"/v1/appStoreVersions/{v['id']}/relationships/build", rel('builds', b['id'])); print('attached to version', VERSION); return
            if st in ('FAILED', 'INVALID'): sys.exit('the build failed processing — look at the e-mail from App Store Connect')
        else: print('no build of', VERSION, 'uploaded yet')
        if not wait: return
        time.sleep(60)

def cmd_submit():
    a, v = version(create=False) ; v or sys.exit('no version')
    subs = api('GET', f"/v1/reviewSubmissions?filter[app]={a['id']}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW&limit=5").get('data') or []
    sub = subs[0] if subs else api('POST', '/v1/reviewSubmissions', {'data': {'type': 'reviewSubmissions', 'attributes': {'platform': 'IOS'}, 'relationships': {'app': rel('apps', a['id'])}}})['data']
    items = api('GET', f"/v1/reviewSubmissions/{sub['id']}/items").get('data') or []
    if not items: api('POST', '/v1/reviewSubmissionItems', {'data': {'type': 'reviewSubmissionItems', 'relationships': {'reviewSubmission': rel('reviewSubmissions', sub['id']), 'appStoreVersion': rel('appStoreVersions', v['id'])}}})
    # screenshots are post-processed for a few minutes after the upload; the submission is refused until they are done — wait and retry
    for attempt in range(20):
        try:
            api('PATCH', f"/v1/reviewSubmissions/{sub['id']}", {'data': {'type': 'reviewSubmissions', 'id': sub['id'], 'attributes': {'submitted': True}}}); break
        except SystemExit as e:
            if 'ASSET_IN_POST_PROCESSING' in str(e) and attempt < 19: print('assets still processing — waiting a minute'); time.sleep(60)
            else: raise
    print('submitted for review:', VERSION)

def cmd_status():
    a, v = version(create=False)
    print(a['attributes']['name'], a['attributes']['bundleId']); print('version', VERSION, '→', v['attributes'].get('appStoreState') or v['attributes'].get('appVersionState') if v else 'not created')
    if v:
        b = api('GET', f"/v1/appStoreVersions/{v['id']}/build").get('data'); print('build attached:', b['attributes']['version'] if b else 'none')
    for s in api('GET', f"/v1/reviewSubmissions?filter[app]={a['id']}&limit=3").get('data') or []: print('submission', s['attributes']['state'], s['attributes'].get('submittedDate'))

if __name__ == '__main__':
    c = sys.argv[1] if len(sys.argv) > 1 else 'help'
    if c == 'whoami': cmd_whoami()
    elif c == 'bundle': cmd_bundle()
    elif c == 'metadata': cmd_metadata()
    elif c == 'screenshots': cmd_screenshots(sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'store', 'appstore'))
    elif c == 'build': cmd_build('--wait' in sys.argv)
    elif c == 'submit': cmd_submit()
    elif c == 'status': cmd_status()
    else: print(__doc__)
