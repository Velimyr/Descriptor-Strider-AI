// Фіча "Ключові слова": користувач стежить за словами (до 5 варіацій у блоці) і
// отримує сповіщення в Telegram, коли будь-яка ПІДТВЕРДЖЕНА справа (collab bot_cases
// або bot_verif_cases) містить його слово — навіть якщо сам не розпізнавав/не
// підтверджував. Кількість АКТИВНИХ блоків обмежена місячними балами (100/блок).
//
// Egress-принципи (детальніше — коментар над bot_keyword_blocks у supabase/schema.sql):
// 1. search_text пишеться ОДИН РАЗ у момент закриття справи; ретроскан і матчинг
//    ніколи не тягнуть questions+answers у JS для чужих справ.
// 2. Матчинг у реальному часі звіряє текст, що вже й так у процесі, проти
//    TTL-кешованого списку варіантів усіх юзерів — жодного нового запиту на подію.
// 3. "Активність" блоку ніде не зберігається прапорцем — рахується на льоту, і
//    тому не потребує фонової задачі синхронізації при зміні балів.
//
// Catch-up: якщо справа закрилась, поки блок користувача був неактивний (бракувало
// балів), збіг лишається в черзі (bot_keyword_matches.delivered=false) і надсилається
// пізніше — коли той-таки юзер перетне поріг 100 балів знову (гачок у incMonthlyPoints,
// storage.ts). Так само лагодить "місячний провал" на початку кожного місяця (усі бали
// обнуляються — але кожен юзер докликає catch-up у свій момент, коли знову набере 100).

import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import {
  getCase,
  getMeta,
  setCaseSearchText,
  getUserMonthlyPoints,
  listKeywordBlocks,
  addKeywordBlock,
  deleteKeywordBlock,
  keywordBackfillScan,
  keywordVariantStatus,
  insertKeywordMatch,
  listPendingKeywordMatches,
  markKeywordMatchDelivered,
  KeywordBlock,
} from './storage.js';
import { sendMessage, sendPhotoByFileId } from './tg-api.js';
// Лише типи (erased при компіляції) — значення (buildSummary/sendCasePhotoWithOpys)
// імпортуємо динамічно нижче, щоб не створити статичний цикл bot.ts ⇄ keywords.ts
// (bot.ts статично імпортує keywords.ts для UI "Ключові слова").
import type { CasePhotoInfo } from './bot.js';
import { kyivMonthString } from './scheduler.js';
import { levenshtein } from '../_core/pendingPoints.js';

const T = telegramBotConfig.texts;

export const MAX_VARIANTS = 5;
export const MAX_VARIANT_DISTANCE = 5;

interface QuestionLike {
  label: string;
  role?: string;
}

// ---------- пошуковий текст ----------
// Лише поля з роллю title/notes — номери/роки/кількість сторінок не пошуковий текст.
export function buildSearchText(questions: QuestionLike[], answers: string[]): string {
  const parts: string[] = [];
  questions.forEach((q, i) => {
    if (q.role === 'title' || q.role === 'notes') {
      const v = answers[i];
      if (v) parts.push(String(v));
    }
  });
  return parts.join(' ').toLowerCase();
}

// ---------- парсинг і валідація введених варіантів ----------
export function parseVariantsInput(raw: string): string[] {
  return String(raw || '')
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Кидаємо, а не повертаємо {ok,error}-union — у цьому проєкті tsconfig без
// strictNullChecks, де звуження discriminated union за `!x.ok` ненадійне (див.
// VerifError у verifCases.ts — той самий прийом: клас-помилка звужується через
// instanceof, що працює незалежно від strict-режиму).
export class KeywordValidationError extends Error {
  constructor(
    public code: 'empty' | 'too_many' | 'too_different',
    public details: { count?: number; a?: string; b?: string; dist?: number } = {}
  ) {
    super(code);
  }
}

export function validateVariants(raw: string[]): string[] {
  const variants = raw.map(s => s.trim()).filter(Boolean);
  if (variants.length === 0) throw new KeywordValidationError('empty');
  if (variants.length > MAX_VARIANTS) {
    throw new KeywordValidationError('too_many', { count: variants.length });
  }
  // Попарно, "як є" (без нормалізації кирилиці) — так домовились.
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const dist = levenshtein(variants[i], variants[j]);
      if (dist > MAX_VARIANT_DISTANCE) {
        throw new KeywordValidationError('too_different', { a: variants[i], b: variants[j], dist });
      }
    }
  }
  return variants;
}

// ---------- активність блоків (для UI і для матчингу — та сама формула) ----------
export function computeActiveCount(monthlyPoints: number, blockCount: number): number {
  return Math.min(Math.floor(monthlyPoints / 100), blockCount);
}

export interface KeywordBlockWithStatus extends KeywordBlock {
  active: boolean;
}

// Список блоків юзера з позначкою активності — для екрана "Ключові слова".
export async function listKeywordBlocksWithStatus(tgId: string): Promise<KeywordBlockWithStatus[]> {
  const [blocks, points] = await Promise.all([
    listKeywordBlocks(tgId),
    getUserMonthlyPoints(kyivMonthString(), tgId),
  ]);
  const activeCount = computeActiveCount(points, blocks.length);
  return blocks.map((b, i) => ({ ...b, active: i < activeCount }));
}

// ---------- TTL-кеш варіантів усіх юзерів (для матчингу й catch-up) ----------
interface VariantEntry {
  tgId: string;
  variant: string;
  active: boolean;
}
let variantsCache: { value: VariantEntry[]; expiresAt: number; month: string } | null = null;
const VARIANTS_TTL_MS = 90 * 1000;

async function getVariantsCache(): Promise<VariantEntry[]> {
  const month = kyivMonthString();
  if (variantsCache && variantsCache.month === month && variantsCache.expiresAt > Date.now()) {
    return variantsCache.value;
  }
  const rows = await keywordVariantStatus(month);
  variantsCache = { value: rows, expiresAt: Date.now() + VARIANTS_TTL_MS, month };
  return rows;
}

// Викликати одразу після додавання/видалення блоку — щоб не чекати TTL для
// самого автора змін (для решти юзерів застаріла на ≤90с інформація не критична).
export function invalidateVariantsCache(): void {
  variantsCache = null;
}

// ---------- рендер картки справи для сповіщення (переюзає формат "Перевірки") ----------
interface CaseRenderInfo extends CasePhotoInfo {
  questions: QuestionLike[];
  answers: string[];
}

async function getCaseRenderInfo(caseId: string, source: 'collab' | 'verif'): Promise<CaseRenderInfo | null> {
  if (source === 'collab') {
    const cse = await getCase(caseId);
    if (!cse) return null;
    const questions = await getGlobalQuestions();
    return { tgFileId: cse.tgFileId, sourcePdf: cse.sourcePdf, page: cse.page, questions, answers: cse.currentAnswers };
  }
  const { getVerifCase } = await import('../_core/verifCases.js');
  const cse = await getVerifCase(caseId);
  if (!cse) return null;
  const answers = cse.currentAnswers.length ? cse.currentAnswers : cse.aiAnswers;
  return { tgFileId: cse.tgFileId, sourcePdf: cse.sourcePdf, page: cse.page, questions: cse.questions, answers };
}

// Той самий парсинг bot_meta.questions, що й у bot.ts/pendingPoints.ts/verifCases.ts
// (кожен модуль тримає свою маленьку копію — тут так само, щоб не тягнути залежність
// на приватні функції інших модулів).
async function getGlobalQuestions(): Promise<QuestionLike[]> {
  const raw = await getMeta('questions');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Одне повідомлення (заголовок + поля), потім голе фото — без дисклеймера про
// якість/кнопки "Переглянути опис" (те, що доречно у флоу розпізнавання, тут зайве).
async function notifyUser(tgId: string, info: CaseRenderInfo): Promise<void> {
  const { buildFieldsList } = await import('./bot.js');
  await sendMessage(tgId, `${T.keywordMatchHeader}\n\n${buildFieldsList(info.questions, info.answers)}`);
  if (info.tgFileId) await sendPhotoByFileId(tgId, info.tgFileId);
}

// ---------- матчинг у реальному часі (гачок при закритті справи) ----------
export interface EvaluateKeywordMatchesInput {
  caseId: string;
  source: 'collab' | 'verif';
  questions: QuestionLike[];
  answers: string[];
}

export async function evaluateKeywordMatches(input: EvaluateKeywordMatchesInput): Promise<void> {
  const { caseId, source, questions, answers } = input;
  const searchText = buildSearchText(questions, answers);

  // Пишемо search_text ОДИН РАЗ, незалежно від наявності збігів — потрібен ретроскану.
  if (source === 'collab') {
    await setCaseSearchText(caseId, searchText);
  } else {
    const { setVerifCaseSearchText } = await import('../_core/verifCases.js');
    await setVerifCaseSearchText(caseId, searchText);
  }
  if (!searchText) return;

  const variants = await getVariantsCache();
  if (variants.length === 0) return;

  // На юзера — чи є хоч один збіг, і чи хоч один із них зараз активний.
  const matchedByUser = new Map<string, boolean>(); // tgId -> anyActive
  for (const v of variants) {
    if (!v.variant) continue;
    if (matchedByUser.get(v.tgId) === true) continue; // вже є активний збіг — досить
    if (!searchText.includes(v.variant.toLowerCase())) continue;
    matchedByUser.set(v.tgId, (matchedByUser.get(v.tgId) || false) || v.active);
  }
  if (matchedByUser.size === 0) return;

  let cachedInfo: CaseRenderInfo | null | undefined;
  for (const [tgId, anyActive] of matchedByUser) {
    const inserted = await insertKeywordMatch(caseId, tgId, source, anyActive);
    if (!inserted || !anyActive) continue;
    if (cachedInfo === undefined) cachedInfo = await getCaseRenderInfo(caseId, source);
    if (!cachedInfo) continue;
    await notifyUser(tgId, cachedInfo);
  }
}

// ---------- catch-up (гачок при перетині порогу 100 балів) ----------
export async function runKeywordCatchUp(tgId: string): Promise<void> {
  const pending = await listPendingKeywordMatches(tgId);
  if (pending.length === 0) return;

  const variants = await getVariantsCache();
  const activeVariants = variants
    .filter(v => v.tgId === tgId && v.active && v.variant)
    .map(v => v.variant.toLowerCase());
  if (activeVariants.length === 0) return;

  for (const p of pending) {
    const info = await getCaseRenderInfo(p.caseId, p.source);
    if (!info) continue;
    const searchText = buildSearchText(info.questions, info.answers);
    if (!activeVariants.some(v => searchText.includes(v))) continue;
    await notifyUser(tgId, info);
    await markKeywordMatchDelivered(p.caseId, tgId);
  }
}

// ---------- CRUD блоків (викликається з UI налаштувань бота) ----------
const RETROSCAN_SEND_DELAY_MS = 60;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface CreateKeywordBlockResult {
  block: KeywordBlock;
  active: boolean;
  matchedCount: number;
  deliveredCount: number;
}

// Кидає KeywordValidationError, якщо варіанти не пройшли валідацію.
export async function createKeywordBlock(
  tgId: string,
  rawVariants: string[]
): Promise<CreateKeywordBlockResult> {
  const variants = validateVariants(rawVariants); // кидає KeywordValidationError

  const block = await addKeywordBlock(tgId, variants);
  const [blocks, points] = await Promise.all([
    listKeywordBlocks(tgId),
    getUserMonthlyPoints(kyivMonthString(), tgId),
  ]);
  const activeCount = computeActiveCount(points, blocks.length);
  const idx = blocks.findIndex(b => b.id === block.id);
  const active = idx >= 0 && idx < activeCount;

  invalidateVariantsCache();

  // Ретроскан усієї бази закритих справ — лише за цим блоком, лише case_id+джерело.
  const matches = await keywordBackfillScan(variants);
  let matchedCount = 0;
  let deliveredCount = 0;
  for (const m of matches) {
    const inserted = await insertKeywordMatch(m.caseId, tgId, m.source, active);
    if (!inserted) continue;
    matchedCount++;
    if (!active) continue;
    const info = await getCaseRenderInfo(m.caseId, m.source);
    if (!info) continue;
    await notifyUser(tgId, info);
    deliveredCount++;
    await sleep(RETROSCAN_SEND_DELAY_MS);
  }

  return { block, active, matchedCount, deliveredCount };
}

export async function removeKeywordBlock(id: number, tgId: string): Promise<void> {
  await deleteKeywordBlock(id, tgId);
  invalidateVariantsCache();
}
