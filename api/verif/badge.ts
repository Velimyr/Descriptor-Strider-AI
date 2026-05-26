// Віддає картинку бейджа за id (для картки-привітання на сайті перевірки).
// Картинки лежать у api/telegram/badges/. Якщо реального файлу бейджа ще нема —
// fallback на sample.png. Не секретні дані → без сесії.
import type { Request, Response } from 'express';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

export async function serveBadgeImage(req: Request, res: Response) {
  const id = req.params.id;
  const badge = telegramBotConfig.badges.find(b => b.id === id);
  if (!badge) return res.status(404).send('badge not found');

  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const candidates = [
      path.join(process.cwd(), 'api', 'telegram', 'badges', badge.image),
      path.join(process.cwd(), 'public', 'badges', badge.image),
      path.join(process.cwd(), 'api', 'telegram', 'badges', 'sample.png'),
    ];
    for (const p of candidates) {
      try {
        const buf = await fs.readFile(p);
        const ext = p.toLowerCase().split('.').pop() || 'png';
        const ct =
          ext === 'gif' ? 'image/gif'
          : ext === 'mp4' ? 'video/mp4'
          : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : 'image/png';
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(buf);
      } catch {
        // пробуємо наступний кандидат
      }
    }
    return res.status(404).send('image not found');
  } catch (e: any) {
    console.error('serveBadgeImage failed', e?.message || e);
    return res.status(500).send('internal');
  }
}
