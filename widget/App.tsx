// Головний компонент віджета. Стейт-машина: floater → invite → case → submitted.
// Один файл щоб тримати MVP-бандл невеликим — рефакторити коли UX усталиться.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient, CasePayload, QuestionDef, SubmitResult, UserStats } from './api';
import { clearSession, loadSession, saveSession } from './storage';

type Stage =
  | { kind: 'floater' }
  | { kind: 'invite' }
  | { kind: 'loading' }
  | { kind: 'case'; data: CasePayload; mode: 'recognize' | 'review'; answers: string[]; qIndex: number }
  | { kind: 'no-cases' }
  | { kind: 'submitted'; result: SubmitResult }
  | { kind: 'linking'; code: string; deepLink: string }
  | { kind: 'linked' }
  | { kind: 'error'; message: string };

const HEARTBEAT_MS = 30_000;

export interface AppProps {
  api: ApiClient;
  partnerId: string;
  buttonText: string;
}

export const App: React.FC<AppProps> = ({ api, partnerId, buttonText }) => {
  const [stage, setStage] = useState<Stage>({ kind: 'floater' });
  const [stats, setStats] = useState<UserStats | null>(null);
  const heartbeatRef = useRef<number | null>(null);

  // Завантажуємо існуючу сесію (якщо є).
  useEffect(() => {
    const s = loadSession(partnerId);
    if (s) api.setSession(s);
  }, [api, partnerId]);

  // Heartbeat для collab. Запускається коли відкрита справа в collab-режимі.
  useEffect(() => {
    if (stage.kind === 'case' && stage.data.mode === 'collaborative') {
      const caseId = stage.data.caseId;
      heartbeatRef.current = window.setInterval(() => {
        api.heartbeat(caseId).catch(() => {/* ігноруємо */});
      }, HEARTBEAT_MS);
      return () => {
        if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      };
    }
  }, [stage, api]);

  // Звільняємо лок при закритті вкладки.
  useEffect(() => {
    if (stage.kind !== 'case' || stage.data.mode !== 'collaborative') return;
    const caseId = stage.data.caseId;
    const onUnload = () => {
      // sendBeacon працює навіть при unload.
      try {
        navigator.sendBeacon(
          `${(api as any).cfg.baseUrl}/api/public/v1/case/${encodeURIComponent(caseId)}/release`,
          new Blob([''], { type: 'text/plain' })
        );
      } catch {}
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [stage, api]);

  // ----- Стартова сесія (lazy: тільки при першій взаємодії) -----
  async function ensureSession(): Promise<boolean> {
    if (loadSession(partnerId)) return true;
    try {
      const r = await api.startSession();
      const info = { sessionToken: r.session_token, userId: r.user_id, nickname: r.nickname };
      api.setSession(info);
      saveSession(partnerId, info);
      return true;
    } catch (e: any) {
      setStage({ kind: 'error', message: e?.message || 'Помилка сесії' });
      return false;
    }
  }

  // ----- Перехід «Хочу допомогти» → завантажуємо справу -----
  async function takeCase() {
    setStage({ kind: 'loading' });
    const ok = await ensureSession();
    if (!ok) return;
    try {
      const data = await api.nextCase();
      if (!data) { setStage({ kind: 'no-cases' }); return; }
      const mode: 'recognize' | 'review' = data.taskType === 'review' ? 'review' : 'recognize';
      const initialAnswers = data.existingAnswers
        ? [...data.existingAnswers]
        : new Array(data.questions.length).fill('');
      setStage({ kind: 'case', data, mode, answers: initialAnswers, qIndex: 0 });
    } catch (e: any) {
      // 401 — сесія простроена, чистимо і просимо знову.
      if (e?.status === 401) {
        clearSession(partnerId);
        api.setSession(null);
        setStage({ kind: 'error', message: 'Сесія завершилась. Спробуйте ще раз.' });
        return;
      }
      setStage({ kind: 'error', message: e?.message || 'Помилка завантаження справи' });
    }
  }

  // ----- Submit / Confirm -----
  async function doSubmit(caseId: string, answers: string[]) {
    try {
      const result = await api.submit(caseId, answers);
      const s = await api.stats().catch(() => null);
      if (s) setStats(s);
      setStage({ kind: 'submitted', result });
    } catch (e: any) {
      setStage({ kind: 'error', message: e?.message || 'Помилка збереження' });
    }
  }

  async function doConfirm(caseId: string) {
    try {
      const result = await api.confirm(caseId);
      const s = await api.stats().catch(() => null);
      if (s) setStats(s);
      setStage({ kind: 'submitted', result });
    } catch (e: any) {
      setStage({ kind: 'error', message: e?.message || 'Помилка підтвердження' });
    }
  }

  async function doSkip(caseId: string) {
    try { await api.skip(caseId); } catch {}
    takeCase();
  }

  // ----- Linking з Telegram -----
  async function startLinking() {
    try {
      const r = await api.linkStart();
      // Відкриваємо deep link у новій вкладці. Юзер у TG натискає /start і повертається.
      window.open(r.deep_link, '_blank', 'noopener,noreferrer');
      setStage({ kind: 'linking', code: r.code, deepLink: r.deep_link });
    } catch (e: any) {
      setStage({ kind: 'error', message: e?.message || 'Не вдалось почати привʼязку' });
    }
  }

  // Polling статусу лінкінгу.
  useEffect(() => {
    if (stage.kind !== 'linking') return;
    let stopped = false;
    const code = stage.code;
    const tick = async () => {
      try {
        const r = await api.linkStatus(code);
        if (stopped) return;
        if (r.status === 'completed') {
          // Web-юзер видалений на сервері → чистимо локальну сесію.
          clearSession(partnerId);
          api.setSession(null);
          setStage({ kind: 'linked' });
        } else if (r.status === 'expired' || r.status === 'unknown') {
          setStage({ kind: 'error', message: 'Код прострочений. Спробуйте ще раз.' });
        }
      } catch {/* network — пропускаємо, повторимо */}
    };
    const interval = window.setInterval(tick, 3000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [stage, api, partnerId]);

  const close = useCallback(() => setStage({ kind: 'floater' }), []);

  // ===== RENDER =====
  if (stage.kind === 'floater') {
    return (
      <button className="blkch-floater" onClick={() => setStage({ kind: 'invite' })}>
        <span className="blkch-floater-avatar">Б</span>
        {buttonText}
      </button>
    );
  }

  return (
    <div className="blkch-backdrop" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="blkch-modal">
        <button className="blkch-close" onClick={close} aria-label="Закрити">×</button>
        {stage.kind === 'invite' && <Invite onAccept={takeCase} onDecline={close} />}
        {stage.kind === 'loading' && <p className="blkch-text">Завантажую справу…</p>}
        {stage.kind === 'no-cases' && (
          <>
            <h2 className="blkch-h1">Усі справи вже опрацьовано 🎉</h2>
            <p className="blkch-text">Поверніться пізніше — нові справи зʼявляться.</p>
            <button className="blkch-btn blkch-btn-secondary" onClick={close}>Закрити</button>
          </>
        )}
        {stage.kind === 'case' && (
          <CaseStage
            stage={stage}
            onChange={setStage}
            onSubmit={(answers) => doSubmit(stage.data.caseId, answers)}
            onConfirm={() => doConfirm(stage.data.caseId)}
            onSkip={() => doSkip(stage.data.caseId)}
          />
        )}
        {stage.kind === 'submitted' && (
          <Submitted
            result={stage.result}
            stats={stats}
            onNext={takeCase}
            onClose={close}
            onLink={startLinking}
          />
        )}
        {stage.kind === 'linking' && <LinkingView deepLink={stage.deepLink} onCancel={close} />}
        {stage.kind === 'linked' && <LinkedView onClose={close} />}
        {stage.kind === 'error' && (
          <>
            <h2 className="blkch-h1">Помилка</h2>
            <p className="blkch-error">{stage.message}</p>
            <div className="blkch-btn-row">
              <button className="blkch-btn blkch-btn-primary" onClick={takeCase}>Спробувати ще</button>
              <button className="blkch-btn blkch-btn-secondary" onClick={close}>Закрити</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ===== Invite =====
const Invite: React.FC<{ onAccept: () => void; onDecline: () => void }> = ({ onAccept, onDecline }) => (
  <>
    <h2 className="blkch-h1">Привіт! Я Описовий Блукач 🧭</h2>
    <p className="blkch-text">
      Допоможи розпізнати кілька архівних справ — це займе хвилину.
      Ти побачиш фото фрагмента опису й відповіси на кілька питань.
    </p>
    <div className="blkch-btn-row">
      <button className="blkch-btn blkch-btn-primary" onClick={onAccept}>Так, допоможу</button>
      <button className="blkch-btn blkch-btn-secondary" onClick={onDecline}>Не зараз</button>
    </div>
  </>
);

// ===== CaseStage =====
type CaseStageProps = {
  stage: Extract<Stage, { kind: 'case' }>;
  onChange: (s: Stage) => void;
  onSubmit: (answers: string[]) => void;
  onConfirm: () => void;
  onSkip: () => void;
};

const CaseStage: React.FC<CaseStageProps> = ({ stage, onChange, onSubmit, onConfirm, onSkip }) => {
  const { data, mode, answers, qIndex } = stage;
  const total = data.questions.length;
  const onSummary = qIndex >= total;

  const updateAnswer = (val: string) => {
    const next = [...answers];
    next[qIndex] = val;
    onChange({ ...stage, answers: next });
  };
  const goPrev = () => onChange({ ...stage, qIndex: Math.max(0, qIndex - 1) });
  const goNext = () => onChange({ ...stage, qIndex: qIndex + 1 });
  const editAt = (i: number) => onChange({ ...stage, mode: 'recognize', qIndex: i });

  // REVIEW mode: показуємо існуючі відповіді як summary, можна Confirm або Edit→стає recognize.
  if (mode === 'review' && qIndex === 0 && !onSummary) {
    return (
      <>
        <h2 className="blkch-h1">Перевірте відповіді</h2>
        <p className="blkch-text">Хтось вже заповнив цю справу. Перевірте, чи все правильно.</p>
        <img className="blkch-image" src={data.imageUrl} alt="Архівна справа" />
        <Summary questions={data.questions} answers={answers} onEdit={editAt} />
        <div className="blkch-btn-row" style={{ marginTop: 12 }}>
          <button className="blkch-btn blkch-btn-primary" onClick={onConfirm}>✅ Усе правильно</button>
          <button className="blkch-btn blkch-btn-secondary" onClick={() => editAt(0)}>✏ Виправити</button>
          <button className="blkch-btn blkch-btn-danger" onClick={onSkip}>❌ Пропустити</button>
        </div>
      </>
    );
  }

  // SUMMARY (після відповідей на всі питання)
  if (onSummary) {
    return (
      <>
        <h2 className="blkch-h1">Перевірте відповіді</h2>
        <img className="blkch-image" src={data.imageUrl} alt="Архівна справа" />
        <Summary questions={data.questions} answers={answers} onEdit={editAt} />
        <div className="blkch-btn-row" style={{ marginTop: 12 }}>
          <button className="blkch-btn blkch-btn-primary" onClick={() => onSubmit(answers)}>✅ Підтвердити</button>
          <button className="blkch-btn blkch-btn-secondary" onClick={() => onChange({ ...stage, qIndex: total - 1 })}>⬅ Назад</button>
          <button className="blkch-btn blkch-btn-danger" onClick={onSkip}>❌ Пропустити</button>
        </div>
      </>
    );
  }

  // Опитування одне питання за раз
  const q = data.questions[qIndex];
  return (
    <>
      <p className="blkch-progress">Питання {qIndex + 1} / {total}</p>
      <img className="blkch-image" src={data.imageUrl} alt="Архівна справа" />
      <QuestionInput
        q={q}
        value={answers[qIndex] || ''}
        onChange={updateAnswer}
      />
      <div className="blkch-btn-row" style={{ marginTop: 4 }}>
        {qIndex > 0 && <button className="blkch-btn blkch-btn-secondary" onClick={goPrev}>⬅ Назад</button>}
        <button
          className="blkch-btn blkch-btn-secondary"
          onClick={() => { updateAnswer('—'); goNext(); }}
        >🚫 Не заповнено</button>
        <button className="blkch-btn blkch-btn-primary" onClick={goNext} disabled={!answers[qIndex]}>
          {qIndex === total - 1 ? 'Далі →' : 'Далі →'}
        </button>
        <button className="blkch-btn blkch-btn-danger" onClick={onSkip}>❌ Пропустити справу</button>
      </div>
    </>
  );
};

const QuestionInput: React.FC<{
  q: QuestionDef;
  value: string;
  onChange: (v: string) => void;
}> = ({ q, value, onChange }) => (
  <div>
    <label className="blkch-question-label">{q.label}</label>
    <textarea
      className="blkch-textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus
    />
  </div>
);

const Summary: React.FC<{
  questions: QuestionDef[];
  answers: string[];
  onEdit: (i: number) => void;
}> = ({ questions, answers, onEdit }) => (
  <div>
    {questions.map((q, i) => (
      <div key={q.id} className="blkch-summary-row">
        <div className="blkch-summary-label">{q.label}:</div>
        <div className="blkch-summary-value">{answers[i] || <em style={{ color: '#aaa' }}>—</em>}</div>
        <button className="blkch-btn blkch-btn-ghost" onClick={() => onEdit(i)}>✏</button>
      </div>
    ))}
  </div>
);

// ===== Submitted =====
const Submitted: React.FC<{
  result: SubmitResult;
  stats: UserStats | null;
  onNext: () => void;
  onClose: () => void;
  onLink: () => void;
}> = ({ result, stats, onNext, onClose, onLink }) => (
  <>
    <div className="blkch-success">
      ✅ Дякую! Ви отримали +{result.pointsEarned} балів.
      {result.closed && ' Справу зведено!'}
    </div>
    {stats && (
      <p className="blkch-stats">
        Сьогодні розпізнано: {stats.todayCount} справ · Всього отримано: {stats.total} балів · Місце {stats.rank}/{stats.totalUsers}
      </p>
    )}
    <p className="blkch-text">
      Якщо тобі сподобалося — приєднуйся до Описового Блукача:
    </p>
    <ul style={{ margin: '0 0 12px 18px', padding: 0 }}>
      <li>
        <a href="https://t.me/descriptorstriderbot" target="_blank" rel="noreferrer noopener">
          Телеграм-бот
        </a>
      </li>
      <li>
        <a href="https://t.me/+qINjoMGESNwyMGYy" target="_blank" rel="noreferrer noopener">
          Спільнота Блукача
        </a>
      </li>
    </ul>
    <div className="blkch-btn-row">
      <button className="blkch-btn blkch-btn-primary" onClick={onNext}>Наступна справа</button>
      <button className="blkch-btn blkch-btn-ghost" onClick={onLink}>🔗 Привʼязати Telegram</button>
      <button className="blkch-btn blkch-btn-secondary" onClick={onClose}>Закрити</button>
    </div>
  </>
);

// ===== Linking flow =====
const LinkingView: React.FC<{ deepLink: string; onCancel: () => void }> = ({ deepLink, onCancel }) => (
  <>
    <h2 className="blkch-h1">Привʼязка до Telegram</h2>
    <p className="blkch-text">
      Якщо ваш браузер не відкрив Telegram автоматично — натисніть кнопку нижче.
      У TG-боті натисніть «Старт». Ваші бали тут будуть додані до балів у боті.
    </p>
    <p className="blkch-text">
      <a href={deepLink} target="_blank" rel="noreferrer noopener" className="blkch-btn blkch-btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
        Відкрити Telegram
      </a>
    </p>
    <p className="blkch-stats">Чекаю підтвердження з Telegram…</p>
    <button className="blkch-btn blkch-btn-secondary" onClick={onCancel}>Скасувати</button>
  </>
);

const LinkedView: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <>
    <div className="blkch-success">
      ✅ Готово! Ваші бали тепер у Telegram-боті.
    </div>
    <p className="blkch-text">
      Продовжуйте розпізнавати справи у боті — там більше функцій (розклад, рейтинги, прогрес описів).
      Тут ви теж можете брати справи, але це буде новий анонімний акаунт.
    </p>
    <div className="blkch-btn-row">
      <a
        href="https://t.me/descriptorstriderbot"
        target="_blank"
        rel="noreferrer noopener"
        className="blkch-btn blkch-btn-primary"
        style={{ textDecoration: 'none' }}
      >
        Відкрити TG-бот
      </a>
      <button className="blkch-btn blkch-btn-secondary" onClick={onClose}>Закрити</button>
    </div>
  </>
);
