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
 */
export async function detectCaseBoxes(imageBase64: string, mime: string, apiKey: string): Promise<BBox[]> {
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
  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((b: any) => typeof b?.x === 'number' && typeof b?.y === 'number' && typeof b?.w === 'number' && typeof b?.h === 'number')
      .map((b: any) => ({
        x: clamp01(b.x),
        y: clamp01(b.y),
        w: clamp01(b.w),
        h: clamp01(b.h),
      }))
      .filter(b => b.w > 0.01 && b.h > 0.01);
  } catch {
    return [];
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
