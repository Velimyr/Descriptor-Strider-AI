# Telegram-бот: інструкція налаштування

Покрокова інструкція "з нуля" — від створення бота в Telegram до робочої розсилки на Vercel Hobby.

---

## 0. Що ми будемо налаштовувати

- **Бот у Telegram** — отримує/шле повідомлення.
- **Приватний канал** — сховище картинок справ.
- **Google Spreadsheet** — і результати, і службовий стан бота (без окремої БД).
- **Vercel** — хостинг (існуючий деплой).
- **GitHub Actions** — зовнішній cron (бо Vercel Hobby не дає погодинний cron).

Усі налаштування коду — у файлі [`src/telegram-bot/config.ts`](src/telegram-bot/config.ts).
Секрети — у Vercel **Environment Variables**.

---

## 1. Створити Telegram-бота

1. Відкрийте чат із [@BotFather](https://t.me/BotFather) у Telegram.
2. `/newbot` → задайте імʼя і `username` (має закінчуватися на `bot`).
3. Збережіть **bot token** — це значення для `TELEGRAM_BOT_TOKEN`.
4. У BotFather: `/setprivacy` → виберіть бота → `Disable` (щоб бот бачив усі повідомлення в особистих чатах — особистих це не критично, але хай буде).

---

## 2. Створити приватний канал-сховище

1. У Telegram: New Channel → **Private**. Назва — будь-яка, напр. "Descriptor Cases Storage".
2. Додайте свого бота в адміни цього каналу: `Manage Channel` → `Administrators` → `Add Administrator` → знайти за username → дати права **Post Messages** (мінімум).
3. Дізнайтеся **числовий ID каналу**:
   - Перешліть будь-яке повідомлення з каналу боту [@getidsbot](https://t.me/getidsbot) — він покаже `Origin chat → ID: -100xxxxxxxxxx`.
   - Це значення для `TELEGRAM_CHANNEL_ID` (з префіксом `-100`).

---

## 3. Створити базу Supabase

Бот зберігає **весь стан** (юзери, справи, сесії, бали, **результати**) у Postgres-базі Supabase. Швидко, надійно, безкоштовно.

### 3.1. Створити проєкт

1. Зайдіть на [supabase.com](https://supabase.com) → Sign in (через GitHub або email).
2. **New project** → виберіть organization → задайте Name (напр. `descriptor-bot`), сильний пароль БД (запам'ятати не треба — він не буде потрібен), регіон ближче до Vercel (Frankfurt чи London для Європи).
3. Зачекайте 1-2 хв доки інстанс створиться.

### 3.2. Запустити схему

1. Лівий сайдбар → **SQL Editor** → **New query**.
2. Скопіюйте весь вміст файлу [supabase/schema.sql](supabase/schema.sql) → вставте → **Run**.
3. Має бути зелене "Success. No rows returned." В Table Editor мають з'явитися таблиці `bot_users`, `bot_cases`, `bot_sessions`, `bot_submissions`, `bot_daily_scores`, `bot_dispatch_log`, `bot_meta`.

### 3.3. Скопіювати credentials

1. Лівий сайдбар → **Project Settings** (іконка шестерні внизу) → **Data API**.
2. Знайдіть і скопіюйте:
   - **Project URL** — це значення для env `SUPABASE_URL` (виглядає як `https://xxxxx.supabase.co`).
   - **service_role** secret (вкладка **API Keys** → секція "Legacy API keys" або "service_role" з правами bypass RLS) — це значення для `SUPABASE_SERVICE_KEY`.

> ⚠️ **`service_role` key — повний доступ до БД, обходить RLS.** Тримайте лише в env-змінних Vercel і `.env.local`. Не комітьте, не показуйте в UI, не давайте клієнту/браузеру.

### 3.4. Модель доступу (RLS)

SQL-схема [supabase/schema.sql](supabase/schema.sql) **вмикає RLS на всіх таблицях бота і не створює жодних policies**. Це означає:

- `anon` ключ (публічний, видно у Project Settings → API) і `authenticated` ключі — **не мають доступу ні до читання, ні до запису**. Якщо хтось знайде ваш `anon` key — нічого з нього не отримає.
- `service_role` ключ (секретний, тільки в Vercel env) — обходить RLS, тож наш бекенд працює як треба.

Не вимикайте RLS у Dashboard, не додавайте `policy for all using (true)` — це відкриє дані назовні. Якщо колись захочете дати фронтенду прямий read-only доступ (напр. публічний leaderboard) — додавайте конкретну policy для конкретної ролі і конкретної таблиці, а не "пускай усіх".

### 3.5. Безкоштовний план — нюанси

- 500 MB БД, 5 GB трафіку — для бота вистачить на роки.
- **Інстанс паузиться після 7 днів повної неактивності.** Розпауза — 1 клік у Dashboard. Бот без дзвінків до БД (нічого не пишемо/читаємо) — вкрай малоймовірно для робочого бота.

`GOOGLE_CLIENT_ID` і `GOOGLE_CLIENT_SECRET` уже мають бути налаштовані для основного функціоналу — використовуємо їх же.

---

## 4. Налаштувати Environment Variables на Vercel

У Vercel → Project → Settings → Environment Variables додайте:

| Змінна | Значення | Звідки |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `123:ABC...` | BotFather, крок 1 |
| `TELEGRAM_CHANNEL_ID` | `-100xxxxxxxxxx` | крок 2 |
| `TELEGRAM_WEBHOOK_SECRET` | будь-який рядок (32+ символи) | згенеруйте: `openssl rand -hex 24` |
| `TELEGRAM_CRON_SECRET` | будь-який рядок | `openssl rand -hex 24` |
| `TELEGRAM_ADMIN_LOGIN` | логін адміна (напр. `admin`) | вигадайте |
| `TELEGRAM_ADMIN_PASSWORD` | пароль адміна | вигадайте сильний |
| `SUPABASE_URL` | Project URL з Supabase | крок 3.3 |
| `SUPABASE_SERVICE_KEY` | service_role key | крок 3.3 |

**Усі — для Production + Preview + Development.** Передеплойте після додавання.

Локально дублюйте все в `.env.local` (його не комітимо).

---

## 5. Ініціалізувати бота через адмінку

> 🔒 **Адмінка прихована від звичайних користувачів.** Кнопки в UI немає — заходите за прямим URL `https://your-domain.vercel.app/#telegram-admin`. Далі — логін/пароль (`TELEGRAM_ADMIN_LOGIN` / `TELEGRAM_ADMIN_PASSWORD`).

1. Відкрийте `https://your-domain.vercel.app/#telegram-admin`.
2. Введіть логін і пароль. Чекбокс «Запамʼятати на цьому пристрої» — щоб не вводити при кожному вході; інакше токен живе тільки до закриття вкладки.
3. **Вкладка "Налаштування":**
   - Адмінка перевірить env-змінні. Якщо все ✅ — натисніть **«Ініціалізувати бота (аркуші + webhook)»**. Одна кнопка створює службові аркуші і налаштовує webhook на поточний домен.
4. Кнопка **«Вийти»** в шапці адмінки — стирає токен і повертає на форму логіну.

4. **Вкладка "Питання":**
   - Або натисніть **"Імпортувати з активного проєкту"** (візьме `tableStructure` поточного проєкту), або відредагуйте вручну.
   - Натисніть **Зберегти**.

5. **Вкладка "Підготовка справ":**
   - Завантажте PDF.
   - Оберіть режим:
     - **Ручний** — мишкою малюйте прямокутники навколо кожної справи. Один прямокутник = одна справа.
     - **Авто (Gemini)** — натисніть **Розпізнати**. Gemini поверне рамки. **Перевірте і скоригуйте** — додайте/видаліть прямокутники якщо треба.
   - Натисніть **Завантажити в канал** — бот залʼє кожен фрагмент у приватний канал, і вони стануть доступні для розсилки.
   - Повторіть для всіх потрібних сторінок.

6. **Вкладка "Огляд":** прогрес і таблиця користувачів зʼявляться, коли почнуть приходити відповіді.

---

## 6. Налаштувати GitHub Actions cron

Файл `.github/workflows/telegram-tick.yml` уже в репозиторії. Залишилось задати секрети:

1. GitHub → ваш репозиторій → Settings → Secrets and variables → Actions → **New repository secret**:
   - `TELEGRAM_BASE_URL` = `https://your-domain.vercel.app`
   - `TELEGRAM_CRON_SECRET` = те саме значення, що у Vercel.

2. Закомітьте і запушіть workflow-файл (якщо ще не):
   ```bash
   git add .github/workflows/telegram-tick.yml
   git commit -m "Add Telegram bot cron"
   git push
   ```

3. Перевірка: GitHub → Actions → "Telegram bot tick" → **Run workflow** (manual trigger). Якщо все ОК — зелена галочка.

### Розклад

За замовчуванням у `.github/workflows/telegram-tick.yml`:

```
- cron: '0 7,10,13,16 * * *'    # розсилка: 10/13/16/19 за Києвом (літній час, UTC+3)
- cron: '15 * * * *'             # cleanup протермінованих сесій — щогодини
```

**Зимовий час** (Київ UTC+2): замініть `7,10,13,16` на `8,11,14,17`.

**Інше вікно** — також тут. Розсилку тепер визначає сам cron у GitHub Actions: якщо джоба `dispatch` запустилася, бот одразу пробує відправити справи активним користувачам.

---

## 7. Перевірка end-to-end

1. У Telegram знайдіть свого бота → `/start`.
2. Бот привітає і попросить імʼя — введіть.
3. Надішліть `/next` — має прийти фото справи + перше питання.
4. Дайте відповіді, натисніть **✅ Підтвердити**.
5. Перевірте Google-таблицю → аркуш `Results` — там має зʼявитися рядок.
6. `/stats` → бот покаже бали.
7. `/progress` → відсоток виконання.
8. `/leaderboard` → топ-10.

---

## 8. Налаштування поведінки

Все живе в `src/telegram-bot/config.ts`. Після правки — `git push` (Vercel автоматично переплоїть).

| Що | Ключ |
|---|---|
| Час початку/кінця розсилок | `dispatch.startHourKyiv`, `endHourKyiv` |
| Крок між розсилками | `dispatch.intervalHours` |
| Мін. підтверджень для "done" | `cases.targetSubmissions` |
| Бали і множники | `points.base`, `tier1`, `tier2` |
| Таймаут невідповіді | `dispatch.sessionTtlHours` |
| Авто-пауза після N пропусків | `dispatch.unanswered_pauseAfter` |
| Стовпець "Джерело" | `sheets.sourceLink.mode` (`telegram_message` / `custom_url` / `none`) і `template` |
| Тексти повідомлень бота | `texts.*` |
| Промпт авто-нарізки | `slicing.autoPrompt`, `autoModel` |

---

## 9. Команди бота для користувачів

| Команда | Що робить |
|---|---|
| `/start` | реєстрація |
| `/next` | отримати справу зараз |
| `/cancel` | скасувати поточну справу (нічого не записується) |
| `/stats` | мої бали, місце в топі |
| `/progress` | загальний прогрес обробки |
| `/leaderboard` | топ-10 |
| `/stop` | пауза розсилок |
| `/resume` | відновити |
| `/help` | список команд |

---

## 10. Поширені проблеми

**Бот не відповідає на `/start`.**
Перевірте: вкладка Налаштування → **Webhook → Інфо**. У відповіді має бути `url` зі вашим доменом і `pending_update_count: 0`. Якщо `last_error_message` — там опис.

**Cron не спрацьовує.**
GitHub → Actions → "Telegram bot tick" → подивіться логи останніх запусків. Cron в Actions може запізнюватися на 5–15 хв і не виконується якщо репо неактивне 60 днів.

**Картинка не вантажиться в канал.**
Бот повинен бути адміном каналу з правом **Post Messages**. Перевірте `TELEGRAM_CHANNEL_ID` починається з `-100`.

**`Missing env SUPABASE_URL / SUPABASE_SERVICE_KEY`.**
Перевірте, що обидві змінні додано в Vercel і зроблено Redeploy.

**`relation "bot_users" does not exist"` (або інша таблиця).**
Не запущена SQL-схема. Зайдіть у Supabase → SQL Editor → запустіть [supabase/schema.sql](supabase/schema.sql).

**`Invalid API key` / `JWT expired`.**
Ви скопіювали `anon` key замість `service_role`. У Project Settings → Data API → API Keys беріть саме `service_role`.

**Інстанс паузнутий ("Project is paused").**
Supabase free паузить після 7 днів неактивності. Зайдіть у Dashboard і натисніть Restore — займе ~30 секунд.

**Записи не зʼявляються в `bot_submissions`.**
Дивіться Vercel Function Logs, фільтр `/api/telegram/webhook`. Помилки RLS / permission означають, що використано anon key замість service_role.

**Усі справи показалися 3+ разів — більше не приходить.**
Це норма (`cases.allowExtraAfterTarget` контролює "добивати чи ні"). Бот повідомить "Усі доступні справи вже опрацьовано".

---

## 11. Безпека

- `TELEGRAM_WEBHOOK_SECRET` — Telegram передає його в заголовку `x-telegram-bot-api-secret-token`. Бекенд перевіряє і відкидає підроблені виклики.
- `TELEGRAM_CRON_SECRET` — захищає `/cron/*` і `/admin/*` від несанкціонованих викликів.
- Адмін-UI зберігає секрет у `localStorage` — не діліться браузером.
- Supabase `service_role` key = повний доступ до БД, обходить RLS. Тримайте лише в env-змінних серверного боку (Vercel + локальний `.env.local`). Ніколи не передавайте у клієнтський JS.
- Якщо ключ скомпрометовано — у Project Settings → API можна перегенерувати.

---

## 12. Що далі

- Додати `display_name` редагування — `/setname Іван`.
- Якщо потрібен експорт результатів у Google Sheets для звітів — можна додати окрему функцію, яка раз на день/годину переливає `bot_submissions` у Spreadsheet.
- Розклад розсилки можна перенести на cron-job.org замість GitHub Actions — той самий ендпоінт.
