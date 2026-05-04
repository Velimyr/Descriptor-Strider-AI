import axios from 'axios';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SlicingProvider = 'gemini' | 'claude';

export interface DetectResult {
  boxes: BBox[];
  raw: string;
  provider: SlicingProvider;
  model: string;
}

/**
 * Розпізнає справи на сторінці. Підтримує два провайдери:
 *  - 'gemini' — Google Gemini (швидкий, дешевий).
 *  - 'claude' — Anthropic Claude (точніший на складних таблицях, але повільніший).
 *
 * Зони будуються з anchor-формату ({table_*, cases:[{y_top}]}); якщо не вийшло —
 * fallback на старий bbox-формат.
 */
export async function detectCaseBoxes(
  imageBase64: string,
  mime: string,
  apiKey: string,
  provider: SlicingProvider = 'gemini'
): Promise<DetectResult> {
  const cfg = telegramBotConfig.slicing;
  const prompt = cfg.detectionStrategy === 'separators' ? cfg.autoPromptSeparators : cfg.autoPrompt;

  let raw = '';
  let model = '';
  if (provider === 'claude') {
    model = cfg.claudeModel;
    raw = await callClaude(imageBase64, mime, apiKey, prompt, model);
  } else {
    model = cfg.geminiModel || cfg.autoModel;
    raw = await callGemini(imageBase64, mime, apiKey, prompt, model);
  }

  let boxes = boxesFromAnchors(raw);
  if (boxes.length === 0) {
    const parsed = parseAnyBboxFormat(raw);
    const aligned = cfg.alignBoxesHorizontally ? alignWidth(parsed) : parsed;
    boxes = aligned.map(b => padBox(b, cfg.bboxPaddingX, cfg.bboxPaddingY));
  }

  return { boxes, raw, provider, model };
}

async function callGemini(
  imageBase64: string,
  mime: string,
  apiKey: string,
  prompt: string,
  model: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ inline_data: { mime_type: mime, data: imageBase64 } }, { text: prompt }],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const res = await axios.post(url, body, { timeout: 90000 });
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callClaude(
  imageBase64: string,
  mime: string,
  apiKey: string,
  prompt: string,
  model: string
): Promise<string> {
  const url = 'https://api.anthropic.com/v1/messages';
  const body = {
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mime, data: imageBase64 },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  };
  const res = await axios.post(url, body, {
    timeout: 120000,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
  });
  // Збираємо весь текст з content.
  const content = res.data?.content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === 'text')
      .map((c: any) => c.text || '')
      .join('\n')
      .trim();
  }
  return '';
}

// =============== Anchor-based ===============

function boxesFromAnchors(text: string): BBox[] {
  const data = safeJson(stripMarkdown(text));
  if (!data || typeof data !== 'object') return [];
  const cases = Array.isArray(data.cases) ? data.cases : null;
  if (!cases || cases.length === 0) return [];

  const cfg = telegramBotConfig.slicing;
  const scaleNeeded = guessScale([data.table_left, data.table_right, data.table_top, data.table_bottom]);
  const tableLeft = clamp01(toNum(data.table_left, 0) / scaleNeeded);
  const tableRight = clamp01(toNum(data.table_right, scaleNeeded) / scaleNeeded);
  const tableTop = clamp01(toNum(data.table_top, 0) / scaleNeeded);
  const tableBottom = clamp01(toNum(data.table_bottom, scaleNeeded) / scaleNeeded);

  // Збираємо y_top для кожної справи у нормалізовані [0..1].
  const yScale = guessScale(cases.map((c: any) => toNum(c.y_top, 0)));
  const tops = cases
    .map((c: any) => clamp01(toNum(c.y_top, 0) / yScale))
    .filter((y: number) => y > 0)
    .sort((a: number, b: number) => a - b);
  if (tops.length === 0) return [];

  const left = clamp01(tableLeft - cfg.bboxPaddingX);
  const width = clamp01(tableRight - tableLeft + cfg.bboxPaddingX * 2);
  const finalLeft = left;
  const finalWidth = clamp01(Math.min(width, 1 - finalLeft));

  // Будуємо bbox між сусідніми y_top, останній — до tableBottom.
  const bottomLimit = tableBottom > 0 && tableBottom > tops[tops.length - 1] ? tableBottom : 1;

  const boxes: BBox[] = [];
  for (let i = 0; i < tops.length; i++) {
    const yTop = tops[i];
    const yBot = i + 1 < tops.length ? tops[i + 1] : bottomLimit;
    const yStart = clamp01(yTop - cfg.bboxPaddingY);
    const yEnd = clamp01(yBot - cfg.bboxPaddingY * 0.5); // невеликий нижній padding щоб не залазити на наступну
    const h = clamp01(yEnd - yStart);
    if (h < 0.005) continue;
    boxes.push({ x: finalLeft, y: yStart, w: finalWidth, h });
  }
  return boxes;
}

// =============== Старий bbox-парсер (fallback) ===============

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

// =============== Утиліти ===============

function stripMarkdown(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toNum(v: any, fallback: number): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
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
