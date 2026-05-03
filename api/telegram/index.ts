import express from 'express';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  appendCases,
  ensureAllSheets,
  getAllCases,
  getAllSessions,
  getAllUsers,
  getMeta,
  patchUser,
  setMeta,
  deleteSession,
} from './storage.js';
import { handleUpdate, dispatchCaseToUser } from './bot.js';
import { sendPhotoByBuffer, setWebhook, getWebhookInfo, deleteWebhook } from './tg-api.js';
import { detectCaseBoxes } from './slicer.js';
import {
  isWithinDispatchWindow,
  nowIsoUtc,
  progressOfAllCases,
  recomputeCaseSubmissionCount,
} from './scheduler.js';

const router = express.Router();

// raw json parser is set by parent app

// ----------- Webhook -----------
router.post('/webhook', async (req, res) => {
  const expected = process.env[telegramBotConfig.tg.webhookSecretEnv];
  const got = req.header('x-telegram-bot-api-secret-token');
  if (expected && got !== expected) {
    return res.status(403).send('forbidden');
  }
  res.sendStatus(200); // ack одразу
  try {
    await handleUpdate(req.body);
  } catch (e) {
    console.error('webhook handler error', e);
  }
});

// ----------- Cron tick (зовнішній) -----------
router.get('/cron/tick', async (req, res) => {
  const expected = process.env[telegramBotConfig.cronSecretEnv];
  if (expected && req.query.secret !== expected) {
    return res.status(403).send('forbidden');
  }

  if (!isWithinDispatchWindow()) {
    return res.json({ ok: true, skipped: 'outside-window-or-not-step' });
  }

  const cfg = telegramBotConfig.dispatch;
  const users = await getAllUsers();
  const sessions = await getAllSessions();
  const sessionMap = new Map(sessions.map(s => [s.tgId, s]));

  const results: any[] = [];
  for (const u of users) {
    if (u.status !== 'active') continue;

    const session = sessionMap.get(u.tgId);
    if (session && cfg.skipIfSessionOpen) {
      // перевірка протермінування
      const ageMs = Date.now() - new Date(session.updatedAt || session.startedAt).getTime();
      const ttlMs = cfg.sessionTtlHours * 3600 * 1000;
      if (ageMs > ttlMs) {
        await deleteSession(u.tgId);
      } else {
        results.push({ tgId: u.tgId, skipped: 'session-open' });
        continue;
      }
    }

    // інкремент пропусків якщо попередня розсилка лишилася без відповіді
    if (u.lastDispatchedCaseId) {
      const stillSession = sessionMap.has(u.tgId);
      if (!stillSession) {
        // справа була надіслана, але юзер не закінчив — рахуємо як пропуск
        // (грубо: якщо lastDispatchedAt > останнього confirm — складно дізнатись точно;
        // використовуємо просту евристику: остання справа не була відповіджена цим юзером)
      }
    }

    try {
      const sent = await dispatchCaseToUser(u.tgId);
      if (sent) {
        results.push({ tgId: u.tgId, sent: true });
      } else {
        const misses = u.consecutiveMisses + 0; // sent=false тут означає "немає справ"
        results.push({ tgId: u.tgId, sent: false });
      }
    } catch (e: any) {
      results.push({ tgId: u.tgId, error: e.message });
    }
  }

  res.json({ ok: true, dispatched: results });
});

// ----------- Cron cleanup (можна викликати тим самим зовнішнім cron) -----------
router.get('/cron/cleanup', async (req, res) => {
  const expected = process.env[telegramBotConfig.cronSecretEnv];
  if (expected && req.query.secret !== expected) {
    return res.status(403).send('forbidden');
  }
  const cfg = telegramBotConfig.dispatch;
  const sessions = await getAllSessions();
  const ttlMs = cfg.sessionTtlHours * 3600 * 1000;
  let cleaned = 0;
  for (const s of sessions) {
    const age = Date.now() - new Date(s.updatedAt || s.startedAt).getTime();
    if (age > ttlMs) {
      await deleteSession(s.tgId);
      cleaned++;
      // інкремент пропусків
      const u = (await getAllUsers()).find(x => x.tgId === s.tgId);
      if (u) {
        const misses = u.consecutiveMisses + 1;
        const next: any = { consecutiveMisses: misses };
        if (misses >= cfg.unansweredPauseAfter) next.status = 'paused';
        await patchUser(u.tgId, next);
      }
    }
  }
  res.json({ ok: true, cleaned });
});

// ----------- Admin endpoints (захищені тим же CRON_SECRET; для веб-UI) -----------

function requireAdminSecret(req: express.Request, res: express.Response): boolean {
  const expected = process.env[telegramBotConfig.cronSecretEnv];
  const got = (req.query.secret as string) || req.header('x-admin-secret');
  if (!expected) {
    res.status(500).json({ error: 'Server missing CRON_SECRET' });
    return false;
  }
  if (got !== expected) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// Публічний ендпоінт логіну: повертає секрет (= CRON_SECRET) у разі правильних логіну/паролю.
router.post('/admin/login', (req, res) => {
  const { login, password } = req.body || {};
  const expectedLogin = process.env[telegramBotConfig.adminLoginEnv];
  const expectedPassword = process.env[telegramBotConfig.adminPasswordEnv];
  const cronSecret = process.env[telegramBotConfig.cronSecretEnv];

  if (!expectedLogin || !expectedPassword || !cronSecret) {
    return res.status(500).json({
      error: `Server not configured. Required env: ${telegramBotConfig.adminLoginEnv}, ${telegramBotConfig.adminPasswordEnv}, ${telegramBotConfig.cronSecretEnv}`,
    });
  }
  if (login !== expectedLogin || password !== expectedPassword) {
    return res.status(401).json({ error: 'Невірний логін або пароль' });
  }
  res.json({ ok: true, token: cronSecret });
});

router.get('/admin/health', (req, res) => {
  res.json({
    ok: true,
    env: {
      botToken: !!process.env[telegramBotConfig.tg.botTokenEnv],
      channelId: !!process.env[telegramBotConfig.tg.channelIdEnv],
      webhookSecret: !!process.env[telegramBotConfig.tg.webhookSecretEnv],
      cronSecret: !!process.env[telegramBotConfig.cronSecretEnv],
      adminLogin: !!process.env[telegramBotConfig.adminLoginEnv],
      adminPassword: !!process.env[telegramBotConfig.adminPasswordEnv],
      googleServiceAccount: !!process.env[telegramBotConfig.google.serviceAccountJsonEnv],
      spreadsheetId: !!process.env[telegramBotConfig.google.spreadsheetIdEnv],
    },
  });
});

router.post('/admin/init-sheets', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    await ensureAllSheets();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/save-questions', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { questions } = req.body || {};
  if (!Array.isArray(questions)) return res.status(400).json({ error: 'questions array required' });
  await setMeta('questions', JSON.stringify(questions));
  res.json({ ok: true, count: questions.length });
});

router.get('/admin/questions', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const raw = await getMeta('questions');
  res.json({ questions: raw ? JSON.parse(raw) : [] });
});

router.post('/admin/set-webhook', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  const secret = process.env[telegramBotConfig.tg.webhookSecretEnv];
  if (!secret) return res.status(400).json({ error: `Missing ${telegramBotConfig.tg.webhookSecretEnv}` });
  try {
    await setWebhook(url, secret);
    const info = await getWebhookInfo();
    res.json({ ok: true, info });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/webhook-info', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    const info = await getWebhookInfo();
    res.json({ ok: true, info });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/delete-webhook', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  await deleteWebhook();
  res.json({ ok: true });
});

// Завантаження картинки в канал. Приймає base64 PNG/JPEG.
router.post('/admin/upload-case', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { imageBase64, mime, sourcePdf, page, bbox } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });
  const channelId = process.env[telegramBotConfig.tg.channelIdEnv];
  if (!channelId) return res.status(400).json({ error: `Missing ${telegramBotConfig.tg.channelIdEnv}` });

  try {
    const buf = Buffer.from(imageBase64, 'base64');
    const result = await sendPhotoByBuffer(channelId, buf, 'case.jpg');
    const photoArr = result?.photo || [];
    const fileId = photoArr.length ? photoArr[photoArr.length - 1].file_id : '';
    const caseId = (globalThis.crypto?.randomUUID?.() || `c_${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/-/g, '');

    await appendCases([
      {
        caseId,
        tgFileId: fileId,
        tgChatId: String(channelId),
        tgMessageId: String(result?.message_id || ''),
        sourcePdf: sourcePdf || '',
        page: String(page || ''),
        bbox: bbox ? JSON.stringify(bbox) : '',
        submissionsCount: 0,
        status: 'open',
        createdAt: nowIsoUtc(),
      },
    ]);
    res.json({ ok: true, caseId, fileId, messageId: result?.message_id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Авто-нарізка: фронт шле картинку сторінки → ми просимо Gemini bbox-и.
router.post('/admin/detect-bboxes', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { imageBase64, mime, geminiKey } = req.body || {};
  if (!imageBase64 || !geminiKey) return res.status(400).json({ error: 'imageBase64 + geminiKey required' });
  try {
    const boxes = await detectCaseBoxes(imageBase64, mime || 'image/jpeg', geminiKey);
    res.json({ ok: true, boxes });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/overview', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const [users, cases] = await Promise.all([getAllUsers(), getAllCases()]);
  res.json({
    users: users
      .map(u => ({
        tgId: u.tgId,
        displayName: u.displayName,
        totalPoints: u.totalPoints,
        status: u.status,
        consecutiveMisses: u.consecutiveMisses,
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints),
    cases: cases.length,
    progress: progressOfAllCases(cases),
  });
});

router.post('/admin/recompute-case', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { caseId } = req.body || {};
  const count = await recomputeCaseSubmissionCount(caseId);
  res.json({ ok: true, count });
});

export default router;
