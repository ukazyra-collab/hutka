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

Почта поддержки `hello@hutkakart.com` указана в политике конфиденциальности (`privacy.html` на сайте) — заведи такой ящик или поменяй адрес в файле.

## 1. Supabase и Google — две галочки для приложения

1. Supabase → **Authentication → URL Configuration → Redirect URLs** → добавь `hutka://auth` (рядом с адресом сайта). Без этого вход из приложения не вернётся обратно.
2. Google Cloud (если включён вход через Google) — ничего менять не нужно: redirect там один и тот же, на Supabase.
3. **Sign in with Apple** — обязателен для App Store, если в приложении есть кнопка Google (правило 4.8). Пока Apple-вход не настроен, приложение само прячет кнопку Google и оставляет вход по ссылке на почту — так тоже можно публиковаться. Чтобы включить:
   - developer.apple.com → **Certificates, Identifiers & Profiles** → Identifiers → App IDs → `com.hutkakart.app` → включи **Sign in with Apple**.
   - Там же → Identifiers → **Services IDs** → новый, например `com.hutkakart.web`, включи Sign in with Apple, Configure: домен `tqixfqrludqpxqxypiia.supabase.co`, Return URL `https://tqixfqrludqpxqxypiia.supabase.co/auth/v1/callback`.
   - Keys → новый ключ с Sign in with Apple → скачай `.p8`, запомни Key ID и Team ID.
   - Supabase → Authentication → Providers → **Apple** → Services ID, Team ID, Key ID, содержимое `.p8` → Save.
   - В `config.js` на сайте поставь `appleAuth: true` — появится кнопка  Apple (и в приложении вернётся Google).
4. **Аккаунт для ревью Apple.** Проверяющим нужен вход без почты: Supabase → Authentication → Users → **Add user** → почта `review@hutkakart.com` (любая), пароль, «Auto confirm». В приложении в окне входа есть «У меня есть пароль». Эту пару укажешь в App Store Connect → App Review Information.

## 2. Сборка на Mac

```bash
git clone https://github.com/ukazyra-collab/hutka.git
cd hutka/app
npm install
sh build.sh          # копирует файлы сайта в www и синхронизирует ios/ и android/
npx cap open ios     # откроется Xcode (первый раз он минуту-две качает Swift-пакеты Capacitor)
```

В Xcode:
1. Слева выбери проект **App** → target **App** → вкладка **Signing & Capabilities** → **Team** = твоя команда разработчика (Automatically manage signing — включено). Bundle Identifier уже `com.hutkakart.app`.
2. Подключи iPhone кабелем, выбери его в списке устройств сверху → ▶ Run. Первый раз на телефоне: Настройки → Основные → VPN и управление устройством → доверять разработчику.
3. Проверь: вход, поворот в Lab, «Поделиться .alf2 → Hutka» из приложения Alfano.

Версия приложения: Xcode → target App → General → **Version** (1.0) и **Build** (1). Каждая новая загрузка в App Store Connect — Build +1.

## 3. App Store Connect — заявка

1. https://appstoreconnect.apple.com → **My Apps → + → New App**: Platforms iOS, Name **Hutka**, Primary Language English, Bundle ID `com.hutkakart.app`, SKU `hutka`, Full Access.
2. **App Information**: Category **Sports** (Secondary — Utilities), Content Rights — не содержит стороннего контента, Age Rating → опросник → 4+.
3. **App Privacy** → Privacy Policy URL: `https://ukazyra-collab.github.io/hutka/privacy.html` (после переезда — `https://hutkakart.com/privacy.html`). Data Types: Email Address, Name, Photos (аватар), User Content (сессии, комментарии), Identifiers (User ID) — **Linked to the user**, **not used for tracking**. Crash Data / Analytics — нет.
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

## 5. Обновления

- **Сайт** (почти всё): просто деплой на GitHub Pages — приложение подхватит само.
- **Нативное** (иконка, адрес сайта, новые плагины): правка в `app/`, `sh build.sh`, Version/Build +1, Archive → Upload (iOS) и новый `.aab` (Android).
- **Переезд на hutkakart.com**: в `capacitor.config.json` поменяй `server.url` на `https://hutkakart.com/`, `allowNavigation` там уже есть; пересобери обе платформы. Redirect URLs в Supabase и домены в Google менять **не надо** — `hutka://auth` от домена не зависит.
- Иконка: `resources/icon.png` (1024×1024) и `resources/splash.png` — если дизайнер даст векторный логотип, замени картинки в `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` и в `android/app/src/main/res/mipmap-*/` (или сгенерируй командой `npx @capacitor/assets generate --iconBackgroundColor '#ffffff' --splashBackgroundColor '#ffffff'`).

## 6. Как это устроено (для разработчика)

- `capacitor.config.json` — `server.url` (живой сайт), `errorPath` (офлайн-страница), цвета сплэша и статус-бара.
- `ios/App/App/Info.plist` — URL-схема `hutka`, типы документов `.alf2/.gpx/.vbo/.csv` («Открыть в Hutka»), тексты разрешений на фото/камеру, все ориентации, `ITSAppUsesNonExemptEncryption=false`.
- `android/app/src/main/AndroidManifest.xml` — intent-filter'ы для `hutka://auth` и файлов; `MainActivity.java` переупаковывает «Поделиться» (ACTION_SEND) в ACTION_VIEW, который Capacitor отдаёт сайту событием `appUrlOpen`.
- На стороне сайта всё в `NATIVE` (`app_core.js`): `appUrlOpen` → либо `finishSignIn(url)` (токены из `hutka://auth#…` или `?code=` → сессия Supabase), либо чтение файла через плагин Filesystem → `UPLOAD.withFiles`. Вход через Google/Apple в приложении идёт через плагин Browser (`skipBrowserRedirect`).
- Плагины: `@capacitor/app`, `browser`, `filesystem`, `share`, `splash-screen`, `status-bar`. Сайт вызывает их через мост, который оболочка внедряет в страницу (`Capacitor.nativePromise(plugin, method, options)` и `Capacitor.addListener(plugin, event, cb)`), поэтому JS-рантайм Capacitor в бандл сайта не входит — сайт остаётся обычным сайтом для браузеров.
