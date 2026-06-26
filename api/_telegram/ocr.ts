// Виклик Gemini ключами користувача (BYOK) з ротацією: якщо ключ вичерпав ліміт
// (429/RESOURCE_EXHAUSTED) — пробуємо наступний. Використовується для розпізнавання
// справи в Telegram. Низькорівневий запит — дзеркало callGemini зі slicer.ts.
import axios from 'axios';

export interface GeminiCallResult {
  text: string;
  keyIndex: number; // який ключ (0-based) спрацював — для логів/UI
}

export class AllKeysExhaustedError extends Error {
  constructor() {
    super('Усі ключі вичерпали ліміт');
    this.name = 'AllKeysExhaustedError';
  }
}

export class NoValidKeyError extends Error {
  constructor() {
    super('Жоден ключ не спрацював');
    this.name = 'NoValidKeyError';
  }
}

function isQuotaError(status: number | undefined, body: any): boolean {
  if (status === 429) return true;
  const s = String(body?.error?.status || '');
  return s === 'RESOURCE_EXHAUSTED';
}

function isAuthError(status: number | undefined): boolean {
  return status === 400 || status === 401 || status === 403;
}

async function callOnce(
  key: string,
  imageBase64: string,
  mime: string,
  prompt: string,
  model: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ inline_data: { mime_type: mime, data: imageBase64 } }, { text: prompt }],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const res = await axios.post(url, body, { timeout: 45000 });
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Пробує ключі по черзі. На quota-помилці — наступний ключ. На auth-помилці ключ
// просто пропускаємо (недійсний). Якщо всі quota → AllKeysExhaustedError;
// якщо жоден не спрацював з інших причин → NoValidKeyError.
export async function recognizeWithRotation(
  keys: string[],
  imageBase64: string,
  mime: string,
  prompt: string,
  model: string
): Promise<GeminiCallResult> {
  let sawQuota = false;
  for (let i = 0; i < keys.length; i++) {
    try {
      const text = await callOnce(keys[i], imageBase64, mime, prompt, model);
      return { text, keyIndex: i };
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      if (isQuotaError(status, data)) {
        sawQuota = true;
        continue; // наступний ключ
      }
      if (isAuthError(status)) {
        continue; // недійсний ключ — пропускаємо
      }
      // Мережа/таймаут/інше на конкретному ключі — теж пробуємо наступний.
      continue;
    }
  }
  if (sawQuota) throw new AllKeysExhaustedError();
  throw new NoValidKeyError();
}

// Перевірка валідності ключа без витрати квоти генерації: список моделей.
// 200 → ключ робочий. Інакше — ні.
export async function validateGeminiKey(key: string): Promise<boolean> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const res = await axios.get(url, { timeout: 10000 });
    return res.status === 200 && Array.isArray(res.data?.models);
  } catch {
    return false;
  }
}
