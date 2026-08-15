// Автоматичне виправлення номерів справ на Кроці 2 «Експортувати опис».
//
// Працює у два проходи, від найсильнішого доказу до найслабшого.
//
// 1. ВИКИДИ НА СТОРІНЦІ. Нумерація опису монотонна: якщо стор. 17 закінчується на 130,
//    а стор. 19 починається зі 142, то на стор. 18 можуть бути тільки 131–141 — це
//    «коридор» сторінки. Номери, що з коридору випадають (34, 36, 37, 39, 40), майже
//    завжди означають недописану першу цифру. Ставимо їх у вільні місця коридору
//    (134, 136, 137, 139, 140) — і лише тоді, коли цифри, які людина таки написала,
//    збігаються з кандидатом.
//
// 2. ДУБЛІ. Те, що лишилось: два записи з однаковим номером на різних сторінках.
//    Дивимось, чий номер вписується в діапазон своєї сторінки, а чий ні; для «винного»
//    шукаємо вільний номер у пропусках його сторінки з найближчим написанням.
//
// Перший прохід часто прибирає й дублі: 34 на стор. 18 стає 134, тож 34 на стор. 8
// лишається єдиним.

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
// Звідки взято контекст: лише зі своєї сторінки, чи довелось захопити сусідні аркуші.
export type DupScope = 'page' | 'spread';
export type DupProposalKind = 'page-outlier' | 'duplicate';

export interface DupMemberAnalysis {
  rowId: string;
  number: string;
  pdf: string;
  page: string;
  neighbours: number[];  // бази сусідів, відсортовані
  scope: DupScope;
  verdict: DupVerdict;   // unknown → сусідів < 2, судити нема на чому
}

export interface DupProposal {
  key: string;                     // унікальний ключ (для React і для вибору)
  kind: DupProposalKind;
  title: string;                   // короткий підпис картки
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

type DigitKind = 'substitution' | 'transposition' | 'truncation' | 'indel' | 'far';

// Впізнавані описки — тільки на них можна будувати автоматичну пропозицію.
const RECOGNIZABLE: DigitKind[] = ['truncation', 'substitution', 'transposition', 'indel'];

function digitKind(a: string, b: string): { kind: DigitKind; dist: number } {
  const dist = levenshtein(a, b);
  // «Недописаний» номер: людина не вписала початок («123» → «23», «1024» → «24»).
  // Написані цифри збігаються точно, бракує лише префікса — дуже характерна описка,
  // тож рахуємо її нарівні із заміною однієї цифри, скільки б цифр не бракувало.
  if (a.length !== b.length && a && b) {
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    if (long.endsWith(short)) return { kind: 'truncation', dist: long.length - short.length };
  }
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
    case 'truncation': return 100;
    case 'transposition': return 90;
    case 'indel': return 70;
    default: return Math.max(0, 60 - 20 * (dist - 1));
  }
}

function kindText(kind: DigitKind, written: string, candidate: number, dist: number): string {
  switch (kind) {
    case 'truncation':
      return dist === 1
        ? `збігається з ним, якщо дописати пропущену першу цифру («${written}» → «${candidate}»)`
        : `збігається з ним, якщо дописати ${dist} пропущені початкові цифри («${written}» → «${candidate}»)`;
    case 'substitution': return 'відрізняється від нього однією цифрою';
    case 'transposition': return 'відрізняється переставленими сусідніми цифрами';
    case 'indel': return 'відрізняється однією зайвою/пропущеною цифрою';
    default: return `відрізняється на ${dist} цифр(и)`;
  }
}

// ---------------------------------------------------------------------------
// Допоміжне

const normValue = (v: string) => String(v ?? '').trim().toLowerCase();

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

// Розрив у номерах, більший за цей, розділяє сторінку на окремі кластери.
// Всередині однієї сторінки опису номери йдуть майже підряд; стрибок на 10+
// означає, що частина записів належить іншій «сотні».
const CLUSTER_GAP = 10;

interface PageEntry {
  rowId: string;
  base: number;
  suffix: string;
  raw: string;
}

// ---------------------------------------------------------------------------

export function analyzeNumbering(
  rows: DupRow[],
  duplicates: { value: string; rowIds: string[] }[]
): DupProposal[] {
  const byId = new Map<string, DupRow>();
  for (const r of rows) byId.set(r.id, r);

  // Зайняті номери — ТІЛЬКИ реальні рядки, і саме ПОВНІ значення разом із суфіксом:
  // «169» і «169а» — різні справи, тож «169» лишається вільним, навіть коли «169а» є.
  // Жовті заглушки під пропуски нумерації не блокують кандидата: навпаки, збіг із
  // заглушкою підтверджує, що там і є діра.
  const usedValues = new Set<string>();
  const emptyByValue = new Map<string, string>();
  const realBases: number[] = [];
  for (const r of rows) {
    const info = parseNumberCell(r.number);
    if (info.base == null) continue;
    const key = normValue(r.number);
    if (r.isEmpty) {
      if (!emptyByValue.has(key)) emptyByValue.set(key, r.id);
    } else {
      usedValues.add(key);
      realBases.push(info.base);
    }
  }
  const globalMin = realBases.length ? Math.min(...realBases) : null;
  const globalMax = realBases.length ? Math.max(...realBases) : null;
  const isFree = (n: number, suffix: string) => n > 0 && !usedValues.has(normValue(`${n}${suffix}`));

  // Сторінка → записи на ній (лише реальні: заглушки не мають сторінки).
  const pageIndex = new Map<string, PageEntry[]>();
  for (const r of rows) {
    if (r.isEmpty) continue;
    const info = parseNumberCell(r.number);
    if (info.base == null) continue;
    for (const t of pageTokens(r.page)) {
      const key = pageKey(r.sourcePdf, t);
      const list = pageIndex.get(key) || [];
      list.push({ rowId: r.id, base: info.base, suffix: info.suffix, raw: r.number });
      pageIndex.set(key, list);
    }
  }

  const proposals: DupProposal[] = [];
  // Рядки, для яких пропозицію вже зроблено, і номери, вже зайняті пропозиціями —
  // щоб два виправлення не претендували на одне й те саме місце.
  const handledRows = new Set<string>();
  const claimed = new Set<string>();

  // Рядки, що вже потраплять у картку дубля: щоб не показувати про них дві картки.
  const inDuplicateGroup = new Set(duplicates.flatMap(d => d.rowIds));

  for (const p of detectPageOutliers({
    pageIndex, isFree, claimed, emptyByValue, globalMin, globalMax, inDuplicateGroup,
  })) {
    proposals.push(p);
    if (p.targetRowId) handledRows.add(p.targetRowId);
  }

  for (const p of resolveDuplicates({
    duplicates, byId, pageIndex, isFree, claimed, emptyByValue, globalMin, globalMax,
    inDuplicateGroup, handledRows,
  })) {
    proposals.push(p);
    if (p.targetRowId) handledRows.add(p.targetRowId);
  }

  return proposals;
}

// Сумісність зі старою назвою.
export const analyzeDuplicates = analyzeNumbering;

// ---------------------------------------------------------------------------
// Прохід 1 — викиди на сторінці

interface Ctx {
  pageIndex: Map<string, PageEntry[]>;
  isFree: (n: number, suffix: string) => boolean;
  claimed: Set<string>;
  emptyByValue: Map<string, string>;
  globalMin: number | null;
  globalMax: number | null;
  inDuplicateGroup: Set<string>;
}

// Розбиває відсортовані номери сторінки на кластери за розривами.
function clusterBases(entries: PageEntry[]): PageEntry[][] {
  const sorted = [...entries].sort((a, b) => a.base - b.base);
  const out: PageEntry[][] = [];
  let cur: PageEntry[] = [];
  for (const e of sorted) {
    if (cur.length && e.base - cur[cur.length - 1].base > CLUSTER_GAP) {
      out.push(cur);
      cur = [];
    }
    cur.push(e);
  }
  if (cur.length) out.push(cur);
  return out;
}

// Основний («правильний») кластер сторінки — найбільший, і то з відривом.
function dominantCluster(entries: PageEntry[]): PageEntry[] | null {
  const clusters = clusterBases(entries);
  if (clusters.length < 2) return null;
  const sorted = [...clusters].sort((a, b) => b.length - a.length);
  if (sorted[0].length < 3) return null;
  if (sorted[0].length <= sorted[1].length) return null; // нічия — судити не беремось
  return sorted[0];
}

function detectPageOutliers(ctx: Ctx): DupProposal[] {
  const { pageIndex } = ctx;

  // Фаза 1: для кожної сторінки — діапазон її «правильних» номерів.
  const spine = new Map<string, { lo: number; hi: number; pdf: string; pageNo: number; token: string }>();
  for (const [key, entries] of pageIndex) {
    const hash = key.lastIndexOf('#');
    const pdf = key.slice(0, hash);
    const token = key.slice(hash + 1);
    const pageNo = parseInt(token, 10);
    if (!Number.isFinite(pageNo)) continue;
    const main = dominantCluster(entries) ?? clusterBases(entries)[0];
    if (!main || main.length === 0) continue;
    spine.set(key, { lo: main[0].base, hi: main[main.length - 1].base, pdf, pageNo, token });
  }

  // Найближча сторінка того ж файлу з відомим діапазоном (у заданому напрямку).
  const neighbourSpine = (pdf: string, pageNo: number, dir: -1 | 1) => {
    for (let step = 1; step <= 5; step++) {
      const s = spine.get(pageKey(pdf, String(pageNo + dir * step)));
      if (s) return s;
    }
    return null;
  };

  const out: DupProposal[] = [];

  for (const [key, entries] of pageIndex) {
    const info = spine.get(key);
    if (!info) continue;
    const main = dominantCluster(entries);
    if (!main) continue;

    const mainIds = new Set(main.map(e => e.rowId));
    // Той самий номер двічі на одній сторінці — це два скани тієї самої справи,
    // а не описка. Такі рядки лишаємо проходу по дублях, він пояснить це коректно.
    const perPageCount = new Map<string, number>();
    for (const e of entries) {
      const k = normValue(e.raw);
      perPageCount.set(k, (perPageCount.get(k) ?? 0) + 1);
    }
    const outliers = entries.filter(
      e => !mainIds.has(e.rowId) && (perPageCount.get(normValue(e.raw)) ?? 0) < 2
    );
    if (outliers.length === 0) continue;

    // Коридор сторінки: між останнім номером попереднього аркуша і першим наступного.
    const prev = neighbourSpine(info.pdf, info.pageNo, -1);
    const next = neighbourSpine(info.pdf, info.pageNo, 1);
    const bounded = !!prev && !!next;
    const corridorLo = prev ? prev.hi + 1 : info.lo - outliers.length;
    const corridorHi = next ? next.lo - 1 : info.hi + outliers.length;
    if (corridorHi < corridorLo) continue;
    // Захист від абсурдно широкого коридору (дірки в нумерації сторінок).
    if (corridorHi - corridorLo > 400) continue;

    const mainBases = main.map(e => e.base);
    const mainLo = mainBases[0];
    const mainHi = mainBases[mainBases.length - 1];

    // Для кожного викиду — вільні місця коридору з упізнаваною опискою.
    type Pick = { entry: PageEntry; cand: Candidate; alternatives: number };
    const picks: Pick[] = [];
    for (const e of outliers) {
      const written = String(e.base);
      const cands: Candidate[] = [];
      for (let n = corridorLo; n <= corridorHi; n++) {
        if (!ctx.isFree(n, e.suffix)) continue;
        const { kind, dist } = digitKind(written, String(n));
        if (!RECOGNIZABLE.includes(kind)) continue;
        const inMain = n >= mainLo && n <= mainHi;
        cands.push({
          base: n,
          type: inMain ? 'gap' : 'extension',
          kind,
          dist,
          score: similarityScore(kind, dist) + (inMain ? 50 : 15),
        });
      }
      if (cands.length === 0) {
        // Якщо рядок і так піде окремою карткою дубля — не дублюємо повідомлення.
        if (!ctx.inDuplicateGroup.has(e.rowId)) {
          out.push(noPickProposal(e, info, main, corridorLo, corridorHi));
        }
        continue;
      }
      cands.sort((a, b) => b.score - a.score || a.dist - b.dist || a.base - b.base);
      picks.push({ entry: e, cand: cands[0], alternatives: cands.length - 1 });
    }

    // Найвпевненіші розбирають місця першими, щоб два викиди не сіли на одне число.
    picks.sort((a, b) => b.cand.score - a.cand.score);
    for (const p of picks) {
      const value = `${p.cand.base}${p.entry.suffix}`;
      if (ctx.claimed.has(normValue(value))) continue;
      ctx.claimed.add(normValue(value));

      const member: DupMemberAnalysis = {
        rowId: p.entry.rowId,
        number: p.entry.raw,
        pdf: info.pdf,
        page: info.token,
        neighbours: mainBases,
        scope: 'page',
        verdict: 'misfits',
      };
      const confidence: DupConfidence = p.alternatives === 0 && bounded ? 'high' : 'medium';
      out.push({
        key: `outlier:${p.entry.rowId}`,
        kind: 'page-outlier',
        title: `«${p.entry.raw}» → «${value}»`,
        members: [member],
        targetRowId: p.entry.rowId,
        suggested: value,
        confidence,
        wasGloballyMissing:
          ctx.globalMin != null && ctx.globalMax != null &&
          p.cand.base >= ctx.globalMin && p.cand.base <= ctx.globalMax,
        replacesEmptyRowId: ctx.emptyByValue.get(normValue(value)) ?? null,
        reason: explainOutlier({
          entry: p.entry, info, mainBases, corridorLo, corridorHi, bounded,
          cand: p.cand, value, alternatives: p.alternatives,
          hadEmptyRow: ctx.emptyByValue.has(normValue(value)),
        }),
      });
    }
  }

  return out;
}

function noPickProposal(
  e: PageEntry,
  info: { pdf: string; token: string },
  main: PageEntry[],
  corridorLo: number,
  corridorHi: number
): DupProposal {
  const mainBases = main.map(m => m.base);
  return {
    key: `outlier:${e.rowId}`,
    kind: 'page-outlier',
    title: `«${e.raw}» — вибивається зі сторінки`,
    members: [{
      rowId: e.rowId,
      number: e.raw,
      pdf: info.pdf,
      page: info.token,
      neighbours: mainBases,
      scope: 'page',
      verdict: 'misfits',
    }],
    targetRowId: null,
    suggested: null,
    confidence: 'low',
    wasGloballyMissing: false,
    replacesEmptyRowId: null,
    reason:
      `${fmtPlace({ pdf: info.pdf, page: info.token })}: номер «${e.raw}» різко вибивається з решти ` +
      `номерів сторінки (${fmtList(mainBases)}). За сусідніми аркушами тут можливі лише ` +
      `${corridorLo}–${corridorHi}, але жодне вільне місце в цьому проміжку не схоже на «${e.raw}» ` +
      'написанням. Автоматично не визначено — потрібне ручне рішення.',
  };
}

function explainOutlier(p: {
  entry: PageEntry;
  info: { pdf: string; token: string };
  mainBases: number[];
  corridorLo: number;
  corridorHi: number;
  bounded: boolean;
  cand: Candidate;
  value: string;
  alternatives: number;
  hadEmptyRow: boolean;
}): string {
  const parts: string[] = [];
  parts.push(
    `${fmtPlace({ pdf: p.info.pdf, page: p.info.token })}: решта номерів сторінки — ` +
      `${fmtList(p.mainBases)}, а «${p.entry.raw}» із цього ряду різко вибивається.`
  );
  parts.push(
    p.bounded
      ? `За сусідніми аркушами на цій сторінці можуть бути тільки номери ${p.corridorLo}–${p.corridorHi}.`
      : `Судячи з нумерації, на цій сторінці очікуються номери близько ${p.corridorLo}–${p.corridorHi}.`
  );
  const missingNote = p.hadEmptyRow
    ? ' (він уже стоїть у таблиці як порожній рядок-пропуск — цей рядок приберемо)'
    : '';
  parts.push(
    `Вільне місце ${p.cand.base} не зайняте жодною справою${missingNote} і ` +
      `${kindText(p.cand.kind, p.entry.raw, p.cand.base, p.cand.dist)}.`
  );
  if (p.alternatives > 0) {
    parts.push(`У проміжку є ще ${p.alternatives} схожих варіант(и) — варто звірити зі скановою сторінкою.`);
  }
  parts.push(`→ Пропоную замінити «${p.entry.raw}» на «${p.value}».`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Прохід 2 — дублі

function resolveDuplicates(a: Ctx & {
  duplicates: { value: string; rowIds: string[] }[];
  byId: Map<string, DupRow>;
  handledRows: Set<string>;
}): DupProposal[] {
  const { duplicates, byId, pageIndex, handledRows } = a;

  const neighboursOf = (row: DupRow, exclude: Set<string>): { bases: number[]; scope: DupScope } => {
    const seen = new Set<string>();
    const bases = new Set<number>();
    const collect = (tokens: string[]) => {
      for (const t of tokens) {
        for (const e of pageIndex.get(pageKey(row.sourcePdf, t)) || []) {
          if (e.rowId === row.id || exclude.has(e.rowId) || seen.has(e.rowId)) continue;
          seen.add(e.rowId);
          bases.add(e.base);
        }
      }
    };
    const own = pageTokens(row.page);
    collect(own);
    if (bases.size >= 2) return { bases: [...bases].sort((x, y) => x - y), scope: 'page' };

    // На сторінці замало сусідів (буває, коли справ на аркуші всього дві-три).
    // Розширюємо контекст на сусідні аркуші того ж файлу — нумерація там продовжується.
    const around = new Set<string>();
    for (const t of own) {
      const n = parseInt(t, 10);
      if (!Number.isFinite(n)) continue;
      if (n > 1) around.add(String(n - 1));
      around.add(String(n + 1));
    }
    if (around.size === 0) return { bases: [...bases].sort((x, y) => x - y), scope: 'page' };
    collect([...around].filter(t => !own.includes(t)));
    return { bases: [...bases].sort((x, y) => x - y), scope: 'spread' };
  };

  const out: DupProposal[] = [];

  for (const dup of duplicates) {
    const groupIds = new Set(dup.rowIds);
    const memberRows = dup.rowIds.map(id => byId.get(id)).filter((r): r is DupRow => !!r);
    if (memberRows.length < 2) continue;
    // Якщо когось із групи вже виправив прохід по викидах — дубль зникне сам.
    if (memberRows.some(r => handledRows.has(r.id))) continue;

    const members: DupMemberAnalysis[] = memberRows.map(r => {
      // Близнюка виключаємо з контексту, щоб він не забруднював діапазон сторінки.
      const { bases: neighbours, scope } = neighboursOf(r, groupIds);
      const own = parseNumberCell(r.number).base;
      let verdict: DupVerdict = 'unknown';
      if (neighbours.length >= 2 && own != null) {
        const lo = neighbours[0];
        const hi = neighbours[neighbours.length - 1];
        verdict = own >= lo - 1 && own <= hi + 1 ? 'fits' : 'misfits';
      }
      return {
        rowId: r.id, number: r.number,
        pdf: String(r.sourcePdf ?? ''), page: String(r.page ?? ''),
        neighbours, scope, verdict,
      };
    });

    // Заготовка «нічого не пропонуємо» — далі або доповнюємо, або віддаємо як є.
    const stub = {
      key: `dup:${dup.value}`,
      kind: 'duplicate' as DupProposalKind,
      title: `дубль «${dup.value}» ×${members.length}`,
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
      out.push({
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
      out.push({ ...stub, reason: explainNoTarget(dup.value, members) });
      continue;
    }

    const target = misfits[0];
    const targetInfo = parseNumberCell(target.number);
    const nb = target.neighbours;
    const lo = nb[0];
    const hi = nb[nb.length - 1];
    const onPage = new Set(nb);

    // Пул кандидатів: спершу пропуски всередині діапазону сторінки, потім розширення краю.
    const suffix = targetInfo.suffix;
    const free = (n: number) => a.isFree(n, suffix) && !a.claimed.has(normValue(`${n}${suffix}`));
    const gaps: number[] = [];
    for (let n = lo; n <= hi; n++) if (!onPage.has(n) && free(n)) gaps.push(n);
    const extensions = [lo - 1, hi + 1, lo - 2, hi + 2].filter(n => !onPage.has(n) && free(n));

    const soleGap = gaps.length === 1;
    const targetDigits = targetInfo.base != null ? String(targetInfo.base) : target.number.trim();

    const scored: Candidate[] = [];
    const push = (n: number, type: 'gap' | 'extension', typeScore: number) => {
      const { kind, dist } = digitKind(targetDigits, String(n));
      const filled = [...nb, n].sort((x, y) => x - y);
      const contiguityBonus = isContiguous(filled) ? 20 : 0;
      const soleBonus = type === 'gap' && soleGap ? 25 : 0;
      scored.push({
        base: n, type, kind, dist,
        score: similarityScore(kind, dist) + typeScore + contiguityBonus + soleBonus,
      });
    };
    for (const n of gaps) push(n, 'gap', 50);
    for (const n of extensions) push(n, 'extension', Math.abs(n - lo) <= 1 || Math.abs(n - hi) <= 1 ? 15 : 8);

    // Якщо серед усіх кандидатів рівно один закінчується написаними цифрами — це
    // сильний унікальний сигнал («23» на сторінці зі 120, 121, 124 → тільки 123).
    const truncations = scored.filter(c => c.kind === 'truncation');
    if (truncations.length === 1) truncations[0].score += 25;

    if (scored.length === 0) {
      out.push({
        ...stub,
        reason:
          `${fmtPlace(target)}: номер «${target.number}» не вписується в діапазон ${lo}–${hi} ` +
          `(сусіди: ${fmtList(nb)}), але вільного номера для заміни на цій сторінці немає — ` +
          'усі номери діапазону вже зайняті іншими справами. Потрібне ручне рішення.',
      });
      continue;
    }

    scored.sort((x, y) => y.score - x.score || x.dist - y.dist || x.base - y.base);
    const best = scored[0];
    // Кандидат, не схожий на написане (три і більше цифр різниці), — це не описка,
    // а здогадка навмання. Краще чесно сказати, що не визначили.
    if (best.kind === 'far' && best.dist >= 3) {
      out.push({
        ...stub,
        reason:
          `${fmtPlace(target)}: номер «${target.number}» не вписується в діапазон ${lo}–${hi} ` +
          `(сусіди: ${fmtList(nb)}), тож помилка саме тут. Але жоден вільний номер поблизу ` +
          `(найближчий — ${best.base}) не схожий на «${target.number}» написанням, ` +
          'тож підставляти щось навмання не буду. Потрібне ручне рішення.',
      });
      continue;
    }
    const runnerUp = scored[1];
    const noTie = !runnerUp || best.score - runnerUp.score >= 20;

    let confidence: DupConfidence = 'low';
    if (best.score >= 165 && noTie) confidence = 'high';
    else if (best.score >= 100) confidence = 'medium';
    // Контекст із сусідніх аркушів слабший за контекст самої сторінки — стелю знижуємо.
    if (target.scope === 'spread' && confidence === 'high') confidence = 'medium';

    const suggested = `${best.base}${suffix}`;
    a.claimed.add(normValue(suggested));

    out.push({
      ...stub,
      targetRowId: target.rowId,
      suggested,
      confidence,
      wasGloballyMissing:
        a.globalMin != null && a.globalMax != null && best.base >= a.globalMin && best.base <= a.globalMax,
      replacesEmptyRowId: a.emptyByValue.get(normValue(suggested)) ?? null,
      reason: explainProposal({
        target,
        others: members.filter(m => m.rowId !== target.rowId),
        lo, hi, best,
        runnerUp: noTie ? null : runnerUp,
        suggested,
        wasGloballyMissing:
          a.globalMin != null && a.globalMax != null && best.base >= a.globalMin && best.base <= a.globalMax,
        hadEmptyRow: a.emptyByValue.has(normValue(suggested)),
      }),
    });
  }

  return out;
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
        return `${fmtPlace(m)} — сусідів замало (${m.neighbours.length}) навіть із суміжними аркушами, судити нема на чому`;
      }
      const lo = m.neighbours[0];
      const hi = m.neighbours[m.neighbours.length - 1];
      const verb = m.verdict === 'fits' ? 'вписується' : 'НЕ вписується';
      const src = m.scope === 'spread' ? ' (із суміжних аркушів)' : '';
      return `${fmtPlace(m)} — сусіди${src} ${fmtList(m.neighbours)} (діапазон ${lo}–${hi}), номер ${verb}`;
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

  const where =
    p.target.scope === 'spread'
      ? 'На самій сторінці сусідів замало, тож дивимось і на суміжні аркуші: там є'
      : 'На цій сторінці також є';
  parts.push(
    `${fmtPlace(p.target)}: номер «${p.target.number}». ${where} ${fmtList(p.target.neighbours)} — ` +
      `діапазон ${p.lo}–${p.hi}, і «${p.target.number}» у нього не потрапляє.`
  );

  if (p.best.type === 'gap') {
    parts.push(`Усередині діапазону бракує ${p.best.base}.`);
  } else {
    parts.push(`Діапазон суцільний, найближчий вільний номер поруч — ${p.best.base}.`);
  }

  const missingNote = p.wasGloballyMissing
    ? p.hadEmptyRow
      ? ' (він уже стоїть у таблиці як порожній рядок-пропуск — цей рядок приберемо)'
      : ' (він входить до пропусків нумерації опису)'
    : '';
  parts.push(
    `Номер ${p.best.base} не зайнятий жодною іншою справою${missingNote} і ` +
      `${kindText(p.best.kind, p.target.number, p.best.base, p.best.dist)}.`
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
