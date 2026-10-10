// Telegram-бот поза Vercel: довгоживучий процес на VM (Oracle Always Free, див.
// docs/BOT_ORACLE.md). Сайт, віджет і адмінка лишаються на Vercel — тут лише:
//   • прийом апдейтів через long polling (getUpdates) замість вебхука;
//   • крони за київським часом замість GitHub Actions (розсилка справ, cleanup,
//     group-tick + домелювання розсилок, karma-ingest).
// Логіка та сама, що й на Vercel: апдейт → processUpdate, крони → ті самі
// /api/telegram/cron/* маршрути (локальний HTTP на 127.0.0.1, назовні не відкритий).
//
// Перемикання — в адмінці («Де працює бот», див. api/_telegram/botHost.ts):
//   • повідомлення: вебхук знято → цей процес забирає апдейти; вебхук на Vercel →
//     getUpdates отримує 409 і процес чекає, нічого не обробляючи;
//   • крони: тут виконуються лише коли прапорець у bot_meta = 'server'.
// Раз на 5 хв процес пише в bot_meta мітку «живий» — її показує адмінка.
import './bot-env.js';
import express from 'express';
import axios from 'axios';
import { execSync } from 'node:child_process';
import './api/_core/keepAlive.js';
import telegramRouter, { processUpdate } from './api/_telegram/index.js';
import { cronsRunHere, writeServerHeartbeat, type ServerHeartbeat } from './api/_telegram/botHost.js';
import { telegramBotConfig } from './src/telegram-bot/config.js';

const PORT = Number(process.env.BOT_PORT || 3100);
const TOKEN = process.env[telegramBotConfig.tg.botTokenEnv] || '';
const CRON_SECRET = process.env[telegramBotConfig.cronSecretEnv] || '';
// Необов'язково: URL пінгу healthchecks.io — сповістить, якщо процес завис/впав.
const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL || '';
const TZ = telegramBotConfig.dispatch.timezone || 'Europe/Kyiv';
// BOT_CRONS=off — аварійний вимикач: крони на цьому сервері не запускаються взагалі,
// навіть якщо в адмінці їх перемкнуто сюди. Звичайне перемикання — через адмінку.
const CRONS_ENABLED = !/^(off|0|false|no)$/i.test(process.env.BOT_CRONS || '');

if (!TOKEN) {
  console.error(`[bot] Missing env ${telegramBotConfig.tg.botTokenEnv}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
let stopping = false;

// ---------- Локальний HTTP лише для cron-маршрутів ----------
const app = express();
app.use('/api/telegram', telegramRouter);
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[bot] cron router on http://127.0.0.1:${PORT}`);
});

async function callCron(route: string): Promise<any> {
  const url = `http://127.0.0.1:${PORT}/api/telegram/cron/${route}?secret=${encodeURIComponent(CRON_SECRET)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// ---------- Long polling ----------
// Апдейти одного юзера обробляються строго по черзі (подвійні натискання, порядок
// відповідей), різних юзерів — паралельно, як і з вебхуком. Offset підтверджуємо
// одразу після отримання: при штатній зупинці ми дочікуємось черг (див. shutdown),
// тож втратитись може лише апдейт «в польоті» під час аварійного падіння.
const chains = new Map<string, Promise<void>>();
const pollAbort = new AbortController();

function updateKey(u: any): string {
  const id = u?.message?.from?.id ?? u?.message?.chat?.id ?? u?.callback_query?.from?.id;
  return id != null ? String(id) : `u${u?.update_id}`;
}

let updatesHandled = 0;
function enqueue(update: any) {
  const key = updateKey(update);
  updatesHandled++;
  const next = (chains.get(key) ?? Promise.resolve()).then(() => processUpdate(update));
  chains.set(key, next);
  next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
}

let lastHealthPing = 0;
function pingHealth() {
  if (!HEALTHCHECK_URL || Date.now() - lastHealthPing < 60_000) return;
  lastHealthPing = Date.now();
  axios.get(HEALTHCHECK_URL, { timeout: 10_000 }).catch(() => {});
}

// ---------- Мітка «сервер живий» (для адмінки) ----------
const STARTED_AT = new Date().toISOString();
const VERSION = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
})();
let pollState: ServerHeartbeat['polling'] = 'starting';

// Записи — строго по черзі, а стан береться на момент запису: інакше паралельні
// upsert-и могли б лишити в БД старіший стан.
let heartbeatChain = Promise.resolve();
function heartbeat() {
  heartbeatChain = heartbeatChain
    .then(() =>
      writeServerHeartbeat({
        at: new Date().toISOString(),
        startedAt: STARTED_AT,
        version: VERSION,
        polling: pollState,
        cronsEnv: CRONS_ENABLED,
        updatesHandled,
      })
    )
    .catch(e => console.error('[bot] heartbeat failed:', e?.message || e));
}

// Зміна стану прийому — в лог і одразу в мітку, щоб адмінка показала її без 5-хв затримки.
function setPollState(next: ServerHeartbeat['polling'], detail = '') {
  if (next === pollState) return;
  pollState = next;
  if (next === 'polling') console.log('[poll] прийом апдейтів активний (вебхук знято)');
  else if (next === 'conflict') console.log('[poll] вебхук встановлено — апдейти йдуть на Vercel, чекаю', detail);
  else if (next === 'error') console.error('[poll] getUpdates падає:', detail);
  heartbeat();
}

async function pollLoop() {
  let offset = 0;
  while (!stopping) {
    try {
      const res = await axios.post(
        `https://api.telegram.org/bot${TOKEN}/getUpdates`,
        // Той самий набір, що й у setWebhook (tg-api.ts).
        { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] },
        { timeout: 65_000, signal: pollAbort.signal }
      );
      setPollState('polling');
      for (const u of res.data?.result ?? []) {
        offset = u.update_id + 1;
        enqueue(u);
      }
      pingHealth();
    } catch (e: any) {
      if (stopping) break;
      const status = e?.response?.status;
      const desc = e?.response?.data?.description || e?.message;
      if (status === 409) {
        // Вебхук активний (бот працює через Vercel) або запущено другий інстанс.
        // 10 с — щоб після перемикання в адмінці сервер підхопив апдейти швидко.
        setPollState('conflict', desc);
        await sleep(10_000);
      } else {
        setPollState('error', `${status ?? ''} ${desc}`);
        await sleep(5_000);
      }
    }
  }
}

// ---------- Крони (київський час — перехід на зимовий/літній час не зсуває слоти) ----------
const { startHourKyiv, endHourKyiv, intervalHours } = telegramBotConfig.dispatch;
const DISPATCH_HOURS: number[] = [];
for (let h = startHourKyiv; h <= endHourKyiv; h += intervalHours) DISPATCH_HOURS.push(h);

// Раунд розсилки — чанками до 'done' (стан і ліза — у bot_meta, див. dispatchRound.ts).
async function runDispatch() {
  const { runDispatchTickChunk } = await import('./api/_telegram/dispatchRound.js');
  for (let i = 1; i <= 60 && !stopping; i++) {
    try {
      const r = await runDispatchTickChunk();
      console.log(`[cron] dispatch ${i}: status=${r.status} processed=${r.chunkProcessed ?? '-'} remaining=${r.remaining ?? '-'}${r.note ? ` note=${r.note}` : ''}`);
      if (r.status === 'done') return;
      await sleep(r.status === 'busy' ? 20_000 : 1_000);
    } catch (e: any) {
      console.error(`[cron] dispatch ${i} failed:`, e?.message || e);
      await sleep(10_000);
    }
  }
}

type Job = { name: string; due: (h: number, m: number) => boolean; run: () => Promise<unknown> };
const jobs: Job[] = [
  { name: 'dispatch', due: (h, m) => m === 0 && DISPATCH_HOURS.includes(h), run: runDispatch },
  { name: 'cleanup', due: (_h, m) => m === 15, run: () => callCron('cleanup') },
  // Сервер сам вирішує за київською годиною (морнінг/вечір/скіп); поза вікнами
  // лише домелює активну адмін-розсилку — тож смикаємо цілодобово.
  { name: 'group-tick', due: (_h, m) => m % 15 === 5, run: () => callCron('group-tick') },
  { name: 'karma-ingest', due: (h, m) => h === 4 && m === 0, run: () => callCron('karma-ingest') },
];

// Чи крони зараз за цим сервером (прапорець в адмінці). Лог — лише при зміні.
let cronsHereLogged: boolean | null = null;
async function cronsAllowed(): Promise<boolean> {
  const here = await cronsRunHere().catch(e => {
    console.error('[cron] не вдалося прочитати прапорець кронів:', e?.message || e);
    return false;
  });
  if (here !== cronsHereLogged) {
    console.log(here ? '[cron] крони виконуються тут' : '[cron] крони перемкнуто на Vercel — тут пропускаю');
    cronsHereLogged = here;
  }
  return here;
}

const running = new Map<string, Promise<void>>();
function startJob(job: Job) {
  if (running.has(job.name)) {
    console.warn(`[cron] ${job.name}: попередній запуск ще триває — пропускаю`);
    return;
  }
  const p = cronsAllowed()
    .then(allowed => (allowed ? job.run() : undefined))
    .then(r => {
      if (r !== undefined) console.log(`[cron] ${job.name}:`, JSON.stringify(r).slice(0, 500));
    })
    .catch(e => console.error(`[cron] ${job.name} failed:`, e?.message || e))
    .finally(() => running.delete(job.name));
  running.set(job.name, p);
}

const KYIV_HM = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
let lastMinute = '';
let minuteTimer: NodeJS.Timeout | undefined;
function onMinute() {
  const parts = KYIV_HM.formatToParts(new Date());
  const h = Number(parts.find(p => p.type === 'hour')?.value);
  const m = Number(parts.find(p => p.type === 'minute')?.value);
  const key = `${h}:${m}`;
  if (key === lastMinute) return;
  lastMinute = key;
  for (const job of jobs) if (job.due(h, m)) startJob(job);
}
function scheduleNextMinute() {
  // +1 с від межі хвилини, щоб не потрапити в попередню через дрейф таймера.
  const ms = 60_000 - (Date.now() % 60_000) + 1_000;
  minuteTimer = setTimeout(() => {
    onMinute();
    scheduleNextMinute();
  }, ms);
}

// ---------- Старт / зупинка ----------
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[bot] ${signal}: зупиняюсь, дочікуюсь обробки апдейтів…`);
  clearTimeout(minuteTimer);
  clearInterval(heartbeatTimer);
  pollAbort.abort();
  await Promise.race([
    Promise.allSettled([...chains.values(), ...running.values()]),
    sleep(30_000),
  ]);
  server.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void pollLoop();
heartbeat();
const heartbeatTimer = setInterval(heartbeat, 5 * 60_000);

if (!CRONS_ENABLED) {
  console.log(`[bot] старт ${VERSION}; крони вимкнено (BOT_CRONS=off) — лише прийом апдейтів`);
} else {
  console.log(`[bot] старт ${VERSION}; розсилка о ${DISPATCH_HOURS.join(', ')}:00 (${TZ}), якщо крони перемкнуто сюди`);
  scheduleNextMinute();
  // Процес перезапустили посеред розсилки — продовжуємо її (а не чекаємо наступного слоту).
  import('./api/_telegram/dispatchRound.js')
    .then(m => m.hasUnfinishedRound())
    .then(unfinished => {
      if (unfinished) {
        console.log('[bot] знайдено незавершений раунд розсилки — продовжую');
        startJob(jobs[0]);
      }
    })
    .catch(e => console.error('[bot] перевірка незавершеного раунду:', e?.message || e));
}
