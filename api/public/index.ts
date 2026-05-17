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
import { proxyCaseImage } from './image.js';

const router = express.Router();

// Глобальний CORS-preflight + базові заголовки. requirePartner додає Access-Control-Allow-Origin
// після успішної валідації origin.
router.use(widgetCors);

// ---------- PARTNER CONFIG ----------
// Публічна (без сесії) конфігурація для віджета: тема, колір, текст кнопки, префікс ніку.
// Викликається віджетом одразу після завантаження бандла — до того як юзер щось натиснув.
router.get('/partner-config', requirePartner, async (req, res) => {
  const p = req.partner!;
  res.json({
    partner_id: p.partnerId,
    name: p.name,
    nickname_prefix: p.nicknamePrefix,
    customization: p.customization,
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
