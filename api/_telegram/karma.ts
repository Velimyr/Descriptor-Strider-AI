// Клієнт системи «Карма» Генеалогічного навігатора (uagenealogy.com).
// Дві операції:
//   1) link-redeem — привʼязка TG-акаунта за одноразовим кодом (команда /linknavigator);
//   2) ingest      — нічна синхронізація ПОТОЧНИХ сумарних балів усіх користувачів.
//
// Ідентифікатор користувача для API (поле "login") = ЧИСЛОВИЙ telegram_id рядком.
// Токен — лише з env (telegramBotConfig.karma.tokenEnv), у код не зашиваємо.
import axios from 'axios';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

function karmaToken(): string {
  const t = process.env[telegramBotConfig.karma.tokenEnv];
  if (!t) throw new Error(`Missing env ${telegramBotConfig.karma.tokenEnv}`);
  return t;
}

function baseUrl(): string {
  return telegramBotConfig.karma.baseUrl.replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${karmaToken()}`,
    'Content-Type': 'application/json',
  };
}

export interface KarmaLinkResult {
  // HTTP-статус (0 — мережева помилка/таймаут, до відповіді не дійшли).
  status: number;
  // true лише на 200 з {ok:true}.
  ok: boolean;
  // Скільки балів нараховано під час привʼязки (0 якщо total не передавали).
  awarded: number;
  // Код помилки з тіла відповіді ('invalid_or_expired' | 'already_linked' | ...).
  error: string | null;
}

// POST /api/karma/link-redeem
// total — поточний СУМАРНИЙ бал; передаємо лише якщо він є (>0). Якщо передано,
// бали нараховуються користувачу одразу під час привʼязки.
export async function linkRedeem(
  code: string,
  login: string,
  total?: number
): Promise<KarmaLinkResult> {
  const body: Record<string, unknown> = { code, login };
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    body.total = Math.round(total);
  }
  try {
    const res = await axios.post(`${baseUrl()}/api/karma/link-redeem`, body, {
      headers: authHeaders(),
      timeout: 10000,
      // Самі обробляємо 404/409/тощо — axios не має кидати на не-2xx.
      validateStatus: () => true,
    });
    const data = (res.data || {}) as any;
    return {
      status: res.status,
      ok: res.status === 200 && data.ok === true,
      awarded: Number(data.awarded || 0),
      error: typeof data.error === 'string' ? data.error : null,
    };
  } catch (e: any) {
    console.error('karma link-redeem failed', e?.message || e);
    return { status: 0, ok: false, awarded: 0, error: 'network' };
  }
}

export interface KarmaAccount {
  login: string; // числовий telegram_id рядком
  total: number; // ПОТОЧНИЙ накопичений бал (ціле), не приріст
}

export interface KarmaIngestResult {
  accounts: number; // скільки акаунтів відправлено
  batches: number;  // скільки пачок відправлено успішно
  synced: number;
  awarded: number;
  unknown: string[]; // ще не привʼязані login-и (це НЕ помилка)
  errors: number;    // скільки пачок впало (мережа/таймаут/не-2xx)
}

// POST /api/karma/ingest — пачками по ~500. Бали лише зростають: менший total
// нічого не змінює. Помилка окремої пачки не валить усю задачу — рахуємо її в errors.
export async function ingestAccounts(accounts: KarmaAccount[]): Promise<KarmaIngestResult> {
  const BATCH = 500;
  const agg: KarmaIngestResult = {
    accounts: accounts.length,
    batches: 0,
    synced: 0,
    awarded: 0,
    unknown: [],
    errors: 0,
  };
  for (let i = 0; i < accounts.length; i += BATCH) {
    const batch = accounts.slice(i, i + BATCH);
    try {
      const res = await axios.post(
        `${baseUrl()}/api/karma/ingest`,
        { accounts: batch },
        { headers: authHeaders(), timeout: 30000 }
      );
      const data = (res.data || {}) as any;
      agg.batches++;
      agg.synced += Number(data.synced || 0);
      agg.awarded += Number(data.awarded || 0);
      if (Array.isArray(data.unknown)) agg.unknown.push(...data.unknown.map(String));
    } catch (e: any) {
      agg.errors++;
      console.error(
        `karma ingest batch failed (offset ${i}, size ${batch.length})`,
        e?.response?.data || e?.message || e
      );
    }
  }
  return agg;
}
