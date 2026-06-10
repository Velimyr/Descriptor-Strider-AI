// Лінкінг web-юзера до Telegram-акаунту через одноразовий код.
//
// Flow:
//   1. Widget: POST /link/start → createLinkCode(webTgId) → {code, deep_link}
//   2. Юзер відкриває deep_link → t.me/<bot>?start=link_<code>
//   3. TG bot ловить /start link_<code> → consumeLinkCode(code, telegramTgId)
//      → mergeWebIntoTg(webTgId, telegramTgId)
//   4. Widget polls /link/status?code=... до 'completed'.
//
// Мерж зараз обмежений: тільки totalPoints + видалення web-юзера. Submissions,
// skipped, confirmations лишаються з оригінальним web-tg_id (історія).
// Edge-кейс: TG-юзер може отримати справу, яку web-юзер уже опрацьовував.
// Прийнятно на MVP.
import { randomBytes } from 'node:crypto';
import { BotUser, db, getUser, T } from '../_telegram/storage.js';

const PREFIX = process.env.TABLE_PREFIX ?? 'bot_';
const RPC_MERGE_USERS = `${PREFIX}merge_users`;

const CODE_TTL_MS = 10 * 60 * 1000; // 10 хвилин

export interface LinkCode {
  code: string;
  webTgId: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  telegramTgId: string | null;
}

function mapLinkCode(r: any): LinkCode {
  return {
    code: r.code,
    webTgId: r.web_tg_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    usedAt: r.used_at || null,
    telegramTgId: r.telegram_tg_id || null,
  };
}

// Генеруємо 10 символів base32-ish (без неоднозначних символів).
function generateCode(): string {
  const buf = randomBytes(8); // 64 біти ентропії
  return buf.toString('base64url').replace(/[-_]/g, '').slice(0, 10).toUpperCase();
}

export async function createLinkCode(webTgId: string): Promise<LinkCode> {
  if (!webTgId.startsWith('web:')) {
    throw new Error('createLinkCode: only web users can request linking');
  }
  // Чистимо старі коди цього юзера (щоб не накопичувались).
  await db().from(T.linkCodes).delete().eq('web_tg_id', webTgId).is('used_at', null);

  const code = generateCode();
  const now = new Date();
  const exp = new Date(now.getTime() + CODE_TTL_MS);
  const { data, error } = await db()
    .from(T.linkCodes)
    .insert({
      code,
      web_tg_id: webTgId,
      expires_at: exp.toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return mapLinkCode(data);
}

export async function getLinkCode(code: string): Promise<LinkCode | null> {
  const { data, error } = await db()
    .from(T.linkCodes)
    .select('*')
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  return data ? mapLinkCode(data) : null;
}

// Викликається TG-ботом коли юзер прислав /start link_<code>.
// Повертає об'єкт із результатом для рендерингу повідомлення у TG.
export interface ConsumeResult {
  ok: boolean;
  reason?: 'expired' | 'used' | 'unknown_code' | 'web_user_missing' | 'self_link';
  transferredPoints?: number;
  webNickname?: string;
}

export async function consumeLinkCode(code: string, telegramTgId: string): Promise<ConsumeResult> {
  if (telegramTgId.startsWith('web:')) {
    return { ok: false, reason: 'self_link' };
  }
  const lc = await getLinkCode(code);
  if (!lc) return { ok: false, reason: 'unknown_code' };
  if (lc.usedAt) return { ok: false, reason: 'used' };
  if (new Date(lc.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  const webUser = await getUser(lc.webTgId);
  if (!webUser) {
    // Юзер уже видалений — все одно позначаємо код як використаний.
    await db()
      .from(T.linkCodes)
      .update({ used_at: new Date().toISOString(), telegram_tg_id: telegramTgId })
      .eq('code', code);
    return { ok: false, reason: 'web_user_missing' };
  }

  // Мерж: переносимо бали в TG-юзера.
  const result = await mergeWebIntoTg(webUser, telegramTgId);

  await db()
    .from(T.linkCodes)
    .update({ used_at: new Date().toISOString(), telegram_tg_id: telegramTgId })
    .eq('code', code);

  return {
    ok: true,
    transferredPoints: result.transferredPoints,
    webNickname: webUser.displayName,
  };
}

// Публічний мерж для «Вхід через Telegram» на сайті перевірки: переносить бали й
// історію анонімного web-юзера в Telegram-акаунт. TG-юзер має вже існувати.
// Повертає к-сть перенесених балів (0 якщо web-юзера нема / не web).
export async function mergeWebUserIntoTelegram(
  webTgId: string,
  telegramTgId: string
): Promise<number> {
  if (!webTgId.startsWith('web:') || webTgId === telegramTgId) return 0;
  const webUser = await getUser(webTgId);
  if (!webUser) return 0;
  return (await mergeWebIntoTg(webUser, telegramTgId)).transferredPoints;
}

// Внутрішній мерж: атомарно через SQL-функцію bot_merge_users.
// Переносить ВСЕ: бали, submissions (з апдейтом display_name), skipped,
// case_confirmations, daily_scores, dispatch_log, locks/authors у cases,
// integrity_reviews. Розв'язує PK-конфлікти через ON CONFLICT.
// Після успішного виконання web-юзера більше не існує.
async function mergeWebIntoTg(
  webUser: BotUser,
  telegramTgId: string
): Promise<{ transferredPoints: number }> {
  const tgUser = await getUser(telegramTgId);
  if (!tgUser) {
    throw new Error('mergeWebIntoTg: TG user not found, ensure /start created it first');
  }
  const { error } = await db().rpc(RPC_MERGE_USERS, {
    p_old_tg_id: webUser.tgId,
    p_new_tg_id: telegramTgId,
  });
  if (error) throw error;
  return { transferredPoints: webUser.totalPoints };
}
