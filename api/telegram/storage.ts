// Сховище стану бота — Postgres через Supabase. Один файл, інтерфейс зберігається.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

let cachedClient: SupabaseClient | null = null;

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
}

export interface BotSession {
  rowIndex: number;
  tgId: string;
  caseId: string;
  answersJson: string;
  currentQ: number;
  startedAt: string;
  updatedAt: string;
  state: 'asking' | 'confirming';
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
    createdAt: r.created_at || '',
  };
}

function mapCase(r: any): BotCase {
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
    state: (r.state || 'asking') as 'asking' | 'confirming',
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

  const { data, error } = await db().from('bot_meta').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  const value = data?.value ?? '';
  metaCache.set(key, { value, expires: Date.now() + META_TTL_MS });
  return value || null;
}

export async function setMeta(key: string, value: string) {
  metaCache.set(key, { value, expires: Date.now() + META_TTL_MS });
  const { error } = await db().from('bot_meta').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

// ---------- USERS ----------
export async function getAllUsers(): Promise<BotUser[]> {
  const { data, error } = await db().from('bot_users').select('*');
  if (error) throw error;
  return (data || []).map(mapUser);
}

export async function getUser(tgId: string): Promise<BotUser | null> {
  const { data, error } = await db().from('bot_users').select('*').eq('tg_id', tgId).maybeSingle();
  if (error) throw error;
  return data ? mapUser(data) : null;
}

export async function upsertUser(
  u: Omit<BotUser, 'rowIndex'>,
  _existingRowIndex?: number // legacy, ігнорується
): Promise<void> {
  const { error } = await db()
    .from('bot_users')
    .upsert(
      {
        tg_id: u.tgId,
        display_name: u.displayName,
        total_points: u.totalPoints,
        last_dispatched_case_id: u.lastDispatchedCaseId,
        last_dispatched_at: u.lastDispatchedAt || null,
        consecutive_misses: u.consecutiveMisses,
        status: u.status,
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
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await db().from('bot_users').update(dbPatch).eq('tg_id', tgId);
  if (error) throw error;
}

// ---------- CASES ----------
export async function getAllCases(): Promise<BotCase[]> {
  const { data, error } = await db().from('bot_cases').select('*');
  if (error) throw error;
  return (data || []).map(mapCase);
}

export async function getCase(caseId: string): Promise<BotCase | null> {
  const { data, error } = await db().from('bot_cases').select('*').eq('case_id', caseId).maybeSingle();
  if (error) throw error;
  return data ? mapCase(data) : null;
}

export async function appendCases(items: Omit<BotCase, 'rowIndex'>[]) {
  if (items.length === 0) return;
  const { error } = await db().from('bot_cases').insert(
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
  const { error } = await db().from('bot_cases').update(dbPatch).eq('case_id', caseId);
  if (error) throw error;
}

// ---------- SESSIONS ----------
export async function getSession(tgId: string): Promise<BotSession | null> {
  const { data, error } = await db().from('bot_sessions').select('*').eq('tg_id', tgId).maybeSingle();
  if (error) throw error;
  return data ? mapSession(data) : null;
}

export async function setSession(s: Omit<BotSession, 'rowIndex'>, _existingRowIndex?: number) {
  const { error } = await db()
    .from('bot_sessions')
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
    .from('bot_sessions')
    .delete({ count: 'exact' })
    .eq('tg_id', tgId);
  if (error) throw error;
  return (count || 0) > 0;
}

export async function getAllSessions(): Promise<BotSession[]> {
  const { data, error } = await db().from('bot_sessions').select('*');
  if (error) throw error;
  return (data || []).map(mapSession);
}

// ---------- DAILY SCORES ----------
export async function incDailyCount(tgId: string, dateKyiv: string): Promise<number> {
  const { data, error } = await db().rpc('bot_inc_daily', { p_tg_id: tgId, p_date: dateKyiv });
  if (error) throw error;
  return Number(data || 0);
}

export async function getDailyCount(tgId: string, dateKyiv: string): Promise<number> {
  const { data, error } = await db()
    .from('bot_daily_scores')
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
  const { error } = await db().from('bot_submissions').insert({
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
    .from('bot_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId);
  if (error) throw error;
  return count || 0;
}

export async function getSubmissionsForUser(tgId: string): Promise<string[]> {
  const { data, error } = await db().from('bot_submissions').select('case_id').eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => r.case_id);
}

export async function getResultsTotals(): Promise<{ totalSubmissions: number }> {
  const { count, error } = await db()
    .from('bot_submissions')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return { totalSubmissions: count || 0 };
}

// Експортуємо submissions для адмінського перегляду / експорту.
export async function getRecentSubmissions(limit = 100) {
  const { data, error } = await db()
    .from('bot_submissions')
    .select('*')
    .order('submitted_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

