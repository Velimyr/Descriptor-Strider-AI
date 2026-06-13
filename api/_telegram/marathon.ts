// Логіка марафонів: у заданий у конфізі проміжок часу бали за вказані дії
// множаться на coefficient. Проміжок задається САМЕ в конфізі
// (src/telegram-bot/config.ts → marathons) як start/end за київським часом, не в БД.
//
// DST не рахуємо: порівнюємо РЯДКИ київського настінного часу ('YYYY-MM-DD HH:mm').
// Поточний київський час беремо тим самим патерном, що й розсилки (форматуємо now
// у київський пояс), тож жодних офсет-обчислень.
import { telegramBotConfig as cfg } from '../../src/telegram-bot/config.js';
import type { MarathonAction } from '../../src/telegram-bot/config.js';

export type { MarathonAction };

export interface ActiveMarathon {
  name: string;
  coefficient: number;
  actions: MarathonAction[];
  endDate: string;       // кінець марафону, 'YYYY-MM-DD HH:mm' (київський час)
  endDateLocal: string;  // той самий момент для показу, 'ДД.ММ.РРРР ГГ:ХХ'
}

// Форматер поточного київського часу у 'YYYY-MM-DD HH:mm'. Intl дорого створювати —
// тримаємо інстанс на module-level.
const KYIV_WALL_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: cfg.dispatch.timezone || 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// 'now' у київському настінному часі як 'YYYY-MM-DD HH:mm'.
function kyivWallString(d: Date): string {
  const p: Record<string, string> = {};
  for (const part of KYIV_WALL_FMT.formatToParts(d)) p[part.type] = part.value;
  // Node інколи віддає '24' для опівночі — нормалізуємо до '00'.
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}`;
}

// Нормалізуємо рядок із конфігу до канонічного 'YYYY-MM-DD HH:mm'.
// Приймаємо 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm' і 'YYYY-MM-DDTHH:mm'. Без часу → 00:00.
// Повертає '' для непридатного рядка (такий марафон ігнорується).
function normalizeWall(raw: string | undefined): string {
  if (!raw) return '';
  const m = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return '';
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo}-${d} ${h ?? '00'}:${mi ?? '00'}`;
}

// 'YYYY-MM-DD HH:mm' → 'ДД.ММ.РРРР ГГ:ХХ' (просто перестановка, без часових поясів).
function formatWallLocal(wall: string): string {
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return wall;
  const [, y, mo, d, h, mi] = m;
  return `${d}.${mo}.${y} ${h}:${mi}`;
}

// Поточний контур: dev/staging має TABLE_PREFIX=botdev_, прод — без нього (bot_).
function currentBotEnv(): 'dev' | 'prod' {
  return process.env.TABLE_PREFIX === 'botdev_' ? 'dev' : 'prod';
}

// Марафон, активний у вказаний момент (за замовч. — зараз) і на поточному контурі.
// Активність: start <= зараз < end (кінець не включно).
export function getActiveMarathon(now: Date = new Date()): ActiveMarathon | null {
  const env = currentBotEnv();
  const nowWall = kyivWallString(now);
  for (const m of cfg.marathons || []) {
    if (!m || !(m.coefficient > 0) || !Array.isArray(m.actions) || m.actions.length === 0) continue;
    if (m.env && m.env !== 'all' && m.env !== env) continue;
    const start = normalizeWall(m.start);
    const end = normalizeWall(m.end);
    if (!start || !end) continue;
    if (start <= nowWall && nowWall < end) {
      return {
        name: m.name,
        coefficient: m.coefficient,
        actions: m.actions,
        endDate: end,
        endDateLocal: formatWallLocal(end),
      };
    }
  }
  return null;
}

// Активний марафон, що включає конкретну дію (інакше null — коефіцієнт не застосовуємо).
export function marathonForAction(
  action: MarathonAction,
  now: Date = new Date()
): ActiveMarathon | null {
  const m = getActiveMarathon(now);
  return m && m.actions.includes(action) ? m : null;
}

// Застосувати коефіцієнт марафону до балів за дію. Якщо марафону немає або дія
// в ньому не бере участі — повертає бали без змін і marathon: null.
export function applyMarathonBonus(
  points: number,
  action: MarathonAction,
  now: Date = new Date()
): { points: number; marathon: ActiveMarathon | null } {
  const m = marathonForAction(action, now);
  if (!m) return { points, marathon: null };
  return { points: Math.round(points * m.coefficient * 100) / 100, marathon: m };
}

// Слово дії для тексту марафону залежно від набору actions.
export function marathonActionWord(m: ActiveMarathon): string {
  const hasRecognition = m.actions.includes('recognition');
  const hasVerification = m.actions.includes('verification');
  if (hasRecognition && hasVerification) return 'розпізнану чи перевірену';
  if (hasVerification) return 'перевірену';
  return 'розпізнану';
}
