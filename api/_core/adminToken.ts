// Підписані токени сесії адмінки (HMAC-SHA256, без зовнішніх залежностей).
// Формат той самий, що й у sessionToken.ts (токени web-юзерів): base64url(payload).base64url(sig).
// Секрет ОКРЕМИЙ (ADMIN_SESSION_SECRET) — щоб компрометація одного контуру не
// давала токенів іншого, і щоб токен адмінки більше не був рівний CRON_SECRET.
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET_ENV = 'ADMIN_SESSION_SECRET';
export const ADMIN_TTL_SECONDS = 60 * 60 * 12;              // 12 год — звичайний вхід
export const ADMIN_TTL_REMEMBER_SECONDS = 60 * 60 * 24 * 30; // 30 днів — «запам'ятати»

export interface AdminTokenPayload {
  aid: string;   // uuid рядка bot_admins, або 'env' для аварійного суперадміна з env
  login: string;
  ep: number;    // token_epoch на момент видачі; розбіжність із БД = токен відкликано
  iat: number;
  exp: number;
}

function getSecret(): Buffer {
  const s = process.env[SECRET_ENV];
  if (!s) throw new Error(`Missing env ${SECRET_ENV} (need 32+ random bytes hex/base64)`);
  return Buffer.from(s, 'utf8');
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payloadB64: string): string {
  return b64urlEncode(createHmac('sha256', getSecret()).update(payloadB64).digest());
}

export function issueAdminToken(
  aid: string,
  login: string,
  epoch: number,
  ttlSeconds = ADMIN_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminTokenPayload = { aid, login, ep: epoch, iat: now, exp: now + ttlSeconds };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifyAdminToken(token: string): AdminTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payloadB64));
  // Захист від timing-атак.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as AdminTokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.aid !== 'string' || typeof payload.login !== 'string') return null;
    if (typeof payload.ep !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}
