// Hutka — sign-in methods on one account (v34.62).
// 1. "Continue with Apple" with Hide My Email gives Apple's alias (…@privaterelay.appleid.com), so a driver who already has a
//    Google / e-mail account lands in a second, empty one. On the "Welcome to Hutka" step such an account gets a notice:
//    Connect with Google / Connect with e-mail → signs in to the real account → the merge-apple function moves the Apple
//    identity onto it and removes the empty account. From then on Apple opens the real account.
// 2. Profile → Settings → "Sign-in methods": Google ✓ · Apple ✓, with Connect for the one that is missing (Supabase manual linking).
// Standalone: talks to the app through window.__hutka (STORE.adapter.sb, signInGoogle/signInEmail/verifyEmailCode, STORE.reload).
(() => {
  const RELAY = /@privaterelay\.appleid\.com$/i, PENDING = 'hutka.appleMerge', HOUR = 3600 * 1000;
  const $ = (id) => document.getElementById(id);
  const ru = () => (localStorage.getItem('hutka.lang') || '').toLowerCase() === 'ru';
  const T = {
    'Signed in with Apple, e-mail hidden': 'Вход через Apple со скрытой почтой',
    'Apple gave Hutka an alias (@privaterelay.appleid.com), so this is a new, empty account. Already on Hutka with Google or e-mail? Connect that account — from now on Apple will open it.': 'Apple передала Hutka подставной адрес (@privaterelay.appleid.com), поэтому это новый пустой аккаунт. Уже есть аккаунт Hutka через Google или почту? Подключи его — дальше Apple будет открывать именно его.',
    'Connect with Google': 'Подключить через Google', 'Connect with e-mail': 'Подключить через почту', 'New to Hutka? Just fill in the profile below.': 'Впервые в Hutka? Просто заполни профиль ниже.',
    'Your e-mail': 'Твоя почта', 'Send code': 'Отправить код', '6-digit code from the e-mail': 'Код из письма (6 цифр)', 'Sign in': 'Войти', 'Sending…': 'Отправляю…', 'Checking…': 'Проверяю…',
    'Apple sign-in is now connected to your account': 'Вход через Apple подключён к твоему аккаунту', 'Could not connect the Apple sign-in: {e}': 'Не удалось подключить вход через Apple: {e}',
    'Sign-in methods': 'Способы входа', 'Connect Apple': 'Подключить Apple', 'Connect Google': 'Подключить Google', 'E-mail': 'Почта',
    'This Apple ID is already attached to another Hutka account. Sign in with Apple and use "Connect with Google / e-mail" there.': 'Этот Apple ID уже привязан к другому аккаунту Hutka. Войди через Apple и там нажми «Подключить через Google / почту».',
    'This Google account is already attached to another Hutka account.': 'Этот Google-аккаунт уже привязан к другому аккаунту Hutka.',
  };
  const t = (s, v) => { let r = ru() && T[s] ? T[s] : s; if (v) for (const k in v) r = r.replace('{' + k + '}', v[k]); return r; };
  const toast = (msg) => { const e = $('toast'); if (!e) return alert(msg); e.textContent = msg; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { e.hidden = true; }, 4500); };
  const H = () => window.__hutka, sb = () => (H() && H().STORE && H().STORE.adapter && H().STORE.adapter.sb) || null;
  const cfg = window.HUTKA_CONFIG || {};
  const native = () => window.NATIVE && window.NATIVE.on;

  async function me() { const c = sb(); if (!c) return null; const { data: { session } } = await c.auth.getSession(); return session && session.user ? { session, user: session.user } : null; }
  const providers = (u) => (u.identities || []).map((i) => i.provider);
  const isRelayApple = (u) => RELAY.test(u.email || '') && providers(u).length === 1 && providers(u)[0] === 'apple';

  // ---- the pending merge: the empty Apple account's token, kept while the driver signs in to the real one
  const pending = () => { try { const p = JSON.parse(localStorage.getItem(PENDING) || 'null'); return p && Date.now() - p.t < HOUR ? p : null; } catch { return null; } };
  const remember = (session) => localStorage.setItem(PENDING, JSON.stringify({ from: session.user.id, token: session.access_token, t: Date.now() }));
  let merging = false;
  async function tryMerge() {
    const p = pending(); if (!p || merging) return;
    const m = await me(); if (!m || m.user.id === p.from) return;   // not signed in to another account yet
    if (providers(m.user).includes('apple')) { localStorage.removeItem(PENDING); return; }
    merging = true;
    try {
      const r = await fetch(cfg.supabaseUrl + '/functions/v1/merge-apple', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + m.session.access_token, 'apikey': cfg.supabaseAnonKey }, body: JSON.stringify({ appleToken: p.token }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { localStorage.removeItem(PENDING); toast(t('Apple sign-in is now connected to your account')); setTimeout(() => { try { H().STORE.reload(); } catch {} }, 800); }
      else { localStorage.removeItem(PENDING); if (j.error !== 'source_token_invalid') toast(t('Could not connect the Apple sign-in: {e}', { e: j.detail || j.error || r.status })); }
    } catch (e) { toast(t('Could not connect the Apple sign-in: {e}', { e: e && e.message || e })); }
    finally { merging = false; }
  }

  // ---- the notice on the welcome step
  async function onboardingNotice() {
    const modal = $('onbModal'); if (!modal || modal.hidden || $('alNotice')) return;
    const m = await me(); if (!m || !isRelayApple(m.user)) return;
    const box = modal.querySelector('.box') || modal; const head = box.querySelector('h1,h2,.title') || box.firstElementChild;
    const n = document.createElement('div'); n.id = 'alNotice'; n.style.cssText = 'background:#fff7e6;border:1px solid #f1d9a7;border-radius:12px;padding:12px 14px;margin:0 0 14px';
    n.innerHTML = '<div style="font-weight:600;margin-bottom:4px"></div><div class="hint" style="margin-bottom:10px"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="alGoogle" type="button"></button><button class="btn" id="alEmail" type="button"></button></div>' +
      '<div id="alEmailBox" hidden style="margin-top:10px"><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="alEmailIn" type="email" autocomplete="email" style="flex:1;min-width:180px"><button class="btn sm primary" id="alSend" type="button"></button></div>' +
      '<div id="alCodeRow" hidden style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><input id="alCode" inputmode="numeric" maxlength="6" style="flex:1;min-width:140px"><button class="btn sm primary" id="alVerify" type="button"></button></div></div>' +
      '<div class="hint" style="margin-top:8px"></div><span class="status" id="alStatus"></span>';
    const d = n.querySelectorAll('div'); d[0].textContent = t('Signed in with Apple, e-mail hidden'); d[1].textContent = t('Apple gave Hutka an alias (@privaterelay.appleid.com), so this is a new, empty account. Already on Hutka with Google or e-mail? Connect that account — from now on Apple will open it.');
    n.querySelector('#alGoogle').textContent = t('Connect with Google'); n.querySelector('#alEmail').textContent = t('Connect with e-mail'); n.querySelector('#alSend').textContent = t('Send code'); n.querySelector('#alVerify').textContent = t('Sign in');
    n.querySelector('#alEmailIn').placeholder = t('Your e-mail'); n.querySelector('#alCode').placeholder = t('6-digit code from the e-mail'); d[d.length - 1].textContent = t('New to Hutka? Just fill in the profile below.');
    if (head && head.nextSibling) box.insertBefore(n, head.nextSibling); else box.prepend(n);
    const status = (s) => { $('alStatus').textContent = s; };
    $('alGoogle').onclick = async () => { try { remember(m.session); await H().STORE.adapter.signInGoogle(); } catch (e) { status(String(e && e.message || e)); } };
    $('alEmail').onclick = () => { $('alEmailBox').hidden = false; $('alEmailIn').focus(); };
    $('alSend').onclick = async () => { const email = $('alEmailIn').value.trim(); if (!email) return; status(t('Sending…')); try { remember(m.session); await H().STORE.adapter.signInEmail(email); $('alCodeRow').hidden = false; status(''); $('alCode').focus(); } catch (e) { status(String(e && e.message || e)); } };
    $('alVerify').onclick = async () => { const email = $('alEmailIn').value.trim(), code = $('alCode').value.trim(); if (!email || code.length < 6) return; status(t('Checking…')); try { await H().STORE.adapter.verifyEmailCode(email, code); status(''); await tryMerge(); } catch (e) { status(String(e && e.message || e)); } };
  }

  // ---- Profile → Settings → Sign-in methods
  async function profileRow() {
    const pg = $('pg-profile'); if (!pg || pg.hidden) return;
    const set = pg.querySelector('.pf-set'), out = $('profSignOut'); if (!set || !out) return;
    const m = await me(); const old = $('alRow'); if (!m) { if (old) old.remove(); return; }
    const have = providers(m.user); const parts = [];
    if (have.includes('google')) parts.push('Google ✓'); if (have.includes('apple')) parts.push('Apple ✓'); if (have.includes('email')) parts.push(t('E-mail') + ' ✓');
    const row = old || document.createElement('div'); row.id = 'alRow'; row.className = 'pf-row'; row.innerHTML = '';
    const tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = t('Sign-in methods') + ': ' + (parts.join(' · ') || '—'); row.appendChild(tx);
    const link = async (provider) => {
      try {
        const c = sb(); const opts = native() ? { redirectTo: window.NATIVE.redirect, skipBrowserRedirect: true } : { redirectTo: location.origin + location.pathname };
        const { data, error } = await c.auth.linkIdentity({ provider, options: opts }); if (error) throw error;
        if (native() && data && data.url) await window.NATIVE.openUrl(data.url);
      } catch (e) {
        const msg = String(e && e.message || e);
        toast(/already (linked|exists|registered)|identity_already_exists/i.test(msg) ? t(provider === 'apple' ? 'This Apple ID is already attached to another Hutka account. Sign in with Apple and use "Connect with Google / e-mail" there.' : 'This Google account is already attached to another Hutka account.') : msg);
      }
    };
    for (const p of ['apple', 'google']) { if (have.includes(p)) continue; const b = document.createElement('button'); b.type = 'button'; b.className = 'btn xs primary'; b.textContent = t(p === 'apple' ? 'Connect Apple' : 'Connect Google'); b.onclick = () => link(p); row.appendChild(b); }
    if (!old) set.insertBefore(row, out);
  }

  // ---- wiring: wait for the app, then watch the two screens
  let tries = 0;
  const boot = setInterval(() => {
    if (!sb()) { if (++tries > 100) clearInterval(boot); return; }
    clearInterval(boot);
    tryMerge();
    try { sb().auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED' || ev === 'USER_UPDATED') { setTimeout(tryMerge, 300); setTimeout(profileRow, 800); } }); } catch {}
    const watch = (id, fn) => { const el = $(id); if (!el) return; new MutationObserver(() => { if (!el.hidden) fn(); }).observe(el, { attributes: true, attributeFilter: ['hidden', 'class'] }); if (!el.hidden) fn(); };
    watch('onbModal', onboardingNotice); watch('pg-profile', profileRow);
  }, 200);
})();
