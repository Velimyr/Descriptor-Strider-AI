// «Описовий пазл» — рушій гри (БД + нарахування + сповіщення + UI).
// Чисті функції токенізації — у ./puzzleWords (leaf-модуль), реекспортуємо їх
// тут для зворотної сумісності з наявними імпортами.
import type { TableColumn } from '../../src/types.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  getPuzzle,
  addPuzzleWords,
  confirmPuzzleWordsByCase,
  getPuzzleProgressForUser,
  awardPuzzleWinner,
  getUser,
  patchUser,
} from './storage.js';
import { kyivDateString } from './scheduler.js';
import { sendMessage } from './tg-api.js';
import {
  collectibleWords,
  tokenizeSentence,
  titleAnswer,
  matchedPuzzleWords,
} from './puzzleWords.js';

export {
  normalizeWord,
  tokenizeSentence,
  collectibleWords,
  wordsInText,
  titleFieldIndex,
  titleAnswer,
  matchedPuzzleWords,
} from './puzzleWords.js';

const T = telegramBotConfig.texts;

// --------- Рушій гри (БД + нарахування + сповіщення) ---------
// Усе — best-effort: помилки логуються, але НЕ ламають основний flow справи.

function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? `{${k}}`));
}

// Виклик при РОЗПІЗНАВАННІ (collab-create) у TG-боті: збираємо слова заголовка,
// що збігаються з фразою сьогоднішнього пазла, як непідтверджені.
export async function collectPuzzleWordsOnCreate(
  tgId: string,
  caseId: string,
  questions: TableColumn[],
  answers: string[]
): Promise<void> {
  try {
    const today = kyivDateString();
    const puzzle = await getPuzzle(today);
    if (!puzzle || !puzzle.sentence.trim()) return;
    const title = titleAnswer(questions, answers);
    if (!title.trim()) return;
    const words = matchedPuzzleWords(title, puzzle.sentence, telegramBotConfig.puzzle.stopwords);
    if (words.length === 0) return;
    await addPuzzleWords(today, tgId, words, caseId);
  } catch (e) {
    console.error('collectPuzzleWordsOnCreate failed', e);
  }
}

// Виклик при ПІДТВЕРДЖЕННІ колаб-справи. Залежно від config.puzzle.confirmMode:
//   'single' — зараховуємо слова на КОЖНЕ підтвердження (не чекаємо закриття);
//   'full'   — лише коли справа повністю закрита (closed=true).
// Підтверджуємо слова, зібрані з цієї справи СЬОГОДНІ (строго денний), і для
// зачеплених гравців перевіряємо повний збір фрази → видача призу.
// Ідемпотентно: вже підтверджені слова не чіпаються.
export async function onCollabCaseConfirmed(caseId: string, closed: boolean): Promise<void> {
  try {
    if (telegramBotConfig.puzzle.confirmMode === 'full' && !closed) return;
    const today = kyivDateString();
    const affected = await confirmPuzzleWordsByCase(caseId, today);
    for (const tgId of affected) {
      await checkPuzzleCompletion(tgId, today);
    }
  } catch (e) {
    console.error('onCollabCaseConfirmed failed', e);
  }
}

// Чи зібрав користувач усю фразу дня (всі слова підтверджені) → атомарна видача
// місця + призові бали + привітання.
async function checkPuzzleCompletion(tgId: string, dateKyiv: string): Promise<void> {
  const puzzle = await getPuzzle(dateKyiv);
  if (!puzzle || !puzzle.sentence.trim()) return;
  const targets = collectibleWords(puzzle.sentence, telegramBotConfig.puzzle.stopwords);
  if (targets.length === 0) return;
  const progress = await getPuzzleProgressForUser(dateKyiv, tgId);
  const confirmed = new Set(progress.filter(p => p.status === 'confirmed').map(p => p.word));
  if (!targets.every(w => confirmed.has(w))) return;

  const award = await awardPuzzleWinner(dateKyiv, tgId);
  if (!award) return; // вже переможець або всі 3 місця зайняті

  // Призові бали додаємо до загального рахунку (не в денний множник).
  try {
    const user = await getUser(tgId);
    if (user) {
      const newTotal = Math.round((user.totalPoints + award.points) * 100) / 100;
      await patchUser(tgId, { totalPoints: newTotal });
    }
  } catch (e) {
    console.error('puzzle prize points failed', e);
  }

  await sendMessage(
    tgId,
    fmt(telegramBotConfig.texts.puzzleCongrats, { place: award.place, points: award.points })
  );
}

// --------- UI бота (розділ «Прогрес» → «Описовий пазл») ---------

function esc(s: string): string {
  return s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] || ch));
}

function puzzleTaskKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: telegramBotConfig.texts.puzzleRulesButton, callback_data: 'puzzle:rules' }],
      [{ text: telegramBotConfig.texts.puzzleResultsButton, callback_data: 'puzzle:me' }],
    ],
  };
}

// Задача дня + кнопки «Правила» / «Мої результати».
export async function sendPuzzleTask(chatId: number | string): Promise<void> {
  const puzzle = await getPuzzle(kyivDateString());
  if (!puzzle || !puzzle.sentence.trim()) {
    await sendMessage(chatId, T.puzzleNoToday);
    return;
  }
  await sendMessage(chatId, fmt(T.puzzleTaskHeader, { sentence: esc(puzzle.sentence) }), {
    reply_markup: puzzleTaskKeyboard(),
  });
}

export async function sendPuzzleRules(chatId: number | string): Promise<void> {
  await sendMessage(chatId, telegramBotConfig.puzzle.rules);
}

// Фраза дня з виділенням: підтверджені — ВЕЛИКИМИ+жирним, зібрані-непідтверджені —
// підкреслені, решта — звичайні. Знизу — лічильник і легенда.
export async function sendPuzzleResults(chatId: number | string, tgId: string): Promise<void> {
  const today = kyivDateString();
  const puzzle = await getPuzzle(today);
  if (!puzzle || !puzzle.sentence.trim()) {
    await sendMessage(chatId, T.puzzleNoToday);
    return;
  }
  const stopwords = telegramBotConfig.puzzle.stopwords;
  const targets = new Set(collectibleWords(puzzle.sentence, stopwords));
  const progress = await getPuzzleProgressForUser(today, tgId);
  const statusByWord = new Map(progress.map(p => [p.word, p.status]));

  const rendered = tokenizeSentence(puzzle.sentence)
    .map(({ raw, norm }) => {
      if (!norm || !targets.has(norm)) return esc(raw); // пунктуація / стоп-слова
      const st = statusByWord.get(norm);
      if (st === 'confirmed') return `<b>${esc(raw.toUpperCase())}</b>`;
      if (st === 'unconfirmed') return `<u>${esc(raw)}</u>`;
      return esc(raw);
    })
    .join(' ');

  const total = targets.size;
  let confirmed = 0;
  let collected = 0;
  for (const w of targets) {
    const st = statusByWord.get(w);
    if (st) collected++;
    if (st === 'confirmed') confirmed++;
  }

  const body =
    `${T.puzzleResultsHeader}\n\n` +
    `${rendered}\n\n` +
    `${fmt(T.puzzleProgressLine, { collected, confirmed, total })}\n\n` +
    `${T.puzzleLegend}`;
  await sendMessage(chatId, body);
}
