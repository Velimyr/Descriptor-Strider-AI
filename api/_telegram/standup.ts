// «Архівний стендап» — друга гра стріму (вкладка на сторінці /quiz).
// Сценарій раунду: ведучий показує тему → фаза 'thinking' (хвилина на жарт, у боті
// зʼявляється кнопка «Готовий жартувати») → ведучий клікає по картці учасника, той
// виходить «на сцену» (фаза 'performing', голосування відкривається одразу) →
// ведучий запускає хвилинний лічильник голосування → викликає наступного.
// «Наступна тема» закриває раунд: хто набрав найбільше лайків, отримує бали
// в СПІЛЬНИЙ із вікториною рейтинг (bot_quiz_scores).
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import type { StandupQuestion } from '../../src/telegram-bot/config.js';
import {
  getStandupState,
  setStandupState,
  addStandupSignup,
  getStandupSignup,
  markStandupPerformed,
  addStandupVote,
  awardStandupRound,
} from './storage.js';
import type { StandupStateRow, StandupWinner } from './storage.js';

const CFG = telegramBotConfig.standup;
const T = telegramBotConfig.texts;

function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? `{${k}}`));
}

// Переможцям раунду шлемо особисте привітання. Best-effort: збій повідомлення
// не має валити нарахування (бали вже в БД).
async function notifyWinners(winners: StandupWinner[]): Promise<void> {
  if (winners.length === 0) return;
  try {
    const { sendMessage } = await import('./tg-api.js');
    const names = winners.map(w => w.displayName || '—').join(', ');
    const text = fmt(T.standupRoundWinner, { winners: names, points: CFG.pointsPerWin });
    await Promise.all(
      winners.map(w =>
        sendMessage(w.tgId, text).catch(e => console.error('standup notify failed', w.tgId, e?.message || e))
      )
    );
  } catch (e: any) {
    console.error('standup notifyWinners failed', e?.message || e);
  }
}

export function standupQuestions(): StandupQuestion[] {
  return CFG.questions || [];
}

export interface StandupPublicState {
  status: 'idle' | 'running' | 'finished';
  sessionId: string;
  qIndex: number;
  total: number;
  phase: 'thinking' | 'performing' | 'results';
  performerTgId: string;
  // Секунди до кінця поточного відліку (0 — відліку немає або він вичерпаний).
  secondsLeft: number;
  endsAt: string;
  // Чи має відлік узагалі (у фазі 'performing' лічильник запускає ведучий).
  hasTimer: boolean;
  signupOpen: boolean;
  voteOpen: boolean;
}

export function publicState(state: StandupStateRow, now = Date.now()): StandupPublicState {
  const endsMs = state.endsAt ? new Date(state.endsAt).getTime() : 0;
  const secondsLeft = endsMs > now ? Math.ceil((endsMs - now) / 1000) : 0;
  const running = state.status === 'running';
  return {
    status: state.status,
    sessionId: state.sessionId,
    qIndex: state.qIndex,
    total: standupQuestions().length,
    phase: state.phase,
    performerTgId: state.performerTgId,
    secondsLeft,
    endsAt: state.endsAt,
    hasTimer: !!endsMs,
    // Записатися можна і поки думають, і поки хтось виступає (жарт міг дозріти пізніше).
    signupOpen: running && (state.phase === 'thinking' || state.phase === 'performing'),
    // Голосування відкрите з моменту виклику на сцену; закривається, коли
    // вичерпано лічильник, який запустив ведучий.
    voteOpen:
      running &&
      state.phase === 'performing' &&
      !!state.performerTgId &&
      (!endsMs || endsMs > now),
  };
}

function endsAtIn(seconds: number): string {
  return new Date(Date.now() + Math.max(5, seconds) * 1000).toISOString();
}

// ---------- Керування (сторінка ведучого) ----------

export async function startStandup(): Promise<StandupStateRow> {
  if (standupQuestions().length === 0) throw new Error('standup_no_questions');
  const state: StandupStateRow = {
    sessionId: `s${Date.now().toString(36)}`,
    status: 'running',
    qIndex: 0,
    phase: 'thinking',
    performerTgId: '',
    endsAt: endsAtIn(CFG.thinkSeconds),
  };
  await setStandupState(state);
  return state;
}

// Викликати учасника на сцену. Голосування за нього відкривається одразу,
// лічильник — окремою дією ведучого (людина ще може розповідати жарт).
export async function callPerformer(tgId: string): Promise<StandupStateRow> {
  const cur = await getStandupState();
  if (cur.status !== 'running') return cur;
  // Попереднього виступаючого закривати не треба: лайки прив'язані до performer_tg_id,
  // а не до стану, тож нічого не губиться.
  const state: StandupStateRow = {
    ...cur,
    phase: 'performing',
    performerTgId: tgId,
    endsAt: '',
  };
  await setStandupState(state);
  await markStandupPerformed(cur.sessionId, cur.qIndex, tgId);
  return state;
}

export async function startVoteTimer(): Promise<StandupStateRow> {
  const cur = await getStandupState();
  if (cur.status !== 'running' || cur.phase !== 'performing') return cur;
  const state: StandupStateRow = { ...cur, endsAt: endsAtIn(CFG.voteSeconds) };
  await setStandupState(state);
  return state;
}

// Перезапустити хвилину на вигадування (якщо ведучому треба дати ще часу).
export async function restartThinking(): Promise<StandupStateRow> {
  const cur = await getStandupState();
  if (cur.status !== 'running') return cur;
  const state: StandupStateRow = {
    ...cur,
    phase: 'thinking',
    performerTgId: '',
    endsAt: endsAtIn(CFG.thinkSeconds),
  };
  await setStandupState(state);
  return state;
}

export interface RoundResult {
  state: StandupStateRow;
  winners: StandupWinner[];
}

// Наступна тема: спершу закриваємо поточний раунд (нарахування переможцям),
// потім переходимо далі. Якщо теми скінчились — стендап завершується.
export async function nextRound(): Promise<RoundResult> {
  const cur = await getStandupState();
  if (cur.status !== 'running') return { state: await startStandup(), winners: [] };
  const winners = await awardStandupRound(cur.sessionId, cur.qIndex, CFG.pointsPerWin);
  await notifyWinners(winners);
  const nextIndex = cur.qIndex + 1;
  if (nextIndex >= standupQuestions().length) {
    const done: StandupStateRow = { ...cur, status: 'finished', phase: 'results', performerTgId: '', endsAt: '' };
    await setStandupState(done);
    return { state: done, winners };
  }
  const state: StandupStateRow = {
    ...cur,
    qIndex: nextIndex,
    phase: 'thinking',
    performerTgId: '',
    endsAt: endsAtIn(CFG.thinkSeconds),
  };
  await setStandupState(state);
  return { state, winners };
}

export async function stopStandup(): Promise<RoundResult> {
  const cur = await getStandupState();
  const winners =
    cur.status === 'running' && cur.sessionId
      ? await awardStandupRound(cur.sessionId, cur.qIndex, CFG.pointsPerWin)
      : [];
  await notifyWinners(winners);
  const state: StandupStateRow = {
    ...cur,
    status: 'finished',
    phase: 'results',
    performerTgId: '',
    endsAt: '',
  };
  await setStandupState(state);
  return { state, winners };
}

// ---------- Дії учасників (бот) ----------

export type SignupResult =
  | { kind: 'ok'; qIndex: number }
  | { kind: 'already' }
  | { kind: 'performed' }
  | { kind: 'closed' };

export async function signUp(
  tgId: string,
  displayName: string,
  hasPhoto: boolean
): Promise<SignupResult> {
  const state = await getStandupState();
  const pub = publicState(state);
  if (!pub.signupOpen) return { kind: 'closed' };
  const existing = await getStandupSignup(state.sessionId, state.qIndex, tgId);
  if (existing?.performed) return { kind: 'performed' };
  if (existing) return { kind: 'already' };
  await addStandupSignup({
    sessionId: state.sessionId,
    qIndex: state.qIndex,
    tgId,
    displayName,
    hasPhoto,
  });
  return { kind: 'ok', qIndex: state.qIndex };
}

export type VoteResult =
  | { kind: 'ok'; performerTgId: string }
  | { kind: 'duplicate' }
  | { kind: 'self' }
  | { kind: 'closed' };

// Лайк тому, хто зараз на сцені. performerTgId у callback-у не довіряємо —
// беремо з актуального стану (щоб не можна було лайкати «заднім числом»).
export async function vote(voterTgId: string): Promise<VoteResult> {
  const state = await getStandupState();
  const pub = publicState(state);
  if (!pub.voteOpen) return { kind: 'closed' };
  if (state.performerTgId === voterTgId) return { kind: 'self' };
  const ok = await addStandupVote({
    sessionId: state.sessionId,
    qIndex: state.qIndex,
    performerTgId: state.performerTgId,
    voterTgId,
  });
  return ok ? { kind: 'ok', performerTgId: state.performerTgId } : { kind: 'duplicate' };
}
