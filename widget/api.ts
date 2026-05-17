// API-клієнт віджета. Усі запити йдуть на /api/public/v1.
// Базовий URL налаштовується через data-api-base атрибут <script>.

export interface ApiConfig {
  baseUrl: string;     // напр. "https://blukach.app" — без trailing slash
  partnerKey: string;
}

export interface SessionInfo {
  sessionToken: string;
  userId: string;
  nickname: string;
}

export interface QuestionDef {
  id: string;
  label: string;
  role: string;
}

export interface CasePayload {
  caseId: string;
  imageUrl: string;
  questions: QuestionDef[];
  taskType: 'recognize' | 'review';
  existingAnswers: string[] | null;
  mode: 'parallel' | 'collaborative';
  lockedUntil: string | null;
}

export interface SubmitResult {
  pointsEarned: number;
  multiplier: number;
  todayCount: number;
  total: number;
  closed: boolean;
  actionTaken: string;
}

export interface UserStats {
  nickname: string;
  total: number;
  todayCount: number;
  todayPoints: number;
  multiplier: number;
  rank: number;
  totalUsers: number;
}

export class ApiClient {
  private session: SessionInfo | null = null;

  constructor(private cfg: ApiConfig) {}

  setSession(s: SessionInfo | null) {
    this.session = s;
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = { 'X-Partner-Key': this.cfg.partnerKey };
    if (this.session) h['Authorization'] = `Bearer ${this.session.sessionToken}`;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.cfg.baseUrl + '/api/public/v1' + path, init);
    if (!res.ok) {
      let body: any = null;
      try { body = await res.json(); } catch {}
      const err = new Error(body?.error || `HTTP ${res.status}`);
      (err as any).status = res.status;
      (err as any).body = body;
      throw err;
    }
    return res.json() as Promise<T>;
  }

  startSession(): Promise<{ session_token: string; user_id: string; nickname: string }> {
    return this.req('/session/start', { method: 'POST', headers: this.headers() });
  }

  heartbeat(caseId: string): Promise<{ ok: true }> {
    return this.req('/session/heartbeat', {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ case_id: caseId }),
    });
  }

  async nextCase(): Promise<CasePayload | null> {
    const r = await this.req<{ case: any | null }>('/case/next', {
      method: 'GET',
      headers: this.headers(),
    });
    if (!r.case) return null;
    return {
      caseId: r.case.case_id,
      imageUrl: this.cfg.baseUrl + r.case.image_url,
      questions: r.case.questions || [],
      taskType: r.case.task_type,
      existingAnswers: r.case.existing_answers,
      mode: r.case.mode,
      lockedUntil: r.case.locked_until,
    };
  }

  submit(caseId: string, answers: string[]): Promise<SubmitResult> {
    return this.req(`/case/${encodeURIComponent(caseId)}/submit`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ answers }),
    });
  }

  confirm(caseId: string): Promise<SubmitResult> {
    return this.req(`/case/${encodeURIComponent(caseId)}/confirm`, {
      method: 'POST',
      headers: this.headers(),
    });
  }

  skip(caseId: string): Promise<{ ok: true }> {
    return this.req(`/case/${encodeURIComponent(caseId)}/skip`, {
      method: 'POST',
      headers: this.headers(),
    });
  }

  release(caseId: string): Promise<{ ok: true }> {
    return this.req(`/case/${encodeURIComponent(caseId)}/release`, {
      method: 'POST',
      headers: this.headers(),
    });
  }

  stats(): Promise<UserStats> {
    return this.req('/me/stats', { method: 'GET', headers: this.headers() });
  }
}
