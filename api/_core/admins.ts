// Модератори адмінки: акаунти в таблиці bot_admins зі списком скоупів (= вкладок).
// Модель за зразком partners.ts: створює суперадмін, пароль генерується сервером
// і показується один раз, у БД лежить лише scrypt-хеш.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, T } from '../_telegram/storage.js';
import { AdminScope, sanitizeScopes } from '../../src/telegram-bot/adminScopes.js';

export interface Admin {
  id: string;
  login: string;
  displayName: string;
  scopes: AdminScope[];
  isSuper: boolean;
  active: boolean;
  tokenEpoch: number;
  createdAt: string;
  createdBy: string;
  lastLoginAt: string | null;
}

// Аварійний суперадмін із env (TELEGRAM_ADMIN_LOGIN/PASSWORD). Не має рядка в БД,
// тому працює навіть коли таблиця порожня — інакше після міграції нікому було б зайти.
export const ENV_ADMIN_ID = 'env';

function mapAdmin(r: any): Admin {
  return {
    id: r.id,
    login: r.login,
    displayName: r.display_name || '',
    scopes: sanitizeScopes(r.scopes),
    isSuper: !!r.is_super,
    active: !!r.active,
    tokenEpoch: Number(r.token_epoch || 0),
    createdAt: r.created_at || '',
    createdBy: r.created_by || '',
    lastLoginAt: r.last_login_at || null,
  };
}

// ---------- Паролі ----------

const SCRYPT_KEYLEN = 64;

export function hashPassword(plaintext: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plaintext, salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(plaintext: string, stored: string): boolean {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const got = scryptSync(plaintext, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
  return timingSafeEqual(got, expected);
}

// Пароль, який зручно передати людині голосом/у месенджері: 4 групи по 4 символи
// з алфавіту без візуально схожих (0/O, 1/l/I).
const PWD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function generatePassword(): string {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, b => PWD_ALPHABET[b % PWD_ALPHABET.length]);
  return [0, 4, 8, 12].map(i => chars.slice(i, i + 4).join('')).join('-');
}

export function normalizeLogin(s: string): string {
  return String(s || '').trim().toLowerCase();
}

// ---------- Кеш ----------
// Guard читає адміна на КОЖЕН запит адмінки (щоб зміна прав діяла миттєво).
// Короткий кеш у пам'яті інстансу тримає egress на нулі для серій запитів
// з однієї відкритої вкладки, але не відкладає відкликання доступу надовго.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { admin: Admin | null; at: number }>();

export function invalidateAdminCache(id?: string): void {
  if (id) cache.delete(id);
  else cache.clear();
}

export async function loadAdmin(id: string): Promise<Admin | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.admin;
  const { data, error } = await db().from(T.admins).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  const admin = data ? mapAdmin(data) : null;
  cache.set(id, { admin, at: Date.now() });
  return admin;
}

// ---------- CRUD ----------

export async function listAdmins(): Promise<Admin[]> {
  const { data, error } = await db()
    .from(T.admins)
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapAdmin);
}

export async function getAdminByLogin(login: string): Promise<(Admin & { passwordHash: string }) | null> {
  const { data, error } = await db()
    .from(T.admins)
    .select('*')
    .eq('login', normalizeLogin(login))
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...mapAdmin(data), passwordHash: data.password_hash };
}

export async function createAdmin(input: {
  login: string;
  displayName?: string;
  scopes: unknown;
  isSuper?: boolean;
  createdBy: string;
}): Promise<{ admin: Admin; password: string }> {
  const password = generatePassword();
  const { data, error } = await db()
    .from(T.admins)
    .insert({
      login: normalizeLogin(input.login),
      password_hash: hashPassword(password),
      display_name: (input.displayName || '').trim().slice(0, 80),
      scopes: sanitizeScopes(input.scopes),
      is_super: !!input.isSuper,
      active: true,
      created_by: input.createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return { admin: mapAdmin(data), password };
}

// Будь-яка зміна прав/активності робить token_epoch++ — видані токени миттєво
// стають недійсними, і модератор перелогінюється вже з новим набором прав.
export async function updateAdmin(
  id: string,
  patch: { displayName?: string; scopes?: unknown; isSuper?: boolean; active?: boolean }
): Promise<Admin | null> {
  const current = await loadAdmin(id);
  if (!current) return null;
  const row: Record<string, unknown> = {};
  if (patch.displayName !== undefined) row.display_name = String(patch.displayName).trim().slice(0, 80);
  if (patch.scopes !== undefined) row.scopes = sanitizeScopes(patch.scopes);
  if (patch.isSuper !== undefined) row.is_super = !!patch.isSuper;
  if (patch.active !== undefined) row.active = !!patch.active;
  if (Object.keys(row).length === 0) return current;
  row.token_epoch = current.tokenEpoch + 1;
  const { data, error } = await db().from(T.admins).update(row).eq('id', id).select().single();
  if (error) throw error;
  invalidateAdminCache(id);
  return mapAdmin(data);
}

export async function resetAdminPassword(id: string): Promise<string | null> {
  const current = await loadAdmin(id);
  if (!current) return null;
  const password = generatePassword();
  const { error } = await db()
    .from(T.admins)
    .update({ password_hash: hashPassword(password), token_epoch: current.tokenEpoch + 1 })
    .eq('id', id);
  if (error) throw error;
  invalidateAdminCache(id);
  return password;
}

export async function deleteAdmin(id: string): Promise<void> {
  const { error } = await db().from(T.admins).delete().eq('id', id);
  if (error) throw error;
  invalidateAdminCache(id);
}

export async function touchLastLogin(id: string): Promise<void> {
  // Не критично для роботи — не валимо вхід, якщо апдейт не пройшов.
  try {
    await db().from(T.admins).update({ last_login_at: new Date().toISOString() }).eq('id', id);
    invalidateAdminCache(id);
  } catch {
    /* ignore */
  }
}
