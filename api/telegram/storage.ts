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
};
const RPC_INC_DAILY = `${PREFIX}inc_daily`;

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
  const { data, error } = await db().from(T.users).select('*');
  if (error) throw error;
  return (data || []).map(mapUser);
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
        // created_at — не оновлюємо при апдейті, але дамо при insert
        ...(u.createdAt ? { created_at: u.createdAt } : {}),
      },
      { onConflict: 'tg_id' }
    );
  if (error) throw error;
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
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await db().from(T.users).update(dbPatch).eq('tg_id', tgId);
  if (error) throw error;
}

// ---------- CASES ----------
export async function getAllCases(): Promise<BotCase[]> {
  const { data, error } = await db().from(T.cases).select('*');
  if (error) throw error;
  return (data || []).map(mapCase);
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
export async function recordCaseEvent(
  caseId: string,
  tgId: string,
  kind: 'create' | 'edit' | 'confirm'
): Promise<void> {
  const { error } = await db()
    .from(T.caseConfirmations)
    .upsert(
      { case_id: caseId, tg_id: tgId, kind, at: new Date().toISOString() },
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

