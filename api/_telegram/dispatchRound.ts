// Поновлюваний dispatch-раунд («тік» розсилки справ).
//
// Проблема: розсилка по всіх активних юзерах перестала влазити в ліміт
// Vercel-функції (maxDuration 60 с) — функцію вбивало на середині, «хвіст»
// списку (стабільний порядок за tg_id) систематично лишався без справи,
// а curl у GH Actions падав по таймауту.
//
// Рішення: обробляємо юзерів чанками в межах часового бюджету. Стан раунду
// (курсор + накопичена статистика) живе в bot_meta під ключем tick_round;
// зовнішній cron викликає /cron/tick у циклі, поки не отримає status 'done'.
// Ліза tick_lease (bot_meta) гарантує, що два чанки не працюють одночасно.
//
// Ідемпотентність повторної обробки юзера (kill між флашами курсора):
// dispatchCaseToUser створює сесію, а юзерів з відкритою сесією тік скіпає
// (skipIfSessionOpen) — подвійної видачі справ не буде.

import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import { dispatchCaseToUser, sendScheduledGreeting } from './bot.js';
import { sendMessage } from './tg-api.js';
import {
  deleteSession,
  getActiveUserTgIds,
  getAllSessions,
  getCase,
  getMetaNoCache,
  getUserStatusCounts,
  recordSkippedCase,
  releaseLease,
  setMeta,
  tryClaimLease,
  unlockCase,
} from './storage.js';

const ROUND_KEY = 'tick_round';
const LEASE_KEY = 'tick_lease';

// Бюджет чанку. Воркери не беруть нового юзера після його вичерпання, тож
// реальний час = бюджет + «хвіст» юзерів у роботі — має лишатися < 60 с maxDuration.
const CHUNK_BUDGET_MS = 40_000;
// Ліза живе довше за чанк: якщо інстанс убито без release, наступний виклик
// перехопить протерміновану лізу CAS-ом (див. tryClaimLease).
const LEASE_TTL_MS = 90_000;
// Незавершений раунд старіший за це — застарілий (джоб розсилки помер давно):
// стартуємо новий з нуля, щоб поточний слот отримали ВСІ юзери, а не лише хвіст.
const STALE_ROUND_MS = 50 * 60_000;
// Завершений раунд молодший за це — новий не стартуємо (захист від подвійної
// розсилки при ручному ре-рані workflow). Обхід — параметр force.
const REDISPATCH_COOLDOWN_MS = 60 * 60_000;
// Флаш курсора кожні N опрацьованих юзерів — щоб kill посеред чанку коштував
// повторної обробки максимум N юзерів (яких захистить skipIfSessionOpen).
const CURSOR_FLUSH_EVERY = 25;
const CONCURRENCY = 6;

interface RoundStats {
  totalUsers: number;
  activeUsers: number;
  pausedUsers: number;
  skippedSessionOpen: number;
  sent: number;
  noCases: number;
  errors: number;
}

interface RoundState {
  startedAt: string;
  // Останній tg_id, до якого включно ВСІ юзери опрацьовані ('' = початок).
  cursor: string;
  done: boolean;
  chunks: number;
  stats: RoundStats;
  finishedAt?: string;
}

export interface TickChunkResult {
  status: 'busy' | 'partial' | 'done';
  note?: string;
  chunkProcessed?: number;
  remaining?: number;
  chunks?: number;
  stats?: RoundStats;
  dispatched?: any[];
}

export async function runDispatchTickChunk(opts?: { force?: boolean }): Promise<TickChunkResult> {
  if (!(await tryClaimLease(LEASE_KEY, LEASE_TTL_MS))) {
    return { status: 'busy', note: 'another chunk in progress' };
  }
  try {
    return await runChunkUnderLease(opts?.force === true);
  } finally {
    try {
      await releaseLease(LEASE_KEY);
    } catch (e) {
      console.error('[tick] lease release failed (перехопиться по TTL)', e);
    }
  }
}

async function runChunkUnderLease(force: boolean): Promise<TickChunkResult> {
  const now = Date.now();
  let round = await readRound();

  const continuable =
    round && !round.done && now - Date.parse(round.startedAt) < STALE_ROUND_MS;
  if (!continuable) {
    if (
      !force &&
      round?.done &&
      round.finishedAt &&
      now - Date.parse(round.finishedAt) < REDISPATCH_COOLDOWN_MS
    ) {
      return { status: 'done', note: 'recent-round', stats: round.stats };
    }
    const counts = await getUserStatusCounts();
    round = {
      startedAt: new Date().toISOString(),
      cursor: '',
      done: false,
      chunks: 0,
      stats: {
        totalUsers: counts.total,
        activeUsers: 0,
        pausedUsers: counts.paused,
        skippedSessionOpen: 0,
        sent: 0,
        noCases: 0,
        errors: 0,
      },
    };
  }
  const state = round!;

  const cfg = telegramBotConfig.dispatch;
  // Egress: тільки tg_id активних юзерів (~10 байт/юзер) + мапа сесій.
  const [activeTgIds, sessions] = await Promise.all([getActiveUserTgIds(), getAllSessions()]);
  const sessionMap = new Map(sessions.map(s => [s.tgId, s]));

  // Порядок і курсор — числові: tg_id це десяткові числа, а текстовий порядок
  // Postgres залежить від колації ("10" < "9") — покладатись на нього не можна.
  const cursorNum = state.cursor ? Number(state.cursor) : 0;
  const queue = activeTgIds
    .filter(id => Number(id) > cursorNum)
    .sort((a, b) => Number(a) - Number(b));

  const results: any[] = [];
  const startMs = Date.now();

  // Курсор просуваємо лише по НЕПЕРЕРВНО завершених юзерах: якщо інстанс
  // уб'ють, ніхто з іще-в-роботі не опиниться «за курсором» неопрацьованим.
  const pulledOrder: string[] = [];
  const completed = new Set<string>();
  let boundary = state.cursor;
  let boundaryIdx = 0;
  const advanceBoundary = () => {
    while (boundaryIdx < pulledOrder.length && completed.has(pulledOrder[boundaryIdx])) {
      boundary = pulledOrder[boundaryIdx];
      boundaryIdx++;
    }
  };
  let sinceFlush = 0;
  const persist = async () => {
    state.cursor = boundary;
    await setMeta(ROUND_KEY, JSON.stringify(state));
  };

  const processOne = async (tgId: string) => {
    state.stats.activeUsers++;

    const session = sessionMap.get(tgId);
    if (session && cfg.skipIfSessionOpen) {
      const ageMs = Date.now() - new Date(session.updatedAt || session.startedAt).getTime();
      const ttlMs = cfg.sessionTtlHours * 3600 * 1000;
      if (ageMs > ttlMs) {
        await deleteSession(tgId);
        // Звільняємо collab-лок і фіксуємо «пропущено», щоб ту саму справу не показати знову.
        if (session.caseId) {
          try {
            const cse = await getCase(session.caseId);
            if (cse?.mode === 'collaborative' && cse.lockedByTgId === tgId) {
              await unlockCase(session.caseId);
            }
            await recordSkippedCase(tgId, session.caseId);
          } catch (e) {
            console.error('unlockCase/skip on tick-expiry failed', session.caseId, e);
          }
        }
        // Повідомляємо користувача про прострочену справу.
        try {
          const notice = telegramBotConfig.texts.sessionExpiredNotice.replace(
            '{button}',
            telegramBotConfig.texts.menuNext
          );
          await sendMessage(tgId, notice);
        } catch (e) {
          console.error('tick-expiry notice failed', tgId, e);
        }
      } else {
        state.stats.skippedSessionOpen++;
        results.push({ tgId, skipped: 'session-open' });
        return;
      }
    }

    try {
      try {
        await sendScheduledGreeting(tgId);
      } catch (e) {
        console.error('greeting failed', tgId, e);
      }
      const sent = await dispatchCaseToUser(tgId, false);
      if (sent) {
        state.stats.sent++;
        results.push({ tgId, sent: true });
      } else {
        state.stats.noCases++;
        results.push({ tgId, sent: false, reason: 'no-cases-or-inactive' });
      }
    } catch (e: any) {
      state.stats.errors++;
      results.push({ tgId, error: e.message });
    }
  };

  const runWorker = async () => {
    while (queue.length > 0 && Date.now() - startMs < CHUNK_BUDGET_MS) {
      const tgId = queue.shift();
      if (!tgId) break;
      pulledOrder.push(tgId);
      await processOne(tgId);
      completed.add(tgId);
      advanceBoundary();
      if (++sinceFlush >= CURSOR_FLUSH_EVERY) {
        sinceFlush = 0;
        try {
          await persist();
        } catch (e) {
          console.error('[tick] cursor flush failed', e);
        }
      }
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(runWorker());
  await Promise.all(workers);

  advanceBoundary();
  const finished = queue.length === 0;
  state.chunks += 1;
  if (finished) {
    state.done = true;
    state.finishedAt = new Date().toISOString();
  }
  state.cursor = boundary;
  await setMeta(ROUND_KEY, JSON.stringify(state));

  console.log('[tick] chunk', {
    finished,
    chunkProcessed: pulledOrder.length,
    remaining: queue.length,
    chunks: state.chunks,
    stats: state.stats,
  });
  return {
    status: finished ? 'done' : 'partial',
    chunkProcessed: pulledOrder.length,
    remaining: queue.length,
    chunks: state.chunks,
    stats: state.stats,
    dispatched: results,
  };
}

async function readRound(): Promise<RoundState | null> {
  const raw = await getMetaNoCache(ROUND_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RoundState;
  } catch {
    return null;
  }
}
