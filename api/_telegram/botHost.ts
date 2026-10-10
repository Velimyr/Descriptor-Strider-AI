// Де працює бот: Vercel чи окремий сервер (bot-server.ts). Перемикається з адмінки
// окремо для двох речей:
//   • повідомлення — джерело правди сам Telegram: вебхук встановлено → Vercel,
//     вебхука нема → сервер забирає апдейти через getUpdates;
//   • крони — прапорець у bot_meta. Обидва планувальники (GitHub Actions → Vercel і
//     сервер) працюють завжди, а виконує крон лише той бік, на який указує прапорець.
import { getMetaNoCache, setMeta } from './storage.js';

export type BotHost = 'vercel' | 'server';

const CRONS_KEY = 'host_crons';
export const HEARTBEAT_KEY = 'server_heartbeat';

// Що сервер періодично пише в bot_meta (див. bot-server.ts) — для індикатора в адмінці.
export interface ServerHeartbeat {
  at: string;
  startedAt: string;
  version: string;
  // polling — забирає апдейти; conflict — вебхук на Vercel, чекає; error — getUpdates падає.
  polling: 'polling' | 'conflict' | 'error' | 'starting';
  cronsEnv: boolean;      // false = BOT_CRONS=off: крони на сервері вимкнено незалежно від прапорця
  updatesHandled: number; // з моменту старту процесу
}

// bot-server.ts виставляє BOT_RUNTIME=server; усе інше (Vercel, локальний dev) — 'vercel'.
export function thisHost(): BotHost {
  return process.env.BOT_RUNTIME === 'server' ? 'server' : 'vercel';
}

// Без прапорця — Vercel (так було до появи сервера).
export async function getCronsHost(): Promise<BotHost> {
  return (await getMetaNoCache(CRONS_KEY)) === 'server' ? 'server' : 'vercel';
}

export async function setCronsHost(host: BotHost): Promise<void> {
  await setMeta(CRONS_KEY, host);
}

export async function cronsRunHere(): Promise<boolean> {
  return (await getCronsHost()) === thisHost();
}

export async function getServerHeartbeat(): Promise<ServerHeartbeat | null> {
  const raw = await getMetaNoCache(HEARTBEAT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServerHeartbeat;
  } catch {
    return null;
  }
}

export async function writeServerHeartbeat(hb: ServerHeartbeat): Promise<void> {
  await setMeta(HEARTBEAT_KEY, JSON.stringify(hb));
}

// Куди ставити вебхук «на Vercel» — за системними змінними Vercel, а не за адресою з
// браузера (адмінку можна відкрити із «замороженої» адреси конкретного деплою):
//   • продовий деплой → продовий домен проєкту;
//   • preview (dev = гілка develop того ж проєкту) → адреса гілки: стабільна й завжди
//     веде на її останній деплой. Продовий домен тут не годиться — dev-бот пішов би в прод.
// null — не на Vercel (локальний dev): тоді адреса з браузера.
export function webhookUrlForThisDeployment(): string | null {
  const env = process.env.VERCEL_ENV;
  const host =
    env === 'production' ? process.env.VERCEL_PROJECT_PRODUCTION_URL
    : env === 'preview' ? process.env.VERCEL_BRANCH_URL
    : undefined;
  return host ? `https://${host}/api/telegram/webhook` : null;
}
