// Непідтверджені бали (крок 3). Спільний модуль для бот- і веб-шляхів.
//
// Ідея: за розпізнавання/редагування (create/edit) бали НЕ нараховуються одразу —
// тримаються як 'unconfirmed' на рядку bot_case_confirmations. Коли справу закрито
// (досягнуто потрібної к-сті підтверджень), версію учасника звіряють із фінальною
// ЛИШЕ за полями номера справи (ролі 'order_no', 'case_no') і назви ('title');
// дати, кількість сторінок, примітки й коментар розпізнавача на рішення не впливають.
// Якщо сумарна різниця >5 символів — бали 'forfeited' (не нараховуються),
// інакше 'confirmed' (нараховуються в total + місячний рейтинг).
import { db, T, incTotalPoints, incMonthlyPoints, getMeta, getCase } from '../_telegram/storage.js';
import { kyivMonthString } from '../_telegram/scheduler.js';
import type { TableColumn } from '../../src/types.js';

// Поріг різниці у символах: понад нього — бали не нараховуються.
export const DIFF_THRESHOLD = 5;

// Для ВІДОБРАЖЕННЯ користувачу — читабельний текст (обрізаємо краї, стискаємо пробіли).
function normalize(s: unknown): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ');
}

// Для ПОРІВНЯННЯ (рішення про бали) — лишаємо лише значущі символи: літери й цифри.
// Пробіли, спецсимволи і регістр ігноруємо, тож різниця рахується тільки по «справжніх»
// символах без огляду на великі/малі літери.
function stripForCompare(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// Експортована — переюзана в keywords.ts для фаззі-мачингу ключових слів.
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

export interface FieldDiff {
  label: string;
  theirs: string;
  final: string;
  dist: number;
}

// Сумарна символьна різниця між версією учасника і фінальною — лише за полями
// номера справи та назви (SCORED_ROLES). Повертає суму + деталі змінених полів.
//
// Поле коментаря визначаємо ХАРДКОДОМ — за точною назвою «Коментар розпізнавача»
// (НЕ за роллю). Та сама перевірка вживається і в AI-промті (bot.ts).
export const RECOGNIZER_COMMENT_LABEL = 'Коментар розпізнавача';

export function isCommentField(q?: { label?: string }): boolean {
  return (q?.label || '').trim().toLowerCase() === RECOGNIZER_COMMENT_LABEL.toLowerCase();
}

// Ролі полів, за якими вирішується правильність версії (нарахування балів):
// лише номер справи (порядковий 'order_no' і додатковий 'case_no') та назва
// ('title'). Розбіжності в датах, кількості сторінок, примітках і коментарі
// розпізнавача балів не позбавляють.
const SCORED_ROLES = new Set<string>(['order_no', 'case_no', 'title']);

function isScoredField(q?: TableColumn): boolean {
  return SCORED_ROLES.has(q?.role ?? '');
}

export function compareVersions(
  theirs: string[],
  final: string[],
  questions: TableColumn[]
): { sum: number; fields: FieldDiff[] } {
  const len = Math.max(theirs.length, final.length, questions.length);
  let sum = 0;
  const fields: FieldDiff[] = [];
  for (let i = 0; i < len; i++) {
    if (!isScoredField(questions[i])) continue; // рахуємо лише номер справи та назву
    // Дистанцію рахуємо по значущих символах (без пробілів/спецсимволів),
    // а показуємо користувачу читабельні значення.
    const d = levenshtein(stripForCompare(theirs[i]), stripForCompare(final[i]));
    sum += d;
    if (d > 0) {
      fields.push({
        label: questions[i]?.label || `Поле ${i + 1}`,
        theirs: normalize(theirs[i]),
        final: normalize(final[i]),
        dist: d,
      });
    }
  }
  return { sum, fields };
}

// Чи змінилось якесь поле, КРІМ «Коментаря розпізнавача», між старою і новою
// версією відповідей. Використовується, щоб редагування ЛИШЕ коментаря не
// скидало коло підтверджень (setCaseEdited) у collab-режимі — трактуємо це як
// технічну правку, а не змістовне виправлення справи.
export function onlyCommentFieldChanged(
  oldAnswers: string[],
  newAnswers: string[],
  questions: TableColumn[]
): boolean {
  const len = Math.max(oldAnswers.length, newAnswers.length, questions.length);
  for (let i = 0; i < len; i++) {
    if (isCommentField(questions[i])) continue;
    if (stripForCompare(oldAnswers[i]) !== stripForCompare(newAnswers[i])) return false;
  }
  return true;
}

export async function getQuestions(): Promise<TableColumn[]> {
  const raw = await getMeta('questions');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Записує суму балів як «непідтверджену» на існуючий рядок підтвердження (create/edit).
export async function recordPendingPoints(caseId: string, tgId: string, points: number): Promise<void> {
  const { error } = await db()
    .from(T.caseConfirmations)
    .update({ points, points_status: 'unconfirmed', settled_at: null })
    .eq('case_id', caseId)
    .eq('tg_id', tgId);
  if (error) throw error;
}

// Сума непідтверджених балів користувача.
export async function getUnconfirmedTotal(tgId: string): Promise<number> {
  const { data, error } = await db()
    .from(T.caseConfirmations)
    .select('points')
    .eq('tg_id', tgId)
    .eq('points_status', 'unconfirmed');
  if (error) throw error;
  return (data || []).reduce((s: number, r: any) => s + Number(r.points || 0), 0);
}

// Розрахунок усіх непідтверджених учасників справи на момент закриття.
// finalAnswers — current_answers справи. Нараховує підтверджені, списує надто відмінні.
export async function settleCaseAtClose(caseId: string, finalAnswers: string[]): Promise<void> {
  const questions = await getQuestions();

  // Ключові слова: справа щойно закрилась (є канонічний фінальний текст) —
  // незалежно від того, чи лишились непідтверджені бали нижче. Помилка тут не
  // має ламати розрахунок балів.
  try {
    const { evaluateKeywordMatches } = await import('../_telegram/keywords.js');
    await evaluateKeywordMatches({ caseId, source: 'collab', questions, answers: finalAnswers });
  } catch (e: any) {
    console.error('keyword match (collab close) failed', e?.message || e);
  }

  const { data, error } = await db()
    .from(T.caseConfirmations)
    .select('tg_id, answers, points')
    .eq('case_id', caseId)
    .eq('points_status', 'unconfirmed');
  if (error) throw error;
  const rows = (data as any[]) || [];
  if (rows.length === 0) return;

  // Імена для місячного рейтингу — одним запитом по всіх учасниках.
  const ids = rows.map(r => String(r.tg_id));
  const { data: usersData } = await db().from(T.users).select('tg_id, display_name').in('tg_id', ids);
  const nameById = new Map<string, string>((usersData || []).map((u: any) => [u.tg_id, u.display_name || '']));

  const month = kyivMonthString();
  const settledAt = new Date().toISOString();

  for (const r of rows) {
    const tgId = String(r.tg_id);
    const theirs: string[] = Array.isArray(r.answers) ? r.answers : [];
    const pts = Number(r.points || 0);
    const { sum } = compareVersions(theirs, finalAnswers, questions);
    const status = sum > DIFF_THRESHOLD ? 'forfeited' : 'confirmed';

    await db()
      .from(T.caseConfirmations)
      .update({ points_status: status, settled_at: settledAt, final_answers: finalAnswers })
      .eq('case_id', caseId)
      .eq('tg_id', tgId);

    if (status === 'confirmed' && pts > 0) {
      await Promise.all([
        incTotalPoints(tgId, pts),
        incMonthlyPoints(month, tgId, pts, nameById.get(tgId) || ''),
      ]);
    }
  }
}

export interface ForfeitedCase {
  caseId: string;
  opysLabel: string;  // «{archive} {fund}-{opys}» з картки справи
  spravaNo: string;   // номер справи, який ВНІС розпізнавач (роль order_no, фолбек case_no); '—' якщо порожньо
  points: number;
  settledAt: string;
  fields: FieldDiff[];
}

// Справи за останні N годин, за які користувачу НЕ нарахували бали (forfeited),
// з деталізацією, де версія розійшлася з фінальною.
export async function getRecentForfeited(tgId: string, hours = 24): Promise<ForfeitedCase[]> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await db()
    .from(T.caseConfirmations)
    .select('case_id, answers, final_answers, points, settled_at')
    .eq('tg_id', tgId)
    .eq('points_status', 'forfeited')
    .gte('settled_at', since)
    .order('settled_at', { ascending: false });
  if (error) throw error;
  const rows = (data as any[]) || [];
  if (rows.length === 0) return [];

  const questions = await getQuestions();
  // Індекс поля з номером справи — пріоритет "Порядковий номер справи" (order_no,
  // фактично завжди заповнений і саме ним ідентифікують справу скрізь в адмінці).
  // "Номер справи (додатковий)" (case_no) — лише фолбек, він частіше порожній.
  const caseNoIdx = (() => {
    const orderIdx = questions.findIndex(q => q.role === 'order_no');
    return orderIdx >= 0 ? orderIdx : questions.findIndex(q => q.role === 'case_no');
  })();

  return Promise.all(
    rows.map(async r => {
      const theirs: string[] = Array.isArray(r.answers) ? r.answers : [];
      const final: string[] = Array.isArray(r.final_answers) ? r.final_answers : [];
      const { fields } = compareVersions(theirs, final, questions);

      // Опис — повний підпис «{archive} {fund}-{opys}» з картки справи.
      const cse = await getCase(String(r.case_id)).catch(() => null);
      const opysLabel = cse
        ? `${cse.archive} ${cse.fund}-${cse.opys}`.trim()
        : '—';
      // Номер справи — те, що ввів розпізнавач; порожньо → прочерк.
      const spravaNo = caseNoIdx >= 0 ? normalize(theirs[caseNoIdx]) || '—' : '—';

      return {
        caseId: String(r.case_id),
        opysLabel,
        spravaNo,
        points: Number(r.points || 0),
        settledAt: String(r.settled_at || ''),
        fields,
      };
    })
  );
}
