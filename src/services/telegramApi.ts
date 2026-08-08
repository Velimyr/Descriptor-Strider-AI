// Тонкий клієнт до /api/telegram/admin/*. Сесія адмінки — підписаний сервером
// токен зі скоупами (див. api/_core/adminToken.ts); зберігається в localStorage.
import type { AdminScope } from '../telegram-bot/adminScopes';

const TOKEN_KEY = 'telegram_admin_token';

export interface AdminProfile {
  login: string;
  displayName: string;
  isSuper: boolean;
  scopes: AdminScope[];
}

export const getAdminToken = (): string =>
  sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '';

export const setAdminToken = (v: string, remember: boolean) => {
  sessionStorage.setItem(TOKEN_KEY, v);
  if (remember) localStorage.setItem(TOKEN_KEY, v);
  else localStorage.removeItem(TOKEN_KEY);
};

export const clearAdminToken = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
};

// Кидається на 401 — токен протух або права відкликано (token_epoch змінився).
// Гейт ловить її й показує форму входу замість повідомлення про помилку.
export class AdminUnauthorizedError extends Error {
  constructor() {
    super('Сесія завершилась — увійдіть знову');
    this.name = 'AdminUnauthorizedError';
  }
}

export async function adminLogin(
  login: string,
  password: string,
  remember: boolean
): Promise<AdminProfile> {
  const res = await fetch('/api/telegram/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password, remember }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  setAdminToken(data.token, remember);
  return {
    login: data.login,
    displayName: data.displayName || data.login,
    isSuper: !!data.isSuper,
    scopes: data.scopes || [],
  };
}

async function call(path: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getAdminToken()}`,
    ...((init?.headers as any) || {}),
  };
  const res = await fetch(`/api/telegram${path}`, { ...init, headers });
  if (res.status === 401) {
    clearAdminToken();
    throw new AdminUnauthorizedError();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export interface AdminRow {
  id: string;
  login: string;
  displayName: string;
  scopes: AdminScope[];
  isSuper: boolean;
  active: boolean;
  createdAt: string;
  createdBy: string;
  lastLoginAt: string | null;
}

export const tgApi = {
  // Хто я і що мені доступно. Кличеться на старті адмінки: підтверджує, що токен
  // ще живий, і підтягує актуальні скоупи (могли змінитись після видачі токена).
  me: () => call('/admin/me') as Promise<AdminProfile & { allScopes: AdminScope[] }>,

  listAdmins: () => call('/admin/admins') as Promise<{ admins: AdminRow[] }>,
  createAdmin: (data: { login: string; displayName: string; scopes: AdminScope[]; isSuper: boolean }) =>
    call('/admin/admins', { method: 'POST', body: JSON.stringify(data) }) as Promise<{
      admin: AdminRow;
      password: string;
    }>,
  updateAdmin: (
    id: string,
    patch: { displayName?: string; scopes?: AdminScope[]; isSuper?: boolean; active?: boolean }
  ) =>
    call(`/admin/admins/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }) as Promise<{ admin: AdminRow }>,
  resetAdminPassword: (id: string) =>
    call(`/admin/admins/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
      body: '{}',
    }) as Promise<{ password: string }>,
  deleteAdmin: (id: string) =>
    call(`/admin/admins/${encodeURIComponent(id)}`, { method: 'DELETE' }),

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
    targetSubmissions?: number | null;
    pointsRecognition?: number | null;
    pointsVerification?: number | null;
    difficulty?: 'normal' | 'hard';
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
    targetSubmissions?: number | null;
    pointsVerification?: number | null;
  }) => call('/admin/upload-verif-case', { method: 'POST', body: JSON.stringify(payload) }),
  getDescriptionSettings: (archive: string, fund: string, opys: string) =>
    call(
      `/admin/description-settings?archive=${encodeURIComponent(archive)}` +
        `&fund=${encodeURIComponent(fund)}&opys=${encodeURIComponent(opys)}`
    ) as Promise<{
      settings: { targetSubmissions: number | null; pointsRecognition: number | null; pointsVerification: number | null; difficulty: 'normal' | 'hard' };
      defaults: { targetSubmissions: number; pointsRecognition: number; pointsVerification: number; difficulty: 'normal' | 'hard' };
    }>,
  setDescriptionSettings: (payload: {
    archive: string;
    fund: string;
    opys: string;
    targetSubmissions: number | null;
    pointsRecognition: number | null;
    pointsVerification: number | null;
    difficulty?: 'normal' | 'hard';
  }) => call('/admin/description-settings', { method: 'POST', body: JSON.stringify(payload) }),
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
  // Лёгкий запит: лише список описів (TG + web), без юзерів/інших агрегацій.
  // Заміна `overview()` у місцях, де потрібен тільки селектор опису.
  descriptions: (source: 'tg' | 'web' | 'all' = 'all') =>
    call(`/admin/descriptions?source=${source}`) as Promise<{
      descriptions: Array<{
        key: string;
        name: string;
        earliestCreatedAt: string;
        totalCases: number;
        doneCases: number;
        donePct: number;
        source: 'telegram' | 'web';
      }>;
    }>,
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
  integrityBan: (payload: {
    tgId: string;
    reason?: string;
    caseId?: string;
    pairTgIdA?: string;
    pairTgIdB?: string;
  }) => call('/admin/integrity/ban', { method: 'POST', body: JSON.stringify(payload) }),
  integrityUnban: (tgId: string) =>
    call('/admin/integrity/unban', { method: 'POST', body: JSON.stringify({ tgId }) }),
  grantBonus: (payload: { tgId: string; points: number; reason: string }) =>
    call('/admin/grant-bonus', { method: 'POST', body: JSON.stringify(payload) }) as Promise<{
      ok: boolean;
      newTotal: number;
      warning?: string;
    }>,
  bannedUsers: () =>
    call('/admin/banned-users') as Promise<{
      ok: boolean;
      users: Array<{
        tgId: string;
        displayName: string;
        banReason: string;
        bannedAt: string;
        bannedBy: string;
        source: 'tg' | 'web';
      }>;
    }>,
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
  // --- Профіль користувача ---
  userProfile: (tgId: string) =>
    call(`/admin/user-profile/${encodeURIComponent(tgId)}`) as Promise<{
      tgId: string;
      displayName: string;
      totalPoints: number;
      status: string;
      source: 'tg' | 'web';
      partnerId: string | null;
      createdAt: string;
      city: string;
      region: string;
      photoFileId: string;
      hasPhoto: boolean;
      tgUsername: string;
      tgLink: string;
      phoneNumber: string;
      facebookUrl: string;
      photoMessageId: string;
    }>,
  userPhotoUrl: (tgId: string) =>
    `/api/telegram/admin/user-photo/${encodeURIComponent(tgId)}?token=${encodeURIComponent(getAdminToken())}`,
  bulkPuzzles: (phrases: string[], startDate?: string, dryRun = false) =>
    call('/admin/puzzle/bulk', {
      method: 'POST',
      body: JSON.stringify({ phrases, startDate, dryRun }),
    }) as Promise<{
      ok: boolean;
      dryRun: boolean;
      assignments: Array<{ date: string; sentence: string }>;
    }>,

  // ----- Адмін-розсилки -----
  broadcastButtons: () =>
    call('/admin/broadcast/buttons') as Promise<{ buttons: Array<{ action: string; label: string }> }>,
  broadcastPreview: (payload: { from: string; to: string; maxCases: number }) =>
    call('/admin/broadcast/preview', { method: 'POST', body: JSON.stringify(payload) }) as Promise<{
      count: number;
      from: string;
      to: string;
      maxCases: number;
    }>,
  createBroadcast: (payload: {
    title: string;
    body: string;
    buttons: string[];
    from: string;
    to: string;
    maxCases: number;
  }) =>
    call('/admin/broadcast', { method: 'POST', body: JSON.stringify(payload) }) as Promise<{
      broadcast: BroadcastRow;
      drain: any;
    }>,
  listBroadcasts: () =>
    call('/admin/broadcasts') as Promise<{ broadcasts: BroadcastRow[] }>,
  getBroadcast: (id: number) =>
    call(`/admin/broadcast/${id}`) as Promise<{ broadcast: BroadcastRow }>,
  drainBroadcast: (id: number) =>
    call(`/admin/broadcast/${id}/drain`, { method: 'POST', body: '{}' }) as Promise<{
      result: any;
      broadcast: BroadcastRow;
    }>,
  cancelBroadcast: (id: number) =>
    call(`/admin/broadcast/${id}/cancel`, { method: 'POST', body: '{}' }) as Promise<{ ok: boolean }>,

  // --- Вікторина (сторінка /quiz) ---
  quizLive: (since: number) =>
    call(`/admin/quiz/live?since=${since}`) as Promise<QuizLive>,
  quizQuestions: () =>
    call('/admin/quiz/questions') as Promise<{ questions: QuizQuestionPreview[] }>,
  quizStart: () => call('/admin/quiz/start', { method: 'POST', body: '{}' }) as Promise<{ state: QuizState }>,
  quizNext: () => call('/admin/quiz/next', { method: 'POST', body: '{}' }) as Promise<{ state: QuizState }>,
  quizRestartTimer: () =>
    call('/admin/quiz/restart-timer', { method: 'POST', body: '{}' }) as Promise<{ state: QuizState }>,
  quizStop: () => call('/admin/quiz/stop', { method: 'POST', body: '{}' }) as Promise<{ state: QuizState }>,
  // Скидає все: бали, стрічку відповідей і стан сесії.
  quizReset: () => call('/admin/quiz/reset', { method: 'POST', body: '{}' }) as Promise<{ ok: boolean }>,

  // --- Архівний стендап (друга вкладка /quiz) ---
  standupLive: () => call('/admin/standup/live') as Promise<StandupLive>,
  standupStart: () =>
    call('/admin/standup/start', { method: 'POST', body: '{}' }) as Promise<{ state: StandupState }>,
  standupCall: (tgId: string) =>
    call('/admin/standup/call', { method: 'POST', body: JSON.stringify({ tg_id: tgId }) }) as Promise<{
      state: StandupState;
    }>,
  standupVoteTimer: () =>
    call('/admin/standup/vote-timer', { method: 'POST', body: '{}' }) as Promise<{ state: StandupState }>,
  standupRestartThinking: () =>
    call('/admin/standup/restart-thinking', { method: 'POST', body: '{}' }) as Promise<{
      state: StandupState;
    }>,
  standupNext: () =>
    call('/admin/standup/next', { method: 'POST', body: '{}' }) as Promise<{
      state: StandupState;
      winners: StandupWinner[];
    }>,
  standupStop: () =>
    call('/admin/standup/stop', { method: 'POST', body: '{}' }) as Promise<{
      state: StandupState;
      winners: StandupWinner[];
    }>,
  standupReset: () =>
    call('/admin/standup/reset', { method: 'POST', body: '{}' }) as Promise<{ ok: boolean }>,
};

// URL фото учасника для <img> (адмін-ендпоінт приймає секрет у query).
export const userPhotoUrl = (tgId: string): string =>
  `/api/telegram/admin/user-photo/${encodeURIComponent(tgId)}?token=${encodeURIComponent(getAdminToken())}`;

export interface StandupState {
  status: 'idle' | 'running' | 'finished';
  sessionId: string;
  qIndex: number;
  total: number;
  phase: 'thinking' | 'performing' | 'results';
  performerTgId: string;
  secondsLeft: number;
  endsAt: string;
  hasTimer: boolean;
  signupOpen: boolean;
  voteOpen: boolean;
}

export interface StandupSignup {
  tgId: string;
  displayName: string;
  hasPhoto: boolean;
  performed: boolean;
  createdAt: string;
  performedAt: string;
  likes: number;
}

export interface StandupWinner {
  tgId: string;
  displayName: string;
  likes: number;
}

export interface StandupLive {
  state: StandupState;
  question: { index: number; text: string } | null;
  signups: StandupSignup[];
  rounds: Array<{ qIndex: number; winners: StandupWinner[] }>;
  leaderboard: QuizScore[];
  config: { thinkSeconds: number; voteSeconds: number; pointsPerWin: number; total: number };
}

export interface QuizState {
  status: 'idle' | 'running' | 'finished';
  sessionId: string;
  qIndex: number;
  total: number;
  secondsLeft: number;
  endsAt: string;
  open: boolean;
}

export interface QuizQuestionPreview {
  index: number;
  text: string;
  answer: string;
}

export interface QuizAnswer {
  id: number;
  qIndex: number;
  tgId: string;
  displayName: string;
  answer: string;
  isCorrect: boolean;
  isWinner: boolean;
  createdAt: string;
}

export interface QuizScore {
  tgId: string;
  displayName: string;
  points: number;
  wins: number;
}

export interface QuizLive {
  state: QuizState;
  question: { index: number; text: string; answer: string } | null;
  answers: QuizAnswer[];
  // null — рейтинг не змінювався з минулого опитування (сторінка лишає попередній).
  leaderboard: QuizScore[] | null;
  config: { answerSeconds: number; pointsPerWin: number; total: number };
}

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
