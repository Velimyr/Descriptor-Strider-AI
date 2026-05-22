// «Описовий пазл» — токенізація, зіставлення слів і рушій гри.
// Чисті функції (нормалізація/токенізація) можна використати і в admin API.
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

// Різновиди апострофа зводимо до одного, щоб «п'ять» і «п’ять» збігалися.
const APOSTROPHES = /[''‘`´]/g;

// Нормалізація слова для точного зіставлення (без урахування регістру):
// нижній регістр, єдиний апостроф, обрізана облямівкова пунктуація.
// Внутрішні апостроф/дефіс лишаємо («слобода-руська», «п'ять»).
export function normalizeWord(raw: string): string {
  const s = (raw || '').toLowerCase().replace(APOSTROPHES, '\'');
  // \p{L}\p{N} — будь-яка літера/цифра (Unicode), тож українська працює.
  return s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}

// Розбиває речення на токени, зберігаючи оригінал (для рендера) і норму (для збігу).
// norm === '' означає суто пунктуаційний токен — не збирається.
export function tokenizeSentence(sentence: string): Array<{ raw: string; norm: string }> {
  return (sentence || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(raw => ({ raw, norm: normalizeWord(raw) }));
}

// Унікальні «слова для збору» речення: норми без порожніх і без стоп-слів.
export function collectibleWords(sentence: string, stopwords: string[] = []): string[] {
  const stop = new Set(stopwords.map(w => normalizeWord(w)).filter(Boolean));
  const out = new Set<string>();
  for (const { norm } of tokenizeSentence(sentence)) {
    if (norm && !stop.has(norm)) out.add(norm);
  }
  return [...out];
}

// Множина нормалізованих слів довільного тексту (напр. заголовка справи).
export function wordsInText(text: string): Set<string> {
  const out = new Set<string>();
  for (const { norm } of tokenizeSentence(text)) {
    if (norm) out.add(norm);
  }
  return out;
}

// Індекс поля-заголовка серед питань (role === 'title'). -1, якщо немає.
export function titleFieldIndex(questions: TableColumn[]): number {
  return questions.findIndex(q => q.role === 'title');
}

// Значення заголовка з масиву відповідей (за роллю title). '' якщо немає.
export function titleAnswer(questions: TableColumn[], answers: string[]): string {
  const idx = titleFieldIndex(questions);
  return idx >= 0 ? String(answers[idx] ?? '') : '';
}

// Які слова пазла зустрілися в заголовку справи (перетин title ∩ collectible).
export function matchedPuzzleWords(
  titleText: string,
  sentence: string,
  stopwords: string[] = []
): string[] {
  const titleWords = wordsInText(titleText);
  return collectibleWords(sentence, stopwords).filter(w => titleWords.has(w));
}

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

// Виклик при ЗАКРИТТІ колаб-справи (з будь-якого шляху — бот чи web).
// Підтверджуємо слова, зібрані з цієї справи СЬОГОДНІ (строго денний), і для
// зачеплених гравців перевіряємо, чи зібрано всю фразу → видача призу.
export async function onCollabCaseClosed(caseId: string): Promise<void> {
  try {
    const today = kyivDateString();
    const affected = await confirmPuzzleWordsByCase(caseId, today);
    for (const tgId of affected) {
      await checkPuzzleCompletion(tgId, today);
    }
  } catch (e) {
    console.error('onCollabCaseClosed failed', e);
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
  const T = telegramBotConfig.texts;
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
  const T = telegramBotConfig.texts;
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
