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
  getPuzzleWinners,
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
  normalizeWord,
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
    // Видані слова не збираємо (вони вже залічені для цієї фрази).
    const given = new Set(puzzle.givenWords);
    const words = matchedPuzzleWords(title, puzzle.sentence, telegramBotConfig.puzzle.stopwords)
      .filter(w => !given.has(w));
    if (words.length === 0) return;
    const added = await addPuzzleWords(today, tgId, words, caseId);
    if (added.length === 0) return;
    // Сповіщаємо про КОЖНЕ нове знайдене слово. Для гарного вигляду беремо
    // оригінальну форму слова з фрази (а не нормалізовану).
    const rawByNorm = new Map<string, string>();
    for (const { raw, norm } of tokenizeSentence(puzzle.sentence)) {
      if (norm && !rawByNorm.has(norm)) rawByNorm.set(norm, raw);
    }
    for (const w of added) {
      await sendMessage(tgId, fmt(T.puzzleWordFound, { word: esc(rawByNorm.get(w) || w) }));
    }
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
  const given = new Set(puzzle.givenWords);
  // Збирати треба лише слова, які НЕ видані (видані вже залічені).
  const mustCollect = collectibleWords(puzzle.sentence, telegramBotConfig.puzzle.stopwords).filter(
    w => !given.has(w)
  );
  if (mustCollect.length === 0) return; // нема чого збирати — переможців не визначаємо
  const progress = await getPuzzleProgressForUser(dateKyiv, tgId);
  const confirmed = new Set(progress.filter(p => p.status === 'confirmed').map(p => p.word));
  if (!mustCollect.every(w => confirmed.has(w))) return;

  const award = await awardPuzzleWinner(dateKyiv, tgId);
  if (!award) {
    // Місць немає (або вже переможець). Якщо користувач НЕ в переможцях — він
    // зібрав фразу 4-м+ і призу немає: надсилаємо підбадьорливе повідомлення.
    // (checkPuzzleCompletion для гравця спрацьовує раз — у момент повного збору.)
    try {
      const winners = await getPuzzleWinners(dateKyiv);
      if (!winners.some(w => w.tgId === tgId)) {
        await sendMessage(tgId, telegramBotConfig.texts.puzzleNoPrize);
      }
    } catch (e) {
      console.error('puzzle no-prize notice failed', e);
    }
    return;
  }

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

// Рендер фрази дня з виділенням стану кожного слова.
// Слова, які ТРЕБА зібрати, беремо у квадратні дужки [] (незалежно від стану);
// усередині: ВЕЛИКИМИ+жирним — підтверджене, підкреслене — зібране-непідтверджене,
// звичайне — ще не зібране. Службові/видані/пунктуація — звичайний текст без дужок.
function renderPhrase(
  puzzle: { sentence: string; givenWords: string[] },
  statusByWord: Map<string, 'confirmed' | 'unconfirmed'>
): string {
  const stopwords = telegramBotConfig.puzzle.stopwords;
  const stopSet = new Set(stopwords.map(w => normalizeWord(w)).filter(Boolean));
  const targets = new Set(collectibleWords(puzzle.sentence, stopwords));
  const givenSet = new Set(puzzle.givenWords.filter(w => targets.has(w)));
  return tokenizeSentence(puzzle.sentence)
    .map(({ raw, norm }) => {
      if (!norm) return esc(raw); // пунктуація
      // Службові, видані, нецільові — звичайний текст без дужок (участі не беруть).
      if (stopSet.has(norm) || !targets.has(norm) || givenSet.has(norm)) return esc(raw);
      const st = statusByWord.get(norm);
      const inner =
        st === 'confirmed'
          ? `<b>${esc(raw.toUpperCase())}</b>`
          : st === 'unconfirmed'
          ? `<u>${esc(raw)}</u>`
          : esc(raw);
      return `[${inner}]`;
    })
    .join(' ');
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
export async function sendPuzzleTask(chatId: number | string, tgId: string): Promise<void> {
  const today = kyivDateString();
  const puzzle = await getPuzzle(today);
  if (!puzzle || !puzzle.sentence.trim()) {
    await sendMessage(chatId, T.puzzleNoToday);
    return;
  }
  const progress = await getPuzzleProgressForUser(today, tgId);
  const statusByWord = new Map(progress.map(p => [p.word, p.status]));
  const rendered = renderPhrase(puzzle, statusByWord);
  const body = `${fmt(T.puzzleTaskHeader, { sentence: rendered })}\n\n${T.puzzleLegend}`;
  await sendMessage(chatId, body, { reply_markup: puzzleTaskKeyboard() });
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
  const givenSet = new Set(puzzle.givenWords.filter(w => targets.has(w)));
  const progress = await getPuzzleProgressForUser(today, tgId);
  const statusByWord = new Map(progress.map(p => [p.word, p.status]));
  const rendered = renderPhrase(puzzle, statusByWord);

  // Лічильники — лише по «цілі» (слова, які треба зібрати; видані не входять).
  let total = 0;
  let confirmed = 0;
  let collected = 0;
  for (const w of targets) {
    if (givenSet.has(w)) continue;
    total++;
    const st = statusByWord.get(w);
    if (st) collected++;
    if (st === 'confirmed') confirmed++;
  }

  // Якщо користувач уже зібрав фразу й отримав приз — вітаємо ще раз зверху.
  const winners = await getPuzzleWinners(today);
  const mine = winners.find(w => w.tgId === tgId);
  const congrats = mine
    ? fmt(T.puzzleCongrats, { place: mine.place, points: mine.points }) + '\n\n'
    : '';

  const body =
    congrats +
    `${T.puzzleResultsHeader}\n\n` +
    `${rendered}\n\n` +
    `${fmt(T.puzzleProgressLine, { collected, confirmed, total })}\n\n` +
    `${T.puzzleLegend}`;
  await sendMessage(chatId, body);
}
