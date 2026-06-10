// Middleware для публічного API віджета.
// Дві перевірки:
//   1. X-Partner-Key (обовʼязково на всіх запитах окрім OPTIONS) → знаходимо партнера.
//   2. Origin порівнюємо з allowedOrigins партнера.
// Сесія юзера — окремий Authorization: Bearer <token>.
import type { Request, Response, NextFunction } from 'express';
import { Partner, getPartnerByApiKey, isOriginAllowed } from '../_core/partners.js';
import { BotUser, getUser } from '../_telegram/storage.js';
import { SessionPayload, verifySessionToken } from '../_core/sessionToken.js';

declare global {
  namespace Express {
    interface Request {
      partner?: Partner;
      sessionPayload?: SessionPayload;
      sessionUser?: BotUser;
    }
  }
}

// CORS обробка: для OPTIONS-preflight echo-имо Origin без валідації (реальна
// перевірка йде на наступному реальному запиті). Для решти — лише після
// успішної валідації partner/origin виставляємо Access-Control-Allow-Origin.
export function widgetCors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin as string | undefined;
  // На preflight браузер ще не шле X-Partner-Key у тілі, тому валідацію не робимо.
  if (req.method === 'OPTIONS') {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Partner-Key, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  }
  next();
}

export async function requirePartner(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header('X-Partner-Key');
  if (!apiKey) return res.status(401).json({ error: 'missing X-Partner-Key' });
  let partner: Partner | null;
  try {
    partner = await getPartnerByApiKey(apiKey);
  } catch (e: any) {
    console.error('partner lookup failed', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
  if (!partner) return res.status(401).json({ error: 'invalid partner key' });

  const origin = req.headers.origin as string | undefined;
  if (!isOriginAllowed(partner, origin)) {
    // Повертаємо тільки incoming_origin — щоб партнер міг порівняти зі своїм списком
    // в адмінці. Сам список не розкриваємо.
    return res.status(403).json({
      error: 'origin not allowed for this partner',
      incoming_origin: origin || '(missing Origin header)',
    });
  }
  // Тепер можемо вставити CORS-заголовок з конкретним allowed origin.
  res.setHeader('Access-Control-Allow-Origin', origin!);
  res.setHeader('Vary', 'Origin');

  req.partner = partner;
  next();
}

export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const auth = req.header('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) return res.status(401).json({ error: 'missing session token' });
  const payload = verifySessionToken(m[1]);
  if (!payload) return res.status(401).json({ error: 'invalid or expired session' });
  // Перевірка що сесія належить тому ж партнеру що й ключ.
  if (req.partner && payload.partnerId !== req.partner.partnerId) {
    return res.status(403).json({ error: 'session/partner mismatch' });
  }
  const user = await getUser(payload.tgId);
  if (!user) return res.status(401).json({ error: 'user no longer exists' });
  req.sessionPayload = payload;
  req.sessionUser = user;
  next();
}
