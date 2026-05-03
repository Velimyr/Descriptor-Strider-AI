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
    sprava: string;
  }) => call('/admin/upload-case', { method: 'POST', body: JSON.stringify(payload) }),
  detectBoxes: (imageBase64: string, mime: string, geminiKey: string) =>
    call('/admin/detect-bboxes', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mime, geminiKey }),
    }),
  overview: () => call('/admin/overview'),
  results: (limit = 500) => call(`/admin/results?limit=${limit}`),
};
