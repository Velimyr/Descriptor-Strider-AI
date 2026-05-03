// Конфігурація Telegram-бота. Усе, що тут є, можна змінювати.
// Секрети — через env. Решта — правте файл і робіть деплой.

export interface TelegramBotConfig {
  tg: {
    botTokenEnv: string;        // назва env-змінної з токеном
    channelIdEnv: string;       // назва env-змінної з ID приватного каналу
    webhookSecretEnv: string;   // секрет webhook
  };
  google: {
    serviceAccountJsonEnv: string; // вміст JSON-ключа service account (raw або base64)
    spreadsheetIdEnv: string;
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
    autoModel: string;
    autoPrompt: string;
    renderScale: number;
    imageMaxWidthPx: number;
    jpegQuality: number;
  };

  texts: Record<string, string>;
}

export const telegramBotConfig: TelegramBotConfig = {
  tg: {
    botTokenEnv: 'TELEGRAM_BOT_TOKEN',
    channelIdEnv: 'TELEGRAM_CHANNEL_ID',
    webhookSecretEnv: 'TELEGRAM_WEBHOOK_SECRET',
  },
  google: {
    serviceAccountJsonEnv: 'TELEGRAM_GOOGLE_SERVICE_ACCOUNT',
    spreadsheetIdEnv: 'TELEGRAM_SPREADSHEET_ID',
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
    autoModel: 'gemini-2.5-pro',
    autoPrompt:
      'На цій сторінці архівного опису кілька окремих справ, кожна займає кілька рядків. ' +
      'Поверни JSON-масив об\'єктів {"x":number,"y":number,"w":number,"h":number} у нормалізованих ' +
      'координатах [0..1] від лівого верхнього кута сторінки, по одному об\'єкту на кожну справу. ' +
      'Прямокутник має охоплювати всі рядки, що належать одній справі. Не додавай коментарів — лише JSON.',
    renderScale: 2.0,
    imageMaxWidthPx: 1600,
    jpegQuality: 0.85,
  },

  texts: {
    welcome:
      'Вітаю! Я бот для перевірки архівних справ. Кожна справа — це фрагмент опису, ' +
      'на який треба відповісти на кілька питань. Введіть, будь ласка, ім\'я для рейтингу:',
    nameSaved: 'Дякую, {name}! Я надсилатиму справи за розкладом. Команди: /next, /stats, /progress, /stop, /resume.',
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
      '✅ Записано! +{points} балів. Сьогодні: {todayCount} справ. Всього: {total} балів.',
    confirmHeader: 'Перевірте відповіді:',
    confirmButtons: 'Підтвердити / Виправити',
    questionPrefix: 'Питання {n}/{total}',
    helpText:
      'Команди:\n' +
      '/next — отримати справу\n' +
      '/stats — мої бали і місце\n' +
      '/progress — прогрес обробки\n' +
      '/leaderboard — топ-10\n' +
      '/stop — пауза\n' +
      '/resume — відновити',
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
    skipOptionalButton: '➡ Пропустити',
  },
};
