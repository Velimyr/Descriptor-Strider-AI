import type { TableColumn, ColumnRole } from '../../src/types.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  appendSubmission,
  BotSession,
  BotUser,
  deleteSession,
  getAllUsers,
  getCase,
  getMeta,
  getSession,
  getUser,
  incDailyCount,
  patchUser,
  setSession,
  upsertUser,
  getDailyCount,
  getResultsTotals,
  getAllCases,
} from './storage.js';
import {
  answerCallbackQuery,
  sendMessage,
  sendPhotoByFileId,
} from './tg-api.js';
import {
  computePointsForToday,
  kyivDateString,
  leaderboardSorted,
  nowIsoUtc,
  progressOfAllCases,
  recomputeCaseSubmissionCount,
  selectNextCaseForUser,
} from './scheduler.js';

const T = telegramBotConfig.texts;

// --------- helpers ---------

function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? `{${k}}`));
}

async function getQuestions(): Promise<TableColumn[]> {
  const raw = await getMeta('questions');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
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
      return 'Формат: ДД.ММ.РРРР або просто рік';
    case 'page_count':
      return 'Введіть число';
    case 'year_range':
      return 'Напр.: 1923 або 1923–1925';
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
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] || ch));
}

function keyboardForQuestion(qIndex: number): any {
  const buttons: any[] = [];
  if (qIndex > 0) buttons.push({ text: T.backButton, callback_data: 'back' });
  buttons.push({ text: T.cancelButton, callback_data: 'cancel' });
  return { inline_keyboard: [buttons] };
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

function buildSummary(questions: TableColumn[], answers: string[]): string {
  const lines = questions.map((q, i) => `<b>${escapeHtml(q.label)}</b>: ${escapeHtml(answers[i] ?? '—')}`);
  return `${T.confirmHeader}\n\n${lines.join('\n')}`;
}

// --------- main handler ---------

export async function handleUpdate(update: any): Promise<void> {
  if (update.callback_query) {
    return handleCallback(update.callback_query);
  }
  if (update.message) {
    return handleMessage(update.message);
  }
}

async function handleMessage(msg: any) {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const text: string = msg.text || '';

  // Читаємо user і session паралельно — все одно потрібні для більшості шляхів.
  const [user, session] = await Promise.all([getUser(tgId), getSession(tgId)]);

  if (text.startsWith('/start')) {
    if (!user) {
      await Promise.all([
        upsertUser({
          tgId,
          displayName: '',
          totalPoints: 0,
          lastDispatchedCaseId: '',
          lastDispatchedAt: '',
          consecutiveMisses: 0,
          status: 'active',
          createdAt: nowIsoUtc(),
        }),
        sendMessage(chatId, T.welcome),
      ]);
    } else {
      await sendMessage(chatId, T.helpText);
    }
    return;
  }

  if (!user) {
    await sendMessage(chatId, 'Надішліть /start');
    return;
  }

  // ім'я ще не задано
  if (!user.displayName) {
    const name = text.trim().slice(0, 32);
    if (!name || name.startsWith('/')) {
      await sendMessage(chatId, T.namePromptInvalid);
      return;
    }
    await Promise.all([
      upsertUser({ ...user, displayName: name }, user.rowIndex),
      sendMessage(chatId, fmt(T.nameSaved, { name })),
    ]);
    return;
  }

  if (text === '/help') return void (await sendMessage(chatId, T.helpText));
  if (text === '/stop') {
    await Promise.all([
      upsertUser({ ...user, status: 'paused' }, user.rowIndex),
      sendMessage(chatId, T.paused),
    ]);
    return;
  }
  if (text === '/resume') {
    await Promise.all([
      upsertUser({ ...user, status: 'active', consecutiveMisses: 0 }, user.rowIndex),
      sendMessage(chatId, T.resumed),
    ]);
    return;
  }
  if (text === '/cancel') {
    const had = await deleteSession(tgId);
    return void (await sendMessage(chatId, had ? T.cancelled : T.nothingToCancel));
  }
  if (text === '/stats') return void (await cmdStats(chatId, tgId, user));
  if (text === '/progress') return void (await cmdProgress(chatId));
  if (text === '/leaderboard') return void (await cmdLeaderboard(chatId, tgId));
  if (text === '/next') return void (await cmdNext(chatId, tgId, session));

  // якщо є відкрита сесія — це відповідь на питання
  if (session) {
    await processAnswer(chatId, tgId, session, text);
    return;
  }

  await sendMessage(chatId, T.helpText);
}

async function handleCallback(cb: any) {
  const chatId = cb.message.chat.id;
  const tgId = String(cb.from.id);
  const data: string = cb.data || '';

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
    await deleteSession(tgId);
    await sendMessage(chatId, T.cancelled);
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
    const next: BotSession = { ...session, currentQ: idx, state: 'asking', updatedAt: nowIsoUtc() };
    await Promise.all([
      setSession(next, session.rowIndex),
      askQuestion(chatId, questions, idx),
    ]);
    return;
  }

  if (data === 'confirm') {
    await confirmAndSubmit(chatId, tgId, session, questions, answers);
    return;
  }
}

// --------- commands ---------

async function cmdNext(chatId: number, tgId: string, existing: BotSession | null) {
  if (existing) {
    const questions = await getQuestions();
    if (existing.state === 'confirming') {
      const answers: string[] = JSON.parse(existing.answersJson || '[]');
      await Promise.all([
        sendMessage(chatId, T.sessionAlreadyOpen),
        sendMessage(chatId, buildSummary(questions, answers), {
          reply_markup: keyboardForConfirm(),
        }),
      ]);
    } else {
      await Promise.all([
        sendMessage(chatId, T.sessionAlreadyOpen),
        askQuestion(chatId, questions, existing.currentQ),
      ]);
    }
    return;
  }
  await dispatchCaseToUser(tgId);
}

async function cmdStats(chatId: number, tgId: string, user: BotUser) {
  const today = kyivDateString();
  const [todayCount, allUsers] = await Promise.all([getDailyCount(tgId, today), getAllUsers()]);
  const points = computePointsForToday(Math.max(todayCount, 1));
  const todayPoints = todayCount * points.multiplier * telegramBotConfig.points.base;
  const all = leaderboardSorted(allUsers);
  const rank = all.findIndex(u => u.tgId === tgId) + 1;
  await sendMessage(
    chatId,
    fmt(T.statsLine, {
      name: user.displayName,
      total: user.totalPoints,
      todayCount,
      todayPoints: Math.round(todayPoints * 100) / 100,
      multiplier: points.multiplier,
      rank: rank || all.length + 1,
      totalUsers: all.length,
    })
  );
}

async function cmdProgress(chatId: number) {
  const [cases, totals] = await Promise.all([getAllCases(), getResultsTotals()]);
  const p = progressOfAllCases(cases);
  await sendMessage(
    chatId,
    fmt(T.progressLine, {
      donePct: p.donePct,
      doneCases: p.doneCases,
      totalCases: p.totalCases,
      totalSubmissions: totals.totalSubmissions,
    })
  );
}

async function cmdLeaderboard(chatId: number, tgId: string) {
  const all = leaderboardSorted(await getAllUsers());
  const top = all.slice(0, 10);
  const lines = top.map(
    (u, i) => `${i + 1}. ${escapeHtml(u.displayName || '—')} — ${u.totalPoints}`
  );
  let body = `${T.leaderboardHeader}\n${lines.join('\n') || '—'}`;
  const myRank = all.findIndex(u => u.tgId === tgId);
  if (myRank >= 0 && myRank >= 10) {
    body += fmt(T.leaderboardYou, {
      rank: myRank + 1,
      points: all[myRank].totalPoints,
    });
  }
  await sendMessage(chatId, body);
}

// --------- dispatch / question flow ---------

export async function dispatchCaseToUser(tgId: string): Promise<boolean> {
  // Паралельні незалежні читання.
  const [user, next, questions] = await Promise.all([
    getUser(tgId),
    selectNextCaseForUser(tgId),
    getQuestions(),
  ]);
  if (!user || user.status !== 'active') return false;
  if (!next) {
    await sendMessage(tgId, T.noCasesLeft);
    return false;
  }
  if (questions.length === 0) {
    await sendMessage(tgId, 'Адмін ще не налаштував питання. Спробуйте пізніше.');
    return false;
  }

  // Усі побічні дії — паралельно.
  await Promise.all([
    sendPhotoByFileId(tgId, next.tgFileId, `Справа №${next.caseId.slice(0, 8)}`),
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

async function askQuestion(chatId: number | string, questions: TableColumn[], index: number) {
  const q = questions[index];
  if (!q) return;
  await sendMessage(chatId, questionPromptText(q, index, questions.length), {
    reply_markup: keyboardForQuestion(index),
  });
}

async function processAnswer(chatId: number, tgId: string, session: BotSession, text: string) {
  if (session.state === 'confirming') {
    await sendMessage(chatId, 'Натисніть кнопку Підтвердити або Виправити.');
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

  if (nextIndex >= questions.length) {
    const next: BotSession = {
      ...session,
      answersJson: JSON.stringify(answers),
      currentQ: questions.length - 1,
      state: 'confirming',
      updatedAt: nowIsoUtc(),
    };
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
  answers: string[]
) {
  const user = await getUser(tgId);
  if (!user) return;
  const cse = await getCase(session.caseId);
  if (!cse) {
    await sendMessage(chatId, 'Справу видалено. Скасовано.');
    await deleteSession(tgId);
    return;
  }

  // побудувати рядок для Results
  const cfg = telegramBotConfig.sheets;
  const before = cfg.serviceColumnsBefore; // case_id, telegram_user_id, display_name, submitted_at
  const after = cfg.serviceColumnsAfter;
  const sourceLinkEnabled = cfg.sourceLink.mode !== 'none';

  const headerRow = [
    ...before,
    ...questions.map(q => q.label),
    ...(sourceLinkEnabled ? [cfg.sourceLink.columnLabel] : []),
    ...after,
  ];

  const sourceLink = sourceLinkEnabled ? buildSourceLink(cse) : '';
  const dataRow: (string | number)[] = [
    cse.caseId,
    tgId,
    user.displayName,
    nowIsoUtc(),
    ...questions.map((_, i) => answers[i] ?? ''),
    ...(sourceLinkEnabled ? [sourceLink] : []),
  ];

  // Паралельно: пишемо submission, видаляємо сесію, перераховуємо лічильник, інкрементуємо денний рахунок.
  const today = kyivDateString();
  const [, , , todayCount] = await Promise.all([
    appendSubmission(headerRow, dataRow),
    deleteSession(tgId),
    recomputeCaseSubmissionCount(cse.caseId),
    incDailyCount(tgId, today),
  ]);

  const pts = computePointsForToday(todayCount);
  const newTotal = Math.round((user.totalPoints + pts.pointsEarned) * 100) / 100;

  await Promise.all([
    upsertUser(
      { ...user, totalPoints: newTotal, consecutiveMisses: 0 },
      user.rowIndex
    ),
    sendMessage(
      chatId,
      fmt(T.pointsEarned, {
        points: pts.pointsEarned,
        todayCount,
        total: newTotal,
      })
    ),
  ]);
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
