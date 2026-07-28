// «Вікторина» — гра для стрімів. Ведучий керує зі сторінки /quiz (адмін-логін):
// «Запустити вікторину» / «Наступне питання». Питання беруться з конфігу і
// показуються ЛИШЕ на екрані — у Telegram бот їх не надсилає. Учасники в розділі
// «Вікторина» надсилають відповіді текстом; хто перший відповів правильно, отримує
// бали вікторини (окремі від балів застосунку — bot_users.total_points не чіпаємо).
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import type { QuizQuestion } from '../../src/telegram-bot/config.js';
import {
  getQuizState,
  setQuizState,
  recordQuizAnswer,
  getQuizPoints,
} from './storage.js';
import type { QuizStateRow } from './storage.js';

const CFG = telegramBotConfig.quiz;

export function quizQuestions(): QuizQuestion[] {
  return CFG.questions || [];
}

// Різновиди апострофа зводимо до одного (як у пазлі).
const APOSTROPHES = /[''‘`´]/g;

// Нормалізація відповіді для порівняння: нижній регістр, єдиний апостроф, ё→е,
// геть уся пунктуація, схлопнуті пробіли. Тому «ЦДІАК України!» == «цдіак україни».
export function normalizeAnswer(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCorrectAnswer(q: QuizQuestion | undefined, raw: string): boolean {
  if (!q) return false;
  const got = normalizeAnswer(raw);
  if (!got) return false;
  return (q.answers || []).some(a => normalizeAnswer(a) === got);
}

// ---------- Стан ----------

export interface QuizPublicState {
  status: 'idle' | 'running' | 'finished';
  sessionId: string;
  // Номер поточного питання (0-based) і скільки всього питань у конфігу.
  qIndex: number;
  total: number;
  // Скільки секунд лишилось на відповідь (0 — час вийшов / питання немає).
  secondsLeft: number;
  endsAt: string;
  // true — відповіді зараз приймаються.
  open: boolean;
}

export function publicState(state: QuizStateRow, now = Date.now()): QuizPublicState {
  const total = quizQuestions().length;
  const endsMs = state.endsAt ? new Date(state.endsAt).getTime() : 0;
  const secondsLeft = endsMs > now ? Math.ceil((endsMs - now) / 1000) : 0;
  const open = state.status === 'running' && secondsLeft > 0;
  return {
    status: state.status,
    sessionId: state.sessionId,
    qIndex: state.qIndex,
    total,
    secondsLeft,
    endsAt: state.endsAt,
    open,
  };
}

function endsAtFromNow(): string {
  return new Date(Date.now() + Math.max(5, CFG.answerSeconds) * 1000).toISOString();
}

// Старт нової сесії: нова session_id (стрічка відповідей і переможці рахуються
// в межах сесії), перше питання відкрите одразу.
export async function startQuiz(): Promise<QuizStateRow> {
  if (quizQuestions().length === 0) throw new Error('quiz_no_questions');
  const now = new Date().toISOString();
  const state: QuizStateRow = {
    sessionId: `q${Date.now().toString(36)}`,
    status: 'running',
    qIndex: 0,
    startedAt: now,
    endsAt: endsAtFromNow(),
  };
  await setQuizState(state);
  return state;
}

// Наступне питання. Якщо питання скінчились — сесія завершується.
export async function nextQuestion(): Promise<QuizStateRow> {
  const cur = await getQuizState();
  if (cur.status !== 'running') return startQuiz();
  const nextIndex = cur.qIndex + 1;
  if (nextIndex >= quizQuestions().length) {
    const done: QuizStateRow = { ...cur, status: 'finished', endsAt: '' };
    await setQuizState(done);
    return done;
  }
  const state: QuizStateRow = {
    ...cur,
    status: 'running',
    qIndex: nextIndex,
    endsAt: endsAtFromNow(),
  };
  await setQuizState(state);
  return state;
}

// Перезапустити таймер поточного питання (якщо ведучому треба дати ще часу).
export async function restartTimer(): Promise<QuizStateRow> {
  const cur = await getQuizState();
  if (cur.status === 'idle' || !cur.sessionId) return cur;
  const state: QuizStateRow = { ...cur, status: 'running', endsAt: endsAtFromNow() };
  await setQuizState(state);
  return state;
}

export async function stopQuiz(): Promise<QuizStateRow> {
  const cur = await getQuizState();
  const state: QuizStateRow = { ...cur, status: 'finished', endsAt: '' };
  await setQuizState(state);
  return state;
}

// ---------- Відповідь учасника ----------

export type QuizSubmitResult =
  | { kind: 'not_running' }
  | { kind: 'too_late' }
  | { kind: 'wrong' }
  | { kind: 'correct_late' }
  | { kind: 'win'; points: number; total: number };

// Приймає відповідь із бота. Правильність рахується тут, нарахування — атомарно
// в SQL (перший правильний виграє навіть при одночасних повідомленнях).
export async function submitQuizAnswer(
  tgId: string,
  displayName: string,
  rawText: string
): Promise<QuizSubmitResult> {
  const state = await getQuizState();
  const pub = publicState(state);
  if (pub.status !== 'running' || !state.sessionId) return { kind: 'not_running' };
  if (!pub.open) return { kind: 'too_late' };

  const q = quizQuestions()[state.qIndex];
  const correct = isCorrectAnswer(q, rawText);
  const { won, total } = await recordQuizAnswer({
    sessionId: state.sessionId,
    qIndex: state.qIndex,
    tgId,
    displayName,
    answer: rawText.slice(0, 300),
    correct,
    points: CFG.pointsPerWin,
  });

  if (won) return { kind: 'win', points: CFG.pointsPerWin, total };
  if (correct) return { kind: 'correct_late' };
  return { kind: 'wrong' };
}

export async function quizPointsFor(tgId: string): Promise<number> {
  return getQuizPoints(tgId);
}
