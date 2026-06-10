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
  countUserVerifications,
  sumUserCorrectedWords,
  patchUser,
} from './storage.js';
import {
  sendMessage,
  sendPhotoByFileId,
  sendPhotoByBuffer,
  sendAnimationByFileId,
  sendAnimationByBuffer,
} from './tg-api.js';
import { nowIsoUtc } from './scheduler.js';

const T = telegramBotConfig.texts;

function esc(s: string): string {
  return s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] || ch));
}

function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? `{${k}}`));
}

type BadgeMedia = { fileId: string; kind: 'photo' | 'animation' };

// file_id медіа бейджа кешуємо в bot_meta('badge_file_id:<id>') як "<kind>:<fileId>".
// (старий формат — голий fileId — трактуємо як photo). Метод залежить від РЕАЛЬНОГО
// файлу (а не лише від config), бо при відсутньому .gif робимо fallback на sample.png.
async function getBadgeMedia(badge: BadgeDef): Promise<BadgeMedia | null> {
  const metaKey = `badge_file_id:${badge.id}`;
  const cached = await getMeta(metaKey);
  if (cached) {
    const idx = cached.indexOf(':');
    if (idx > 0) {
      const kind = cached.slice(0, idx) === 'animation' ? 'animation' : 'photo';
      return { fileId: cached.slice(idx + 1), kind };
    }
    return { fileId: cached, kind: 'photo' };
  }
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    // На Vercel у бандл потрапляють лише файли, перелічені в includeFiles (vercel.json).
    const candidates = [
      path.join(process.cwd(), 'api', '_telegram', 'badges', badge.image),
      path.join(process.cwd(), 'public', 'badges', badge.image),
      // Fallback-плейсхолдер, якщо реальної картинки бейджа ще нема.
      path.join(process.cwd(), 'api', '_telegram', 'badges', 'sample.png'),
    ];
    let buf: Buffer | null = null;
    let usedPath = '';
    for (const p of candidates) {
      try {
        buf = await fs.readFile(p);
        if (buf) { usedPath = p; break; }
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

    // Тип визначаємо за фактично прочитаним файлом (gif/mp4 → animation).
    const isAnim = /\.(gif|mp4)$/i.test(usedPath);
    if (isAnim) {
      const ct = /\.mp4$/i.test(usedPath) ? 'video/mp4' : 'image/gif';
      const res = await sendAnimationByBuffer(channelId, buf, badge.image, undefined, ct);
      const fid = res?.animation?.file_id || res?.document?.file_id || '';
      if (fid) {
        await setMeta(metaKey, `animation:${fid}`);
        return { fileId: fid, kind: 'animation' };
      }
      return null;
    }
    const res = await sendPhotoByBuffer(channelId, buf, badge.image);
    const photoArr = res?.photo || [];
    const fid = photoArr.length ? photoArr[photoArr.length - 1].file_id : '';
    if (fid) {
      await setMeta(metaKey, `photo:${fid}`);
      return { fileId: fid, kind: 'photo' };
    }
    return null;
  } catch (e) {
    console.error('getBadgeMedia failed', e);
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

// Чиста картка бейджа: фото + (назва, опис) у caption. Без жодних службових
// підказок — щоб користувач міг переслати її другу як є.
function badgeCaption(badge: BadgeDef): string {
  return `🏅 <b>${esc(badge.title)}</b>\n${esc(badge.text)}`;
}

async function sendBadgePhoto(chatId: number | string, badge: BadgeDef): Promise<void> {
  const caption = badgeCaption(badge);
  const media = await getBadgeMedia(badge);
  const send = media?.kind === 'animation' ? sendAnimationByFileId : sendPhotoByFileId;
  if (media && caption.length <= 1024) {
    await send(chatId, media.fileId, caption);
  } else if (media) {
    await send(chatId, media.fileId);
    await sendMessage(chatId, caption);
  } else {
    await sendMessage(chatId, caption);
  }
}

// Здобуття бейджа: чиста картка + окреме вітальне повідомлення з підказкою про forward.
async function sendBadgeEarnedCard(chatId: number | string, badge: BadgeDef): Promise<void> {
  await sendBadgePhoto(chatId, badge);
  await sendMessage(chatId, T.badgeEarned);
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
  await sendBadgePhoto(chatId, badge);
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
  // Назви неотриманих НЕ показуємо — користувач сам досліджує, як їх здобути.
  const lines = all.map(b =>
    earned.has(b.id)
      ? `✅ <b>${esc(b.title)}</b> — ${esc(b.text)}`
      : T.badgesLockedLabel
  );
  const header = fmt(T.badgesListHeader, { earned: earnedCount, total: all.length });
  const buttons = all
    .filter(b => earned.has(b.id))
    .map(b => [{ text: `📤 ${b.title}`, callback_data: `badge:${b.id}` }]);
  // Підказку про пересилання показуємо, лише якщо є отримані бейджі (є що пересилати).
  const body = buttons.length
    ? `${header}\n\n${lines.join('\n')}\n\n${T.badgesListShareHint}`
    : `${header}\n\n${lines.join('\n')}`;
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

// Оцінка бейджів для САЙТУ ПЕРЕВІРКИ (web). Видає ТИХО (без Telegram-картки — у
// web-юзера може не бути чату). Повертає нові бейджі, щоб показати їх у тості на сайті.
// Обробляє веб-метрики (verifications_total, corrected_words_total) + спільні
// (total_points, day_count, cases_total) — бо бали в перевірці спільні з ботом.
export async function evaluateWebBadges(opts: {
  tgId: string;
  totalPoints: number;
  todayCount: number;
}): Promise<BadgeDef[]> {
  const all = telegramBotConfig.badges;
  if (all.length === 0) return [];
  try {
    const earned = new Set(await getEarnedBadgeIds(opts.tgId));
    const candidates = all.filter(b => !earned.has(b.id));
    if (candidates.length === 0) return [];

    let casesTotal: number | null = null;
    let verifTotal: number | null = null;
    let correctedTotal: number | null = null;
    const meets = async (b: BadgeDef): Promise<boolean> => {
      const c = b.criteria;
      switch (c.type) {
        case 'total_points':
          return opts.totalPoints >= c.threshold;
        case 'day_count':
          return opts.todayCount >= c.threshold;
        case 'cases_total':
          if (casesTotal === null) casesTotal = await countUserCases(opts.tgId);
          return casesTotal >= c.threshold;
        case 'verifications_total':
          if (verifTotal === null) verifTotal = await countUserVerifications(opts.tgId);
          return verifTotal >= c.threshold;
        case 'corrected_words_total':
          if (correctedTotal === null) correctedTotal = await sumUserCorrectedWords(opts.tgId);
          return correctedTotal >= c.threshold;
        default:
          return false;
      }
    };

    const newly: BadgeDef[] = [];
    for (const b of candidates) if (await meets(b)) newly.push(b);
    if (newly.length) await grantBadges(opts.tgId, newly.map(b => b.id));

    // Якщо юзер звʼязаний з Telegram (numeric tg_id, а не web:) — шлемо картку в його
    // приватний чат із ботом (chat_id = tg_id). Помилка (заблокував бота) — не критична.
    if (newly.length && !opts.tgId.startsWith('web:')) {
      for (const b of newly) {
        try {
          await sendBadgeEarnedCard(opts.tgId, b);
        } catch (e) {
          console.error('evaluateWebBadges: TG card failed', e);
        }
      }
    }
    return newly;
  } catch (e) {
    console.error('evaluateWebBadges failed', e);
    return [];
  }
}
