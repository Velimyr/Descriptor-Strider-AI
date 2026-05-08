// Клієнтська детекція bounding-boxів для архівних справ.
// Дзеркало серверного slicer.ts (api/telegram/slicer.ts), але тільки Gemini
// і прямий виклик з браузера — щоб публічний роут підготовки справ
// працював без admin-секрету.

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectResult {
  boxes: BBox[];
  raw: string;
  model: string;
}

// Слім-промт для детекції розмірів блоків. Не просимо текст — лише координати,
// щоб економити токени. Формат відповіді сумісний з parseAnyBboxFormat нижче.
export const DETECTION_PROMPT =
  "Це фото архівної сторінки з таблицею справ. " +
  "Зображення може містити одну сторінку АБО розворот (дві сторінки поруч). " +
  "Якщо це розворот — обробляй кожну сторінку окремо: bounding box не повинен перетинати межу між сторінками; для кожної справи на лівій сторінці — окремий box, для кожної справи на правій сторінці — окремий box. " +
  "Для кожної справи (рядок таблиці з порядковим номером) визнач її bounding box у форматі " +
  "[ymin, xmin, ymax, xmax], значення 0–1000 відносно всього зображення. " +
  "Якщо текст справи займає кілька рядків таблиці на одній сторінці — об'єднай їх в один box. " +
  'Поверни лише JSON: {"boxes":[[ymin,xmin,ymax,xmax], ...]}.';

const PADDING_X = 0.005;
const PADDING_Y = 0.015;
const ALIGN_HORIZONTALLY = true;

export async function detectViaGemini(
  imageBase64: string,
  mime: string,
  apiKey: string,
  model = 'gemini-2.5-flash'
): Promise<DetectResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: mime, data: imageBase64 } },
          { text: DETECTION_PROMPT },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  const parsed = parseAnyBboxFormat(raw);
  const aligned = ALIGN_HORIZONTALLY ? alignWidth(parsed) : parsed;
  const boxes = aligned.map(b => padBox(b, PADDING_X, PADDING_Y));
  return { boxes, raw, model };
}

// =============== Парсинг різних форматів відповіді ===============

export function parseAnyBboxFormat(text: string): BBox[] {
  if (!text) return [];
  const cleaned = stripMarkdown(text);
  const parsed = safeJson(cleaned);
  if (!parsed) return [];

  const arr: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.boxes)
      ? parsed.boxes
      : Array.isArray(parsed?.results)
        ? parsed.results
        : Array.isArray(parsed?.detections)
          ? parsed.detections
          : [];

  const out: BBox[] = [];
  for (const item of arr) {
    const b = normalizeOne(item);
    if (b && b.w > 0.005 && b.h > 0.005) out.push(b);
  }
  return out;
}

function normalizeOne(item: any): BBox | null {
  if (item == null) return null;
  // Tuple [ymin, xmin, ymax, xmax].
  if (Array.isArray(item) && item.length === 4 && item.every(n => typeof n === 'number')) {
    const [ymin, xmin, ymax, xmax] = item.map(Number);
    if ([ymin, xmin, ymax, xmax].some(n => !isFinite(n))) return null;
    const scale = guessScale([ymin, xmin, ymax, xmax]);
    const x1 = Math.min(xmin, xmax) / scale;
    const y1 = Math.min(ymin, ymax) / scale;
    const x2 = Math.max(xmin, xmax) / scale;
    const y2 = Math.max(ymin, ymax) / scale;
    return clampBox({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }
  if (!item || typeof item !== 'object') return null;
  if (Array.isArray(item.box_2d) && item.box_2d.length === 4) {
    const [ymin, xmin, ymax, xmax] = item.box_2d.map(Number);
    if ([ymin, xmin, ymax, xmax].some(n => !isFinite(n))) return null;
    const scale = guessScale([ymin, xmin, ymax, xmax]);
    const x1 = Math.min(xmin, xmax) / scale;
    const y1 = Math.min(ymin, ymax) / scale;
    const x2 = Math.max(xmin, xmax) / scale;
    const y2 = Math.max(ymin, ymax) / scale;
    return clampBox({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }
  if (
    typeof item.x === 'number' &&
    typeof item.y === 'number' &&
    typeof item.w === 'number' &&
    typeof item.h === 'number'
  ) {
    const scale = guessScale([item.x, item.y, item.x + item.w, item.y + item.h]);
    return clampBox({ x: item.x / scale, y: item.y / scale, w: item.w / scale, h: item.h / scale });
  }
  if (Array.isArray(item.bbox) && item.bbox.length === 4) {
    const [x1, y1, x2, y2] = item.bbox.map(Number);
    if ([x1, y1, x2, y2].some(n => !isFinite(n))) return null;
    const scale = guessScale([x1, y1, x2, y2]);
    return clampBox({
      x: Math.min(x1, x2) / scale,
      y: Math.min(y1, y2) / scale,
      w: Math.abs(x2 - x1) / scale,
      h: Math.abs(y2 - y1) / scale,
    });
  }
  return null;
}

function alignWidth(boxes: BBox[]): BBox[] {
  if (boxes.length < 2) return boxes;
  // Кластеризуємо за x-центром: якщо це розворот (2 сторінки) — отримаємо
  // дві групи, які треба вирівнювати незалежно. Простий поділ за найбільшим
  // зазором між сусідніми центрами (> 15% ширини зображення).
  const sorted = [...boxes].sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2));
  const centers = sorted.map(b => b.x + b.w / 2);
  let splitIdx = -1;
  let maxGap = 0;
  for (let i = 1; i < centers.length; i++) {
    const gap = centers[i] - centers[i - 1];
    if (gap > maxGap) {
      maxGap = gap;
      splitIdx = i;
    }
  }
  if (splitIdx > 0 && maxGap > 0.15 && splitIdx >= 1 && splitIdx <= sorted.length - 1) {
    const left = sorted.slice(0, splitIdx);
    const right = sorted.slice(splitIdx);
    if (left.length >= 1 && right.length >= 1) {
      return [...alignWidthCluster(left), ...alignWidthCluster(right)];
    }
  }
  return alignWidthCluster(boxes);
}

function alignWidthCluster(boxes: BBox[]): BBox[] {
  if (boxes.length < 2) return boxes;
  const lefts = boxes.map(b => b.x).sort((a, b) => a - b);
  const rights = boxes.map(b => b.x + b.w).sort((a, b) => a - b);
  const medianLeft = lefts[Math.floor(lefts.length / 2)];
  const medianRight = rights[Math.floor(rights.length / 2)];
  const left = Math.min(...lefts.filter(v => v >= percentile(lefts, 0.1)));
  const right = Math.max(...rights.filter(v => v <= percentile(rights, 0.9)));
  const finalLeft = Math.min(medianLeft, left);
  const finalRight = Math.max(medianRight, right);
  const w = clamp01(finalRight - finalLeft);
  return boxes.map(b => ({ x: clamp01(finalLeft), y: b.y, w, h: b.h }));
}

function padBox(b: BBox, padX: number, padY: number): BBox {
  const x = clamp01(b.x - padX);
  const y = clamp01(b.y - padY);
  const right = clamp01(b.x + b.w + padX);
  const bottom = clamp01(b.y + b.h + padY);
  return { x, y, w: clamp01(right - x), h: clamp01(bottom - y) };
}

function stripMarkdown(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function guessScale(values: number[]): number {
  return values.some(v => isFinite(v) && v > 1.001) ? 1000 : 1;
}

function percentile(sortedAsc: number[], p: number): number {
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, Math.floor(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

function clampBox(b: BBox): BBox {
  return {
    x: clamp01(b.x),
    y: clamp01(b.y),
    w: clamp01(b.w),
    h: clamp01(b.h),
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
