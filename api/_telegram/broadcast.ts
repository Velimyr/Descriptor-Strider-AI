// Адмін-розсилки: воркер доставки. Кампанію створює ендпоінт у index.ts, а цей
// модуль домелює чергу батчами з тротлінгом — і при створенні, і на cron-tick.
// Егрес: воркер читає кожного отримувача РІВНО раз (claim-батч), display_name уже
// денормалізовано в рядку — жодних getUser під час розсилки.
import { BROADCAST_BUTTONS } from '../../src/telegram-bot/config.js';
import {
  getBroadcast,
  setBroadcastStatus,
  claimBroadcastBatch,
  reapBroadcastClaims,
  markBroadcastRecipient,
  incBroadcastCounters,
  countPendingRecipients,
  getActiveBroadcastId,
} from './storage.js';
import { sendMessage } from './tg-api.js';

const BATCH_SIZE = 20;
const THROTTLE_MS = 50;          // ~20 msg/s — нижче глобального ліміту Telegram (~30/s)
const REAP_AFTER_SEC = 120;      // завислі 'sending' старше 2 хв → назад у pending
const DEFAULT_BUDGET_MS = 45_000; // < maxDuration (60с)

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// Inline-клавіатура з обраних кнопок. callback_data = `bc:<id>:<action>` — бот логує
// клік і делегує наявній команді. Невідомі action ігноруємо (захист від старих даних).
export function buildBroadcastKeyboard(id: number, actions: string[]): any | undefined {
  const rows = actions
    .map(action => BROADCAST_BUTTONS.find(b => b.action === action))
    .filter((b): b is (typeof BROADCAST_BUTTONS)[number] => !!b)
    .map(b => [{ text: b.label, callback_data: `bc:${id}:${b.action}` }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

// Telegram-описи, що означають НЕВІДНОВНУ помилку: ретраї марні, одразу 'failed'.
function isPermanentFailure(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('blocked') ||           // bot was blocked by the user
    m.includes('deactivated') ||       // user is deactivated
    m.includes('chat not found') ||
    m.includes('user not found') ||
    m.includes("can't initiate") ||    // bot can't initiate conversation
    m.includes('bot was kicked') ||
    m.includes('have no rights')
  );
}

// Надсилання одному отримувачу з класифікацією помилки. Транзиентні (429/5xx/таймаут)
// — кілька спроб із бекофом; невідновні — одразу провал без ретраїв.
async function sendOne(tgId: string, text: string, replyMarkup: any): Promise<void> {
  const attempts = 3;
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      await sendMessage(tgId, text, {
        reply_markup: replyMarkup,
        disable_web_page_preview: true,
      });
      return;
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message || String(e);
      if (isPermanentFailure(msg)) throw e; // ретраї не допоможуть
      if (i < attempts - 1) await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

// Домелює одну кампанію в межах часового бюджету. Ідемпотентно й безпечно при
// паралельних викликах: claim-батч бере рядки через `for update skip locked`.
export async function drainBroadcast(
  id: number,
  budgetMs: number = DEFAULT_BUDGET_MS
): Promise<{ id: number; processed: number; sent: number; failed: number; done: boolean }> {
  const started = Date.now();
  let processed = 0;
  let sentTotal = 0;
  let failedTotal = 0;

  const bc = await getBroadcast(id);
  if (!bc) return { id, processed, sent: 0, failed: 0, done: true };
  if (bc.status === 'canceled' || bc.status === 'done') {
    return { id, processed, sent: 0, failed: 0, done: true };
  }

  // Повертаємо завислі claim-и попереднього (можливо, обірваного) воркера.
  await reapBroadcastClaims(id, REAP_AFTER_SEC).catch(() => {});

  if (bc.status === 'queued') {
    await setBroadcastStatus(id, 'sending', { startedAt: true });
  }

  const keyboard = buildBroadcastKeyboard(id, bc.buttons);

  while (Date.now() - started < budgetMs) {
    // Скасування могло прилетіти між батчами — перевіряємо дешевим читанням.
    const fresh = await getBroadcast(id);
    if (!fresh || fresh.status === 'canceled') break;

    const batch = await claimBroadcastBatch(id, BATCH_SIZE);
    if (batch.length === 0) break; // нічого pending (або все забрали інші воркери)

    let sent = 0;
    let failed = 0;
    for (const r of batch) {
      try {
        await sendOne(r.tgId, fresh.body, keyboard);
        await markBroadcastRecipient(id, r.tgId, 'sent');
        sent++;
      } catch (e: any) {
        await markBroadcastRecipient(id, r.tgId, 'failed', e?.message || String(e));
        failed++;
      }
      processed++;
      await sleep(THROTTLE_MS);
    }
    await incBroadcastCounters(id, sent, failed);
    sentTotal += sent;
    failedTotal += failed;
  }

  // Якщо більше нічого не лишилось — закриваємо кампанію.
  const pending = await countPendingRecipients(id);
  let done = false;
  if (pending === 0) {
    const cur = await getBroadcast(id);
    if (cur && cur.status === 'sending') {
      await setBroadcastStatus(id, 'done', { finishedAt: true });
    }
    done = true;
  }
  return { id, processed, sent: sentTotal, failed: failedTotal, done };
}

// Драйвер для cron: бере найстарішу активну кампанію й домелює її в межах бюджету.
export async function drainActiveBroadcasts(
  budgetMs: number = DEFAULT_BUDGET_MS
): Promise<{ drained: boolean; id?: number; result?: Awaited<ReturnType<typeof drainBroadcast>> }> {
  const id = await getActiveBroadcastId();
  if (id == null) return { drained: false };
  const result = await drainBroadcast(id, budgetMs);
  return { drained: true, id, result };
}
