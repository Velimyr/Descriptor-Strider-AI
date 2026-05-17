// Партнерські сайти, які хостять віджет.
// Модель: партнер реєструється адміном вручну → отримує plaintext API-ключ
// одноразово (далі — тільки sha256 у БД). Кожен запит з віджета валідується по
// X-Partner-Key + Origin (точний рядок, без wildcard).
import { createHash, randomBytes } from 'node:crypto';
import { db, T } from '../telegram/storage.js';

// Допустимі значення для presetColor у кастомізації віджета. Кожне мапиться
// на конкретний hex у віджеті (widget/App.tsx) — щоб партнер не міг ввести
// довільне значення CSS і зламати UI.
export const BUTTON_COLOR_PRESETS = [
  'purple',
  'blue',
  'green',
  'red',
  'orange',
  'slate',
  'pink',
  'teal',
] as const;
export type ButtonColor = typeof BUTTON_COLOR_PRESETS[number];

// 'auto' — віджет читає prefers-color-scheme браузера й рендериться відповідно
// (плюс реагує на зміну системної теми наживо).
export type PartnerTheme = 'light' | 'dark' | 'auto';

// Кутки + центри. По осі X: right / left / center. По Y: top / middle / bottom.
export const FLOATER_POSITIONS = [
  'bottom-right',  // дефолт
  'top-right',
  'middle-right',
  'bottom-left',
  'middle-left',
  'bottom-center',
] as const;
export type FloaterPosition = typeof FLOATER_POSITIONS[number];

// Варіант відображення кнопки: текст з аватаром (default) або тільки логотип.
export type ButtonDisplayMode = 'text' | 'image';

export interface PartnerCustomization {
  theme?: PartnerTheme;
  // buttonColor — preset з whitelist. Якщо задано buttonColorCustom — він перебиває preset.
  buttonColor?: ButtonColor;
  // Кастомний hex-колір (#RRGGBB), вибирається коли preset не підходить.
  buttonColorCustom?: string;
  buttonText?: string;
  buttonDisplayMode?: ButtonDisplayMode;
  position?: FloaterPosition;
  // Зміщення по вертикалі в пікселях. -500..500. Позитивне — від краю всередину;
  // для middle — вниз. Корисно щоб не перекривати sticky-хедер партнерського сайту.
  verticalOffset?: number;
}

export interface Partner {
  partnerId: string;
  name: string;
  nicknamePrefix: string;
  apiKeyHash: string;
  allowedOrigins: string[];
  active: boolean;
  createdAt: string;
  customization: PartnerCustomization;
}

function sanitizeCustomization(raw: any): PartnerCustomization {
  if (!raw || typeof raw !== 'object') return {};
  const out: PartnerCustomization = {};
  if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'auto') out.theme = raw.theme;
  if (typeof raw.buttonColor === 'string' && (BUTTON_COLOR_PRESETS as readonly string[]).includes(raw.buttonColor)) {
    out.buttonColor = raw.buttonColor as ButtonColor;
  }
  if (typeof raw.buttonText === 'string') {
    const t = raw.buttonText.trim().slice(0, 60);
    if (t) out.buttonText = t;
  }
  if (typeof raw.buttonColorCustom === 'string') {
    // Приймаємо тільки #RRGGBB (6 hex). Це достатньо для UX і блокує CSS-injection
    // (rgba(...), var(...), url(...) тощо).
    const c = raw.buttonColorCustom.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(c)) out.buttonColorCustom = c.toLowerCase();
  }
  if (raw.buttonDisplayMode === 'text' || raw.buttonDisplayMode === 'image') {
    out.buttonDisplayMode = raw.buttonDisplayMode;
  }
  if (typeof raw.position === 'string' && (FLOATER_POSITIONS as readonly string[]).includes(raw.position)) {
    out.position = raw.position as FloaterPosition;
  }
  if (typeof raw.verticalOffset === 'number' && Number.isFinite(raw.verticalOffset)) {
    out.verticalOffset = Math.max(-500, Math.min(500, Math.round(raw.verticalOffset)));
  }
  return out;
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
    customization: sanitizeCustomization(r.customization),
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
  customization?: PartnerCustomization;
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
      customization: sanitizeCustomization(input.customization),
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
  patch: Partial<Pick<Partner, 'name' | 'nicknamePrefix' | 'allowedOrigins' | 'active' | 'customization'>>
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.nicknamePrefix !== undefined) row.nickname_prefix = patch.nicknamePrefix;
  if (patch.allowedOrigins !== undefined) {
    row.allowed_origins = patch.allowedOrigins.map(normalizeOrigin).filter(Boolean);
  }
  if (patch.active !== undefined) row.active = patch.active;
  if (patch.customization !== undefined) row.customization = sanitizeCustomization(patch.customization);
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
