# Hutka — как выложить на свой хостинг

Папка содержит всё, что нужно, чтобы Hutka жила на своём адресе и была видна всем без логина:

| Файл | Что это |
|---|---|
| `index.html` | весь сайт одним файлом (треки, лаборатория, профили, админка) |
| `geo.txt` | карта мира для страницы треков |
| `supabase.js` | клиентская библиотека Supabase (v2.117.3), лежит рядом, чтобы не зависеть от CDN |
| `config.js` | **единственный файл, который надо заполнить** — адрес и публичный ключ Supabase |
| `supabase/schema.sql` | таблицы и права доступа (кто что может читать и писать) |
| `supabase/seed.sql` | 8 трасс ОАЭ с реальными данными и их конфигурации |
| `supabase/setup.sql` | schema + админ + seed одним файлом (для нового проекта) |
| `supabase/social.sql` | лайки, комментарии, подписки — запустить один раз после setup.sql |
| `supabase/ai.sql` | чаты, сообщения, кредиты — запустить один раз для AI-тренера |
| `supabase/functions/*` | серверные функции: тренер, кошелёк, Stripe |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | PWA: установка на телефон, «Поделиться → Hutka» из приложения Alfano (Android) |
| `supabase/functions/ask/index.ts` | серверная функция «Спросить ИИ» (ключ Anthropic хранится только на сервере) |

Схема: статический сайт (Netlify / Cloudflare Pages) + база и логин в Supabase + ИИ через функцию Supabase.
Бесплатных тарифов хватает на старт; карта понадобится только для домена и для API Anthropic.

Время на всё: ~30–40 минут.

---

## 1. База данных и логин — Supabase (бесплатно)

1. Зарегистрируйся на https://supabase.com → **New project**. Регион: *Asia Pacific (Mumbai)* или *Europe (Frankfurt)* — ближе всего к Дубаю. Пароль базы сохрани, но дальше он не понадобится.
2. Слева **SQL Editor** → **New query** → вставь содержимое `supabase/schema.sql` → **Run**. Должно быть «Success. No rows returned».
3. Там же новый запрос — добавь себя в админы (почта та, с которой будешь входить на сайт):
   ```sql
   insert into admin_emails (email) values ('u.kazyra@kozyramedia.com');
   ```
   Можно добавить несколько строк — все они получат админку.
4. Новый запрос → вставь `supabase/seed.sql` → **Run**. Появятся 8 трасс ОАЭ (Dubai Kartdrome со Standard/Extended/Reverse, Sharjah с четырьмя конфигурациями, Yas, Al Forsan, RAK, Karting Town, Indoor Kartdrome, Chaos Karts). Всё потом редактируется в админке сайта.
5. **Project Settings → API** (или **API Keys**): скопируй **Project URL** и ключ **anon public** (в новых проектах он называется *publishable key* и начинается с `sb_publishable_`). Это публичный ключ, его можно класть в `config.js` — все права ограничены политиками из `schema.sql`.

### Вход по ссылке на почту

Supabase по умолчанию отправляет письма **сам, но только 2 письма в час** — для публичного сайта этого мало. Два варианта (можно оба):

**А. Вход через Google (рекомендую, писем вообще не нужно)**
1. https://console.cloud.google.com → создай проект → **APIs & Services → OAuth consent screen** (External, название Hutka) → **Credentials → Create credentials → OAuth client ID → Web application**.
2. В *Authorized redirect URIs* добавь `https://<твой-ref>.supabase.co/auth/v1/callback` (точный адрес показан в Supabase: **Authentication → Providers → Google**).
3. Скопируй Client ID и Client secret в Supabase (**Authentication → Providers → Google → Enable**).
4. В `config.js` поставь `googleAuth: true` — в окне входа появится кнопка Google.

**Б. Свой SMTP для писем (магическая ссылка на почту)**
1. Заведи бесплатный аккаунт у почтового провайдера, например https://resend.com (3000 писем в месяц, нужен свой домен) или https://www.brevo.com (300 писем в день).
2. Supabase → **Project Settings → Authentication → SMTP Settings → Enable Custom SMTP** → впиши хост/порт/логин/пароль от провайдера и адрес отправителя (например `login@hutka.app`).

В любом случае зайди в **Authentication → URL Configuration** и поставь **Site URL** = адрес сайта (например `https://hutka.netlify.app`), и добавь его же в **Redirect URLs**. Без этого ссылка из письма ведёт на localhost.

---

## 2. AI-тренер, кредиты и Stripe

Пока функции не задеплоены, вкладка **AI coach** и панель «Спросить тренера» показывают «скоро» — ничего не ломается.

### 2.1. Таблицы
SQL Editor → вставить `supabase/ai.sql` → Run (чаты, сообщения, кошельки, журнал кредитов).

### 2.2. Ключ Anthropic
https://console.anthropic.com → **Billing** → пополнить (от $5) → **API Keys → Create key**. Один ответ тренера стоит ~2–5 центов.

### 2.3. Функции (5 штук)
Supabase → **Edge Functions → Deploy a new function → Via Editor**. Для каждой: имя из списка, вставить код файла, **Deploy**, затем в настройках функции **выключить «Verify JWT»** (функции сами проверяют, что человек вошёл).

| Имя функции | Файл | Что делает |
|---|---|---|
| `ask` | `supabase/functions/ask/index.ts` | ответ тренера, хранит чат, списывает кредит |
| `wallet` | `supabase/functions/wallet/index.ts` | баланс и план; первый вызов выдаёт стартовые 10 кредитов |
| `stripe-checkout` | `supabase/functions/stripe-checkout/index.ts` | открывает оплату пакета/подписки |
| `stripe-webhook` | `supabase/functions/stripe-webhook/index.ts` | получает от Stripe факт оплаты и начисляет |
| `stripe-portal` | `supabase/functions/stripe-portal/index.ts` | страница управления подпиской |

Через терминал быстрее: `npm i -g supabase && supabase login && supabase link --project-ref <ref>` и в папке `hutka/`: `supabase functions deploy ask wallet stripe-checkout stripe-webhook stripe-portal --no-verify-jwt`.

### 2.4. Секреты
**Edge Functions → Secrets** (или `supabase secrets set KEY=value`):

| Секрет | Откуда |
|---|---|
| `ANTHROPIC_API_KEY` | п. 2.2 |
| `SITE_URL` | адрес сайта, например `https://ukazyra-collab.github.io/hutka/` |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → Secret key (`sk_live_…`; для проверки можно `sk_test_…`) |
| `STRIPE_PRICE_PRO` | id цены подписки (`price_…`), см. 2.5 |
| `STRIPE_PRICE_PACK25`, `STRIPE_PRICE_PACK80` | id цен пакетов |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → добавить endpoint `https://<ref>.supabase.co/functions/v1/stripe-webhook`, события: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted` → Signing secret (`whsec_…`) |
| `FREE_CREDITS` (необязательно) | стартовые кредиты, по умолчанию 10 |

### 2.5. Товары в Stripe
Stripe → **Product catalog → Add product**:
- **Hutka Pro** — recurring, $29 / month → скопировать `price_…` в `STRIPE_PRICE_PRO`;
- **Starter pack (25 credits)** — one-time, $9 → `STRIPE_PRICE_PACK25`;
- **Season pack (80 credits)** — one-time, $24 → `STRIPE_PRICE_PACK80`.
Суммы можно менять; в `config.js` поле `pricing` — только надписи в окне покупки, поправь их в тон.

### 2.6. Проверка
Открой сайт → **AI coach** → должно показать 10 кредитов → задай вопрос. **Get credits → Choose** должен уводить на страницу оплаты Stripe и после оплаты возвращать на сайт с начислением (обычно 2–5 секунд).

---

## 2-old. ИИ-чат в лаборатории — функция `ask` (старое описание)

Без неё всё работает, просто панели «Спросить ИИ» не будет.

1. https://console.anthropic.com → **Billing** → пополни баланс картой (минимум $5; один вопрос ИИ по сессии стоит несколько центов) → **API Keys → Create key** → скопируй ключ.
2. Supabase → **Edge Functions → Deploy a new function → Via Editor** → имя `ask` → вставь содержимое `supabase/functions/ask/index.ts` → **Deploy**.
3. В настройках функции **выключи «Verify JWT»** — функция сама проверяет, что человек вошёл на сайт (иначе новые проекты Supabase с новыми ключами подписи могут отбивать запросы).
4. **Edge Functions → Secrets** → добавь `ANTHROPIC_API_KEY` = ключ из п.1. (По желанию `ANTHROPIC_MODEL`, по умолчанию `claude-sonnet-5-5`.)
5. Адрес функции: `https://<твой-ref>.supabase.co/functions/v1/ask` — его в `config.js`.

Ключ Anthropic **никогда** не кладётся в `config.js` — только в Secrets. Функция отвечает только вошедшим пользователям, так что чужие не смогут тратить баланс.

Альтернатива через терминал: `npm i -g supabase && supabase login && supabase link --project-ref <ref> && supabase functions deploy ask --no-verify-jwt && supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`

---

## 3. Заполни `config.js`

```js
window.HUTKA_CONFIG = {
  supabaseUrl: "https://abcdefghijkl.supabase.co",
  supabaseAnonKey: "sb_publishable_...  (или eyJ... anon public)",
  askUrl: "https://abcdefghijkl.supabase.co/functions/v1/ask",   // "" если без ИИ
  googleAuth: true                                              // false, если Google не настраивал
};
```

---

## 4. Выложи сайт (бесплатно, 2 минуты)

**Netlify Drop** — самый быстрый путь: https://app.netlify.com/drop → перетащи **всю папку `hutka`** (index.html, geo.txt, config.js; папку `supabase` можно не класть) → получишь адрес вида `https://random-name.netlify.app`. В **Site configuration → Site details → Change site name** можно сделать `hutka.netlify.app`, если свободно.

Альтернатива: Cloudflare Pages (https://dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets) — тот же результат на `hutka.pages.dev`.

Обновление сайта = перетащить папку ещё раз (Netlify: **Deploys → drag and drop**).

### Свой домен
1. Купи домен (Namecheap / Porkbun / Cloudflare Registrar, оплата картой, ~$10–15 в год; `.ae` требует регистратора в ОАЭ).
2. Netlify → **Domain management → Add a domain** → по подсказке добавь у регистратора записи `A`/`CNAME`. HTTPS включится сам.
3. Потом не забудь обновить **Site URL / Redirect URLs** в Supabase на новый домен (и redirect URI в Google, если настраивал).

---

## 5. Первый вход и проверка

1. Открой сайт → **Sign in** → войди своей почтой (той, что в `admin_emails`). В меню слева появится **Admin**.
2. Админка: проверь карточки трасс, загрузи логотипы и обложки, при необходимости поправь координаты (пин на карте) и часы работы. В редакторе конфигурации можно обвести трассу по аэрофото или задать эталонную сессию.
3. Лаборатория: загрузи `.alf2` → выбери трек и конфигурацию → сессия публикуется на страницу трека (галочка при загрузке). Другие увидят её в «Hot laps» и смогут сравнивать с собой.
4. Профиль: гоночное имя, страна, домашний трек, аватар — по нему тебя найдут через поиск.

### Что важно знать
- **Supabase Free усыпляет проект после 7 дней без обращений** — сайт перестанет открываться, пока не нажмёшь *Restore* в панели. С живыми посетителями этого не случается; тариф Pro ($25/мес) убирает паузу совсем и даёт ежедневные бэкапы.
- Данные людей (сессии, профили) лежат только в Supabase: бэкап — **Database → Backups** (Pro) или `pg_dump` по connection string.
- Кто админ, решает таблица `admin_emails` — добавляй/удаляй строки в SQL Editor.
- Приватные сессии видит только владелец, даже админ их не видит — так устроены политики в `schema.sql`.
