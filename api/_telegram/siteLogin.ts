// Вхід на сайт «Документи Губернатора» (442.uagenealogy.com) через бота.
// Сайт показує одноразовий код (GP-7K3M9Q) → учасник надсилає його боту
// (/start gp_7K3M9Q або /kod GP-7K3M9Q) → бот повідомляє сайту, хто це,
// скільки в нього балів і чи він заблокований. Поріг балів перевіряє сайт.
// Секрет — лише з env (telegramBotConfig.governorSite.secretEnv), не логуємо.
import axios from 'axios';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

export interface SiteLoginParticipant {
  tgId: string;
  name: string;     // first_name + last_name (або username), до 100 символів
  points: number;   // сумарний бал (той самий, що йде в карму Навігатора)
  banned: boolean;
}

// Текст із Telegram-профілю: «Імʼя Прізвище», інакше username.
export function siteLoginName(from: { first_name?: string; last_name?: string; username?: string }): string {
  const full = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  return (full || from.username || '').slice(0, 100);
}

// Підтверджує код на сайті. Повертає текст відповіді учаснику.
export async function confirmSiteLogin(rawCode: string, p: SiteLoginParticipant): Promise<string> {
  // Сайт сам нормалізує регістр/префікс; знімаємо лише gp-/gp_ для читабельних логів.
  const code = rawCode.trim().replace(/^gp[-_ ]?/i, '');
  if (!code) return 'Надішліть код із сайту, напр.: <code>/kod GP-7K3M9Q</code>';

  const secret = process.env[telegramBotConfig.governorSite.secretEnv];
  if (!secret) {
    console.error(`[site-login] missing env ${telegramBotConfig.governorSite.secretEnv}`);
    return 'Не вдалося підтвердити вхід, спробуйте пізніше.';
  }

  const body = {
    code,
    telegram_id: p.tgId,
    name: p.name,
    points: Math.max(0, Math.round(p.points || 0)),
    banned: p.banned,
  };
  let status: number;
  let data: any;
  try {
    const res = await axios.post(telegramBotConfig.governorSite.confirmUrl, body, {
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      timeout: 10000,
      // Самі обробляємо 404/409/тощо — axios не має кидати на не-2xx.
      validateStatus: () => true,
    });
    status = res.status;
    data = res.data;
  } catch (e: any) {
    // Повторів не робимо — учасник просто отримає новий код.
    console.error('[site-login] network error', code, e?.code || e?.message || e);
    return 'Сайт тимчасово недоступний, спробуйте за кілька хвилин.';
  }

  if (status >= 200 && status < 300) {
    console.log('[site-login] confirmed', code, p.tgId);
    return '✅ Вхід на сайт «Документи Губернатора» підтверджено. Поверніться в браузер — сторінка відкриється сама.';
  }
  if (status === 404) return '⌛ Код недійсний або прострочений. Отримайте новий код на сайті.';
  if (status === 409) return 'Цей код уже використано. Якщо сайт не відкрився — отримайте новий код.';
  if (status >= 500) {
    console.error('[site-login] site error', status, code);
    return 'Сайт тимчасово недоступний, спробуйте за кілька хвилин.';
  }
  // 400 bad_request / 401 unauthorized — помилка бота чи конфігурації.
  console.error('[site-login] confirm failed', status, code, JSON.stringify(data ?? '').slice(0, 300));
  return 'Не вдалося підтвердити вхід, спробуйте пізніше.';
}
