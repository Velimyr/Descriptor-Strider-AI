// Партнерські сайти, які хостять віджет.
// Модель: партнер реєструється адміном вручну → отримує plaintext API-ключ
// одноразово (далі — тільки sha256 у БД). Кожен запит з віджета валідується по
// X-Partner-Key + Origin (точний рядок, без wildcard).
import { createHash, randomBytes } from 'node:crypto';
import { db, T } from '../telegram/storage.js';

export interface Partner {
  partnerId: string;
  name: string;
  nicknamePrefix: string;
  apiKeyHash: string;
  allowedOrigins: string[];
  active: boolean;
  createdAt: string;
}

function mapPartner(r: any): Partner {
  return {
    partnerId: r.partner_id,
    name: r.name,
    nicknamePrefix: r.nickname_prefix,
    apiKeyHash: r.api_key_hash,
    allowedOrigins: r.allowed_origins || [],
    active: !!r.active,
    createdAt: r.created_at || '',
  };
}

// Формат публічного ключа: blkch_<64 hex> (32 байти ентропії).
// Префікс blkch_ потрібен для UX — щоб партнер міг розпізнати тип секрету в коді.
export function generateApiKey(): string {
  return 'blkch_' + randomBytes(32).toString('hex');
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

export async function createPartner(input: {
  partnerId: string;
  name: string;
  nicknamePrefix: string;
  allowedOrigins: string[];
}): Promise<{ partner: Partner; apiKey: string }> {
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  const { data, error } = await db()
    .from(T.partners)
    .insert({
      partner_id: input.partnerId,
      name: input.name,
      nickname_prefix: input.nicknamePrefix,
      api_key_hash: apiKeyHash,
      allowed_origins: input.allowedOrigins.map(normalizeOrigin).filter(Boolean),
      active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return { partner: mapPartner(data), apiKey };
}

export async function listPartners(): Promise<Partner[]> {
  const { data, error } = await db()
    .from(T.partners)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapPartner);
}

export async function getPartnerById(partnerId: string): Promise<Partner | null> {
  const { data, error } = await db()
    .from(T.partners)
    .select('*')
    .eq('partner_id', partnerId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapPartner(data) : null;
}

// Lookup за хешем ключа. Індекс idx_*_partners_api_key_hash робить це O(1).
export async function getPartnerByApiKey(apiKey: string): Promise<Partner | null> {
  const hash = hashApiKey(apiKey);
  const { data, error } = await db()
    .from(T.partners)
    .select('*')
    .eq('api_key_hash', hash)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data ? mapPartner(data) : null;
}

export async function updatePartner(
  partnerId: string,
  patch: Partial<Pick<Partner, 'name' | 'nicknamePrefix' | 'allowedOrigins' | 'active'>>
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.nicknamePrefix !== undefined) row.nickname_prefix = patch.nicknamePrefix;
  if (patch.allowedOrigins !== undefined) {
    row.allowed_origins = patch.allowedOrigins.map(normalizeOrigin).filter(Boolean);
  }
  if (patch.active !== undefined) row.active = patch.active;
  if (Object.keys(row).length === 0) return;
  const { error } = await db().from(T.partners).update(row).eq('partner_id', partnerId);
  if (error) throw error;
}

export async function deletePartner(partnerId: string): Promise<void> {
  const { error } = await db().from(T.partners).delete().eq('partner_id', partnerId);
  if (error) throw error;
}

// Нормалізація origin для уникнення поширених UX-помилок:
// прибираємо trailing slash, lowercase. Браузер шле точний рядок без слешу.
export function normalizeOrigin(s: string): string {
  return s.trim().toLowerCase().replace(/\/+$/, '');
}

// Точна перевірка origin після нормалізації обох сторін.
export function isOriginAllowed(partner: Partner, origin: string | undefined): boolean {
  if (!origin) return false;
  const incoming = normalizeOrigin(origin);
  return partner.allowedOrigins.map(normalizeOrigin).includes(incoming);
}
