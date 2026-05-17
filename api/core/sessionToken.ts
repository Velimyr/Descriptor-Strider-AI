// Підписані токени сесії web-юзера (HMAC-SHA256 без зовнішніх залежностей).
// Формат: base64url(payload).base64url(sig). payload = JSON {tgId, partnerId, iat, exp}.
// Не використовуємо повноцінний JWT, бо нам не потрібні алгоритм-агностичні заголовки
// й сторонні бібліотеки в serverless. Один секрет, один алгоритм — HS256.
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET_ENV = 'WEB_SESSION_SECRET';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 днів

export interface SessionPayload {
  tgId: string;       // "web:<uuid>"
  partnerId: string;
  iat: number;        // issued at, unix sec
  exp: number;        // expires at, unix sec
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

export function issueSessionToken(
  tgId: string,
  partnerId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { tgId, partnerId, iat: now, exp: now + ttlSeconds };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = sign(payloadB64);
  // Захист від timing-атак.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.tgId !== 'string' || typeof payload.partnerId !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}
