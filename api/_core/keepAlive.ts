// Довгий keep-alive для вихідних HTTPS-запитів (Supabase, Telegram).
//
// Node за замовчуванням закриває простоюючі сокети вже через 4–5 с (fetch/undici —
// keepAliveTimeout 4 с, https.globalAgent — timeout 5 с). Апдейти бота приходять
// рідше, тож майже кожен запит до БД чи Telegram відкривав нове TLS-з'єднання:
// ~14 мс Active CPU проти ~3 мс на теплому сокеті (заміри 2026-10-02), а апдейт
// робить 3–5 таких запитів. Сервери Supabase і Telegram тримають з'єднання ≥90 с,
// тож тримаємо до 60 с.
import https from 'node:https';
import axios from 'axios';
import { Agent, fetch as undiciFetch } from 'undici';

const IDLE_MS = 60_000;

// axios: усі виклики (Telegram API, завантаження файлів із Telegram, Google тощо).
// Глобальний дефолт, щоб не прокидати агент у кожен axios.get/post.
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true, timeout: IDLE_MS });

// fetch для supabase-js. Власний fetch з undici (а не глобальний диспетчер для
// вбудованого fetch) — щоб не залежати від версії undici, вбудованої в Node.
const dispatcher = new Agent({ keepAliveTimeout: IDLE_MS, keepAliveMaxTimeout: 10 * IDLE_MS });

export function keepAliveFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return undiciFetch(input as any, { ...(init as any), dispatcher }) as unknown as Promise<Response>;
}
