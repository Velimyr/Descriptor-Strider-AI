// Статистика і лідерборд для віджета. Один пул юзерів (TG + web разом).
import {
  BotUser,
  getAllUsers,
  getDailyCount,
} from '../telegram/storage.js';
import {
  computePointsForToday,
  kyivDateString,
  leaderboardSorted,
} from '../telegram/scheduler.js';

export interface UserStats {
  nickname: string;
  total: number;
  todayCount: number;
  todayPoints: number;
  multiplier: number;
  rank: number;
  totalUsers: number;
}

export interface LeaderboardEntry {
  nickname: string;
  points: number;
  isYou: boolean;
}

export async function getStatsForUser(user: BotUser): Promise<UserStats> {
  const today = kyivDateString();
  const [todayCount, all] = await Promise.all([
    getDailyCount(user.tgId, today),
    getAllUsers(),
  ]);
  const sorted = leaderboardSorted(all);
  const rank = sorted.findIndex(u => u.tgId === user.tgId) + 1;
  // Множник рахуємо так, ніби юзер щойно зробив ще одну справу (для UX-перегляду
  // "що отримаю за наступну").
  const pts = computePointsForToday(Math.max(todayCount, 1));
  return {
    nickname: user.displayName || 'Anon',
    total: user.totalPoints,
    todayCount,
    todayPoints: Math.round(todayCount * pts.multiplier * 100) / 100,
    multiplier: pts.multiplier,
    rank: rank || sorted.length,
    totalUsers: sorted.length,
  };
}

export async function getLeaderboard(
  forUser: BotUser | null,
  limit = 10
): Promise<{ top: LeaderboardEntry[]; you: LeaderboardEntry | null }> {
  const all = await getAllUsers();
  const sorted = leaderboardSorted(all);
  const top = sorted.slice(0, limit).map(u => ({
    nickname: u.displayName || 'Anon',
    points: u.totalPoints,
    isYou: forUser ? u.tgId === forUser.tgId : false,
  }));
  let you: LeaderboardEntry | null = null;
  if (forUser) {
    const yourIdx = sorted.findIndex(u => u.tgId === forUser.tgId);
    if (yourIdx >= 0) {
      you = {
        nickname: forUser.displayName || 'Anon',
        points: sorted[yourIdx].totalPoints,
        isYou: true,
      };
    }
  }
  return { top, you };
}
