// Чисті функції токенізації/зіставлення слів пазла. Leaf-модуль (імпортує лише
// типи), щоб і scheduler, і puzzle могли його використати без циклічних залежностей.
import type { TableColumn } from '../../src/types.js';

// Різновиди апострофа зводимо до одного, щоб «п'ять» і «п’ять» збігалися.
const APOSTROPHES = /[''‘`´]/g;

// Нормалізація слова для точного зіставлення (без урахування регістру):
// нижній регістр, єдиний апостроф, обрізана облямівкова пунктуація.
// Внутрішні апостроф/дефіс лишаємо («слобода-руська», «п'ять»).
export function normalizeWord(raw: string): string {
  const s = (raw || '').toLowerCase().replace(APOSTROPHES, '\'');
  return s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}

// Розбиває речення на токени, зберігаючи оригінал (для рендера) і норму (для збігу).
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
