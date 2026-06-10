// Проксі фото справи: <img src> у віджеті → наш Vercel-handler → Telegram → байти.
//
// Кешування: відповідь має стабільний URL (токен підписує тільки caseId, без timestamp),
// тому Vercel Edge / CDN кешує її ~24h. Перший запит коштує getFile + download з TG,
// решта обслуговується з CDN безкоштовно.
//
// Авторизація: HMAC-токен на caseId (формат той самий що в core/cases.ts:imageTokenFor).
// Знати coreId + WEB_SESSION_SECRET — еквівалент «можу бачити це фото».
// Розголошення caseId через DOM віджета вже відбулось коли юзер його отримав.
import type { Request, Response } from 'express';
import { createHmac } from 'node:crypto';
import axios from 'axios';
import { getCaseFileId } from '../_telegram/storage.js';
import { tg } from '../_telegram/tg-api.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

function expectedToken(caseId: string): string {
  const secret = process.env.WEB_SESSION_SECRET || '';
  return createHmac('sha256', secret).update(`img:${caseId}`).digest('hex').slice(0, 32);
}

export async function proxyCaseImage(req: Request, res: Response) {
  const caseId = req.params.id;
  const token = String(req.query.t || '');
  if (!caseId || !token) return res.status(400).send('bad request');
  if (token !== expectedToken(caseId)) return res.status(403).send('invalid token');

  let fileId: string | null;
  try {
    fileId = await getCaseFileId(caseId);
  } catch (e: any) {
    console.error('image: getCaseFileId failed', e?.message || e);
    return res.status(500).send('internal');
  }
  if (fileId === null) return res.status(404).send('case not found');
  if (!fileId) return res.status(410).send('image unavailable');

  let filePath: string;
  try {
    const fileInfo = await tg('getFile', { file_id: fileId });
    filePath = fileInfo?.file_path;
    if (!filePath) return res.status(410).send('telegram file expired');
  } catch (e: any) {
    console.error('image: getFile failed', e?.message || e);
    return res.status(502).send('telegram error');
  }

  const botToken = process.env[telegramBotConfig.tg.botTokenEnv];
  if (!botToken) return res.status(500).send('bot token missing');
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

  try {
    const upstream = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const ct = upstream.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', ct);
    // CDN edge cache: 24h браузеру + 7 днів на CDN (s-maxage). Immutable бо URL стабільний.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.send(Buffer.from(upstream.data));
  } catch (e: any) {
    console.error('image: download failed', e?.message || e);
    res.status(502).send('download error');
  }
}
