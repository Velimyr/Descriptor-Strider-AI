// Усі читання/запис стану бота. Кожна "таблиця" — окремий аркуш у Google Spreadsheet.
import {
  appendRows,
  colLetter,
  deleteRowByMatch,
  ensureSheet,
  readSheet,
  updateRange,
} from './sheets-client.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

export interface BotUser {
  rowIndex: number; // 0-based, без заголовка
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
  submissionsCount: number;
  status: 'open' | 'done';
  createdAt: string;
}

export interface BotSession {
  rowIndex: number;
  tgId: string;
  caseId: string;
  answersJson: string; // JSON-масив відповідей по індексу питання
  currentQ: number;
  startedAt: string;
  updatedAt: string;
  state: 'asking' | 'confirming';
}

export interface BotMeta {
  questionsJson: string; // JSON: TableColumn[]
  schemaVersion: string;
}

const S = telegramBotConfig.sheets;

const USERS_HEADER = [
  'tg_id',
  'display_name',
  'total_points',
  'last_dispatched_case_id',
  'last_dispatched_at',
  'consecutive_misses',
  'status',
  'created_at',
];

const CASES_HEADER = [
  'case_id',
  'tg_file_id',
  'tg_chat_id',
  'tg_message_id',
  'source_pdf',
  'page',
  'bbox',
  'submissions_count',
  'status',
  'created_at',
];

const SESSIONS_HEADER = ['tg_id', 'case_id', 'answers_json', 'current_q', 'started_at', 'updated_at', 'state'];
const DAILY_HEADER = ['tg_id', 'date_kyiv', 'count'];
const DISPATCH_HEADER = ['tg_id', 'case_id', 'sent_at'];
const META_HEADER = ['key', 'value'];

export async function ensureAllSheets() {
  await ensureSheet(S.metaSheetName);
  await ensureSheet(S.usersSheetName);
  await ensureSheet(S.casesSheetName);
  await ensureSheet(S.sessionsSheetName);
  await ensureSheet(S.dailyScoresSheetName);
  await ensureSheet(S.dispatchLogSheetName);
  await ensureSheet(S.resultsSheetName);

  await ensureHeader(S.metaSheetName, META_HEADER);
  await ensureHeader(S.usersSheetName, USERS_HEADER);
  await ensureHeader(S.casesSheetName, CASES_HEADER);
  await ensureHeader(S.sessionsSheetName, SESSIONS_HEADER);
  await ensureHeader(S.dailyScoresSheetName, DAILY_HEADER);
  await ensureHeader(S.dispatchLogSheetName, DISPATCH_HEADER);
}

async function ensureHeader(sheetName: string, header: string[]) {
  const rows = await readSheet(sheetName);
  if (rows.length === 0) {
    await appendRows(sheetName, [header]);
  }
}

// ---------- META ----------

export async function getMeta(key: string): Promise<string | null> {
  const rows = await readSheet(S.metaSheetName);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) return rows[i][1] || '';
  }
  return null;
}

export async function setMeta(key: string, value: string) {
  const rows = await readSheet(S.metaSheetName);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) {
      await updateRange(S.metaSheetName, `B${i + 1}`, [[value]]);
      return;
    }
  }
  await appendRows(S.metaSheetName, [[key, value]]);
}

// ---------- USERS ----------

export async function getAllUsers(): Promise<BotUser[]> {
  const rows = await readSheet(S.usersSheetName);
  const users: BotUser[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    users.push({
      rowIndex: i - 1,
      tgId: r[0],
      displayName: r[1] || '',
      totalPoints: parseFloat(r[2] || '0') || 0,
      lastDispatchedCaseId: r[3] || '',
      lastDispatchedAt: r[4] || '',
      consecutiveMisses: parseInt(r[5] || '0', 10) || 0,
      status: (r[6] as any) || 'active',
      createdAt: r[7] || '',
    });
  }
  return users;
}

export async function getUser(tgId: string): Promise<BotUser | null> {
  const all = await getAllUsers();
  return all.find(u => u.tgId === tgId) || null;
}

export async function upsertUser(u: Omit<BotUser, 'rowIndex'>): Promise<void> {
  const existing = await getUser(u.tgId);
  const row = [
    u.tgId,
    u.displayName,
    u.totalPoints,
    u.lastDispatchedCaseId,
    u.lastDispatchedAt,
    u.consecutiveMisses,
    u.status,
    u.createdAt,
  ];
  if (existing) {
    const sheetRow = existing.rowIndex + 2; // +1 за заголовок, +1 за 1-based
    await updateRange(S.usersSheetName, `A${sheetRow}:H${sheetRow}`, [row]);
  } else {
    await appendRows(S.usersSheetName, [row]);
  }
}

export async function patchUser(tgId: string, patch: Partial<Omit<BotUser, 'rowIndex' | 'tgId'>>) {
  const u = await getUser(tgId);
  if (!u) return;
  await upsertUser({ ...u, ...patch });
}

// ---------- CASES ----------

export async function getAllCases(): Promise<BotCase[]> {
  const rows = await readSheet(S.casesSheetName);
  const cases: BotCase[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    cases.push({
      rowIndex: i - 1,
      caseId: r[0],
      tgFileId: r[1] || '',
      tgChatId: r[2] || '',
      tgMessageId: r[3] || '',
      sourcePdf: r[4] || '',
      page: r[5] || '',
      bbox: r[6] || '',
      submissionsCount: parseInt(r[7] || '0', 10) || 0,
      status: (r[8] as any) || 'open',
      createdAt: r[9] || '',
    });
  }
  return cases;
}

export async function getCase(caseId: string): Promise<BotCase | null> {
  const all = await getAllCases();
  return all.find(c => c.caseId === caseId) || null;
}

export async function appendCases(items: Omit<BotCase, 'rowIndex'>[]) {
  if (items.length === 0) return;
  const rows = items.map(c => [
    c.caseId,
    c.tgFileId,
    c.tgChatId,
    c.tgMessageId,
    c.sourcePdf,
    c.page,
    c.bbox,
    c.submissionsCount,
    c.status,
    c.createdAt,
  ]);
  await appendRows(S.casesSheetName, rows);
}

export async function patchCase(caseId: string, patch: Partial<Omit<BotCase, 'rowIndex' | 'caseId'>>) {
  const c = await getCase(caseId);
  if (!c) return;
  const updated = { ...c, ...patch };
  const sheetRow = c.rowIndex + 2;
  await updateRange(S.casesSheetName, `A${sheetRow}:J${sheetRow}`, [
    [
      updated.caseId,
      updated.tgFileId,
      updated.tgChatId,
      updated.tgMessageId,
      updated.sourcePdf,
      updated.page,
      updated.bbox,
      updated.submissionsCount,
      updated.status,
      updated.createdAt,
    ],
  ]);
}

// ---------- SESSIONS ----------

export async function getSession(tgId: string): Promise<BotSession | null> {
  const rows = await readSheet(S.sessionsSheetName);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] === tgId) {
      return {
        rowIndex: i - 1,
        tgId: r[0],
        caseId: r[1] || '',
        answersJson: r[2] || '[]',
        currentQ: parseInt(r[3] || '0', 10) || 0,
        startedAt: r[4] || '',
        updatedAt: r[5] || '',
        state: (r[6] as any) || 'asking',
      };
    }
  }
  return null;
}

export async function setSession(s: Omit<BotSession, 'rowIndex'>) {
  const existing = await getSession(s.tgId);
  const row = [s.tgId, s.caseId, s.answersJson, s.currentQ, s.startedAt, s.updatedAt, s.state];
  if (existing) {
    const sheetRow = existing.rowIndex + 2;
    await updateRange(S.sessionsSheetName, `A${sheetRow}:G${sheetRow}`, [row]);
  } else {
    await appendRows(S.sessionsSheetName, [row]);
  }
}

export async function deleteSession(tgId: string): Promise<boolean> {
  return deleteRowByMatch(S.sessionsSheetName, row => row[0] === tgId);
}

export async function getAllSessions(): Promise<BotSession[]> {
  const rows = await readSheet(S.sessionsSheetName);
  const out: BotSession[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    out.push({
      rowIndex: i - 1,
      tgId: r[0],
      caseId: r[1] || '',
      answersJson: r[2] || '[]',
      currentQ: parseInt(r[3] || '0', 10) || 0,
      startedAt: r[4] || '',
      updatedAt: r[5] || '',
      state: (r[6] as any) || 'asking',
    });
  }
  return out;
}

// ---------- DAILY SCORES ----------

export async function incDailyCount(tgId: string, dateKyiv: string): Promise<number> {
  const rows = await readSheet(S.dailyScoresSheetName);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === tgId && rows[i][1] === dateKyiv) {
      const next = (parseInt(rows[i][2] || '0', 10) || 0) + 1;
      await updateRange(S.dailyScoresSheetName, `C${i + 1}`, [[next]]);
      return next;
    }
  }
  await appendRows(S.dailyScoresSheetName, [[tgId, dateKyiv, 1]]);
  return 1;
}

export async function getDailyCount(tgId: string, dateKyiv: string): Promise<number> {
  const rows = await readSheet(S.dailyScoresSheetName);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === tgId && rows[i][1] === dateKyiv) {
      return parseInt(rows[i][2] || '0', 10) || 0;
    }
  }
  return 0;
}

// ---------- DISPATCH LOG ----------

export async function logDispatch(tgId: string, caseId: string, sentAtIso: string) {
  await appendRows(S.dispatchLogSheetName, [[tgId, caseId, sentAtIso]]);
}

// ---------- RESULTS ----------

export async function appendSubmission(headerColumns: string[], row: (string | number)[]) {
  const rows = await readSheet(S.resultsSheetName);
  if (rows.length === 0) {
    await appendRows(S.resultsSheetName, [headerColumns, row]);
  } else {
    await appendRows(S.resultsSheetName, [row]);
  }
}

export async function countSubmissionsByCase(caseId: string): Promise<number> {
  const rows = await readSheet(S.resultsSheetName);
  if (rows.length < 2) return 0;
  let count = 0;
  // case_id — перша колонка з serviceColumnsBefore
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === caseId) count++;
  }
  return count;
}

export async function getSubmissionsForUser(tgId: string): Promise<string[]> {
  const rows = await readSheet(S.resultsSheetName);
  const seen: string[] = [];
  // case_id col 0, telegram_user_id col 1
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === tgId) seen.push(rows[i][0]);
  }
  return seen;
}

export async function getResultsTotals(): Promise<{ totalSubmissions: number }> {
  const rows = await readSheet(S.resultsSheetName);
  return { totalSubmissions: Math.max(0, rows.length - 1) };
}

export { colLetter };
