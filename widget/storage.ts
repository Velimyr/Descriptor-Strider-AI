// LocalStorage для віджета. Ключі — з префіксом partnerId щоб два партнери на
// одному origin (рідкісний кейс) не перетиралися.
import type { SessionInfo } from './api.js';

const KEY = (partnerId: string) => `blkch:session:${partnerId}`;

export function loadSession(partnerId: string): SessionInfo | null {
  try {
    const raw = localStorage.getItem(KEY(partnerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.sessionToken || !parsed?.userId) return null;
    return parsed as SessionInfo;
  } catch {
    return null;
  }
}

export function saveSession(partnerId: string, s: SessionInfo): void {
  try {
    localStorage.setItem(KEY(partnerId), JSON.stringify(s));
  } catch {
    // Quota / приватний режим — ігноруємо. Сесія просто буде працювати в межах вкладки.
  }
}

export function clearSession(partnerId: string): void {
  try {
    localStorage.removeItem(KEY(partnerId));
  } catch {}
}
