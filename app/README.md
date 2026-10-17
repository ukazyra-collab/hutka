# Hutka — приложение для iPhone и Android

Папка `app/` — это нативная оболочка (Capacitor) вокруг сайта Hutka. Приложение открывает **живой сайт** (`server.url` в `capacitor.config.json`), поэтому всё, что выкатывается на сайт, появляется в приложении сразу, без новой сборки и без ревью. Пересобирать приложение нужно только когда меняется нативная часть: иконка, адрес сайта, плагины.

Что умеет нативная часть сверх сайта:
- **Вход** через Google / Apple / ссылку на почту открывает системный браузер и возвращается в приложение по ссылке `hutka://auth` (Google запрещает вход внутри встроенного браузера — поэтому так).
- **«Открыть в Hutka»**: файл `.alf2` (и `.gpx`, `.vbo`, `.csv`) из приложения Alfano, Файлов или мессенджера сразу попадает в окно загрузки сессии.
- Поворот экрана не заблокирован (кокпит в Lab работает горизонтально), сплэш-экран, статус-бар под цвет приложения.
- Офлайн-страница, если нет сети (`www/offline.html`).

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
4. **Аккаунт для ревью Apple.** Проверяющим нужен вход без почты: Supabase → Authentication → Users → **Add user** → почта `review@hutka.ai` (любая), пароль, «Auto confirm». В приложении в окне входа есть «У меня есть пароль». Эту пару укажешь в App Store Connect → App Review Information.

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

Драйверы приборов живут на сайте в `device.js` (`LOGGERS`):
- **RaceBox Mini S / Micro** — готов. Протокол опубликован производителем (RaceBox BLE Protocol Documentation rev. 9): UART-сервис `6E400001-…`, кадры B5 62 | class | id | len | payload | CK_A CK_B; статус памяти `FF 22`, разблокировка `FF 30` (4 байта кода), выгрузка `FF 23` → поток записей `FF 21` (80 байт, как live-сообщение) и меток старт/стоп `FF 26` → ACK `FF 02 [FF 23]`, стирание `FF 24`. Записи режутся на заезды по меткам старта и паузам > 2 мин, идут в универсальный импорт как CSV 25 Гц (`RaceBox <дата>.csv`), круги режутся по замыканию петли и выравниваются по S/F разметки.
- **Alfano 6 / 7** — слот есть (`LOGGERS.drivers.alfano`, `ready: false`), протокола пока нет. Это порт скачивальщика + декодера Паши (Pavel Go-ski) с Mac. Чтобы перенести, нужно от него одно из:
  1. исходники (Swift / Python / что угодно) — лучше всего: и BLE-часть, и декодер;
  2. или описание протокола: имя/префикс прибора в эфире, UUID сервиса и характеристик (запись / уведомления), последовательность команд (рукопожатие, список сессий, скачивание одной сессии, подтверждения), формат ответов, как выглядит конец передачи, нужен ли MTU/пейринг, что отличается у Alfano 6 и 7;
  3. плюс пару сырых дампов: байты, пришедшие с прибора за одну сессию, и файл `.alf2`, который из них делает его декодер (если декодер пишет именно `.alf2` — наш `alf.js` возьмёт его как есть; если другой формат — переносим и декодер).
  С этим драйвер — это `open(H)` в `device.js`: `list()` → `[{id, name, date, laps, best}]`, `download(item, onProgress)` → `File` (`.alf2`) → тот же `UPLOAD.withFiles`. Окно, прогресс, выбор заездов, iOS/Android/Chrome — уже общие.

## 5. Обновления

- **Сайт** (почти всё): просто деплой на GitHub Pages — приложение подхватит само.
- **Нативное** (иконка, адрес сайта, новые плагины): правка в `app/`, `sh build.sh`, Version/Build +1, Archive → Upload (iOS) и новый `.aab` (Android).
- **Адрес сайта** в `capacitor.config.json` → `server.url` (`https://hutka.ai/`). Если домен когда-нибудь поменяется — поправить и пересобрать обе платформы; Redirect URLs в Supabase и домены в Google от этого не зависят (`hutka://auth`).
- Иконка: `resources/icon.png` (1024×1024) и `resources/splash.png` — если дизайнер даст векторный логотип, замени картинки в `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` и в `android/app/src/main/res/mipmap-*/` (или сгенерируй командой `npx @capacitor/assets generate --iconBackgroundColor '#ffffff' --splashBackgroundColor '#ffffff'`).

## 6. Как это устроено (для разработчика)

- `capacitor.config.json` — `server.url` (живой сайт), `errorPath` (офлайн-страница), цвета сплэша и статус-бара.
- `ios/App/App/Info.plist` — URL-схема `hutka`, типы документов `.alf2/.gpx/.vbo/.csv` («Открыть в Hutka»), тексты разрешений на фото/камеру, все ориентации, `ITSAppUsesNonExemptEncryption=false`.
- `android/app/src/main/AndroidManifest.xml` — intent-filter'ы для `hutka://auth` и файлов; `MainActivity.java` переупаковывает «Поделиться» (ACTION_SEND) в ACTION_VIEW, который Capacitor отдаёт сайту событием `appUrlOpen`.
- На стороне сайта всё в `NATIVE` (`app_core.js`): `appUrlOpen` → либо `finishSignIn(url)` (токены из `hutka://auth#…` или `?code=` → сессия Supabase), либо чтение файла через плагин Filesystem → `UPLOAD.withFiles`. Вход через Google/Apple в приложении идёт через плагин Browser (`skipBrowserRedirect`).
- Плагины: `@capacitor/app`, `browser`, `filesystem`, `share`, `splash-screen`, `status-bar`, `push-notifications`, `haptics`, `@capawesome/capacitor-badge`, `@capacitor-community/bluetooth-le` (прибор по Bluetooth, см. 4d). Сайт вызывает их через мост, который оболочка внедряет в страницу (`Capacitor.nativePromise(plugin, method, options)` и `Capacitor.addListener(plugin, event, cb)`), поэтому JS-рантайм Capacitor в бандл сайта не входит — сайт остаётся обычным сайтом для браузеров.
