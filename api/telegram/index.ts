import express from 'express';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  appendCases,
  getAllCases,
  getAllSessions,
  getAllUsers,
  getMeta,
  patchUser,
  setMeta,
  deleteSession,
} from './storage.js';
import { handleUpdate, dispatchCaseToUser, sendScheduledGreeting } from './bot.js';
import { sendPhotoByBuffer, setWebhook, getWebhookInfo, deleteWebhook } from './tg-api.js';
import { detectCaseBoxes } from './slicer.js';
import {
  nowIsoUtc,
  progressByDescription,
  progressOfAllCases,
  recomputeCaseSubmissionCount,
} from './scheduler.js';

const router = express.Router();

// ----------- Webhook -----------
// На Vercel serverless функція завершується після відправки відповіді,
// тож робимо handleUpdate ДО res.sendStatus, інакше обробка може не встигнути.
// У Telegram є 60-секундний таймаут — для нас цього більш ніж достатньо.
router.post('/webhook', async (req, res) => {
  const expected = process.env[telegramBotConfig.tg.webhookSecretEnv];
  const got = req.header('x-telegram-bot-api-secret-token');
  if (expected && got !== expected) {
    return res.status(403).send('forbidden');
  }
  try {
    await handleUpdate(req.body);
  } catch (e: any) {
    console.error('webhook handler error', e?.stack || e);
    const chatId = req.body?.message?.chat?.id || req.body?.callback_query?.message?.chat?.id;
    if (chatId) {
      try {
        const { sendMessage } = await import('./tg-api.js');
        await sendMessage(chatId, '⚠ Бот тимчасово недоступний. Адміна вже сповіщено.');
      } catch {}
    }
  }
  // 200 повертаємо завжди — інакше Telegram буде повторювати апдейт.
  res.sendStatus(200);
});

// ----------- Cron tick (зовнішній) -----------
router.get('/cron/tick', async (req, res) => {
  const expected = process.env[telegramBotConfig.cronSecretEnv];
  if (expected && req.query.secret !== expected) {
    return res.status(403).send('forbidden');
  }

  const cfg = telegramBotConfig.dispatch;
  // selectNextCaseForUser тепер тягне кандидатів через SQL-RPC per-user,
  // тож префетч усіх справ більше не потрібен.
  const [users, sessions] = await Promise.all([
    getAllUsers(),
    getAllSessions(),
  ]);
  const sessionMap = new Map(sessions.map(s => [s.tgId, s]));

  const stats = {
    totalUsers: users.length,
    activeUsers: 0,
    pausedUsers: 0,
    skippedSessionOpen: 0,
    sent: 0,
    noCases: 0,
    errors: 0,
  };
  const results: any[] = [];

  // Bounded concurrency — щоб і Vercel-функція укладалася в ліміт,
  // і Telegram API не отримував шторм одночасних запитів.
  const CONCURRENCY = 6;
  const queue = [...users];
  const workers: Promise<void>[] = [];

  const processOne = async (u: any) => {
    if (u.status !== 'active') {
      stats.pausedUsers++;
      return;
    }
    stats.activeUsers++;

    const session = sessionMap.get(u.tgId);
    if (session && cfg.skipIfSessionOpen) {
      const ageMs = Date.now() - new Date(session.updatedAt || session.startedAt).getTime();
      const ttlMs = cfg.sessionTtlHours * 3600 * 1000;
      if (ageMs > ttlMs) {
        await deleteSession(u.tgId);
      } else {
        stats.skippedSessionOpen++;
        results.push({ tgId: u.tgId, skipped: 'session-open' });
        return;
      }
    }

    try {
      try {
        await sendScheduledGreeting(u.tgId);
      } catch (e) {
        console.error('greeting failed', u.tgId, e);
      }
      const sent = await dispatchCaseToUser(u.tgId, false);
      if (sent) {
        stats.sent++;
        results.push({ tgId: u.tgId, sent: true });
      } else {
        stats.noCases++;
        results.push({ tgId: u.tgId, sent: false, reason: 'no-cases-or-inactive' });
      }
    } catch (e: any) {
      stats.errors++;
      results.push({ tgId: u.tgId, error: e.message });
    }
  };

  const runWorker = async () => {
    while (queue.length > 0) {
      const u = queue.shift();
      if (!u) break;
      await processOne(u);
    }
  };
  for (let i = 0; i < CONCURRENCY; i++) workers.push(runWorker());
  await Promise.all(workers);

  res.json({ ok: true, stats, dispatched: results });
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

// Тестовий ендпоінт: пише в чат "ping" — щоб переконатися що бот має токен і канал ОК.
router.post('/admin/ping-chat', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { chatId, text } = req.body || {};
  if (!chatId) return res.status(400).json({ error: 'chatId required' });
  try {
    const { sendMessage } = await import('./tg-api.js');
    await sendMessage(chatId, text || 'ping від адмінки');
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/health', async (req, res) => {
  let webhook: any = null;
  let webhookErr: string | null = null;
  try {
    if (process.env[telegramBotConfig.tg.botTokenEnv]) {
      webhook = await getWebhookInfo();
    }
  } catch (e: any) {
    webhookErr = e.message;
  }
  res.json({
    ok: true,
    webhook,
    webhookErr,
    env: {
      botToken: !!process.env[telegramBotConfig.tg.botTokenEnv],
      channelId: !!process.env[telegramBotConfig.tg.channelIdEnv],
      webhookSecret: !!process.env[telegramBotConfig.tg.webhookSecretEnv],
      cronSecret: !!process.env[telegramBotConfig.cronSecretEnv],
      adminLogin: !!process.env[telegramBotConfig.adminLoginEnv],
      adminPassword: !!process.env[telegramBotConfig.adminPasswordEnv],
      supabaseUrl: !!process.env[telegramBotConfig.supabase.urlEnv],
      supabaseServiceKey: !!process.env[telegramBotConfig.supabase.serviceKeyEnv],
    },
  });
});

// Перевірити, що Supabase налаштовано: схема запущена, ключ правильний.
router.get('/admin/check-db', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    const { db, T } = await import('./storage.js');
    const tables = [T.users, T.cases, T.sessions, T.submissions, T.meta];
    const results: Record<string, { ok: boolean; error?: string }> = {};
    for (const t of tables) {
      const { error } = await db().from(t).select('*', { count: 'exact', head: true });
      results[t] = error ? { ok: false, error: error.message } : { ok: true };
    }
    const allOk = Object.values(results).every(r => r.ok);
    res.json({ ok: allOk, tables: results });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
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

// Універсальний get/set для bot_meta. Дозволяємо лише whitelisted ключі,
// щоб через адмінку не можна було перезаписати чутливі ключі.
const META_ALLOWED_KEYS = new Set(['min_confirmations', 'collab_lock_minutes']);
router.get('/admin/meta', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const out: Record<string, string> = {};
  for (const k of META_ALLOWED_KEYS) out[k] = (await getMeta(k)) || '';
  res.json({ meta: out });
});
router.post('/admin/meta', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { key, value } = req.body || {};
  if (!key || !META_ALLOWED_KEYS.has(key)) {
    return res.status(400).json({ error: 'invalid key' });
  }
  await setMeta(String(key), String(value ?? ''));
  res.json({ ok: true });
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
  const { imageBase64, sourcePdf, page, bbox, archive, fund, opys, mode } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });
  // Архів/Фонд/Опис ідентифікують опис — без них результати не мають сенсу.
  // Поле sprava більше не використовується (видалено з адмінки).
  for (const [k, v] of [['archive', archive], ['fund', fund], ['opys', opys]] as const) {
    if (!v || !String(v).trim()) {
      return res.status(400).json({ error: `Field "${k}" is required` });
    }
  }
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
        archive: String(archive).trim(),
        fund: String(fund).trim(),
        opys: String(opys).trim(),
        sprava: '',
        submissionsCount: 0,
        status: 'open',
        createdAt: nowIsoUtc(),
        mode: mode === 'collaborative' ? 'collaborative' : 'parallel',
        currentAnswers: [],
        currentAuthorTgId: '',
        confirmationsCount: 0,
        lockedByTgId: '',
        lockedUntil: '',
        updatedAt: '',
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
  const { imageBase64, mime, apiKey, geminiKey } = req.body || {};
  // Підтримуємо обидва імені поля для backward-compat.
  const key = apiKey || geminiKey;
  if (!imageBase64 || !key) {
    return res.status(400).json({ error: 'imageBase64 + apiKey required' });
  }
  try {
    const result = await detectCaseBoxes(imageBase64, mime || 'image/jpeg', key);
    if (result.boxes.length === 0) {
      console.log(`[detect-bboxes] empty result (${result.model}), raw:`, result.raw?.slice(0, 500));
    }
    res.json({ ok: true, ...result });
  } catch (e: any) {
    const detail = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : e.message;
    res.status(500).json({ error: detail });
  }
});

// Перетворює collab-справу на запис у форматі submission для уніфікованого експорту.
function collabCaseToSubmission(
  c: any,
  displayName: string,
  confirmations: Array<{ tg_id: string; display_name: string; kind: string; at: string }>
) {
  return {
    case_id: c.caseId,
    tg_id: c.currentAuthorTgId || '',
    display_name: displayName,
    submitted_at: c.updatedAt || c.createdAt,
    answers: Array.isArray(c.currentAnswers) ? c.currentAnswers : [],
    source_link: '',
    archive: c.archive || '',
    fund: c.fund || '',
    opys: c.opys || '',
    sprava: c.sprava || '',
    source_pdf: c.sourcePdf || '',
    page: c.page || '',
    is_collab: true,
    confirmations_count: c.confirmationsCount || 0,
    case_status: c.status,
    confirmations,
  };
}

router.get('/admin/results', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const limit = Math.min(parseInt((req.query.limit as string) || '500', 10) || 500, 5000);
  try {
    const {
      getRecentSubmissions,
      getMeta,
      getRecentCollabCases,
      getDisplayNamesMap,
      getConfirmationsForCases,
    } = await import('./storage.js');
    const [subs, qRaw, collab] = await Promise.all([
      getRecentSubmissions(limit),
      getMeta('questions'),
      getRecentCollabCases(limit),
    ]);
    const collabFiltered = collab.filter(c => c.confirmationsCount > 0);
    const allUserIds = new Set<string>(collabFiltered.map(c => c.currentAuthorTgId).filter(Boolean));
    const confirms = await getConfirmationsForCases(collabFiltered.map(c => c.caseId));
    for (const cf of confirms) allUserIds.add(cf.tgId);
    const names = await getDisplayNamesMap([...allUserIds]);
    const confirmsByCase = new Map<string, typeof confirms>();
    for (const cf of confirms) {
      const arr = confirmsByCase.get(cf.caseId) || [];
      arr.push(cf);
      confirmsByCase.set(cf.caseId, arr);
    }
    const collabAsSubs = collabFiltered.map(c => {
      const list = (confirmsByCase.get(c.caseId) || [])
        .sort((a, b) => a.at.localeCompare(b.at))
        .map(cf => ({ tg_id: cf.tgId, display_name: names[cf.tgId] || '', kind: cf.kind, at: cf.at }));
      return collabCaseToSubmission(c, names[c.currentAuthorTgId] || '', list);
    });
    let questions: any[] = [];
    try {
      questions = qRaw ? JSON.parse(qRaw) : [];
      if (!Array.isArray(questions)) questions = [];
    } catch {
      questions = [];
    }
    // Об'єднуємо і сортуємо за датою.
    const merged = [...subs, ...collabAsSubs]
      .sort((a: any, b: any) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')))
      .slice(0, limit);
    res.json({ ok: true, questions, submissions: merged });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/submissions-by-description', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const archive = String(req.query.archive || '');
  const fund = String(req.query.fund || '');
  const opys = String(req.query.opys || '');
  if (!archive || !fund || !opys) {
    return res.status(400).json({ error: 'archive, fund, opys required' });
  }
  try {
    const {
      getSubmissionsByDescription,
      getCollabCasesByDescription,
      getDisplayNamesMap,
      getConfirmationsForCases,
    } = await import('./storage.js');
    const [subs, qRaw, collab] = await Promise.all([
      getSubmissionsByDescription(archive, fund, opys),
      getMeta('questions'),
      getCollabCasesByDescription(archive, fund, opys),
    ]);
    const collabFiltered = collab.filter(c => c.confirmationsCount > 0);
    const allUserIds = new Set<string>(collabFiltered.map(c => c.currentAuthorTgId).filter(Boolean));
    const confirms = await getConfirmationsForCases(collabFiltered.map(c => c.caseId));
    for (const cf of confirms) allUserIds.add(cf.tgId);
    const names = await getDisplayNamesMap([...allUserIds]);
    const confirmsByCase = new Map<string, typeof confirms>();
    for (const cf of confirms) {
      const arr = confirmsByCase.get(cf.caseId) || [];
      arr.push(cf);
      confirmsByCase.set(cf.caseId, arr);
    }
    const collabAsSubs = collabFiltered.map(c => {
      const list = (confirmsByCase.get(c.caseId) || [])
        .sort((a, b) => a.at.localeCompare(b.at))
        .map(cf => ({ tg_id: cf.tgId, display_name: names[cf.tgId] || '', kind: cf.kind, at: cf.at }));
      return collabCaseToSubmission(c, names[c.currentAuthorTgId] || '', list);
    });
    let questions: any[] = [];
    try {
      questions = qRaw ? JSON.parse(qRaw) : [];
      if (!Array.isArray(questions)) questions = [];
    } catch {
      questions = [];
    }
    const merged = [...subs, ...collabAsSubs].sort((a: any, b: any) =>
      String(b.submitted_at || '').localeCompare(String(a.submitted_at || ''))
    );
    res.json({ ok: true, questions, submissions: merged });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/overview', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const [users, cases] = await Promise.all([getAllUsers(), getAllCases()]);
  const descriptions = progressByDescription(cases);
  const fullyDoneDescriptions = descriptions.filter(d => d.doneCases === d.totalCases).length;
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
    descriptions,
    fullyDoneDescriptions,
  });
});

router.post('/admin/recompute-case', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { caseId } = req.body || {};
  const count = await recomputeCaseSubmissionCount(caseId);
  res.json({ ok: true, count });
});

export default router;
