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
  recordCaseEvent,
  setCaseCreated,
  setCaseEdited,
  upsertUser,
} from '../telegram/storage.js';
import {
  computePointsForToday,
  kyivDateString,
  recomputeCaseSubmissionCount,
} from '../telegram/scheduler.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import { getMeta } from '../telegram/storage.js';

export type SubmitAction = 'submit' | 'confirm';

export interface SubmitResult {
  pointsEarned: number;
  multiplier: number;
  todayCount: number;
  total: number;
  closed: boolean;            // тільки collab: справу зведено цим підтвердженням
  actionTaken: 'parallel-create' | 'collab-create' | 'collab-edit' | 'collab-confirm';
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
  });
  const [, todayCount] = await Promise.all([
    recomputeCaseSubmissionCount(cse.caseId),
    incDailyCount(user.tgId, today),
  ]);
  const pts = computePointsForToday(todayCount);
  const newTotal = await applyUserPoints(user, pts.pointsEarned);
  return {
    pointsEarned: pts.pointsEarned,
    multiplier: pts.multiplier,
    todayCount,
    total: newTotal,
    closed: false,
    actionTaken: 'parallel-create',
  };
}

// ---- Collab: create ----
async function submitCollabCreate(user: BotUser, cse: BotCase, answers: string[]): Promise<SubmitResult> {
  await Promise.all([
    setCaseCreated(cse.caseId, user.tgId, answers),
    recordCaseEvent(cse.caseId, user.tgId, 'create', answers),
  ]);
  return deliverCollabPoints(user, false, 3, 'collab-create');
}

// ---- Collab: edit ----
async function submitCollabEdit(user: BotUser, cse: BotCase, answers: string[]): Promise<SubmitResult> {
  await Promise.all([
    setCaseEdited(cse.caseId, user.tgId, answers),
    recordCaseEvent(cse.caseId, user.tgId, 'edit', answers),
  ]);
  return deliverCollabPoints(user, false, 1, 'collab-edit');
}

// ---- Collab: confirm ----
async function submitCollabConfirm(user: BotUser, cse: BotCase): Promise<SubmitResult> {
  const min = await getMinConfirmations();
  await recordCaseEvent(cse.caseId, user.tgId, 'confirm', cse.currentAnswers || []);
  const { closed } = await confirmCase(cse.caseId, min);
  return deliverCollabPoints(user, closed, 1, 'collab-confirm');
}

async function deliverCollabPoints(
  user: BotUser,
  closed: boolean,
  actionBase: number,
  actionTaken: SubmitResult['actionTaken']
): Promise<SubmitResult> {
  const today = kyivDateString();
  const todayCount = await incDailyCount(user.tgId, today);
  const pts = computePointsForToday(todayCount, actionBase);
  const newTotal = await applyUserPoints(user, pts.pointsEarned);
  return {
    pointsEarned: pts.pointsEarned,
    multiplier: pts.multiplier,
    todayCount,
    total: newTotal,
    closed,
    actionTaken,
  };
}

async function applyUserPoints(user: BotUser, delta: number): Promise<number> {
  const newTotal = Math.round((user.totalPoints + delta) * 100) / 100;
  await upsertUser({ ...user, totalPoints: newTotal, consecutiveMisses: 0 });
  return newTotal;
}
