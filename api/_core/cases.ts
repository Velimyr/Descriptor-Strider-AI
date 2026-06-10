// Видача справ web-юзерам. Перевикористовує існуючий dispatch (selectNextCaseForUser),
// додає collab-локінг і метадані для віджета (питання, поточні відповіді, тип задачі).
import { BotCase, BotUser, getCase, lockCase, unlockCase } from '../_telegram/storage.js';
import { selectNextCaseForUser } from '../_telegram/scheduler.js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';
import { getMeta } from '../_telegram/storage.js';

export type CaseTaskType = 'recognize' | 'review';

export interface CaseForWidget {
  caseId: string;
  imageToken: string;        // підпис для /case/:id/image (HMAC, стабільний)
  questions: Array<{ id: string; label: string; role: string }>;
  taskType: CaseTaskType;    // recognize — заповнюємо з нуля; review — є існуючі відповіді
  existingAnswers: string[] | null; // null якщо recognize
  mode: 'parallel' | 'collaborative';
  lockedUntil: string | null;       // ISO для collab; null для parallel
}

// Дефолтний lock на 30 хв (узгоджено з UX-описом). Конфіг collab-локу
// зберігається в bot_meta під ключем 'collab_lock_minutes' (як у бота).
async function getCollabLockMinutes(): Promise<number> {
  const raw = await getMeta('collab_lock_minutes');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

// Питання беремо з bot_meta.questions (та ж сама конфігурація, що TG-бот).
async function getQuestions(): Promise<Array<{ id: string; label: string; role: string }>> {
  const raw = await getMeta('questions');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<any>;
    return parsed.map((q, i) => ({
      id: q.id || String(i),
      label: q.label || q.name || '',
      role: q.role || '',
    }));
  } catch {
    return [];
  }
}

import { createHmac } from 'node:crypto';
function imageTokenFor(caseId: string): string {
  const secret = process.env.WEB_SESSION_SECRET || '';
  return createHmac('sha256', secret).update(`img:${caseId}`).digest('hex').slice(0, 32);
}

export async function getNextCaseForUser(user: BotUser): Promise<CaseForWidget | null> {
  const next = await selectNextCaseForUser(user.tgId);
  if (!next) return null;

  let lockedUntil: string | null = null;
  if (next.mode === 'collaborative') {
    const lockMinutes = await getCollabLockMinutes();
    await lockCase(next.caseId, user.tgId, lockMinutes);
    lockedUntil = new Date(Date.now() + lockMinutes * 60_000).toISOString();
  }

  const questions = await getQuestions();
  const hasCurrent = next.mode === 'collaborative' && next.confirmationsCount > 0;
  return {
    caseId: next.caseId,
    imageToken: imageTokenFor(next.caseId),
    questions,
    taskType: hasCurrent ? 'review' : 'recognize',
    existingAnswers: hasCurrent ? next.currentAnswers : null,
    mode: next.mode,
    lockedUntil,
  };
}

// Heartbeat: продовжуємо лок, поки юзер активний (тільки для collab).
// Викликається віджетом кожні ~30с. Якщо юзер закрив вкладку → пропускає кілька
// heartbeat-ів → lock_until спрацьовує природньо.
export async function heartbeatCase(user: BotUser, caseId: string): Promise<void> {
  const cse = await getCase(caseId);
  if (!cse || cse.mode !== 'collaborative') return;
  // Тільки якщо лок все ще наш — інакше хтось інший уже забрав.
  if (cse.lockedByTgId !== user.tgId) return;
  const lockMinutes = await getCollabLockMinutes();
  await lockCase(caseId, user.tgId, lockMinutes);
}

// Юзер закрив діалог не завершивши — звільняємо для інших.
export async function releaseCase(user: BotUser, caseId: string): Promise<void> {
  const cse = await getCase(caseId);
  if (!cse) return;
  if (cse.mode === 'collaborative' && cse.lockedByTgId === user.tgId) {
    await unlockCase(caseId);
  }
}
