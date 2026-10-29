# Hutka — приложение для iPhone и Android

Папка `app/` — это нативная оболочка (Capacitor) вокруг сайта Hutka. Приложение открывает **живой сайт** (`server.url` в `capacitor.config.json`), поэтому всё, что выкатывается на сайт, появляется в приложении сразу, без новой сборки и без ревью. Пересобирать приложение нужно только когда меняется нативная часть: иконка, адрес сайта, плагины.

Что умеет нативная часть сверх сайта:
- **Вход** через Google / Apple / ссылку на почту открывает системный браузер и возвращается в приложение по ссылке `hutka://auth` (Google запрещает вход внутри встроенного браузера — поэтому так).
- **«Открыть в Hutka»**: файл `.alf2` (и `.gpx`, `.vbo`, `.csv`) из приложения Alfano, Файлов или мессенджера сразу попадает в окно загрузки сессии.
- Поворот экрана не заблокирован (кокпит в Lab работает горизонтально), сплэш-экран, статус-бар под цвет приложения.
- Запуск без интернета (с 18 окт 2026): сайт хранится в самом телефоне (service worker), приложение открывается на трассе без связи, читает прибор, а сессии ждут на телефоне и загружаются сами, когда сеть появится. Android — уже (через сайт, без новой сборки); iPhone — со следующей сборки (раздел 4e). Самый первый запуск без сети, пока сайт ещё ни разу не открывался, — офлайн-страница (`www/offline.html`).

Один код — две платформы. Ниже — весь путь до магазинов, по шагам.

---

## 0. Что нужно (один раз)

| Что | Зачем | Сколько |
|---|---|---|
| **Apple Developer Program** — https://developer.apple.com/programs/enroll/ | без него нельзя ни поставить на свой iPhone дольше 7 дней, ни загрузить в App Store | $99 в год; одобрение 1–2 дня (на компанию — дольше, нужен D-U-N-S) |
| **Mac + Xcode** (App Store → Xcode, ~15 ГБ) | сборка iOS возможна только на macOS | — |
| **Google Play Console** — https://play.google.com/console | публикация Android | $25 единоразово |
| **Android Studio** — https://developer.android.com/studio | сборка Android (на Mac или Windows) | — |
| Node 20+ (`brew install node`) | инструменты сборки (CocoaPods не нужен — Capacitor 8 использует Swift Package Manager) | — |

Почта поддержки `hello@hutka.ai` указана в политике конфиденциальности (`privacy.html` на сайте) — заведи такой ящик или поменяй адрес в файле.

## 1. Supabase и Google — две галочки для приложения

1. Supabase → **Authentication → URL Configuration → Redirect URLs** → добавь `hutka://auth` (рядом с адресом сайта). Без этого вход из приложения не вернётся обратно.
2. Google Cloud (если включён вход через Google) — ничего менять не нужно: redirect там один и тот же, на Supabase.
3. **Sign in with Apple** — обязателен для App Store, если в приложении есть кнопка Google (правило 4.8). Пока Apple-вход не настроен, приложение само прячет кнопку Google и оставляет вход по ссылке на почту — так тоже можно публиковаться. Чтобы включить:
   - developer.apple.com → **Certificates, Identifiers & Profiles** → Identifiers → App IDs → `ai.hutka.app` → включи **Sign in with Apple**.
   - Там же → Identifiers → **Services IDs** → новый, например `ai.hutka.web`, включи Sign in with Apple, Configure: домен `tqixfqrludqpxqxypiia.supabase.co`, Return URL `https://tqixfqrludqpxqxypiia.supabase.co/auth/v1/callback`.
   - Keys → новый ключ с Sign in with Apple → скачай `.p8`, запомни Key ID и Team ID.
   - Supabase → Authentication → Providers → **Apple** → Services ID, Team ID, Key ID, содержимое `.p8` → Save.
   - В `config.js` на сайте поставь `appleAuth: true` — появится кнопка  Apple (и в приложении вернётся Google).
   - **Сделано 29 окт 2026:** App ID `ai.hutka.app` — capability Sign in with Apple (primary); Services ID **`ai.hutka.web`** («Hutka Web», домен `tqixfqrludqpxqxypiia.supabase.co`, return URL `https://tqixfqrludqpxqxypiia.supabase.co/auth/v1/callback`); ключ **S22F73Y8XY** («Hutka Sign in with Apple», `.p8` на Маке в `~/.appstoreconnect/private_keys/`); в Supabase → Apple: Client IDs `ai.hutka.web,ai.hutka.app`, Secret Key — JWT (ES256, iss = Team ID F3P87X2A7L, sub = `ai.hutka.web`, aud `https://appleid.apple.com`), сгенерирован на Маке, **истекает 27 апр 2027** — Apple не даёт дольше 6 месяцев: до этой даты сгенерировать новый тем же ключом и вставить в Supabase (скрипт — `_release/job.sh` от 29 окт, Key ID и Team ID те же). `appleAuth: true` в `config.js` с v34.61.
4. **Аккаунт для ревью Apple.** Проверяющим нужен вход без почты: Supabase → Authentication → Users → **Add user** → почта `review@hutka.ai` (любая), пароль, «Auto confirm». В приложении в окне входа есть «У меня есть пароль». Эту пару укажешь в App Store Connect → App Review Information.

### 1.4. Один аккаунт на Google + Apple (v34.62, 29 окт 2026)
Apple с «Hide My Email» отдаёт подставной адрес `…@privaterelay.appleid.com`, и Supabase заводит второй пустой аккаунт (по почте не склеить). Решение — файл **`auth-link.js`** на сайте (подключён в конце `index.html`, входит в `sw.js` SHELL и в `app/build.sh`):
- на экране «Welcome to Hutka» у такого аккаунта — плашка «Connect with Google / Connect with e-mail»: гонщик входит в свой настоящий аккаунт, сайт зовёт edge-функцию **`merge-apple`** (`supabase/functions/merge-apple`) с токеном пустого аккаунта → SQL-функция `public.merge_apple_identity(a, b)` (миграция `20261029120000_merge_apple_identity.sql`, только service role) переносит Apple-идентичность на настоящий аккаунт и удаляет пустой; дальше «Continue with Apple» открывает настоящий;
- Profile → Settings → **Sign-in methods**: Google ✓ · Apple ✓ и кнопка Connect для недостающего (`auth.linkIdentity`, в Supabase включено **Allow manual linking**).
Для сборки сайта: `auth-link.js` — отдельный файл рядом с `index.html`, в `deploy.sh` его надо копировать так же, как `config.js`.

## 2. Сборка на Mac

```bash
git clone https://github.com/ukazyra-collab/hutka.git
cd hutka/app
npm install
sh build.sh          # копирует файлы сайта в www и синхронизирует ios/ и android/
npx cap open ios     # откроется Xcode (первый раз он минуту-две качает Swift-пакеты Capacitor)
```

В Xcode:
1. Слева выбери проект **App** → target **App** → вкладка **Signing & Capabilities** → **Team** = твоя команда разработчика (Automatically manage signing — включено). Bundle Identifier уже `ai.hutka.app`.
2. Подключи iPhone кабелем, выбери его в списке устройств сверху → ▶ Run. Первый раз на телефоне: Настройки → Основные → VPN и управление устройством → доверять разработчику.
3. Проверь: вход, поворот в Lab, «Поделиться .alf2 → Hutka» из приложения Alfano.

Версия приложения: Xcode → target App → General → **Version** (1.0) и **Build** (1). Каждая новая загрузка в App Store Connect — Build +1.

## 3. App Store Connect — заявка

1. https://appstoreconnect.apple.com → **My Apps → + → New App**: Platforms iOS, Name **Hutka**, Primary Language English, Bundle ID `ai.hutka.app`, SKU `hutka`, Full Access.
2. **App Information**: Category **Sports** (Secondary — Utilities), Content Rights — не содержит стороннего контента, Age Rating → опросник → 4+.
3. **App Privacy** → Privacy Policy URL: `https://hutka.ai/privacy.html`. Data Types: Email Address, Name, Photos (аватар), User Content (сессии, комментарии), Identifiers (User ID) — **Linked to the user**, **not used for tracking**. Crash Data / Analytics — нет.
4. **Version 1.0**:
   - Скриншоты: iPhone 6.9" (1320×2868) — обязательно, остальные Apple подгонит. Снимай на iPhone 16 Pro Max (или в симуляторе: ⌘S). Нужны 3–6 штук: лента, страница трассы, Lab (кокпит горизонтально тоже можно), ИИ-тренер.
   - Description, Keywords (karting, kart, lap timer, alfano, telemetry, go-kart, картинг), Support URL (сайт), Marketing URL (сайт).
   - **Build**: загружается из Xcode: Product → **Archive** → Distribute App → **App Store Connect** → Upload (подписи — автоматически). Через 10–30 минут билд появится в разделе Build → выбери его.
   - **App Review Information**: Sign-in required ✔ → логин/пароль из шага 1.4; Notes: «Hutka analyses go-kart telemetry logs. Demo account has sample sessions; open Lab → My sessions. Google sign-in is hidden in the app until Sign in with Apple is enabled.» Приложи контактный телефон.
   - Export Compliance: в `Info.plist` уже стоит `ITSAppUsesNonExemptEncryption = false` — вопрос не задаётся.
5. **Add for Review → Submit**. Ревью обычно 24–72 часа. Чтобы не ловить ответы по почте — приложение **App Store Connect** на iPhone присылает статус.

Частые причины отказа и что сделано:
- *4.2 Minimum functionality / «это просто сайт»* — в заметках ревьюеру опиши функции (анализ телеметрии, кокпит, сравнение с другими гонщиками, ИИ-тренер) и приложи демо-сессии в аккаунте для ревью. Сайт в момент ревью должен работать.
- *4.8 Login services* — Google без Apple. Закрыто: без `appleAuth` кнопка Google в приложении не показывается.
- *5.1.1 Data collection* — есть политика конфиденциальности и заполнен App Privacy.
- *Guideline 2.1 — crash / blank screen* — проверь на реальном iPhone перед загрузкой; если сайт недоступен, показывается `offline.html`.

### TestFlight (не обязательно, но удобно)
Тот же загруженный билд → вкладка **TestFlight** → Internal Testing → добавь себя и друзей по Apple ID → они ставят приложение TestFlight и получают сборку за 5 минут. Для фокус-группы из 20–30 человек это самый быстрый путь — без App Store вообще.

## 3a. App Store, автоматом (29 окт 2026, версия 1.4 / build 5)

Аккаунт разработчика Kozyra Media одобрен — путь до ревью теперь скриптами, руками остаются три вещи, которые Apple не даёт сделать через API:

| Руками (один раз) | Где |
|---|---|
| Ключ App Store Connect API (роль **Admin**) → скачать `.p8` → положить в `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`; запомнить Key ID и Issuer ID | App Store Connect → Users and Access → Integrations → App Store Connect API |
| Создать запись приложения: My Apps → **+ → New App**: iOS, Name **Hutka**, Primary Language English (U.S.), Bundle ID `ai.hutka.app` (появится после `asc.py bundle`), SKU `hutka`, Full Access | App Store Connect → My Apps |
| **App Privacy** — опросник (ответы ниже) | App Store Connect → приложение → App Privacy |

Дальше на Маке (Xcode стоит, `git pull` сделан):
```bash
cd hutka/app
export ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
python3 asc.py bundle                    # регистрирует ai.hutka.app с Push Notifications, печатает TEAM_ID
export TEAM_ID=XXXXXXXXXX HUTKA_REVIEW_EMAIL='твоя почта' HUTKA_REVIEW_PHONE='+971...' HUTKA_REVIEW_ACCOUNT='почта демо-аккаунта' HUTKA_REVIEW_PASSWORD='его пароль'   # контакт и демо-аккаунт — только в окружении, не в репозитории (он публичный)
sh ios_release.sh                        # cap sync → archive (автоподпись) → export → upload; ~10 минут
python3 asc.py metadata                  # категории, возраст 4+, тексты версии 1.4 (listing.json), контакт и демо-аккаунт для ревью
python3 asc.py screenshots store/appstore   # iPhone 6.7" и iPad 12.9" из store/appstore/
python3 asc.py build --wait              # ждёт, пока Apple обработает билд, и прикрепляет его к версии
python3 asc.py submit                    # в ревью
python3 asc.py status
```
`asc.py` — без сторонних пакетов (JWT подписывает системный `openssl`), ключ читает только с диска. `ExportOptions.plist` — метод `app-store-connect`, подпись автоматическая. В проект добавлен `PrivacyInfo.xcprivacy` (манифест приватности: трекинга нет; собираем e-mail, имя, user ID, фото, контент, точную геолокацию для Record from kart — всё привязано к аккаунту, только для функций приложения).

**App Privacy — ответы** (Data Types): Contact Info → Email Address, Name; User Content → Photos or Videos (аватар), Other User Content (сессии, комментарии); Identifiers → User ID; Location → Precise Location (Record from kart); Usage Data → Product Interaction (события в приложении, не привязаны к пользователю). Для всех: Linked to the user — Yes (кроме Product Interaction — No), Used for tracking — **No**, цель — App Functionality (Product Interaction — Analytics). Diagnostics, Purchases, Financial, Health, Contacts, Browsing/Search History, Sensitive Info — не собираем.

Демо-аккаунт для ревью: тот же, что в Play Console → App access, в нём две приватные сессии «Demo · Ironman 14 Oct 2026» и «Demo · Ironman 10 Oct 2026» (Dubai Kartdrome). Вход: Continue with email → «I have a password».

### Что было на деле при первой подаче (29 окт 2026) — учтено в `asc.py`
- Запись приложения App Store Connect создаёт вместе с версией **1.0**; вторую версию добавить нельзя, пока первая не вышла — `asc.py` переименовывает её в нужный номер.
- Возрастной опросник 2025 года требует новые поля (`socialMedia`, `userGeneratedContent`, `messagingAndChat`, `parentalControls`, `gunsOrOtherWeapons`, …) — заполнены: UGC и соцфункции — да, остальное — нет.
- У первой версии нет поля «What's New» — Apple отвергает атрибут; `asc.py` ставит его начиная со второй версии.
- Для подачи обязательны **copyright** у версии (ставится из `listing.json`, по умолчанию «2026 Kozyra Media Group»), **цена** (Pricing and Availability → $0.00) и **доступность** (все страны) — цена и доступность задаются только на сайте.
- Скриншоты после загрузки обрабатываются несколько минут; `asc.py submit` ждёт и повторяет.
- Подпись с чистого аккаунта: у команды не было устройств, и автоподпись архива падала («Your team has no devices») — iPhone регистрируется через API (`xcrun devicectl list devices` → `POST /v1/devices`), после этого архив собирается.
- Trader status (DSA, для ЕС): Business → Agreements → Compliance — заполнено 29 окт 2026 (trader; контакты для показа в ЕС — телефон и u.kazyra@kozyramedia.com).

## 4. Android — Google Play

```bash
cd hutka/app
sh build.sh
npx cap open android   # откроется Android Studio
```

1. Android Studio → **Build → Generate Signed Bundle / APK → Android App Bundle** → **Create new… keystore** (файл `hutka-release.jks`, пароли запиши — потерянный keystore = нельзя обновлять приложение никогда) → release → готовый `.aab` в `android/app/release/`.
2. https://play.google.com/console → **Create app**: Hutka, App, Free → заполни **Dashboard → Set up your app**: Privacy policy URL, App access (данные тестового аккаунта из шага 1.4), Ads — нет, Content rating — опросник (Utility/Sports) , Target audience — 18+, Data safety — собираем email, name, user content, photos; шифруется при передаче; пользователь может запросить удаление.
3. **Testing → Internal testing** → Create release → загрузи `.aab` → добавь тестеров по почте → ссылка для установки. Потом **Production → Create release** → Review. Первая проверка Google — до 7 дней, обновления обычно часы.
4. Версия: `android/app/build.gradle` → `versionCode` (+1 на каждую загрузку) и `versionName`.

## 4a-0. Имя пакета Android: `hutka.ai` (16 окт 2026)
Приложение в Play Console создано с именем пакета **`hutka.ai`** (оно фиксируется навсегда), поэтому в `android/app/build.gradle` стоит `applicationId "hutka.ai"` — а `namespace` и Java-пакет остались `ai.hutka.app`, это разные вещи, менять их не нужно. Всё, что привязывается к имени пакета Android, делать на `hutka.ai`: Firebase (Android app в проекте Firebase → `google-services.json`), Android App Links (`assetlinks.json`), OAuth-клиент Android в Google Cloud (если понадобится). iOS bundle id — отдельный, `ai.hutka.app`.

## 4a. Android — что сделано и как собрать (16 окт 2026)

Нативная часть под Android готова: Capacitor 8 рисует страницу edge-to-edge и сам отдаёт `env(safe-area-inset-*)` (плагин SystemBars, в конфиге `initialViewportFitValueHint: cover`), поэтому стеклянная шапка и таб-панель встают так же, как на iPhone; цвет иконок статус-бара и жестовой панели следует теме; аппаратная кнопка «назад» сначала закрывает открытое (модалку, пикер, инспектор, кокпит), потом идёт по истории, потом сворачивает приложение; «Поделиться» через системное меню (FileProvider уже в манифесте); пуши через FCM (иконка `ic_stat_hutka`, канал `hutka`, разрешение `POST_NOTIFICATIONS`); «Открыть в Hutka» для .alf2/.gpx/.csv; вход через Google/почту возвращается по `hutka://auth`. Блюр на больших панелях чуть легче (`html.android`), чтобы не тормозило на средних телефонах.

### Сборка и запуск на телефоне
1. **Android Studio** — https://developer.android.com/studio (Mac, ~1.5 ГБ). При первом запуске «Standard» установка: он скачает SDK, эмулятор и JDK.
2. Терминал: `cd ~/Desktop/hutka/app && git pull && npm install && sh build.sh && npx cap open android` — откроется Android Studio с проектом `app/android`. Первый раз он минуту-три синхронизирует Gradle и может предложить скачать SDK 36 / Build-Tools — соглашайся.
3. Телефон: Настройки → О телефоне → 7 раз нажать «Номер сборки» → появится «Для разработчиков» → включить **Отладка по USB**. Подключить кабелем → на телефоне «Разрешить отладку» → телефон появится вверху Android Studio в списке устройств. Без телефона: Device Manager (иконка телефона справа) → Create device → Pixel 8 → образ API 36 → эмулятор.
4. ▶ Run. Первая сборка 2–5 минут. Приложение ставится и открывается; аккаунт разработчика не нужен, живёт без ограничений по времени.
5. Для пушей: `google-services.json` из Firebase (раздел 4c) положить в `app/android/app/` **до** сборки; без файла всё остальное работает, пуши пропускаются.

### Google Play
1. https://play.google.com/console → регистрация **как организация** (Kozyra Media): нужен D-U-N-S номер (тот же, что для Apple), сайт, почта и телефон организации, $25 один раз. Проверка — от пары дней до пары недель. Личный аккаунт не подходит: с 2023 года у них обязательный закрытый тест с 12 тестерами 14 дней перед публикацией.
2. Пока проверка идёт — сборка релиза: Android Studio → **Build → Generate Signed App Bundle / APK → Android App Bundle** → Create new keystore: файл `hutka-upload.jks` (хранить вне репозитория, например в iCloud Drive), пароли записать — это ключ загрузки; Google Play App Signing подпишет приложение своим ключом → release → готовый `.aab` в `android/app/release/`.
3. В консоли: Create app → Hutka → заполнить Dashboard (политика `https://hutka.ai/privacy.html`, App access с тестовым аккаунтом, Data safety: e-mail, имя, фото, пользовательский контент; не для рекламы) → **Testing → Internal testing** → загрузить `.aab` → список тестеров по e-mail → ссылка на установку (без ревью, минуты). Потом **Production → Create release** → ревью Google (первое — до 7 дней).
4. Версии: `android/app/build.gradle` → `versionCode` +1 на каждую загрузку, `versionName` — как у iOS.

## 4b. Версия 1.1 (15 окт 2026) — что сдавать в магазины

Приложение показывает живой сайт, так что всё новое уже в нём; в проекте подняты только номера: iOS **Version 1.1 / Build 2** (`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` в `App.xcodeproj`), Android **versionName 1.1 / versionCode 2**. На Mac: `git pull`, `cd app`, `npm install`, `sh build.sh`, `npx cap open ios` → Archive → Upload (iOS); Android Studio → Generate Signed Bundle.

Текст «What's New» для App Store Connect / Play Console (EN):

```
Hutka 1.1
• Compare up to three laps on the map — yours, a friend's and any other — each in its own colour, with a replay slider that moves the karts along the lap in real time.
• Best vs ideal: the ideal lap stitched from your fastest pass through every corner, and the breakdown that shows which lap won each corner.
• The feed shows the analysis itself: the lap line with braking, apex and throttle points, the biggest reserves.
• Share a session: a card with your best lap and a link with its own preview.
• A step-by-step guide for Alfano files, a bug-report button, e-mails about likes and comments.
```

Скриншоты для стора (6.9": 1320×2868, 3–6 штук): лента с разбором, Lab с тремя кругами и реплеем, Best vs ideal с breakdown, ИИ-тренер, страница трассы. Снимать на iPhone 16 Pro Max или в симуляторе (⌘S).

## 4c. Версия 1.2 (15 окт 2026) — пуши, хаптик, «стекло», Activity

Что нового в приложении (сайт подхватывает сам, кроме нативной части):
- **Пуш-уведомления.** На главной у вошедшего гонщика один раз спрашивается «Знать, когда лайкают или комментируют?» → системный диалог → токен устройства уходит в `push_tokens` (push.sql). Лайк или комментарий к твоей сессии → пуш в течение ~20 секунд («Greg Watt liked your session · Ironman heat 2 · 1:15.030»), нажатие открывает обсуждение сессии; число на иконке = непрочитанная активность. Если пуш доставлен — письмо про то же событие не шлётся. Выключить: Profile → «Push notifications in the app» (или настройки телефона).
- **Activity** — колокольчик в верхней панели с числом непрочитанного (и на сайте тоже): список «кто лайкнул / прокомментировал», нажатие открывает сессию.
- **Хаптик**: лёгкий отклик на вкладках, поворотах, play реплея; «thump» на лайке; паттерн «успех» после загрузки, публикации, комментария, входа; «ошибка» если не отправилось.
- **Стекло**: плавающая таб-панель-«таблетка» и верхняя панель из матового стекла (блюр + насыщенность), страница едет под статус-бар (iOS), шторки инспектора/выбора сессии, модалки и тосты — тоже стекло; тёмная тема учтена. Только в приложении (`html.native`), сайт в браузере не меняется.
- **Поделиться** — системный share sheet с картинкой, текстом и ссылкой (плагин Share), а не только Web Share API.
- Нативные плагины: `@capacitor/push-notifications`, `@capacitor/haptics`, `@capawesome/capacitor-badge` (число на иконке). iOS: `AppDelegate.swift` передаёт APNs-токен плагину, `App.entitlements` (`aps-environment`), `contentInset: never` + статус-бар поверх страницы (включается из JS только на iOS). Android: `POST_NOTIFICATIONS`, иконка `ic_stat_hutka` (белый силуэт марки), цвет, канал `hutka`.
- Номера: iOS **1.2 / Build 3**, Android **versionName 1.2 / versionCode 3**.
- Правки после первого теста на iPhone (15 окт, вечер): статус-бар поверх страницы с первого кадра (`StatusBar.overlaysWebView: true` в конфиге), без «резинки» на концах страницы (`SceneDelegate`: `webView.scrollView.bounces = false` — иначе верхняя панель и таб-панель уезжают вместе с отскоком), страница в приложении сама перезагружается, когда на сайте вышла новая версия (`version.txt`, проверка при возврате в приложение — GitHub Pages кэширует `index.html` на 10 минут). Сайт: масштаб приколочен, модалки/тосты поверх кокпита (были под ним — «кнопки не работают в фуллскрине»).

### Вход в приложении
- Ссылка из письма открывается в Safari и логинит сайт, а не приложение, пока в Supabase → Authentication → URL Configuration → **Redirect URLs** нет `hutka://auth` (тогда Supabase после проверки ссылки возвращает в приложение). Это же нужно для Google / Apple из приложения.
- Надёжнее ссылки — **код из письма**: с v33.2 письмо Magic Link показывает шестизначный код, в окне входа после «Email me a link» появляется поле для него; вход происходит прямо в приложении. Шаблон `supabase/emails/magic-link.html` надо вставить в Supabase → Authentication → Email Templates → Magic Link (один раз).
- Google в приложении показывается, когда в `config.js` `googleAuth: true`. Apple — после платного аккаунта (раздел 1.3 выше, `appleAuth: true`); до подачи в App Store Apple обязателен (правило 4.8).

### Тест на своём iPhone по кабелю без платного аккаунта (бесплатный Apple ID)
`cd app && sh dev.sh` — переключает проект на bundle id `ai.hutka.dev` и убирает capability Push Notifications (личная команда её не подписывает; а `ai.hutka.app` остаётся свободным для аккаунта Kozyra Media — явные App ID уникальны между командами). Дальше `npx cap open ios` → Team = Personal Team → iPhone по кабелю → Run. Сборка живёт 7 дней. Перед настоящей сборкой: `sh release.sh` (возвращает `ai.hutka.app` и пуши).

### Что нужно сделать один раз, чтобы пуши заработали (только это делается руками)

**iOS (после одобрения Apple Developer на Kozyra Media):**
1. developer.apple.com → Certificates, Identifiers & Profiles → **Identifiers** → App IDs → `ai.hutka.app` → галочка **Push Notifications** → Save. (Если App ID ещё не создан — Xcode создаст его при первой сборке с автоматической подписью; потом включить галочку.)
2. Там же → **Keys** → «+» → имя `Hutka push`, галочка **Apple Push Notifications service (APNs)** → Continue → Register → **Download** (`AuthKey_XXXXXXXXXX.p8`, скачивается один раз). Запомни **Key ID** (10 символов) и **Team ID** (правый верхний угол Membership).
3. Supabase → Project Settings → **Edge Functions → Secrets** → добавить:
   - `APNS_KEY` — содержимое файла `.p8` целиком (вместе со строками `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`);
   - `APNS_KEY_ID` — Key ID;
   - `APNS_TEAM_ID` — Team ID.
   (`APNS_TOPIC` не нужен — по умолчанию `ai.hutka.app`.) Функция `notify` сама пробует production, а если токен от сборки из Xcode — sandbox.
4. В Xcode: target App → Signing & Capabilities — capability **Push Notifications** уже прописана через `App.entitlements`; при Archive с автоматической подписью Xcode выставит `aps-environment = production`.

**Android (Firebase, бесплатно):**
1. https://console.firebase.google.com → **Add project** → имя `Hutka` (Google Analytics можно выключить).
2. В проекте → **Add app → Android** → package name `ai.hutka.app`, nickname Hutka → Register → **Download google-services.json** → положить файл в `app/android/app/google-services.json` (в репозитории его нет, он остаётся на Mac; gradle подхватывает автоматически).
3. Project settings (шестерёнка) → **Service accounts** → **Generate new private key** → скачается JSON.
4. Supabase → Edge Functions → Secrets → `FCM_SERVICE_ACCOUNT` — содержимое этого JSON целиком (одной строкой или как есть).

Пока секретов нет, функция `notify` пуши просто пропускает (письма идут как раньше) — ничего не ломается. Проверка после настройки: в приложении войти, нажать «Turn on», с другого аккаунта лайкнуть свою сессию — пуш приходит в пределах ~20–40 с; в Supabase → Database → `push_tokens` видна строка с токеном.

Текст «What's New» 1.2 (EN):

```
Hutka 1.2
• Push notifications: know the moment someone likes or comments on your session — tap to open the discussion.
• Activity: a bell with everything that happened to your sessions.
• Haptic feedback and a new glass look: a floating tab bar, frosted panels, dark mode.
• Share a session through the system share sheet — picture, text and link.
```

## 4d. Версия 1.3 (17 окт 2026) — прибор по Bluetooth

Сайт (v34.5) умеет читать заезды прямо из памяти лап-таймера: Лаборатория → Загрузить сессию → **С прибора (Bluetooth)**. В браузере это Web Bluetooth (Chrome на Android и на компьютере; Safari не умеет), в приложении — плагин `@capacitor-community/bluetooth-le` (iOS и Android). Сайт зовёт его через тот же мост (`BluetoothLe`: `initialize`, `requestDevice`, `connect`, `startNotifications`, `write`, `read`, `disconnect`), JS-рантайм плагина в бандл не входит.

Что уже сделано в `app/`: зависимость в `package.json`, разрешения Bluetooth в `AndroidManifest.xml` (Android 12+ без геолокации — `neverForLocation`), тексты `NSBluetoothAlwaysUsageDescription` / `NSBluetoothPeripheralUsageDescription` в `Info.plist`.

Пересобрать (один раз, обе платформы):
```
cd app && npm install && npx cap sync
```
iOS: Xcode → Version 1.3, Build +1 → Archive → Upload. Android: `versionCode` +1 (`versionName "1.3"`) в `android/app/build.gradle` → Build → Generate Signed App Bundle → новый `.aab` в Play Console. Без пересборки кнопка в приложении говорит «Bluetooth работает в приложении Hutka…» и ничего не делает; на сайте в Chrome работает уже сейчас.

**iPhone (17 окт, v34.8).** Плагин теперь прописан и в проектах: `ios/App/CapApp-SPM/Package.swift` (пакет `CapacitorCommunityBluetoothLe`) и `android/capacitor.settings.gradle` / `app/capacitor.build.gradle`. Приложение на iPhone, собранное до этого, плагина не содержит — окно «С прибора» в нём говорит «В этой версии приложения ещё нет Bluetooth — обнови приложение», и приборов не ищет. Чтобы заработало на iPhone: на Mac `cd app && npm install && npx cap sync ios && npx cap open ios` → в Xcode выбрать iPhone → Run (при первом запуске iOS спросит разрешение на Bluetooth — «Разрешить»; если отказал — Настройки → Hutka → Bluetooth). Для TestFlight / App Store — Archive → Upload как обычно, версия 1.3 (4). На iOS плагин не умеет `requestEnable` (включить Bluetooth за пользователя) и `requestConnectionPriority` — сайт их на iOS не зовёт; выключенный Bluetooth и отказ в разрешении сайт называет своими словами (тест `t73_device_ios.js`).

Драйверы приборов живут на сайте в `device.js` (`LOGGERS`):
- **RaceBox Mini S / Micro** — готов. Протокол опубликован производителем (RaceBox BLE Protocol Documentation rev. 9): UART-сервис `6E400001-…`, кадры B5 62 | class | id | len | payload | CK_A CK_B; статус памяти `FF 22`, разблокировка `FF 30` (4 байта кода), выгрузка `FF 23` → поток записей `FF 21` (80 байт, как live-сообщение) и меток старт/стоп `FF 26` → ACK `FF 02 [FF 23]`, стирание `FF 24`. Записи режутся на заезды по меткам старта и паузам > 2 мин, идут в универсальный импорт как CSV 25 Гц (`RaceBox <дата>.csv`), круги режутся по замыканию петли и выравниваются по S/F разметки.
- **Alfano 7** — готов (v34.7): сессии из памяти прибора по BLE-«прозрачному UART» модуля RN4678 (`alfano7.js`), тот же протокол, что у приложения Alfano по SPP; разведка остаётся запасным режимом, если прибор не принял пароль. Подробности — README сайта, раздел v34.7.

## 4e. Запуск без интернета (18 окт 2026)

На трассе часто нет связи. Сайт кладёт себя в телефон (service worker `sw.js`: страница, `config.js`, `supabase.js`, логотипы); открытое без сети приложение стартует из этой копии. Вход сохраняется: если токен истёк, пока не было связи, Hutka держит сохранённую сессию и обновит её сама, когда сеть вернётся. Прочитанные с прибора сессии ждут на телефоне (IndexedDB) и уходят сами; сверху страницы — строка «No internet — reading the lap timer still works…».

- **Android** — работает сразу после выкладки сайта (v34.27): WebView с service worker. Нужен один запуск приложения с интернетом, чтобы сайт сохранился в телефоне.
- **iPhone** — WKWebView даёт service worker только приложениям с App-Bound Domains. В проекте уже включено: `capacitor.config.json` → `ios.limitsNavigationsToAppBoundDomains: true`, `Info.plist` → `WKAppBoundDomains` (hutka.ai, www.hutka.ai, ukazyra-collab.github.io, tqixfqrludqpxqxypiia.supabase.co, localhost). Попадёт в следующую сборку iOS — **перед релизом проверить на TestFlight**: вход (почта, Google, Apple), загрузка файла, прибор по Bluetooth, пуши, ссылки наружу (открываются в Safari). Если что-то из этого сломается, вернуть `false` и убрать ключ из `Info.plist`.
- Проверка на телефоне: открыть приложение с интернетом → закрыть совсем (смахнуть из списка приложений) → включить Airplane Mode (Bluetooth снова включить в Control Center) → открыть приложение → Upload → From the lap timer → прочитать сессию → «No internet right now — the session is kept on this phone…» → выключить Airplane Mode → через несколько секунд «1 session from the lap timer is uploaded».

## 5. Обновления

- **Сайт** (почти всё): просто деплой на GitHub Pages — приложение подхватит само.
- **Нативное** (иконка, адрес сайта, новые плагины): правка в `app/`, `sh build.sh`, Version/Build +1, Archive → Upload (iOS) и новый `.aab` (Android).
- **Адрес сайта** в `capacitor.config.json` → `server.url` (`https://hutka.ai/`). Если домен когда-нибудь поменяется — поправить и пересобрать обе платформы; Redirect URLs в Supabase и домены в Google от этого не зависят (`hutka://auth`).
- Иконка: `resources/icon.png` (1024×1024) и `resources/splash.png` — если дизайнер даст векторный логотип, замени картинки в `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` и в `android/app/src/main/res/mipmap-*/` (или сгенерируй командой `npx @capacitor/assets generate --iconBackgroundColor '#ffffff' --splashBackgroundColor '#ffffff'`).

## 6. Как это устроено (для разработчика)

- `capacitor.config.json` — `server.url` (живой сайт), `errorPath` (офлайн-страница для самого первого запуска без сети), `ios.limitsNavigationsToAppBoundDomains: true` (service worker в WKWebView, см. 4e), цвета сплэша и статус-бара.
- `ios/App/App/Info.plist` — URL-схема `hutka`, типы документов `.alf2/.gpx/.vbo/.csv` («Открыть в Hutka»), тексты разрешений на фото/камеру, все ориентации, `ITSAppUsesNonExemptEncryption=false`.
- `android/app/src/main/AndroidManifest.xml` — intent-filter'ы для `hutka://auth` и файлов; `MainActivity.java` переупаковывает «Поделиться» (ACTION_SEND) в ACTION_VIEW, который Capacitor отдаёт сайту событием `appUrlOpen`.
- На стороне сайта всё в `NATIVE` (`app_core.js`): `appUrlOpen` → либо `finishSignIn(url)` (токены из `hutka://auth#…` или `?code=` → сессия Supabase), либо чтение файла через плагин Filesystem → `UPLOAD.withFiles`. Вход через Google/Apple в приложении идёт через плагин Browser (`skipBrowserRedirect`).
- Плагины: `@capacitor/app`, `browser`, `filesystem`, `share`, `splash-screen`, `status-bar`, `push-notifications`, `haptics`, `@capawesome/capacitor-badge`, `@capacitor-community/bluetooth-le` (прибор по Bluetooth, см. 4d). Сайт вызывает их через мост, который оболочка внедряет в страницу (`Capacitor.nativePromise(plugin, method, options)` и `Capacitor.addListener(plugin, event, cb)`), поэтому JS-рантайм Capacitor в бандл сайта не входит — сайт остаётся обычным сайтом для браузеров.
