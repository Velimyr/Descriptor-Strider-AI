import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  BotCase,
  BotUser,
  countSubmissionsByCase,
  getAllCases,
  getCandidateCasesForUser,
  getLastUserCaseKind,
  getMeta,
  getPuzzle,
  patchCase,
} from './storage.js';
import { collectibleWords, titleFieldIndex, wordsInText } from './puzzleWords.js';

const cfg = telegramBotConfig;

// Кеш контексту пазла на сьогодні (≤60с): слова фрази + індекс поля title.
// Потрібен, щоб масова розсилка (cron по всіх юзерах) не смикала БД для кожного.
let puzzleCtxCache: { date: string; words: Set<string>; titleIdx: number; expires: number } | null = null;

async function getTodayPuzzleContext(): Promise<{ words: Set<string>; titleIdx: number }> {
  const today = kyivDateString();
  if (puzzleCtxCache && puzzleCtxCache.date === today && puzzleCtxCache.expires > Date.now()) {
    return { words: puzzleCtxCache.words, titleIdx: puzzleCtxCache.titleIdx };
  }
  let words = new Set<string>();
  let titleIdx = -1;
  try {
    const puzzle = await getPuzzle(today);
    if (puzzle && puzzle.sentence.trim()) {
      words = new Set(collectibleWords(puzzle.sentence, cfg.puzzle.stopwords));
      const raw = await getMeta('questions');
      let questions: any[] = [];
      try {
        questions = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(questions)) questions = [];
      } catch {
        questions = [];
      }
      titleIdx = titleFieldIndex(questions);
    }
  } catch (e) {
    console.error('getTodayPuzzleContext failed', e);
  }
  puzzleCtxCache = { date: today, words, titleIdx, expires: Date.now() + 60_000 };
  return { words, titleIdx };
}

function titleHasAnyWord(title: string, words: Set<string>): boolean {
  for (const w of wordsInText(title)) if (words.has(w)) return true;
  return false;
}

export function nowIsoUtc(): string {
  return new Date().toISOString();
}

export function kyivDateString(date: Date = new Date()): string {
  // YYYY-MM-DD у Europe/Kyiv
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.dispatch.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

// 'YYYY-MM' у Europe/Kyiv (ключ місяця для рейтингу).
export function kyivMonthString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.dispatch.timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year')?.value ?? '';
  const m = parts.find(p => p.type === 'month')?.value ?? '';
  return `${y}-${m}`;
}

// Ключ опису = archive|fund|opys. Одна "опис" = всі справи з одного завантаженого PDF.
export function descriptionKey(c: { archive: string; fund: string; opys: string }): string {
  return `${c.archive}|${c.fund}|${c.opys}`;
}

export function descriptionName(c: { archive: string; fund: string; opys: string }): string {
  return `${c.archive} ${c.fund}-${c.opys}`;
}

// Найраніша createdAt серед справ опису — використовуємо як "вік опису" для черговості.
function buildDescriptionOrder(cases: BotCase[]): Map<string, string> {
  const order = new Map<string, string>();
  for (const c of cases) {
    const k = descriptionKey(c);
    const cur = order.get(k);
    if (!cur || c.createdAt.localeCompare(cur) < 0) order.set(k, c.createdAt);
  }
  return order;
}

export async function selectNextCaseForUser(
  tgId: string,
  _preloadedCases?: BotCase[] // legacy, ігнорується — фільтр перенесли в SQL
): Promise<BotCase | null> {
  // Один SQL: тільки кандидати, які цьому юзеру можна показати.
  // Фільтри: status='open', не сабмітив/пропустив/торкався, не лочена іншим.
  const [candidates, lastKind] = await Promise.all([
    getCandidateCasesForUser(tgId),
    getLastUserCaseKind(tgId),
  ]);
  if (candidates.length === 0) return null;

  // Пріоритет «Описового пазла»: спершу віддаємо collab-справи НА ПІДТВЕРДЖЕННЯ
  // (вже є розпізнана версія), чий поточний заголовок містить слово фрази дня —
  // щоб такі справи закрились швидше й слова підтвердились того ж дня.
  const { words: puzzleWords, titleIdx } = await getTodayPuzzleContext();
  if (puzzleWords.size > 0 && titleIdx >= 0) {
    const matching = candidates.filter(
      c =>
        c.mode === 'collaborative' &&
        c.confirmationsCount > 0 &&
        titleHasAnyWord(c.currentAnswers[titleIdx] || '', puzzleWords)
    );
    if (matching.length > 0) {
      // Найближчі до закриття — першими (більший confirmationsCount), далі найстаріша.
      matching.sort(
        (a, b) =>
          b.confirmationsCount - a.confirmationsCount || a.createdAt.localeCompare(b.createdAt)
      );
      return matching[0];
    }
  }

  const targetParallel = cfg.cases.targetSubmissions;
  const descOrder = buildDescriptionOrder(candidates);
  const progressOf = (c: BotCase): number =>
    c.mode === 'collaborative' ? c.confirmationsCount : c.submissionsCount;
  const compare = (a: BotCase, b: BotCase) => {
    const ageA = descOrder.get(descriptionKey(a)) || a.createdAt;
    const ageB = descOrder.get(descriptionKey(b)) || b.createdAt;
    if (ageA !== ageB) return ageA.localeCompare(ageB);
    const pa = progressOf(a);
    const pb = progressOf(b);
    if (pb !== pa) return pb - pa;
    return a.createdAt.localeCompare(b.createdAt);
  };

  // Пріоритет 1: ще не досягли цілі.
  const primary = candidates.filter(c => progressOf(c) < targetParallel).sort(compare);
  if (primary.length > 0) {
    // Чергування create/review застосовуємо ЛИШЕ в межах найстарішого доступного опису —
    // інакше юзера тягне в свіжіший collab-опис, поки старіші parallel-описи не закриті.
    const firstDescKey = descriptionKey(primary[0]);
    const sameDesc = primary.filter(c => descriptionKey(c) === firstDescKey);
    const collabCreate = sameDesc.find(c => c.mode === 'collaborative' && c.confirmationsCount === 0);
    const collabReview = sameDesc.find(c => c.mode === 'collaborative' && c.confirmationsCount > 0);
    if (collabCreate && collabReview) {
      return lastKind === 'create' ? collabReview : collabCreate;
    }
    return primary[0];
  }
  if (cfg.cases.allowExtraAfterTarget) {
    const extra = [...candidates].sort(compare);
    if (extra.length > 0) return extra[0];
  }
  return null;
}

export interface PointsResult {
  pointsEarned: number;
  todayCount: number;
  multiplier: number;
}

/**
 * Бал = base × multiplier(todayCount після інкременту).
 * Множник: < tier1 → 1, < tier2 → tier1.multiplier, інакше tier2.multiplier.
 * baseOverride — для collab-режиму (3 за розпізнавання, 1 за перевірку).
 */
export function computePointsForToday(
  todayCountAfterInc: number,
  baseOverride?: number
): PointsResult {
  const { base, tier1, tier2 } = cfg.points;
  const b = typeof baseOverride === 'number' ? baseOverride : base;
  let multiplier = 1;
  if (todayCountAfterInc >= tier2.thresholdInclusive) multiplier = tier2.multiplier;
  else if (todayCountAfterInc >= tier1.thresholdInclusive) multiplier = tier1.multiplier;
  return {
    pointsEarned: Math.round(b * multiplier * 100) / 100,
    todayCount: todayCountAfterInc,
    multiplier,
  };
}

export async function recomputeCaseSubmissionCount(caseId: string): Promise<number> {
  const count = await countSubmissionsByCase(caseId);
  const target = cfg.cases.targetSubmissions;
  await patchCase(caseId, {
    submissionsCount: count,
    status: count >= target ? 'done' : 'open',
  });
  return count;
}

export function leaderboardSorted(users: BotUser[]) {
  return [...users].sort((a, b) => b.totalPoints - a.totalPoints);
}

// "Прогрес" справи — для parallel це submissionsCount, для collab — confirmationsCount.
function caseProgress(c: BotCase): number {
  return c.mode === 'collaborative' ? c.confirmationsCount : c.submissionsCount;
}
function caseDone(c: BotCase, target: number): boolean {
  return c.status === 'done' || caseProgress(c) >= target;
}

export function progressOfAllCases(cases: BotCase[]): {
  totalCases: number;
  doneCases: number;
  donePct: number;
} {
  const total = cases.length;
  const target = cfg.cases.targetSubmissions;
  if (total === 0) return { totalCases: 0, doneCases: 0, donePct: 0 };
  const doneCases = cases.filter(c => caseDone(c, target)).length;
  return {
    totalCases: total,
    doneCases,
    donePct: Math.round((doneCases / total) * 1000) / 10,
  };
}

export interface DescriptionProgress {
  key: string;
  name: string;
  earliestCreatedAt: string;
  totalCases: number;
  doneCases: number;
  donePct: number;
}

// Групуємо справи по описах і рахуємо прогрес для кожного.
// Сортуємо за датою створення (найстаріший — першим).
export function progressByDescription(cases: BotCase[]): DescriptionProgress[] {
  const groups = new Map<string, BotCase[]>();
  for (const c of cases) {
    const k = descriptionKey(c);
    const arr = groups.get(k);
    if (arr) arr.push(c);
    else groups.set(k, [c]);
  }
  const target = cfg.cases.targetSubmissions;
  const result: DescriptionProgress[] = [];
  for (const [key, arr] of groups) {
    const earliest = arr.reduce(
      (acc, c) => (c.createdAt.localeCompare(acc) < 0 ? c.createdAt : acc),
      arr[0].createdAt
    );
    const doneCases = arr.filter(c => caseDone(c, target)).length;
    result.push({
      key,
      name: descriptionName(arr[0]),
      earliestCreatedAt: earliest,
      totalCases: arr.length,
      doneCases,
      donePct: Math.round((doneCases / arr.length) * 1000) / 10,
    });
  }
  result.sort((a, b) => a.earliestCreatedAt.localeCompare(b.earliestCreatedAt));
  return result;
}
