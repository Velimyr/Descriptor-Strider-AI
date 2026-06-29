<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/978cefb1-ebed-4c90-be27-876a769328ef

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Інтеграція з системою «Карма» Генеалогічного навігатора

Telegram-бот синхронізує бали користувачів із системою «Карма» сайту
[uagenealogy.com](https://www.uagenealogy.com). Ідентифікатор користувача для API
(поле `login`) — це числовий `telegram_id`, переданий рядком.

### Налаштування

Додайте змінну середовища (див. [.env.example](.env.example)):

- `KARMA_TOKEN` — Bearer-токен для запитів до API Карми (`Authorization: Bearer <KARMA_TOKEN>`).
  Видається адміністратором Навігатора. **Не зашивайте токен у код.**

Базовий URL API (`https://www.uagenealogy.com`) задається в
[`src/telegram-bot/config.ts`](src/telegram-bot/config.ts) → `karma.baseUrl`.

### 1. Команда `/linknavigator <КОД>`

Привʼязує Telegram-акаунт до Карми за одноразовим кодом із сайту Навігатора
(діє 15 хв). Користувач надсилає боту, наприклад: `/linknavigator AB12CD34EF`.
Бот викликає `POST /api/karma/link-redeem` з тілом
`{ "code", "login": "<telegram_id>", "total": <поточний сумарний бал> }`
(поле `total` додається, лише якщо в користувача вже є бали — тоді вони
нараховуються одразу під час привʼязки).

Додайте команду в меню бота через BotFather (`/setcommands`):

```
linknavigator - Привʼязати акаунт до Генеалогічного навігатора
```

### 2. Нічна синхронізація балів (ingest)

Раз на добу `GET /api/telegram/cron/karma-ingest` (тригериться GitHub Actions —
окремий workflow [`.github/workflows/karma-ingest.yml`](.github/workflows/karma-ingest.yml),
cron `0 1 * * *` UTC) збирає ПОТОЧНІ сумарні бали всіх користувачів і відправляє
їх у `POST /api/karma/ingest` пачками по ~500. Бали лише зростають: менший `total`
нічого не змінює. Не привʼязані користувачі повертаються у полі `unknown` —
це не помилка. Ендпоінт захищений тим самим `TELEGRAM_CRON_SECRET`.

**Ручний запуск:** GitHub → вкладка **Actions** → workflow **«Karma ingest»** →
кнопка **Run workflow**. Це окремий workflow, тож ручний запуск виконує лише
синхронізацію Карми і не зачіпає розсилку справ. Альтернатива — прямий виклик:
`curl "https://<домен>/api/telegram/cron/karma-ingest?secret=$TELEGRAM_CRON_SECRET"`.
