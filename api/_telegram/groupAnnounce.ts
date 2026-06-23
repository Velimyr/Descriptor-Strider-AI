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
  releaseAnnouncement,
  getMeta,
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
  skipped?: boolean; // already delivered раніше (поканальний клейм)
  error?: string;
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// Надсилання з ретраями на транзиентні помилки (429/5xx/таймаут). Telegram
// здебільшого віддає тимчасові збої, тож кілька спроб із бекофом різко піднімають
// надійність доставки.
async function sendWithRetry(chatId: string, text: string, attempts = 3): Promise<void> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      await sendMessage(chatId, text, { disable_web_page_preview: true });
      return;
    } catch (e: any) {
      lastErr = e;
      if (i < attempts - 1) await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

// Розсилка тексту в усі групи.
// claimBaseKey задано → ПОКАНАЛЬНИЙ клейм: для кожної групи окремий ключ
// `${claimBaseKey}:${chatId}`. Клеймимо ПЕРЕД надсиланням (захист від паралельних
// тіків), а якщо надсилання впало — звільняємо клейм, щоб наступний тік повторив
// саме цю групу. Успіх лишає клейм назавжди (дедуплікація). Без claimBaseKey
// (тест) — просто шлемо всім без клейму.
async function broadcast(text: string, claimBaseKey?: string): Promise<BroadcastResult[]> {
  const chatIds = cfg.groupChats?.announceChatIds || [];
  if (chatIds.length === 0) {
    console.warn('groupAnnounce: announceChatIds is empty — nothing to send');
    return [];
  }
  const results: BroadcastResult[] = [];
  for (const chatId of chatIds) {
    const chatKey = claimBaseKey ? `${claimBaseKey}:${chatId}` : null;
    // Поканальна дедуплікація: якщо вже заклеймлено (доставлено) — пропускаємо.
    if (chatKey) {
      const claimed = await tryClaimAnnouncement(chatKey);
      if (!claimed) {
        results.push({ chatId, ok: true, skipped: true });
        continue;
      }
    }
    try {
      await sendWithRetry(chatId, text);
      results.push({ chatId, ok: true });
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.error('groupAnnounce sendMessage failed', chatId, msg);
      // Звільняємо клейм — щоб наступний тік повторив доставку саме цій групі.
      if (chatKey) await releaseAnnouncement(chatKey).catch(() => {});
      results.push({ chatId, ok: false, error: msg });
    }
  }
  return results;
}

// Чи всі групи вже отримали це оголошення (всі поканальні клейми існують) —
// для дешевого short-circuit, щоб не перераховувати контент щотіку у вікні.
async function allChatsDelivered(claimBaseKey: string): Promise<boolean> {
  const chatIds = cfg.groupChats?.announceChatIds || [];
  if (chatIds.length === 0) return true;
  for (const chatId of chatIds) {
    if (!(await getMeta(`${claimBaseKey}:${chatId}`))) return false;
  }
  return true;
}

// === 10:00 — ранкове вітання топ-3 за вчора ===
export async function announceMorningTop(opts?: { skipClaim?: boolean }): Promise<{
  sent: boolean;
  reason?: string;
  broadcast?: BroadcastResult[];
}> {
  const yesterday = yesterdayKyivDateString();
  const claimBaseKey = `announce:morning:${yesterday}`;
  // Short-circuit: якщо всі групи вже отримали — не перераховуємо лідерів щотіку.
  if (!opts?.skipClaim && (await allChatsDelivered(claimBaseKey))) {
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
  const results = await broadcast(text, opts?.skipClaim ? undefined : claimBaseKey);
  return { sent: true, broadcast: results };
}

// === 21:00 — підсумок Описового пазла ===
export async function announceEveningPuzzle(opts?: { skipClaim?: boolean }): Promise<{
  sent: boolean;
  reason?: string;
  broadcast?: BroadcastResult[];
}> {
  const today = kyivDateString();
  const claimBaseKey = `announce:evening:${today}`;
  // Short-circuit: усі групи вже отримали — не лізем у БД за пазлом/переможцями.
  if (!opts?.skipClaim && (await allChatsDelivered(claimBaseKey))) {
    return { sent: false, reason: 'already-sent' };
  }

  const puzzle = await getPuzzle(today);
  if (!puzzle || !puzzle.sentence.trim()) {
    return { sent: false, reason: 'no-phrase' };
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
  const results = await broadcast(text, opts?.skipClaim ? undefined : claimBaseKey);
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
    const claimBaseKey = `announce:desc:${descriptionKey({ archive, fund, opys })}`;
    // Дешевий short-circuit — якщо всі групи вже отримали, нічого не робимо.
    if (await allChatsDelivered(claimBaseKey)) return;
    const text = fmt(pickRandom(cfg.groupAnnounce.descriptionDone), {
      descName: esc(descriptionName({ archive, fund, opys })),
      archive: esc(archive),
      fund: esc(fund),
      opys: esc(opys),
      totalCases,
      totalDone: doneCases,
      donePct: 100,
    });
    // Поканальний клейм: успіх лишає клейм, невдача звільняє (повтор при наступному
    // закритті справи з цього опису, якщо таке станеться).
    await broadcast(text, claimBaseKey);
  } catch (e) {
    console.error('maybeAnnounceDescriptionDone failed', e);
  }
}
