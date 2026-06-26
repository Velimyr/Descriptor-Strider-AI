// Симетричне шифрування секретів користувача (Gemini API ключі) для зберігання в БД.
// AES-256-GCM. Майстер-ключ — з env USER_KEY_ENC_SECRET (будь-який рядок; із нього
// scrypt виводить 32 байти). У БД лежить лише base64(iv|tag|ciphertext) — не сам ключ.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ENV_NAME = 'USER_KEY_ENC_SECRET';
// Фіксована "сіль" — нам потрібна детермінованість (той самий пароль → той самий ключ),
// бо ми не зберігаємо сіль окремо. Секретність дає сам пароль з env.
const SALT = 'descriptor-strider-userkeys-v1';

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const pass = process.env[ENV_NAME];
  if (!pass) throw new Error(`Missing env ${ENV_NAME}`);
  cachedKey = scryptSync(pass, SALT, 32);
  return cachedKey;
}

// Чи налаштоване шифрування (є env). Дозволяє показати зрозумілу помилку замість падіння.
export function secretBoxReady(): boolean {
  return !!process.env[ENV_NAME];
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(packed: string): string {
  const buf = Buffer.from(packed, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
