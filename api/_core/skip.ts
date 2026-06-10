// Пропуск справи: вписуємо у bot_skipped (щоб не давати знову цьому юзеру)
// + знімаємо collab-лок, якщо лочена нами. Дублює логіку /cancel з api/telegram/bot.ts.
import { BotUser, getCase, recordSkippedCase, unlockCase } from '../telegram/storage.js';

export async function skipCase(user: BotUser, caseId: string): Promise<void> {
  await recordSkippedCase(user.tgId, caseId);
  const cse = await getCase(caseId);
  if (cse?.mode === 'collaborative' && cse.lockedByTgId === user.tgId) {
    await unlockCase(caseId);
  }
}
