// Логіка веб-перевірки справ. Окремі таблиці verif_* (бот їх не читає).
// Бали — у спільні bot_users/monthly/daily. Лише колаб-модель: AI наперед заповнює
// current_answers, люди підтверджують/виправляють, done після VERIF_THRESHOLD різних людей.
import { createHmac } from 'node:crypto';
import {
  db,
  incTotalPoints,
  incMonthlyPoints,
  incDailyCount,
} from '../telegram/storage.js';
import { kyivDateString, kyivMonthString } from '../telegram/scheduler.js';

const PREFIX = process.env.TABLE_PREFIX ?? 'bot_';
const T = {
  cases: `${PREFIX}verif_cases`,
  confirmations: `${PREFIX}verif_confirmations`,
  skips: `${PREFIX}verif_skips`,
};
const RPC = {
  candidates: `${PREFIX}verif_candidate_cases`,
  lock: `${PREFIX}verif_lock`,
  record: `${PREFIX}verif_record`,
  descProgress: `${PREFIX}verif_description_progress`,
};

// Скільки різних людей мають опрацювати справу, щоб вона стала перевіреною.
export const VERIF_THRESHOLD = 3;
// На скільки хвилин блокуємо справу за перевіряльником, поки він її дивиться.
const LOCK_MINUTES = 30;
// Бали: база за будь-яке опрацювання + надбавка за кожне виправлене слово.
const POINTS_BASE = 1;
const POINTS_PER_WORD = 0.1;

export class VerifError extends Error {
  constructor(public code: string, msg: string) {
    super(msg);
  }
}

export interface VerifQuestion {
  label: string;
  role: string;
}

export interface VerifNext {
  caseId: string;
  imageUrl: string;
  archive: string;
  fund: string;
  opys: string;
  sprava: string;
  questions: VerifQuestion[];
  answers: string[]; // current_answers (= ai_answers, поки ніхто не правив)
  aiAnswers: string[];
  lockedUntil: string;
}

export interface VerifSubmitResult {
  confirmationsCount: number;
  done: boolean;
  pointsEarned: number;
  correctedWords: number;
}

interface VerifCaseRow {
  caseId: string;
  tgFileId: string;
  archive: string;
  fund: string;
  opys: string;
  sprava: string;
  questions: VerifQuestion[];
  currentAnswers: string[];
  aiAnswers: string[];
  status: string;
  lockedBy: string;
  lockedUntil: string;
}

// ---------- token для проксі зображення ----------
export function verifImageToken(caseId: string): string {
  const secret = process.env.WEB_SESSION_SECRET || '';
  return createHmac('sha256', secret).update(`vimg:${caseId}`).digest('hex').slice(0, 32);
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x ?? '')) : [];
}

function asQuestions(v: unknown): VerifQuestion[] {
  return Array.isArray(v)
    ? v.map((q: any) => ({ label: String(q?.label ?? ''), role: String(q?.role ?? '') }))
    : [];
}

function mapCaseRow(r: any): VerifCaseRow {
  return {
    caseId: r.case_id,
    tgFileId: r.tg_file_id || '',
    archive: r.archive || '',
    fund: r.fund || '',
    opys: r.opys || '',
    sprava: r.sprava || '',
    questions: asQuestions(r.questions),
    currentAnswers: asStringArray(r.current_answers),
    aiAnswers: asStringArray(r.ai_answers),
    status: r.status || 'open',
    lockedBy: r.locked_by || '',
    lockedUntil: r.locked_until || '',
  };
}

export async function getVerifCase(caseId: string): Promise<VerifCaseRow | null> {
  const { data, error } = await db().from(T.cases).select('*').eq('case_id', caseId).maybeSingle();
  if (error) throw error;
  return data ? mapCaseRow(data) : null;
}

// ---------- word-diff для балів ----------
// Нормалізація: lower-case, пунктуація → пробіл, стиснення пробілів. Тобто зміни
// лише в пунктуації/пробілах НЕ рахуються як виправлене слово.
function normalizeWords(s: string): string[] {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function wordEditDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

// К-сть виправлених слів між показаним і поданим варіантами (сума по всіх полях).
export function countCorrectedWords(shown: string[], submitted: string[]): number {
  const len = Math.max(shown.length, submitted.length);
  let total = 0;
  for (let i = 0; i < len; i++) {
    total += wordEditDistance(normalizeWords(shown[i] || ''), normalizeWords(submitted[i] || ''));
  }
  return total;
}

// ---------- next ----------
export async function getNextForVerifier(verifierId: string): Promise<VerifNext | null> {
  const { data, error } = await db().rpc(RPC.candidates, { p_verifier_id: verifierId });
  if (error) throw error;
  const rows = (data as any[]) || [];
  for (const r of rows) {
    const { data: locked, error: lerr } = await db().rpc(RPC.lock, {
      p_case_id: r.case_id,
      p_verifier_id: verifierId,
      p_minutes: LOCK_MINUTES,
    });
    if (lerr) throw lerr;
    if (locked === true) {
      const c = mapCaseRow(r);
      return {
        caseId: c.caseId,
        imageUrl: `/api/verif/case/${encodeURIComponent(c.caseId)}/image?t=${verifImageToken(c.caseId)}`,
        archive: c.archive,
        fund: c.fund,
        opys: c.opys,
        sprava: c.sprava,
        questions: c.questions,
        answers: c.currentAnswers.length ? c.currentAnswers : c.aiAnswers,
        aiAnswers: c.aiAnswers,
        lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(),
      };
    }
  }
  return null;
}

// ---------- submit (confirm / edit) ----------
async function awardPoints(verifierId: string, displayName: string, delta: number): Promise<void> {
  await Promise.all([
    incTotalPoints(verifierId, delta),
    incMonthlyPoints(kyivMonthString(), verifierId, delta, displayName),
    incDailyCount(verifierId, kyivDateString()),
  ]);
}

export async function submitVerification(opts: {
  verifierId: string;
  displayName: string;
  caseId: string;
  answers: string[] | null; // null = підтвердити як є
}): Promise<VerifSubmitResult> {
  const cse = await getVerifCase(opts.caseId);
  if (!cse) throw new VerifError('not_found', 'Справу не знайдено');
  if (cse.status === 'done') throw new VerifError('already_done', 'Справу вже перевірено');

  // Не дозволяємо подавати справу, яку зараз тримає інший перевіряльник.
  const lockedByOther =
    cse.lockedBy && cse.lockedBy !== opts.verifierId &&
    cse.lockedUntil && new Date(cse.lockedUntil).getTime() > Date.now();
  if (lockedByOther) throw new VerifError('locked', 'Справу зараз перевіряє інша людина');

  const shown = cse.currentAnswers.length ? cse.currentAnswers : cse.aiAnswers;
  const submitted = Array.isArray(opts.answers) ? opts.answers.map(String) : shown;
  const corrected = countCorrectedWords(shown, submitted);
  const kind = corrected > 0 ? 'edit' : 'confirm';

  const { data, error } = await db().rpc(RPC.record, {
    p_case_id: opts.caseId,
    p_verifier_id: opts.verifierId,
    p_kind: kind,
    p_answers: submitted,
    p_corrected: corrected,
    p_threshold: VERIF_THRESHOLD,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const count = Number(row?.new_count ?? 0);
  const done = String(row?.new_status ?? 'open') === 'done';

  const pts = Math.round((POINTS_BASE + POINTS_PER_WORD * corrected) * 100) / 100;
  await awardPoints(opts.verifierId, opts.displayName, pts);

  return { confirmationsCount: count, done, pointsEarned: pts, correctedWords: corrected };
}

// ---------- skip ----------
export async function skipVerification(verifierId: string, caseId: string): Promise<void> {
  const { error: skipErr } = await db()
    .from(T.skips)
    .upsert({ case_id: caseId, verifier_id: verifierId }, { onConflict: 'case_id,verifier_id' });
  if (skipErr) throw skipErr;
  // Знімаємо лок, якщо він наш — щоб справа одразу була доступна іншим.
  const { error: unlockErr } = await db()
    .from(T.cases)
    .update({ locked_by: '', locked_until: null })
    .eq('case_id', caseId)
    .eq('locked_by', verifierId);
  if (unlockErr) throw unlockErr;
}

// ---------- release (закрив вкладку, не завершивши) ----------
export async function releaseVerification(verifierId: string, caseId: string): Promise<void> {
  const { error } = await db()
    .from(T.cases)
    .update({ locked_by: '', locked_until: null })
    .eq('case_id', caseId)
    .eq('locked_by', verifierId);
  if (error) throw error;
}

// ---------- stats для шапки ----------
export interface VerifDescription {
  archive: string;
  fund: string;
  opys: string;
  total: number;
  done: number;
}
export interface VerifStats {
  descriptions: VerifDescription[];
  total_descriptions: number;
  remaining_descriptions: number;
}

// ---------- завантаження справ (адмінка, вкладка «Веб») ----------
// Вставляє розпізнану справу в чергу перевірки. current_answers стартує = ai_answers.
export async function appendVerifCase(input: {
  tgFileId: string;
  tgChatId: string;
  tgMessageId: string;
  sourcePdf: string;
  page: string;
  bbox: string;
  archive: string;
  fund: string;
  opys: string;
  sprava?: string;
  questions: VerifQuestion[];
  aiAnswers: string[];
}): Promise<string> {
  const caseId = (globalThis.crypto?.randomUUID?.() || `v_${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/-/g, '');
  const { error } = await db().from(T.cases).insert({
    case_id: caseId,
    tg_file_id: input.tgFileId,
    tg_chat_id: input.tgChatId,
    tg_message_id: input.tgMessageId,
    source_pdf: input.sourcePdf,
    page: input.page,
    bbox: input.bbox,
    archive: input.archive,
    fund: input.fund,
    opys: input.opys,
    sprava: input.sprava || '',
    questions: input.questions,
    ai_answers: input.aiAnswers,
    current_answers: input.aiAnswers,
    confirmations_count: 0,
    status: 'open',
    locked_by: '',
  });
  if (error) throw error;
  return caseId;
}

// ---------- експорт опису (вкладка «Експортувати опис») ----------
// Кожна verif-справа = один зведений запис (current_answers). Формат сумісний із
// submissions телеграм-експорту (поля case_id/answers/archive/.../source_pdf/page).
export async function getVerifSubmissionsByDescription(
  archive: string,
  fund: string,
  opys: string
): Promise<{ questions: VerifQuestion[]; submissions: any[] }> {
  const pageSize = 1000;
  const rows: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from(T.cases)
      .select('case_id, archive, fund, opys, sprava, source_pdf, page, questions, current_answers, ai_answers, status, confirmations_count, updated_at, created_at')
      .eq('archive', archive)
      .eq('fund', fund)
      .eq('opys', opys)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  const questions = rows.length ? asQuestions(rows[0].questions) : [];
  const submissions = rows.map(r => {
    const cur = asStringArray(r.current_answers);
    const answers = cur.length ? cur : asStringArray(r.ai_answers);
    return {
      case_id: r.case_id,
      tg_id: '',
      display_name: '',
      submitted_at: r.updated_at || r.created_at || '',
      answers,
      source_link: '',
      archive: r.archive || '',
      fund: r.fund || '',
      opys: r.opys || '',
      sprava: r.sprava || '',
      source_pdf: r.source_pdf || '',
      page: r.page || '',
      is_collab: true,
      confirmations_count: r.confirmations_count || 0,
      case_status: r.status || 'open',
      confirmations: [],
    };
  });
  return { questions, submissions };
}

// Список веб-описів у форматі overview.descriptions (key/name/donePct/doneCases/totalCases).
export async function getVerifDescriptions(): Promise<
  Array<{ key: string; name: string; donePct: number; doneCases: number; totalCases: number }>
> {
  const stats = await getVerifStats();
  return stats.descriptions.map(d => ({
    key: `${d.archive}|${d.fund}|${d.opys}`,
    name: `${d.archive} ${d.fund}-${d.opys}`,
    donePct: d.total > 0 ? Math.round((d.done / d.total) * 1000) / 10 : 0,
    doneCases: d.done,
    totalCases: d.total,
  }));
}

export async function getVerifStats(): Promise<VerifStats> {
  const { data, error } = await db().rpc(RPC.descProgress);
  if (error) throw error;
  const rows = ((data as any[]) || [])
    .map(r => ({
      archive: r.archive || '',
      fund: r.fund || '',
      opys: r.opys || '',
      total: Number(r.total_cases || 0),
      done: Number(r.done_cases || 0),
      earliest: String(r.earliest_created_at || ''),
    }))
    .sort((a, b) => a.earliest.localeCompare(b.earliest));
  return {
    descriptions: rows.map(({ earliest, ...r }) => r),
    total_descriptions: rows.length,
    remaining_descriptions: rows.filter(r => r.done < r.total).length,
  };
}
