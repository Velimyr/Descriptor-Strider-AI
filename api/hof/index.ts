// Public Hall of Fame API: переможці «Працівників місяця» + проксі їхніх фото.
// Без авторизації — це публічна інформація (юзер сам опублікував фото у профілі).
// Захист від зловживань: фото віддаємо лише тим юзерам, що є у топ-3 хоча б одного місяця.
import express from 'express';
import axios from 'axios';
import {
  db,
  T,
  getMonthlyLeaderboard,
  getDisplayNamesMap,
} from '../telegram/storage.js';
import { tg } from '../telegram/tg-api.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

const router = express.Router();

// 'YYYY-MM' у Europe/Kyiv для дати (за замовч. — поточна).
function kyivMonth(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: telegramBotConfig.dispatch.timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value ?? '';
  const m = parts.find(p => p.type === 'month')?.value ?? '';
  return `${y}-${m}`;
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 2, 15));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

// In-memory кеш «топ-3 за місяць» для photo-proxy guard.
// TTL 10 хв — на випадок якщо адмін відкоригує бали в перші дні місяця.
let topCache: { tgIds: Set<string>; expires: number } | null = null;
const CACHE_TTL_MS = 10 * 60_000;

async function isInRecentTop3(tgId: string): Promise<boolean> {
  if (topCache && topCache.expires > Date.now()) {
    return topCache.tgIds.has(tgId);
  }
  const tgIds = new Set<string>();
  try {
    // Беремо всі унікальні місяці, для яких є записи.
    const months = new Set<string>();
    const { data, error } = await db()
      .from(T.monthlyPoints)
      .select('month')
      .order('month', { ascending: false })
      .limit(50_000);
    if (!error && data) {
      for (const r of data) months.add(String((r as any).month));
    }
    // Для кожного місяця — топ-3 учасники.
    for (const m of months) {
      const lb = await getMonthlyLeaderboard(m);
      for (const u of lb.slice(0, 3)) tgIds.add(u.tgId);
    }
  } catch (e) {
    console.warn('isInRecentTop3 build cache failed', e);
  }
  topCache = { tgIds, expires: Date.now() + CACHE_TTL_MS };
  return tgIds.has(tgId);
}

// GET /api/hof?month=YYYY-MM
// За замовчуванням — попередній місяць (для попап-вітання у новому місяці).
router.get('/', async (req, res) => {
  const monthQ = String(req.query.month || '').trim();
  const validQ = /^\d{4}-\d{2}$/.test(monthQ);
  const month = validQ ? monthQ : previousMonth(kyivMonth());
  try {
    const lb = await getMonthlyLeaderboard(month);
    const top = lb.slice(0, 3);
    if (top.length === 0) {
      return res.json({ month, winners: [] });
    }
    // Тягнемо публічні поля (city, photoFileId).
    const { data, error } = await db()
      .from(T.users)
      .select('tg_id, display_name, city, photo_file_id')
      .in('tg_id', top.map(t => t.tgId));
    if (error) throw error;
    const meta = new Map<string, any>();
    for (const r of data || []) meta.set(String((r as any).tg_id), r);
    // displayName fallback з monthly_points (денормалізована копія).
    const fallbackNames = await getDisplayNamesMap(top.map(t => t.tgId));
    const winners = top.map((t, i) => {
      const m = meta.get(t.tgId);
      return {
        place: i + 1,
        tgId: t.tgId,
        displayName: (m?.display_name as string) || fallbackNames[t.tgId] || t.displayName || '',
        points: Math.round(t.points * 100) / 100,
        city: (m?.city as string) || '',
        hasPhoto: !!(m?.photo_file_id),
      };
    });
    res.set('Cache-Control', 'public, max-age=600, s-maxage=600');
    res.json({ month, winners });
  } catch (e: any) {
    console.error('hof failed', e?.message || e);
    res.status(500).json({ error: 'internal' });
  }
});

// GET /api/hof/photo/:tgId — публічне фото юзера. Віддаємо лише якщо юзер у топ-3
// хоча б якогось місяця (щоб не перетворювати на проксі всіх юзерів).
router.get('/photo/:tgId', async (req, res) => {
  const tgId = req.params.tgId;
  try {
    if (!(await isInRecentTop3(tgId))) return res.status(403).send('forbidden');
    const { data, error } = await db()
      .from(T.users)
      .select('photo_file_id')
      .eq('tg_id', tgId)
      .maybeSingle();
    if (error) throw error;
    const fileId = (data as any)?.photo_file_id || '';
    if (!fileId) return res.status(404).send('no photo');
    const info = await tg('getFile', { file_id: fileId });
    const filePath = info?.file_path;
    if (!filePath) return res.status(410).send('telegram file expired');
    const botToken = process.env[telegramBotConfig.tg.botTokenEnv];
    if (!botToken) return res.status(500).send('bot token missing');
    const upstream = await axios.get(
      `https://api.telegram.org/file/bot${botToken}/${filePath}`,
      { responseType: 'arraybuffer', timeout: 15000 }
    );
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.send(Buffer.from(upstream.data));
  } catch (e: any) {
    console.error('hof photo failed', e?.message || e);
    res.status(502).send('download error');
  }
});

export default router;
