import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  BotCase,
  BotUser,
  countSubmissionsByCase,
  getAllCases,
  getSkippedForUser,
  getSubmissionsForUser,
  getTouchedCaseIds,
  patchCase,
} from './storage.js';

const cfg = telegramBotConfig;

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

export async function selectNextCaseForUser(tgId: string): Promise<BotCase | null> {
  const [allCases, seenIds, skippedIds, touchedIds] = await Promise.all([
    getAllCases(),
    getSubmissionsForUser(tgId),
    getSkippedForUser(tgId),
    getTouchedCaseIds(tgId), // collab: справи, де юзер уже брав участь
  ]);
  // "Бачені" = підтверджені АБО відмовлені АБО участь у collab — повторно не показуємо.
  const seen = new Set([...seenIds, ...skippedIds, ...touchedIds]);
  const targetParallel = cfg.cases.targetSubmissions;
  const descOrder = buildDescriptionOrder(allCases);
  const nowMs = Date.now();

  const isAvailable = (c: BotCase): boolean => {
    if (c.status !== 'open') return false;
    if (seen.has(c.caseId)) return false;
    // Collab-режим: пропускаємо заблоковані іншим юзером (поки лок не сплив).
    if (c.mode === 'collaborative' && c.lockedUntil && c.lockedByTgId && c.lockedByTgId !== tgId) {
      const exp = Date.parse(c.lockedUntil);
      if (Number.isFinite(exp) && exp > nowMs) return false;
    }
    return true;
  };

  // "Майже-готові" — сортування: для parallel за submissionsCount, для collab за confirmationsCount.
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

  // Пріоритет 1: відкриті, доступні, не досягли цілі.
  const primary = allCases
    .filter(c => isAvailable(c) && progressOf(c) < targetParallel)
    .sort(compare);
  if (primary.length > 0) return primary[0];

  if (cfg.cases.allowExtraAfterTarget) {
    const extra = allCases.filter(isAvailable).sort(compare);
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
 */
export function computePointsForToday(todayCountAfterInc: number): PointsResult {
  const { base, tier1, tier2 } = cfg.points;
  let multiplier = 1;
  if (todayCountAfterInc >= tier2.thresholdInclusive) multiplier = tier2.multiplier;
  else if (todayCountAfterInc >= tier1.thresholdInclusive) multiplier = tier1.multiplier;
  return {
    pointsEarned: Math.round(base * multiplier * 100) / 100,
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

export function progressOfAllCases(cases: BotCase[]): {
  totalCases: number;
  doneCases: number;
  donePct: number;
} {
  const total = cases.length;
  const target = cfg.cases.targetSubmissions;
  if (total === 0) return { totalCases: 0, doneCases: 0, donePct: 0 };
  const cappedSum = cases.reduce((s, c) => s + Math.min(c.submissionsCount, target), 0);
  const doneCases = cases.filter(c => c.submissionsCount >= target).length;
  return {
    totalCases: total,
    doneCases,
    donePct: Math.round((cappedSum / (total * target)) * 1000) / 10,
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
    const cappedSum = arr.reduce((s, c) => s + Math.min(c.submissionsCount, target), 0);
    const doneCases = arr.filter(c => c.submissionsCount >= target).length;
    result.push({
      key,
      name: descriptionName(arr[0]),
      earliestCreatedAt: earliest,
      totalCases: arr.length,
      doneCases,
      donePct: Math.round((cappedSum / (arr.length * target)) * 1000) / 10,
    });
  }
  result.sort((a, b) => a.earliestCreatedAt.localeCompare(b.earliestCreatedAt));
  return result;
}
