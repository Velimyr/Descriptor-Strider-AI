// Бейджі (досягнення). Каталог — у config.badges. Кожен бейдж видається один раз
// і назавжди (PK у bot_user_badges). Картинки лежать у api/telegram/badges/ і
// кешуються як Telegram file_id у bot_meta (так само як онбординг-картинка).
import type { BadgeDef } from '../../src/types.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  getMeta,
  setMeta,
  getEarnedBadgeIds,
  grantBadges,
  countUserCases,
  patchUser,
} from './storage.js';
import { sendMessage, sendPhotoByFileId, sendPhotoByBuffer } from './tg-api.js';
import { nowIsoUtc } from './scheduler.js';

const T = telegramBotConfig.texts;

function esc(s: string): string {
  return s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] || ch));
}

function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? `{${k}}`));
}

// file_id картинки бейджа кешуємо в bot_meta('badge_file_id:<id>'). Якщо ще не
// залито — читаємо файл з диска, шлемо в канал, зберігаємо отриманий file_id.
async function getBadgeFileId(badge: BadgeDef): Promise<string | null> {
  const metaKey = `badge_file_id:${badge.id}`;
  const cached = await getMeta(metaKey);
  if (cached) return cached;
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    // На Vercel у бандл потрапляють лише файли, перелічені в includeFiles (vercel.json).
    const candidates = [
      path.join(process.cwd(), 'api', 'telegram', 'badges', badge.image),
      path.join(process.cwd(), 'public', 'badges', badge.image),
    ];
    let buf: Buffer | null = null;
    for (const p of candidates) {
      try {
        buf = await fs.readFile(p);
        if (buf) break;
      } catch {
        // спробуємо наступний шлях
      }
    }
    if (!buf) {
      console.warn('[badge] image not found', badge.image, candidates);
      return null;
    }
    const channelId = process.env[telegramBotConfig.tg.channelIdEnv];
    if (!channelId) return null;
    const res = await sendPhotoByBuffer(channelId, buf, badge.image);
    const photoArr = res?.photo || [];
    const fid = photoArr.length ? photoArr[photoArr.length - 1].file_id : '';
    if (fid) await setMeta(metaKey, fid);
    return fid || null;
  } catch (e) {
    console.error('getBadgeFileId failed', e);
    return null;
  }
}

// Скільки бейджів каталогу користувач уже отримав (для рядка «N/усього»).
export async function countEarnedInCatalog(
  tgId: string
): Promise<{ earned: number; total: number }> {
  const all = telegramBotConfig.badges;
  const earned = new Set(await getEarnedBadgeIds(tgId));
  return { earned: all.filter(b => earned.has(b.id)).length, total: all.length };
}

// Надсилає вітальну картку про здобутий бейдж (фото + текст + підказка про forward).
async function sendBadgeEarnedCard(chatId: number | string, badge: BadgeDef): Promise<void> {
  const caption =
    fmt(T.badgeEarned, { title: esc(badge.title), text: esc(badge.text) }) +
    `\n\n${T.badgeShareHint}`;
  const fid = await getBadgeFileId(badge);
  if (fid && caption.length <= 1024) {
    await sendPhotoByFileId(chatId, fid, caption);
    return;
  }
  if (fid) await sendPhotoByFileId(chatId, fid);
  await sendMessage(chatId, caption);
}

// Картка отриманого бейджа на вимогу (із розділу «Мої досягнення») для пересилання.
// Повертає false, якщо бейджа немає в каталозі або користувач його не має.
export async function sendBadgeCardById(
  chatId: number | string,
  tgId: string,
  badgeId: string
): Promise<boolean> {
  const badge = telegramBotConfig.badges.find(b => b.id === badgeId);
  if (!badge) return false;
  const earned = await getEarnedBadgeIds(tgId);
  if (!earned.includes(badgeId)) return false;
  const caption = `<b>${esc(badge.title)}</b>\n${esc(badge.text)}\n\n${T.badgeShareHint}`;
  const fid = await getBadgeFileId(badge);
  if (fid && caption.length <= 1024) {
    await sendPhotoByFileId(chatId, fid, caption);
  } else if (fid) {
    await sendPhotoByFileId(chatId, fid);
    await sendMessage(chatId, caption);
  } else {
    await sendMessage(chatId, caption);
  }
  return true;
}

// Розділ «Мої досягнення»: список усіх бейджів каталогу (✅ отримані / 🔒 ні)
// + кнопки для перегляду кожного отриманого (щоб переслати).
export async function sendBadgesList(chatId: number | string, tgId: string): Promise<void> {
  const all = telegramBotConfig.badges;
  if (all.length === 0) {
    await sendMessage(chatId, T.badgesListEmpty);
    return;
  }
  const earned = new Set(await getEarnedBadgeIds(tgId));
  const earnedCount = all.filter(b => earned.has(b.id)).length;
  const lines = all.map(b =>
    earned.has(b.id)
      ? `✅ <b>${esc(b.title)}</b> — ${esc(b.text)}`
      : `🔒 <b>${esc(b.title)}</b> — ${esc(b.hint || b.text)}`
  );
  const header = fmt(T.badgesListHeader, { earned: earnedCount, total: all.length });
  const body = `${header}\n\n${lines.join('\n')}`;
  const buttons = all
    .filter(b => earned.has(b.id))
    .map(b => [{ text: `📤 ${b.title}`, callback_data: `badge:${b.id}` }]);
  await sendMessage(
    chatId,
    body,
    buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}
  );
}

// Перевіряє критерії й видає нові бейджі. Викликається після нарахування балів.
// Best-effort: помилка тут НЕ має ламати основний flow підтвердження справи.
//
// Тиха видача існуючим: якщо badgesSeededAt порожній (юзер створений до фічі) —
// перша перевірка фіксує момент засіву й видає вже зароблені бейджі БЕЗ вітань.
// Новим юзерам бот ставить badgesSeededAt при /start, тож їхні досягнення сповіщаються.
export async function evaluateBadges(opts: {
  chatId: number | string;
  tgId: string;
  totalPoints: number;
  todayCount: number;
  badgesSeededAt: string;
}): Promise<void> {
  const all = telegramBotConfig.badges;
  if (all.length === 0) return;
  try {
    const earned = new Set(await getEarnedBadgeIds(opts.tgId));
    const candidates = all.filter(b => !earned.has(b.id));
    const seeded = !!opts.badgesSeededAt;

    if (candidates.length === 0) {
      if (!seeded) await patchUser(opts.tgId, { badgesSeededAt: nowIsoUtc() });
      return;
    }

    let casesTotal: number | null = null;
    const meets = async (b: BadgeDef): Promise<boolean> => {
      const c = b.criteria;
      if (c.type === 'total_points') return opts.totalPoints >= c.threshold;
      if (c.type === 'day_count') return opts.todayCount >= c.threshold;
      if (c.type === 'cases_total') {
        if (casesTotal === null) casesTotal = await countUserCases(opts.tgId);
        return casesTotal >= c.threshold;
      }
      return false;
    };

    const newly: BadgeDef[] = [];
    for (const b of candidates) if (await meets(b)) newly.push(b);

    if (newly.length) await grantBadges(opts.tgId, newly.map(b => b.id));

    if (!seeded) {
      // Перша перевірка для існуючого юзера — фіксуємо засів і нічого не шлемо.
      await patchUser(opts.tgId, { badgesSeededAt: nowIsoUtc() });
      return;
    }

    for (const b of newly) await sendBadgeEarnedCard(opts.chatId, b);
  } catch (e) {
    console.error('evaluateBadges failed', e);
  }
}
