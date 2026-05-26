// Клієнт API сайту перевірки (/api/verif). Токен сесії — у localStorage.
const TOKEN_KEY = 'verif_session_token';

export interface VerifUser {
  user_id: string;
  nickname: string;
  linked_telegram: boolean;
}

export interface VerifProfile extends VerifUser {
  total: number;
  rank: number;
  total_users: number;
  today_count: number;
  badges: string[];
}

export interface VerifConfig {
  tg_bot_username: string;
  dev_login: boolean;
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}
function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api/verif${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    (err as any).code = data?.error;
    (err as any).status = res.status;
    throw err;
  }
  return data as T;
}

export async function getConfig(): Promise<VerifConfig> {
  return call<VerifConfig>('/config', { method: 'GET' });
}

export async function register(displayName: string): Promise<VerifUser> {
  const r = await call<{ session_token: string; user: VerifUser }>('/register', {
    method: 'POST',
    body: JSON.stringify({ display_name: displayName }),
  });
  setToken(r.session_token);
  return r.user;
}

export async function authTelegram(data: Record<string, unknown>): Promise<VerifUser> {
  const r = await call<{ session_token: string; user: VerifUser }>('/auth/telegram', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  setToken(r.session_token);
  return r.user;
}

export async function authDev(tgId?: string, displayName?: string): Promise<VerifUser> {
  const r = await call<{ session_token: string; user: VerifUser }>('/auth/dev', {
    method: 'POST',
    body: JSON.stringify({ tg_id: tgId, display_name: displayName }),
  });
  setToken(r.session_token);
  return r.user;
}

export async function getMe(): Promise<VerifProfile> {
  return call<VerifProfile>('/me', { method: 'GET' });
}

export interface VerifQuestion {
  label: string;
  role: string;
}

export interface VerifCase {
  caseId: string;
  imageUrl: string;
  archive: string;
  fund: string;
  opys: string;
  sprava: string;
  questions: VerifQuestion[];
  answers: string[];
  aiAnswers: string[];
  lockedUntil: string;
}

export interface VerifDescription {
  archive: string;
  fund: string;
  opys: string;
  total: number;
  done: number;
}

export interface VerifStatsResp {
  descriptions: VerifDescription[];
  total_descriptions: number;
  remaining_descriptions: number;
}

export interface VerifSubmitResult {
  confirmationsCount: number;
  done: boolean;
  pointsEarned: number;
  correctedWords: number;
}

export async function getNext(): Promise<VerifCase | null> {
  const r = await call<{ case: VerifCase | null }>('/next', { method: 'GET' });
  return r.case;
}

export async function getStats(): Promise<VerifStatsResp> {
  return call<VerifStatsResp>('/stats', { method: 'GET' });
}

export async function submitCase(caseId: string, answers: string[]): Promise<VerifSubmitResult> {
  return call<VerifSubmitResult>(`/case/${encodeURIComponent(caseId)}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

export async function skipCase(caseId: string): Promise<void> {
  await call(`/case/${encodeURIComponent(caseId)}/skip`, { method: 'POST', body: '{}' });
}

export async function releaseCase(caseId: string): Promise<void> {
  await call(`/case/${encodeURIComponent(caseId)}/release`, { method: 'POST', body: '{}' });
}

export async function rename(displayName: string): Promise<string> {
  const r = await call<{ ok: boolean; nickname: string }>('/me/rename', {
    method: 'POST',
    body: JSON.stringify({ display_name: displayName }),
  });
  return r.nickname;
}
