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
import { requireSession } from '../_public/middleware.js';
import { issueSessionToken, verifySessionToken } from '../_core/sessionToken.js';
import {
  createWebUser,
  getUser,
  upsertUser,
  patchUser,
  userExistsByDisplayName,
  getEarnedBadgeIds,
} from '../_telegram/storage.js';
import { getStatsForUser } from '../_core/stats.js';
import { mergeWebUserIntoTelegram } from '../_core/linking.js';
import {
  getNextForVerifier,
  submitVerification,
  skipVerification,
  releaseVerification,
  getVerifStats,
  VerifError,
} from '../_core/verifCases.js';
import { proxyVerifImage } from './image.js';
import { serveBadgeImage } from './badge.js';
import {
  verifyTelegramLogin,
  telegramDisplayName,
  VERIF_PARTNER_ID,
  TelegramLoginData,
} from '../_core/verifAuth.js';
import { createLoginCode, getLoginCode } from '../_core/verifLogin.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

const TG_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'descriptorstriderbot';

const router = express.Router();

// HTML-відповідь, що кладе токен у localStorage і повертає користувача в SPA.
// (Через redirect не можна напряму записати localStorage — робимо це коротким скриптом.)
function htmlFinishLogin(token: string | null, error: string | null): string {
  const back = '/';
  const setToken = token
    ? `try{localStorage.setItem('verif_session_token',${JSON.stringify(token)});localStorage.setItem('main_active_tab','verification');}catch(e){}`
    : '';
  const setErr = error
    ? `try{sessionStorage.setItem('verif_login_error',${JSON.stringify(error)});localStorage.setItem('main_active_tab','verification');}catch(e){}`
    : '';
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Вхід…</title></head><body style="font-family:sans-serif;color:#475569;padding:2rem">Вхід…<script>${setToken}${setErr}location.replace(${JSON.stringify(back)});</script></body></html>`;
}

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
    city: '',
    region: '',
    tgUsername: '',
    phoneNumber: '',
    facebookUrl: '',
    photoFileId: '',
    photoMessageId: '',
    banned: false,
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
    // База для посилання на повний опис (PDF) — налаштовується в config.ts.
    opys_base_url: telegramBotConfig.verif.opysBaseUrl,
  });
});

router.post('/register', async (req, res) => {
  const nick = sanitizeNick((req.body || {}).display_name);
  if (nick.length < 2) return res.status(400).json({ error: 'nickname_too_short' });
  try {
    if (await userExistsByDisplayName(nick)) return res.status(409).json({ error: 'nickname_taken' });
    const tgId = `web:${randomUUID()}`;
    // Без партнера (partner_id = NULL) — на сайті перевірки немає партнерського неймспейсу.
    const user = await createWebUser({ tgId, displayName: nick, partnerId: null });
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

// Telegram Login Widget у REDIRECT-режимі (data-auth-url). Telegram робить повний
// top-level редірект сюди з параметрами профілю в query — без popup/iframe/сторонніх
// cookies. Власний параметр `anon` (токен анонімної сесії) — для мержу балів; у звірку
// hash НЕ входить (беремо лише поля Telegram).
router.get('/auth/telegram/callback', async (req, res) => {
  const q = req.query as Record<string, string>;
  const tgFields = ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash'];
  const data: any = {};
  for (const f of tgFields) if (q[f] !== undefined) data[f] = q[f];

  let ok = false;
  try {
    ok = verifyTelegramLogin(data as TelegramLoginData);
  } catch {
    return res.status(500).send(htmlFinishLogin(null, 'bot_token_missing'));
  }
  if (!ok) return res.status(401).send(htmlFinishLogin(null, 'invalid_telegram_signature'));

  const tgId = String(data.id);
  try {
    await ensureTelegramUser(tgId, telegramDisplayName(data as TelegramLoginData));
    const anon = String(q.anon || '');
    if (anon) {
      const payload = verifySessionToken(anon);
      if (payload && payload.tgId.startsWith('web:')) {
        try {
          await mergeWebUserIntoTelegram(payload.tgId, tgId);
        } catch (e: any) {
          console.error('verif callback merge failed', e?.message || e);
        }
      }
    }
    const token = issueSessionToken(tgId, VERIF_PARTNER_ID);
    res.send(htmlFinishLogin(token, null));
  } catch (e: any) {
    console.error('verif/auth/telegram/callback failed', e?.message || e);
    res.status(500).send(htmlFinishLogin(null, 'internal'));
  }
});

// ---------- ВХІД ЧЕРЕЗ БОТА (надійна альтернатива Login Widget) ----------
// Сайт створює код → відкриває t.me/<bot>?start=login_<code> → юзер тисне Старт →
// бот фіксує tg_id → сайт опитує /login/status і отримує сесію.
router.post('/login/start', async (_req, res) => {
  try {
    const { code, expiresAt } = await createLoginCode();
    res.json({
      code,
      deep_link: `https://t.me/${TG_BOT_USERNAME}?start=login_${code}`,
      expires_at: expiresAt,
    });
  } catch (e: any) {
    console.error('verif/login/start failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.get('/login/status', async (req, res) => {
  const code = String(req.query.code || '');
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const lc = await getLoginCode(code);
    if (!lc) return res.json({ status: 'unknown' });
    if (lc.usedAt && lc.tgId) {
      // Опційний мерж балів анонімної сесії в підтверджений TG-акаунт.
      const anon = String(req.query.anon || '');
      if (anon) {
        const payload = verifySessionToken(anon);
        if (payload && payload.tgId.startsWith('web:')) {
          try {
            await mergeWebUserIntoTelegram(payload.tgId, lc.tgId);
          } catch (e: any) {
            console.error('verif login merge failed', e?.message || e);
          }
        }
      }
      const token = issueSessionToken(lc.tgId, VERIF_PARTNER_ID);
      const user = await getUser(lc.tgId);
      return res.json({ status: 'completed', session_token: token, nickname: user?.displayName || '' });
    }
    if (new Date(lc.expiresAt).getTime() < Date.now()) return res.json({ status: 'expired' });
    return res.json({ status: 'pending' });
  } catch (e: any) {
    console.error('verif/login/status failed', e?.message || e);
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

// Профіль: повертаємо ПУБЛІЧНІ + приватні поля для свого юзера.
router.get('/me/profile', requireSession, async (req, res) => {
  try {
    const u = req.sessionUser!;
    res.json({
      nickname: u.displayName,
      city: u.city,
      region: u.region,
      facebookUrl: u.facebookUrl,
      hasPhoto: !!u.photoFileId,
      // web-юзери не мають TG-кнопок, але показуємо що збережено
      tgUsername: u.tgUsername,
      phoneNumber: u.phoneNumber,
    });
  } catch (e: any) {
    console.error('verif/me/profile GET failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// Оновлення публічних/приватних текстових полів профілю.
// Фото на веб-стороні поки не приймаємо — лишається TG-only (як домовились).
router.post('/me/profile', requireSession, async (req, res) => {
  try {
    const u = req.sessionUser!;
    const body = req.body || {};
    const patch: any = {};
    if (body.city !== undefined) patch.city = String(body.city || '').slice(0, 80);
    if (body.region !== undefined) patch.region = String(body.region || '').slice(0, 80);
    if (body.facebookUrl !== undefined) {
      let v = String(body.facebookUrl || '').trim().slice(0, 256);
      if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
      if (v && !/^https:\/\/(www\.|m\.)?(facebook|fb)\.com\/.+/i.test(v)) {
        return res.status(400).json({ error: 'invalid_facebook_url' });
      }
      patch.facebookUrl = v;
    }
    if (Object.keys(patch).length === 0) return res.json({ ok: true, noop: true });
    await patchUser(u.tgId, patch);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('verif/me/profile POST failed', e?.message || e);
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
    const stats = await getVerifStats();
    // Марафон на сьогодні (для банера на вкладці «Перевірка»). null — якщо немає
    // або сьогоднішній марафон не включає дію 'verification'.
    const { marathonForAction, marathonActionWord } = await import('../_telegram/marathon.js');
    const m = marathonForAction('verification');
    res.json({
      ...stats,
      marathon: m
        ? {
            name: m.name,
            coefficient: m.coefficient,
            actionWord: marathonActionWord(m),
            endDate: m.endDateLocal,
          }
        : null,
    });
  } catch (e: any) {
    console.error('verif/stats failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// Проксі зображення — без сесії (HMAC-токен на caseId сам авторизує, для <img src>).
router.get('/case/:id/image', proxyVerifImage);

// Картинка бейджа за id (для картки-привітання). Не секретна → без сесії.
router.get('/badge/:id/image', serveBadgeImage);

export default router;
