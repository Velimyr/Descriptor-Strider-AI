// Public API віджета. Маунтиться у api/index.ts як /api/public/v1.
//
// Усі ендпоінти потребують X-Partner-Key (валідується widgetCors+requirePartner).
// Більшість також потребують Authorization: Bearer <session_token>.
//
// Ендпоінти:
//   POST   /session/start           — створює анонімного web-юзера, видає токен
//   POST   /session/heartbeat       — продовжує collab-лок поточної справи (опційно)
//   GET    /case/next               — наступна справа для юзера
//   POST   /case/:id/submit         — відповіді (parallel-create / collab-create/edit)
//   POST   /case/:id/confirm        — підтвердження collab без правок
//   POST   /case/:id/skip           — пропустити справу
//   GET    /me/stats                — мої бали, місце в рейтингу
//   GET    /leaderboard             — топ-10
//   GET    /case/:id/image          — проксі фото з TG (без сесії, по imageToken)
import express from 'express';
import { widgetCors, requirePartner, requireSession } from './middleware.js';
import { createAnonymousWebUser } from '../core/webUsers.js';
import { issueSessionToken } from '../core/sessionToken.js';
import { getNextCaseForUser, heartbeatCase, releaseCase } from '../core/cases.js';
import { SubmitError, submitAnswers } from '../core/submit.js';
import { skipCase } from '../core/skip.js';
import { getLeaderboard, getStatsForUser } from '../core/stats.js';
import { createLinkCode, getLinkCode } from '../core/linking.js';
import { proxyCaseImage } from './image.js';

// Telegram-username бота (без @), куди йде deep-link для лінкінгу.
// Можна перевизначити env-ом TELEGRAM_BOT_USERNAME.
const TG_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'descriptorstriderbot';

const router = express.Router();

// Глобальний CORS-preflight + базові заголовки. requirePartner додає Access-Control-Allow-Origin
// після успішної валідації origin.
router.use(widgetCors);

// ---------- PARTNER CONFIG ----------
// Публічна (без сесії) конфігурація для віджета: тема, колір, текст кнопки,
// префікс ніку, допоміжні тексти. Викликається віджетом на ініціалізації.
router.get('/partner-config', requirePartner, async (req, res) => {
  const p = req.partner!;
  const { telegramBotConfig } = await import('../../src/telegram-bot/config.js');
  const t = telegramBotConfig.texts;
  res.json({
    partner_id: p.partnerId,
    name: p.name,
    nickname_prefix: p.nicknamePrefix,
    customization: p.customization,
    // Username бота для віджета — для всіх посилань (LinkedView).
    // Той самий ENV що для генерації deep-link, щоб віджет не мав хардкоду.
    tg_bot_username: TG_BOT_USERNAME,
    help: {
      descStruct: t.helpDescStruct,
      about: t.helpAbout,
      howToAnswer: t.helpHowToAnswer,
      points: t.helpPoints,
      faq: t.helpFaq,
      introAck: t.introAckButton,
    },
  });
});

// ---------- SESSION ----------
router.post('/session/start', requirePartner, async (req, res) => {
  try {
    const user = await createAnonymousWebUser(req.partner!);
    const token = issueSessionToken(user.tgId, req.partner!.partnerId);
    res.json({
      session_token: token,
      user_id: user.tgId,
      nickname: user.displayName,
    });
  } catch (e: any) {
    console.error('/session/start failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/session/heartbeat', requirePartner, requireSession, async (req, res) => {
  const caseId = String((req.body || {}).case_id || '');
  if (!caseId) return res.status(400).json({ error: 'case_id required' });
  try {
    await heartbeatCase(req.sessionUser!, caseId);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('/session/heartbeat failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// ---------- CASE ----------
router.get('/case/next', requirePartner, requireSession, async (req, res) => {
  try {
    const next = await getNextCaseForUser(req.sessionUser!);
    if (!next) return res.json({ case: null });
    // Формуємо повний URL зображення (відносний шлях, віджет сам додасть origin).
    const imageUrl = `/api/public/v1/case/${encodeURIComponent(next.caseId)}/image?t=${next.imageToken}`;
    res.json({
      case: {
        case_id: next.caseId,
        image_url: imageUrl,
        questions: next.questions,
        task_type: next.taskType,
        existing_answers: next.existingAnswers,
        mode: next.mode,
        locked_until: next.lockedUntil,
      },
    });
  } catch (e: any) {
    console.error('/case/next failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/case/:id/submit', requirePartner, requireSession, async (req, res) => {
  const caseId = req.params.id;
  const body = req.body || {};
  const answers = Array.isArray(body.answers) ? body.answers.map(String) : null;
  try {
    const result = await submitAnswers(req.sessionUser!, caseId, 'submit', answers);
    res.json(result);
  } catch (e: any) {
    if (e instanceof SubmitError) return res.status(400).json({ error: e.code, message: e.message });
    console.error('/case/:id/submit failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/case/:id/confirm', requirePartner, requireSession, async (req, res) => {
  const caseId = req.params.id;
  try {
    const result = await submitAnswers(req.sessionUser!, caseId, 'confirm', null);
    res.json(result);
  } catch (e: any) {
    if (e instanceof SubmitError) return res.status(400).json({ error: e.code, message: e.message });
    console.error('/case/:id/confirm failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.post('/case/:id/skip', requirePartner, requireSession, async (req, res) => {
  const caseId = req.params.id;
  try {
    await skipCase(req.sessionUser!, caseId);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('/case/:id/skip failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// ---------- STATS ----------
router.get('/me/stats', requirePartner, requireSession, async (req, res) => {
  try {
    res.json(await getStatsForUser(req.sessionUser!));
  } catch (e: any) {
    console.error('/me/stats failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

router.get('/leaderboard', requirePartner, requireSession, async (req, res) => {
  try {
    res.json(await getLeaderboard(req.sessionUser!));
  } catch (e: any) {
    console.error('/leaderboard failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// ---------- LINKING (web → TG) ----------
router.post('/link/start', requirePartner, requireSession, async (req, res) => {
  try {
    const lc = await createLinkCode(req.sessionUser!.tgId);
    res.json({
      code: lc.code,
      deep_link: `https://t.me/${TG_BOT_USERNAME}?start=link_${lc.code}`,
      expires_at: lc.expiresAt,
    });
  } catch (e: any) {
    console.error('/link/start failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// Опитуємо статус коду. Якщо used_at != null → лінкінг відбувся.
// Не вимагає sessionUser щоб працював навіть після того як web-юзер видалений (мердж).
router.get('/link/status', requirePartner, async (req, res) => {
  const code = String(req.query.code || '');
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const lc = await getLinkCode(code);
    if (!lc) return res.json({ status: 'unknown' });
    if (lc.usedAt) return res.json({ status: 'completed', telegram_tg_id: lc.telegramTgId });
    if (new Date(lc.expiresAt).getTime() < Date.now()) return res.json({ status: 'expired' });
    return res.json({ status: 'pending' });
  } catch (e: any) {
    console.error('/link/status failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// ---------- IMAGE ----------
// Без requirePartner/requireSession: токен на сам caseId сам по собі є авторизацією
// (HMAC, який знає тільки наш бекенд). Це потрібно щоб <img src=...> у віджеті
// працював без custom-заголовків.
router.get('/case/:id/image', proxyCaseImage);

// Звільнити справу при закритті вкладки (sendBeacon-friendly: text/plain body OK).
router.post('/case/:id/release', requirePartner, requireSession, async (req, res) => {
  const caseId = req.params.id;
  try {
    await releaseCase(req.sessionUser!, caseId);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('/case/:id/release failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

export default router;
