import axios from 'axios';
import FormData from 'form-data';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

function token(): string {
  const t = process.env[telegramBotConfig.tg.botTokenEnv];
  if (!t) throw new Error(`Missing env ${telegramBotConfig.tg.botTokenEnv}`);
  return t;
}

function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${token()}/${method}`;
}

export async function tg(method: string, payload: any = {}): Promise<any> {
  try {
    const res = await axios.post(apiUrl(method), payload, { timeout: 8000 });
    return res.data?.result;
  } catch (e: any) {
    const data = e?.response?.data;
    console.error(`Telegram API ${method} failed:`, data || e.message);
    throw new Error(`tg(${method}): ${data?.description || e.message}`);
  }
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  extra: any = {}
): Promise<any> {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

export async function sendPhotoByFileId(
  chatId: number | string,
  fileId: string,
  caption?: string,
  extra: any = {}
): Promise<any> {
  return tg('sendPhoto', { chat_id: chatId, photo: fileId, caption, parse_mode: 'HTML', ...extra });
}

// Telegram дозволяє ~1 повідомлення/сек у канал. Тримаємо мін. інтервал щоб
// не ловити 429. Цей лічильник живе в межах "теплого" Vercel-інстансу.
let lastChannelSendAt = 0;
const MIN_INTERVAL_MS = 1200;

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// Універсальне завантаження медіа-буфера в чат/канал з пейсингом і ретраєм на 429.
// method: 'sendPhoto' | 'sendAnimation'; field: 'photo' | 'animation'.
async function sendMediaByBuffer(
  method: string,
  field: string,
  contentType: string,
  chatId: number | string,
  buffer: Buffer,
  filename: string,
  caption?: string
): Promise<any> {
  const wait = lastChannelSendAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append(field, buffer, { filename, contentType });
    try {
      const res = await axios.post(apiUrl(method), form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 30000,
      });
      lastChannelSendAt = Date.now();
      return res.data?.result;
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      const retryAfterTg = Number(data?.parameters?.retry_after);
      const retryAfterHdr = Number(e?.response?.headers?.['retry-after']);
      const retryAfter = retryAfterTg || retryAfterHdr || 0;
      if ((status === 429 || data?.error_code === 429) && attempt < maxAttempts) {
        const waitMs = (retryAfter || attempt * 2) * 1000 + 300;
        console.warn(`[${method}] 429 — sleeping ${waitMs}ms (attempt ${attempt}/${maxAttempts - 1})`);
        await sleep(waitMs);
        continue;
      }
      throw new Error(`${method}: ${data?.description || e.message} (status ${status || '?'})`);
    }
  }
  throw new Error(`${method}: всі спроби вичерпані (429)`);
}

export function sendPhotoByBuffer(
  chatId: number | string,
  buffer: Buffer,
  filename: string,
  caption?: string
): Promise<any> {
  return sendMediaByBuffer('sendPhoto', 'photo', 'image/jpeg', chatId, buffer, filename, caption);
}

// Анімація (GIF або MP4): Telegram програє інлайн (для MP4 — нативно, GIF конвертує в MP4).
export function sendAnimationByBuffer(
  chatId: number | string,
  buffer: Buffer,
  filename: string,
  caption?: string,
  contentType: string = 'image/gif'
): Promise<any> {
  return sendMediaByBuffer('sendAnimation', 'animation', contentType, chatId, buffer, filename, caption);
}

export async function sendAnimationByFileId(
  chatId: number | string,
  fileId: string,
  caption?: string,
  extra: any = {}
): Promise<any> {
  return tg('sendAnimation', { chat_id: chatId, animation: fileId, caption, parse_mode: 'HTML', ...extra });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return tg('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

// Завантажує файл Telegram за file_id і повертає base64 + mime (для передачі в Gemini).
// null, якщо файл недоступний (застарів тощо).
export async function downloadTelegramFileBase64(
  fileId: string
): Promise<{ base64: string; mime: string } | null> {
  const info = await tg('getFile', { file_id: fileId });
  const filePath = info?.file_path;
  if (!filePath) return null;
  const botToken = process.env[telegramBotConfig.tg.botTokenEnv];
  if (!botToken) throw new Error('bot token missing');
  const upstream = await axios.get(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
    { responseType: 'arraybuffer', timeout: 15000 }
  );
  const mime = upstream.headers['content-type'] || 'image/jpeg';
  return { base64: Buffer.from(upstream.data).toString('base64'), mime };
}

// Видалення повідомлення (напр. одразу прибрати повідомлення користувача з API-ключем).
// Не кидаємо помилку — видалення може бути недоступне (старе повідомлення тощо).
export async function deleteMessage(chatId: number | string, messageId: number): Promise<void> {
  try {
    await tg('deleteMessage', { chat_id: chatId, message_id: messageId });
  } catch (e) {
    console.warn('deleteMessage failed', e);
  }
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  extra: any = {}
) {
  return tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

export async function setWebhook(url: string, secretToken: string) {
  return tg('setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
  });
}

export async function deleteWebhook() {
  return tg('deleteWebhook', {});
}

export async function getWebhookInfo() {
  return tg('getWebhookInfo', {});
}
