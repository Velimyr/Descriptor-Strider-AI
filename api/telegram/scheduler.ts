import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  BotCase,
  BotUser,
  countSubmissionsByCase,
  getAllCases,
  getSubmissionsForUser,
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

export function kyivHour(date: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.dispatch.timezone,
    hour: '2-digit',
    hour12: false,
  });
  return parseInt(fmt.format(date), 10);
}

export function isWithinDispatchWindow(date: Date = new Date()): boolean {
  const h = kyivHour(date);
  const { startHourKyiv, endHourKyiv, intervalHours } = cfg.dispatch;
  if (h < startHourKyiv || h > endHourKyiv) return false;
  return (h - startHourKyiv) % intervalHours === 0;
}

export async function selectNextCaseForUser(tgId: string): Promise<BotCase | null> {
  const [allCases, seenIds] = await Promise.all([getAllCases(), getSubmissionsForUser(tgId)]);
  const seen = new Set(seenIds);
  const target = cfg.cases.targetSubmissions;

  // Пріоритет 1: відкриті справи, не бачені, count < target — спершу майже-готові.
  const primary = allCases
    .filter(c => c.status === 'open' && !seen.has(c.caseId) && c.submissionsCount < target)
    .sort((a, b) => {
      if (b.submissionsCount !== a.submissionsCount) return b.submissionsCount - a.submissionsCount;
      return a.createdAt.localeCompare(b.createdAt);
    });
  if (primary.length > 0) return primary[0];

  // Пріоритет 2 (опційно): уже досягли target, але добираємо для надійності.
  if (cfg.cases.allowExtraAfterTarget) {
    const extra = allCases
      .filter(c => !seen.has(c.caseId))
      .sort((a, b) => a.submissionsCount - b.submissionsCount);
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
