// Конфігурація Telegram-бота. Усе, що тут є, можна змінювати.
// Секрети — через env. Решта — правте файл і робіть деплой.

export interface TelegramBotConfig {
  tg: {
    botTokenEnv: string;        // назва env-змінної з токеном
    channelIdEnv: string;       // назва env-змінної з ID приватного каналу
    webhookSecretEnv: string;   // секрет webhook
  };
  supabase: {
    urlEnv: string;
    serviceKeyEnv: string; // service_role key (повний доступ)
  };
  cronSecretEnv: string;        // секрет для зовнішнього cron-тригера
  adminLoginEnv: string;        // логін адміна
  adminPasswordEnv: string;     // пароль адміна

  dispatch: {
    startHourKyiv: number;      // 0..23
    endHourKyiv: number;        // 0..23 (включно)
    intervalHours: number;      // крок між розсилками
    timezone: string;           // 'Europe/Kyiv'
    sessionTtlHours: number;    // термін життя стану діалогу
    unansweredPauseAfter: number; // n пропусків поспіль → авто-пауза
    skipIfSessionOpen: boolean; // не слати нову, якщо є відкрита сесія
  };

  cases: {
    targetSubmissions: number;   // мін. кількість підтверджень для "done"
    allowExtraAfterTarget: boolean;
  };

  points: {
    base: number;
    tier1: { thresholdInclusive: number; multiplier: number };
    tier2: { thresholdInclusive: number; multiplier: number };
  };

  sheets: {
    resultsSheetName: string;
    metaSheetName: string;
    usersSheetName: string;
    casesSheetName: string;
    sessionsSheetName: string;
    dailyScoresSheetName: string;
    dispatchLogSheetName: string;
    sourceLink: {
      mode: 'telegram_message' | 'custom_url' | 'none';
      // {channelId} — числовий ID без -100; {messageId} — id повідомлення; {caseId}; {pdfUrl}; {page}
      template: string;
      columnLabel: string;
    };
    // Службові колонки, що додаються в Results перед колонками з tableStructure.
    serviceColumnsBefore: string[];
    // Службові колонки після.
    serviceColumnsAfter: string[];
  };

  slicing: {
    defaultMode: 'manual' | 'auto';
    defaultProvider: 'gemini' | 'claude';
    geminiModel: string;
    claudeModel: string;
    autoModel: string; // legacy, дублює geminiModel
    detectionStrategy: 'boxes' | 'separators';
    autoPrompt: string;
    autoPromptSeparators: string;
    renderScale: number;
    imageMaxWidthPx: number;
    jpegQuality: number;
    bboxPaddingX: number;
    bboxPaddingY: number;
    alignBoxesHorizontally: boolean;
  };

  texts: Record<string, string>;
}

export const telegramBotConfig: TelegramBotConfig = {
  tg: {
    botTokenEnv: 'TELEGRAM_BOT_TOKEN',
    channelIdEnv: 'TELEGRAM_CHANNEL_ID',
    webhookSecretEnv: 'TELEGRAM_WEBHOOK_SECRET',
  },
  supabase: {
    urlEnv: 'SUPABASE_URL',
    serviceKeyEnv: 'SUPABASE_SERVICE_KEY',
  },
  cronSecretEnv: 'TELEGRAM_CRON_SECRET',
  adminLoginEnv: 'TELEGRAM_ADMIN_LOGIN',
  adminPasswordEnv: 'TELEGRAM_ADMIN_PASSWORD',

  dispatch: {
    startHourKyiv: 10,
    endHourKyiv: 20,
    intervalHours: 3,
    timezone: 'Europe/Kyiv',
    sessionTtlHours: 6,
    unansweredPauseAfter: 3,
    skipIfSessionOpen: true,
  },

  cases: {
    targetSubmissions: 3,
    allowExtraAfterTarget: true,
  },

  points: {
    base: 1,
    tier1: { thresholdInclusive: 5, multiplier: 1.5 },
    tier2: { thresholdInclusive: 10, multiplier: 2 },
  },

  sheets: {
    resultsSheetName: 'Results',
    metaSheetName: '_meta',
    usersSheetName: '_users',
    casesSheetName: '_cases',
    sessionsSheetName: '_sessions',
    dailyScoresSheetName: '_daily_scores',
    dispatchLogSheetName: '_dispatch_log',
    sourceLink: {
      mode: 'telegram_message',
      template: 'https://t.me/c/{channelIdShort}/{messageId}',
      columnLabel: 'Джерело',
    },
    serviceColumnsBefore: ['case_id', 'telegram_user_id', 'display_name', 'submitted_at'],
    serviceColumnsAfter: [],
  },

  slicing: {
    defaultMode: 'manual',
    defaultProvider: 'gemini',
    geminiModel: 'gemini-2.5-flash',
    claudeModel: 'claude-opus-4-7',
    autoModel: 'gemini-2.5-flash',
    detectionStrategy: 'separators' as const,
    autoPromptSeparators:
      'Ти бачиш скан сторінки архівного опису справ — таблицю, де кожен рядок або кілька суміжних рядків описують одну архівну справу.\n\n' +
      'ТВОЯ ЗАДАЧА: знайти горизонтальні роздільники між справами і повернути їх Y-координати.\n\n' +
      'Поверни JSON у форматі:\n' +
      '{"separators": [y1, y2, y3, ...], "table_x_min": <ціле>, "table_x_max": <ціле>}\n\n' +
      'Де:\n' +
      '• separators — масив Y-координат (цілі 0..1000) границь МІЖ справами, відсортований за зростанням. Перше значення — Y верхньої межі ПЕРШОЇ справи (одразу під заголовком таблиці). Останнє — Y нижньої межі ОСТАННЬОЇ справи (одразу над колонтитулом). Між цими крайніми — Y кожної горизонтальної лінії, де закінчується одна справа і починається наступна.\n' +
      '• table_x_min — лівий край таблиці (зазвичай 30..80).\n' +
      '• table_x_max — правий край таблиці (зазвичай 920..980).\n\n' +
      'Кількість справ на сторінці = довжина separators - 1.\n\n' +
      'Приклад відповіді для сторінки з 3 справами:\n' +
      '{"separators": [120, 280, 450, 690], "table_x_min": 50, "table_x_max": 950}\n\n' +
      'Поверни ТІЛЬКИ JSON, без markdown і коментарів.',
    autoPrompt:
      'Ти бачиш скан сторінки архівного опису справ. Це таблиця з колонками: порядковий номер | назва справи | роки | кількість аркушів | примітки. Кожна СПРАВА починається з рядка, де у першій колонці є порядковий номер (1, 2, 3, ...). Назва справи може займати кілька рядків — рядки без порядкового номера є продовженням попередньої справи.\n\n' +
      'Твоя задача — знайти Y-координату ВЕРХНЬОГО краю КОЖНОЇ справи (тобто Y-координату того рядка, де стоїть її порядковий номер), а також ліву і праву межі ТАБЛИЦІ.\n\n' +
      'Поверни рівно такий JSON (без markdown і коментарів):\n' +
      '{\n' +
      '  "table_left": <число 0..1000 — X лівої межі таблиці>,\n' +
      '  "table_right": <число 0..1000 — X правої межі таблиці>,\n' +
      '  "table_top": <число 0..1000 — Y верхнього краю таблиці, ПІД заголовком колонок>,\n' +
      '  "table_bottom": <число 0..1000 — Y нижнього краю таблиці, НАД колонтитулом>,\n' +
      '  "cases": [\n' +
      '    { "order_no": "1", "y_top": <число 0..1000 — Y верхнього краю першого рядка справи #1> },\n' +
      '    { "order_no": "2", "y_top": ... },\n' +
      '    ...\n' +
      '  ]\n' +
      '}\n\n' +
      'ВАЖЛИВО:\n' +
      '• cases відсортовані зверху вниз (y_top зростає).\n' +
      '• y_top — це лінія НАД першим рядком справи (між справами), а не середина рядка. Тобто між cases[i].y_top і cases[i+1].y_top повністю міститься справа i.\n' +
      '• Першу справу починай з її верхнього краю (приблизно table_top, якщо справа починається одразу під заголовком таблиці).\n' +
      '• Якщо справа займає 1 рядок — все одно знаходь її y_top.\n' +
      '• Не пропускай справи. Перевір порядкові номери — вони мають іти 1, 2, 3... без розривів.\n' +
      '• Якщо номер не видно (зрізаний край сторінки) — все одно додавай запис, ставлячи order_no: "?".',
    renderScale: 2.0,
    imageMaxWidthPx: 1600,
    jpegQuality: 0.85,
    bboxPaddingX: 0.005, // 0.5% ширини — мінімально, бо горизонтально модель тримає
    bboxPaddingY: 0.015, // 1.5% висоти зверху і знизу — головне виправлення
    // Якщо true — після розпізнавання всі зони на сторінці вирівнюються до спільної
    // лівої та правої межі (медіани x і x+w). Корисно для табличного опису, де всі
    // справи мають однакову ширину.
    alignBoxesHorizontally: true,
  },

  texts: {
    welcome:
      'Вітаю! Я бот для перевірки архівних справ. Кожна справа — це фрагмент опису, ' +
      'на який треба відповісти на кілька питань. Введіть, будь ласка, ім\'я для рейтингу:',
    nameSaved:
      'Дякую, {name}! 👋\n\nКористуйтеся кнопками внизу екрана:\n' +
      '• <b>📥 Нова справа</b> — отримати справу прямо зараз\n' +
      '• <b>📊 Мої бали</b> — ваш рахунок і місце в рейтингу\n' +
      '• <b>❓ Допомога</b> — як це працює і що робити\n\n' +
      'Я також надсилатиму справи автоматично за розкладом. Бажаю успіху!',
    askDisplayName: 'Як до вас звертатись у рейтингу? (одне слово або коротке ім\'я)',
    namePromptInvalid: 'Введіть коротке ім\'я (до 32 символів).',
    noCasesLeft: 'Усі доступні справи вже опрацьовано 🎉 Дякую!',
    sessionExpired: 'Час відповіді минув. Натисніть /next, щоб отримати нову справу.',
    pausedDueToInactivity:
      'Я поставив розсилку на паузу, бо кілька справ залишилися без відповіді. ' +
      'Надішліть /resume, коли будете готові.',
    paused: 'Розсилку зупинено. /resume — продовжити.',
    resumed: 'Розсилку відновлено.',
    pointsEarned:
      '✅ Збережено! +{points} балів. Сьогодні: {todayCount} справ. Всього: {total} балів.',
    confirmHeader: 'Перевірте відповіді:',
    questionPrefix: 'Питання {n}/{total}',
    helpText:
      '<b>❓ Допомога</b>\n\n' +
      'Я допомагаю звіряти описи архівних справ.\n' +
      'Оберіть розділ, який вас цікавить:',
    helpAbout:
      '<b>ℹ Про що цей бот</b>\n\n' +
      'Архівні описи — це переліки справ, що зберігаються в архіві. ' +
      'Кожна справа має кілька реквізитів (номер, назва, роки, кількість аркушів тощо). ' +
      'Я надсилаю вам по одній справі (фото фрагмента документа), а ви розписуєте її реквізити. ' +
      'Кожну справу перевіряють кілька людей — щоб результат був надійним.',
    helpHowToAnswer:
      '<b>📝 Як відповідати на справу</b>\n\n' +
      '1️⃣ Я надсилаю фото фрагмента опису.\n' +
      '2️⃣ Ставлю питання по черзі (номер, назва, роки тощо). Просто пишіть відповідь у чат.\n' +
      '3️⃣ Якщо поле в оригіналі <b>не заповнене</b> — натисніть кнопку <b>🚫 Не заповнено</b>.\n' +
      '4️⃣ Помилились? <b>⬅ Назад</b> поверне до попереднього питання.\n' +
      '5️⃣ Перед збереженням я покажу всі ваші відповіді. ' +
      'Натисніть <b>✅ Підтвердити</b>, щоб зарахувати, або <b>✏ Виправити</b> щоб змінити окреме поле.\n\n' +
      '⚠ Поки ви не натиснули «Підтвердити» — нічого не зберігається.',
    helpPoints:
      '<b>🏆 Бали і рейтинг</b>\n\n' +
      'За кожну підтверджену справу — <b>1 бал</b>. ' +
      'Якщо за день ви опрацюєте багато — отримуєте множник:\n' +
      '• 1–4 справ: ×1 (1 бал кожна)\n' +
      '• 5–9 справ: ×1.5\n' +
      '• 10+ справ: ×2 (по 2 бали за кожну)\n\n' +
      'Множник скидається опівночі за київським часом.\n' +
      '<b>Загальні бали не скидаються</b> — вони накопичуються за весь час.\n\n' +
      '📊 <b>Мої бали</b> — показує ваш сьогоднішній рахунок, всього балів і місце в рейтингу.\n' +
      '🏆 <b>Топ-10</b> — найкращі учасники.',
    helpSchedule:
      '<b>🔔 Розклад і сповіщення</b>\n\n' +
      'Я надсилаю справи автоматично кілька разів на день у визначені години. ' +
      'Ви можете не чекати — натисніть <b>📥 Нова справа</b>, щоб отримати справу прямо зараз.\n\n' +
      'Якщо хочете перерву — натисніть <b>🔕 Зупинити</b>. Я перестану слати, доки ви не натиснете <b>🔔 Увімкнути</b>.\n\n' +
      'Ви можете відмовитись від поточної справи командою /cancel — вона дістанеться комусь іншому.',
    helpFaq:
      '<b>💡 Поширені питання</b>\n\n' +
      '<b>Чи можу я побачити одну справу двічі?</b>\nНі. Кожному користувачу справа показується лише раз.\n\n' +
      '<b>Скільки людей перевіряють одну справу?</b>\nЯ збираю мінімум 3 відповіді на справу, щоб виявити неточності.\n\n' +
      '<b>Що робити, якщо фото нерозбірливе?</b>\nКраще натиснути <b>❌ Скасувати</b> і взяти наступну. Не вгадуйте.\n\n' +
      '<b>Я не встиг відповісти — що буде?</b>\nЯкщо протягом кількох годин не закінчите — справа звільниться для інших, а вам прийде нова в наступний слот.',
    helpBackButton: '◀ До меню допомоги',
    invalidNumber: 'Введіть, будь ласка, число.',
    invalidDate: 'Введіть дату у форматі ДД.ММ.РРРР або просто рік.',
    cancelled: 'Скасовано.',
    sessionAlreadyOpen: 'У вас уже є відкрита справа — продовжуємо її. Щоб скасувати, надішліть /cancel.',
    nothingToCancel: 'Немає активної справи.',
    statsLine:
      '👤 {name}\n' +
      '🏆 Всього балів: {total}\n' +
      '📅 Сьогодні: {todayCount} справ ({todayPoints} балів, множник ×{multiplier})\n' +
      '📊 Місце в рейтингу: {rank} з {totalUsers}',
    progressLine:
      '📈 Оброблено: {donePct}% ({doneCases} з {totalCases} справ повністю перевірено)\n' +
      '📝 Усього записів: {totalSubmissions}',
    leaderboardHeader: '🏆 Топ-10:',
    leaderboardYou: '\nВи: #{rank} — {points} балів',
    backButton: '⬅ Назад',
    cancelButton: '❌ Скасувати',
    confirmButton: '✅ Підтвердити',
    editButton: '✏ Виправити',

    // Кнопка "Поле не заповнене" в опитуванні
    fieldEmptyButton: '🚫 Не заповнено',
    // Маркер, який потрапляє в Sheets коли користувач натиснув "Не заповнено"
    fieldEmptyValue: '—',

    // Головне меню (reply keyboard внизу екрану)
    menuNext: '📥 Нова справа',
    menuStats: '📊 Мої бали',
    menuProgress: '📈 Прогрес',
    menuLeaderboard: '🏆 Топ-10',
    menuPause: '🔕 Зупинити',
    menuResume: '🔔 Увімкнути',
    menuHelp: '❓ Допомога',

    // Швидкий фідбек
    savingNotice: '💾 Зберігаю...',
    processingNotice: '⏳ Обробляю...',
  },
};
