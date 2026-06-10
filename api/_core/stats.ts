// Статистика і лідерборд для віджета. Один пул юзерів (TG + web разом).
//
// EGRESS-замітка: раніше і `getStatsForUser`, і `getLeaderboard` тягнули
// `getAllUsers()` (повний скан bot_users), що було головним джерелом egress
// у Supabase. Тепер обидві функції користуються RPC `bot_user_rank` і
// `bot_leaderboard_top` — повертають O(1) або O(limit) рядків.
import {
  BotUser,
  getDailyCount,
  getLeaderboardTop,
  getUserRank,
} from '../telegram/storage.js';
import {
  computePointsForToday,
  kyivDateString,
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
  const [todayCount, rankInfo] = await Promise.all([
    getDailyCount(user.tgId, today),
    getUserRank(user.tgId),
  ]);
  // Множник рахуємо так, ніби юзер щойно зробив ще одну справу (для UX-перегляду
  // "що отримаю за наступну").
  const pts = computePointsForToday(Math.max(todayCount, 1));
  return {
    nickname: user.displayName || 'Anon',
    // user.totalPoints може бути «застарілим» (передано з cookie/сесії);
    // rankInfo.totalPoints — свіже значення з БД.
    total: rankInfo.totalPoints || user.totalPoints,
    todayCount,
    todayPoints: Math.round(todayCount * pts.multiplier * 100) / 100,
    multiplier: pts.multiplier,
    rank: rankInfo.rank || rankInfo.totalUsers,
    totalUsers: rankInfo.totalUsers,
  };
}

export async function getLeaderboard(
  forUser: BotUser | null,
  limit = 10
): Promise<{ top: LeaderboardEntry[]; you: LeaderboardEntry | null }> {
  // Якщо є forUser — паралельно тягнемо його ранг (один рядок, дешево).
  const [topRows, rankInfo] = await Promise.all([
    getLeaderboardTop(limit),
    forUser ? getUserRank(forUser.tgId) : Promise.resolve(null),
  ]);
  const top: LeaderboardEntry[] = topRows.map(u => ({
    nickname: u.displayName || 'Anon',
    points: u.totalPoints,
    isYou: forUser ? u.tgId === forUser.tgId : false,
  }));
  let you: LeaderboardEntry | null = null;
  if (forUser && rankInfo) {
    // Показуємо "you" завжди, коли юзер існує — віджет вирішує, чи дублювати
    // його з top (якщо він уже в топі), чи показувати окремим рядком нижче.
    you = {
      nickname: forUser.displayName || 'Anon',
      points: rankInfo.totalPoints,
      isYou: true,
    };
  }
  return { top, you };
}
