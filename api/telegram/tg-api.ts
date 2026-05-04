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

export async function sendPhotoByBuffer(
  chatId: number | string,
  buffer: Buffer,
  filename: string,
  caption?: string
): Promise<any> {
  // Базова пауза між відправками у канал.
  const wait = lastChannelSendAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append('photo', buffer, { filename, contentType: 'image/jpeg' });
    try {
      const res = await axios.post(apiUrl('sendPhoto'), form, {
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
        console.warn(
          `[sendPhotoByBuffer] 429 — sleeping ${waitMs}ms (attempt ${attempt}/${maxAttempts - 1})`
        );
        await sleep(waitMs);
        continue;
      }
      // інша помилка — кидаємо нагору
      throw new Error(
        `sendPhoto: ${data?.description || e.message} (status ${status || '?'})`
      );
    }
  }
  throw new Error('sendPhoto: всі спроби вичерпані (429)');
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return tg('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
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
