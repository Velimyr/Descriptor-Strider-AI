// Розсилка оголошень від Блукача у Telegram-групи.
// ID груп — у telegramBotConfig.groupChats.announceChatIds. Кожне повідомлення
// надсилається ОДИН РАЗ за всю систему (атомарний клейм через bot_meta).
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  getYesterdayCaseLeaders,
  getPuzzle,
  getPuzzleWinners,
  getDisplayNamesMap,
  tryClaimAnnouncement,
  isDescriptionFullyDone,
} from './storage.js';
import { sendMessage } from './tg-api.js';
import { kyivDateString, descriptionKey, descriptionName } from './scheduler.js';

const cfg = telegramBotConfig;
const TZ = cfg.dispatch.timezone;

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] || ch));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in values ? String(values[k]) : `{${k}}`));
}

// «1 справа», «2 справи», «5 справ»
function casesWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'справа';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'справи';
  return 'справ';
}

function yesterdayKyivDateString(): string {
  const now = new Date();
  // Беремо "сьогодні" в TZ і віднімаємо добу як рядок.
  const todayStr = kyivDateString(now);
  const [y, m, d] = todayStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export interface BroadcastResult {
  chatId: string;
  ok: boolean;
  error?: string;
}

async function broadcast(text: string): Promise<BroadcastResult[]> {
  const chatIds = cfg.groupChats?.announceChatIds || [];
  if (chatIds.length === 0) {
    console.warn('groupAnnounce: announceChatIds is empty — nothing to send');
    return [];
  }
  const results: BroadcastResult[] = [];
  for (const chatId of chatIds) {
    try {
      await sendMessage(chatId, text, { disable_web_page_preview: true });
      results.push({ chatId, ok: true });
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.error('groupAnnounce sendMessage failed', chatId, msg);
      results.push({ chatId, ok: false, error: msg });
    }
  }
  return results;
}

// === 10:00 — ранкове вітання топ-3 за вчора ===
export async function announceMorningTop(opts?: { skipClaim?: boolean }): Promise<{
  sent: boolean;
  reason?: string;
  broadcast?: BroadcastResult[];
}> {
  const yesterday = yesterdayKyivDateString();
  const claimKey = `announce:morning:${yesterday}`;
  if (!opts?.skipClaim && !(await tryClaimAnnouncement(claimKey))) {
    return { sent: false, reason: 'already-sent' };
  }

  const leaders = await getYesterdayCaseLeaders(TZ, 10);
  let text: string;
  if (leaders.length === 0) {
    text = pickRandom(cfg.groupAnnounce.morningEmpty);
  } else {
    const lines = leaders.map((l, i) =>
      fmt(cfg.groupAnnounce.morningLine, {
        place: i + 1,
        name: esc(l.displayName || 'учасник'),
        count: l.casesCount,
        casesWord: casesWord(l.casesCount),
      })
    );
    text = fmt(pickRandom(cfg.groupAnnounce.morningHeader), { leaders: lines.join('\n') });
  }
  const results = await broadcast(text);
  return { sent: true, broadcast: results };
}

// === 21:00 — підсумок Описового пазла ===
export async function announceEveningPuzzle(opts?: { skipClaim?: boolean }): Promise<{
  sent: boolean;
  reason?: string;
  broadcast?: BroadcastResult[];
}> {
  const today = kyivDateString();
  const claimKey = `announce:evening:${today}`;

  const puzzle = await getPuzzle(today);
  if (!puzzle || !puzzle.sentence.trim()) {
    return { sent: false, reason: 'no-phrase' };
  }
  if (!opts?.skipClaim && !(await tryClaimAnnouncement(claimKey))) {
    return { sent: false, reason: 'already-sent' };
  }

  const winners = await getPuzzleWinners(today);
  const totalPrizes = cfg.puzzle.prizes.length; // зазвичай 3
  let text: string;
  if (winners.length === 0) {
    // Гілка 3: жодного переможця — іронія + заохочення.
    text = fmt(pickRandom(cfg.groupAnnounce.eveningPuzzleNobody), {
      sentence: esc(puzzle.sentence),
    });
  } else {
    const names = await getDisplayNamesMap(winners.map(w => w.tgId));
    const lines = winners.map(w =>
      fmt(cfg.groupAnnounce.eveningWinnerLine, {
        place: w.place,
        name: esc(names[w.tgId] || 'учасник'),
        points: w.points,
      })
    );
    if (winners.length >= totalPrizes) {
      // Гілка 1: всі призові місця зайняті — вітаємо, кличемо завтра.
      text = fmt(pickRandom(cfg.groupAnnounce.eveningPuzzleAll), {
        sentence: esc(puzzle.sentence),
        winners: lines.join('\n'),
      });
    } else {
      // Гілка 2: 1 або 2 переможці — лишились місця, ще можна встигнути.
      text = fmt(pickRandom(cfg.groupAnnounce.eveningPuzzleSome), {
        sentence: esc(puzzle.sentence),
        winners: lines.join('\n'),
        remainingPlaces: totalPrizes - winners.length,
      });
    }
  }
  const results = await broadcast(text);
  return { sent: true, broadcast: results };
}

// === Опис закрито на 100% (викликати після того, як справа з опису перейшла в done) ===
// Best-effort: помилки не пробрасуємо — щоб не зламати основний submit-flow.
export async function maybeAnnounceDescriptionDone(
  archive: string,
  fund: string,
  opys: string
): Promise<void> {
  try {
    if (!archive || !fund || !opys) return;
    const { done, totalCases, doneCases } = await isDescriptionFullyDone(archive, fund, opys);
    if (!done) return;
    const key = `announce:desc:${descriptionKey({ archive, fund, opys })}`;
    if (!(await tryClaimAnnouncement(key))) return;
    const text = fmt(pickRandom(cfg.groupAnnounce.descriptionDone), {
      descName: esc(descriptionName({ archive, fund, opys })),
      archive: esc(archive),
      fund: esc(fund),
      opys: esc(opys),
      totalCases,
      totalDone: doneCases,
      donePct: 100,
    });
    await broadcast(text);
  } catch (e) {
    console.error('maybeAnnounceDescriptionDone failed', e);
  }
}
