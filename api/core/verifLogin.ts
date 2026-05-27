// «Вхід через бота» для сайту перевірки. Надійніша альтернатива Login Widget:
// сайт створює одноразовий код → юзер тисне /start login_<code> у боті →
// бот фіксує свій tg_id у коді → сайт опитує статус і отримує сесію.
import { randomBytes } from 'node:crypto';
import { db } from '../telegram/storage.js';

const PREFIX = process.env.TABLE_PREFIX ?? 'bot_';
const T_CODES = `${PREFIX}verif_login_codes`;
const CODE_TTL_MS = 10 * 60 * 1000; // 10 хвилин

function genCode(): string {
  return randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 10).toUpperCase();
}

export async function createLoginCode(): Promise<{ code: string; expiresAt: string }> {
  const code = genCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { error } = await db().from(T_CODES).insert({ code, expires_at: expiresAt });
  if (error) throw error;
  return { code, expiresAt };
}

// Викликає бот на /start login_<code>. Повертає true, якщо код валідний і щойно зайнятий.
export async function consumeLoginCode(code: string, tgId: string): Promise<boolean> {
  const { data, error } = await db().from(T_CODES).select('used_at, expires_at').eq('code', code).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  if (data.used_at) return false;
  if (new Date(data.expires_at).getTime() < Date.now()) return false;
  const { data: updated, error: uerr } = await db()
    .from(T_CODES)
    .update({ tg_id: tgId, used_at: new Date().toISOString() })
    .eq('code', code)
    .is('used_at', null)
    .select('code');
  if (uerr) throw uerr;
  return !!(updated && updated.length > 0);
}

export async function getLoginCode(
  code: string
): Promise<{ tgId: string; usedAt: string | null; expiresAt: string } | null> {
  const { data, error } = await db()
    .from(T_CODES)
    .select('tg_id, used_at, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { tgId: data.tg_id || '', usedAt: data.used_at || null, expiresAt: data.expires_at };
}
