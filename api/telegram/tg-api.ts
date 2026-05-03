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

export async function sendPhotoByBuffer(
  chatId: number | string,
  buffer: Buffer,
  filename: string,
  caption?: string
): Promise<any> {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('photo', buffer, { filename, contentType: 'image/jpeg' });
  const res = await axios.post(apiUrl('sendPhoto'), form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 30000,
  });
  return res.data?.result;
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
