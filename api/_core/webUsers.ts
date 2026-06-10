// Створення анонімних web-юзерів з префіксованим nickname.
// Формат tg_id: "web:<uuid>". Формат nickname: "<prefix>-<4 hex>".
// Колізії по nickname розв'язуються retry-loop (4 hex = 65k комбінацій на префікс).
import { randomBytes, randomUUID } from 'node:crypto';
import { BotUser, createWebUser, userExistsByDisplayName } from '../_telegram/storage.js';
import { Partner } from './partners.js';

const MAX_NICKNAME_RETRIES = 8;

function generateNicknameSuffix(): string {
  // 4 hex = 2 байти → 65536 комбінацій. Достатньо для MVP при <1000 юзерів/партнер.
  return randomBytes(2).toString('hex');
}

function buildNickname(prefix: string): string {
  return `${prefix}-${generateNicknameSuffix()}`;
}

async function pickUniqueNickname(prefix: string): Promise<string> {
  for (let i = 0; i < MAX_NICKNAME_RETRIES; i++) {
    const candidate = buildNickname(prefix);
    const exists = await userExistsByDisplayName(candidate);
    if (!exists) return candidate;
  }
  // Якщо за 8 спроб не знайшли вільного — додаємо timestamp як суфікс гарантованої унікальності.
  return `${prefix}-${generateNicknameSuffix()}-${Date.now().toString(36)}`;
}

export async function createAnonymousWebUser(partner: Partner): Promise<BotUser> {
  const tgId = `web:${randomUUID()}`;
  const displayName = await pickUniqueNickname(partner.nicknamePrefix);
  return createWebUser({ tgId, displayName, partnerId: partner.partnerId });
}

export function isWebUserId(tgId: string): boolean {
  return tgId.startsWith('web:');
}
