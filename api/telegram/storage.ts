// Сховище стану бота — Postgres через Supabase. Один файл, інтерфейс зберігається.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

let cachedClient: SupabaseClient | null = null;

// Префікс імен таблиць/RPC. Дефолт 'bot_' — прод-поведінка без env-у.
// Для staging-контуру задається TABLE_PREFIX=botdev_ (окремий набір таблиць у тій самій БД).
const PREFIX = process.env.TABLE_PREFIX ?? 'bot_';
export const T = {
  users:             `${PREFIX}users`,
  cases:             `${PREFIX}cases`,
  sessions:          `${PREFIX}sessions`,
  meta:              `${PREFIX}meta`,
  submissions:       `${PREFIX}submissions`,
  daily:             `${PREFIX}daily_scores`,
  skipped:           `${PREFIX}skipped`,
  caseConfirmations: `${PREFIX}case_confirmations`,
  integrityReviews:  `${PREFIX}integrity_reviews`,
  partners:          `${PREFIX}partners`,
  linkCodes:         `${PREFIX}link_codes`,
  userBadges:        `${PREFIX}user_badges`,
  puzzles:           `${PREFIX}puzzles`,
  puzzleProgress:    `${PREFIX}puzzle_progress`,
  puzzleWinners:     `${PREFIX}puzzle_winners`,
};
const RPC_INC_DAILY = `${PREFIX}inc_daily`;
const RPC_DESCRIPTION_PROGRESS = `${PREFIX}description_progress`;
const RPC_CANDIDATE_CASES = `${PREFIX}candidate_cases`;
const RPC_AWARD_PUZZLE_WINNER = `${PREFIX}award_puzzle_winner`;

export function db(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env[telegramBotConfig.supabase.urlEnv];
  const key = process.env[telegramBotConfig.supabase.serviceKeyEnv];
  if (!url || !key) {
    throw new Error(
      `Missing env ${telegramBotConfig.supabase.urlEnv} / ${telegramBotConfig.supabase.serviceKeyEnv}`
    );
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

// rowIndex більше не потрібен (PK = tg_id / case_id), але лишаємо у типі
// для backward-compat з bot.ts, який передає його як другий аргумент upsertUser/setSession.
export interface BotUser {
  rowIndex: number; // legacy, не використовується
  tgId: string;
  displayName: string;
  totalPoints: number;
  lastDispatchedCaseId: string;
  lastDispatchedAt: string;
  consecutiveMisses: number;
  status: 'active' | 'paused';
  pendingAction: '' | 'rename';
  createdAt: string;
  introShownAt: string; // ISO або '' якщо ще не показували
  // Час "засіву" бейджів. '' (NULL у БД) = ще не засівали: на першій перевірці
  // вже зароблені бейджі видаються тихо. Новим юзерам ставимо при /start.
  badgesSeededAt: string;
  // Web-юзери: source='web', partnerId=<id>. Для TG — source='tg', partnerId=null.
  // Колонки додані міграцією schema-widget-*.sql.
  source: 'tg' | 'web';
  partnerId: string | null;
}

export interface BotCase {
  rowIndex: number;
  caseId: string;
  tgFileId: string;
  tgChatId: string;
  tgMessageId: string;
  sourcePdf: string;
  page: string;
  bbox: string;
  archive: string;
  fund: string;
  opys: string;
  sprava: string;
  submissionsCount: number;
  status: 'open' | 'done';
  createdAt: string;
  // Collab-режим (опціонально, для нових справ).
  mode: 'parallel' | 'collaborative';
  currentAnswers: string[];
  currentAuthorTgId: string;
  confirmationsCount: number;
  lockedByTgId: string;
  lockedUntil: string; // ISO або '' якщо не лочена
  updatedAt: string;   // оновлюється при collab-подіях
}

export interface BotSession {
  rowIndex: number;
  tgId: string;
  caseId: string;
  answersJson: string;
  currentQ: number;
  startedAt: string;
  updatedAt: string;
  state: 'asking' | 'confirming' | 'editing' | 'previewing';
}

// Маперивчасть тут — нижче є мапери row → доменна модель.
function mapUser(r: any): BotUser {
  return {
    rowIndex: 0,
    tgId: r.tg_id,
    displayName: r.display_name || '',
    totalPoints: Number(r.total_points || 0),
    lastDispatchedCaseId: r.last_dispatched_case_id || '',
    lastDispatchedAt: r.last_dispatched_at || '',
    consecutiveMisses: r.consecutive_misses || 0,
    status: (r.status || 'active') as 'active' | 'paused',
    pendingAction: (r.pending_action || '') as '' | 'rename',
    createdAt: r.created_at || '',
    introShownAt: r.intro_shown_at || '',
    badgesSeededAt: r.badges_seeded_at || '',
    source: (r.source || 'tg') as 'tg' | 'web',
    partnerId: r.partner_id || null,
  };
}

function mapCase(r: any): BotCase {
  const ca = r.current_answers;
  return {
    rowIndex: 0,
    caseId: r.case_id,
    tgFileId: r.tg_file_id || '',
    tgChatId: r.tg_chat_id || '',
    tgMessageId: r.tg_message_id || '',
    sourcePdf: r.source_pdf || '',
    page: r.page || '',
    bbox: r.bbox || '',
    archive: r.archive || '',
    fund: r.fund || '',
    opys: r.opys || '',
    sprava: r.sprava || '',
    submissionsCount: r.submissions_count || 0,
    status: (r.status || 'open') as 'open' | 'done',
    createdAt: r.created_at || '',
    mode: (r.mode || 'parallel') as 'parallel' | 'collaborative',
    currentAnswers: Array.isArray(ca) ? ca.map(String) : [],
    currentAuthorTgId: r.current_author_tg_id || '',
    confirmationsCount: r.confirmations_count || 0,
    lockedByTgId: r.locked_by_tg_id || '',
    lockedUntil: r.locked_until || '',
    updatedAt: r.updated_at || r.created_at || '',
  };
}

function mapSession(r: any): BotSession {
  return {
    rowIndex: 0,
    tgId: r.tg_id,
    caseId: r.case_id || '',
    answersJson: r.answers_json || '[]',
    currentQ: r.current_q || 0,
    startedAt: r.started_at || '',
    updatedAt: r.updated_at || '',
    state: (r.state || 'asking') as 'asking' | 'confirming' | 'editing' | 'previewing',
  };
}

// ---------- META (з кешем) ----------
const metaCache = new Map<string, { value: string; expires: number }>();
const META_TTL_MS = 60 * 1000;

export function invalidateMetaCache(key?: string) {
  if (key) metaCache.delete(key);
  else metaCache.clear();
}

export async function getMeta(key: string): Promise<string | null> {
  const cached = metaCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value || null;

  const { data, error } = await db().from(T.meta).select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  const value = data?.value ?? '';
  metaCache.set(key, { value, expires: Date.now() + META_TTL_MS });
  return value || null;
}

export async function setMeta(key: string, value: string) {
  metaCache.set(key, { value, expires: Date.now() + META_TTL_MS });
  const { error } = await db().from(T.meta).upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

// ---------- USERS ----------
export async function getAllUsers(): Promise<BotUser[]> {
  // Пагінація — Supabase за замовчуванням обмежує 1000 рядками.
  const pageSize = 1000;
  let from = 0;
  const out: BotUser[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.users)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows.map(mapUser));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export async function getUser(tgId: string): Promise<BotUser | null> {
  const { data, error } = await db().from(T.users).select('*').eq('tg_id', tgId).maybeSingle();
  if (error) throw error;
  return data ? mapUser(data) : null;
}

export async function upsertUser(
  u: Omit<BotUser, 'rowIndex'>,
  _existingRowIndex?: number // legacy, ігнорується
): Promise<void> {
  const { error } = await db()
    .from(T.users)
    .upsert(
      {
        tg_id: u.tgId,
        display_name: u.displayName,
        total_points: u.totalPoints,
        last_dispatched_case_id: u.lastDispatchedCaseId,
        last_dispatched_at: u.lastDispatchedAt || null,
        consecutive_misses: u.consecutiveMisses,
        status: u.status,
        pending_action: u.pendingAction || '',
        intro_shown_at: u.introShownAt || null,
        badges_seeded_at: u.badgesSeededAt || null,
        // created_at — не оновлюємо при апдейті, але дамо при insert
        ...(u.createdAt ? { created_at: u.createdAt } : {}),
      },
      { onConflict: 'tg_id' }
    );
  if (error) throw error;
}

// Створює нового web-юзера (source='web'). tg_id має бути префіксований "web:".
// nickname має бути унікальним по партнеру — викликач сам гарантує (через retry на collision).
// Конфлікт на (display_name) усередині партнерського неймспейсу не валідується тут на рівні БД,
// бо display_name унікальний глобально в існуючому коді — для web це OK через високоентропійні суфікси.
export async function createWebUser(input: {
  tgId: string;
  displayName: string;
  partnerId: string;
}): Promise<BotUser> {
  const { data, error } = await db()
    .from(T.users)
    .insert({
      tg_id: input.tgId,
      display_name: input.displayName,
      total_points: 0,
      last_dispatched_case_id: '',
      consecutive_misses: 0,
      status: 'active',
      pending_action: '',
      source: 'web',
      partner_id: input.partnerId,
    })
    .select()
    .single();
  if (error) throw error;
  return mapUser(data);
}

// Перевірка існування юзера за nickname (для гарантії унікальності web-нікнеймів).
export async function userExistsByDisplayName(displayName: string): Promise<boolean> {
  const { data, error } = await db()
    .from(T.users)
    .select('tg_id')
    .eq('display_name', displayName)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function patchUser(tgId: string, patch: Partial<Omit<BotUser, 'rowIndex' | 'tgId'>>) {
  const dbPatch: any = {};
  if (patch.displayName !== undefined) dbPatch.display_name = patch.displayName;
  if (patch.totalPoints !== undefined) dbPatch.total_points = patch.totalPoints;
  if (patch.lastDispatchedCaseId !== undefined) dbPatch.last_dispatched_case_id = patch.lastDispatchedCaseId;
  if (patch.lastDispatchedAt !== undefined) dbPatch.last_dispatched_at = patch.lastDispatchedAt || null;
  if (patch.consecutiveMisses !== undefined) dbPatch.consecutive_misses = patch.consecutiveMisses;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.pendingAction !== undefined) dbPatch.pending_action = patch.pendingAction;
  if (patch.introShownAt !== undefined) dbPatch.intro_shown_at = patch.introShownAt || null;
  if (patch.badgesSeededAt !== undefined) dbPatch.badges_seeded_at = patch.badgesSeededAt || null;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await db().from(T.users).update(dbPatch).eq('tg_id', tgId);
  if (error) throw error;
}

// ---------- CASES ----------
export async function getAllCases(): Promise<BotCase[]> {
  // Пагінація — Supabase за замовчуванням обмежує 1000 рядками.
  const pageSize = 1000;
  let from = 0;
  const out: BotCase[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.cases)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows.map(mapCase));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export async function getCase(caseId: string): Promise<BotCase | null> {
  const { data, error } = await db().from(T.cases).select('*').eq('case_id', caseId).maybeSingle();
  if (error) throw error;
  return data ? mapCase(data) : null;
}

export async function appendCases(items: Omit<BotCase, 'rowIndex'>[]) {
  if (items.length === 0) return;
  const { error } = await db().from(T.cases).insert(
    items.map(c => ({
      case_id: c.caseId,
      tg_file_id: c.tgFileId,
      tg_chat_id: c.tgChatId,
      tg_message_id: c.tgMessageId,
      source_pdf: c.sourcePdf,
      page: c.page,
      bbox: c.bbox,
      archive: c.archive,
      fund: c.fund,
      opys: c.opys,
      sprava: c.sprava,
      submissions_count: c.submissionsCount,
      status: c.status,
      mode: c.mode || 'parallel',
      ...(c.createdAt ? { created_at: c.createdAt } : {}),
    }))
  );
  if (error) throw error;
}

export async function patchCase(caseId: string, patch: Partial<Omit<BotCase, 'rowIndex' | 'caseId'>>) {
  const dbPatch: any = {};
  if (patch.tgFileId !== undefined) dbPatch.tg_file_id = patch.tgFileId;
  if (patch.tgChatId !== undefined) dbPatch.tg_chat_id = patch.tgChatId;
  if (patch.tgMessageId !== undefined) dbPatch.tg_message_id = patch.tgMessageId;
  if (patch.sourcePdf !== undefined) dbPatch.source_pdf = patch.sourcePdf;
  if (patch.page !== undefined) dbPatch.page = patch.page;
  if (patch.bbox !== undefined) dbPatch.bbox = patch.bbox;
  if (patch.submissionsCount !== undefined) dbPatch.submissions_count = patch.submissionsCount;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await db().from(T.cases).update(dbPatch).eq('case_id', caseId);
  if (error) throw error;
}

// ---------- SESSIONS ----------
export async function getSession(tgId: string): Promise<BotSession | null> {
  const { data, error } = await db().from(T.sessions).select('*').eq('tg_id', tgId).maybeSingle();
  if (error) throw error;
  return data ? mapSession(data) : null;
}

export async function setSession(s: Omit<BotSession, 'rowIndex'>, _existingRowIndex?: number) {
  const { error } = await db()
    .from(T.sessions)
    .upsert(
      {
        tg_id: s.tgId,
        case_id: s.caseId,
        answers_json: s.answersJson,
        current_q: s.currentQ,
        started_at: s.startedAt || new Date().toISOString(),
        updated_at: s.updatedAt || new Date().toISOString(),
        state: s.state,
      },
      { onConflict: 'tg_id' }
    );
  if (error) throw error;
}

export async function deleteSession(tgId: string): Promise<boolean> {
  const { error, count } = await db()
    .from(T.sessions)
    .delete({ count: 'exact' })
    .eq('tg_id', tgId);
  if (error) throw error;
  return (count || 0) > 0;
}

export async function getAllSessions(): Promise<BotSession[]> {
  const { data, error } = await db().from(T.sessions).select('*');
  if (error) throw error;
  return (data || []).map(mapSession);
}

// ---------- DAILY SCORES ----------
export async function incDailyCount(tgId: string, dateKyiv: string): Promise<number> {
  const { data, error } = await db().rpc(RPC_INC_DAILY, { p_tg_id: tgId, p_date: dateKyiv });
  if (error) throw error;
  return Number(data || 0);
}

export async function getDailyCount(tgId: string, dateKyiv: string): Promise<number> {
  const { data, error } = await db()
    .from(T.daily)
    .select('count')
    .eq('tg_id', tgId)
    .eq('date_kyiv', dateKyiv)
    .maybeSingle();
  if (error) throw error;
  return data?.count || 0;
}

// ---------- SUBMISSIONS (Results) ----------
export interface SubmissionInput {
  caseId: string;
  tgId: string;
  displayName: string;
  answers: string[];
  sourceLink: string;
  archive: string;
  fund: string;
  opys: string;
  sprava: string;
  sourcePdf: string;
  page: string;
  // Атрибуція до партнера (для web-юзерів). NULL для TG. Денормалізовано
  // щоб атрибуція не губилась після /link і не залежала від bot_users.
  partnerId?: string | null;
}

export async function appendSubmission(s: SubmissionInput) {
  const { error } = await db().from(T.submissions).insert({
    case_id: s.caseId,
    tg_id: s.tgId,
    display_name: s.displayName,
    answers: s.answers,
    source_link: s.sourceLink,
    archive: s.archive,
    fund: s.fund,
    opys: s.opys,
    sprava: s.sprava,
    source_pdf: s.sourcePdf,
    page: s.page,
    partner_id: s.partnerId || null,
  });
  if (error) throw error;
}

export async function countSubmissionsByCase(caseId: string): Promise<number> {
  const { count, error } = await db()
    .from(T.submissions)
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId);
  if (error) throw error;
  return count || 0;
}

export async function getSubmissionsForUser(tgId: string): Promise<string[]> {
  const { data, error } = await db().from(T.submissions).select('case_id').eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => r.case_id);
}

// ---------- SKIPPED CASES ----------
export async function recordSkippedCase(tgId: string, caseId: string): Promise<void> {
  if (!caseId) return;
  const { error } = await db()
    .from(T.skipped)
    .upsert({ tg_id: tgId, case_id: caseId }, { onConflict: 'tg_id,case_id' });
  if (error) throw error;
}

export async function getSkippedForUser(tgId: string): Promise<string[]> {
  const { data, error } = await db().from(T.skipped).select('case_id').eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => r.case_id);
}

// Активність "сьогодні" у Europe/Kyiv: скільки унікальних справ опрацьовано
// (через submissions АБО collab-події) і скільки унікальних користувачів брало
// участь. Вибірка йде з БД незалежно від ліміту таблиці результатів.
export async function getTodayActivity(timeZone: string): Promise<{ cases: number; users: number }> {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const tzName = tzParts.find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const sign = m?.[1] === '-' ? -1 : 1;
  const hh = parseInt(m?.[2] || '0', 10);
  const mm = parseInt(m?.[3] || '0', 10);
  const offsetMin = sign * (hh * 60 + mm);
  const startUtcMs = Date.parse(`${dateStr}T00:00:00.000Z`) - offsetMin * 60_000;
  const startUtc = new Date(startUtcMs).toISOString();
  const endUtc = new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString();

  const caseIds = new Set<string>();
  const userIds = new Set<string>();
  const pageSize = 1000;

  // 1) parallel: bot_submissions
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from(T.submissions)
      .select('case_id, tg_id')
      .gte('submitted_at', startUtc)
      .lt('submitted_at', endUtc)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      if ((r as any).case_id) caseIds.add(String((r as any).case_id));
      if ((r as any).tg_id) userIds.add(String((r as any).tg_id));
    }
    if (rows.length < pageSize) break;
  }

  // 2) collab: bot_case_confirmations (create/edit/confirm — будь-яка дія = участь)
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from(T.caseConfirmations)
      .select('case_id, tg_id')
      .gte('at', startUtc)
      .lt('at', endUtc)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      if ((r as any).case_id) caseIds.add(String((r as any).case_id));
      if ((r as any).tg_id) userIds.add(String((r as any).tg_id));
    }
    if (rows.length < pageSize) break;
  }

  return { cases: caseIds.size, users: userIds.size };
}

// Активність за останні N днів у переданій таймзоні.
// Кожен день — кількість унікальних опрацьованих справ та унікальних користувачів,
// що брали участь (parallel-сабміти + collab-події).
export async function getDailyActivity(
  timeZone: string,
  days: number
): Promise<Array<{ date: string; cases: number; users: number }>> {
  if (days <= 0) return [];
  const safeDays = Math.min(days, 365);
  const now = new Date();
  const fmtDay = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const tzName = tzParts.find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const sign = m?.[1] === '-' ? -1 : 1;
  const hh = parseInt(m?.[2] || '0', 10);
  const mm = parseInt(m?.[3] || '0', 10);
  const offsetMin = sign * (hh * 60 + mm);

  const todayStr = fmtDay.format(now);
  const todayMidnightUtcMs = Date.parse(`${todayStr}T00:00:00.000Z`) - offsetMin * 60_000;
  const startUtcMs = todayMidnightUtcMs - (safeDays - 1) * 86_400_000;
  const endUtcMs = todayMidnightUtcMs + 86_400_000;
  const startUtc = new Date(startUtcMs).toISOString();
  const endUtc = new Date(endUtcMs).toISOString();

  const buckets = new Map<string, { cases: Set<string>; users: Set<string> }>();
  for (let i = 0; i < safeDays; i++) {
    const d = new Date(startUtcMs + i * 86_400_000 + 12 * 3600_000); // полудень дня — щоб TZ-форматування не плутало
    const key = fmtDay.format(d);
    buckets.set(key, { cases: new Set(), users: new Set() });
  }

  const ingest = async (
    table: string,
    timeCol: string,
    extra: (r: any) => { caseId: string; tgId: string; ts: string }
  ) => {
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db()
        .from(table)
        .select(`case_id, tg_id, ${timeCol}`)
        .gte(timeCol, startUtc)
        .lt(timeCol, endUtc)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = data || [];
      for (const r of rows) {
        const { caseId, tgId, ts } = extra(r);
        if (!ts) continue;
        const day = fmtDay.format(new Date(ts));
        const bucket = buckets.get(day);
        if (!bucket) continue;
        if (caseId) bucket.cases.add(caseId);
        if (tgId) bucket.users.add(tgId);
      }
      if (rows.length < pageSize) break;
    }
  };

  await ingest(T.submissions, 'submitted_at', (r: any) => ({
    caseId: String(r.case_id || ''),
    tgId: String(r.tg_id || ''),
    ts: r.submitted_at,
  }));
  await ingest(T.caseConfirmations, 'at', (r: any) => ({
    caseId: String(r.case_id || ''),
    tgId: String(r.tg_id || ''),
    ts: r.at,
  }));

  const out: Array<{ date: string; cases: number; users: number }> = [];
  for (const [date, b] of buckets) {
    out.push({ date, cases: b.cases.size, users: b.users.size });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export async function getResultsTotals(): Promise<{ totalSubmissions: number }> {
  const { count, error } = await db()
    .from(T.submissions)
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return { totalSubmissions: count || 0 };
}

// Усі підтвердження для конкретного опису (без ліміту, посторінково).
// Supabase/PostgREST за замовчанням має обмеження ~1000 рядків на запит — обходимо range-pагінацією.
export async function getSubmissionsByDescription(
  archive: string,
  fund: string,
  opys: string
) {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.submissions)
      .select('*')
      .eq('archive', archive)
      .eq('fund', fund)
      .eq('opys', opys)
      .order('submitted_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Усі submissions для аналізу доброчесності (повна пагінація).
// Сортуємо за case_id + submitted_at, щоб у коді легко групувати.
export async function getAllSubmissionsOrdered(): Promise<any[]> {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.submissions)
      .select('case_id, tg_id, display_name, answers, submitted_at, archive, fund, opys')
      .order('case_id', { ascending: true })
      .order('submitted_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Експортуємо submissions для адмінського перегляду / експорту.
export async function getRecentSubmissions(limit = 100) {
  const { data, error } = await db()
    .from(T.submissions)
    .select('*')
    .order('submitted_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ---------- COLLABORATIVE MODE ----------
// Видача справи юзеру: лочимо на lockMinutes хвилин.
export async function lockCase(caseId: string, tgId: string, lockMinutes: number): Promise<void> {
  const until = new Date(Date.now() + lockMinutes * 60_000).toISOString();
  const { error } = await db()
    .from(T.cases)
    .update({ locked_by_tg_id: tgId, locked_until: until })
    .eq('case_id', caseId);
  if (error) throw error;
}

// Зняти блокування (юзер завершив дію або відмовився).
export async function unlockCase(caseId: string): Promise<void> {
  const { error } = await db()
    .from(T.cases)
    .update({ locked_by_tg_id: '', locked_until: null })
    .eq('case_id', caseId);
  if (error) throw error;
}

// Записати участь юзера у справі. UNIQUE (case_id, tg_id) — якщо є, просто апдейт kind/at.
// answers — снапшот відповідей у момент події (потрібен для перевірки доброчесності).
export async function recordCaseEvent(
  caseId: string,
  tgId: string,
  kind: 'create' | 'edit' | 'confirm',
  answers: string[] = [],
  partnerId?: string | null
): Promise<void> {
  const { error } = await db()
    .from(T.caseConfirmations)
    .upsert(
      {
        case_id: caseId,
        tg_id: tgId,
        kind,
        at: new Date().toISOString(),
        answers,
        partner_id: partnerId || null,
      },
      { onConflict: 'case_id,tg_id' }
    );
  if (error) throw error;
}

// Список case_id, до яких юзер уже доторкався (для виключення з dispatch).
export async function getTouchedCaseIds(tgId: string): Promise<string[]> {
  const { data, error } = await db()
    .from(T.caseConfirmations)
    .select('case_id')
    .eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => r.case_id);
}

// Остання дія юзера у collab (для чергування create/review при наступному dispatch).
export async function getLastUserCaseKind(
  tgId: string
): Promise<'create' | 'edit' | 'confirm' | null> {
  const { data, error } = await db()
    .from(T.caseConfirmations)
    .select('kind, at')
    .eq('tg_id', tgId)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return ((data as any)?.kind as any) || null;
}

// Чи юзер уже брав участь у цій справі.
export async function hasUserTouchedCase(caseId: string, tgId: string): Promise<boolean> {
  const { data, error } = await db()
    .from(T.caseConfirmations)
    .select('case_id')
    .eq('case_id', caseId)
    .eq('tg_id', tgId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Зберегти ПЕРШУ версію (creation): встановити current_answers, current_author, count = 1.
export async function setCaseCreated(
  caseId: string,
  authorTgId: string,
  answers: string[]
): Promise<void> {
  const { error } = await db()
    .from(T.cases)
    .update({
      current_answers: answers,
      current_author_tg_id: authorTgId,
      confirmations_count: 1,
      locked_by_tg_id: '',
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('case_id', caseId);
  if (error) throw error;
}

// Edit: замінити відповіді, скинути лічильник до 1 (редактор неявно підтверджує).
// bot_case_confirmations НЕ чистимо (попередні юзери не отримають справу повторно).
export async function setCaseEdited(
  caseId: string,
  editorTgId: string,
  answers: string[]
): Promise<void> {
  const { error } = await db()
    .from(T.cases)
    .update({
      current_answers: answers,
      current_author_tg_id: editorTgId,
      confirmations_count: 1,
      locked_by_tg_id: '',
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('case_id', caseId);
  if (error) throw error;
}

// Підтвердження: атомарно інкрементує лічильник, повертає нове значення.
// Закриває справу, якщо досягнуто minConfirmations.
export async function confirmCase(
  caseId: string,
  minConfirmations: number
): Promise<{ count: number; closed: boolean }> {
  // Читаємо поточне значення, рахуємо, апдейтимо. Коротка race-window прийнятна
  // для швидкості бота — справу все одно тримає лок.
  const cur = await getCase(caseId);
  if (!cur) throw new Error(`Case not found: ${caseId}`);
  const next = cur.confirmationsCount + 1;
  const closed = next >= minConfirmations;
  const { error } = await db()
    .from(T.cases)
    .update({
      confirmations_count: next,
      locked_by_tg_id: '',
      locked_until: null,
      updated_at: new Date().toISOString(),
      ...(closed ? { status: 'done' } : {}),
    })
    .eq('case_id', caseId);
  if (error) throw error;
  return { count: next, closed };
}

// Усі collab-справи в межах опису (для експорту як "віртуальні submissions").
export async function getCollabCasesByDescription(
  archive: string,
  fund: string,
  opys: string
): Promise<BotCase[]> {
  const pageSize = 1000;
  let from = 0;
  const out: BotCase[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.cases)
      .select('*')
      .eq('archive', archive)
      .eq('fund', fund)
      .eq('opys', opys)
      .eq('mode', 'collaborative')
      .order('updated_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows.map(mapCase));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Останні collab-справи по даті створення (для глобального overview).
export async function getRecentCollabCases(limit = 100): Promise<BotCase[]> {
  const { data, error } = await db()
    .from(T.cases)
    .select('*')
    .eq('mode', 'collaborative')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapCase);
}

// Map tg_id → display_name. Для денормалізації collab-справ при експорті.
export async function getDisplayNamesMap(tgIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(tgIds.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await db().from(T.users).select('tg_id, display_name').in('tg_id', unique);
  if (error) throw error;
  const m: Record<string, string> = {};
  for (const r of data || []) m[(r as any).tg_id] = (r as any).display_name || '';
  return m;
}

// Серверна агрегація прогресу по описах. Один SQL замість тягнути всі справи в код.
export async function getDescriptionProgressViaRpc(target: number): Promise<
  Array<{
    archive: string;
    fund: string;
    opys: string;
    earliestCreatedAt: string;
    totalCases: number;
    doneCases: number;
    cappedSum: number;
  }>
> {
  const { data, error } = await db().rpc(RPC_DESCRIPTION_PROGRESS, { p_target: target });
  if (error) throw error;
  return ((data as any[]) || []).map(r => ({
    archive: r.archive || '',
    fund: r.fund || '',
    opys: r.opys || '',
    earliestCreatedAt: r.earliest_created_at || '',
    totalCases: Number(r.total_cases || 0),
    doneCases: Number(r.done_cases || 0),
    cappedSum: Number(r.capped_sum || 0),
  }));
}

// Кандидати для dispatch для конкретного юзера (виключає вже опрацьовані).
// Виконує всі фільтри в SQL — масштабується незалежно від розміру bot_cases.
export async function getCandidateCasesForUser(tgId: string): Promise<BotCase[]> {
  const { data, error } = await db().rpc(RPC_CANDIDATE_CASES, { p_tg_id: tgId });
  if (error) throw error;
  return ((data as any[]) || []).map(mapCase);
}

// Усі рядки confirmations для заданого набору case_id (для адмін-перегляду).
export async function getConfirmationsForCases(
  caseIds: string[]
): Promise<Array<{ caseId: string; tgId: string; kind: 'create' | 'edit' | 'confirm'; at: string; answers: string[] }>> {
  if (caseIds.length === 0) return [];
  // Пагінуємо на випадок великого опису.
  const out: Array<{ caseId: string; tgId: string; kind: any; at: string; answers: string[] }> = [];
  const chunkSize = 500;
  for (let i = 0; i < caseIds.length; i += chunkSize) {
    const chunk = caseIds.slice(i, i + chunkSize);
    const { data, error } = await db()
      .from(T.caseConfirmations)
      .select('case_id, tg_id, kind, at, answers')
      .in('case_id', chunk);
    if (error) throw error;
    for (const r of data || []) {
      const ans = (r as any).answers;
      out.push({
        caseId: (r as any).case_id,
        tgId: (r as any).tg_id,
        kind: (r as any).kind,
        at: (r as any).at,
        answers: Array.isArray(ans) ? ans.map(String) : [],
      });
    }
  }
  return out;
}

// Усі collab-події з відповідями (для інтегриті-перевірки).
export async function getAllConfirmationsWithAnswers(): Promise<
  Array<{ caseId: string; tgId: string; kind: 'create' | 'edit' | 'confirm'; at: string; answers: string[] }>
> {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.caseConfirmations)
      .select('case_id, tg_id, kind, at, answers')
      .order('case_id', { ascending: true })
      .order('at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      const ans = (r as any).answers;
      out.push({
        caseId: (r as any).case_id,
        tgId: (r as any).tg_id,
        kind: (r as any).kind,
        at: (r as any).at,
        answers: Array.isArray(ans) ? ans.map(String) : [],
      });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ---------- INTEGRITY REVIEWS ----------
// Завжди зберігаємо tg_id у відсортованому порядку, щоб (A,B) ↔ (B,A) дали один ключ.
export function integrityPairKey(a: string, b: string): { first: string; second: string } {
  return a < b ? { first: a, second: b } : { first: b, second: a };
}

export async function addIntegrityReview(
  caseId: string,
  tgIdA: string,
  tgIdB: string,
  action: 'penalized' | 'dismissed',
  penalizedTgId?: string
): Promise<void> {
  const { first, second } = integrityPairKey(tgIdA || '', tgIdB || '');
  const { error } = await db()
    .from(T.integrityReviews)
    .upsert(
      {
        case_id: caseId,
        first_tg_id: first,
        second_tg_id: second,
        action,
        penalized_tg_id: penalizedTgId || null,
        at: new Date().toISOString(),
      },
      { onConflict: 'case_id,first_tg_id,second_tg_id' }
    );
  if (error) throw error;
}

export async function getAllIntegrityReviews(): Promise<
  Array<{ caseId: string; firstTgId: string; secondTgId: string; action: string; penalizedTgId: string; at: string }>
> {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.integrityReviews)
      .select('case_id, first_tg_id, second_tg_id, action, penalized_tg_id, at')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      out.push({
        caseId: (r as any).case_id,
        firstTgId: (r as any).first_tg_id || '',
        secondTgId: (r as any).second_tg_id || '',
        action: (r as any).action,
        penalizedTgId: (r as any).penalized_tg_id || '',
        at: (r as any).at,
      });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ---------- BADGES (досягнення) ----------
// Перелік id бейджів, які користувач уже отримав.
export async function getEarnedBadgeIds(tgId: string): Promise<string[]> {
  const { data, error } = await db().from(T.userBadges).select('badge_id').eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => r.badge_id);
}

// Видати бейджі (ідемпотентно: PK (tg_id, badge_id) + ignoreDuplicates).
export async function grantBadges(tgId: string, badgeIds: string[]): Promise<void> {
  if (badgeIds.length === 0) return;
  const rows = badgeIds.map(badge_id => ({ tg_id: tgId, badge_id }));
  const { error } = await db()
    .from(T.userBadges)
    .upsert(rows, { onConflict: 'tg_id,badge_id', ignoreDuplicates: true });
  if (error) throw error;
}

// Скільки справ користувач опрацював за весь час: parallel-сабміти + collab-події.
// Різні режими не перетинаються по одній справі, тож сума без дедуплікації прийнятна.
export async function countUserCases(tgId: string): Promise<number> {
  const [subs, confs] = await Promise.all([
    db().from(T.submissions).select('id', { count: 'exact', head: true }).eq('tg_id', tgId),
    db().from(T.caseConfirmations).select('case_id', { count: 'exact', head: true }).eq('tg_id', tgId),
  ]);
  if (subs.error) throw subs.error;
  if (confs.error) throw confs.error;
  return (subs.count || 0) + (confs.count || 0);
}

// ---------- ОПИСОВИЙ ПАЗЛ ----------
export interface PuzzleRow {
  dateKyiv: string;
  sentence: string;
}

export async function getPuzzle(dateKyiv: string): Promise<PuzzleRow | null> {
  const { data, error } = await db()
    .from(T.puzzles)
    .select('date_kyiv, sentence')
    .eq('date_kyiv', dateKyiv)
    .maybeSingle();
  if (error) throw error;
  return data ? { dateKyiv: (data as any).date_kyiv, sentence: (data as any).sentence || '' } : null;
}

export async function upsertPuzzle(dateKyiv: string, sentence: string): Promise<void> {
  const { error } = await db()
    .from(T.puzzles)
    .upsert(
      { date_kyiv: dateKyiv, sentence, updated_at: new Date().toISOString() },
      { onConflict: 'date_kyiv' }
    );
  if (error) throw error;
}

// Записати зібрані (непідтверджені) слова. ignoreDuplicates — не чіпаємо вже наявні
// (зокрема не «понижуємо» підтверджені назад до unconfirmed).
export async function addPuzzleWords(
  dateKyiv: string,
  tgId: string,
  words: string[],
  caseId: string
): Promise<void> {
  if (words.length === 0) return;
  const now = new Date().toISOString();
  const rows = words.map(word => ({
    date_kyiv: dateKyiv,
    tg_id: tgId,
    word,
    status: 'unconfirmed',
    case_id: caseId,
    collected_at: now,
  }));
  const { error } = await db()
    .from(T.puzzleProgress)
    .upsert(rows, { onConflict: 'date_kyiv,tg_id,word', ignoreDuplicates: true });
  if (error) throw error;
}

// Підтвердити слова, зібрані з конкретної справи в конкретний день.
// Повертає унікальні tg_id, чиї слова стали підтвердженими (для перевірки перемоги).
export async function confirmPuzzleWordsByCase(
  caseId: string,
  dateKyiv: string
): Promise<string[]> {
  const { data, error } = await db()
    .from(T.puzzleProgress)
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('case_id', caseId)
    .eq('date_kyiv', dateKyiv)
    .eq('status', 'unconfirmed')
    .select('tg_id');
  if (error) throw error;
  return [...new Set((data || []).map((r: any) => r.tg_id))];
}

// Прогрес одного користувача за день: word → status.
export async function getPuzzleProgressForUser(
  dateKyiv: string,
  tgId: string
): Promise<Array<{ word: string; status: 'unconfirmed' | 'confirmed' }>> {
  const { data, error } = await db()
    .from(T.puzzleProgress)
    .select('word, status')
    .eq('date_kyiv', dateKyiv)
    .eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => ({ word: r.word, status: r.status }));
}

// Усі рядки прогресу за день (для адмін-зведення). День має небагато рядків.
export async function getPuzzleProgressForDate(
  dateKyiv: string
): Promise<Array<{ tgId: string; word: string; status: 'unconfirmed' | 'confirmed' }>> {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.puzzleProgress)
      .select('tg_id, word, status')
      .eq('date_kyiv', dateKyiv)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) out.push({ tgId: (r as any).tg_id, word: (r as any).word, status: (r as any).status });
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Атомарне присвоєння місця переможцю (через RPC з advisory-lock).
// null — якщо юзер уже переможець або всі 3 місця зайняті.
export async function awardPuzzleWinner(
  dateKyiv: string,
  tgId: string
): Promise<{ place: number; points: number } | null> {
  const { data, error } = await db().rpc(RPC_AWARD_PUZZLE_WINNER, {
    p_date: dateKyiv,
    p_tg_id: tgId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { place: Number(row.place), points: Number(row.points) } : null;
}

export async function getPuzzleWinners(
  dateKyiv: string
): Promise<Array<{ place: number; tgId: string; points: number }>> {
  const { data, error } = await db()
    .from(T.puzzleWinners)
    .select('place, tg_id, points')
    .eq('date_kyiv', dateKyiv)
    .order('place', { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => ({ place: r.place, tgId: r.tg_id, points: r.points }));
}

// current_answers уже розпізнаних колаб-справ (confirmations_count > 0) —
// для адмін-індикатора наявності слів у заголовках.
export async function getRecognizedCollabAnswers(limit = 2000): Promise<string[][]> {
  const { data, error } = await db()
    .from(T.cases)
    .select('current_answers')
    .eq('mode', 'collaborative')
    .gt('confirmations_count', 0)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((r: any) => (Array.isArray(r.current_answers) ? r.current_answers.map(String) : []));
}

// Прострочені блокування — на випадок ручної очистки (бот і так враховує locked_until).
export async function clearExpiredLocks(): Promise<number> {
  const { data, error } = await db()
    .from(T.cases)
    .update({ locked_by_tg_id: '', locked_until: null })
    .lt('locked_until', new Date().toISOString())
    .select('case_id');
  if (error) throw error;
  return (data || []).length;
}

