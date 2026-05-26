// API сайту перевірки справ. Маунтиться у api/index.ts як /api/verif.
// Першосторонній (не партнерський) — без X-Partner-Key. Сесія через
// Authorization: Bearer <token> (ті самі підписані токени, partnerId='web-verif').
//
// Ендпоінти (Фаза 3 — авторизація + кабінет):
//   POST /register          — реєстрація ніком → web-юзер + токен
//   POST /auth/telegram      — вхід через Telegram Login Widget (+ мерж анон-балів)
//   POST /auth/dev           — DEV-обхід логіну (лише якщо VERIF_DEV_LOGIN=1)
//   GET  /me                 — профіль (бали, місце, бейджі, чи звʼязано з TG)
//   POST /me/rename          — змінити імʼя для рейтингу
import express from 'express';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../public/middleware.js';
import { issueSessionToken, verifySessionToken } from '../core/sessionToken.js';
import {
  createWebUser,
  getUser,
  upsertUser,
  patchUser,
  userExistsByDisplayName,
  getEarnedBadgeIds,
} from '../telegram/storage.js';
import { getStatsForUser } from '../core/stats.js';
import { mergeWebUserIntoTelegram } from '../core/linking.js';
import {
  getNextForVerifier,
  submitVerification,
  skipVerification,
  releaseVerification,
  getVerifStats,
  VerifError,
} from '../core/verifCases.js';
import { proxyVerifImage } from './image.js';
import {
  verifyTelegramLogin,
  telegramDisplayName,
  VERIF_PARTNER_ID,
  TelegramLoginData,
} from '../core/verifAuth.js';

const router = express.Router();

function sanitizeNick(s: unknown): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

async function ensureTelegramUser(tgId: string, name: string): Promise<void> {
  const existing = await getUser(tgId);
  if (existing) return; // не перезаписуємо вже обране користувачем імʼя
  await upsertUser({
    tgId,
    displayName: name,
    totalPoints: 0,
    lastDispatchedCaseId: '',
    lastDispatchedAt: '',
    consecutiveMisses: 0,
    status: 'active',
    pendingAction: '',
    createdAt: new Date().toISOString(),
    introShownAt: '',
    badgesSeededAt: new Date().toISOString(),
    source: 'tg',
    partnerId: null,
  });
}

// Якщо в заголовку є сесія анонімного web-юзера — переносимо його бали в TG-акаунт.
async function maybeMergeAnonSession(req: express.Request, telegramTgId: string): Promise<void> {
  const m = /^Bearer\s+(.+)$/.exec(req.header('Authorization') || '');
  if (!m) return;
  const payload = verifySessionToken(m[1]);
  if (!payload || !payload.tgId.startsWith('web:')) return;
  try {
    await mergeWebUserIntoTelegram(payload.tgId, telegramTgId);
  } catch (e: any) {
    console.error('verif merge anon→tg failed', e?.message || e);
  }
}

// Публічна конфігурація для фронту: username бота (для Login Widget) і чи увімкнено dev-вхід.
router.get('/config', (_req, res) => {
  res.json({
    tg_bot_username: process.env.TELEGRAM_BOT_USERNAME || 'descriptorstriderbot',
    dev_login: process.env.VERIF_DEV_LOGIN === '1',
  });
});

router.post('/register', async (req, res) => {
  const nick = sanitizeNick((req.body || {}).display_name);
  if (nick.length < 2) return res.status(400).json({ error: 'nickname_too_short' });
  try {
    if (await userExistsByDisplayName(nick)) return res.status(409).json({ error: 'nickname_taken' });
    const tgId = `web:${randomUUID()}`;
    const user = await createWebUser({ tgId, displayName: nick, partnerId: VERIF_PARTNER_ID });
    const token = issueSessionToken(user.tgId, VERIF_PARTNER_ID);
    res.json({
      session_token: token,
      user: { user_id: user.tgId, nickname: user.displayName, linked_telegram: false },
    });
  } catch (e: any) {
    console.error('verif/register failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/auth/telegram', async (req, res) => {
  const data = (req.body || {}) as TelegramLoginData;
  let ok = false;
  try {
    ok = verifyTelegramLogin(data);
  } catch {
    return res.status(500).json({ error: 'bot_token_missing' });
  }
  if (!ok) return res.status(401).json({ error: 'invalid_telegram_signature' });

  const tgId = String(data.id);
  try {
    await ensureTelegramUser(tgId, telegramDisplayName(data));
    await maybeMergeAnonSession(req, tgId);
    const user = await getUser(tgId);
    const token = issueSessionToken(tgId, VERIF_PARTNER_ID);
    res.json({
      session_token: token,
      user: {
        user_id: tgId,
        nickname: user?.displayName || telegramDisplayName(data),
        linked_telegram: true,
      },
    });
  } catch (e: any) {
    console.error('verif/auth/telegram failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// DEV-обхід (Login Widget не працює на localhost). Вмикається VERIF_DEV_LOGIN=1.
router.post('/auth/dev', async (req, res) => {
  if (process.env.VERIF_DEV_LOGIN !== '1') return res.status(404).json({ error: 'not_found' });
  const tgId = String((req.body || {}).tg_id || 'dev:tester');
  const nick = sanitizeNick((req.body || {}).display_name) || `Dev ${tgId}`;
  try {
    await ensureTelegramUser(tgId, nick);
    await maybeMergeAnonSession(req, tgId);
    const user = await getUser(tgId);
    const token = issueSessionToken(tgId, VERIF_PARTNER_ID);
    res.json({
      session_token: token,
      user: { user_id: tgId, nickname: user?.displayName || nick, linked_telegram: true },
    });
  } catch (e: any) {
    console.error('verif/auth/dev failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.get('/me', requireSession, async (req, res) => {
  try {
    const u = req.sessionUser!;
    const [stats, badges] = await Promise.all([getStatsForUser(u), getEarnedBadgeIds(u.tgId)]);
    res.json({
      user_id: u.tgId,
      nickname: u.displayName,
      linked_telegram: !u.tgId.startsWith('web:'),
      total: stats.total,
      rank: stats.rank,
      total_users: stats.totalUsers,
      today_count: stats.todayCount,
      badges,
    });
  } catch (e: any) {
    console.error('verif/me failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/me/rename', requireSession, async (req, res) => {
  const nick = sanitizeNick((req.body || {}).display_name);
  if (nick.length < 2) return res.status(400).json({ error: 'nickname_too_short' });
  try {
    const u = req.sessionUser!;
    if (nick !== u.displayName && (await userExistsByDisplayName(nick))) {
      return res.status(409).json({ error: 'nickname_taken' });
    }
    await patchUser(u.tgId, { displayName: nick });
    res.json({ ok: true, nickname: nick });
  } catch (e: any) {
    console.error('verif/me/rename failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// ---------- ПЕРЕВІРКА ----------
router.get('/next', requireSession, async (req, res) => {
  try {
    const next = await getNextForVerifier(req.sessionUser!.tgId);
    res.json({ case: next });
  } catch (e: any) {
    console.error('verif/next failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/case/:id/submit', requireSession, async (req, res) => {
  const body = req.body || {};
  const answers = Array.isArray(body.answers) ? body.answers.map(String) : null;
  try {
    const result = await submitVerification({
      verifierId: req.sessionUser!.tgId,
      displayName: req.sessionUser!.displayName,
      caseId: req.params.id,
      answers,
    });
    res.json(result);
  } catch (e: any) {
    if (e instanceof VerifError) return res.status(400).json({ error: e.code, message: e.message });
    console.error('verif/submit failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/case/:id/skip', requireSession, async (req, res) => {
  try {
    await skipVerification(req.sessionUser!.tgId, req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('verif/skip failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/case/:id/release', requireSession, async (req, res) => {
  try {
    await releaseVerification(req.sessionUser!.tgId, req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('verif/release failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.get('/stats', requireSession, async (_req, res) => {
  try {
    res.json(await getVerifStats());
  } catch (e: any) {
    console.error('verif/stats failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// Проксі зображення — без сесії (HMAC-токен на caseId сам авторизує, для <img src>).
router.get('/case/:id/image', proxyVerifImage);

export default router;
