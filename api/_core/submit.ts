// Запис відповідей користувача (web або TG — байдуже, бо логіка по даних однакова).
// Повторює бізнес-правила з api/telegram/bot.ts: confirmAndSubmit / collabSubmit / collabConfirm.
// Повертає структуру для рендерингу — викликач сам вирішує як показати.
import {
  BotCase,
  BotUser,
  appendSubmission,
  confirmCase,
  getCase,
  hasUserTouchedCase,
  incDailyCount,
  incMonthlyPoints,
  recordCaseEvent,
  setCaseCreated,
  setCaseEdited,
  upsertUser,
} from '../_telegram/storage.js';
import {
  computePointsForToday,
  kyivDateString,
  kyivMonthString,
  recomputeCaseSubmissionCount,
} from '../_telegram/scheduler.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import { getMeta } from '../_telegram/storage.js';
import { applyMarathonBonus, type MarathonAction } from '../_telegram/marathon.js';

export type SubmitAction = 'submit' | 'confirm';

export interface SubmitResult {
  pointsEarned: number;
  multiplier: number;
  todayCount: number;
  total: number;
  closed: boolean;            // тільки collab: справу зведено цим підтвердженням
  actionTaken: 'parallel-create' | 'collab-create' | 'collab-edit' | 'collab-confirm';
  // Якщо діє марафон і ця дія в ньому бере участь — інфо для повідомлення; інакше null.
  marathon: { name: string; coefficient: number } | null;
}

export class SubmitError extends Error {
  constructor(public code: string, msg: string) {
    super(msg);
  }
}

async function getMinConfirmations(): Promise<number> {
  const raw = await getMeta('collab_min_confirmations');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : telegramBotConfig.cases.targetSubmissions;
}

function buildSourceLink(cse: BotCase): string {
  const cfg = telegramBotConfig.sheets.sourceLink;
  if (cfg.mode === 'none') return '';
  const channelId = String(cse.tgChatId || '');
  const channelIdShort = channelId.startsWith('-100')
    ? channelId.slice(4)
    : channelId.replace(/^-/, '');
  return cfg.template
    .replace('{channelId}', channelId)
    .replace('{channelIdShort}', channelIdShort)
    .replace('{messageId}', String(cse.tgMessageId || ''))
    .replace('{caseId}', cse.caseId)
    .replace('{pdfUrl}', cse.sourcePdf || '')
    .replace('{page}', String(cse.page || ''));
}

// Основна точка входу. answers — null для action='confirm', обовʼязковий для action='submit'.
export async function submitAnswers(
  user: BotUser,
  caseId: string,
  action: SubmitAction,
  answers: string[] | null
): Promise<SubmitResult> {
  const cse = await getCase(caseId);
  if (!cse) throw new SubmitError('case_not_found', 'Справу не знайдено');

  if (action === 'submit' && (!answers || answers.length === 0)) {
    throw new SubmitError('answers_required', 'Відповіді обов\'язкові для submit');
  }

  // ----- PARALLEL MODE -----
  if (cse.mode !== 'collaborative') {
    if (action !== 'submit') {
      throw new SubmitError('invalid_action', 'У parallel-режимі дозволено тільки submit');
    }
    return submitParallel(user, cse, answers!);
  }

  // ----- COLLABORATIVE MODE -----
  if (action === 'confirm') {
    if (cse.confirmationsCount === 0) {
      throw new SubmitError('nothing_to_confirm', 'У цій справі ще немає відповідей для підтвердження');
    }
    return submitCollabConfirm(user, cse);
  }

  // action === 'submit' у collab → create (перша версія) або edit (виправлення).
  const alreadyTouched = await hasUserTouchedCase(cse.caseId, user.tgId);
  if (cse.confirmationsCount === 0 && !alreadyTouched) {
    return submitCollabCreate(user, cse, answers!);
  }
  return submitCollabEdit(user, cse, answers!);
}

// ---- Parallel ----
async function submitParallel(user: BotUser, cse: BotCase, answers: string[]): Promise<SubmitResult> {
  const sourceLinkEnabled = telegramBotConfig.sheets.sourceLink.mode !== 'none';
  const sourceLink = sourceLinkEnabled ? buildSourceLink(cse) : '';
  const today = kyivDateString();

  // Послідовність важлива: спочатку submission, потім recompute — інакше count прийде на 1 менший.
  await appendSubmission({
    caseId: cse.caseId,
    tgId: user.tgId,
    displayName: user.displayName,
    answers,
    sourceLink,
    archive: cse.archive,
    fund: cse.fund,
    opys: cse.opys,
    sprava: cse.sprava,
    sourcePdf: cse.sourcePdf,
    page: cse.page,
    partnerId: user.partnerId, // денормалізована атрибуція до партнера
  });
  const [newCaseCount, todayCount] = await Promise.all([
    recomputeCaseSubmissionCount(cse.caseId),
    incDailyCount(user.tgId, today),
  ]);
  // Якщо саме цим сабмітом справу закрили — перевіримо, чи закрився ВЕСЬ опис.
  if (newCaseCount >= telegramBotConfig.cases.targetSubmissions) {
    try {
      const { maybeAnnounceDescriptionDone } = await import('../_telegram/groupAnnounce.js');
      await maybeAnnounceDescriptionDone(cse.archive, cse.fund, cse.opys);
    } catch (e) {
      console.error('maybeAnnounceDescriptionDone (parallel) failed', e);
    }
  }
  const pts = computePointsForToday(todayCount);
  const bonus = applyMarathonBonus(pts.pointsEarned, 'recognition');
  const newTotal = await applyUserPoints(user, bonus.points);
  return {
    pointsEarned: bonus.points,
    multiplier: pts.multiplier,
    todayCount,
    total: newTotal,
    closed: false,
    actionTaken: 'parallel-create',
    marathon: bonus.marathon ? { name: bonus.marathon.name, coefficient: bonus.marathon.coefficient } : null,
  };
}

// ---- Collab: create ----
async function submitCollabCreate(user: BotUser, cse: BotCase, answers: string[]): Promise<SubmitResult> {
  await Promise.all([
    setCaseCreated(cse.caseId, user.tgId, answers),
    recordCaseEvent(cse.caseId, user.tgId, 'create', answers, user.partnerId),
  ]);
  return deliverCollabPoints(user, false, 3, 'collab-create', 'recognition');
}

// ---- Collab: edit ----
async function submitCollabEdit(user: BotUser, cse: BotCase, answers: string[]): Promise<SubmitResult> {
  await Promise.all([
    setCaseEdited(cse.caseId, user.tgId, answers),
    recordCaseEvent(cse.caseId, user.tgId, 'edit', answers, user.partnerId),
  ]);
  return deliverCollabPoints(user, false, 1, 'collab-edit', 'verification');
}

// ---- Collab: confirm ----
async function submitCollabConfirm(user: BotUser, cse: BotCase): Promise<SubmitResult> {
  const min = await getMinConfirmations();
  await recordCaseEvent(cse.caseId, user.tgId, 'confirm', cse.currentAnswers || [], user.partnerId);
  const { closed } = await confirmCase(cse.caseId, min);
  // Описовий пазл: підтвердження (можливо, web-користувачем) зараховує слова,
  // що їх зібрав TG-розпізнавач. Режим (перше підтвердження / повне закриття) —
  // у config.puzzle.confirmMode.
  {
    const { onCollabCaseConfirmed } = await import('../_telegram/puzzle.js');
    await onCollabCaseConfirmed(cse.caseId, closed);
  }
  if (closed) {
    try {
      const { maybeAnnounceDescriptionDone } = await import('../_telegram/groupAnnounce.js');
      await maybeAnnounceDescriptionDone(cse.archive, cse.fund, cse.opys);
    } catch (e) {
      console.error('maybeAnnounceDescriptionDone (collab) failed', e);
    }
  }
  return deliverCollabPoints(user, closed, 1, 'collab-confirm', 'verification');
}

async function deliverCollabPoints(
  user: BotUser,
  closed: boolean,
  actionBase: number,
  actionTaken: SubmitResult['actionTaken'],
  action: MarathonAction
): Promise<SubmitResult> {
  const today = kyivDateString();
  const todayCount = await incDailyCount(user.tgId, today);
  const pts = computePointsForToday(todayCount, actionBase);
  const bonus = applyMarathonBonus(pts.pointsEarned, action);
  const newTotal = await applyUserPoints(user, bonus.points);
  return {
    pointsEarned: bonus.points,
    multiplier: pts.multiplier,
    todayCount,
    total: newTotal,
    closed,
    actionTaken,
    marathon: bonus.marathon ? { name: bonus.marathon.name, coefficient: bonus.marathon.coefficient } : null,
  };
}

async function applyUserPoints(user: BotUser, delta: number): Promise<number> {
  const newTotal = Math.round((user.totalPoints + delta) * 100) / 100;
  await Promise.all([
    upsertUser({ ...user, totalPoints: newTotal, consecutiveMisses: 0 }),
    // Місячний рейтинг: ті самі бали — у поточний київський місяць.
    incMonthlyPoints(kyivMonthString(), user.tgId, delta, user.displayName),
  ]);
  return newTotal;
}
