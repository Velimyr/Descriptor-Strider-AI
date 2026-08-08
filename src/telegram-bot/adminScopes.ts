// Скоупи доступу до адмінки. Один скоуп = одна вкладка.
// Джерело правди і для бекенда (adminGuard в api/_telegram/index.ts), і для
// фронта (фільтр вкладок у TelegramAdminTab.tsx, чекбокси в AdminsView.tsx).
//
// Лежить у src/telegram-bot/ поряд із config.ts, бо api/ вже імпортує звідси
// (див. telegramBotConfig) — так список не роздвоюється.

export const ADMIN_SCOPES = [
  'setup',
  'questions',
  'cases',
  'results',
  'process',
  'overview',
  'chart',
  'integrity',
  'partners',
  'puzzle',
  'broadcast',
  'quiz',
  'admins',
] as const;

export type AdminScope = typeof ADMIN_SCOPES[number];

// Підписи для UI (список прав у вкладці «Модератори» і назви вкладок).
export const ADMIN_SCOPE_LABELS: Record<AdminScope, string> = {
  setup: 'Налаштування',
  questions: 'Питання',
  cases: 'Підготовка справ',
  results: 'Результати',
  process: 'Експортувати опис',
  overview: 'Огляд',
  chart: 'Графік',
  integrity: 'Перевірка доброчесності',
  partners: 'Партнери',
  puzzle: 'Пазл',
  broadcast: 'Розсилки',
  quiz: 'Шоу (вікторина + стендап)',
  admins: 'Модератори',
};

export function isAdminScope(s: unknown): s is AdminScope {
  return typeof s === 'string' && (ADMIN_SCOPES as readonly string[]).includes(s);
}

// Відкидає невідомі значення й дублікати — використовується при збереженні прав.
export function sanitizeScopes(raw: unknown): AdminScope[] {
  if (!Array.isArray(raw)) return [];
  return ADMIN_SCOPES.filter(s => raw.includes(s));
}
