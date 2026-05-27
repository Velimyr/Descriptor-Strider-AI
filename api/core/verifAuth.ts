// Авторизація для сайту перевірки справ.
// Дві опції: реєстрація ніком (web-юзер) або «Вхід через Telegram» (Login Widget).
//
// Telegram Login Widget повертає підписані дані профілю. Перевірка підпису:
//   secret_key       = SHA256(bot_token)
//   data_check_string = відсортовані "key=value" (усі поля крім hash) через \n
//   очікуваний hash   = HMAC_SHA256(data_check_string, secret_key) у hex
// (Це САМЕ алгоритм Login Widget, не Web App — там ключ HMAC('WebAppData').)
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

// Псевдо-партнер для сесій сайту перевірки (поле partnerId у токені сесії).
export const VERIF_PARTNER_ID = 'web-verif';

// Скільки часу підпис логіну вважається свіжим (захист від replay).
const AUTH_TTL_SEC = 24 * 60 * 60;

export interface TelegramLoginData {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
  [k: string]: unknown;
}

export function telegramDisplayName(d: TelegramLoginData): string {
  const full = [d.first_name, d.last_name]
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .join(' ');
  if (full) return full;
  if (d.username) return String(d.username);
  return `Telegram ${d.id}`;
}

export function verifyTelegramLogin(data: TelegramLoginData): boolean {
  const token = process.env[telegramBotConfig.tg.botTokenEnv];
  if (!token) throw new Error('bot token missing');

  const hash = String(data.hash || '');
  if (!/^[0-9a-f]{64}$/i.test(hash)) return false;

  // Свіжість підпису.
  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate)) return false;
  if (Math.floor(Date.now() / 1000) - authDate > AUTH_TTL_SEC) return false;

  const dataCheckString = Object.keys(data)
    .filter(k => k !== 'hash' && data[k] !== undefined && data[k] !== null)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('\n');

  const secretKey = createHash('sha256').update(token).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
