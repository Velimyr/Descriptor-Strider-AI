// Правила Кроку 2 «Експортувати опис», що доповнюють duplicateResolver.
//
// Виведені з ручних правок адміна на 47 описах (жовтень 2026): що він робив руками,
// те тут і пропонується. Нічого не застосовується без галочки, і в БД нічого не пишеться —
// пропозиції змінюють лише таблицю Кроку 2 (а отже CSV).
//
//   R1 ПОРОЖНІЙ ЗРІЗ — усі поля «—»: на зрізі немає справи → прибрати рядок з експорту.
//   R2 ДУБЛЬ-БЛИЗНЮК — той самий номер, майже та сама назва і та сама кількість аркушів:
//      одну справу вирізали двічі (часто на межі сторінок) → лишити один запис.
//      Кількість аркушів обов'язкова: справи серії «По прошению…» мають однакові назви,
//      але різний обсяг (358 і 150 арк.) — це різні справи.
//   R3 «273 або 274 по опису» — обираємо той варіант, що вписується в послідовність.
//   R4 ПОСЛІДОВНІСТЬ — справи впорядковуємо за положенням на скані (файл → сторінка →
//      колонка → висота, з bbox). Номери, що утворюють найдовший зростаючий ряд, —
//      опорні. Якщо між двома опорними рівно стільки «чужих» рядків, скільки вільних
//      номерів, — роздаємо номери по порядку («96» між 195 і 197 → «196»).
//
// Плюс normalizeCaseNumber — прибирає технічне сміття з номера ДО перевірки дублів
// (латинська «28a» → «28а», «439-» → «439»), інакше адмінка й скрипт по-різному
// вважають, що є дублем.

import type { DupProposal, DupConfidence, DupMemberAnalysis } from './duplicateResolver';

// ---------------------------------------------------------------------------
// Нормалізація номера

// Латинські літери, що візуально збігаються з кириличними і трапляються в суфіксі.
const LAT_TO_CYR: Record<string, string> = {
  a: 'а', e: 'е', o: 'о', c: 'с', p: 'р', x: 'х', y: 'у', k: 'к', i: 'і',
};

export function normalizeCaseNumber(raw: string): string {
  let s = String(raw ?? '').replace(/[​‌‍⁠﻿­]/g, '').trim();
  if (!s) return s;
  s = s.replace(/\s+/g, ' ');
  // «І-и», «I-и» — римська/кирилична І замість одиниці в літерній серії «1-а … 1-и».
  let m = s.match(/^[ІI]\s*-?\s*([а-яіїєґ])$/u);
  if (m) return `1${m[1].toLowerCase()}`;
  // Число + необов'язковий суфікс із 1–2 літер через дефіс/пробіл/нічого + хвостова пунктуація.
  m = s.match(/^(\d+)\s*-?\s*([a-zа-яіїєґ]{1,2})?\s*[.,\-–—]*$/iu);
  if (!m) return s;
  const suffix = (m[2] || '')
    .toLowerCase()
    .split('')
    .map(ch => LAT_TO_CYR[ch] ?? ch)
    .join('');
  // Латинська літера, якої немає серед двійників, — не чіпаємо (невідомо, що мали на увазі).
  if (/[a-z]/.test(suffix)) return s;
  return `${m[1]}${suffix}`;
}

// ---------------------------------------------------------------------------
// Вхід

export type BboxPart = [page: number, x: number, y: number, w: number];

export interface SeqRow {
  id: string;
  isEmpty: boolean;         // жовта заглушка під пропуск — у правилах не бере участі
  number: string;
  sourcePdf: string;
  page: string;
  parts: BboxPart[] | null; // з bbox справи; null — позиції немає (R4 рядок пропускає)
  title: string;
  sheets: string;           // кількість аркушів — у справжніх близнюків збігається
  blank: boolean;           // усі змістовні поля порожні або «—»
  filled: number;           // сумарна довжина відповідей — міра повноти запису
}

// ---------------------------------------------------------------------------
// Допоміжне

interface Num { base: number; suffix: string }

function parseNum(s: string): Num | null {
  const m = String(s ?? '').trim().match(/^(\d+)([а-яіїєґ]{0,2})$/u);
  return m ? { base: parseInt(m[1], 10), suffix: m[2] } : null;
}

function parseAlternatives(s: string): number[] | null {
  const m = String(s ?? '').match(/^\s*(\d+)\s*(?:або|или|чи|\/)\s*(\d+)/iu);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}

const CYR = 'абвгґдеєжзиіїйклмнопрстуфхцчшщюя';
// Ключ для впорядкування: «12» < «12а» < «12б» < «13».
const orderKey = (n: Num) =>
  n.base * 100 + (n.suffix === '' ? 0 : n.suffix.length === 1 ? CYR.indexOf(n.suffix) + 1 : 60);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const normTitle = (t: string) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 600);

function titleSimilarity(a: string, b: string): number {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// Чи схоже написане на кандидата як типова описка (а не просто інше число).
function looksLikeTypo(written: number, cand: number): boolean {
  const a = String(written);
  const b = String(cand);
  if (a.length < b.length && b.endsWith(a)) return true; // недописаний префікс: 96 → 196
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    if (diff === 1) return true;
    if (diff === 2 && [...a].sort().join() === [...b].sort().join()) return true; // перестановка
  }
  return Math.abs(a.length - b.length) === 1 && levenshtein(a, b) === 1;
}

function pageTokens(page: string): string[] {
  return String(page ?? '').split(',').map(t => t.trim()).filter(Boolean);
}

const TWIN_SIMILARITY = 0.85;

// Кількість аркушів: однакові числа або хоча б в одному записі не вказано.
function sameSheets(a: string, b: string): boolean {
  const x = String(a ?? '').replace(/\D/g, '');
  const y = String(b ?? '').replace(/\D/g, '');
  return !x || !y || x === y;
}

const fmtPage = (r: SeqRow) => `${r.page ? `стор. ${r.page}` : 'стор. ?'}${r.sourcePdf ? ` · ${r.sourcePdf}` : ''}`;

// Позиція на скані: (сторінка, колонка, висота) першої «власної» частини bbox.
// Частини, спільні для кількох справ (шапка групи «Рапорты и донесения…» над серією),
// для впорядкування не годяться — беремо унікальну частину справи.
function readingPositions(rows: SeqRow[]): Map<string, [number, number, number]> {
  const partKey = (p: BboxPart) => `${p[0]}|${p[1].toFixed(4)}|${p[2].toFixed(4)}|${p[3].toFixed(4)}`;
  const counts = new Map<string, number>();
  for (const r of rows) for (const p of r.parts || []) counts.set(partKey(p), (counts.get(partKey(p)) || 0) + 1);
  const out = new Map<string, [number, number, number]>();
  for (const r of rows) {
    if (!r.parts || r.parts.length === 0) continue;
    const own = r.parts.filter(p => (counts.get(partKey(p)) || 0) < 2);
    const [page, x, y, w] = (own.length ? own : r.parts)[0];
    const col = w > 0.6 ? 0 : x + w / 2 < 0.5 ? 0 : 1;
    out.set(r.id, [page, col, y]);
  }
  return out;
}

// Індекси найдовшої строго зростаючої підпослідовності.
function longestIncreasing(values: number[]): Set<number> {
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev = new Array<number>(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < values[i]) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = values[i];
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }
  const out = new Set<number>();
  let i = tailIdx.length ? tailIdx[tailIdx.length - 1] : -1;
  while (i !== -1) {
    out.add(i);
    i = prev[i];
  }
  return out;
}

const member = (r: SeqRow, neighbours: number[] = []): DupMemberAnalysis => ({
  rowId: r.id,
  number: r.number,
  pdf: r.sourcePdf,
  page: r.page,
  neighbours,
  scope: 'page',
  verdict: 'misfits',
  title: r.title,
});

// ---------------------------------------------------------------------------

export function analyzeExportRules(rows: SeqRow[]): DupProposal[] {
  const real = rows.filter(r => !r.isEmpty);
  const out: DupProposal[] = [];
  const dropped = new Set<string>();

  // ---------- R1: порожній зріз ----------
  for (const r of real) {
    if (!r.blank) continue;
    dropped.add(r.id);
    out.push({
      key: `blank:${r.id}`,
      kind: 'empty-slice',
      action: 'drop',
      title: `порожній зріз (${fmtPage(r)})`,
      members: [member(r)],
      targetRowId: r.id,
      suggested: null,
      confidence: 'high',
      wasGloballyMissing: false,
      replacesEmptyRowId: null,
      reason:
        `${fmtPage(r)}: усі поля запису порожні або «—» — на цьому зрізі немає справи ` +
        '(зазвичай розпізнавач так і пише в коментарі: «тут немає справи»). → Пропоную прибрати рядок з експорту.',
    });
  }

  const pos = readingPositions(real);
  // Порядок читання: файл → сторінка → колонка → висота. Рядки без bbox — у кінці свого файлу.
  const ordered = real
    .filter(r => !dropped.has(r.id) && pos.has(r.id))
    .sort((a, b) => {
      const f = a.sourcePdf.localeCompare(b.sourcePdf, 'uk', { numeric: true });
      if (f) return f;
      const pa = pos.get(a.id)!;
      const pb = pos.get(b.id)!;
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
    });
  const orderIdx = new Map(ordered.map((r, i) => [r.id, i]));

  // ---------- R2: дублі-близнюки ----------
  const byNumber = new Map<string, SeqRow[]>();
  for (const r of real) {
    if (dropped.has(r.id) || !parseNum(r.number)) continue;
    const list = byNumber.get(r.number) || [];
    list.push(r);
    byNumber.set(r.number, list);
  }
  const nearestBase = (id: string, step: -1 | 1, skip: Set<string>): number | null => {
    let i = orderIdx.get(id);
    if (i == null) return null;
    for (i += step; i >= 0 && i < ordered.length; i += step) {
      const r = ordered[i];
      if (skip.has(r.id)) continue;
      const n = parseNum(r.number);
      if (n) return n.base;
    }
    return null;
  };
  for (const [value, group] of byNumber) {
    if (group.length < 2) continue;
    // Кластеризуємо за схожістю назви (union-find по парах ≥ 0.8).
    const parent = group.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    let minSim = 1;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (!sameSheets(group[i].sheets, group[j].sheets)) continue;
        const s = titleSimilarity(group[i].title, group[j].title);
        if (s >= TWIN_SIMILARITY) parent[find(i)] = find(j);
      }
    }
    const clusters = new Map<number, SeqRow[]>();
    group.forEach((r, i) => {
      const k = find(i);
      clusters.set(k, [...(clusters.get(k) || []), r]);
    });
    for (const cl of clusters.values()) {
      if (cl.length < 2) continue;
      for (let i = 0; i < cl.length; i++)
        for (let j = i + 1; j < cl.length; j++) minSim = Math.min(minSim, titleSimilarity(cl[i].title, cl[j].title));
      const base = parseNum(value)!.base;
      const ids = new Set(cl.map(r => r.id));
      // Лишаємо той запис, що вписується між сусідами на скані; далі — найповніший.
      const fit = (r: SeqRow) => {
        const a = nearestBase(r.id, -1, ids);
        const b = nearestBase(r.id, 1, ids);
        return Number(a != null && a <= base) + Number(b != null && b >= base) +
          Number(a != null && b != null && a <= base && base <= b);
      };
      const keep = [...cl].sort((x, y) => fit(y) - fit(x) || y.filled - x.filled)[0];
      for (const r of cl) if (r.id !== keep.id) dropped.add(r.id);
      const sharePage = cl.every(r => pageTokens(r.page).some(t => pageTokens(keep.page).includes(t)));
      const confidence: DupConfidence = minSim >= 0.95 || sharePage ? 'high' : 'medium';
      out.push({
        key: `twin:${value}:${cl.map(r => r.id).sort().join(',')}`,
        kind: 'twin',
        action: 'keep-one',
        keepRowId: keep.id,
        title: `«${value}» ×${cl.length} — одна справа`,
        members: cl.map(r => member(r)),
        targetRowId: keep.id,
        suggested: null,
        confidence,
        wasGloballyMissing: false,
        replacesEmptyRowId: null,
        reason:
          `${cl.length} записи з номером «${value}» мають майже однакову назву ` +
          `(схожість ≥ ${Math.round(minSim * 100)}%) і однакову кількість аркушів — це та сама справа, вирізана кілька разів ` +
          '(або справа, що тягнеться на кілька сторінок). ' +
          `Пропоную лишити запис на ${fmtPage(keep)} — він вписується між сусідніми номерами на скані` +
          (cl.length > 2 ? ', решту прибрати.' : ', а другий прибрати.') +
          ' Якщо лишити треба інший — оберіть його в списку нижче.',
      });
    }
  }

  // ---------- R3 + R4: послідовність ----------
  const seq = ordered.filter(r => !dropped.has(r.id));
  const nums = seq.map(r => parseNum(r.number));
  const alts = seq.map((r, i) => (nums[i] ? null : parseAlternatives(r.number)));
  const anchorsPos: number[] = [];
  {
    const idx: number[] = [];
    seq.forEach((_, i) => {
      if (nums[i]) idx.push(i);
    });
    const lis = longestIncreasing(idx.map(i => orderKey(nums[i]!)));
    [...lis].sort((a, b) => a - b).forEach(k => anchorsPos.push(idx[k]));
  }
  const baseCount = new Map<number, number>();
  for (const n of nums) if (n) baseCount.set(n.base, (baseCount.get(n.base) || 0) + 1);
  const anchorBases = new Set(anchorsPos.map(i => nums[i]!.base));
  const claimed = new Set<number>();
  const CLOSE = 10;

  for (let k = 0; k + 1 < anchorsPos.length; k++) {
    const a = anchorsPos[k];
    const b = anchorsPos[k + 1];
    if (b - a < 2) continue;
    const lo = nums[a]!.base;
    const hi = nums[b]!.base;
    if (hi - lo > 200) continue; // розрив у файлі / між томами — не наш випадок
    const between: number[] = [];
    const occupied = new Set<number>(anchorBases);
    for (let i = a + 1; i < b; i++) {
      const n = nums[i];
      const r = seq[i];
      if (pageTokens(r.page).length > 1) continue; // справа на кількох сторінках — тут лише її фрагмент
      if (n && n.base >= lo && n.base <= hi && (n.suffix || (baseCount.get(n.base) || 0) === 1)) {
        occupied.add(n.base); // літерна вставка (58а) чи переставлений, але унікальний номер — норма
        continue;
      }
      // Унікальний номер, близький до цього місця, — радше перестановка рядків, ніж описка.
      if (n && (baseCount.get(n.base) || 0) === 1 && n.base > lo - CLOSE && n.base < hi + CLOSE) continue;
      if (!n && !alts[i] && /[\p{L}\d]/u.test(r.number)) continue; // «Не заповнюємо» тощо
      between.push(i);
    }
    if (between.length === 0) continue;
    const free: number[] = [];
    for (let n = lo + 1; n < hi; n++) if (!occupied.has(n) && !claimed.has(n)) free.push(n);
    if (free.length !== between.length) continue;

    between.forEach((i, j) => {
      const r = seq[i];
      const cand = free[j];
      const n = nums[i];
      const al = alts[i];
      const value = `${cand}${n?.suffix ?? ''}`;
      if (value === r.number) return;
      claimed.add(cand);
      const sandwich = between.length === 1;
      let confidence: DupConfidence;
      let why: string;
      if (al) {
        confidence = al.includes(cand) ? 'high' : 'medium';
        why = al.includes(cand)
          ? `З двох варіантів «${al.join('» / «')}» між ${lo} і ${hi} вписується лише ${cand}.`
          : `Жоден із варіантів «${al.join('» / «')}» не вписується; за порядком тут ${cand}.`;
      } else if (!n) {
        confidence = 'medium';
        why = `Номер не вписано, а за порядком на скані між ${lo} і ${hi} тут має бути ${cand}.`;
      } else if (looksLikeTypo(n.base, cand)) {
        confidence = 'high';
        why = `«${r.number}» стоїть між ${lo} і ${hi} і схожий на ${cand} як описка (бракує/переплутана цифра).`;
      } else if (sandwich) {
        confidence = 'high';
        why = `«${r.number}» стоїть між ${lo} і ${hi} — інших варіантів, крім ${cand}, немає.`;
      } else {
        confidence = 'medium';
        why = `«${r.number}» не вписується між ${lo} і ${hi}; вільні номери тут роздано по порядку на скані.`;
      }
      out.push({
        key: `seq:${r.id}`,
        kind: al ? 'alt-number' : 'sequence',
        action: 'renumber',
        title: `«${r.number || '—'}» → «${value}»`,
        members: [member(r, [lo, hi])],
        targetRowId: r.id,
        suggested: value,
        confidence,
        wasGloballyMissing: false,
        replacesEmptyRowId: emptyRowFor(rows, value),
        reason:
          `${fmtPage(r)}: у порядку розташування на скані перед цим записом стоїть ${lo}, після — ${hi}` +
          (between.length > 1 ? ` (між ними ${between.length} записи на ${free.length} вільних номерів)` : '') +
          `. ${why} → Пропоную «${value}».`,
      });
    });
  }

  return out;
}

// Жовта заглушка під цей номер (якщо пропуски вже додано) — приберемо разом із застосуванням.
function emptyRowFor(rows: SeqRow[], value: string): string | null {
  const r = rows.find(x => x.isEmpty && x.number.trim().toLowerCase() === value.trim().toLowerCase());
  return r ? r.id : null;
}
