// Тонкий клієнт до /api/telegram/admin/*. Секрет адмінки зберігається в localStorage.

const SECRET_KEY = 'telegram_admin_secret';

export const getAdminSecret = (): string =>
  sessionStorage.getItem(SECRET_KEY) || localStorage.getItem(SECRET_KEY) || '';

export const setAdminSecret = (v: string, remember: boolean) => {
  sessionStorage.setItem(SECRET_KEY, v);
  if (remember) localStorage.setItem(SECRET_KEY, v);
  else localStorage.removeItem(SECRET_KEY);
};

export const clearAdminSecret = () => {
  sessionStorage.removeItem(SECRET_KEY);
  localStorage.removeItem(SECRET_KEY);
};

export async function adminLogin(login: string, password: string, remember: boolean): Promise<void> {
  const res = await fetch('/api/telegram/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  setAdminSecret(data.token, remember);
}

async function call(path: string, init?: RequestInit) {
  const secret = getAdminSecret();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-admin-secret': secret,
    ...((init?.headers as any) || {}),
  };
  const res = await fetch(`/api/telegram${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const tgApi = {
  health: () => call('/admin/health'),
  checkDb: () => call('/admin/check-db'),
  saveQuestions: (questions: any[]) =>
    call('/admin/save-questions', { method: 'POST', body: JSON.stringify({ questions }) }),
  getQuestions: () => call('/admin/questions'),
  setWebhook: (url: string) =>
    call('/admin/set-webhook', { method: 'POST', body: JSON.stringify({ url }) }),
  webhookInfo: () => call('/admin/webhook-info'),
  deleteWebhook: () => call('/admin/delete-webhook', { method: 'POST', body: '{}' }),
  uploadCase: (payload: {
    imageBase64: string;
    mime: string;
    sourcePdf?: string;
    page?: number | string;
    bbox?: any;
    archive: string;
    fund: string;
    opys: string;
    mode?: 'parallel' | 'collaborative';
  }) => call('/admin/upload-case', { method: 'POST', body: JSON.stringify(payload) }),
  getMeta: () => call('/admin/meta'),
  setMeta: (key: string, value: string) =>
    call('/admin/meta', { method: 'POST', body: JSON.stringify({ key, value }) }),
  detectBoxes: (imageBase64: string, mime: string, apiKey: string) =>
    call('/admin/detect-bboxes', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mime, apiKey }),
    }),
  overview: () => call('/admin/overview'),
  results: (limit = 500) => call(`/admin/results?limit=${limit}`),
  todayStats: () => call('/admin/today-stats') as Promise<{ cases: number; users: number; timezone: string }>,
  dailyActivity: (days = 30) =>
    call(`/admin/daily-activity?days=${days}`) as Promise<{
      timezone: string;
      days: Array<{ date: string; cases: number; users: number }>;
    }>,
  integrity: (threshold = 5, includeResolved = false) =>
    call(`/admin/integrity?threshold=${threshold}${includeResolved ? '&includeResolved=1' : ''}`),
  penalize: (payload: {
    tgId: string;
    points: number;
    caseId?: string;
    archive?: string;
    fund?: string;
    opys?: string;
    fields?: Array<{ label: string; text: string }>;
    pairTgIdA?: string;
    pairTgIdB?: string;
  }) =>
    call('/admin/penalize', { method: 'POST', body: JSON.stringify(payload) }),
  integrityDismiss: (caseId: string, pairTgIdA: string, pairTgIdB: string) =>
    call('/admin/integrity/dismiss', {
      method: 'POST',
      body: JSON.stringify({ caseId, pairTgIdA, pairTgIdB }),
    }),
  integrityReopen: (caseId: string, pairTgIdA: string, pairTgIdB: string) =>
    call('/admin/integrity/reopen', {
      method: 'POST',
      body: JSON.stringify({ caseId, pairTgIdA, pairTgIdB }),
    }),
  submissionsByDescription: (archive: string, fund: string, opys: string) =>
    call(
      `/admin/submissions-by-description?archive=${encodeURIComponent(archive)}` +
        `&fund=${encodeURIComponent(fund)}&opys=${encodeURIComponent(opys)}`
    ),
  // Партнери віджета
  listPartners: () => call('/admin/partners'),
  partnerStats: (fromIso: string, toIso: string) =>
    call(`/admin/partners/stats?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`),
  createPartner: (data: {
    partnerId: string;
    name: string;
    nicknamePrefix: string;
    allowedOrigins: string[];
    customization?: {
      theme?: 'light' | 'dark' | 'auto';
      buttonColor?: string;
      buttonColorCustom?: string;
      buttonText?: string;
      buttonDisplayMode?: 'text' | 'image';
      position?: 'bottom-right' | 'top-right' | 'middle-right' | 'bottom-left' | 'middle-left' | 'bottom-center';
      verticalOffset?: number;
    };
  }) => call('/admin/partners', { method: 'POST', body: JSON.stringify(data) }),
  updatePartner: (
    partnerId: string,
    patch: Partial<{
      name: string;
      nicknamePrefix: string;
      allowedOrigins: string[];
      active: boolean;
      customization: {
        theme?: 'light' | 'dark' | 'auto';
        buttonColor?: string;
        buttonColorCustom?: string;
        buttonText?: string;
        buttonDisplayMode?: 'text' | 'image';
        position?: 'bottom-right' | 'top-right' | 'middle-right' | 'bottom-left' | 'middle-left' | 'bottom-center';
        verticalOffset?: number;
      };
    }>
  ) =>
    call(`/admin/partners/${encodeURIComponent(partnerId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deletePartner: (partnerId: string) =>
    call(`/admin/partners/${encodeURIComponent(partnerId)}`, { method: 'DELETE' }),
};
