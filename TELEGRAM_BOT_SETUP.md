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

## 3. Підготувати Google Spreadsheet + Service Account

Бот авторизується в Sheets як **Service Account** — окремий "робот-акаунт" Google, без OAuth-екранів і refresh-токенів.

### 3.1. Створити Google-таблицю

1. Створіть нову Google-таблицю. Скопіюйте її **ID** з URL (`https://docs.google.com/spreadsheets/d/`**`<ID>`**`/edit`).
   Це значення для `TELEGRAM_SPREADSHEET_ID`.
2. Аркуші створювати вручну не треба — їх створить ініціалізація з адмінки.

### 3.2. Створити Service Account

1. Зайдіть у [Google Cloud Console](https://console.cloud.google.com/) → виберіть (або створіть) проєкт.
2. **APIs & Services → Library** → знайдіть **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts** → **Create service account**.
   - Name: будь-яке, напр. `descriptor-bot`.
   - **Create and Continue** → пропустити ролі (для Sheets вони не потрібні) → **Done**.
4. Відкрийте створений service account → вкладка **Keys** → **Add Key → Create new key → JSON** → файл `*.json` завантажиться.
5. Відкрийте JSON-файл — скопіюйте поле `client_email` (виглядає як `bot@your-project.iam.gserviceaccount.com`).

### 3.3. Поділитися таблицею з Service Account

1. Відкрийте свою Google-таблицю → **Share** (Поділитися).
2. Вставте `client_email` з попереднього кроку → роль **Editor** → **Send** (галочку "Notify" можна зняти).

### 3.4. Підготувати JSON для env-змінної

Service Account авторизується через JSON-ключ. Vercel приймає env-змінні як рядки, тож JSON треба передати одним рядком. Два варіанти:

**A. Сирий JSON** (одним рядком, якщо ваше середовище це підтримує):
- Відкрийте JSON-файл → скопіюйте весь вміст → вставте як значення `TELEGRAM_GOOGLE_SERVICE_ACCOUNT`. Vercel UI підтримує багаторядкові значення.

**B. Base64 (рекомендовано, не ламається ніколи):**

```bash
# macOS / Linux
base64 -i path/to/key.json | pbcopy   # macOS — копіює у буфер
base64 -w0 path/to/key.json           # Linux

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("path\to\key.json"))
```

Отриманий рядок (без переносів) вставте у `TELEGRAM_GOOGLE_SERVICE_ACCOUNT`. Бот сам визначить, чи це JSON, чи base64.

> ⚠️ JSON-файл містить приватний ключ — не комітьте його в репозиторій, додайте `*.json` у `.gitignore` якщо тримаєте локально.

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
| `TELEGRAM_SPREADSHEET_ID` | ID Google-таблиці | крок 3.1 |
| `TELEGRAM_GOOGLE_SERVICE_ACCOUNT` | вміст JSON-ключа (raw або base64) | крок 3.4 |

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

**Інше вікно** — також тут. Конфіг в `src/telegram-bot/config.ts` (`dispatch.startHourKyiv`, `endHourKyiv`, `intervalHours`) повинен **збігатися** з cron-розкладом, бо ендпоінт `/cron/tick` сам перевіряє "чи зараз вікно".

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

**`Missing env TELEGRAM_GOOGLE_SERVICE_ACCOUNT` або `is not valid JSON`.**
Перевірте, що змінна реально додана у Vercel + зроблено Redeploy. Якщо передавали raw JSON — переконайтеся, що Vercel зберіг його повністю (часом обрізає на спецсимволах). Найнадійніший варіант — base64 (крок 3.4).

**`The caller does not have permission` / `Requested entity was not found` при роботі з Sheets.**
Service Account не має доступу до таблиці. Відкрийте Google-таблицю → Share → додайте `client_email` з JSON-ключа (виглядає як `xxx@yyy.iam.gserviceaccount.com`) як **Editor**.

**Записи не зʼявляються в Results.**
Перевірте `TELEGRAM_SPREADSHEET_ID` (ID а не URL) і що Sheets API увімкнено в Google Cloud Console для проєкту, з якого ви створили service account.

**Усі справи показалися 3+ разів — більше не приходить.**
Це норма (`cases.allowExtraAfterTarget` контролює "добивати чи ні"). Бот повідомить "Усі доступні справи вже опрацьовано".

---

## 11. Безпека

- `TELEGRAM_WEBHOOK_SECRET` — Telegram передає його в заголовку `x-telegram-bot-api-secret-token`. Бекенд перевіряє і відкидає підроблені виклики.
- `TELEGRAM_CRON_SECRET` — захищає `/cron/*` і `/admin/*` від несанкціонованих викликів.
- Адмін-UI зберігає секрет у `localStorage` — не діліться браузером.
- Service Account має доступ **тільки** до тих таблиць, які ви явно з ним поділили. Не до всього Drive і не до вашого особистого акаунта.
- JSON-ключ service account = доступ. Не комітьте файл і не діліться змістом env-змінної.

---

## 12. Що далі

- Додати `display_name` редагування — `/setname Іван`.
- Розширити сховище: якщо впремось у ліміти Sheets API (~300 read+write/min на проєкт — для десятків юзерів цього вистачить за очі), можна поміняти `api/telegram/storage.ts` на Vercel KV без зміни логіки бота.
- Розклад розсилки можна перенести на cron-job.org замість GitHub Actions — той самий ендпоінт.
