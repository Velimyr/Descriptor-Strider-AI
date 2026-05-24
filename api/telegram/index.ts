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
  getTodayActivity,
  getDailyActivity,
} from './storage.js';
import { handleUpdate, dispatchCaseToUser, sendScheduledGreeting } from './bot.js';
import { sendPhotoByBuffer, setWebhook, getWebhookInfo, deleteWebhook } from './tg-api.js';
import { detectCaseBoxes } from './slicer.js';
import {
  computeFundEta,
  kyivDateString,
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
        // Звільняємо collab-лок, якщо був.
        if (session.caseId) {
          try {
            const { unlockCase, getCase } = await import('./storage.js');
            const cse = await getCase(session.caseId);
            if (cse?.mode === 'collaborative' && cse.lockedByTgId === u.tgId) {
              await unlockCase(session.caseId);
            }
          } catch (e) {
            console.error('unlockCase on tick-expiry failed', session.caseId, e);
          }
        }
        // Повідомляємо користувача про прострочену справу.
        try {
          const { sendMessage } = await import('./tg-api.js');
          const notice = telegramBotConfig.texts.sessionExpiredNotice.replace(
            '{button}',
            telegramBotConfig.texts.menuNext
          );
          await sendMessage(u.tgId, notice);
        } catch (e) {
          console.error('tick-expiry notice failed', u.tgId, e);
        }
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
  const notice = telegramBotConfig.texts.sessionExpiredNotice.replace(
    '{button}',
    telegramBotConfig.texts.menuNext
  );
  // Завантажуємо юзерів один раз — інакше для кожної простроченої сесії
  // тягнули б усіх з БД.
  const allUsers = await getAllUsers();
  const userById = new Map(allUsers.map(u => [u.tgId, u]));
  let cleaned = 0;
  const { sendMessage } = await import('./tg-api.js');
  const { unlockCase, getCase } = await import('./storage.js');
  for (const s of sessions) {
    const age = Date.now() - new Date(s.updatedAt || s.startedAt).getTime();
    if (age > ttlMs) {
      await deleteSession(s.tgId);
      // Якщо collab-справа була залочена за цим юзером — звільняємо.
      if (s.caseId) {
        try {
          const cse = await getCase(s.caseId);
          if (cse?.mode === 'collaborative' && cse.lockedByTgId === s.tgId) {
            await unlockCase(s.caseId);
          }
        } catch (e) {
          console.error('unlockCase on expiry failed', s.caseId, e);
        }
      }
      cleaned++;
      const u = userById.get(s.tgId);
      if (u) {
        const misses = u.consecutiveMisses + 1;
        const next: any = { consecutiveMisses: misses };
        if (misses >= cfg.unansweredPauseAfter) next.status = 'paused';
        await patchUser(u.tgId, next);
      }
      // Повідомляємо користувача — не блокуємо обробку інших сесій помилкою.
      try {
        await sendMessage(s.tgId, notice);
      } catch (e) {
        console.error('expiry notice failed', s.tgId, e);
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

// ----------- Integrity check (Перевірка доброчесності) -----------
// Знаходимо пари submissions для однієї справи, де якась відповідь
// відрізняється від попередньої більше ніж на 5 символів (Levenshtein).
// Допомагає виявити користувачів, які вводять текст «від балди».
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

router.get('/admin/integrity', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const threshold = Math.max(0, parseInt((req.query.threshold as string) || '5', 10) || 5);
  const includeResolved = String(req.query.includeResolved || '') === '1';
  try {
    const {
      getAllSubmissionsOrdered,
      getMeta,
      getAllConfirmationsWithAnswers,
      getAllCases,
      getDisplayNamesMap,
      getAllIntegrityReviews,
      integrityPairKey,
    } = await import('./storage.js');
    const [subs, qRaw, confirms, cases, reviews] = await Promise.all([
      getAllSubmissionsOrdered(),
      getMeta('questions'),
      getAllConfirmationsWithAnswers(),
      getAllCases(),
      getAllIntegrityReviews(),
    ]);
    // Мапа resolved-пар: ключ "caseId|first|second" (відсортовані tg_id) → review.
    const resolvedMap = new Map<string, any>();
    for (const r of reviews) {
      resolvedMap.set(`${r.caseId}|${r.firstTgId}|${r.secondTgId}`, r);
    }
    let questions: any[] = [];
    try {
      questions = qRaw ? JSON.parse(qRaw) : [];
      if (!Array.isArray(questions)) questions = [];
    } catch {
      questions = [];
    }

    // Уніфікований формат "запису": case_id, tgId, displayName, submittedAt, answers, метадані.
    type Entry = {
      caseId: string;
      tgId: string;
      displayName: string;
      submittedAt: string;
      answers: string[];
      archive: string;
      fund: string;
      opys: string;
    };

    const caseById = new Map<string, any>();
    for (const c of cases) caseById.set(c.caseId, c);

    // Імена для collab-юзерів (parallel вже має display_name денормалізовано).
    const namesMap = await getDisplayNamesMap([...new Set(confirms.map(c => c.tgId))]);

    const entries: Entry[] = [];
    for (const s of subs) {
      entries.push({
        caseId: s.case_id,
        tgId: s.tg_id || '',
        displayName: s.display_name || '',
        submittedAt: s.submitted_at || '',
        answers: Array.isArray(s.answers) ? s.answers.map(String) : [],
        archive: s.archive || '',
        fund: s.fund || '',
        opys: s.opys || '',
      });
    }
    for (const c of confirms) {
      // Пусті снапшоти (старі записи до міграції або edit-intent без подальшого submit)
      // не дають корисної інформації для порівняння — пропускаємо.
      if (!c.answers || c.answers.length === 0) continue;
      const cs = caseById.get(c.caseId);
      entries.push({
        caseId: c.caseId,
        tgId: c.tgId,
        displayName: namesMap[c.tgId] || '',
        submittedAt: c.at,
        answers: c.answers,
        archive: cs?.archive || '',
        fund: cs?.fund || '',
        opys: cs?.opys || '',
      });
    }

    // Групуємо за case_id, сортуємо за датою.
    const byCase = new Map<string, Entry[]>();
    for (const e of entries) {
      const arr = byCase.get(e.caseId) || [];
      arr.push(e);
      byCase.set(e.caseId, arr);
    }
    for (const arr of byCase.values()) {
      arr.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    }

    const diffs: any[] = [];
    for (const [caseId, list] of byCase) {
      if (list.length < 2) continue;
      // Порівнюємо ВСІ пари (a < b) — якщо в одній зі справ є кілька різних відповідей,
      // хочемо бачити всі підозрілі замінники.
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          // Один і той самий користувач — пропускаємо (це не «двоє різних увели по-різному»).
          if (a.tgId && b.tgId && a.tgId === b.tgId) continue;
          const aa = a.answers;
          const bb = b.answers;
          const fieldDiffs: any[] = [];
          const max = Math.max(aa.length, bb.length, questions.length);
          for (let k = 0; k < max; k++) {
            const va = String(aa[k] ?? '');
            const vb = String(bb[k] ?? '');
            if (va === vb) continue;
            const d = levenshtein(va, vb);
            if (d > threshold) {
              fieldDiffs.push({
                questionIndex: k,
                questionLabel: questions[k]?.label || `Q${k + 1}`,
                from: va,
                to: vb,
                distance: d,
              });
            }
          }
          if (fieldDiffs.length === 0) continue;
          const pair = integrityPairKey(a.tgId, b.tgId);
          const key = `${caseId}|${pair.first}|${pair.second}`;
          const review = resolvedMap.get(key);
          if (review && !includeResolved) continue;
          diffs.push({
            caseId,
            archive: a.archive || b.archive || '',
            fund: a.fund || b.fund || '',
            opys: a.opys || b.opys || '',
            first: { tgId: a.tgId, displayName: a.displayName, submittedAt: a.submittedAt },
            second: { tgId: b.tgId, displayName: b.displayName, submittedAt: b.submittedAt },
            fields: fieldDiffs,
            review: review
              ? {
                  action: review.action,
                  penalizedTgId: review.penalizedTgId || '',
                  at: review.at,
                }
              : null,
          });
        }
      }
    }

    diffs.sort((a, b) =>
      String(b.second.submittedAt || '').localeCompare(String(a.second.submittedAt || ''))
    );
    res.json({ ok: true, threshold, totalCases: byCase.size, diffs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Зняти бали з користувача за недоброчесний ввід + повідомити його.
// Формулювання м'яке, без слова «штраф» — це навчальний меседж, не покарання.
router.post('/admin/penalize', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { tgId, points, caseId, archive, fund, opys, fields, pairTgIdA, pairTgIdB } = req.body || {};
  if (!tgId || !Number.isFinite(points) || points <= 0) {
    return res.status(400).json({ error: 'tgId і додатній points обовʼязкові' });
  }
  try {
    const { getUser, patchUser } = await import('./storage.js');
    const user = await getUser(String(tgId));
    if (!user) return res.status(404).json({ error: 'Користувача не знайдено' });
    const newTotal = Math.round((user.totalPoints - Number(points)) * 100) / 100;
    await patchUser(user.tgId, { totalPoints: newTotal });

    const descLine = archive || fund || opys
      ? `\nОпис: <b>${String(archive || '')} ${String(fund || '')}-${String(opys || '')}</b>`
      : '';
    const safeFields = Array.isArray(fields)
      ? fields
          .filter((f: any) => f && (f.label || f.text))
          .map((f: any) => {
            const label = String(f.label || '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
            const text = String(f.text || '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
            return `• <b>${label}</b>: ${text || '—'}`;
          })
          .join('\n')
      : '';

    const text =
      `Привіт! Ваша відповідь на одну зі справ помітно відрізнялась від того, що було на зображенні.${descLine}\n\n` +
      (safeFields ? `Ваша відповідь, яка викликала питання:\n${safeFields}\n\n` : '') +
      `Щоб усі могли довіряти результатам, ми скоригували ваш баланс на −${points} балів. Новий баланс: <b>${newTotal}</b>.\n\n` +
      `Будь ласка, переписуйте текст саме так, як він на зображенні — навіть з помилками і скороченнями. Дякуємо за розуміння 🙏`;

    // Фіксуємо пару як вирішену, щоб вона зникла зі списку «Перевірка доброчесності».
    if (caseId && pairTgIdA && pairTgIdB) {
      try {
        const { addIntegrityReview } = await import('./storage.js');
        await addIntegrityReview(String(caseId), String(pairTgIdA), String(pairTgIdB), 'penalized', String(tgId));
      } catch (e) {
        console.error('addIntegrityReview (penalize) failed', e);
      }
    }

    try {
      const { sendMessage } = await import('./tg-api.js');
      await sendMessage(user.tgId, text);
    } catch (e: any) {
      // Користувача оновили, але повідомлення не дійшло — повертаємо успіх + warning.
      return res.json({ ok: true, newTotal, warning: `Бали знято, але повідомлення не доставлено: ${e?.message || e}` });
    }
    res.json({ ok: true, newTotal });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Позначити пару як «не потребує штрафу» — більше не зʼявлятиметься у списку.
router.post('/admin/integrity/dismiss', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { caseId, pairTgIdA, pairTgIdB } = req.body || {};
  if (!caseId || !pairTgIdA || !pairTgIdB) {
    return res.status(400).json({ error: 'caseId, pairTgIdA, pairTgIdB обовʼязкові' });
  }
  try {
    const { addIntegrityReview } = await import('./storage.js');
    await addIntegrityReview(String(caseId), String(pairTgIdA), String(pairTgIdB), 'dismissed');
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Відкотити рішення по парі (повертає її в список).
router.post('/admin/integrity/reopen', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { caseId, pairTgIdA, pairTgIdB } = req.body || {};
  if (!caseId || !pairTgIdA || !pairTgIdB) {
    return res.status(400).json({ error: 'caseId, pairTgIdA, pairTgIdB обовʼязкові' });
  }
  try {
    const { db, T, integrityPairKey } = await import('./storage.js');
    const { first, second } = integrityPairKey(String(pairTgIdA), String(pairTgIdB));
    const { error } = await db()
      .from(T.integrityReviews)
      .delete()
      .eq('case_id', String(caseId))
      .eq('first_tg_id', first)
      .eq('second_tg_id', second);
    if (error) throw error;
    res.json({ ok: true });
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

router.get('/admin/today-stats', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const tz = telegramBotConfig.dispatch.timezone || 'Europe/Kyiv';
  const stats = await getTodayActivity(tz);
  res.json({ ...stats, timezone: tz });
});

// Прогноз завершення фонду. Прогноз будуємо так:
// 1) Беремо описи, у яких УСІ справи done (fullyDoneNow).
// 2) Для кожного такого опису «дата завершення» ≈ max(updated_at) серед його справ.
// 3) Швидкість = скільки таких описів завершилися за останні N днів (вікно 14 днів).
// 4) Залишилось = totalDescriptions − fullyDoneNow − baseline.
// 5) Прогнозована дата = сьогодні + ceil(залишилось / швидкість).
router.get('/admin/fund-eta', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const windowDays = Math.max(
    1,
    Math.min(60, parseInt(String(req.query.windowDays || '14'), 10) || 14)
  );
  const cases = await getAllCases();
  res.json(computeFundEta(cases, windowDays));
});

router.get('/admin/daily-activity', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const tz = telegramBotConfig.dispatch.timezone || 'Europe/Kyiv';
  const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || '30'), 10) || 30));
  const series = await getDailyActivity(tz, days);
  res.json({ timezone: tz, days: series });
});

router.post('/admin/recompute-case', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { caseId } = req.body || {};
  const count = await recomputeCaseSubmissionCount(caseId);
  res.json({ ok: true, count });
});

// ===================== ОПИСОВИЙ ПАЗЛ =====================
// Речення дня (read).
router.get('/admin/puzzle', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const date = String(req.query.date || '') || kyivDateString();
  try {
    const { getPuzzle } = await import('./storage.js');
    const p = await getPuzzle(date);
    res.json({ date, sentence: p?.sentence || '' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Зберегти речення дня.
router.post('/admin/puzzle', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { date, sentence } = req.body || {};
  const d = String(date || '') || kyivDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  try {
    const { upsertPuzzle } = await import('./storage.js');
    await upsertPuzzle(d, String(sentence || ''));
    res.json({ ok: true, date: d });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Індикатор наявності: скільки вже розпізнаних колаб-заголовків містять кожне
// слово речення. Це орієнтир (слова реально трапляються в архіві), НЕ гарантія,
// що слово збереться саме сьогодні.
router.get('/admin/puzzle/word-availability', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const sentence = String(req.query.sentence || '');
  try {
    const { getRecognizedCollabAnswers } = await import('./storage.js');
    const { collectibleWords, titleFieldIndex, wordsInText } = await import('./puzzle.js');
    const qRaw = await getMeta('questions');
    let questions: any[] = [];
    try {
      questions = qRaw ? JSON.parse(qRaw) : [];
      if (!Array.isArray(questions)) questions = [];
    } catch {
      questions = [];
    }
    const titleIdx = titleFieldIndex(questions);
    const words = collectibleWords(sentence, telegramBotConfig.puzzle.stopwords);
    const counts = new Map<string, number>(words.map(w => [w, 0]));
    if (titleIdx >= 0 && words.length > 0) {
      const answersList = await getRecognizedCollabAnswers(3000);
      for (const ans of answersList) {
        const title = String(ans[titleIdx] ?? '');
        if (!title) continue;
        const tw = wordsInText(title);
        for (const w of words) if (tw.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
      }
    }
    res.json({
      sentence,
      titleConfigured: titleIdx >= 0,
      words: words.map(w => ({ word: w, count: counts.get(w) || 0 })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Зведення дня: фраза + учасники (нік, зібрано/підтверджено) відсортовані за
// підтвердженими, потім зібраними + переможці.
router.get('/admin/puzzle/progress', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const date = String(req.query.date || '') || kyivDateString();
  try {
    const {
      getPuzzle,
      getPuzzleProgressForDate,
      getPuzzleWinners,
      getDisplayNamesMap,
    } = await import('./storage.js');
    const { collectibleWords } = await import('./puzzle.js');
    const [puzzle, rows, winners] = await Promise.all([
      getPuzzle(date),
      getPuzzleProgressForDate(date),
      getPuzzleWinners(date),
    ]);
    const targets = puzzle
      ? collectibleWords(puzzle.sentence, telegramBotConfig.puzzle.stopwords)
      : [];
    const targetSet = new Set(targets);
    const total = targets.length;
    const agg = new Map<string, { collected: number; confirmed: number }>();
    // Статус кожного слова фрази по кожному учаснику (для детальної таблиці).
    const wordMap = new Map<string, Record<string, 'confirmed' | 'unconfirmed'>>();
    for (const r of rows) {
      const a = agg.get(r.tgId) || { collected: 0, confirmed: 0 };
      a.collected++;
      if (r.status === 'confirmed') a.confirmed++;
      agg.set(r.tgId, a);
      if (targetSet.has(r.word)) {
        const m = wordMap.get(r.tgId) || {};
        m[r.word] = r.status as 'confirmed' | 'unconfirmed';
        wordMap.set(r.tgId, m);
      }
    }
    const tgIds = [...agg.keys()];
    const names = await getDisplayNamesMap(tgIds);
    const placeByTg = new Map(winners.map(w => [w.tgId, w.place]));
    const participants = tgIds
      .map(tgId => ({
        tgId,
        displayName: names[tgId] || '',
        collected: agg.get(tgId)!.collected,
        confirmed: agg.get(tgId)!.confirmed,
        place: placeByTg.get(tgId) ?? null,
        words: wordMap.get(tgId) || {},
      }))
      .sort((a, b) => b.confirmed - a.confirmed || b.collected - a.collected);
    res.json({
      date,
      sentence: puzzle?.sentence || '',
      total,
      words: targets,
      participants,
      winners: winners.map(w => ({ ...w, displayName: names[w.tgId] || '' })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Усі пазли (минулі й майбутні), за зростанням дати.
router.get('/admin/puzzles', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    const { getAllPuzzles } = await import('./storage.js');
    const puzzles = await getAllPuzzles();
    res.json({ puzzles: puzzles.map(p => ({ date: p.dateKyiv, sentence: p.sentence })) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Масове заповнення: кожна фраза — на найближчий ПОРОЖНІЙ день, починаючи зі
// startDate (за замовч. сьогодні, Київ), не перезаписуючи вже задані дні.
// dryRun=true — лише прев'ю (нічого не зберігаємо).
function addDaysIso(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

router.post('/admin/puzzle/bulk', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const body = req.body || {};
  const dryRun = body.dryRun === true;
  const phrases = Array.isArray(body.phrases)
    ? body.phrases.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  const startDate = String(body.startDate || '') || kyivDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return res.status(400).json({ error: 'startDate must be YYYY-MM-DD' });
  }
  if (phrases.length === 0) {
    return res.status(400).json({ error: 'phrases required' });
  }
  try {
    const { getAllPuzzles, upsertPuzzle } = await import('./storage.js');
    const all = await getAllPuzzles();
    const filled = new Set(all.filter(p => p.sentence.trim()).map(p => p.dateKyiv));
    const assignments: Array<{ date: string; sentence: string }> = [];
    let cursor = startDate;
    for (const sentence of phrases) {
      while (filled.has(cursor)) cursor = addDaysIso(cursor, 1);
      assignments.push({ date: cursor, sentence });
      filled.add(cursor);
      cursor = addDaysIso(cursor, 1);
    }
    if (!dryRun) {
      for (const a of assignments) await upsertPuzzle(a.date, a.sentence);
    }
    res.json({ ok: true, dryRun, assignments });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== WIDGET PARTNERS CRUD =====================
// Реєстрація партнерських сайтів, які встановлюють віджет blukach. Ключ
// показується ОДИН РАЗ на створення — далі тільки sha256 у БД.
router.get('/admin/partners', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    const { listPartners } = await import('../core/partners.js');
    res.json({ partners: await listPartners() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'internal' });
  }
});

// Статистика партнерів за період [from, to). За замовчуванням — останні 30 днів.
router.get('/admin/partners/stats', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = String(req.query.from || defaultFrom.toISOString());
  const to = String(req.query.to || now.toISOString());
  try {
    const { getPartnerStats } = await import('../core/partners.js');
    res.json({ stats: await getPartnerStats(from, to), from, to });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'internal' });
  }
});

router.post('/admin/partners', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { partnerId, name, nicknamePrefix, allowedOrigins, customization } = req.body || {};
  if (!partnerId || !name || !nicknamePrefix) {
    return res.status(400).json({ error: 'partnerId, name, nicknamePrefix required' });
  }
  if (!/^[a-z0-9-]{2,40}$/.test(partnerId)) {
    return res.status(400).json({ error: 'partnerId: lowercase letters, digits, hyphens, 2-40 chars' });
  }
  const origins = Array.isArray(allowedOrigins) ? allowedOrigins.map(String).filter(Boolean) : [];
  try {
    const { createPartner } = await import('../core/partners.js');
    const result = await createPartner({ partnerId, name, nicknamePrefix, allowedOrigins: origins, customization });
    res.json({ partner: result.partner, apiKey: result.apiKey });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'internal' });
  }
});

router.patch('/admin/partners/:id', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  const { name, nicknamePrefix, allowedOrigins, active, customization } = req.body || {};
  try {
    const { updatePartner } = await import('../core/partners.js');
    await updatePartner(req.params.id, {
      name,
      nicknamePrefix,
      allowedOrigins,
      active,
      customization,
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'internal' });
  }
});

router.delete('/admin/partners/:id', async (req, res) => {
  if (!requireAdminSecret(req, res)) return;
  try {
    const { deletePartner } = await import('../core/partners.js');
    await deletePartner(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'internal' });
  }
});

export default router;
