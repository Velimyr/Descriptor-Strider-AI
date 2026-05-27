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
  uploadVerifCase: (payload: {
    imageBase64: string;
    mime: string;
    sourcePdf?: string;
    page?: number | string;
    bbox?: any;
    archive: string;
    fund: string;
    opys: string;
    questions: Array<{ label: string; role: string }>;
    aiAnswers: string[];
  }) => call('/admin/upload-verif-case', { method: 'POST', body: JSON.stringify(payload) }),
  verifDescriptions: () =>
    call('/admin/verif-descriptions') as Promise<{
      descriptions: Array<{ key: string; name: string; donePct: number; doneCases: number; totalCases: number }>;
    }>,
  verifSubmissionsByDescription: (archive: string, fund: string, opys: string) =>
    call(
      `/admin/verif-submissions-by-description?archive=${encodeURIComponent(archive)}` +
        `&fund=${encodeURIComponent(fund)}&opys=${encodeURIComponent(opys)}`
    ),
  getMeta: () => call('/admin/meta'),
  setMeta: (key: string, value: string) =>
    call('/admin/meta', { method: 'POST', body: JSON.stringify({ key, value }) }),
  detectBoxes: (imageBase64: string, mime: string, apiKey: string) =>
    call('/admin/detect-bboxes', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mime, apiKey }),
    }),
  overview: () => call('/admin/overview'),
  monthly: (month?: string) =>
    call(`/admin/monthly${month ? `?month=${encodeURIComponent(month)}` : ''}`) as Promise<{
      months: string[];
      month: string;
      leaderboard: Array<{ tgId: string; points: number; displayName: string }>;
    }>,
  results: (limit = 500) => call(`/admin/results?limit=${limit}`),
  todayStats: () => call('/admin/today-stats') as Promise<{ cases: number; users: number; timezone: string }>,
  dailyActivity: (days = 30, source: 'all' | 'telegram' | 'web' = 'all') =>
    call(`/admin/daily-activity?days=${days}&source=${source}`) as Promise<{
      timezone: string;
      source: 'all' | 'telegram' | 'web';
      days: Array<{ date: string; cases: number; users: number }>;
    }>,
  fundEta: (windowDays = 14) =>
    call(`/admin/fund-eta?windowDays=${windowDays}`) as Promise<{
      fundNumber: string;
      totalDescriptions: number;
      baselineDoneDescriptions: number;
      fullyDoneByBot: number;
      totalDone: number;
      remaining: number;
      windowDays: number;
      completionsInWindow: number;
      ratePerDay: number;
      etaDateIso: string | null;
      etaDateLocal: string | null;
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
  // Описовий пазл
  getPuzzle: (date?: string) =>
    call(`/admin/puzzle${date ? `?date=${encodeURIComponent(date)}` : ''}`) as Promise<{
      date: string;
      sentence: string;
    }>,
  savePuzzle: (date: string, sentence: string) =>
    call('/admin/puzzle', { method: 'POST', body: JSON.stringify({ date, sentence }) }),
  puzzleWordAvailability: (sentence: string) =>
    call(`/admin/puzzle/word-availability?sentence=${encodeURIComponent(sentence)}`) as Promise<{
      sentence: string;
      titleConfigured: boolean;
      words: Array<{ word: string; count: number }>;
    }>,
  puzzleProgress: (date?: string) =>
    call(`/admin/puzzle/progress${date ? `?date=${encodeURIComponent(date)}` : ''}`) as Promise<{
      date: string;
      sentence: string;
      total: number;
      words: string[];
      givenWords: string[];
      participants: Array<{
        tgId: string;
        displayName: string;
        collected: number;
        confirmed: number;
        place: number | null;
        words: Record<string, 'confirmed' | 'unconfirmed'>;
      }>;
      winners: Array<{ place: number; tgId: string; points: number; displayName: string }>;
    }>,
  listPuzzles: () =>
    call('/admin/puzzles') as Promise<{ puzzles: Array<{ date: string; sentence: string }> }>,
  bulkPuzzles: (phrases: string[], startDate?: string, dryRun = false) =>
    call('/admin/puzzle/bulk', {
      method: 'POST',
      body: JSON.stringify({ phrases, startDate, dryRun }),
    }) as Promise<{
      ok: boolean;
      dryRun: boolean;
      assignments: Array<{ date: string; sentence: string }>;
    }>,
};
