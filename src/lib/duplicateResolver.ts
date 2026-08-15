// Автоматичне вирішення дублів номерів справ на Кроці 2 «Експортувати опис».
//
// Ідея: кожен рядок знає, на якій сторінці якого PDF його знайшли. Справи на одній
// сторінці опису йдуть підряд, тож сусіди по сторінці задають очікуваний діапазон.
// Якщо з двох рядків з однаковим номером один у діапазон своєї сторінки вписується,
// а другий — ні, то помилка саме в другому; правильний номер шукаємо серед пропусків
// у нумерації цієї сторінки, віддаючи перевагу тому, що найменше відрізняється цифрами.
//
// Приклад: «123» на стор. 10 (сусіди 120–125) і «123» на стор. 23 (сусіди 219–222, 224).
// Другий не вписується, усередині 219–224 бракує 223, і 223 ↔ 123 — одна цифра. → 223.

export interface NumberInfo {
  base: number | null;
  suffix: string;
}

// "1", "1а", "12б", "" → пара (число, суфікс). Нечислові → base=null.
export function parseNumberCell(s: string): NumberInfo {
  const t = (s ?? '').trim();
  if (!t) return { base: null, suffix: '' };
  const m = t.match(/^(\d+)(.*)$/);
  if (!m) return { base: null, suffix: t };
  return { base: parseInt(m[1], 10), suffix: m[2].trim() };
}

export function compareNumberInfo(a: NumberInfo, b: NumberInfo): number {
  if (a.base !== b.base) {
    if (a.base == null) return 1;
    if (b.base == null) return -1;
    return a.base - b.base;
  }
  return a.suffix.localeCompare(b.suffix, 'uk');
}

// ---------------------------------------------------------------------------

export interface DupRow {
  id: string;
  isEmpty: boolean;     // жовтий рядок-заглушка, доданий під пропуск нумерації
  number: string;       // значення колонки-«номера»
  sourcePdf: string;
  page: string;         // «10» або «10,11» — справа може розтягуватись на кілька сторінок
}

export type DupConfidence = 'high' | 'medium' | 'low';
export type DupVerdict = 'fits' | 'misfits' | 'unknown';

export interface DupMemberAnalysis {
  rowId: string;
  number: string;
  pdf: string;
  page: string;
  neighbours: number[];  // бази сусідів по сторінці, відсортовані
  verdict: DupVerdict;   // unknown → сусідів < 2, судити нема на чому
}

export interface DupProposal {
  value: string;                   // дубльоване значення
  members: DupMemberAnalysis[];
  targetRowId: string | null;      // який рядок пропонуємо змінити
  suggested: string | null;        // новий номер (із збереженим суфіксом)
  confidence: DupConfidence;
  wasGloballyMissing: boolean;     // номер входив до пропусків нумерації опису
  replacesEmptyRowId: string | null; // жовта заглушка під цей номер, яку треба прибрати
  reason: string;                  // готове пояснення українською
}

// ---------------------------------------------------------------------------
// Цифрова схожість

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

type DigitKind = 'substitution' | 'transposition' | 'indel' | 'far';

function digitKind(a: string, b: string): { kind: DigitKind; dist: number } {
  const dist = levenshtein(a, b);
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    if (diff === 1) return { kind: 'substitution', dist: 1 };
    if (diff === 2) {
      for (let i = 0; i + 1 < a.length; i++) {
        const swapped = a.slice(0, i) + a[i + 1] + a[i] + a.slice(i + 2);
        if (swapped === b) return { kind: 'transposition', dist: 1 };
      }
    }
  } else if (Math.abs(a.length - b.length) === 1 && dist === 1) {
    return { kind: 'indel', dist: 1 };
  }
  return { kind: 'far', dist };
}

function similarityScore(kind: DigitKind, dist: number): number {
  switch (kind) {
    case 'substitution': return 100;
    case 'transposition': return 90;
    case 'indel': return 70;
    default: return Math.max(0, 60 - 20 * (dist - 1));
  }
}

// ---------------------------------------------------------------------------
// Допоміжне

function pageTokens(page: string): string[] {
  return String(page ?? '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
}

function pageKey(pdf: string, token: string): string {
  // Файл обов'язково у ключі: стор. 23 у двох різних PDF — це різні сторінки.
  return `${String(pdf ?? '').trim()}#${token}`;
}

function fmtList(nums: number[], max = 12): string {
  if (nums.length <= max) return nums.join(', ');
  return `${nums.slice(0, max).join(', ')}… (усього ${nums.length})`;
}

function fmtPlace(m: { pdf: string; page: string }): string {
  const p = m.page ? `стор. ${m.page}` : 'сторінка невідома';
  return m.pdf ? `${p} (файл ${m.pdf})` : p;
}

function isContiguous(sorted: number[]): boolean {
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

interface Candidate {
  base: number;
  type: 'gap' | 'extension';
  kind: DigitKind;
  dist: number;
  score: number;
}

// ---------------------------------------------------------------------------

export function analyzeDuplicates(
  rows: DupRow[],
  duplicates: { value: string; rowIds: string[] }[]
): DupProposal[] {
  const byId = new Map<string, DupRow>();
  for (const r of rows) byId.set(r.id, r);

  // Зайняті номери — ТІЛЬКИ реальні рядки. Жовті заглушки під пропуски нумерації
  // не блокують кандидата: навпаки, збіг із заглушкою підтверджує, що там і є діра.
  const usedBases = new Set<number>();
  const emptyByBase = new Map<number, string>();
  for (const r of rows) {
    const info = parseNumberCell(r.number);
    if (info.base == null) continue;
    if (r.isEmpty) {
      if (!emptyByBase.has(info.base)) emptyByBase.set(info.base, r.id);
    } else {
      usedBases.add(info.base);
    }
  }
  const realBases = [...usedBases];
  const globalMin = realBases.length ? Math.min(...realBases) : null;
  const globalMax = realBases.length ? Math.max(...realBases) : null;

  // Сторінка → рядки на ній (лише реальні: заглушки не мають сторінки).
  const pageIndex = new Map<string, string[]>();
  for (const r of rows) {
    if (r.isEmpty) continue;
    for (const t of pageTokens(r.page)) {
      const key = pageKey(r.sourcePdf, t);
      const list = pageIndex.get(key) || [];
      list.push(r.id);
      pageIndex.set(key, list);
    }
  }

  const neighboursOf = (row: DupRow, exclude: Set<string>): number[] => {
    const seen = new Set<string>();
    const bases = new Set<number>();
    for (const t of pageTokens(row.page)) {
      for (const id of pageIndex.get(pageKey(row.sourcePdf, t)) || []) {
        if (id === row.id || exclude.has(id) || seen.has(id)) continue;
        seen.add(id);
        const info = parseNumberCell(byId.get(id)!.number);
        if (info.base != null) bases.add(info.base);
      }
    }
    return [...bases].sort((a, b) => a - b);
  };

  const proposals: DupProposal[] = [];

  for (const dup of duplicates) {
    const groupIds = new Set(dup.rowIds);
    const memberRows = dup.rowIds.map(id => byId.get(id)).filter((r): r is DupRow => !!r);
    if (memberRows.length < 2) continue;

    const members: DupMemberAnalysis[] = memberRows.map(r => {
      // Близнюка виключаємо з контексту, щоб він не забруднював діапазон сторінки.
      const neighbours = neighboursOf(r, groupIds);
      const own = parseNumberCell(r.number).base;
      let verdict: DupVerdict = 'unknown';
      if (neighbours.length >= 2 && own != null) {
        const lo = neighbours[0];
        const hi = neighbours[neighbours.length - 1];
        verdict = own >= lo - 1 && own <= hi + 1 ? 'fits' : 'misfits';
      }
      return {
        rowId: r.id,
        number: r.number,
        pdf: String(r.sourcePdf ?? ''),
        page: String(r.page ?? ''),
        neighbours,
        verdict,
      };
    });

    // Заготовка «нічого не пропонуємо» — далі або доповнюємо, або віддаємо як є.
    const stub = {
      value: dup.value,
      members,
      targetRowId: null,
      suggested: null,
      confidence: 'low' as DupConfidence,
      wasGloballyMissing: false,
      replacesEmptyRowId: null,
    };

    // Усі члени на одній сторінці — це радше два скани тієї самої справи,
    // а не описка в номері. Автоматично таке не чіпаємо.
    const keySets = memberRows.map(r => pageTokens(r.page).map(t => pageKey(r.sourcePdf, t)));
    const sharePage =
      keySets.length > 1 &&
      keySets.every(ks => ks.length > 0) &&
      keySets.slice(1).every(ks => ks.some(k => keySets[0].includes(k)));
    if (sharePage) {
      proposals.push({
        ...stub,
        reason:
          `Обидва записи «${dup.value}» лежать на одній сторінці (${fmtPlace(members[0])}). ` +
          'Схоже, це два скани тієї самої справи, а не описка в номері — автоматично не виправляю.',
      });
      continue;
    }

    const misfits = members.filter(m => m.verdict === 'misfits');
    const fits = members.filter(m => m.verdict === 'fits');
    if (misfits.length !== 1 || fits.length === 0) {
      proposals.push({ ...stub, reason: explainNoTarget(dup.value, members) });
      continue;
    }

    const target = misfits[0];
    const targetInfo = parseNumberCell(target.number);
    const nb = target.neighbours;
    const lo = nb[0];
    const hi = nb[nb.length - 1];
    const onPage = new Set(nb);

    // Пул кандидатів: спершу пропуски всередині діапазону сторінки, потім розширення краю.
    const free = (n: number) => n > 0 && !usedBases.has(n);
    const gaps: number[] = [];
    for (let n = lo; n <= hi; n++) if (!onPage.has(n) && free(n)) gaps.push(n);
    const extensions = [lo - 1, hi + 1, lo - 2, hi + 2].filter(n => !onPage.has(n) && free(n));

    const soleGap = gaps.length === 1;
    const targetDigits = targetInfo.base != null ? String(targetInfo.base) : target.number.trim();

    const scored: Candidate[] = [];
    const push = (n: number, type: 'gap' | 'extension', typeScore: number) => {
      const { kind, dist } = digitKind(targetDigits, String(n));
      const filled = [...nb, n].sort((a, b) => a - b);
      const contiguityBonus = isContiguous(filled) ? 20 : 0;
      const soleBonus = type === 'gap' && soleGap ? 25 : 0;
      scored.push({
        base: n,
        type,
        kind,
        dist,
        score: similarityScore(kind, dist) + typeScore + contiguityBonus + soleBonus,
      });
    };
    for (const n of gaps) push(n, 'gap', 50);
    for (const n of extensions) push(n, 'extension', Math.abs(n - lo) <= 1 || Math.abs(n - hi) <= 1 ? 15 : 8);

    if (scored.length === 0) {
      proposals.push({
        ...stub,
        reason:
          `${fmtPlace(target)}: номер «${target.number}» не вписується в діапазон ${lo}–${hi} ` +
          `(сусіди: ${fmtList(nb)}), але вільного номера для заміни на цій сторінці немає — ` +
          'усі номери діапазону вже зайняті іншими справами. Потрібне ручне рішення.',
      });
      continue;
    }

    scored.sort((a, b) => b.score - a.score || a.dist - b.dist || a.base - b.base);
    const best = scored[0];
    const runnerUp = scored[1];
    const noTie = !runnerUp || best.score - runnerUp.score >= 20;

    let confidence: DupConfidence = 'low';
    if (best.score >= 165 && noTie) confidence = 'high';
    else if (best.score >= 100) confidence = 'medium';

    const suggested = `${best.base}${targetInfo.suffix}`;
    const wasGloballyMissing =
      globalMin != null && globalMax != null && best.base >= globalMin && best.base <= globalMax;

    proposals.push({
      ...stub,
      targetRowId: target.rowId,
      suggested,
      confidence,
      wasGloballyMissing,
      replacesEmptyRowId: emptyByBase.get(best.base) ?? null,
      reason: explainProposal({
        value: dup.value,
        target,
        others: members.filter(m => m.rowId !== target.rowId),
        lo,
        hi,
        best,
        runnerUp: noTie ? null : runnerUp,
        suggested,
        wasGloballyMissing,
        hadEmptyRow: emptyByBase.has(best.base),
      }),
    });
  }

  // Порядок карток — той самий, що й у банері дублікатів.
  proposals.sort((a, b) => compareNumberInfo(parseNumberCell(a.value), parseNumberCell(b.value)));
  return proposals;
}

// ---------------------------------------------------------------------------
// Пояснення (детерміновані, без LLM)

function explainNoTarget(value: string, members: DupMemberAnalysis[]): string {
  const misfits = members.filter(m => m.verdict === 'misfits');
  const fits = members.filter(m => m.verdict === 'fits');
  const unknown = members.filter(m => m.verdict === 'unknown');

  const places = members
    .map(m => {
      if (m.verdict === 'unknown') {
        return `${fmtPlace(m)} — сусідів по сторінці замало (${m.neighbours.length}), судити нема на чому`;
      }
      const lo = m.neighbours[0];
      const hi = m.neighbours[m.neighbours.length - 1];
      const verb = m.verdict === 'fits' ? 'вписується' : 'НЕ вписується';
      return `${fmtPlace(m)} — сусіди ${fmtList(m.neighbours)} (діапазон ${lo}–${hi}), номер ${verb}`;
    })
    .join('; ');

  let why: string;
  if (unknown.length === members.length) {
    why = 'Для жодного із записів немає достатнього контексту сторінки.';
  } else if (misfits.length === 0) {
    why = 'Обидва записи вписуються у діапазони своїх сторінок — незрозуміло, який із них помилковий.';
  } else if (misfits.length > 1 && fits.length === 0) {
    why = 'Жоден із записів не вписується у діапазон своєї сторінки — незрозуміло, від чого відштовхуватись.';
  } else {
    why = 'Немає жодного запису, що впевнено вписується у свою сторінку і міг би слугувати опорою.';
  }

  return `Номер «${value}»: ${places}. ${why} Автоматично не визначено — потрібне ручне рішення.`;
}

function explainProposal(p: {
  value: string;
  target: DupMemberAnalysis;
  others: DupMemberAnalysis[];
  lo: number;
  hi: number;
  best: Candidate;
  runnerUp: Candidate | null;
  suggested: string;
  wasGloballyMissing: boolean;
  hadEmptyRow: boolean;
}): string {
  const parts: string[] = [];

  parts.push(
    `${fmtPlace(p.target)}: номер «${p.target.number}». На цій сторінці також є ${fmtList(p.target.neighbours)} — ` +
      `діапазон ${p.lo}–${p.hi}, і «${p.target.number}» у нього не потрапляє.`
  );

  if (p.best.type === 'gap') {
    parts.push(`Усередині діапазону бракує ${p.best.base}.`);
  } else {
    parts.push(`Діапазон сторінки суцільний, найближчий вільний номер поруч — ${p.best.base}.`);
  }

  const kindText: Record<DigitKind, string> = {
    substitution: 'відрізняється від нього однією цифрою',
    transposition: 'відрізняється переставленими сусідніми цифрами',
    indel: 'відрізняється однією зайвою/пропущеною цифрою',
    far: `відрізняється на ${p.best.dist} цифр(и)`,
  };
  const missingNote = p.wasGloballyMissing
    ? p.hadEmptyRow
      ? ' (він уже стоїть у таблиці як порожній рядок-пропуск — цей рядок приберемо)'
      : ' (він входить до пропусків нумерації опису)'
    : '';
  parts.push(
    `Номер ${p.best.base} не зайнятий жодною іншою справою${missingNote} і ${kindText[p.best.kind]}.`
  );

  for (const o of p.others) {
    if (o.verdict === 'fits') {
      const lo = o.neighbours[0];
      const hi = o.neighbours[o.neighbours.length - 1];
      parts.push(
        `Запис «${o.number}» на ${fmtPlace(o)} у свій діапазон ${lo}–${hi} вписується — його не чіпаємо.`
      );
    }
  }

  if (p.runnerUp) {
    parts.push(`Увага: майже так само підходить ${p.runnerUp.base} — варто перевірити вручну.`);
  }

  parts.push(`→ Пропоную замінити «${p.target.number}» на «${p.suggested}».`);
  return parts.join(' ');
}
