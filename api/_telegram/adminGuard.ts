// Єдина точка авторизації для всіх /api/telegram/admin/*.
//
// Раніше кожен хендлер сам викликав requireAdminSecret() — і один (/admin/health)
// це зробити забули. Тепер guard стоїть один раз через router.use('/admin', ...),
// а права резолвляться по таблиці ADMIN_ROUTES. Шлях, якого немає в таблиці,
// відхиляється (fail-closed) — новий ендпоінт неможливо випадково лишити відкритим.
import express from 'express';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import { AdminScope } from '../../src/telegram-bot/adminScopes.js';
import { verifyAdminToken } from '../_core/adminToken.js';
import { Admin, ENV_ADMIN_ID, loadAdmin } from '../_core/admins.js';

// Хто виконує запит. Для env-адміна рядка в БД немає — звідси окремий тип.
export interface AdminIdentity {
  id: string;
  login: string;
  displayName: string;
  isSuper: boolean;
  scopes: AdminScope[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminIdentity;
    }
  }
}

// Шляхи ВІДНОСНО /admin (router.use зрізає префікс).
// Порожній масив скоупів = достатньо валідного токена (будь-який модератор).
const ADMIN_ROUTES: Array<[RegExp, AdminScope[]]> = [
  [/^\/me$/, []],

  // Налаштування / діагностика / webhook
  [/^\/(health|check-db|check-chat|recent-groups|test-announce|ping-chat|meta|set-webhook|webhook-info|delete-webhook)$/, ['setup']],

  // Питання (ProcessDescriptionView теж читає перелік питань)
  [/^\/save-questions$/, ['questions']],
  [/^\/questions$/, ['questions', 'process']],

  // Підготовка справ
  [/^\/(upload-case|upload-verif-case|detect-bboxes)$/, ['cases']],
  [/^\/description-settings$/, ['cases', 'process']],
  [/^\/verif-descriptions$/, ['cases', 'process']],
  [/^\/descriptions$/, ['process']],

  // Результати / експорт опису
  [/^\/results$/, ['results']],
  [/^\/(submissions-by-description|verif-submissions-by-description)$/, ['results', 'process']],
  [/^\/recompute-case$/, ['results']],
  [/^\/fund-eta$/, ['results']],

  // Огляд
  [/^\/(overview|today-stats)$/, ['overview', 'results']],
  [/^\/monthly$/, ['overview']],
  // Картку користувача відкривають і з «Огляду», і з «Доброчесності»;
  // аватарки ще й на сцені стендапу.
  [/^\/user-(profile|photo)\/[^/]+$/, ['overview', 'integrity', 'quiz']],
  [/^\/grant-bonus$/, ['overview', 'integrity']],

  // Графік
  [/^\/daily-activity$/, ['chart']],

  // Доброчесність
  [/^\/(integrity|penalize|banned-users)$/, ['integrity']],
  [/^\/integrity\/(dismiss|reopen|ban|unban)$/, ['integrity']],

  // Партнери / Пазл / Розсилки
  [/^\/partners(\/[^/]+)?$/, ['partners']],
  [/^\/puzzles?(\/[^/]+)?$/, ['puzzle']],
  [/^\/broadcasts?(\/[^/]+)?(\/(drain|cancel))?$/, ['broadcast']],

  // Шоу
  [/^\/(quiz|standup)\/[^/]+$/, ['quiz']],

  // Модератори
  [/^\/admins(\/[^/]+)?(\/reset-password)?$/, ['admins']],
];

export function resolveRequiredScopes(path: string): AdminScope[] | null {
  for (const [re, scopes] of ADMIN_ROUTES) {
    if (re.test(path)) return scopes;
  }
  return null;
}

// Токен приймається як Bearer або як ?token= — другий варіант потрібен для
// <img src="/admin/user-photo/...">, куди заголовок не підставиш.
function extractToken(req: express.Request): string {
  const m = /^Bearer\s+(.+)$/.exec(req.header('Authorization') || '');
  if (m) return m[1].trim();
  const q = req.query.token;
  return typeof q === 'string' ? q : '';
}

export function identityFromAdmin(a: Admin): AdminIdentity {
  return {
    id: a.id,
    login: a.login,
    displayName: a.displayName,
    isSuper: a.isSuper,
    scopes: a.scopes,
  };
}

export function envAdminIdentity(login: string): AdminIdentity {
  return { id: ENV_ADMIN_ID, login, displayName: login, isSuper: true, scopes: [] };
}

export const adminGuard: express.RequestHandler = async (req, res, next) => {
  // Єдиний публічний ендпоінт — сам логін.
  if (req.path === '/login') return next();

  if (!process.env.ADMIN_SESSION_SECRET) {
    return res.status(500).json({ error: 'Server missing ADMIN_SESSION_SECRET' });
  }

  const token = extractToken(req);
  const payload = token ? verifyAdminToken(token) : null;
  // 401 (а не 403) — клієнт розуміє це як «сесія скінчилась, перелогінься».
  if (!payload) return res.status(401).json({ error: 'unauthorized' });

  let identity: AdminIdentity;
  if (payload.aid === ENV_ADMIN_ID) {
    // Аварійний вхід з env: дійсний, лише поки env-логін збігається з тим,
    // що зашито в токен (зміна TELEGRAM_ADMIN_LOGIN розлогінює).
    if (payload.login !== process.env[telegramBotConfig.adminLoginEnv]) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    identity = envAdminIdentity(payload.login);
  } else {
    let admin: Admin | null;
    try {
      admin = await loadAdmin(payload.aid);
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || 'internal' });
    }
    // token_epoch змінюється при редагуванні прав/пароля — видані токени миттєво мертві.
    if (!admin || !admin.active || admin.tokenEpoch !== payload.ep) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    identity = identityFromAdmin(admin);
  }

  const required = resolveRequiredScopes(req.path);
  if (required === null) {
    console.warn('[adminGuard] no scope rule for', req.path);
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!identity.isSuper && required.length > 0 && !required.some(s => identity.scopes.includes(s))) {
    return res.status(403).json({ error: 'forbidden' });
  }

  req.admin = identity;
  next();
};
