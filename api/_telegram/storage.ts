// Сховище стану бота — Postgres через Supabase. Один файл, інтерфейс зберігається.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { telegramBotConfig } from '../../src/telegram-bot/config.js';

let cachedClient: SupabaseClient | null = null;

// Префікс імен таблиць/RPC. Дефолт 'bot_' — прод-поведінка без env-у.
// Для staging-контуру задається TABLE_PREFIX=botdev_ (окремий набір таблиць у тій самій БД).
const PREFIX = process.env.TABLE_PREFIX ?? 'bot_';
export const T = {
  users:             `${PREFIX}users`,
  cases:             `${PREFIX}cases`,
  sessions:          `${PREFIX}sessions`,
  meta:              `${PREFIX}meta`,
  submissions:       `${PREFIX}submissions`,
  daily:             `${PREFIX}daily_scores`,
  skipped:           `${PREFIX}skipped`,
  caseConfirmations: `${PREFIX}case_confirmations`,
  integrityReviews:  `${PREFIX}integrity_reviews`,
  partners:          `${PREFIX}partners`,
  linkCodes:         `${PREFIX}link_codes`,
  userBadges:        `${PREFIX}user_badges`,
  puzzles:           `${PREFIX}puzzles`,
  puzzleProgress:    `${PREFIX}puzzle_progress`,
  puzzleWinners:     `${PREFIX}puzzle_winners`,
  monthlyPoints:     `${PREFIX}monthly_points`,
  broadcasts:        `${PREFIX}broadcasts`,
  broadcastRecipients: `${PREFIX}broadcast_recipients`,
};
const RPC_INC_DAILY = `${PREFIX}inc_daily`;
const RPC_DESCRIPTION_PROGRESS = `${PREFIX}description_progress`;
const RPC_CANDIDATE_CASES = `${PREFIX}candidate_cases`;
const RPC_CANDIDATE_CASES_V2 = `${PREFIX}candidate_cases_v2`;
const RPC_AWARD_PUZZLE_WINNER = `${PREFIX}award_puzzle_winner`;
const RPC_INC_MONTHLY = `${PREFIX}inc_monthly`;
const RPC_MONTHLY_MONTHS = `${PREFIX}monthly_months`;
const RPC_INC_TOTAL_POINTS = `${PREFIX}inc_total_points`;
const RPC_LEADERBOARD_TOP = `${PREFIX}leaderboard_top`;
const RPC_USER_RANK = `${PREFIX}user_rank`;
const RPC_USER_STATUS_COUNTS = `${PREFIX}user_status_counts`;
const RPC_FUND_ETA_STATS = `${PREFIX}fund_eta_stats`;
const RPC_TODAY_ACTIVITY = `${PREFIX}today_activity`;
const RPC_DAILY_ACTIVITY = `${PREFIX}daily_activity`;
const RPC_BROADCAST_PREVIEW = `${PREFIX}broadcast_preview`;
const RPC_BROADCAST_RECIPIENTS_SELECT = `${PREFIX}broadcast_recipients_select`;
const RPC_BROADCAST_CLAIM_BATCH = `${PREFIX}broadcast_claim_batch`;
const RPC_BROADCAST_REAP = `${PREFIX}broadcast_reap`;
const RPC_BROADCAST_INC = `${PREFIX}broadcast_inc`;
const RPC_BROADCAST_CLICK = `${PREFIX}broadcast_click`;

export function db(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env[telegramBotConfig.supabase.urlEnv];
  const key = process.env[telegramBotConfig.supabase.serviceKeyEnv];
  if (!url || !key) {
    throw new Error(
      `Missing env ${telegramBotConfig.supabase.urlEnv} / ${telegramBotConfig.supabase.serviceKeyEnv}`
    );
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

// rowIndex більше не потрібен (PK = tg_id / case_id), але лишаємо у типі
// для backward-compat з bot.ts, який передає його як другий аргумент upsertUser/setSession.
export interface BotUser {
  rowIndex: number; // legacy, не використовується
  tgId: string;
  displayName: string;
  totalPoints: number;
  lastDispatchedCaseId: string;
  lastDispatchedAt: string;
  consecutiveMisses: number;
  status: 'active' | 'paused';
  pendingAction: '' | 'rename' | 'edit_city' | 'edit_facebook' | 'edit_photo' | 'edit_contact' | 'add_gemini_key';
  createdAt: string;
  introShownAt: string; // ISO або '' якщо ще не показували
  // Час "засіву" бейджів. '' (NULL у БД) = ще не засівали: на першій перевірці
  // вже зароблені бейджі видаються тихо. Новим юзерам ставимо при /start.
  badgesSeededAt: string;
  // Web-юзери: source='web', partnerId=<id>. Для TG — source='tg', partnerId=null.
  // Колонки додані міграцією schema-widget-*.sql.
  source: 'tg' | 'web';
  partnerId: string | null;
  // Профіль (всі опціональні). public: city/region/photoFileId; private: tgUsername/phoneNumber/facebookUrl.
  city: string;
  region: string;
  tgUsername: string;     // @handle без @; автозбирається з updates
  phoneNumber: string;    // з share-contact кнопки
  facebookUrl: string;
  photoFileId: string;    // TG file_id найбільшої фото
  photoMessageId: string; // id повідомлення у приватному каналі профілів
  // Бан (перевірка доброчесності). true → користувач не може виконати жодну дію.
  banned: boolean;
  // BYOK: чи має користувач збережені Gemini-ключі. Самі ключі (зашифровані) не
  // тягнемо в модель — лише прапорець наявності. Читання/запис — окремими функціями.
  hasGeminiKeys: boolean;
  // Які справи надсилати користувачу: всі / тільки розпізнавання / тільки перевірка.
  // Діє і на «Нова справа», і на розсилку за розкладом (через selectNextCaseForUser).
  caseFilter: CaseFilter;
  // Модель Gemini для AI-розпізнавання: 'flash-lite' (дефолт) або 'flash'.
  geminiModel: GeminiModelChoice;
}

export type CaseFilter = 'all' | 'recognition' | 'verification';
export type GeminiModelChoice = 'flash-lite' | 'flash';

// Маппінг вибору моделі → ідентифікатор моделі Gemini (стабільні -latest аліаси).
export function resolveGeminiModelId(choice: GeminiModelChoice): string {
  return choice === 'flash' ? 'gemini-flash-latest' : 'gemini-flash-lite-latest';
}

export interface BotCase {
  rowIndex: number;
  caseId: string;
  tgFileId: string;
  tgChatId: string;
  tgMessageId: string;
  sourcePdf: string;
  page: string;
  bbox: string;
  archive: string;
  fund: string;
  opys: string;
  sprava: string;
  submissionsCount: number;
  status: 'open' | 'done';
  createdAt: string;
  // Collab-режим (опціонально, для нових справ).
  mode: 'parallel' | 'collaborative';
  currentAnswers: string[];
  currentAuthorTgId: string;
  confirmationsCount: number;
  lockedByTgId: string;
  lockedUntil: string; // ISO або '' якщо не лочена
  updatedAt: string;   // оновлюється при collab-подіях
}

export interface BotSession {
  rowIndex: number;
  tgId: string;
  caseId: string;
  answersJson: string;
  currentQ: number;
  startedAt: string;
  updatedAt: string;
  state: 'asking' | 'confirming' | 'editing' | 'previewing';
}

// Маперивчасть тут — нижче є мапери row → доменна модель.
function mapUser(r: any): BotUser {
  return {
    rowIndex: 0,
    tgId: r.tg_id,
    displayName: r.display_name || '',
    totalPoints: Number(r.total_points || 0),
    lastDispatchedCaseId: r.last_dispatched_case_id || '',
    lastDispatchedAt: r.last_dispatched_at || '',
    consecutiveMisses: r.consecutive_misses || 0,
    status: (r.status || 'active') as 'active' | 'paused',
    pendingAction: (r.pending_action || '') as BotUser['pendingAction'],
    createdAt: r.created_at || '',
    introShownAt: r.intro_shown_at || '',
    badgesSeededAt: r.badges_seeded_at || '',
    source: (r.source || 'tg') as 'tg' | 'web',
    partnerId: r.partner_id || null,
    city: r.city || '',
    region: r.region || '',
    tgUsername: r.tg_username || '',
    phoneNumber: r.phone_number || '',
    facebookUrl: r.facebook_url || '',
    photoFileId: r.photo_file_id || '',
    photoMessageId: r.photo_message_id || '',
    banned: r.banned === true,
    hasGeminiKeys: !!r.gemini_keys_enc,
    caseFilter: (r.case_filter || 'all') as CaseFilter,
    geminiModel: (r.gemini_model || 'flash-lite') as GeminiModelChoice,
  };
}

// Легке читання фільтра справ (одна колонка). Викликається при виборі наступної справи.
export async function getUserCaseFilter(tgId: string): Promise<CaseFilter> {
  const { data, error } = await db()
    .from(T.users)
    .select('case_filter')
    .eq('tg_id', tgId)
    .maybeSingle();
  if (error) throw error;
  return ((data as any)?.case_filter || 'all') as CaseFilter;
}

// Легке читання вибраної моделі (одна колонка). Дефолт — Flash Lite.
export async function getUserGeminiModel(tgId: string): Promise<GeminiModelChoice> {
  const { data, error } = await db()
    .from(T.users)
    .select('gemini_model')
    .eq('tg_id', tgId)
    .maybeSingle();
  if (error) throw error;
  return ((data as any)?.gemini_model || 'flash-lite') as GeminiModelChoice;
}

// ===== BYOK: Gemini-ключі користувача =====
// У БД — одна текстова колонка gemini_keys_enc із зашифрованим JSON-масивом ключів.

export async function getUserGeminiKeys(tgId: string): Promise<string[]> {
  const { data, error } = await db()
    .from(T.users)
    .select('gemini_keys_enc')
    .eq('tg_id', tgId)
    .maybeSingle();
  if (error) throw error;
  const enc = data?.gemini_keys_enc;
  if (!enc) return [];
  try {
    const { decryptSecret } = await import('./secretBox.js');
    const arr = JSON.parse(decryptSecret(enc));
    return Array.isArray(arr) ? arr.filter((k: any) => typeof k === 'string' && k.length > 0) : [];
  } catch (e) {
    console.error('getUserGeminiKeys decrypt failed', e);
    return [];
  }
}

export async function setUserGeminiKeys(tgId: string, keys: string[]): Promise<void> {
  const clean = keys.map(k => k.trim()).filter(k => k.length > 0);
  let value: string | null = null;
  if (clean.length > 0) {
    const { encryptSecret } = await import('./secretBox.js');
    value = encryptSecret(JSON.stringify(clean));
  }
  const { error } = await db().from(T.users).update({ gemini_keys_enc: value }).eq('tg_id', tgId);
  if (error) throw error;
}

function mapCase(r: any): BotCase {
  const ca = r.current_answers;
  return {
    rowIndex: 0,
    caseId: r.case_id,
    tgFileId: r.tg_file_id || '',
    tgChatId: r.tg_chat_id || '',
    tgMessageId: r.tg_message_id || '',
    sourcePdf: r.source_pdf || '',
    page: r.page || '',
    bbox: r.bbox || '',
    archive: r.archive || '',
    fund: r.fund || '',
    opys: r.opys || '',
    sprava: r.sprava || '',
    submissionsCount: r.submissions_count || 0,
    status: (r.status || 'open') as 'open' | 'done',
    createdAt: r.created_at || '',
    mode: (r.mode || 'parallel') as 'parallel' | 'collaborative',
    currentAnswers: Array.isArray(ca) ? ca.map(String) : [],
    currentAuthorTgId: r.current_author_tg_id || '',
    confirmationsCount: r.confirmations_count || 0,
    lockedByTgId: r.locked_by_tg_id || '',
    lockedUntil: r.locked_until || '',
    updatedAt: r.updated_at || r.created_at || '',
  };
}

function mapSession(r: any): BotSession {
  return {
    rowIndex: 0,
    tgId: r.tg_id,
    caseId: r.case_id || '',
    answersJson: r.answers_json || '[]',
    currentQ: r.current_q || 0,
    startedAt: r.started_at || '',
    updatedAt: r.updated_at || '',
    state: (r.state || 'asking') as 'asking' | 'confirming' | 'editing' | 'previewing',
  };
}

// ---------- META (з кешем) ----------
const metaCache = new Map<string, { value: string; expires: number }>();
const META_TTL_MS = 60 * 1000;

export function invalidateMetaCache(key?: string) {
  if (key) metaCache.delete(key);
  else metaCache.clear();
}

export async function getMeta(key: string): Promise<string | null> {
  const cached = metaCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value || null;

  const { data, error } = await db().from(T.meta).select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  const value = data?.value ?? '';
  metaCache.set(key, { value, expires: Date.now() + META_TTL_MS });
  return value || null;
}

export async function setMeta(key: string, value: string) {
  metaCache.set(key, { value, expires: Date.now() + META_TTL_MS });
  const { error } = await db().from(T.meta).upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

// ---------- USERS ----------
export async function getAllUsers(): Promise<BotUser[]> {
  // Пагінація — Supabase за замовчуванням обмежує 1000 рядками.
  const pageSize = 1000;
  let from = 0;
  const out: BotUser[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.users)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows.map(mapUser));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Компактний список юзерів для адмін-overview: тільки 5 полів,
// без важких photo_file_id/photo_message_id/created_at/etc. Замінює `getAllUsers()`
// у місцях, де адмінка показує таблицю рейтингу.
export interface CompactUser {
  tgId: string;
  displayName: string;
  totalPoints: number;
  status: string;
  consecutiveMisses: number;
}
export async function getCompactUsersForOverview(): Promise<CompactUser[]> {
  const pageSize = 1000;
  let from = 0;
  const out: CompactUser[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.users)
      .select('tg_id, display_name, total_points, status, consecutive_misses')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(
      ...rows.map((r: any) => ({
        tgId: r.tg_id,
        displayName: r.display_name || '',
        totalPoints: Number(r.total_points || 0),
        status: r.status || '',
        consecutiveMisses: Number(r.consecutive_misses || 0),
      }))
    );
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Топ-N рейтингу. Повертає лише потрібні віджету поля. RPC + index по total_points.
// Замінює `getAllUsers()`-based підхід для рейтингу (egress-фікс).
export interface LeaderboardRow {
  tgId: string;
  displayName: string;
  totalPoints: number;
}
export async function getLeaderboardTop(limit: number): Promise<LeaderboardRow[]> {
  const { data, error } = await db().rpc(RPC_LEADERBOARD_TOP, { p_limit: limit });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    tgId: r.tg_id,
    displayName: r.display_name || '',
    totalPoints: Number(r.total_points || 0),
  }));
}

// Ранг + кількість юзерів + бали для конкретного tg_id. Один query замість скану.
export async function getUserRank(tgId: string): Promise<{
  rank: number;
  totalUsers: number;
  totalPoints: number;
}> {
  const { data, error } = await db().rpc(RPC_USER_RANK, { p_tg_id: tgId });
  if (error) throw error;
  // RPC повертає setof — Supabase віддає масив. Беремо першу й єдину строку.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    rank: Number(row?.rank || 0),
    totalUsers: Number(row?.total_users || 0),
    totalPoints: Number(row?.total_points || 0),
  };
}

// Тільки tg_id активних юзерів — для cron/tick диспатчу. Paused пропускаємо
// на рівні БД (вони все одно ігноруються циклом). Egress: ~10 байт/юзер
// замість ~5 KB/юзер. Пагінація — на випадок >1000 активних юзерів.
export async function getActiveUserTgIds(): Promise<string[]> {
  const pageSize = 1000;
  let from = 0;
  const out: string[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.users)
      .select('tg_id')
      .eq('status', 'active')
      .order('tg_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows.map((r: any) => r.tg_id as string));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Слім-список усіх юзерів (tg_id + сумарний бал) для нічної синхронізації карми.
// Лише 2 колонки → мінімальний egress. Пагінація на випадок >1000 юзерів.
export async function getAllUserTotals(): Promise<Array<{ tgId: string; totalPoints: number }>> {
  const pageSize = 1000;
  let from = 0;
  const out: Array<{ tgId: string; totalPoints: number }> = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.users)
      .select('tg_id, total_points')
      .order('tg_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(
      ...rows.map((r: any) => ({
        tgId: String(r.tg_id),
        totalPoints: Number(r.total_points || 0),
      }))
    );
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Один рядок: загалом, активних, паузнутих. Замінює повний скан bot_users
// лише задля статистики у cron/tick.
export async function getUserStatusCounts(): Promise<{
  total: number;
  active: number;
  paused: number;
}> {
  const { data, error } = await db().rpc(RPC_USER_STATUS_COUNTS);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    total: Number(row?.total || 0),
    active: Number(row?.active || 0),
    paused: Number(row?.paused || 0),
  };
}

// Точкове отримання юзерів за списком tg_id. Уникає `getAllUsers()` у місцях,
// де треба підтягнути дані лише для відомого підмножини (напр. session-cleanup).
export async function getUsersByIds(tgIds: string[]): Promise<BotUser[]> {
  if (tgIds.length === 0) return [];
  // Дедуплікація + захист від занадто довгих IN-списків (PostgREST ліміт URL).
  const unique = Array.from(new Set(tgIds));
  const out: BotUser[] = [];
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data, error } = await db().from(T.users).select('*').in('tg_id', slice);
    if (error) throw error;
    out.push(...(data || []).map(mapUser));
  }
  return out;
}

export async function getUser(tgId: string): Promise<BotUser | null> {
  const { data, error } = await db().from(T.users).select('*').eq('tg_id', tgId).maybeSingle();
  if (error) throw error;
  return data ? mapUser(data) : null;
}

export async function upsertUser(
  u: Omit<BotUser, 'rowIndex'>,
  _existingRowIndex?: number // legacy, ігнорується
): Promise<void> {
  const { error } = await db()
    .from(T.users)
    .upsert(
      {
        tg_id: u.tgId,
        display_name: u.displayName,
        total_points: u.totalPoints,
        last_dispatched_case_id: u.lastDispatchedCaseId,
        last_dispatched_at: u.lastDispatchedAt || null,
        consecutive_misses: u.consecutiveMisses,
        status: u.status,
        pending_action: u.pendingAction || '',
        intro_shown_at: u.introShownAt || null,
        badges_seeded_at: u.badgesSeededAt || null,
        // created_at — не оновлюємо при апдейті, але дамо при insert
        ...(u.createdAt ? { created_at: u.createdAt } : {}),
      },
      { onConflict: 'tg_id' }
    );
  if (error) throw error;
}

// Створює нового web-юзера (source='web'). tg_id має бути префіксований "web:".
// nickname має бути унікальним по партнеру — викликач сам гарантує (через retry на collision).
// Конфлікт на (display_name) усередині партнерського неймспейсу не валідується тут на рівні БД,
// бо display_name унікальний глобально в існуючому коді — для web це OK через високоентропійні суфікси.
export async function createWebUser(input: {
  tgId: string;
  displayName: string;
  partnerId: string | null;
}): Promise<BotUser> {
  const { data, error } = await db()
    .from(T.users)
    .insert({
      tg_id: input.tgId,
      display_name: input.displayName,
      total_points: 0,
      last_dispatched_case_id: '',
      consecutive_misses: 0,
      status: 'active',
      pending_action: '',
      source: 'web',
      // NULL якщо без партнера (напр. реєстрація на сайті перевірки) — інакше FK на partners падає.
      partner_id: input.partnerId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapUser(data);
}

// Перевірка існування юзера за nickname (для гарантії унікальності web-нікнеймів).
export async function userExistsByDisplayName(displayName: string): Promise<boolean> {
  const { data, error } = await db()
    .from(T.users)
    .select('tg_id')
    .eq('display_name', displayName)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Case-insensitive варіант. Уникаємо повного скану `getAllUsers` у rename-flow.
export async function userExistsByDisplayNameCi(
  displayName: string,
  excludeTgId?: string
): Promise<boolean> {
  let q = db().from(T.users).select('tg_id').ilike('display_name', displayName).limit(1);
  if (excludeTgId) q = q.neq('tg_id', excludeTgId);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function patchUser(tgId: string, patch: Partial<Omit<BotUser, 'rowIndex' | 'tgId'>>) {
  const dbPatch: any = {};
  if (patch.displayName !== undefined) dbPatch.display_name = patch.displayName;
  if (patch.totalPoints !== undefined) dbPatch.total_points = patch.totalPoints;
  if (patch.lastDispatchedCaseId !== undefined) dbPatch.last_dispatched_case_id = patch.lastDispatchedCaseId;
  if (patch.lastDispatchedAt !== undefined) dbPatch.last_dispatched_at = patch.lastDispatchedAt || null;
  if (patch.consecutiveMisses !== undefined) dbPatch.consecutive_misses = patch.consecutiveMisses;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.pendingAction !== undefined) dbPatch.pending_action = patch.pendingAction;
  if (patch.introShownAt !== undefined) dbPatch.intro_shown_at = patch.introShownAt || null;
  if (patch.badgesSeededAt !== undefined) dbPatch.badges_seeded_at = patch.badgesSeededAt || null;
  if (patch.city !== undefined) dbPatch.city = patch.city || null;
  if (patch.region !== undefined) dbPatch.region = patch.region || null;
  if (patch.tgUsername !== undefined) dbPatch.tg_username = patch.tgUsername || null;
  if (patch.phoneNumber !== undefined) dbPatch.phone_number = patch.phoneNumber || null;
  if (patch.facebookUrl !== undefined) dbPatch.facebook_url = patch.facebookUrl || null;
  if (patch.photoFileId !== undefined) dbPatch.photo_file_id = patch.photoFileId || null;
  if (patch.photoMessageId !== undefined) dbPatch.photo_message_id = patch.photoMessageId || null;
  if (patch.caseFilter !== undefined) dbPatch.case_filter = patch.caseFilter;
  if (patch.geminiModel !== undefined) dbPatch.gemini_model = patch.geminiModel;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await db().from(T.users).update(dbPatch).eq('tg_id', tgId);
  if (error) throw error;
}

export interface BannedUserRow {
  tgId: string;
  displayName: string;
  banReason: string;
  bannedAt: string;
  bannedBy: string;
  source: 'tg' | 'web';
}

// Список заблокованих користувачів для адмінки. Slim-select (без важких колонок) —
// заблокованих зазвичай одиниці, egress нехтовний.
export async function getBannedUsers(): Promise<BannedUserRow[]> {
  const { data, error } = await db()
    .from(T.users)
    .select('tg_id, display_name, ban_reason, banned_at, banned_by, source')
    .eq('banned', true)
    .order('banned_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    tgId: r.tg_id,
    displayName: r.display_name || '',
    banReason: r.ban_reason || '',
    bannedAt: r.banned_at || '',
    bannedBy: r.banned_by || '',
    source: (r.source || 'tg') as 'tg' | 'web',
  }));
}

// Бан/розбан користувача (перевірка доброчесності). Окремо від patchUser, бо
// ban_reason/banned_at/banned_by не входять у BotUser.
export async function setUserBanned(
  tgId: string,
  banned: boolean,
  reason = '',
  by = ''
): Promise<void> {
  const { error } = await db()
    .from(T.users)
    .update({
      banned,
      ban_reason: banned ? reason || null : null,
      banned_at: banned ? new Date().toISOString() : null,
      banned_by: banned ? by || null : null,
    })
    .eq('tg_id', tgId);
  if (error) throw error;
}

// In-memory кеш «вже записано» — щоб не довбати БД на кожному вебхуку.
// Warm-серверу один UPDATE на юзера на запуск інстансу — і потім ні разу.
const _tgUsernameCache = new Map<string, string>();

// Лагідне оновлення tg_username. Передавай currentValue (з уже-завантаженого user) —
// тоді функція уникне DB-запису, якщо значення не змінилось. Якщо currentValue
// не передано — порівняємо з memory-cache (для викликів, де user ще не зчитаний).
export async function captureTgUsername(
  tgId: string,
  username: string | undefined | null,
  currentValue?: string
) {
  const clean = (username || '').trim().replace(/^@/, '');
  if (!clean) return;
  // Якщо знаємо поточне значення з БД — порівнюємо одразу.
  if (currentValue !== undefined && currentValue === clean) {
    _tgUsernameCache.set(tgId, clean);
    return;
  }
  // Інакше — швидкий memory-check.
  if (_tgUsernameCache.get(tgId) === clean) return;
  try {
    const { error } = await db()
      .from(T.users)
      .update({ tg_username: clean })
      .eq('tg_id', tgId)
      .neq('tg_username', clean); // у БД ще одна гарантія, що write не зайвий
    if (error) console.warn('captureTgUsername failed', error.message);
    else _tgUsernameCache.set(tgId, clean);
  } catch (e: any) {
    console.warn('captureTgUsername threw', e?.message || e);
  }
}

// ---------- CASES ----------
export async function getAllCases(): Promise<BotCase[]> {
  // Пагінація — Supabase за замовчуванням обмежує 1000 рядками.
  const pageSize = 1000;
  let from = 0;
  const out: BotCase[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.cases)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows.map(mapCase));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Полегшена версія getAllCases для integrity: лише ідентифікація опису.
// Повний рядок bot_cases тягне bbox/tg_file_id/JSONB — тут вони не потрібні.
export interface SlimCase {
  caseId: string;
  archive: string;
  fund: string;
  opys: string;
}
export async function getAllCasesSlim(): Promise<SlimCase[]> {
  const pageSize = 1000;
  let from = 0;
  const out: SlimCase[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.cases)
      .select('case_id, archive, fund, opys')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(
      ...rows.map((r: any) => ({
        caseId: r.case_id,
        archive: r.archive || '',
        fund: r.fund || '',
        opys: r.opys || '',
      }))
    );
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Тільки tg_file_id — для image-проксі, якому решта рядка не потрібна.
export async function getCaseFileId(caseId: string): Promise<string | null> {
  const { data, error } = await db()
    .from(T.cases)
    .select('tg_file_id')
    .eq('case_id', caseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data.tg_file_id || '';
}

export async function getCase(caseId: string): Promise<BotCase | null> {
  const { data, error } = await db().from(T.cases).select('*').eq('case_id', caseId).maybeSingle();
  if (error) throw error;
  return data ? mapCase(data) : null;
}

export async function appendCases(items: Omit<BotCase, 'rowIndex'>[]) {
  if (items.length === 0) return;
  const { error } = await db().from(T.cases).insert(
    items.map(c => ({
      case_id: c.caseId,
      tg_file_id: c.tgFileId,
      tg_chat_id: c.tgChatId,
      tg_message_id: c.tgMessageId,
      source_pdf: c.sourcePdf,
      page: c.page,
      bbox: c.bbox,
      archive: c.archive,
      fund: c.fund,
      opys: c.opys,
      sprava: c.sprava,
      submissions_count: c.submissionsCount,
      status: c.status,
      mode: c.mode || 'parallel',
      ...(c.createdAt ? { created_at: c.createdAt } : {}),
    }))
  );
  if (error) throw error;
}

export async function patchCase(caseId: string, patch: Partial<Omit<BotCase, 'rowIndex' | 'caseId'>>) {
  const dbPatch: any = {};
  if (patch.tgFileId !== undefined) dbPatch.tg_file_id = patch.tgFileId;
  if (patch.tgChatId !== undefined) dbPatch.tg_chat_id = patch.tgChatId;
  if (patch.tgMessageId !== undefined) dbPatch.tg_message_id = patch.tgMessageId;
  if (patch.sourcePdf !== undefined) dbPatch.source_pdf = patch.sourcePdf;
  if (patch.page !== undefined) dbPatch.page = patch.page;
  if (patch.bbox !== undefined) dbPatch.bbox = patch.bbox;
  if (patch.submissionsCount !== undefined) dbPatch.submissions_count = patch.submissionsCount;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await db().from(T.cases).update(dbPatch).eq('case_id', caseId);
  if (error) throw error;
}

// ---------- SESSIONS ----------
export async function getSession(tgId: string): Promise<BotSession | null> {
  const { data, error } = await db().from(T.sessions).select('*').eq('tg_id', tgId).maybeSingle();
  if (error) throw error;
  return data ? mapSession(data) : null;
}

export async function setSession(s: Omit<BotSession, 'rowIndex'>, _existingRowIndex?: number) {
  const { error } = await db()
    .from(T.sessions)
    .upsert(
      {
        tg_id: s.tgId,
        case_id: s.caseId,
        answers_json: s.answersJson,
        current_q: s.currentQ,
        started_at: s.startedAt || new Date().toISOString(),
        updated_at: s.updatedAt || new Date().toISOString(),
        state: s.state,
      },
      { onConflict: 'tg_id' }
    );
  if (error) throw error;
}

export async function deleteSession(tgId: string): Promise<boolean> {
  const { error, count } = await db()
    .from(T.sessions)
    .delete({ count: 'exact' })
    .eq('tg_id', tgId);
  if (error) throw error;
  return (count || 0) > 0;
}

export async function getAllSessions(): Promise<BotSession[]> {
  const { data, error } = await db().from(T.sessions).select('*');
  if (error) throw error;
  return (data || []).map(mapSession);
}

// ---------- DAILY SCORES ----------
export async function incDailyCount(tgId: string, dateKyiv: string): Promise<number> {
  const { data, error } = await db().rpc(RPC_INC_DAILY, { p_tg_id: tgId, p_date: dateKyiv });
  if (error) throw error;
  return Number(data || 0);
}

export async function getDailyCount(tgId: string, dateKyiv: string): Promise<number> {
  const { data, error } = await db()
    .from(T.daily)
    .select('count')
    .eq('tg_id', tgId)
    .eq('date_kyiv', dateKyiv)
    .maybeSingle();
  if (error) throw error;
  return data?.count || 0;
}

// Глобальний денний лічильник опрацьованих справ (усі дії бота за день).
// Зберігаємо як службовий рядок у bot_daily_scores із зарезервованим tg_id —
// без зміни схеми. У рейтингах/списках він не фігурує (ті читають bot_users).
const GLOBAL_DAILY_TG_ID = '__global__';
export async function incGlobalDailyDone(dateKyiv: string): Promise<number> {
  return incDailyCount(GLOBAL_DAILY_TG_ID, dateKyiv);
}
export async function getGlobalDailyDone(dateKyiv: string): Promise<number> {
  return getDailyCount(GLOBAL_DAILY_TG_ID, dateKyiv);
}

// ---------- MONTHLY POINTS (рейтинг по місяцях) ----------
// Атомарний інкремент місячних балів (повертає нове значення); оновлює display_name.
export async function incMonthlyPoints(
  month: string,
  tgId: string,
  delta: number,
  displayName: string
): Promise<number> {
  const { data, error } = await db().rpc(RPC_INC_MONTHLY, {
    p_month: month,
    p_tg_id: tgId,
    p_delta: delta,
    p_name: displayName || '',
  });
  if (error) throw error;
  return Number(data || 0);
}

// Атомарний інкремент накопичувальних (lifetime) балів. Для дробових веб-балів (0.1×слово).
export async function incTotalPoints(tgId: string, delta: number): Promise<number> {
  const { data, error } = await db().rpc(RPC_INC_TOTAL_POINTS, { p_tg_id: tgId, p_delta: delta });
  if (error) throw error;
  return Number(data || 0);
}

// Усі учасники місяця за спаданням балів (для Топ-10 + місця + сусідів).
export async function getMonthlyLeaderboard(
  month: string
): Promise<Array<{ tgId: string; points: number; displayName: string }>> {
  const pageSize = 1000;
  let from = 0;
  const out: Array<{ tgId: string; points: number; displayName: string }> = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.monthlyPoints)
      .select('tg_id, points, display_name')
      .eq('month', month)
      .order('points', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      out.push({
        tgId: (r as any).tg_id,
        points: Number((r as any).points || 0),
        displayName: (r as any).display_name || '',
      });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Місяці, для яких є дані (новіші — першими).
export async function getMonthlyMonths(): Promise<string[]> {
  const { data, error } = await db().rpc(RPC_MONTHLY_MONTHS);
  if (error) throw error;
  return ((data as any[]) || []).map(r => r.month);
}

// ---------- SUBMISSIONS (Results) ----------
export interface SubmissionInput {
  caseId: string;
  tgId: string;
  displayName: string;
  answers: string[];
  sourceLink: string;
  archive: string;
  fund: string;
  opys: string;
  sprava: string;
  sourcePdf: string;
  page: string;
  // Атрибуція до партнера (для web-юзерів). NULL для TG. Денормалізовано
  // щоб атрибуція не губилась після /link і не залежала від bot_users.
  partnerId?: string | null;
}

export async function appendSubmission(s: SubmissionInput) {
  const { error } = await db().from(T.submissions).insert({
    case_id: s.caseId,
    tg_id: s.tgId,
    display_name: s.displayName,
    answers: s.answers,
    source_link: s.sourceLink,
    archive: s.archive,
    fund: s.fund,
    opys: s.opys,
    sprava: s.sprava,
    source_pdf: s.sourcePdf,
    page: s.page,
    partner_id: s.partnerId || null,
  });
  if (error) throw error;
}

export async function countSubmissionsByCase(caseId: string): Promise<number> {
  const { count, error } = await db()
    .from(T.submissions)
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId);
  if (error) throw error;
  return count || 0;
}

export async function getSubmissionsForUser(tgId: string): Promise<string[]> {
  const { data, error } = await db().from(T.submissions).select('case_id').eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => r.case_id);
}

// ---------- SKIPPED CASES ----------
export async function recordSkippedCase(tgId: string, caseId: string): Promise<void> {
  if (!caseId) return;
  const { error } = await db()
    .from(T.skipped)
    .upsert({ tg_id: tgId, case_id: caseId }, { onConflict: 'tg_id,case_id' });
  if (error) throw error;
}

export async function getSkippedForUser(tgId: string): Promise<string[]> {
  const { data, error } = await db().from(T.skipped).select('case_id').eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => r.case_id);
}

// Кеш для дорогих Intl.DateTimeFormat інстансів (ICU-лукапи коштують CPU при кожному new).
// Інстанси thread-safe для read-only використання — формаюти можна тримати «вічно».
const _dateFmtCache = new Map<string, Intl.DateTimeFormat>();
function tzDateFmt(timeZone: string): Intl.DateTimeFormat {
  let f = _dateFmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    _dateFmtCache.set(timeZone, f);
  }
  return f;
}
const _tzNameFmtCache = new Map<string, Intl.DateTimeFormat>();
function tzNameFmt(timeZone: string): Intl.DateTimeFormat {
  let f = _tzNameFmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    _tzNameFmtCache.set(timeZone, f);
  }
  return f;
}
// Зсув у хв для (timeZone, dateMs). Кеш short-TTL: інакше DST/перехід можна пропустити.
const _offsetCache = new Map<string, { mins: number; expires: number }>();
function tzOffsetMin(timeZone: string, now: Date): number {
  const key = `${timeZone}|${Math.floor(now.getTime() / 3600_000)}`; // bucket по годинах
  const hit = _offsetCache.get(key);
  if (hit && hit.expires > now.getTime()) return hit.mins;
  const tzName = tzNameFmt(timeZone).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const sign = m?.[1] === '-' ? -1 : 1;
  const hh = parseInt(m?.[2] || '0', 10);
  const mm = parseInt(m?.[3] || '0', 10);
  const mins = sign * (hh * 60 + mm);
  _offsetCache.set(key, { mins, expires: now.getTime() + 3600_000 });
  return mins;
}

// Активність "сьогодні" у Europe/Kyiv: скільки унікальних справ опрацьовано
// (через submissions АБО collab-події) і скільки унікальних користувачів брало
// участь. Вибірка йде з БД незалежно від ліміту таблиці результатів.
export async function getTodayActivity(timeZone: string): Promise<{ cases: number; users: number }> {
  const now = new Date();
  const dateStr = tzDateFmt(timeZone).format(now);
  const offsetMin = tzOffsetMin(timeZone, now);
  const startUtcMs = Date.parse(`${dateStr}T00:00:00.000Z`) - offsetMin * 60_000;
  const startUtc = new Date(startUtcMs).toISOString();
  const endUtc = new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString();

  // Підрахунок робить Postgres: count(distinct case_id/actor) по
  // parallel-сабмітах + collab-подіях за вікно дня. Раніше тут був пагінований
  // скан тисяч рядків у JS — він не лише жер egress, а й давав нестабільну
  // (іноді меншу) цифру, бо .range() без ORDER BY пропускав рядки під час
  // конкурентних вставок.
  const { data, error } = await db().rpc(RPC_TODAY_ACTIVITY, {
    p_start: startUtc,
    p_end: endUtc,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { cases: Number((row as any)?.cases ?? 0), users: Number((row as any)?.users ?? 0) };
}

// Активність за останні N днів у переданій таймзоні.
// Кожен день — кількість унікальних опрацьованих справ та унікальних користувачів,
// що брали участь (parallel-сабміти + collab-події).
export async function getDailyActivity(
  timeZone: string,
  days: number,
  source: 'all' | 'telegram' | 'web' = 'all'
): Promise<Array<{ date: string; cases: number; users: number }>> {
  if (days <= 0) return [];
  const safeDays = Math.min(days, 365);
  const now = new Date();
  const fmtDay = tzDateFmt(timeZone);
  const offsetMin = tzOffsetMin(timeZone, now);

  const todayStr = fmtDay.format(now);
  const todayMidnightUtcMs = Date.parse(`${todayStr}T00:00:00.000Z`) - offsetMin * 60_000;
  const startUtcMs = todayMidnightUtcMs - (safeDays - 1) * 86_400_000;
  const endUtcMs = todayMidnightUtcMs + 86_400_000;
  const startUtc = new Date(startUtcMs).toISOString();
  const endUtc = new Date(endUtcMs).toISOString();

  // Заздалегідь створюємо запис на КОЖЕН день діапазону з нулями — щоб у
  // відповіді були всі дати, навіть без активності (RPC повертає лише непорожні).
  const out = new Map<string, { cases: number; users: number }>();
  for (let i = 0; i < safeDays; i++) {
    const d = new Date(startUtcMs + i * 86_400_000 + 12 * 3600_000); // полудень дня — щоб TZ-форматування не плутало
    out.set(fmtDay.format(d), { cases: 0, users: 0 });
  }

  // Групування по днях і count(distinct) робить Postgres. p_source керує тим,
  // які джерела рахувати: 'telegram' (parallel+collab), 'web' (verif), 'all' —
  // обидва. Денний ключ рахується в БД через (ts at time zone p_tz)::date, що
  // збігається з en-CA форматом tzDateFmt ('YYYY-MM-DD').
  const { data, error } = await db().rpc(RPC_DAILY_ACTIVITY, {
    p_start: startUtc,
    p_end: endUtc,
    p_tz: timeZone,
    p_source: source,
  });
  if (error) throw error;
  for (const r of (data as any[]) || []) {
    const day = String((r as any).day);
    const slot = out.get(day);
    if (slot) {
      slot.cases = Number((r as any).cases || 0);
      slot.users = Number((r as any).users || 0);
    }
  }

  return [...out.entries()]
    .map(([date, b]) => ({ date, cases: b.cases, users: b.users }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getResultsTotals(): Promise<{ totalSubmissions: number }> {
  const { count, error } = await db()
    .from(T.submissions)
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return { totalSubmissions: count || 0 };
}

// Усі підтвердження для конкретного опису (без ліміту, посторінково).
// Supabase/PostgREST за замовчанням має обмеження ~1000 рядків на запит — обходимо range-pагінацією.
// Egress-фікс: явний список колонок (без id, source_link, sprava — не використовуються
// у ProcessDescriptionView / submissions-by-description response).
const SUBMISSION_COLS_FOR_DESC =
  'case_id, tg_id, display_name, submitted_at, answers, archive, fund, opys, source_pdf, page';

export async function getSubmissionsByDescription(
  archive: string,
  fund: string,
  opys: string
) {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.submissions)
      .select(SUBMISSION_COLS_FOR_DESC)
      .eq('archive', archive)
      .eq('fund', fund)
      .eq('opys', opys)
      .order('submitted_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Усі submissions для аналізу доброчесності (повна пагінація).
// Сортуємо за case_id + submitted_at, щоб у коді легко групувати.
export async function getAllSubmissionsOrdered(): Promise<any[]> {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.submissions)
      .select('case_id, tg_id, display_name, answers, submitted_at, archive, fund, opys')
      .order('case_id', { ascending: true })
      .order('submitted_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Експортуємо submissions для адмінського перегляду / експорту.
export async function getRecentSubmissions(limit = 100) {
  const { data, error } = await db()
    .from(T.submissions)
    .select('*')
    .order('submitted_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ---------- COLLABORATIVE MODE ----------
// Видача справи юзеру: лочимо на lockMinutes хвилин.
export async function lockCase(caseId: string, tgId: string, lockMinutes: number): Promise<void> {
  const until = new Date(Date.now() + lockMinutes * 60_000).toISOString();
  const { error } = await db()
    .from(T.cases)
    .update({ locked_by_tg_id: tgId, locked_until: until })
    .eq('case_id', caseId);
  if (error) throw error;
}

// Зняти блокування (юзер завершив дію або відмовився).
export async function unlockCase(caseId: string): Promise<void> {
  const { error } = await db()
    .from(T.cases)
    .update({ locked_by_tg_id: '', locked_until: null })
    .eq('case_id', caseId);
  if (error) throw error;
}

// Записати участь юзера у справі. UNIQUE (case_id, tg_id) — якщо є, просто апдейт kind/at.
// answers — снапшот відповідей у момент події (потрібен для перевірки доброчесності).
export async function recordCaseEvent(
  caseId: string,
  tgId: string,
  kind: 'create' | 'edit' | 'confirm',
  answers: string[] = [],
  partnerId?: string | null
): Promise<void> {
  const { error } = await db()
    .from(T.caseConfirmations)
    .upsert(
      {
        case_id: caseId,
        tg_id: tgId,
        kind,
        at: new Date().toISOString(),
        answers,
        partner_id: partnerId || null,
      },
      { onConflict: 'case_id,tg_id' }
    );
  if (error) throw error;
}

// Список case_id, до яких юзер уже доторкався (для виключення з dispatch).
export async function getTouchedCaseIds(tgId: string): Promise<string[]> {
  const { data, error } = await db()
    .from(T.caseConfirmations)
    .select('case_id')
    .eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => r.case_id);
}

// Остання дія юзера у collab (для чергування create/review при наступному dispatch).
export async function getLastUserCaseKind(
  tgId: string
): Promise<'create' | 'edit' | 'confirm' | null> {
  const { data, error } = await db()
    .from(T.caseConfirmations)
    .select('kind, at')
    .eq('tg_id', tgId)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return ((data as any)?.kind as any) || null;
}

// Чи юзер уже брав участь у цій справі.
export async function hasUserTouchedCase(caseId: string, tgId: string): Promise<boolean> {
  const { data, error } = await db()
    .from(T.caseConfirmations)
    .select('case_id')
    .eq('case_id', caseId)
    .eq('tg_id', tgId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Зберегти ПЕРШУ версію (creation): встановити current_answers, current_author, count = 1.
export async function setCaseCreated(
  caseId: string,
  authorTgId: string,
  answers: string[]
): Promise<void> {
  const { error } = await db()
    .from(T.cases)
    .update({
      current_answers: answers,
      current_author_tg_id: authorTgId,
      confirmations_count: 1,
      locked_by_tg_id: '',
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('case_id', caseId);
  if (error) throw error;
}

// Edit: замінити відповіді, скинути лічильник до 1 (редактор неявно підтверджує).
// bot_case_confirmations НЕ чистимо (попередні юзери не отримають справу повторно).
export async function setCaseEdited(
  caseId: string,
  editorTgId: string,
  answers: string[]
): Promise<void> {
  const { error } = await db()
    .from(T.cases)
    .update({
      current_answers: answers,
      current_author_tg_id: editorTgId,
      confirmations_count: 1,
      locked_by_tg_id: '',
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('case_id', caseId);
  if (error) throw error;
}

// Підтвердження: атомарно інкрементує лічильник, повертає нове значення.
// Закриває справу, якщо досягнуто minConfirmations.
export async function confirmCase(
  caseId: string,
  minConfirmations: number
): Promise<{ count: number; closed: boolean }> {
  // Читаємо поточне значення, рахуємо, апдейтимо. Коротка race-window прийнятна
  // для швидкості бота — справу все одно тримає лок.
  const cur = await getCase(caseId);
  if (!cur) throw new Error(`Case not found: ${caseId}`);
  const next = cur.confirmationsCount + 1;
  const closed = next >= minConfirmations;
  const { error } = await db()
    .from(T.cases)
    .update({
      confirmations_count: next,
      locked_by_tg_id: '',
      locked_until: null,
      updated_at: new Date().toISOString(),
      ...(closed ? { status: 'done' } : {}),
    })
    .eq('case_id', caseId);
  if (error) throw error;
  return { count: next, closed };
}

// Усі collab-справи в межах опису (для експорту як "віртуальні submissions").
// Egress-фікс: явний список колонок. Зокрема НЕ тягнемо bbox (часто довгий),
// tg_file_id/tg_chat_id/tg_message_id, locked_*, submissions_count — нічого з цього
// не потрібно для collabCaseToSubmission().
const COLLAB_CASE_COLS_FOR_DESC =
  'case_id, archive, fund, opys, sprava, source_pdf, page, mode, status, ' +
  'current_answers, current_author_tg_id, confirmations_count, created_at, updated_at';

export async function getCollabCasesByDescription(
  archive: string,
  fund: string,
  opys: string
): Promise<BotCase[]> {
  const pageSize = 1000;
  let from = 0;
  const out: BotCase[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.cases)
      .select(COLLAB_CASE_COLS_FOR_DESC)
      .eq('archive', archive)
      .eq('fund', fund)
      .eq('opys', opys)
      .eq('mode', 'collaborative')
      .order('updated_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows.map(mapCase));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Останні collab-справи по даті створення (для глобального overview).
export async function getRecentCollabCases(limit = 100): Promise<BotCase[]> {
  const { data, error } = await db()
    .from(T.cases)
    .select('*')
    .eq('mode', 'collaborative')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapCase);
}

// Map tg_id → display_name. Для денормалізації collab-справ при експорті.
export async function getDisplayNamesMap(tgIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(tgIds.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await db().from(T.users).select('tg_id, display_name').in('tg_id', unique);
  if (error) throw error;
  const m: Record<string, string> = {};
  for (const r of data || []) m[(r as any).tg_id] = (r as any).display_name || '';
  return m;
}

// Серверна агрегація прогресу по описах. Один SQL замість тягнути всі справи в код.
export async function getDescriptionProgressViaRpc(target: number): Promise<
  Array<{
    archive: string;
    fund: string;
    opys: string;
    earliestCreatedAt: string;
    totalCases: number;
    doneCases: number;
    cappedSum: number;
  }>
> {
  const { data, error } = await db().rpc(RPC_DESCRIPTION_PROGRESS, { p_target: target });
  if (error) throw error;
  return ((data as any[]) || []).map(r => ({
    archive: r.archive || '',
    fund: r.fund || '',
    opys: r.opys || '',
    earliestCreatedAt: r.earliest_created_at || '',
    totalCases: Number(r.total_cases || 0),
    doneCases: Number(r.done_cases || 0),
    cappedSum: Number(r.capped_sum || 0),
  }));
}

// Агрегати для прогнозу завершення фонду. Повертає тільки 2 числа —
// решту (ETA-дату, totalDescriptions/baseline) рахуємо вже в API з конфіга.
// Заміна `getAllCases() + computeFundEta(cases)` — основне джерело egress.
export async function getFundEtaStats(
  target: number,
  windowDays: number
): Promise<{ fullyDoneByBot: number; completionsInWindow: number }> {
  const { data, error } = await db().rpc(RPC_FUND_ETA_STATS, {
    p_target: target,
    p_window_days: windowDays,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    fullyDoneByBot: Number(row?.fully_done_by_bot || 0),
    completionsInWindow: Number(row?.completions_in_window || 0),
  };
}

// Кандидати для dispatch для конкретного юзера (виключає вже опрацьовані).
// Виконує всі фільтри в SQL — масштабується незалежно від розміру bot_cases.
export async function getCandidateCasesForUser(tgId: string): Promise<BotCase[]> {
  const { data, error } = await db().rpc(RPC_CANDIDATE_CASES, { p_tg_id: tgId });
  if (error) throw error;
  return ((data as any[]) || []).map(mapCase);
}

// Слім-кандидати для вибору наступної справи (egress-фікс): RPC v2 повертає лише
// справи одного-двох релевантних описів і лише колонки, потрібні логіці вибору в
// selectNextCaseForUser. Повний рядок обраної справи добирається точковим getCase().
// v1 (getCandidateCasesForUser) лишається як фолбек на час розкатки SQL.
export interface CandidateCase {
  caseId: string;
  archive: string;
  fund: string;
  opys: string;
  mode: 'parallel' | 'collaborative';
  confirmationsCount: number;
  submissionsCount: number;
  createdAt: string;
  currentAnswers: string[];
}
export async function getCandidateCasesSlimForUser(
  tgId: string,
  target: number
): Promise<CandidateCase[]> {
  const { data, error } = await db().rpc(RPC_CANDIDATE_CASES_V2, {
    p_tg_id: tgId,
    p_target: target,
  });
  if (error) throw error;
  return ((data as any[]) || []).map(r => ({
    caseId: r.case_id,
    archive: r.archive || '',
    fund: r.fund || '',
    opys: r.opys || '',
    mode: (r.mode || 'parallel') as 'parallel' | 'collaborative',
    confirmationsCount: r.confirmations_count || 0,
    submissionsCount: r.submissions_count || 0,
    createdAt: r.created_at || '',
    currentAnswers: Array.isArray(r.current_answers) ? r.current_answers.map(String) : [],
  }));
}

// Усі рядки confirmations для заданого набору case_id (для адмін-перегляду).
export async function getConfirmationsForCases(
  caseIds: string[]
): Promise<Array<{ caseId: string; tgId: string; kind: 'create' | 'edit' | 'confirm'; at: string; answers: string[] }>> {
  if (caseIds.length === 0) return [];
  // Пагінуємо на випадок великого опису.
  const out: Array<{ caseId: string; tgId: string; kind: any; at: string; answers: string[] }> = [];
  const chunkSize = 500;
  for (let i = 0; i < caseIds.length; i += chunkSize) {
    const chunk = caseIds.slice(i, i + chunkSize);
    const { data, error } = await db()
      .from(T.caseConfirmations)
      .select('case_id, tg_id, kind, at, answers')
      .in('case_id', chunk);
    if (error) throw error;
    for (const r of data || []) {
      const ans = (r as any).answers;
      out.push({
        caseId: (r as any).case_id,
        tgId: (r as any).tg_id,
        kind: (r as any).kind,
        at: (r as any).at,
        answers: Array.isArray(ans) ? ans.map(String) : [],
      });
    }
  }
  return out;
}

// Усі collab-події з відповідями (для інтегриті-перевірки).
export async function getAllConfirmationsWithAnswers(): Promise<
  Array<{ caseId: string; tgId: string; kind: 'create' | 'edit' | 'confirm'; at: string; answers: string[] }>
> {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.caseConfirmations)
      .select('case_id, tg_id, kind, at, answers')
      .order('case_id', { ascending: true })
      .order('at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      const ans = (r as any).answers;
      out.push({
        caseId: (r as any).case_id,
        tgId: (r as any).tg_id,
        kind: (r as any).kind,
        at: (r as any).at,
        answers: Array.isArray(ans) ? ans.map(String) : [],
      });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Watermark стану даних, від яких залежить integrity-звіт: кількість + найновіший
// timestamp по submissions, confirmations і reviews. Якщо watermark не змінився —
// можна віддати збережений звіт без перевитягування ~30 МБ сирих даних.
export async function getIntegrityWatermark(): Promise<string> {
  const count = async (table: string) => {
    const { count: n, error } = await db()
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) throw error;
    return n || 0;
  };
  const maxTs = async (table: string, col: string) => {
    const { data, error } = await db()
      .from(table)
      .select(col)
      .order(col, { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as any)?.[col] || '';
  };
  const [subsN, subsTs, confN, confTs, revN, revTs] = await Promise.all([
    count(T.submissions),
    maxTs(T.submissions, 'submitted_at'),
    count(T.caseConfirmations),
    maxTs(T.caseConfirmations, 'at'),
    count(T.integrityReviews),
    maxTs(T.integrityReviews, 'at'),
  ]);
  return `${subsN}:${subsTs}|${confN}:${confTs}|${revN}:${revTs}`;
}

// ---------- INTEGRITY REVIEWS ----------
// Завжди зберігаємо tg_id у відсортованому порядку, щоб (A,B) ↔ (B,A) дали один ключ.
export function integrityPairKey(a: string, b: string): { first: string; second: string } {
  return a < b ? { first: a, second: b } : { first: b, second: a };
}

export async function addIntegrityReview(
  caseId: string,
  tgIdA: string,
  tgIdB: string,
  action: 'penalized' | 'dismissed',
  penalizedTgId?: string
): Promise<void> {
  const { first, second } = integrityPairKey(tgIdA || '', tgIdB || '');
  const { error } = await db()
    .from(T.integrityReviews)
    .upsert(
      {
        case_id: caseId,
        first_tg_id: first,
        second_tg_id: second,
        action,
        penalized_tg_id: penalizedTgId || null,
        at: new Date().toISOString(),
      },
      { onConflict: 'case_id,first_tg_id,second_tg_id' }
    );
  if (error) throw error;
}

export async function getAllIntegrityReviews(): Promise<
  Array<{ caseId: string; firstTgId: string; secondTgId: string; action: string; penalizedTgId: string; at: string }>
> {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.integrityReviews)
      .select('case_id, first_tg_id, second_tg_id, action, penalized_tg_id, at')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      out.push({
        caseId: (r as any).case_id,
        firstTgId: (r as any).first_tg_id || '',
        secondTgId: (r as any).second_tg_id || '',
        action: (r as any).action,
        penalizedTgId: (r as any).penalized_tg_id || '',
        at: (r as any).at,
      });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ---------- BADGES (досягнення) ----------
// Перелік id бейджів, які користувач уже отримав.
export async function getEarnedBadgeIds(tgId: string): Promise<string[]> {
  const { data, error } = await db().from(T.userBadges).select('badge_id').eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => r.badge_id);
}

// Видати бейджі (ідемпотентно: PK (tg_id, badge_id) + ignoreDuplicates).
export async function grantBadges(tgId: string, badgeIds: string[]): Promise<void> {
  if (badgeIds.length === 0) return;
  const rows = badgeIds.map(badge_id => ({ tg_id: tgId, badge_id }));
  const { error } = await db()
    .from(T.userBadges)
    .upsert(rows, { onConflict: 'tg_id,badge_id', ignoreDuplicates: true });
  if (error) throw error;
}

// Скільки справ користувач опрацював за весь час: parallel-сабміти + collab-події.
// Різні режими не перетинаються по одній справі, тож сума без дедуплікації прийнятна.
export async function countUserCases(tgId: string): Promise<number> {
  const [subs, confs] = await Promise.all([
    db().from(T.submissions).select('id', { count: 'exact', head: true }).eq('tg_id', tgId),
    db().from(T.caseConfirmations).select('case_id', { count: 'exact', head: true }).eq('tg_id', tgId),
  ]);
  if (subs.error) throw subs.error;
  if (confs.error) throw confs.error;
  return (subs.count || 0) + (confs.count || 0);
}

// Веб-перевірка: к-сть перевірених справ цим юзером (для бейджів verifications_total).
export async function countUserVerifications(tgId: string): Promise<number> {
  const { count, error } = await db()
    .from(`${PREFIX}verif_confirmations`)
    .select('case_id', { count: 'exact', head: true })
    .eq('verifier_id', tgId);
  if (error) throw error;
  return count || 0;
}

// Веб-перевірка: сума виправлених слів цим юзером (для бейджів corrected_words_total).
// Без SUM-RPC: тягнемо колонку посторінково й сумуємо в коді.
export async function sumUserCorrectedWords(tgId: string): Promise<number> {
  const pageSize = 1000;
  let total = 0;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from(`${PREFIX}verif_confirmations`)
      .select('corrected_words')
      .eq('verifier_id', tgId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) total += Number((r as any).corrected_words || 0);
    if (rows.length < pageSize) break;
  }
  return total;
}

// ---------- ОПИСОВИЙ ПАЗЛ ----------
export interface PuzzleRow {
  dateKyiv: string;
  sentence: string;
  givenWords: string[]; // слова, видані як підтверджені для цієї фрази
}

function mapPuzzle(r: any): PuzzleRow {
  const gw = r.given_words;
  return {
    dateKyiv: r.date_kyiv,
    sentence: r.sentence || '',
    givenWords: Array.isArray(gw) ? gw.map(String) : [],
  };
}

export async function getPuzzle(dateKyiv: string): Promise<PuzzleRow | null> {
  const { data, error } = await db()
    .from(T.puzzles)
    .select('date_kyiv, sentence, given_words')
    .eq('date_kyiv', dateKyiv)
    .maybeSingle();
  if (error) throw error;
  return data ? mapPuzzle(data) : null;
}

// Усі пазли за зростанням дати (для списку та масового заповнення).
export async function getAllPuzzles(): Promise<PuzzleRow[]> {
  const pageSize = 1000;
  let from = 0;
  const out: PuzzleRow[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.puzzles)
      .select('date_kyiv, sentence, given_words')
      .order('date_kyiv', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) out.push(mapPuzzle(r));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export async function upsertPuzzle(
  dateKyiv: string,
  sentence: string,
  givenWords: string[] = []
): Promise<void> {
  const { error } = await db()
    .from(T.puzzles)
    .upsert(
      { date_kyiv: dateKyiv, sentence, given_words: givenWords, updated_at: new Date().toISOString() },
      { onConflict: 'date_kyiv' }
    );
  if (error) throw error;
}

// Записати зібрані (непідтверджені) слова. ignoreDuplicates — не чіпаємо вже наявні
// (зокрема не «понижуємо» підтверджені назад до unconfirmed).
// Повертає слова, які були РЕАЛЬНО додані (нові) — для сповіщення «слово знайдено».
export async function addPuzzleWords(
  dateKyiv: string,
  tgId: string,
  words: string[],
  caseId: string
): Promise<string[]> {
  if (words.length === 0) return [];
  const now = new Date().toISOString();
  const rows = words.map(word => ({
    date_kyiv: dateKyiv,
    tg_id: tgId,
    word,
    status: 'unconfirmed',
    case_id: caseId,
    collected_at: now,
  }));
  const { data, error } = await db()
    .from(T.puzzleProgress)
    .upsert(rows, { onConflict: 'date_kyiv,tg_id,word', ignoreDuplicates: true })
    .select('word');
  if (error) throw error;
  return (data || []).map((r: any) => r.word);
}

// Підтвердити слова, зібрані з конкретної справи в конкретний день.
// Повертає унікальні tg_id, чиї слова стали підтвердженими (для перевірки перемоги).
export async function confirmPuzzleWordsByCase(
  caseId: string,
  dateKyiv: string
): Promise<string[]> {
  const { data, error } = await db()
    .from(T.puzzleProgress)
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('case_id', caseId)
    .eq('date_kyiv', dateKyiv)
    .eq('status', 'unconfirmed')
    .select('tg_id');
  if (error) throw error;
  return [...new Set((data || []).map((r: any) => r.tg_id))];
}

// Прогрес одного користувача за день: word → status.
export async function getPuzzleProgressForUser(
  dateKyiv: string,
  tgId: string
): Promise<Array<{ word: string; status: 'unconfirmed' | 'confirmed' }>> {
  const { data, error } = await db()
    .from(T.puzzleProgress)
    .select('word, status')
    .eq('date_kyiv', dateKyiv)
    .eq('tg_id', tgId);
  if (error) throw error;
  return (data || []).map((r: any) => ({ word: r.word, status: r.status }));
}

// Усі рядки прогресу за день (для адмін-зведення). День має небагато рядків.
export async function getPuzzleProgressForDate(
  dateKyiv: string
): Promise<Array<{ tgId: string; word: string; status: 'unconfirmed' | 'confirmed' }>> {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db()
      .from(T.puzzleProgress)
      .select('tg_id, word, status')
      .eq('date_kyiv', dateKyiv)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) out.push({ tgId: (r as any).tg_id, word: (r as any).word, status: (r as any).status });
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Атомарне присвоєння місця переможцю (через RPC з advisory-lock).
// null — якщо юзер уже переможець або всі 3 місця зайняті.
export async function awardPuzzleWinner(
  dateKyiv: string,
  tgId: string
): Promise<{ place: number; points: number } | null> {
  const { data, error } = await db().rpc(RPC_AWARD_PUZZLE_WINNER, {
    p_date: dateKyiv,
    p_tg_id: tgId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { place: Number(row.place), points: Number(row.points) } : null;
}

export async function getPuzzleWinners(
  dateKyiv: string
): Promise<Array<{ place: number; tgId: string; points: number }>> {
  const { data, error } = await db()
    .from(T.puzzleWinners)
    .select('place, tg_id, points')
    .eq('date_kyiv', dateKyiv)
    .order('place', { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => ({ place: r.place, tgId: r.tg_id, points: r.points }));
}

// current_answers уже розпізнаних колаб-справ (confirmations_count > 0) —
// для адмін-індикатора наявності слів у заголовках.
export async function getRecognizedCollabAnswers(limit = 2000): Promise<string[][]> {
  const { data, error } = await db()
    .from(T.cases)
    .select('current_answers')
    .eq('mode', 'collaborative')
    .gt('confirmations_count', 0)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((r: any) => (Array.isArray(r.current_answers) ? r.current_answers.map(String) : []));
}

// Атомарний "захоп" права на одноразове оголошення. Робимо INSERT у bot_meta
// з унікальним ключем; якщо рядок уже існує — повертаємо false (нічого не шлемо).
// PK на key → конфлікт = "вже оголошено" (не помилка для нас).
export async function tryClaimAnnouncement(key: string): Promise<boolean> {
  const { error } = await db()
    .from(T.meta)
    .insert({ key, value: new Date().toISOString() });
  if (!error) {
    invalidateMetaCache(key);
    return true;
  }
  // 23505 — unique_violation. Інші помилки прокидаємо.
  if ((error as any).code === '23505') return false;
  throw error;
}

// Звільняє клейм оголошення (видаляє рядок), щоб наступна спроба могла повторно
// «заклеймити» й надіслати. Викликаємо, коли надсилання впало — інакше клейм
// назавжди заблокував би повтор.
export async function releaseAnnouncement(key: string): Promise<void> {
  const { error } = await db().from(T.meta).delete().eq('key', key);
  invalidateMetaCache(key);
  if (error) throw error;
}

// Кількість унікальних справ, які користувач "торкнувся" у дату (Київ).
// Об'єднує TG-сабміти (parallel) + collab-події (create/edit/confirm) + веб-перевірки.
// Дія = пара (tg_id, case_id) — кілька подій по одній справі від одного юзера = 1.
export async function getYesterdayCaseLeaders(
  timeZone: string,
  limit: number = 3
): Promise<Array<{ tgId: string; displayName: string; casesCount: number }>> {
  const now = new Date();
  const todayStr = tzDateFmt(timeZone).format(now);
  const offsetMin = tzOffsetMin(timeZone, now);
  const todayMidnightUtcMs = Date.parse(`${todayStr}T00:00:00.000Z`) - offsetMin * 60_000;
  const startUtc = new Date(todayMidnightUtcMs - 86_400_000).toISOString();
  const endUtc = new Date(todayMidnightUtcMs).toISOString();

  // tg_id → set of case_id
  const pairs = new Map<string, Set<string>>();
  const add = (tgId: string, caseId: string) => {
    if (!tgId || !caseId) return;
    let s = pairs.get(tgId);
    if (!s) pairs.set(tgId, (s = new Set()));
    s.add(caseId);
  };

  const pageSize = 1000;
  // 1) parallel TG
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from(T.submissions)
      .select('tg_id, case_id')
      .gte('submitted_at', startUtc)
      .lt('submitted_at', endUtc)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) add(String((r as any).tg_id || ''), String((r as any).case_id || ''));
    if (rows.length < pageSize) break;
  }
  // 2) collab TG
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db()
      .from(T.caseConfirmations)
      .select('tg_id, case_id')
      .gte('at', startUtc)
      .lt('at', endUtc)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) add(String((r as any).tg_id || ''), String((r as any).case_id || ''));
    if (rows.length < pageSize) break;
  }
  // 3) web-перевірки (verifier_id). Тиха деградація, якщо схема ще не накатана.
  try {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db()
        .from(`${PREFIX}verif_confirmations`)
        .select('verifier_id, case_id')
        .gte('at', startUtc)
        .lt('at', endUtc)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = data || [];
      for (const r of rows) add(String((r as any).verifier_id || ''), String((r as any).case_id || ''));
      if (rows.length < pageSize) break;
    }
  } catch (e: any) {
    console.warn('getYesterdayCaseLeaders: verif_confirmations skipped:', e?.message || e);
  }

  const ranked = [...pairs.entries()]
    .map(([tgId, set]) => ({ tgId, casesCount: set.size }))
    .sort((a, b) => b.casesCount - a.casesCount)
    .slice(0, limit);
  const names = await getDisplayNamesMap(ranked.map(r => r.tgId));
  return ranked.map(r => ({
    tgId: r.tgId,
    casesCount: r.casesCount,
    displayName: names[r.tgId] || '',
  }));
}

// Чи всі справи опису (archive|fund|opys) у статусі 'done' (і хоч одна існує).
export async function isDescriptionFullyDone(
  archive: string,
  fund: string,
  opys: string
): Promise<{ done: boolean; totalCases: number; doneCases: number }> {
  const { count: total, error: e1 } = await db()
    .from(T.cases)
    .select('case_id', { count: 'exact', head: true })
    .eq('archive', archive)
    .eq('fund', fund)
    .eq('opys', opys);
  if (e1) throw e1;
  const totalCases = total || 0;
  if (totalCases === 0) return { done: false, totalCases: 0, doneCases: 0 };
  const { count: doneN, error: e2 } = await db()
    .from(T.cases)
    .select('case_id', { count: 'exact', head: true })
    .eq('archive', archive)
    .eq('fund', fund)
    .eq('opys', opys)
    .eq('status', 'done');
  if (e2) throw e2;
  const doneCases = doneN || 0;
  return { done: doneCases >= totalCases, totalCases, doneCases };
}

// Прострочені блокування — на випадок ручної очистки (бот і так враховує locked_until).
export async function clearExpiredLocks(): Promise<number> {
  const { data, error } = await db()
    .from(T.cases)
    .update({ locked_by_tg_id: '', locked_until: null })
    .lt('locked_until', new Date().toISOString())
    .select('case_id');
  if (error) throw error;
  return (data || []).length;
}

// ---------- АДМІН-РОЗСИЛКИ (broadcast) ----------
export interface BroadcastRow {
  id: number;
  title: string;
  body: string;
  buttons: string[];
  critFrom: string | null;
  critTo: string | null;
  critMax: number | null;
  status: 'queued' | 'sending' | 'done' | 'canceled';
  totalCount: number;
  sentCount: number;
  failedCount: number;
  clickedCount: number;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

function mapBroadcast(r: any): BroadcastRow {
  return {
    id: Number(r.id),
    title: r.title || '',
    body: r.body || '',
    buttons: Array.isArray(r.buttons) ? r.buttons : [],
    critFrom: r.crit_from || null,
    critTo: r.crit_to || null,
    critMax: r.crit_max == null ? null : Number(r.crit_max),
    status: r.status,
    totalCount: r.total_count || 0,
    sentCount: r.sent_count || 0,
    failedCount: r.failed_count || 0,
    clickedCount: r.clicked_count || 0,
    createdBy: r.created_by || '',
    createdAt: r.created_at || '',
    startedAt: r.started_at || null,
    finishedAt: r.finished_at || null,
  };
}

// Прев'ю: лише КІЛЬКІСТЬ отримувачів вибірки (RPC, egress = одне число).
export async function broadcastPreviewCount(
  fromIso: string,
  toIso: string,
  maxCases: number
): Promise<number> {
  const { data, error } = await db().rpc(RPC_BROADCAST_PREVIEW, {
    p_from: fromIso,
    p_to: toIso,
    p_max: maxCases,
  });
  if (error) throw error;
  return Number(Array.isArray(data) ? data[0] : data) || 0;
}

// Повний список отримувачів вибірки (tg_id + display_name) — читаємо РАЗ при створенні.
export async function broadcastSelectRecipients(
  fromIso: string,
  toIso: string,
  maxCases: number
): Promise<Array<{ tgId: string; displayName: string }>> {
  const { data, error } = await db().rpc(RPC_BROADCAST_RECIPIENTS_SELECT, {
    p_from: fromIso,
    p_to: toIso,
    p_max: maxCases,
  });
  if (error) throw error;
  return (data || []).map((r: any) => ({ tgId: r.tg_id, displayName: r.display_name || '' }));
}

// Створює кампанію (status='queued') і наповнює recipients батчами. display_name
// денормалізуємо одразу — щоб воркер не робив getUser під час розсилки.
export async function createBroadcast(input: {
  title: string;
  body: string;
  buttons: string[];
  critFrom: string;
  critTo: string;
  critMax: number;
  createdBy: string;
  recipients: Array<{ tgId: string; displayName: string }>;
}): Promise<BroadcastRow> {
  const { data, error } = await db()
    .from(T.broadcasts)
    .insert({
      title: input.title,
      body: input.body,
      buttons: input.buttons,
      crit_from: input.critFrom,
      crit_to: input.critTo,
      crit_max: input.critMax,
      status: 'queued',
      total_count: input.recipients.length,
      created_by: input.createdBy,
    })
    .select('*')
    .single();
  if (error) throw error;
  const broadcast = mapBroadcast(data);

  const pageSize = 500;
  for (let i = 0; i < input.recipients.length; i += pageSize) {
    const chunk = input.recipients.slice(i, i + pageSize).map(r => ({
      broadcast_id: broadcast.id,
      tg_id: r.tgId,
      display_name: r.displayName,
    }));
    const { error: insErr } = await db().from(T.broadcastRecipients).insert(chunk);
    if (insErr) throw insErr;
  }
  return broadcast;
}

export async function getBroadcast(id: number): Promise<BroadcastRow | null> {
  const { data, error } = await db().from(T.broadcasts).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapBroadcast(data) : null;
}

export async function listBroadcasts(limit = 50): Promise<BroadcastRow[]> {
  const { data, error } = await db()
    .from(T.broadcasts)
    .select('*')
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapBroadcast);
}

export async function setBroadcastStatus(
  id: number,
  status: BroadcastRow['status'],
  patch: { startedAt?: boolean; finishedAt?: boolean } = {}
): Promise<void> {
  const dbPatch: any = { status };
  if (patch.startedAt) dbPatch.started_at = new Date().toISOString();
  if (patch.finishedAt) dbPatch.finished_at = new Date().toISOString();
  const { error } = await db().from(T.broadcasts).update(dbPatch).eq('id', id);
  if (error) throw error;
}

// Найстаріша кампанія, що потребує доставки (для cron-воркера). Дешевий select.
export async function getActiveBroadcastId(): Promise<number | null> {
  const { data, error } = await db()
    .from(T.broadcasts)
    .select('id')
    .in('status', ['queued', 'sending'])
    .order('id', { ascending: true })
    .limit(1);
  if (error) throw error;
  return data && data.length ? Number(data[0].id) : null;
}

// Атомарний claim батчу pending-отримувачів (for update skip locked у RPC).
export async function claimBroadcastBatch(
  id: number,
  limit: number
): Promise<Array<{ tgId: string; displayName: string }>> {
  const { data, error } = await db().rpc(RPC_BROADCAST_CLAIM_BATCH, { p_id: id, p_limit: limit });
  if (error) throw error;
  return (data || []).map((r: any) => ({ tgId: r.tg_id, displayName: r.display_name || '' }));
}

// Повертає завислі 'sending' (>olderSeconds) назад у 'pending'. Кількість повернутих.
export async function reapBroadcastClaims(id: number, olderSeconds: number): Promise<number> {
  const { data, error } = await db().rpc(RPC_BROADCAST_REAP, {
    p_id: id,
    p_older_seconds: olderSeconds,
  });
  if (error) throw error;
  return Number(data) || 0;
}

export async function markBroadcastRecipient(
  id: number,
  tgId: string,
  status: 'sent' | 'failed',
  error?: string
): Promise<void> {
  const patch: any = { status };
  if (status === 'sent') patch.sent_at = new Date().toISOString();
  if (error !== undefined) patch.error = error.slice(0, 500);
  const { error: upErr } = await db()
    .from(T.broadcastRecipients)
    .update(patch)
    .eq('broadcast_id', id)
    .eq('tg_id', tgId);
  if (upErr) throw upErr;
}

export async function incBroadcastCounters(id: number, sent: number, failed: number): Promise<void> {
  const { error } = await db().rpc(RPC_BROADCAST_INC, { p_id: id, p_sent: sent, p_failed: failed });
  if (error) throw error;
}

// К-сть pending-отримувачів кампанії (head-запит, без витягання рядків).
export async function countPendingRecipients(id: number): Promise<number> {
  const { count, error } = await db()
    .from(T.broadcastRecipients)
    .select('tg_id', { count: 'exact', head: true })
    .eq('broadcast_id', id)
    .in('status', ['pending', 'sending']);
  if (error) throw error;
  return count || 0;
}

// Реєстрація кліку юзера по кнопці розсилки. true = це був ПЕРШИЙ клік (для статистики).
export async function recordBroadcastClick(
  id: number,
  tgId: string,
  action: string
): Promise<boolean> {
  const { data, error } = await db().rpc(RPC_BROADCAST_CLICK, {
    p_id: id,
    p_tg_id: tgId,
    p_action: action,
  });
  if (error) throw error;
  return data === true;
}

