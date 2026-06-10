// Проксі зображення verif-справи: <img src> → цей handler → Telegram → байти.
// Авторизація — HMAC-токен на caseId (verifImageToken), як у віджеті. Кеш на CDN.
import type { Request, Response } from 'express';
import axios from 'axios';
import { getVerifCaseFileId, verifImageToken } from '../core/verifCases.js';
import { tg } from '../telegram/tg-api.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

export async function proxyVerifImage(req: Request, res: Response) {
  const caseId = req.params.id;
  const token = String(req.query.t || '');
  if (!caseId || !token) return res.status(400).send('bad request');
  if (token !== verifImageToken(caseId)) return res.status(403).send('invalid token');

  let fileId: string | null;
  try {
    fileId = await getVerifCaseFileId(caseId);
  } catch (e: any) {
    console.error('verif image: getVerifCaseFileId failed', e?.message || e);
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
    console.error('verif image: getFile failed', e?.message || e);
    return res.status(502).send('telegram error');
  }

  const botToken = process.env[telegramBotConfig.tg.botTokenEnv];
  if (!botToken) return res.status(500).send('bot token missing');
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

  try {
    const upstream = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 15000 });
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.send(Buffer.from(upstream.data));
  } catch (e: any) {
    console.error('verif image: download failed', e?.message || e);
    res.status(502).send('download error');
  }
}
