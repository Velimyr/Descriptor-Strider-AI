import type { TableColumn, ColumnRole } from '../../src/types.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  appendSubmission,
  BotSession,
  BotUser,
  BotCase,
  deleteSession,
  getCase,
  getMeta,
  setMeta,
  getSession,
  getUser,
  incDailyCount,
  incGlobalDailyDone,
  incMonthlyPoints,
  patchUser,
  recordSkippedCase,
  setSession,
  upsertUser,
  getDailyCount,
  getResultsTotals,
  getFundEtaStats,
  getDescriptionProgressViaRpc,
  getMonthlyLeaderboard,
  getMonthlyMonths,
  // Collab helpers
  lockCase,
  unlockCase,
  recordCaseEvent,
  hasUserTouchedCase,
  setCaseCreated,
  setCaseEdited,
  confirmCase,
  captureTgUsername,
  getUserGeminiKeys,
  setUserGeminiKeys,
  CaseFilter,
} from './storage.js';
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  sendPhotoByFileId,
  deleteMessage,
  downloadTelegramFileBase64,
} from './tg-api.js';
import {
  validateGeminiKey,
  recognizeWithRotation,
  AllKeysExhaustedError,
  NoValidKeyError,
} from './ocr.js';
import { secretBoxReady } from './secretBox.js';
import {
  recordPendingPoints,
  settleCaseAtClose,
  getUnconfirmedTotal,
  getRecentForfeited,
} from '../_core/pendingPoints.js';
import {
  computeFundEtaFromStats,
  computePointsForToday,
  getTodayProcessedCases,
  kyivDateString,
  kyivMonthString,
  nowIsoUtc,
  progressByDescription,
  recomputeCaseSubmissionCount,
  selectNextCaseForUser,
} from './scheduler.js';
import {
  applyMarathonBonus,
  getActiveMarathon,
  marathonActionWord,
  type MarathonAction,
} from './marathon.js';
import {
  evaluateBadges,
  countEarnedInCatalog,
  sendBadgesList,
  sendBadgeCardById,
} from './badges.js';
import {
  collectPuzzleWordsOnCreate,
  onCollabCaseConfirmed,
  sendPuzzleTask,
  sendPuzzleRules,
  sendPuzzleResults,
} from './puzzle.js';

const T = telegramBotConfig.texts;

// --------- helpers ---------

function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? `{${k}}`));
}

// Питання змінюються максимум кілька разів за весь час життя проєкту,
// але читаються в кожному dispatch / submit / preview — до сотень разів на день.
// Кеш у пам'яті Vercel-інстансу на 5 хв скорочує читання bot_meta до 1/5хв
// (warm-window). Cold-start скине кеш — ОК, перше читання все одно піде в БД.
let questionsCache: { value: TableColumn[]; expiresAt: number } | null = null;
const QUESTIONS_TTL_MS = 5 * 60 * 1000;

// Викликати з ендпоінту /admin/save-questions після setMeta — щоб одразу побачити
// нові питання, а не чекати до 5 хв на природний TTL. Кеш живе в межах одного
// інстансу, тож інші теплі інстанси оновляться лише через TTL — для рідких
// правок питань це прийнятно.
export function invalidateQuestionsCache(): void {
  questionsCache = null;
}

async function getQuestions(): Promise<TableColumn[]> {
  if (questionsCache && questionsCache.expiresAt > Date.now()) {
    return questionsCache.value;
  }
  const raw = await getMeta('questions');
  if (!raw) {
    questionsCache = { value: [], expiresAt: Date.now() + QUESTIONS_TTL_MS };
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    const value = Array.isArray(parsed) ? parsed : [];
    questionsCache = { value, expiresAt: Date.now() + QUESTIONS_TTL_MS };
    return value;
  } catch {
    questionsCache = { value: [], expiresAt: Date.now() + QUESTIONS_TTL_MS };
    return [];
  }
}

function questionPromptText(q: TableColumn, index: number, total: number): string {
  const header = fmt(T.questionPrefix, { n: index + 1, total });
  const hint = roleHint(q.role);
  return `<b>${header}</b>\n${escapeHtml(q.label)}${hint ? `\n<i>${hint}</i>` : ''}`;
}

function roleHint(role?: ColumnRole): string {
  switch (role) {
    case 'date_start':
    case 'date_end':
      return 'Вводьте дату так, як вона вказана в описі';
    case 'page_count':
      return 'Введіть число';
    case 'year_range':
      return 'Вводьте діапазон дат так, як вони вказані в описі';
    default:
      return '';
  }
}

function validateAnswer(role: ColumnRole | undefined, text: string): string | null {
  const t = text.trim();
  if (!t) return 'Порожньо';
  if (role === 'page_count') {
    if (!/^\d+$/.test(t)) return T.invalidNumber;
  }
  if (role === 'date_start' || role === 'date_end') {
    if (!/^(\d{1,2}\.\d{1,2}\.\d{4}|\d{4})$/.test(t)) return T.invalidDate;
  }
  if (role === 'case_no' || role === 'order_no') {
    // Дозволяємо лише цифри, літери (латиниця + кирилиця, регістр будь-який) і пробіли.
    if (!/^[\p{L}\p{N} ]+$/u.test(t)) return T.invalidCaseNumber;
  }
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] || ch));
}

// Inline-меню всередині розділу «Допомога».
function helpMenuKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: 'ℹ Про що цей бот', callback_data: 'help:about' }],
      [{ text: '📑 З чого складається опис', callback_data: 'help:descstruct' }],
      [{ text: '📝 Як відповідати на справу', callback_data: 'help:howto' }],
      [{ text: '🏆 Бали і рейтинг', callback_data: 'help:points' }],
      [{ text: '🏅 Досягнення', callback_data: 'help:badges' }],
      [{ text: '🔔 Розклад і сповіщення', callback_data: 'help:schedule' }],
      [{ text: '💡 Поширені питання', callback_data: 'help:faq' }],
    ],
  };
}

// Динамічний список усіх досягнень з умовами — будується з каталогу config.badges,
// щоб не розходитися з реальними критеріями. Групуємо за типом критерію.
function badgeCriteriaText(c: { type: string; threshold: number }): string {
  switch (c.type) {
    case 'cases_total': return `опрацювати ${c.threshold} справ загалом`;
    case 'day_count': return `опрацювати ${c.threshold} справ за один день`;
    case 'total_points': return `накопичити ${c.threshold} балів`;
    case 'verifications_total': return `перевірити ${c.threshold} справ`;
    case 'corrected_words_total': return `виправити ${c.threshold} слів під час перевірки`;
    default: return '';
  }
}

function buildBadgesHelpText(): string {
  const groups: Array<{ type: string; header: string }> = [
    { type: 'cases_total', header: '📚 За кількістю опрацьованих справ' },
    { type: 'day_count', header: '⚡ За активністю за один день' },
    { type: 'total_points', header: '🏆 За накопиченими балами' },
    { type: 'verifications_total', header: '🔍 За перевіреними справами' },
    { type: 'corrected_words_total', header: '✏️ За виправленими словами' },
  ];
  const parts: string[] = [T.helpBadgesIntro];
  for (const g of groups) {
    const items = telegramBotConfig.badges.filter(b => b.criteria.type === g.type);
    if (items.length === 0) continue;
    const lines = items.map(
      b => `🏅 <b>${escapeHtml(b.title)}</b> — ${badgeCriteriaText(b.criteria as any)}`
    );
    parts.push(`<b>${g.header}</b>\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

function settingsMenuKeyboard(): any {
  // Імʼя перенесено всередину Профілю — лишаємо лише одну точку входу.
  return {
    inline_keyboard: [
      [{ text: T.settingsProfileButton, callback_data: 'settings:profile' }],
      [{ text: T.profileKeysButton, callback_data: 'settings:keys' }],
      [{ text: T.caseFilterButton, callback_data: 'settings:casefilter' }],
    ],
  };
}

// Назва поточного фільтра справ — для показу в підменю/підтвердженні.
function caseFilterLabel(f: CaseFilter): string {
  return f === 'recognition'
    ? T.caseFilterRecognition
    : f === 'verification'
      ? T.caseFilterVerification
      : T.caseFilterAll;
}

// Підменю вибору фільтра справ. Поточний варіант позначаємо ✅.
function caseFilterKeyboard(current: CaseFilter): any {
  const opt = (value: CaseFilter, label: string) => [
    { text: (current === value ? '✅ ' : '') + label, callback_data: `settings:cf:${value}` },
  ];
  return {
    inline_keyboard: [
      opt('all', T.caseFilterAll),
      opt('recognition', T.caseFilterRecognition),
      opt('verification', T.caseFilterVerification),
      [{ text: T.profileBackButton, callback_data: 'settings:back' }],
    ],
  };
}

function settingsRenameCancelKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: T.cancelButton, callback_data: 'settings:rename_cancel' }],
    ],
  };
}

function profileMenuKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: T.profileEditNameButton, callback_data: 'profile:edit_name' }],
      [{ text: T.profileEditCityButton, callback_data: 'profile:edit_city' }],
      [{ text: T.profileEditPhotoButton, callback_data: 'profile:edit_photo' }],
      [{ text: T.profileEditFacebookButton, callback_data: 'profile:edit_facebook' }],
      [{ text: T.profileEditContactButton, callback_data: 'profile:edit_contact' }],
      [{ text: T.profileBackButton, callback_data: 'settings:back' }],
    ],
  };
}

// Екран керування Gemini-ключами: список наявних (за last4) + додати/видалити.
function geminiKeysKeyboard(keys: string[]): any {
  const rows: any[] = [];
  keys.forEach((_, i) => {
    rows.push([{ text: fmt(T.profileKeysDeleteButton, { n: i + 1 }), callback_data: `profile:delkey:${i}` }]);
  });
  rows.push([{ text: T.profileKeysAddButton, callback_data: 'profile:addkey' }]);
  rows.push([{ text: T.profileBackButton, callback_data: 'settings:back' }]);
  return { inline_keyboard: rows };
}

async function sendGeminiKeysScreen(chatId: number | string, tgId: string) {
  const keys = await getUserGeminiKeys(tgId);
  const list = keys.length
    ? keys.map((k, i) => fmt(T.profileKeysItem, { n: i + 1, hint: k.slice(-4) })).join('\n')
    : T.profileKeysEmpty;
  await sendMessage(chatId, `${T.profileKeysTitle}\n\n${list}`, {
    reply_markup: geminiKeysKeyboard(keys),
  });
}

// Обробка введеного ключа: валідація → збереження → видалення повідомлення з ключем.
async function processGeminiKeyInput(
  chatId: number | string,
  tgId: string,
  rawKey: string,
  userMessageId: number
) {
  // Прибираємо повідомлення з ключем одразу — щоб не висіло у переписці.
  await deleteMessage(chatId, userMessageId);
  await patchUser(tgId, { pendingAction: '' });

  const key = rawKey.trim();
  const checking = await sendMessage(chatId, T.profileKeysChecking);
  const ok = await validateGeminiKey(key);
  const checkingId = checking?.message_id;
  if (checkingId) await deleteMessage(chatId, checkingId);

  if (!ok) {
    await sendMessage(chatId, T.profileKeysInvalid);
    await sendGeminiKeysScreen(chatId, tgId);
    return;
  }
  const existing = await getUserGeminiKeys(tgId);
  if (!existing.includes(key)) existing.push(key);
  await setUserGeminiKeys(tgId, existing);
  await sendMessage(chatId, fmt(T.profileKeysSaved, { count: existing.length }));
  await sendGeminiKeysScreen(chatId, tgId);
}

// Клавіатура під edit-промптом: «Скасувати» + «Видалити» (якщо значення є).
function profileEditCancelKeyboard(field?: 'name' | 'city' | 'facebook' | 'photo' | 'contact', hasValue = false): any {
  const rows: any[] = [];
  if (field && hasValue) {
    rows.push([{ text: T.profileDeleteButton, callback_data: `profile:clear_${field}` }]);
  }
  rows.push([{ text: T.profileEditCancelButton, callback_data: 'profile:cancel' }]);
  return { inline_keyboard: rows };
}

// Reply-keyboard з кнопкою «Поділитися контактом» (request_contact).
function profileContactReplyKeyboard(): any {
  return {
    keyboard: [
      [{ text: T.profileContactButton, request_contact: true }],
      [{ text: T.cancelButton }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function helpBackKeyboard(): any {
  return {
    inline_keyboard: [[{ text: T.helpBackButton, callback_data: 'help:menu' }]],
  };
}

function keyboardForQuestion(qIndex: number, hasPrefill = false): any {
  // Skip-кнопка в окремий ряд — її текст довгий і обрізається коли вона поряд з іншими.
  const navRow: any[] = [];
  if (qIndex > 0) navRow.push({ text: T.backButton, callback_data: 'back' });
  navRow.push({ text: T.cancelButton, callback_data: 'cancel' });
  const rows: any[] = [];
  if (hasPrefill) {
    rows.push([{ text: '✅ Залишити поточну', callback_data: `keep:${qIndex}` }]);
  }
  rows.push([{ text: T.fieldEmptyButton, callback_data: 'skip' }]);
  rows.push(navRow);
  return { inline_keyboard: rows };
}

// Reply-клавіатура головного меню (внизу екрана). Pause/Resume — динамічно.
function mainMenuKeyboard(user: BotUser | null): any {
  const pauseRow =
    user?.status === 'paused'
      ? [{ text: T.menuResume }]
      : [{ text: T.menuPause }];
  return {
    keyboard: [
      [{ text: T.menuNext }],
      [{ text: T.menuStats }, { text: T.menuProgress }],
      [{ text: T.menuLeaderboard }, { text: T.menuHallOfFame }],
      [{ text: T.menuHelp }, { text: T.menuSettings }],
      pauseRow,
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function keyboardForConfirm(): any {
  return {
    inline_keyboard: [
      [
        { text: T.confirmButton, callback_data: 'confirm' },
        { text: T.editButton, callback_data: 'edit' },
      ],
      [{ text: T.cancelButton, callback_data: 'cancel' }],
    ],
  };
}

function keyboardForEdit(questions: TableColumn[]): any {
  return {
    inline_keyboard: questions.map((q, i) => [
      { text: `${i + 1}. ${q.label.slice(0, 40)}`, callback_data: `edit:${i}` },
    ]),
  };
}

// --------- Intro onboarding («З чого складається опис») ---------
// File-id картинки кешуємо в bot_meta('intro_file_id'). Якщо ще не залито —
// читаємо public/sample.png з диска, шлемо в канал, зберігаємо file_id.
async function getIntroFileId(): Promise<string | null> {
  const cached = await getMeta('intro_file_id');
  if (cached) return cached;
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    // На Vercel serverless лише файли, що лежать поряд із кодом функції, потрапляють
    // у бандл. Пробуємо кілька шляхів у такому порядку, що покриває dev і прод.
    const candidates = [
      path.join(process.cwd(), 'api', 'telegram', 'sample.png'),
      path.join(process.cwd(), 'public', 'sample.png'),
    ];
    let buf: Buffer | null = null;
    for (const p of candidates) {
      try {
        buf = await fs.readFile(p);
        if (buf) break;
      } catch {
        // спробуємо наступний
      }
    }
    if (!buf) {
      console.warn('[intro] sample.png not found in', candidates);
      return null;
    }
    const channelId = process.env[telegramBotConfig.tg.channelIdEnv];
    if (!channelId) return null;
    const { sendPhotoByBuffer } = await import('./tg-api.js');
    const res = await sendPhotoByBuffer(channelId, buf, 'sample.png');
    const photoArr = res?.photo || [];
    const fid = photoArr.length ? photoArr[photoArr.length - 1].file_id : '';
    if (fid) await setMeta('intro_file_id', fid);
    return fid || null;
  } catch (e) {
    console.error('getIntroFileId failed', e);
    return null;
  }
}

// Шле користувачу пам'ятку з картинкою. Caption Telegram обмежений 1024 символами —
// якщо текст довший за caption-ліміт, шлемо як photo+text окремо.
async function sendIntroHelp(chatId: number | string, withAckButton: boolean): Promise<void> {
  const text = T.helpDescStruct;
  const replyMarkup = withAckButton
    ? { inline_keyboard: [[{ text: T.introAckButton, callback_data: 'intro:ack' }]] }
    : helpBackKeyboard();
  const fid = await getIntroFileId();
  if (fid && text.length <= 1024) {
    await sendPhotoByFileId(chatId, fid, text, { reply_markup: replyMarkup });
    return;
  }
  if (fid) {
    await sendPhotoByFileId(chatId, fid);
  }
  await sendMessage(chatId, text, { reply_markup: replyMarkup });
}

// Якщо користувачу ще не показували онбординг — показуємо зараз і фіксуємо час.
// Викликається на старті будь-якої дії існуючого користувача.
async function maybeShowIntro(chatId: number | string, user: BotUser): Promise<void> {
  if (user.introShownAt) return;
  if (!user.displayName) return; // ще не зареєстрований остаточно — інший шлях
  try {
    await patchUser(user.tgId, { introShownAt: nowIsoUtc() });
    user.introShownAt = nowIsoUtc();
    await sendIntroHelp(chatId, true);
  } catch (e) {
    console.error('maybeShowIntro failed', e);
  }
}

// Повне посилання на PDF архівного опису: база (config.verif.opysBaseUrl) + назва файлу
// + #page=N (скрол до сторінки у вбудованих PDF-переглядачах). Назва файлу — завжди
// source_pdf справи. '' якщо source_pdf порожній (тоді кнопку не показуємо).
function buildOpysUrl(cse: BotCase): string {
  const fileName = String(cse.sourcePdf || '').trim();
  if (!fileName) return '';
  const base = telegramBotConfig.verif.opysBaseUrl || 'https://cdiak.archives.gov.ua/files/';
  const url = /^https?:\/\//i.test(fileName) ? fileName : `${base}${encodeURIComponent(fileName)}`;
  const p = parseInt(String(cse.page || '').match(/\d+/)?.[0] || '', 10);
  return Number.isFinite(p) && p > 0 ? `${url}#page=${p}` : url;
}

// Надсилає дисклеймер + кнопки («Переглянути опис» і, у flow створення, «AI розпізнавання»)
// ПЕРЕД фото, а потім саме фото. Якщо опису немає — AI-кнопку чіпляємо до фото,
// а без жодних кнопок шлемо просто фото.
async function sendCasePhotoWithOpys(
  chatId: number | string,
  cse: BotCase,
  // Якщо передано — додаємо кнопку «AI розпізнавання» (лише у flow створення).
  aiCaseId?: string
): Promise<void> {
  if (!cse.tgFileId) return;
  const opysUrl = buildOpysUrl(cse);
  const aiRow = aiCaseId ? [{ text: T.aiButton, callback_data: `aiocr:${aiCaseId}` }] : null;
  if (opysUrl) {
    // Дисклеймер + кнопки (Опис + AI) ПЕРЕД фото, потім саме фото.
    const page = String(cse.page || '').match(/\d+/)?.[0] || '';
    const caption = page ? fmt(T.opysDisclaimer, { page }) : T.opysDisclaimerNoPage;
    const inline_keyboard: any[] = [[{ text: T.opysButton, url: opysUrl }]];
    if (aiRow) inline_keyboard.push(aiRow);
    await sendMessage(chatId, caption, { reply_markup: { inline_keyboard } });
    await sendPhotoByFileId(chatId, cse.tgFileId);
  } else if (aiRow) {
    // Немає опису — AI-кнопку чіпляємо до самого фото, щоб не загубити її.
    await sendPhotoByFileId(chatId, cse.tgFileId, undefined, { reply_markup: { inline_keyboard: [aiRow] } });
  } else {
    await sendPhotoByFileId(chatId, cse.tgFileId);
  }
}

// Перед показом блоку підтвердження надсилаємо ту ж картинку ще раз —
// щоб користувачу не довелось скролити вгору, щоб її побачити.
async function resendCasePhoto(chatId: number | string, caseId: string): Promise<void> {
  if (!caseId) return;
  try {
    const cse = await getCase(caseId);
    if (cse?.tgFileId) await sendCasePhotoWithOpys(chatId, cse);
  } catch (e) {
    console.error('resendCasePhoto failed', e);
  }
}

function buildSummary(questions: TableColumn[], answers: string[]): string {
  const lines = questions.map((q, i) => `<b>${escapeHtml(q.label)}</b>: ${escapeHtml(answers[i] ?? '—')}`);
  return `${T.confirmHeader}\n\n${lines.join('\n')}`;
}

// --------- Collaborative mode helpers ---------

// Клавіатура екрану перегляду чужого варіанту: підтвердити / редагувати / пропустити.
function keyboardForCollabPreview(): any {
  return {
    inline_keyboard: [
      [
        { text: T.confirmButton, callback_data: 'collab:confirm' },
        { text: T.editButton, callback_data: 'collab:edit' },
      ],
      [{ text: T.cancelButton, callback_data: 'collab:cancel' }],
    ],
  };
}

async function getMinConfirmations(): Promise<number> {
  const raw = await getMeta('min_confirmations');
  const n = parseInt(raw || '', 10);
  // Fallback — config (а не хардкод), щоб поріг закриття бота збігався з порогом
  // прогресу/вибору справ (усі RPC беруть cases.targetSubmissions).
  return Number.isFinite(n) && n > 0 ? n : telegramBotConfig.cases.targetSubmissions;
}
async function getCollabLockMinutes(): Promise<number> {
  const raw = await getMeta('collab_lock_minutes');
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

// --------- main handler ---------

export async function handleUpdate(update: any): Promise<void> {
  // Діагностика: коли бот отримує будь-що з групи/супергрупи, запам'ятовуємо її ID
  // у bot_meta('recent_groups') — щоб адмін міг побачити правильний chat_id для
  // налаштування announceChatIds. Fire-and-forget.
  try {
    const chat = update?.message?.chat || update?.callback_query?.message?.chat;
    if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
      rememberGroupChat({ id: String(chat.id), title: chat.title || '', type: chat.type })
        .catch(() => {});
    }
  } catch {/* ignore */}

  if (update.callback_query) {
    return handleCallback(update.callback_query);
  }
  if (update.message) {
    return handleMessage(update.message);
  }
}

// Кеш + запис у bot_meta. Тримаємо до 10 останніх груп.
async function rememberGroupChat(g: { id: string; title: string; type: string }) {
  const raw = (await getMeta('recent_groups')) || '[]';
  let list: Array<{ id: string; title: string; type: string; lastAt: string }>;
  try { list = JSON.parse(raw); if (!Array.isArray(list)) list = []; } catch { list = []; }
  const without = list.filter(x => x.id !== g.id);
  without.unshift({ ...g, lastAt: nowIsoUtc() });
  await setMeta('recent_groups', JSON.stringify(without.slice(0, 10)));
}

// Нормалізуємо текст: команда чи натискання кнопки меню → канонічна команда.
function normalizeCommand(text: string): string {
  const trimmed = text.trim();
  if (trimmed === T.menuNext) return '/next';
  if (trimmed === T.menuStats) return '/stats';
  if (trimmed === T.menuProgress) return '/progress';
  if (trimmed === T.menuLeaderboard) return '/leaderboard';
  if (trimmed === T.menuHallOfFame) return '/halloffame';
  if (trimmed === T.menuHelp) return '/help';
  if (trimmed === T.menuSettings) return '/settings';
  if (trimmed === T.menuPause) return '/stop';
  if (trimmed === T.menuResume) return '/resume';
  return trimmed;
}

async function handleMessage(msg: any) {
  // Бот спілкується лише у приватних чатах. У групах/каналах ігноруємо все,
  // інакше реагуватиме на КОЖНЕ повідомлення учасників «надішліть /start».
  // Захоплення group chat_id для діагностики йде ще на рівні handleUpdate.
  if (msg.chat?.type !== 'private') return;

  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const rawText: string = msg.text || '';
  const text = normalizeCommand(rawText);

  // Читаємо user і session паралельно — все одно потрібні для більшості шляхів.
  const [user, session] = await Promise.all([getUser(tgId), getSession(tgId)]);

  // Бан (перевірка доброчесності): заблокований не може виконати жодну дію.
  if (user?.banned) {
    await sendMessage(chatId, T.bannedNotice);
    return;
  }

  // Лагідно фіксуємо @username — буде корисний адміну, щоб написати юзеру в особисті.
  // Передаємо поточне значення з user, щоб уникнути зайвого UPDATE коли нічого не змінилось.
  // Fire-and-forget.
  if (msg.from?.username) {
    captureTgUsername(tgId, msg.from.username, user?.tgUsername).catch(() => {});
  }

  // --- Профіль: нетекстові повідомлення (фото / контакт) у режимі редагування. ---
  if (user) {
    if (user.pendingAction === 'edit_photo' && msg.photo) {
      await processProfilePhotoInput(chatId, user, msg.photo);
      return;
    }
    if (user.pendingAction === 'edit_contact' && msg.contact) {
      await processProfileContactInput(chatId, user, msg.contact);
      return;
    }
  }

  if (text.startsWith('/start')) {
    // /start link_XXXX — дип-лінк лінкінгу web-юзера до цього TG-юзера.
    // payload приходить як другий "токен" у тексті (Telegram передає його тут же).
    const startPayload = rawText.replace(/^\/start(@\S+)?\s*/, '').trim();
    const linkCode = startPayload.startsWith('link_') ? startPayload.slice(5) : null;
    const loginCode = startPayload.startsWith('login_') ? startPayload.slice(6) : null;

    // Завжди гарантуємо існування TG-юзера до мерджу.
    let currentUser = user;
    if (!currentUser) {
      const newUser: Omit<BotUser, 'rowIndex'> = {
        tgId,
        displayName: '',
        totalPoints: 0,
        lastDispatchedCaseId: '',
        lastDispatchedAt: '',
        consecutiveMisses: 0,
        status: 'active',
        pendingAction: '',
        createdAt: nowIsoUtc(),
        introShownAt: '',
        // Новому юзеру одразу фіксуємо засів бейджів, щоб його справжні
        // досягнення сповіщалися (тиха видача — лише для існуючих до фічі).
        badgesSeededAt: nowIsoUtc(),
        source: 'tg',
        partnerId: null,
        city: '',
        region: '',
        tgUsername: '',
        phoneNumber: '',
        facebookUrl: '',
        photoFileId: '',
        photoMessageId: '',
        banned: false,
        hasGeminiKeys: false,
        caseFilter: 'all',
      };
      await upsertUser(newUser);
      currentUser = { ...newUser, rowIndex: 0 } as BotUser;
    }

    if (linkCode) {
      try {
        const { consumeLinkCode } = await import('../_core/linking.js');
        const r = await consumeLinkCode(linkCode, tgId);
        if (r.ok) {
          const updated = await getUser(tgId);
          const msg = updated && r.transferredPoints
            ? `✅ Готово! До твого акаунту додано ${r.transferredPoints} балів з веб-сесії «${r.webNickname}».\n\nЗагалом тепер: ${updated.totalPoints} балів.`
            : '✅ Готово! Веб-акаунт прив\'язаний.';
          await sendMessage(chatId, msg, { reply_markup: mainMenuKeyboard(updated || currentUser) });
        } else {
          const errMap: Record<string, string> = {
            unknown_code: 'Код невідомий. Спробуйте згенерувати новий у віджеті.',
            used: 'Цей код уже використано.',
            expired: 'Код прострочений (10 хв). Згенеруйте новий у віджеті.',
            web_user_missing: 'Веб-сесію вже видалено.',
            self_link: 'Не можна привʼязати TG до самого себе.',
          };
          await sendMessage(chatId, `⚠ ${errMap[r.reason!] || 'Не вдалось прив\'язати акаунт.'}`, {
            reply_markup: mainMenuKeyboard(currentUser),
          });
        }
      } catch (e: any) {
        console.error('link consume failed', e?.message || e);
        await sendMessage(chatId, '⚠ Помилка прив\'язки. Спробуйте пізніше.', {
          reply_markup: mainMenuKeyboard(currentUser),
        });
      }
      return;
    }

    // /start login_XXXX — підтвердження «Вхід через бота» на сайті перевірки.
    if (loginCode) {
      try {
        const { consumeLoginCode } = await import('../_core/verifLogin.js');
        const ok = await consumeLoginCode(loginCode, tgId);
        await sendMessage(
          chatId,
          ok
            ? '✅ Вхід підтверджено! Поверніться на сайт — перевірка відкриється автоматично за кілька секунд.'
            : '⚠ Код входу невідомий або прострочений (10 хв). Згенеруйте новий на сайті.',
          { reply_markup: mainMenuKeyboard(currentUser) }
        );
      } catch (e: any) {
        console.error('verif login consume failed', e?.message || e);
        await sendMessage(chatId, '⚠ Помилка підтвердження входу. Спробуйте пізніше.', {
          reply_markup: mainMenuKeyboard(currentUser),
        });
      }
      return;
    }

    // Звичайний /start без link-payload.
    if (!user) {
      await sendMessage(chatId, T.welcome, { reply_markup: mainMenuKeyboard(currentUser) });
    } else {
      await sendMessage(chatId, `З поверненням, ${user.displayName}! 👋`, {
        reply_markup: mainMenuKeyboard(user),
      });
    }
    return;
  }

  if (!user) {
    await sendMessage(chatId, 'Надішліть /start');
    return;
  }

  // /link <CODE> — fallback для випадку, коли Telegram втратив payload при
  // переході з deep-link (часто буває для юзерів, у яких чат з ботом уже існує).
  if (text.startsWith('/link')) {
    const code = rawText.replace(/^\/link(@\S+)?\s*/i, '').trim().toUpperCase();
    if (!code) {
      await sendMessage(
        chatId,
        'Використання: <code>/link CODE</code>\nКод покаже віджет, коли ви натиснете «Привʼязати Telegram».',
        { reply_markup: mainMenuKeyboard(user) }
      );
      return;
    }
    try {
      const { consumeLinkCode } = await import('../_core/linking.js');
      const r = await consumeLinkCode(code, tgId);
      if (r.ok) {
        const updated = await getUser(tgId);
        const msg = updated && r.transferredPoints
          ? `✅ Готово! До твого акаунту додано ${r.transferredPoints} балів з веб-сесії «${r.webNickname}».\n\nЗагалом тепер: ${updated.totalPoints} балів.`
          : '✅ Готово! Веб-акаунт прив\'язаний.';
        await sendMessage(chatId, msg, { reply_markup: mainMenuKeyboard(updated || user) });
      } else {
        const errMap: Record<string, string> = {
          unknown_code: 'Код невідомий. Перевірте у віджеті.',
          used: 'Цей код уже використано.',
          expired: 'Код прострочений (10 хв). Згенеруйте новий у віджеті.',
          web_user_missing: 'Веб-сесію вже видалено.',
          self_link: 'Не можна привʼязати TG до самого себе.',
        };
        await sendMessage(chatId, `⚠ ${errMap[r.reason!] || 'Не вдалось привʼязати акаунт.'}`, {
          reply_markup: mainMenuKeyboard(user),
        });
      }
    } catch (e: any) {
      console.error('/link consume failed', e?.message || e);
      await sendMessage(chatId, '⚠ Помилка привʼязки. Спробуйте пізніше.', {
        reply_markup: mainMenuKeyboard(user),
      });
    }
    return;
  }

  // ім'я ще не задано
  if (!user.displayName) {
    const name = rawText.trim().slice(0, 32);
    if (!name || name.startsWith('/')) {
      await sendMessage(chatId, T.namePromptInvalid);
      return;
    }
    // Захист від випадкового кліку по кнопці меню — її текст не може бути імʼям.
    const menuTexts = new Set([
      T.menuNext, T.menuStats, T.menuProgress, T.menuLeaderboard, T.menuHallOfFame,
      T.menuPause, T.menuResume, T.menuHelp, T.menuSettings,
    ]);
    if (menuTexts.has(rawText.trim())) {
      await sendMessage(chatId, T.nameIsMenuButton || T.namePromptInvalid);
      return;
    }
    // Перевірка унікальності — case-insensitive, через індекс (зекономлений CPU на повний скан).
    const { userExistsByDisplayNameCi } = await import('./storage.js');
    const taken = await userExistsByDisplayNameCi(name, tgId);
    if (taken) {
      await sendMessage(chatId, fmt(T.nameTaken || 'Імʼя «{name}» вже зайняте, оберіть інше.', { name }));
      return;
    }
    // Фіксуємо ім'я + одразу позначаємо, що онбординг показано (нижче його надішлемо).
    // Якщо інтро впаде з помилкою — користувач все одно зможе натиснути «❓ Допомога → 📑 З чого складається опис».
    const introTime = nowIsoUtc();
    const updatedUser = { ...user, displayName: name, introShownAt: introTime };
    await Promise.all([
      upsertUser(updatedUser, user.rowIndex),
      sendMessage(chatId, fmt(T.nameSaved, { name }), {
        reply_markup: mainMenuKeyboard(updatedUser),
      }),
    ]);
    await sendIntroHelp(chatId, true);
    return;
  }

  // Існуючий користувач робить дію — якщо інтро ще не показували, покажемо зараз.
  // patchUser виставляє introShownAt усередині, щоб більше не повторювати.
  await maybeShowIntro(chatId, user);

  if (text === '/help') {
    await sendMessage(chatId, T.helpText, { reply_markup: helpMenuKeyboard() });
    return;
  }
  if (text === '/stop') {
    const updated = { ...user, status: 'paused' as const };
    await Promise.all([
      upsertUser(updated, user.rowIndex),
      sendMessage(chatId, T.paused, { reply_markup: mainMenuKeyboard(updated) }),
    ]);
    return;
  }
  if (text === '/resume') {
    const updated = { ...user, status: 'active' as const, consecutiveMisses: 0 };
    await Promise.all([
      upsertUser(updated, user.rowIndex),
      sendMessage(chatId, T.resumed, { reply_markup: mainMenuKeyboard(updated) }),
    ]);
    return;
  }
  if (text === '/cancel') {
    // Запам'ятовуємо відмову, щоб ця сама справа більше не приходила цьому юзеру.
    if (session?.caseId) {
      try {
        await recordSkippedCase(tgId, session.caseId);
      } catch (e) {
        console.error('recordSkippedCase failed', e);
      }
      // Збити лок, якщо collab.
      try {
        const cse = await getCase(session.caseId);
        if (cse?.mode === 'collaborative' && cse.lockedByTgId === tgId) {
          await unlockCase(session.caseId);
        }
      } catch (e) {
        console.error('unlockCase failed', e);
      }
    }
    const had = await deleteSession(tgId);
    await sendMessage(chatId, had ? T.cancelled : T.nothingToCancel, {
      reply_markup: mainMenuKeyboard(user),
    });
    return;
  }
  if (text === '/settings') return void (await cmdSettings(chatId, user));

  // Профіль: «Скасувати» з reply-клавіатури (contact-промпт).
  if (user.pendingAction === 'edit_contact' && rawText.trim() === T.cancelButton) {
    await Promise.all([
      patchUser(tgId, { pendingAction: '' }),
      sendMessage(chatId, T.profileEditCancelled, {
        reply_markup: mainMenuKeyboard({ ...user, pendingAction: '' }),
      }),
    ]);
    return;
  }

  // BYOK: користувач надсилає Gemini-ключ. Будь-який звичайний текст — це ключ.
  // Якщо тицьнув кнопку меню (команда) — мовчки скидаємо режим.
  if (user.pendingAction === 'add_gemini_key') {
    if (!text.startsWith('/')) {
      await processGeminiKeyInput(chatId, tgId, rawText, msg.message_id);
      return;
    }
    await patchUser(tgId, { pendingAction: '' });
    user.pendingAction = '';
  }

  // Профіль: текстові поля (місто/Facebook). Скидаємо режим якщо юзер тицьнув кнопку меню.
  if (user.pendingAction === 'edit_city' || user.pendingAction === 'edit_facebook') {
    if (!text.startsWith('/')) {
      if (user.pendingAction === 'edit_city') await processProfileCityInput(chatId, user, rawText);
      else await processProfileFacebookInput(chatId, user, rawText);
      return;
    }
    await patchUser(tgId, { pendingAction: '' });
    user.pendingAction = '';
  }

  // Користувач у режимі введення нового імені — будь-який звичайний текст є відповіддю.
  // Якщо натиснув іншу кнопку меню (нормалізується в команду) — мовчки скидаємо режим
  // і даємо команді виконатись.
  if (user.pendingAction === 'rename') {
    if (!text.startsWith('/')) {
      await processRenameInput(chatId, user, rawText);
      return;
    }
    await patchUser(tgId, { pendingAction: '' });
    user.pendingAction = '';
  }

  if (text === '/stats') return void (await cmdStats(chatId, tgId, user));
  if (text === '/progress') return void (await cmdProgress(chatId, user));
  if (text === '/leaderboard') return void (await cmdLeaderboard(chatId, tgId, user));
  if (text === '/halloffame') return void (await cmdHallOfFame(chatId));
  if (text === '/next') return void (await cmdNext(chatId, tgId, session));

  // якщо є відкрита сесія — це відповідь на питання
  if (session) {
    await processAnswer(chatId, tgId, session, rawText);
    return;
  }

  // Невідомий текст і немає сесії — підказка з основним меню (не повний help).
  await sendMessage(chatId, 'Скористайтеся кнопками меню внизу.', {
    reply_markup: mainMenuKeyboard(user),
  });
}

async function handleCallback(cb: any) {
  // Так само як handleMessage — лише приват. У групах reply-кнопки бота можуть
  // спрацювати у відповідь на чужі тапи, що не має сенсу.
  if (cb.message?.chat?.type && cb.message.chat.type !== 'private') return;

  const chatId = cb.message.chat.id;
  const tgId = String(cb.from.id);
  const messageId = cb.message?.message_id;
  const data: string = cb.data || '';

  // Один getUser тут обслуговує і бан-чек, і онбординг нижче — без зайвого читання
  // (egress: не додаємо нового запиту понад той, що й так робився для intro).
  const cbUser = await getUser(tgId);

  // Бан (перевірка доброчесності): заблокований не може виконати жодну дію.
  if (cbUser?.banned) {
    await answerCallbackQuery(cb.id);
    await sendMessage(chatId, T.bannedNotice);
    return;
  }

  // Якщо існуючий користувач уже зареєстрований і ще не бачив онбординг —
  // показуємо зараз. Не блокуємо обробку основного callback-у (fire-and-forget).
  // Виняток — сам callback 'intro:ack', щоб не зациклити.
  if (data !== 'intro:ack' && cbUser) {
    Promise.resolve(maybeShowIntro(chatId, cbUser))
      .catch(e => console.error('maybeShowIntro (callback) failed', e));
  }

  // Клік по кнопці адмін-розсилки: `bc:<id>:<action>`. Логуємо клік (для звіту в
  // адмінці) і делегуємо наявній команді бота — жодної нової поведінки для юзера.
  if (data.startsWith('bc:')) {
    await answerCallbackQuery(cb.id);
    const [, idStr, action] = data.split(':');
    const bcId = parseInt(idStr, 10);
    if (Number.isFinite(bcId)) {
      try {
        const { recordBroadcastClick } = await import('./storage.js');
        await recordBroadcastClick(bcId, tgId, action || '');
      } catch (e) {
        console.error('recordBroadcastClick failed', e);
      }
    }
    if (!cbUser) return;
    switch (action) {
      case 'next': {
        const session = await getSession(tgId);
        await cmdNext(chatId, tgId, session);
        break;
      }
      case 'stats':       await cmdStats(chatId, tgId, cbUser); break;
      case 'progress':    await cmdProgress(chatId, cbUser); break;
      case 'leaderboard': await cmdLeaderboard(chatId, tgId, cbUser); break;
      case 'halloffame':  await cmdHallOfFame(chatId); break;
      case 'help':        await sendMessage(chatId, T.helpText, { reply_markup: helpMenuKeyboard() }); break;
      case 'settings':    await cmdSettings(chatId, cbUser); break;
      default: break; // невідома дія — клік уже залоговано, мовчки виходимо
    }
    return;
  }

  // Help-навігація — не залежить від сесії, обробляємо одразу.
  if (data.startsWith('help:')) {
    await answerCallbackQuery(cb.id);
    const section = data.slice(5);
    // «З чого складається опис» — окремий шлях: фото + caption, editMessageText не підходить.
    if (section === 'descstruct') {
      await sendIntroHelp(chatId, false);
      return;
    }
    const sections: Record<string, string> = {
      menu: T.helpText,
      about: T.helpAbout,
      howto: T.helpHowToAnswer,
      points: T.helpPoints,
      badges: buildBadgesHelpText(),
      schedule: T.helpSchedule,
      faq: T.helpFaq,
    };
    const text = sections[section] || T.helpText;
    const markup = section === 'menu' ? helpMenuKeyboard() : helpBackKeyboard();
    if (messageId) {
      try {
        await editMessageText(chatId, messageId, text, { reply_markup: markup });
        return;
      } catch {
        // fallback нижче
      }
    }
    await sendMessage(chatId, text, { reply_markup: markup });
    return;
  }

  // Ack кнопки «Ознайомився» в онбординг-пам'ятці.
  if (data === 'intro:ack') {
    await answerCallbackQuery(cb.id, T.introAcknowledged);
    // introShownAt уже виставлений у момент показу — тут просто ховаємо кнопку.
    if (messageId) {
      try {
        // У caption-повідомлень edit працює через editMessageCaption, а не editMessageText.
        // Простіше — просто прибрати reply_markup. Telegram дозволяє editMessageReplyMarkup.
        const { tg } = await import('./tg-api.js');
        await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
      } catch (e) {
        // не критично
      }
    }
    return;
  }

  // Налаштування — теж не залежить від сесії.
  if (data.startsWith('settings:')) {
    await answerCallbackQuery(cb.id);
    const action = data.slice('settings:'.length);
    const user = await getUser(tgId);
    if (!user) {
      await sendMessage(chatId, 'Надішліть /start');
      return;
    }
    if (action === 'rename') {
      await Promise.all([
        patchUser(tgId, { pendingAction: 'rename' }),
        sendMessage(chatId, T.settingsRenamePrompt, {
          reply_markup: settingsRenameCancelKeyboard(),
        }),
      ]);
      return;
    }
    if (action === 'rename_cancel') {
      await Promise.all([
        patchUser(tgId, { pendingAction: '' }),
        sendMessage(chatId, T.settingsRenameCancelled, {
          reply_markup: mainMenuKeyboard({ ...user, pendingAction: '' }),
        }),
      ]);
      return;
    }
    if (action === 'profile') {
      await sendProfileMenu(chatId, user);
      return;
    }
    // --- BYOK: Gemini-ключі (вхід із меню Налаштування) ---
    if (action === 'keys') {
      if (!secretBoxReady()) {
        await sendMessage(chatId, T.profileKeysNotConfigured);
        return;
      }
      await sendGeminiKeysScreen(chatId, tgId);
      return;
    }
    // --- Фільтр «Які справи надсилати» ---
    if (action === 'casefilter') {
      await sendMessage(chatId, fmt(T.caseFilterTitle, { current: caseFilterLabel(user.caseFilter) }), {
        reply_markup: caseFilterKeyboard(user.caseFilter),
      });
      return;
    }
    if (action.startsWith('cf:')) {
      const value = action.slice('cf:'.length) as CaseFilter;
      if (value === 'all' || value === 'recognition' || value === 'verification') {
        await patchUser(tgId, { caseFilter: value });
        await sendMessage(chatId, fmt(T.caseFilterSaved, { current: caseFilterLabel(value) }), {
          reply_markup: caseFilterKeyboard(value),
        });
      }
      return;
    }
    if (action === 'back') {
      await cmdSettings(chatId, user);
      return;
    }
    return;
  }

  // ---- Профіль: callback-кнопки редагування ----
  if (data.startsWith('profile:')) {
    await answerCallbackQuery(cb.id);
    const action = data.slice('profile:'.length);
    const user = await getUser(tgId);
    if (!user) {
      await sendMessage(chatId, 'Надішліть /start');
      return;
    }
    // --- BYOK: Gemini-ключі ---
    if (action === 'keys') {
      if (!secretBoxReady()) {
        await sendMessage(chatId, T.profileKeysNotConfigured);
        return;
      }
      await sendGeminiKeysScreen(chatId, tgId);
      return;
    }
    if (action === 'addkey') {
      if (!secretBoxReady()) {
        await sendMessage(chatId, T.profileKeysNotConfigured);
        return;
      }
      await Promise.all([
        patchUser(tgId, { pendingAction: 'add_gemini_key' }),
        sendMessage(chatId, T.profileKeysPrompt, { reply_markup: profileEditCancelKeyboard() }),
      ]);
      return;
    }
    if (action.startsWith('delkey:')) {
      const idx = Number(action.slice('delkey:'.length));
      const keys = await getUserGeminiKeys(tgId);
      if (Number.isInteger(idx) && idx >= 0 && idx < keys.length) {
        keys.splice(idx, 1);
        await setUserGeminiKeys(tgId, keys);
        await sendMessage(chatId, fmt(T.profileKeysDeleted, { count: keys.length }));
      }
      await sendGeminiKeysScreen(chatId, tgId);
      return;
    }
    if (action === 'edit_name') {
      // Імʼя — обовʼязкове, кнопки «Видалити» немає.
      await Promise.all([
        patchUser(tgId, { pendingAction: 'rename' }),
        sendMessage(chatId, T.settingsRenamePrompt, {
          reply_markup: profileEditCancelKeyboard(),
        }),
      ]);
      return;
    }
    if (action === 'edit_city') {
      await Promise.all([
        patchUser(tgId, { pendingAction: 'edit_city' }),
        sendMessage(chatId, T.profileCityPrompt, {
          reply_markup: profileEditCancelKeyboard('city', !!user.city),
        }),
      ]);
      return;
    }
    if (action === 'edit_facebook') {
      await Promise.all([
        patchUser(tgId, { pendingAction: 'edit_facebook' }),
        sendMessage(chatId, T.profileFacebookPrompt, {
          reply_markup: profileEditCancelKeyboard('facebook', !!user.facebookUrl),
        }),
      ]);
      return;
    }
    if (action === 'edit_photo') {
      await Promise.all([
        patchUser(tgId, { pendingAction: 'edit_photo' }),
        sendMessage(chatId, T.profilePhotoPrompt, {
          reply_markup: profileEditCancelKeyboard('photo', !!user.photoFileId),
        }),
      ]);
      return;
    }
    if (action === 'edit_contact') {
      await patchUser(tgId, { pendingAction: 'edit_contact' });
      await sendMessage(chatId, T.profileContactPrompt, {
        reply_markup: profileContactReplyKeyboard(),
      });
      // Додатково даємо інлайн-кнопку «Видалити», якщо вже збережено.
      if (user.phoneNumber) {
        await sendMessage(chatId, 'Або видалити вже збережений контакт:', {
          reply_markup: { inline_keyboard: [[{ text: T.profileDeleteButton, callback_data: 'profile:clear_contact' }]] },
        });
      }
      return;
    }
    if (action === 'cancel') {
      await Promise.all([
        patchUser(tgId, { pendingAction: '' }),
        sendMessage(chatId, T.profileEditCancelled, {
          reply_markup: mainMenuKeyboard({ ...user, pendingAction: '' }),
        }),
      ]);
      return;
    }
    if (action.startsWith('clear_')) {
      const field = action.slice('clear_'.length);
      await processProfileClear(chatId, user, field);
      return;
    }
    return;
  }

  // AI-розпізнавання справи (BYOK) — ключами користувача.
  if (data.startsWith('aiocr:')) {
    await answerCallbackQuery(cb.id);
    const caseId = data.slice('aiocr:'.length);
    await handleAiRecognition(chatId, tgId, caseId);
    return;
  }

  // Справи за 24 год без нарахованих балів.
  if (data === 'nopoints') {
    await answerCallbackQuery(cb.id);
    await sendNoPointsList(chatId, tgId);
    return;
  }

  // Досягнення — не залежать від сесії.
  if (data === 'badges') {
    await answerCallbackQuery(cb.id);
    await sendBadgesList(chatId, tgId);
    return;
  }
  if (data.startsWith('badge:')) {
    const badgeId = data.slice('badge:'.length);
    const ok = await sendBadgeCardById(chatId, tgId, badgeId);
    await answerCallbackQuery(cb.id, ok ? undefined : T.badgeLockedToast);
    return;
  }

  // Найкращі працівники: рейтинг обраного місяця (місце + сусіди).
  if (data.startsWith('hof:')) {
    await answerCallbackQuery(cb.id);
    const month = data.slice('hof:'.length);
    await sendMessage(chatId, await buildMonthlyLeaderboardText(month, tgId));
    return;
  }

  // Описовий пазл — не залежить від сесії.
  if (data === 'puzzle') {
    await answerCallbackQuery(cb.id);
    await sendPuzzleTask(chatId, tgId);
    return;
  }
  if (data === 'puzzle:rules') {
    await answerCallbackQuery(cb.id);
    await sendPuzzleRules(chatId);
    return;
  }
  if (data === 'puzzle:me') {
    await answerCallbackQuery(cb.id);
    await sendPuzzleResults(chatId, tgId);
    return;
  }

  // ack + читання сесії і питань — паралельно
  const [, session, questions] = await Promise.all([
    answerCallbackQuery(cb.id),
    getSession(tgId),
    getQuestions(),
  ]);

  if (!session) {
    await sendMessage(chatId, T.sessionExpired);
    return;
  }

  const answers: string[] = JSON.parse(session.answersJson || '[]');

  if (data === 'cancel') {
    // Запам'ятовуємо відмову, щоб ця сама справа більше не приходила цьому юзеру.
    if (session.caseId) {
      try {
        await recordSkippedCase(tgId, session.caseId);
      } catch (e) {
        console.error('recordSkippedCase failed', e);
      }
      // Якщо collab-справа була залочена за цим юзером — звільняємо.
      try {
        const cse = await getCase(session.caseId);
        if (cse?.mode === 'collaborative' && cse.lockedByTgId === tgId) {
          await unlockCase(session.caseId);
        }
      } catch (e) {
        console.error('unlockCase failed', e);
      }
    }
    await deleteSession(tgId);
    await sendMessage(chatId, T.cancelled);
    return;
  }

  // ----- Collaborative mode preview buttons -----
  if (data === 'collab:cancel') {
    if (session.caseId) {
      try { await recordSkippedCase(tgId, session.caseId); } catch (e) { console.error(e); }
      try { await unlockCase(session.caseId); } catch (e) { console.error(e); }
    }
    await deleteSession(tgId);
    await sendMessage(chatId, T.cancelled);
    return;
  }

  if (data === 'collab:confirm') {
    if (!session.caseId) { await sendMessage(chatId, T.sessionExpired); return; }
    const ack = await sendMessage(chatId, T.savingNotice);
    await collabConfirm(chatId, tgId, session.caseId, ack?.message_id);
    return;
  }

  if (data === 'collab:edit') {
    if (!session.caseId) { await sendMessage(chatId, T.sessionExpired); return; }
    // Фіксуємо намір редагувати: записуємо edit-подію зараз.
    try { await recordCaseEvent(session.caseId, tgId, 'edit'); } catch (e) { console.error(e); }
    // Переходимо у 'confirming' (щоб після зміни поля повертатись у summary з [Підтвердити]),
    // і одразу показуємо список полів для вибору.
    const next: BotSession = {
      ...session,
      state: 'confirming',
      updatedAt: nowIsoUtc(),
    };
    await Promise.all([
      setSession(next, session.rowIndex),
      sendMessage(chatId, 'Оберіть питання для редагування:', {
        reply_markup: keyboardForEdit(questions),
      }),
    ]);
    return;
  }

  // "Залишити поточну" — користувач погоджується з prefilled відповіддю.
  // Поведінка ідентична набору цього самого тексту вручну.
  if (data.startsWith('keep:')) {
    const idx = parseInt(data.split(':')[1], 10) || 0;
    const current = answers[idx] ?? '';
    await processAnswer(chatId, tgId, session, current);
    return;
  }

  if (data === 'skip') {
    // Користувач підтверджує, що поле в оригінальному документі не заповнене.
    answers[session.currentQ] = T.fieldEmptyValue || '';
    const nextIndex = session.currentQ + 1;
    // Режим редагування одного поля → одразу до підтвердження.
    if (session.state === 'editing') {
      const editedSession: BotSession = {
        ...session,
        answersJson: JSON.stringify(answers),
        state: 'confirming',
        updatedAt: nowIsoUtc(),
      };
      await resendCasePhoto(chatId, session.caseId);
      await Promise.all([
        setSession(editedSession, session.rowIndex),
        sendMessage(chatId, buildSummary(questions, answers), {
          reply_markup: keyboardForConfirm(),
        }),
      ]);
      return;
    }
    if (nextIndex >= questions.length) {
      const nextSession: BotSession = {
        ...session,
        answersJson: JSON.stringify(answers),
        currentQ: questions.length - 1,
        state: 'confirming',
        updatedAt: nowIsoUtc(),
      };
      await resendCasePhoto(chatId, session.caseId);
      await Promise.all([
        setSession(nextSession, session.rowIndex),
        sendMessage(chatId, buildSummary(questions, answers), {
          reply_markup: keyboardForConfirm(),
        }),
      ]);
    } else {
      const nextSession: BotSession = {
        ...session,
        answersJson: JSON.stringify(answers),
        currentQ: nextIndex,
        updatedAt: nowIsoUtc(),
      };
      await Promise.all([
        setSession(nextSession, session.rowIndex),
        askQuestion(chatId, questions, nextIndex),
      ]);
    }
    return;
  }

  if (data === 'back') {
    const prev = Math.max(0, session.currentQ - 1);
    const next: BotSession = {
      ...session,
      currentQ: prev,
      state: 'asking',
      updatedAt: nowIsoUtc(),
    };
    await Promise.all([
      setSession(next, session.rowIndex),
      askQuestion(chatId, questions, prev),
    ]);
    return;
  }

  if (data === 'edit') {
    await sendMessage(chatId, 'Оберіть питання для редагування:', {
      reply_markup: keyboardForEdit(questions),
    });
    return;
  }

  if (data.startsWith('edit:')) {
    const idx = parseInt(data.split(':')[1], 10) || 0;
    // 'editing' — після відповіді одразу повернемось у підтвердження.
    const next: BotSession = { ...session, currentQ: idx, state: 'editing', updatedAt: nowIsoUtc() };
    await Promise.all([
      setSession(next, session.rowIndex),
      askQuestion(chatId, questions, idx, answers[idx]),
    ]);
    return;
  }

  if (data === 'confirm') {
    // Миттєвий фідбек — щоб користувач не натискав знову поки йдуть Sheets/Telegram запити.
    const ack = await sendMessage(chatId, T.savingNotice);
    await confirmAndSubmit(chatId, tgId, session, questions, answers, ack?.message_id);
    return;
  }
}

// --------- commands ---------

async function cmdNext(chatId: number, tgId: string, existing: BotSession | null) {
  // Миттєвий фідбек поки шукаємо/відкриваємо.
  await sendMessage(chatId, T.processingNotice);
  console.log('[cmdNext]', { tgId, hasExisting: !!existing, state: existing?.state, currentQ: existing?.currentQ, caseId: existing?.caseId });

  if (existing) {
    const questions = await getQuestions();
    if (existing.state === 'confirming') {
      const answers: string[] = JSON.parse(existing.answersJson || '[]');
      await sendMessage(chatId, T.sessionAlreadyOpen);
      await resendCasePhoto(chatId, existing.caseId);
      await sendMessage(chatId, buildSummary(questions, answers), {
        reply_markup: keyboardForConfirm(),
      });
    } else if (existing.state === 'previewing') {
      const answers: string[] = JSON.parse(existing.answersJson || '[]');
      await sendMessage(chatId, T.sessionAlreadyOpen);
      await resendCasePhoto(chatId, existing.caseId);
      await sendMessage(chatId, buildSummary(questions, answers), {
        reply_markup: keyboardForCollabPreview(),
      });
    } else {
      await Promise.all([
        sendMessage(chatId, T.sessionAlreadyOpen),
        askQuestion(chatId, questions, existing.currentQ),
      ]);
    }
    return;
  }
  // Ручне «Нова справа» — іґноруємо paused, бо опція розсилки тільки для авторозсилок.
  await dispatchCaseToUser(tgId, true);
}

async function cmdStats(chatId: number, tgId: string, user: BotUser) {
  const today = kyivDateString();
  const month = kyivMonthString();
  const [todayCount, monthly] = await Promise.all([
    getDailyCount(tgId, today),
    getMonthlyLeaderboard(month),
  ]);
  // Догоняюча перевірка: видати бейджі, які користувач уже заслужив раніше
  // (для існуючих до фічі — тихо). Бейджі рахуються від lifetime total_points.
  await evaluateBadges({
    chatId,
    tgId,
    totalPoints: user.totalPoints,
    todayCount,
    badgesSeededAt: user.badgesSeededAt,
  });
  const badges = await countEarnedInCatalog(tgId);
  const points = computePointsForToday(Math.max(todayCount, 1));
  // Місце й (підтверджені) бали — за поточний місяць. Денних «балів» не показуємо:
  // частина сьогоднішніх дій — непідтверджені, тож одне число вводило б в оману.
  const myIdx = monthly.findIndex(u => u.tgId === tgId);
  const monthPoints = myIdx >= 0 ? pts2(monthly[myIdx].points) : 0;
  const rank = myIdx >= 0 ? myIdx + 1 : monthly.length + 1;
  let body = fmt(T.statsLine, {
    name: user.displayName,
    monthPoints,
    todayCount,
    multiplier: points.multiplier,
    rank,
    totalUsers: monthly.length,
  });
  // Якщо сьогодні марафон — додаємо рядок із нагадуванням і коефіцієнтом.
  const marathon = getActiveMarathon();
  if (marathon) {
    body += '\n\n' + fmt(T.marathonStatsLine, {
      name: marathon.name,
      actionWord: marathonActionWord(marathon),
      coef: marathon.coefficient,
      endDate: marathon.endDateLocal,
    });
  }
  // Inline-кнопки під «Мої бали»: досягнення (якщо є каталог) + «Мій Описовий пазл».
  // Reply-меню внизу лишається (воно is_persistent), тож inline тут не конфліктує.
  const rows: any[] = [];
  if (badges.total > 0) {
    body += '\n' + fmt(T.badgesStatsLine, { earned: badges.earned, total: badges.total });
    rows.push([{ text: T.menuBadges, callback_data: 'badges' }]);
  }
  // Непідтверджені бали + вхід до списку справ без балів.
  const unconfirmed = await getUnconfirmedTotal(tgId).catch(() => 0);
  if (unconfirmed > 0) {
    body += '\n' + fmt(T.unconfirmedLine, { points: Math.round(unconfirmed * 100) / 100 });
  }
  rows.push([{ text: T.nopointsButton, callback_data: 'nopoints' }]);
  rows.push([{ text: T.puzzleResultsButton, callback_data: 'puzzle:me' }]);
  await sendMessage(chatId, body, { reply_markup: { inline_keyboard: rows } });
}

// Список справ за 24 год, за які бали не нараховано, з деталізацією відмінностей.
async function sendNoPointsList(chatId: number | string, tgId: string) {
  const items = await getRecentForfeited(tgId, 24);
  if (items.length === 0) {
    await sendMessage(chatId, `${T.nopointsTitle}\n\n${T.nopointsEmpty}`);
    return;
  }
  await sendMessage(chatId, T.nopointsTitle);
  for (const it of items) {
    const diffs = it.fields.length
      ? it.fields
          .map(f => fmt(T.nopointsField, { label: escapeHtml(f.label), theirs: escapeHtml(f.theirs || '—'), final: escapeHtml(f.final || '—') }))
          .join('\n')
      : '—';
    await sendMessage(
      chatId,
      fmt(T.nopointsItem, { opys: escapeHtml(it.opysLabel), sprava: escapeHtml(it.spravaNo), diffs })
    );
  }
}

async function cmdProgress(chatId: number, user: BotUser) {
  // SQL-агрегація для списку описів + такі ж SQL-агрегати для ETA фонду.
  // Раніше тут робився getAllCases() — головне джерело egress (11 МБ/виклик).
  const target = telegramBotConfig.cases.targetSubmissions;
  const ETA_WINDOW_DAYS = 14;
  const [rawDescriptions, etaStats] = await Promise.all([
    getDescriptionProgressViaRpc(target),
    getFundEtaStats(target, ETA_WINDOW_DAYS),
  ]);
  const eta = computeFundEtaFromStats(
    etaStats.fullyDoneByBot,
    etaStats.completionsInWindow,
    ETA_WINDOW_DAYS
  );
  const etaLine =
    eta.remaining <= 0
      ? fmt(T.fundEtaDone, { fundNumber: eta.fundNumber })
      : eta.etaDateLocal
      ? fmt(T.fundEtaLine, {
          fundNumber: eta.fundNumber,
          remaining: eta.remaining,
          etaDate: eta.etaDateLocal,
        })
      : fmt(T.fundEtaUnknown, {
          fundNumber: eta.fundNumber,
          remaining: eta.remaining,
          windowDays: eta.windowDays,
        });
  // Перетворюємо у формат для відображення: name + donePct.
  const descriptions = rawDescriptions
    .map(d => ({
      name: `${d.archive} ${d.fund}-${d.opys}`,
      earliestCreatedAt: d.earliestCreatedAt,
      totalCases: d.totalCases,
      doneCases: d.doneCases,
      donePct:
        d.totalCases > 0
          ? Math.round((d.doneCases / d.totalCases) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => a.earliestCreatedAt.localeCompare(b.earliestCreatedAt));
  // Перші 3 НЕ повністю розпізнані описи (щоб мотивувати докрутити).
  const top = descriptions.filter(d => d.doneCases < d.totalCases).slice(0, 3);
  const fullyDoneCount = descriptions.filter(d => d.doneCases === d.totalCases).length;
  const header = fmt(T.progressTotalDescriptions, { count: fullyDoneCount });
  const blocks = top.map(d =>
    fmt(T.progressDescriptionLine, {
      name: escapeHtml(d.name),
      donePct: d.donePct,
      doneCases: d.doneCases,
      totalCases: d.totalCases,
    })
  );
  // Якщо сьогодні марафон — додаємо рядок із датою завершення та коефіцієнтом.
  const marathon = getActiveMarathon();
  const marathonLine = marathon
    ? fmt(T.marathonProgressLine, {
        name: marathon.name,
        actionWord: marathonActionWord(marathon),
        coef: marathon.coefficient,
        endDate: marathon.endDateLocal,
      })
    : '';
  const body = [marathonLine, etaLine, header, ...blocks].filter(Boolean).join('\n\n');
  // Inline-кнопка гри «Описовий пазл». Reply-меню внизу лишається (is_persistent).
  await sendMessage(chatId, body, {
    reply_markup: { inline_keyboard: [[{ text: T.menuPuzzle, callback_data: 'puzzle' }]] },
  });
}

// 'YYYY-MM' → «травень 2026». Форматер виносимо на module-level, щоб не платити
// ICU-лукапи на кожен виклик (а викликається у Топ-10 та архіві місяців).
const MONTH_UK_FMT = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'UTC', month: 'long', year: 'numeric',
});
function formatMonthUk(month: string): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  return MONTH_UK_FMT.format(d);
}

function pts2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Текст місячного Топ-10: топ-10 + (якщо поза десяткою) сусіди — один над, сам, один під.
async function buildMonthlyLeaderboardText(month: string, tgId: string): Promise<string> {
  const all = await getMonthlyLeaderboard(month);
  const header = fmt(T.leaderboardMonthHeader, { month: formatMonthUk(month) });
  const top = all.slice(0, 10);
  const lines = top.map(
    (u, i) => `${i + 1}. ${escapeHtml(u.displayName || '—')} — ${pts2(u.points)}`
  );
  let body = `${header}\n${lines.join('\n') || '—'}`;
  const myRank = all.findIndex(u => u.tgId === tgId);
  if (myRank >= 10) {
    body += '\n...';
    for (let i = myRank - 1; i <= myRank + 1; i++) {
      if (i < 10 || i >= all.length) continue;
      const u = all[i];
      body +=
        i === myRank
          ? fmt(T.leaderboardYou, { rank: i + 1, points: pts2(u.points) })
          : `\n${i + 1}. ${escapeHtml(u.displayName || '—')} — ${pts2(u.points)}`;
    }
  }
  return body;
}

async function cmdLeaderboard(chatId: number, tgId: string, user: BotUser) {
  const body = await buildMonthlyLeaderboardText(kyivMonthString(), tgId);
  await sendMessage(chatId, body, { reply_markup: mainMenuKeyboard(user) });
}

// «Найкращі працівники»: список доступних місяців (кнопками). Вибір місяця → hof:<month>.
async function cmdHallOfFame(chatId: number) {
  const months = await getMonthlyMonths();
  if (months.length === 0) {
    await sendMessage(chatId, T.hallOfFameEmpty);
    return;
  }
  // Показуємо до 24 останніх місяців (новіші — першими).
  const rows = months
    .slice(0, 24)
    .map(m => [{ text: formatMonthUk(m), callback_data: `hof:${m}` }]);
  await sendMessage(chatId, T.hallOfFamePick, { reply_markup: { inline_keyboard: rows } });
}

async function cmdSettings(chatId: number, user: BotUser) {
  await sendMessage(chatId, fmt(T.settingsHeader, { name: escapeHtml(user.displayName || '—') }), {
    reply_markup: settingsMenuKeyboard(),
  });
}

async function processRenameInput(chatId: number, user: BotUser, rawText: string) {
  const name = rawText.trim().slice(0, 32);
  if (!name) {
    await sendMessage(chatId, T.namePromptInvalid, {
      reply_markup: settingsRenameCancelKeyboard(),
    });
    return;
  }
  // Захист від випадкового кліку по кнопці меню — її текст не може бути імʼям.
  const menuTexts = new Set([
    T.menuNext, T.menuStats, T.menuProgress, T.menuLeaderboard,
    T.menuPause, T.menuResume, T.menuHelp, T.menuSettings,
  ]);
  if (menuTexts.has(rawText.trim())) {
    await sendMessage(chatId, T.nameIsMenuButton || T.namePromptInvalid, {
      reply_markup: settingsRenameCancelKeyboard(),
    });
    return;
  }
  // Те саме правило унікальності, що й при першій реєстрації.
  // Без getAllUsers — case-insensitive пошук по display_name через .ilike + neq tg_id.
  const { userExistsByDisplayNameCi } = await import('./storage.js');
  const taken =
    name.toLowerCase() !== (user.displayName || '').toLowerCase() &&
    (await userExistsByDisplayNameCi(name, user.tgId));
  if (taken) {
    await sendMessage(chatId, fmt(T.nameTaken, { name }), {
      reply_markup: settingsRenameCancelKeyboard(),
    });
    return;
  }
  const updated: BotUser = { ...user, displayName: name, pendingAction: '' };
  await Promise.all([
    upsertUser(updated, user.rowIndex),
    sendMessage(chatId, fmt(T.settingsRenameSaved, { name: escapeHtml(name) }), {
      reply_markup: mainMenuKeyboard(updated),
    }),
  ]);
}

// --------- Профіль ---------
async function sendProfileMenu(chatId: number | string, user: BotUser) {
  const text = fmt(T.profileMenuHeader, {
    name: escapeHtml(user.displayName || '—'),
    city: user.city ? escapeHtml(user.city) : T.profileFieldEmpty,
    photoStatus: user.photoFileId ? T.profilePhotoSet : T.profilePhotoNone,
    facebook: user.facebookUrl ? T.profileFieldHidden : T.profileFieldEmpty,
    contact: user.phoneNumber ? T.profileFieldHidden : T.profileFieldEmpty,
  });
  await sendMessage(chatId, text, { reply_markup: profileMenuKeyboard() });
}

async function processProfileCityInput(chatId: number, user: BotUser, rawText: string) {
  const v = rawText.trim().slice(0, 80);
  if (!v) {
    await sendMessage(chatId, T.profileCityPrompt, {
      reply_markup: profileEditCancelKeyboard('city', !!user.city),
    });
    return;
  }
  // Чистимо «область» — лишаємо тільки перший токен (на випадок, якщо ввели «Київ, Київська»).
  const city = v.split(/[,/]/).map(s => s.trim()).filter(Boolean)[0] || '';
  await Promise.all([
    patchUser(user.tgId, { city, region: '', pendingAction: '' }),
    sendMessage(chatId, T.profileCitySaved, {
      reply_markup: mainMenuKeyboard({ ...user, pendingAction: '' }),
    }),
  ]);
}

async function processProfileFacebookInput(chatId: number, user: BotUser, rawText: string) {
  const v = rawText.trim();
  if (!v) {
    await sendMessage(chatId, T.profileFacebookPrompt, {
      reply_markup: profileEditCancelKeyboard('facebook', !!user.facebookUrl),
    });
    return;
  }
  // Дозволяємо facebook.com, fb.com, m.facebook.com. Якщо без схеми — додамо https://.
  let url = v.slice(0, 256);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const ok = /^https:\/\/(www\.|m\.)?(facebook|fb)\.com\/.+/i.test(url);
  if (!ok) {
    await sendMessage(chatId, T.profileFacebookInvalid, {
      reply_markup: profileEditCancelKeyboard('facebook', !!user.facebookUrl),
    });
    return;
  }
  await Promise.all([
    patchUser(user.tgId, { facebookUrl: url, pendingAction: '' }),
    sendMessage(chatId, T.profileFacebookSaved, {
      reply_markup: mainMenuKeyboard({ ...user, pendingAction: '' }),
    }),
  ]);
}

// Очищення поля по кліку «🗑 Видалити».
async function processProfileClear(
  chatId: number | string,
  user: BotUser,
  field: string
): Promise<void> {
  let patch: any = { pendingAction: '' };
  let confirm = '';
  let already = false;
  if (field === 'city') {
    if (!user.city && !user.region) already = true;
    patch.city = '';
    patch.region = '';
    confirm = T.profileCityCleared;
  } else if (field === 'facebook') {
    if (!user.facebookUrl) already = true;
    patch.facebookUrl = '';
    confirm = T.profileFacebookCleared;
  } else if (field === 'photo') {
    if (!user.photoFileId) already = true;
    patch.photoFileId = '';
    patch.photoMessageId = '';
    confirm = T.profilePhotoCleared;
  } else if (field === 'contact') {
    if (!user.phoneNumber) already = true;
    patch.phoneNumber = '';
    confirm = T.profileContactCleared;
  } else {
    return;
  }
  if (already) {
    await sendMessage(chatId, T.profileNothingToDelete, {
      reply_markup: mainMenuKeyboard({ ...user, pendingAction: '' }),
    });
    return;
  }
  await Promise.all([
    patchUser(user.tgId, patch),
    sendMessage(chatId, confirm, {
      reply_markup: mainMenuKeyboard({ ...user, pendingAction: '' }),
    }),
  ]);
}

async function processProfilePhotoInput(chatId: number, user: BotUser, photoSizes: any[]) {
  // Беремо найбільшу розмірність — остання у масиві.
  const biggest = photoSizes[photoSizes.length - 1];
  const fileId: string = biggest?.file_id || '';
  if (!fileId) {
    await sendMessage(chatId, T.profilePhotoNotPhoto, { reply_markup: profileEditCancelKeyboard() });
    return;
  }
  // Повторно вантажимо у приватний канал, щоб мати власне message_id (адмін зможе перейти).
  // Підпис — короткі публічні дані юзера.
  const channelId = process.env[telegramBotConfig.tg.channelIdEnv];
  let photoMessageId = '';
  if (channelId) {
    try {
      const caption =
        `👤 Профіль\n` +
        `tg_id: <code>${escapeHtml(user.tgId)}</code>\n` +
        `Імʼя: ${escapeHtml(user.displayName || '—')}\n` +
        (user.city ? `Місто: ${escapeHtml(user.city)}\n` : '') +
        (user.tgUsername ? `Username: @${escapeHtml(user.tgUsername)}\n` : '');
      const res = await sendPhotoByFileId(channelId, fileId, caption);
      const arr = res?.photo || [];
      const newFid = arr.length ? arr[arr.length - 1].file_id : fileId;
      photoMessageId = String(res?.message_id || '');
      await patchUser(user.tgId, {
        photoFileId: newFid,
        photoMessageId,
        pendingAction: '',
      });
    } catch (e) {
      console.error('profile photo channel upload failed', e);
      // Fallback — збережемо хоча б отриманий file_id, щоб юзер міг показати аватар.
      await patchUser(user.tgId, { photoFileId: fileId, pendingAction: '' });
    }
  } else {
    await patchUser(user.tgId, { photoFileId: fileId, pendingAction: '' });
  }
  await sendMessage(chatId, T.profilePhotoSaved, {
    reply_markup: mainMenuKeyboard({ ...user, pendingAction: '' }),
  });
}

async function processProfileContactInput(chatId: number, user: BotUser, contact: any) {
  // Для безпеки приймаємо лише власний контакт юзера. Якщо поділилися чужим — ігноруємо.
  const sharedUserId = contact?.user_id ? String(contact.user_id) : '';
  if (sharedUserId && sharedUserId !== user.tgId) {
    await sendMessage(chatId, 'Поділіться, будь ласка, своїм контактом, а не чужим.', {
      reply_markup: profileContactReplyKeyboard(),
    });
    return;
  }
  const phone = String(contact?.phone_number || '').trim();
  if (!phone) {
    await sendMessage(chatId, T.profileContactPrompt, {
      reply_markup: profileContactReplyKeyboard(),
    });
    return;
  }
  await Promise.all([
    patchUser(user.tgId, { phoneNumber: phone, pendingAction: '' }),
    sendMessage(chatId, T.profileContactSaved, {
      reply_markup: mainMenuKeyboard({ ...user, pendingAction: '' }),
    }),
  ]);
}

// --------- dispatch / question flow ---------

export async function dispatchCaseToUser(
  tgId: string,
  // ignorePaused=true — ручний виклик (кнопка «Нова справа») іґнорує статус paused.
  // Опція «Зупинити розсилку» — тільки для авторозсилок за розкладом.
  ignorePaused = false,
  preloadedCases?: BotCase[]
): Promise<boolean> {
  // Паралельні незалежні читання.
  const [user, next, questions] = await Promise.all([
    getUser(tgId),
    selectNextCaseForUser(tgId, preloadedCases),
    getQuestions(),
  ]);
  console.log('[dispatch]', { tgId, userStatus: user?.status, ignorePaused, hasNext: !!next, nextCaseId: next?.caseId, questions: questions.length });
  if (!user) return false;
  if (user.banned) return false; // забаненим (перевірка доброчесності) не розсилаємо
  if (!ignorePaused && user.status !== 'active') return false;
  if (!next) {
    await sendMessage(tgId, T.noCasesLeft);
    return false;
  }
  if (questions.length === 0) return false;

  // Спочатку фото — щоб користувач бачив документ ДО першого питання.
  // Під фото — кнопка «Показати опис» (PDF архівного опису) + дисклеймер.
  // AI-кнопку даємо лише у flow створення опису (не у collab-перегляді чужого варіанту).
  const isRecognition = !(next.mode === 'collaborative' && next.confirmationsCount > 0);
  await sendCasePhotoWithOpys(tgId, next, isRecognition ? next.caseId : undefined);

  console.log('[dispatch.next]', {
    caseId: next.caseId,
    mode: next.mode,
    confirmationsCount: next.confirmationsCount,
    rawKeys: Object.keys(next),
  });
  // ----- Collab-режим: якщо вже є current версія, показуємо preview замість опитування. -----
  if (next.mode === 'collaborative' && next.confirmationsCount > 0) {
    const lockMinutes = await getCollabLockMinutes();
    await lockCase(next.caseId, tgId, lockMinutes);
    const summary = buildSummary(questions, next.currentAnswers);
    await Promise.all([
      setSession({
        tgId,
        caseId: next.caseId,
        // У previewing зберігаємо current_answers, щоб edit міг почати з них.
        answersJson: JSON.stringify(next.currentAnswers),
        currentQ: 0,
        startedAt: nowIsoUtc(),
        updatedAt: nowIsoUtc(),
        state: 'previewing',
      }),
      upsertUser(
        { ...user, lastDispatchedCaseId: next.caseId, lastDispatchedAt: nowIsoUtc() },
        user.rowIndex
      ),
      sendMessage(tgId, summary, { reply_markup: keyboardForCollabPreview() }),
    ]);
    return true;
  }

  // ----- Звичайний flow (parallel або collab без current версії — creation). -----
  if (next.mode === 'collaborative') {
    const lockMinutes = await getCollabLockMinutes();
    await lockCase(next.caseId, tgId, lockMinutes);
  }
  await Promise.all([
    setSession({
      tgId,
      caseId: next.caseId,
      answersJson: '[]',
      currentQ: 0,
      startedAt: nowIsoUtc(),
      updatedAt: nowIsoUtc(),
      state: 'asking',
    }),
    upsertUser(
      { ...user, lastDispatchedCaseId: next.caseId, lastDispatchedAt: nowIsoUtc() },
      user.rowIndex
    ),
    askQuestion(tgId, questions, 0),
  ]);
  return true;
}

// Промт для Gemini: витягни значення полів у фіксованому порядку → JSON-масив.
// Поле «Коментар розпізнавача» (роль 'notes') не просимо — виключаємо з інструкції.
// includedIdx — індекси питань, що увійшли до промту (для мапінгу відповіді назад).
function buildRecognitionPrompt(questions: TableColumn[]): { prompt: string; includedIdx: number[] } {
  const includedIdx = questions.map((_, i) => i).filter(i => questions[i].role !== 'notes');
  const list = includedIdx.map((qi, k) => `${k + 1}. ${questions[qi].label}`).join('\n');
  const prompt =
    'На зображенні — один запис із аркуша архівного опису (одна справа). ' +
    'Витягни значення для таких полів, у цьому порядку:\n' +
    list +
    '\n\nПравила запису чисел:\n' +
    '• Усі числа записуй арабськими цифрами (1, 2, 3…).\n' +
    '• ВИНЯТОК — номер століття: його лишай як на зображенні — римськими (напр. XIX) або арабськими цифрами.\n' +
    `\nПоверни ЛИШЕ JSON-масив рядків — рівно ${includedIdx.length} елемент(и), ` +
    'по одному значенню на поле у вказаному порядку. ' +
    'Якщо значення не видно або його немає — порожній рядок "". Без жодних пояснень.';
  return { prompt, includedIdx };
}

// Парсить відповідь Gemini у масив відповідей довжини count. null — якщо не JSON-масив.
function parseAiAnswers(raw: string, count: number): string[] | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const data = JSON.parse(cleaned);
    const arr: any[] | null = Array.isArray(data)
      ? data
      : Array.isArray(data?.fields)
        ? data.fields
        : null;
    if (!arr) return null;
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push(String(arr[i] ?? '').trim());
    return out;
  } catch {
    return null;
  }
}

// AI-розпізнавання справи ключами користувача. Результат → стандартна картка
// підтвердження (state 'confirming'): далі користувач підтверджує / виправляє / пропускає.
async function handleAiRecognition(chatId: number, tgId: string, caseId: string) {
  const [keys, session, questions, cse] = await Promise.all([
    getUserGeminiKeys(tgId),
    getSession(tgId),
    getQuestions(),
    getCase(caseId),
  ]);

  if (keys.length === 0) {
    await sendMessage(chatId, T.aiNoKeys);
    return;
  }
  // Розпізнаємо лише в межах активної сесії саме цієї справи (інакше — застаріла кнопка).
  if (!session || session.caseId !== caseId) {
    await sendMessage(chatId, T.sessionExpired);
    return;
  }
  if (!cse || !cse.tgFileId) {
    await sendMessage(chatId, T.aiImageGone);
    return;
  }
  if (questions.length === 0) return;

  await sendMessage(chatId, T.aiRecognizing);

  let img: { base64: string; mime: string } | null;
  try {
    img = await downloadTelegramFileBase64(cse.tgFileId);
  } catch (e) {
    console.error('[aiocr] download failed', e);
    img = null;
  }
  if (!img) {
    await sendMessage(chatId, T.aiImageGone);
    return;
  }

  const { prompt, includedIdx } = buildRecognitionPrompt(questions);
  const model = telegramBotConfig.slicing.geminiModel || telegramBotConfig.slicing.autoModel;

  let raw: string;
  try {
    const res = await recognizeWithRotation(keys, img.base64, img.mime, prompt, model);
    raw = res.text;
  } catch (e) {
    if (e instanceof AllKeysExhaustedError) {
      await sendMessage(chatId, T.aiExhausted);
    } else if (e instanceof NoValidKeyError) {
      // Показуємо технічну деталь помилки Gemini — для діагностики.
      const detail = e.detail ? `\n\n<code>${escapeHtml(e.detail)}</code>` : '';
      await sendMessage(chatId, T.aiFailed + detail);
    } else {
      console.error('[aiocr] recognize failed', e);
      await sendMessage(chatId, T.aiFailed);
    }
    return;
  }

  const aiArr = parseAiAnswers(raw, includedIdx.length);
  if (!aiArr) {
    await sendMessage(chatId, T.aiBadResponse);
    return;
  }
  // Мапимо відповідь назад на повні позиції питань; поле «Коментар» лишаємо порожнім.
  const answers: string[] = new Array(questions.length).fill('');
  includedIdx.forEach((qi, k) => { answers[qi] = aiArr[k] ?? ''; });

  // Переходимо до підтвердження. У стані 'confirming' ручний ввід уже блокується
  // (processAnswer віддає підказку натиснути кнопку) — як і вимагалось.
  const next: BotSession = {
    ...session,
    answersJson: JSON.stringify(answers),
    currentQ: questions.length - 1,
    state: 'confirming',
    updatedAt: nowIsoUtc(),
  };
  await setSession(next, session.rowIndex);
  await resendCasePhoto(chatId, caseId);
  await sendMessage(chatId, buildSummary(questions, answers), {
    reply_markup: keyboardForConfirm(),
  });
  await sendMessage(chatId, T.aiReviewHint);
}

function pickRandom<T>(arr: T[]): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

// Надсилає випадкове привітання перед розсилкою справи за розкладом.
// Викликається з cron-tick перед dispatchCaseToUser.
export async function sendScheduledGreeting(tgId: string): Promise<void> {
  const greeting = pickRandom(telegramBotConfig.scheduledGreetings);
  if (!greeting) return;
  await sendMessage(tgId, greeting);
}

async function askQuestion(
  chatId: number | string,
  questions: TableColumn[],
  index: number,
  prefilledAnswer?: string
) {
  const q = questions[index];
  if (!q) {
    console.warn('[askQuestion] no question at index', { chatId, index, total: questions.length });
    return;
  }
  const hasPrefill = !!(prefilledAnswer && prefilledAnswer.trim());
  await sendMessage(chatId, questionPromptText(q, index, questions.length), {
    reply_markup: keyboardForQuestion(index, hasPrefill),
  });
  if (hasPrefill) {
    // Підказка для копіювання + сама поточна відповідь окремим повідомленням
    // (на мобілці long-press → Copy → вставити у поле і відредагувати).
    await sendMessage(
      chatId,
      '💡 Поточна відповідь нижче. Затисніть її → Скопіювати → вставте у поле вводу і відредагуйте. Або тисніть «Залишити поточну» щоб не міняти.'
    );
    await sendMessage(chatId, prefilledAnswer!);
  }
}

async function processAnswer(chatId: number, tgId: string, session: BotSession, text: string) {
  if (session.state === 'confirming') {
    await sendMessage(chatId, 'Натисніть кнопку Підтвердити або Виправити.');
    return;
  }
  if (session.state === 'previewing') {
    await sendMessage(chatId, 'Натисніть Підтвердити, Редагувати або Скасувати.');
    return;
  }

  const questions = await getQuestions();
  const answers: string[] = JSON.parse(session.answersJson || '[]');
  const q = questions[session.currentQ];
  if (!q) return;

  const err = validateAnswer(q.role, text);
  if (err) {
    await sendMessage(chatId, err);
    return;
  }

  answers[session.currentQ] = text.trim();
  const nextIndex = session.currentQ + 1;

  // Якщо це режим редагування одного поля — після відповіді одразу
  // повертаємось до підтвердження зі зведенням.
  if (session.state === 'editing') {
    const next: BotSession = {
      ...session,
      answersJson: JSON.stringify(answers),
      state: 'confirming',
      updatedAt: nowIsoUtc(),
    };
    await resendCasePhoto(chatId, session.caseId);
    await Promise.all([
      setSession(next, session.rowIndex),
      sendMessage(chatId, buildSummary(questions, answers), {
        reply_markup: keyboardForConfirm(),
      }),
    ]);
    return;
  }

  if (nextIndex >= questions.length) {
    const next: BotSession = {
      ...session,
      answersJson: JSON.stringify(answers),
      currentQ: questions.length - 1,
      state: 'confirming',
      updatedAt: nowIsoUtc(),
    };
    await resendCasePhoto(chatId, session.caseId);
    await Promise.all([
      setSession(next, session.rowIndex),
      sendMessage(chatId, buildSummary(questions, answers), {
        reply_markup: keyboardForConfirm(),
      }),
    ]);
  } else {
    const next: BotSession = {
      ...session,
      answersJson: JSON.stringify(answers),
      currentQ: nextIndex,
      updatedAt: nowIsoUtc(),
    };
    await Promise.all([
      setSession(next, session.rowIndex),
      askQuestion(chatId, questions, nextIndex),
    ]);
  }
}

async function confirmAndSubmit(
  chatId: number,
  tgId: string,
  session: BotSession,
  questions: TableColumn[],
  answers: string[],
  ackMessageId?: number
) {
  // user і case — паралельно
  const [user, cse] = await Promise.all([getUser(tgId), getCase(session.caseId)]);
  if (!user) return;
  if (!cse) {
    await sendMessage(chatId, 'Справу видалено. Скасовано.');
    await deleteSession(tgId);
    return;
  }

  console.log('[confirmAndSubmit] case', {
    caseId: cse.caseId,
    mode: cse.mode,
    confirmationsCount: cse.confirmationsCount,
    hasMode: 'mode' in cse,
  });
  // Collab-режим: розгалуження на create vs edit.
  if (cse.mode === 'collaborative') {
    return collabSubmit(chatId, tgId, cse, user, questions, answers, ackMessageId);
  }

  const sourceLinkEnabled = telegramBotConfig.sheets.sourceLink.mode !== 'none';
  const sourceLink = sourceLinkEnabled ? buildSourceLink(cse) : '';

  // Спочатку записуємо submission, потім інше паралельно. ВАЖЛИВО:
  // recomputeCaseSubmissionCount читає кількість submissions з БД — якщо запустити
  // паралельно з appendSubmission, він побачить стару кількість і лічильник
  // зросте на 1 менше за фактичне. Через це справи з 3 підтвердженнями могли
  // залишатися "open" з count=2.
  const today = kyivDateString();
  await appendSubmission({
    caseId: cse.caseId,
    tgId,
    displayName: user.displayName,
    answers: questions.map((_, i) => answers[i] ?? ''),
    sourceLink,
    archive: cse.archive,
    fund: cse.fund,
    opys: cse.opys,
    sprava: cse.sprava,
    sourcePdf: cse.sourcePdf,
    page: cse.page,
  });
  const [, newCaseCount, todayCount, todayDone] = await Promise.all([
    deleteSession(tgId),
    recomputeCaseSubmissionCount(cse.caseId),
    incDailyCount(tgId, today),
    getTodayProcessedCases(),
  ]);
  if (newCaseCount >= telegramBotConfig.cases.targetSubmissions) {
    try {
      const { maybeAnnounceDescriptionDone } = await import('./groupAnnounce.js');
      await maybeAnnounceDescriptionDone(cse.archive, cse.fund, cse.opys);
    } catch (e) {
      console.error('maybeAnnounceDescriptionDone (tg-parallel) failed', e);
    }
  }

  const pts = computePointsForToday(todayCount);
  const prevPts = todayCount > 1 ? computePointsForToday(todayCount - 1) : { multiplier: 1 };
  // Марафон: розпізнавання (parallel-сабміт). Коефіцієнт — поверх денного множника.
  const bonus = applyMarathonBonus(pts.pointsEarned, 'recognition');
  const earned = bonus.points;
  const newTotal = Math.round((user.totalPoints + earned) * 100) / 100;

  // Мотиваційне повідомлення:
  // • при переході в tier1 або tier2 (множник зріс) — одне повідомлення з відповідного списку;
  // • на найвищому рівні (tier2) — повідомлення після КОЖНОГО підтвердження.
  const cfgPts = telegramBotConfig.points;
  const tierMsgs = telegramBotConfig.tierMessages;
  let tierMsg: string | undefined;
  const reachedTier2 = pts.multiplier === cfgPts.tier2.multiplier;
  const reachedTier1Now =
    pts.multiplier === cfgPts.tier1.multiplier && prevPts.multiplier !== cfgPts.tier1.multiplier;
  if (reachedTier2) {
    tierMsg = pickRandom(tierMsgs.tier2);
  } else if (reachedTier1Now) {
    tierMsg = pickRandom(tierMsgs.tier1);
  }

  let finalText = fmt(T.pointsEarned, {
    points: earned,
    todayCount,
    total: newTotal,
    todayDone,
    goal: telegramBotConfig.cases.dailyGoal,
  });
  if (bonus.marathon) {
    finalText += '\n' + fmt(T.marathonConfirmLine, {
      name: bonus.marathon.name,
      coef: bonus.marathon.coefficient,
    });
  }
  await Promise.all([
    upsertUser(
      { ...user, totalPoints: newTotal, consecutiveMisses: 0 },
      user.rowIndex
    ),
    // Місячний рейтинг: ті самі бали — у рядок поточного київського місяця.
    incMonthlyPoints(kyivMonthString(), tgId, earned, user.displayName),
    // Редагуємо ack-повідомлення на фінальний текст замість надсилання нового.
    // ВАЖЛИВО: editMessageText дозволяє тільки inline_keyboard у reply_markup.
    // mainMenuKeyboard — це reply keyboard (постійна, унизу екрана), її не треба
    // прокидати в edit — вона сама по собі не зникне. Тому редагуємо БЕЗ reply_markup.
    ackMessageId
      ? editMessageText(chatId, ackMessageId, finalText)
          .catch(() => sendMessage(chatId, finalText, { reply_markup: mainMenuKeyboard(user) }))
      : sendMessage(chatId, finalText, { reply_markup: mainMenuKeyboard(user) }),
  ]);

  if (tierMsg) {
    await sendMessage(chatId, tierMsg);
  }

  await evaluateBadges({
    chatId,
    tgId,
    totalPoints: newTotal,
    todayCount,
    badgesSeededAt: user.badgesSeededAt,
  });
}

// ----- Collaborative submit: спільна логіка для create і edit. -----
// Викликається з confirmAndSubmit коли case.mode === 'collaborative'.
// Розрізняє create vs edit по тому, чи юзер уже фігурує в bot_case_confirmations
// (collab:edit вписує 'edit' одразу при натисканні; для creation запису ще немає).
async function collabSubmit(
  chatId: number,
  tgId: string,
  cse: BotCase,
  user: BotUser,
  questions: TableColumn[],
  answers: string[],
  ackMessageId?: number
) {
  const finalAnswers = questions.map((_, i) => answers[i] ?? '');
  const alreadyEdit = await hasUserTouchedCase(cse.caseId, tgId);

  if (alreadyEdit) {
    // EDIT: оновлюємо current_answers, скидаємо лічильник до 1.
    // Перезаписуємо edit-подію зі снапшотом фактичних відповідей (recordCaseEvent
    // при натисканні collab:edit ще не знав, що саме введе користувач).
    await Promise.all([
      setCaseEdited(cse.caseId, tgId, finalAnswers),
      recordCaseEvent(cse.caseId, tgId, 'edit', finalAnswers),
    ]);
  } else {
    // CREATE: перша версія справи.
    await Promise.all([
      setCaseCreated(cse.caseId, tgId, finalAnswers),
      recordCaseEvent(cse.caseId, tgId, 'create', finalAnswers),
    ]);
    // Описовий пазл: збираємо слова заголовка для фрази дня (тільки на розпізнаванні).
    await collectPuzzleWordsOnCreate(tgId, cse.caseId, questions, finalAnswers);
  }

  // Розпізнавання (create) — 3 бали база; редагування — 1 (це перевірка з правкою).
  const actionBase = alreadyEdit ? 1 : 3;
  const action: MarathonAction = alreadyEdit ? 'verification' : 'recognition';
  // Розпізнавання/редагування — бали тримаємо як «непідтверджені» до закриття справи.
  await deliverCollabPoints(chatId, tgId, user, ackMessageId, /*closed*/ false, actionBase, action, /*held*/ true, cse.caseId);
  await deleteSession(tgId);
}

// Обробка натискання "Підтвердити" на preview.
async function collabConfirm(
  chatId: number,
  tgId: string,
  caseId: string,
  ackMessageId?: number
) {
  const [user, cse] = await Promise.all([getUser(tgId), getCase(caseId)]);
  if (!user) return;
  if (!cse) {
    await sendMessage(chatId, 'Справу видалено. Скасовано.');
    await deleteSession(tgId);
    return;
  }
  const min = await getMinConfirmations();
  // Снапшот того, що користувач підтвердив — поточні current_answers справи.
  await recordCaseEvent(caseId, tgId, 'confirm', cse.currentAnswers || []);
  const { closed } = await confirmCase(caseId, min);
  // Перевірка — 1 бал база (нараховується одразу, не «непідтверджені»).
  await deliverCollabPoints(chatId, tgId, user, ackMessageId, closed, 1, 'verification');
  // Справу закрито — розраховуємо непідтверджені бали її розпізнавача/редакторів.
  if (closed) {
    try {
      await settleCaseAtClose(caseId, cse.currentAnswers || []);
    } catch (e) {
      console.error('settleCaseAtClose (tg) failed', e);
    }
  }
  await deleteSession(tgId);
  // Описовий пазл: зараховуємо слова (для розпізнавача). Чи на кожне підтвердження,
  // чи лише на повне закриття — вирішує config.puzzle.confirmMode.
  await onCollabCaseConfirmed(caseId, closed);
  if (closed) {
    try {
      const { maybeAnnounceDescriptionDone } = await import('./groupAnnounce.js');
      await maybeAnnounceDescriptionDone(cse.archive, cse.fund, cse.opys);
    } catch (e) {
      console.error('maybeAnnounceDescriptionDone (tg-collab) failed', e);
    }
  }
}

// Спільна частина для collab create/edit/confirm: бали, повідомлення.
async function deliverCollabPoints(
  chatId: number,
  tgId: string,
  user: BotUser,
  ackMessageId: number | undefined,
  closed: boolean,
  actionBase: number,
  action: MarathonAction,
  // held=true (розпізнавання/редагування): бали тримаємо як «непідтверджені» до
  // закриття справи — потрібен caseId, на рядок якого їх запишемо.
  held = false,
  caseId?: string
) {
  const today = kyivDateString();
  const [todayCount, todayDone] = await Promise.all([
    incDailyCount(tgId, today),
    getTodayProcessedCases(),
  ]);
  const pts = computePointsForToday(todayCount, actionBase);
  const prevPts = todayCount > 1 ? computePointsForToday(todayCount - 1, actionBase) : { multiplier: 1 };
  // Марафон: коефіцієнт поверх денного множника, якщо ця дія бере участь.
  const bonus = applyMarathonBonus(pts.pointsEarned, action);
  const earned = bonus.points;

  // ----- Непідтверджені бали: записуємо й виходимо (не чіпаємо total/місячний/бейджі) -----
  if (held && caseId) {
    await Promise.all([
      recordPendingPoints(caseId, tgId, earned),
      patchUser(tgId, { consecutiveMisses: 0 }),
    ]);
    const pendingText =
      fmt(T.pointsPending, { points: earned, todayCount, todayDone, goal: telegramBotConfig.cases.dailyGoal }) +
      (bonus.marathon ? '\n' + fmt(T.marathonConfirmLine, { name: bonus.marathon.name, coef: bonus.marathon.coefficient }) : '');
    await (ackMessageId
      ? editMessageText(chatId, ackMessageId, pendingText).catch(() => sendMessage(chatId, pendingText, { reply_markup: mainMenuKeyboard(user) }))
      : sendMessage(chatId, pendingText, { reply_markup: mainMenuKeyboard(user) }));
    return;
  }

  const newTotal = Math.round((user.totalPoints + earned) * 100) / 100;

  const cfgPts = telegramBotConfig.points;
  const tierMsgs = telegramBotConfig.tierMessages;
  let tierMsg: string | undefined;
  const reachedTier2 = pts.multiplier === cfgPts.tier2.multiplier;
  const reachedTier1Now =
    pts.multiplier === cfgPts.tier1.multiplier && prevPts.multiplier !== cfgPts.tier1.multiplier;
  if (reachedTier2) tierMsg = pickRandom(tierMsgs.tier2);
  else if (reachedTier1Now) tierMsg = pickRandom(tierMsgs.tier1);

  const finalText =
    fmt(T.pointsEarned, {
      points: earned,
      todayCount,
      total: newTotal,
      todayDone,
      goal: telegramBotConfig.cases.dailyGoal,
    }) +
    (bonus.marathon
      ? '\n' + fmt(T.marathonConfirmLine, {
          name: bonus.marathon.name,
          coef: bonus.marathon.coefficient,
        })
      : '') +
    (closed ? '\n\n✅ Справу зведено — дякую за допомогу!' : '');

  await Promise.all([
    upsertUser({ ...user, totalPoints: newTotal, consecutiveMisses: 0 }, user.rowIndex),
    // Місячний рейтинг: ті самі бали — у поточний київський місяць.
    incMonthlyPoints(kyivMonthString(), tgId, earned, user.displayName),
    ackMessageId
      ? editMessageText(chatId, ackMessageId, finalText)
          .catch(() => sendMessage(chatId, finalText, { reply_markup: mainMenuKeyboard(user) }))
      : sendMessage(chatId, finalText, { reply_markup: mainMenuKeyboard(user) }),
  ]);

  if (tierMsg) await sendMessage(chatId, tierMsg);

  await evaluateBadges({
    chatId,
    tgId,
    totalPoints: newTotal,
    todayCount,
    badgesSeededAt: user.badgesSeededAt,
  });
}

function buildSourceLink(cse: any): string {
  const cfg = telegramBotConfig.sheets.sourceLink;
  if (cfg.mode === 'none') return '';
  const channelId = String(cse.tgChatId || '');
  const channelIdShort = channelId.startsWith('-100') ? channelId.slice(4) : channelId.replace(/^-/, '');
  return cfg.template
    .replace('{channelId}', channelId)
    .replace('{channelIdShort}', channelIdShort)
    .replace('{messageId}', String(cse.tgMessageId || ''))
    .replace('{caseId}', cse.caseId)
    .replace('{pdfUrl}', cse.sourcePdf || '')
    .replace('{page}', String(cse.page || ''));
}
