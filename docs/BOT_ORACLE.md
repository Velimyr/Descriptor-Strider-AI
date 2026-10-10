# Бот на Oracle Cloud Always Free

Telegram-бот працює на безкоштовній VM в Oracle Cloud. Сайт, віджет, «Перевірка» й адмінка
лишаються на Vercel. Обидві частини працюють з однією базою Supabase, тому для користувачів
нічого не змінюється.

```
Vercel: сайт, віджет, адмінка, API         Oracle VM: bot-server.ts
                 \                          ├─ getUpdates (long polling)
                  \                         └─ крони за київським часом
                   └──── Supabase ────────┘
```

**Що робить `bot-server.ts`**

- **Отримує апдейти через long polling (`getUpdates`).** Тому на VM не потрібні відкриті
  порти, домен і сертифікат.
- **Запускає крони за київським часом**, тож перехід на зимовий чи літній час нічого не
  зсуває:
  - розсилка справ о 10/13/16/19 (години беруться з `config.dispatch`);
  - cleanup щогодини о :15;
  - group-tick кожні 15 хв (:05/:20/:35/:50);
  - karma-ingest о 04:00.

  Це замінює `.github/workflows/telegram-tick.yml` і `karma-ingest.yml`.
- **Обробляє апдейти так само, як на Vercel**: виклик `processUpdate` і ті самі маршрути
  `/api/telegram/cron/*`. Маршрути слухають лише на `127.0.0.1:3100` і ззовні недоступні.
- **Підхоплює незавершену розсилку.** Якщо процес перезапустився посеред розсилки, він
  продовжує її сам.

**Перемикання і відкат**

- **Перемикання.** Ви видаляєте вебхук (`deleteWebhook`), і з цього моменту апдейти
  забирає VM.
- **Відкат.** Ви знову встановлюєте вебхук на Vercel (кнопка в адмінці). Після цього VM
  отримує відповідь `409` на кожен запит апдейтів і просто чекає, нічого не обробляючи.

---

## 0. Перед початком

1. **`main` не чіпати**: на ньому працюють користувачі. VM бере код з гілки `develop`.
   Vercel робить з неї лише preview-деплой, продакшн не змінюється.
2. Закомітьте й запуште зміни для VM у `develop`.
3. ⚠️ Бот на VM працює з бойовою базою і реальними користувачами, тож усе, що потрапить у
   `develop`, після `git pull` на VM одразу дійде до користувачів. Робіть `git pull` на VM
   лише тоді, коли `develop` готовий до релізу.

## 1. Реєстрація в Oracle Cloud

1. Зайдіть на <https://signup.cloud.oracle.com>.
2. Тип акаунта — **Individual**.
3. **Home Region: UK South (London).** Регіон обирається один раз і назавжди. Безкоштовні
   ресурси працюють лише в ньому, а London — найближчий регіон до Supabase в Ірландії.
4. Під час реєстрації з картки тимчасово блокують близько $1 для перевірки. Віртуальні та
   передплачені картки часто відхиляють. Якщо картку відхилили, спробуйте іншу.
5. Зачекайте, поки акаунт активують. Це від кількох хвилин до години.

## 2. SSH-ключ (на Mac)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oracle_bot -C oracle-bot
```

```bash
cat ~/.ssh/oracle_bot.pub
```

Вміст `.pub` знадобиться на наступному кроці.

## 3. Створення VM

Консоль → ☰ → **Compute → Instances → Create instance**.

| Поле | Значення |
|---|---|
| Name | `descriptor-bot` |
| Image | **Canonical Ubuntu 24.04** |
| Shape | **Ampere → VM.Standard.A1.Flex**, 1 OCPU, 6 GB RAM |
| Networking | Create new VCN + public subnet, **Assign a public IPv4 address** |
| SSH keys | Paste public key → вміст `~/.ssh/oracle_bot.pub` |
| Boot volume | За замовчуванням (~47 ГБ). Сумарно на всі диски безкоштовно до 200 ГБ. |

Біля обраної форми має бути позначка **Always Free-eligible**.

**Якщо бачите «Out of capacity»**

- Спробуйте інший **Availability domain** (AD-1/2/3).
- Або оберіть **Specialty and previous generation → VM.Standard.E2.1.Micro** (AMD, 1 ГБ RAM).
  Її зазвичай дають одразу, і її вистачить на бот. Для неї потрібен ще swap, див. крок 4.

Після створення скопіюйте **Public IP address** зі сторінки VM.

## 4. Підготовка сервера

```bash
ssh -i ~/.ssh/oracle_bot ubuntu@<PUBLIC_IP>
```

Далі всі команди виконуються на VM:

```bash
sudo apt update && sudo apt -y upgrade && sudo apt -y install git
```

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt -y install nodejs
```

```bash
node -v
```

Має вивести `v22.x`.

**Лише для E2.1.Micro (1 ГБ RAM).** Додайте swap, інакше `npm ci` може впасти через нестачу
пам'яті:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Відкривати порти у фаєрволі не потрібно: long polling лише робить вихідні запити. SSH
відкритий за замовчуванням.

## 5. Код

```bash
cd ~ && git clone https://github.com/Velimyr/Descriptor-Strider-AI.git && cd Descriptor-Strider-AI && git checkout develop && npm ci
```

## 6. Секрети (`.env`)

Потрібні **продакшн**-значення з Vercel (Project → Settings → Environment Variables):

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL_ID=
TELEGRAM_CRON_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
USER_KEY_ENC_SECRET=
WEB_SESSION_SECRET=
KARMA_TOKEN=
# TABLE_PREFIX — для проду НЕ задавати (порожній префікс)
# HEALTHCHECK_URL= — див. крок 10
```

**Варіант А: вручну.** На VM виконайте `nano ~/Descriptor-Strider-AI/.env`, вставте значення
і збережіть.

**Варіант Б: через Vercel CLI на Mac**, з кореня репозиторію:

```bash
vercel env pull .env.oracle --environment=production
```

```bash
scp -i ~/.ssh/oracle_bot .env.oracle ubuntu@<PUBLIC_IP>:~/Descriptor-Strider-AI/.env && rm .env.oracle
```

Змінні, позначені на Vercel як **Sensitive**, приходять порожніми, тож їх треба дописати
вручну.

Після цього на VM обмежте доступ до файлу:

```bash
chmod 600 ~/Descriptor-Strider-AI/.env
```

## 7. Пробний запуск

```bash
cd ~/Descriptor-Strider-AI && npm run bot
```

Очікувані рядки в логах:

- `[bot] старт; розсилка о 10, 13, 16, 19:00 (Europe/Kyiv)`
- `[poll] 409: вебхук встановлено…` — це **нормально**: бот поки працює через Vercel.

Якщо бачите `Missing env …` або помилки Supabase, виправте `.env`. Зупинка — `Ctrl+C`.

## 8. Запуск як сервісу

```bash
sudo cp ~/Descriptor-Strider-AI/deploy/descriptor-bot.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now descriptor-bot
```

```bash
journalctl -u descriptor-bot -f
```

Сервіс стартує сам після перезавантаження VM і перезапускається, якщо процес впаде.

## 9. Перемикання бота

Робіть це **не в момент розсилки**, тобто не о 10/13/16/19 за Києвом.

1. **Вимкніть крони в GitHub.** Відкрийте репозиторій → **Actions** → «Telegram bot tick» →
   ⋯ → **Disable workflow**. Те саме зробіть для «Karma ingest». Поки воркфлоу ще ввімкнені,
   GitHub і VM можуть смикнути один і той самий крон двічі. Це безпечно: ліза, кулдаун і
   клейми в `bot_meta` не дадуть зробити роботу двічі. Але зайвий CPU на Vercel від цього
   все одно витрачається.
2. **Видаліть вебхук.** На VM:
   ```bash
   cd ~/Descriptor-Strider-AI && export $(grep '^TELEGRAM_BOT_TOKEN=' .env | xargs) && curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
   ```
   Має повернути `{"ok":true,...}`. **Не** додавайте `drop_pending_updates`: тоді апдейти,
   що накопичились за час перемикання, будуть оброблені, а не викинуті.
3. **Перевірте.**
   - За хвилину в `journalctl -u descriptor-bot -f` перестануть з'являтися `409`.
   - Натисніть щось у боті: він має відповісти як завжди.
   - `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"` має
     показувати `"url":""`.
4. **Найближчий слот розсилки.** У логах мають з'явитися рядки
   `[cron] dispatch 1: status=partial…` і далі `…status=done`. О :05 ще має спрацювати
   `[cron] group-tick`.

Після перемикання адмінка може показувати, що вебхук не встановлено. Це очікувано.
**Не натискайте «Встановити вебхук»**: ця кнопка поверне бот на Vercel (див. відкат).

## 10. Моніторинг (рекомендовано)

1. Зареєструйтесь на <https://healthchecks.io>. Безкоштовно дають 20 перевірок.
2. Створіть перевірку з **Period 5 min** і **Grace 10 min**. Сповіщення можна отримувати на
   пошту або в Telegram.
3. Скопіюйте Ping URL і додайте в `.env` рядок `HEALTHCHECK_URL=https://hc-ping.com/…`.
4. Перезапустіть бот: `sudo systemctl restart descriptor-bot`.

Бот пінгує приблизно раз на хвилину, поки отримує апдейти від Telegram. Якщо процес
зависне, впаде або втратить мережу, ви отримаєте сповіщення.

## 11. Захист від забирання VM (рекомендовано)

Oracle може зупинити безкоштовну VM, якщо за 7 днів вона майже нічого не робила: CPU,
мережа і пам'ять нижче ~20%. Бот з малим навантаженням виглядає саме так.

- Захист: **Billing → Upgrade to Pay As You Go**. На акаунтах PAYG це правило не діє, а
  все в межах Always Free однаково коштує $0.
- Одразу створіть бюджет: **Billing → Budgets → Create budget** на $1 з алертом на пошту.
  Він попередить, якщо випадково з'явиться платний ресурс.

## Оновлення коду

Vercel деплоїться сам, а **VM — ні**. VM бере код з гілки, яку на ній витягнуто (спершу
`develop`). Після змін у цій гілці, що зачіпають `api/**`, `src/telegram-bot/**` або
залежності, оновіть VM:

```bash
cd ~/Descriptor-Strider-AI && git pull && npm ci && sudo systemctl restart descriptor-bot
```

Якщо деплой несе міграцію БД, порядок той самий, що й раніше: спершу SQL, потім код, і
тепер це стосується **обох** місць. Перезапуск посеред розсилки безпечний: раунд
продовжиться автоматично.

## Відкат на Vercel

1. В адмінці натисніть «Встановити вебхук». Або виконайте `setWebhook` на
   `https://<vercel-домен>/api/telegram/webhook` із `secret_token` = `TELEGRAM_WEBHOOK_SECRET`.
2. На VM зупиніть бот, щоб він не дублював крони:
   ```bash
   sudo systemctl stop descriptor-bot
   ```
3. У GitHub → Actions знову ввімкніть «Telegram bot tick» і «Karma ingest». Слоти в
   `telegram-tick.yml` задані в UTC, тому взимку їх треба зсунути на +1 год.

## Логи й діагностика

| Що | Команда |
|---|---|
| Живі логи | `journalctl -u descriptor-bot -f` |
| Логи за годину | `journalctl -u descriptor-bot --since "1 hour ago"` |
| Стан сервісу | `systemctl status descriptor-bot` |
| Пам'ять / CPU | `htop` (`sudo apt install htop`) |

## Другий бот на тій самій VM

Для іншого проєкту, наприклад noblesse-oblige:

1. Склонуйте його в окрему теку.
2. Скопіюйте юніт під іншою назвою і змініть `WorkingDirectory`.
3. Задайте інший `BOT_PORT`, наприклад `3101`, якщо там така сама схема.
