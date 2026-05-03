import axios from 'axios';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Просить Gemini повернути bbox-и кожної справи на сторінці.
 * Очікує base64-PNG/JPEG (без prefix `data:`).
 * Повертає { boxes, raw } — raw для діагностики коли boxes порожні.
 */
export async function detectCaseBoxes(
  imageBase64: string,
  mime: string,
  apiKey: string
): Promise<{ boxes: BBox[]; raw: string }> {
  const cfg = telegramBotConfig.slicing;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.autoModel}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: mime, data: imageBase64 } },
          { text: cfg.autoPrompt },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };

  const res = await axios.post(url, body, { timeout: 60000 });
  const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = parseAnyBboxFormat(raw);
  // Розширюємо кожну зону на padding із конфіга — Gemini часто обрізає справу
  // по верхньому/нижньому краю.
  const boxes = parsed.map(b => padBox(b, cfg.bboxPaddingX, cfg.bboxPaddingY));
  return { boxes, raw };
}

function padBox(b: BBox, padX: number, padY: number): BBox {
  const x = clamp01(b.x - padX);
  const y = clamp01(b.y - padY);
  const right = clamp01(b.x + b.w + padX);
  const bottom = clamp01(b.y + b.h + padY);
  return { x, y, w: clamp01(right - x), h: clamp01(bottom - y) };
}

// Підтримує:
// 1) Gemini detect:  [{ "box_2d": [ymin, xmin, ymax, xmax] }] (0..1000)
// 2) Старий формат:  [{ "x":..., "y":..., "w":..., "h":... }] (0..1 або 0..1000)
// 3) Об'єкт з полем boxes/results: { "boxes": [...] }
export function parseAnyBboxFormat(text: string): BBox[] {
  if (!text) return [];
  // Інколи модель загортає у markdown — приберемо ```json ... ```
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
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
  if (!item || typeof item !== 'object') return null;

  // Gemini detect: box_2d = [ymin, xmin, ymax, xmax] у 0..1000
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

  // Старий формат {x,y,w,h}
  if (
    typeof item.x === 'number' &&
    typeof item.y === 'number' &&
    typeof item.w === 'number' &&
    typeof item.h === 'number'
  ) {
    const scale = guessScale([item.x, item.y, item.x + item.w, item.y + item.h]);
    return clampBox({
      x: item.x / scale,
      y: item.y / scale,
      w: item.w / scale,
      h: item.h / scale,
    });
  }

  // Альтернатива: bbox: [x1,y1,x2,y2]
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

// Якщо хоч одне число > 1 — припускаємо 0..1000 (Gemini), інакше 0..1.
function guessScale(values: number[]): number {
  return values.some(v => v > 1.001) ? 1000 : 1;
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
