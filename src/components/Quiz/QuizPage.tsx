// Сторінка вікторини для стріму (/quiz). Ведучий показує її на екрані:
// «Запустити вікторину» / «Наступне питання», таймер на відповідь, стрічка
// відповідей учасників наживо і рейтинг за балами вікторини.
// Доступ — за адмін-логіном (той самий, що й у адмінці бота).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, SkipForward, RotateCcw, Square, Trophy, Clock, Check, X, LogOut } from 'lucide-react';
import { cn } from '../../lib/utils';
import { adminLogin, clearAdminSecret, getAdminSecret, tgApi } from '../../services/telegramApi';
import type { QuizAnswer, QuizLive, QuizScore } from '../../services/telegramApi';

const POLL_MS = 1000;

const LoginGate: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await adminLogin(login, password, true);
      onDone();
    } catch (e: any) {
      setErr(e?.message || 'Помилка входу');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 p-8 bg-slate-900 rounded-2xl border border-slate-800">
        <h1 className="text-2xl font-bold text-center">🎙 Вікторина</h1>
        <p className="text-sm text-slate-400 text-center">Вхід для ведучого</p>
        <input
          value={login}
          onChange={e => setLogin(e.target.value)}
          placeholder="Логін"
          className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 outline-none focus:border-indigo-500"
        />
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Пароль"
          className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 outline-none focus:border-indigo-500"
        />
        {err && <div className="text-sm text-red-400">{err}</div>}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold disabled:opacity-50"
        >
          {busy ? 'Вхід…' : 'Увійти'}
        </button>
      </form>
    </div>
  );
}

export function QuizPage() {
  const [authed, setAuthed] = useState(() => !!getAdminSecret());
  const [live, setLive] = useState<QuizLive | null>(null);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  // Рейтинг сервер віддає не щоразу (лише коли міг змінитись) — тримаємо окремо.
  const [scores, setScores] = useState<QuizScore[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Локальний тик — щоб таймер йшов плавно між опитуваннями сервера.
  const [now, setNow] = useState(() => Date.now());
  const sinceRef = useRef(0);
  const sessionRef = useRef('');

  const poll = useCallback(async () => {
    try {
      const since = sinceRef.current;
      const data = await tgApi.quizLive(since);
      // since === 0 (перше завантаження чи дія ведучого) — сервер віддав усю
      // стрічку сесії, тож замінюємо; інакше добираємо лише нові рядки.
      if (since === 0 || data.state.sessionId !== sessionRef.current) {
        sessionRef.current = data.state.sessionId;
        setAnswers(data.answers);
      } else if (data.answers.length) {
        setAnswers(prev => [...prev, ...data.answers]);
      }
      if (data.answers.length) {
        sinceRef.current = Math.max(sinceRef.current, ...data.answers.map(a => a.id));
      }
      if (data.leaderboard) setScores(data.leaderboard);
      setLive(data);
      setErr('');
    } catch (e: any) {
      setErr(e?.message || 'Немає зв’язку з сервером');
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [authed, poll]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      sinceRef.current = 0;
      sessionRef.current = '';
      await poll();
    } catch (e: any) {
      setErr(e?.message || 'Помилка');
    } finally {
      setBusy(false);
    }
  };

  const state = live?.state;
  const question = live?.question || null;

  // Секунди рахуємо локально від ends_at — сервер лише синхронізує.
  const secondsLeft = useMemo(() => {
    if (!state || state.status !== 'running' || !state.endsAt) return 0;
    return Math.max(0, Math.ceil((new Date(state.endsAt).getTime() - now) / 1000));
  }, [state, now]);
  const isOpen = !!state && state.status === 'running' && secondsLeft > 0;
  const totalSeconds = live?.config.answerSeconds || 60;

  // На екрані показуємо відповіді на ПОТОЧНЕ питання (найновіші зверху).
  const current = useMemo(() => {
    if (!state || state.status === 'idle') return [];
    return answers.filter(a => a.qIndex === state.qIndex).slice().reverse();
  }, [answers, state]);
  const winner = useMemo(() => current.find(a => a.isWinner) || null, [current]);

  if (!authed) return <LoginGate onDone={() => setAuthed(true)} />;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Шапка: статус, таймер, керування */}
      <header className="flex items-center gap-4 px-6 py-3 border-b border-slate-800 bg-slate-900/60">
        <div className="text-xl font-black tracking-tight">🎙 Вікторина</div>
        {state && state.status !== 'idle' && (
          <div className="text-sm font-semibold text-slate-400">
            Питання {state.qIndex + 1} з {state.total}
          </div>
        )}
        <div className="flex-1" />
        {/* «Запустити» — лише поки вікторина не йде. Під час гри лишається
            «Наступне питання», щоб не запустити все з нуля випадковим кліком. */}
        {(!state || state.status !== 'running') && (
          <button
            onClick={() => act(() => tgApi.quizStart())}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold disabled:opacity-50"
          >
            <Play size={16} /> {state?.status === 'finished' ? 'Почати заново' : 'Запустити вікторину'}
          </button>
        )}
        <button
          onClick={() => act(() => tgApi.quizNext())}
          disabled={busy || !state || state.status !== 'running'}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold disabled:opacity-40"
        >
          <SkipForward size={16} /> Наступне питання
        </button>
        <button
          onClick={() => act(() => tgApi.quizRestartTimer())}
          disabled={busy || !state || state.status === 'idle'}
          title="Перезапустити таймер поточного питання"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
        >
          <RotateCcw size={16} />
        </button>
        <button
          onClick={() => act(() => tgApi.quizStop())}
          disabled={busy || !state || state.status !== 'running'}
          title="Завершити вікторину"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
        >
          <Square size={16} />
        </button>
        <button
          onClick={() => {
            if (confirm('Обнулити ВСІ бали вікторини? Це неможливо скасувати.')) {
              act(() => tgApi.quizResetScores());
            }
          }}
          disabled={busy}
          title="Обнулити бали вікторини"
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-red-900/60 text-slate-400 hover:text-red-300 text-xs font-bold"
        >
          Обнулити бали
        </button>
        <button
          onClick={() => {
            clearAdminSecret();
            setAuthed(false);
          }}
          title="Вийти"
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400"
        >
          <LogOut size={16} />
        </button>
      </header>

      {err && <div className="px-6 py-2 bg-red-950/60 text-red-300 text-sm">{err}</div>}

      <div className="flex-1 grid grid-cols-[1fr_360px] min-h-0">
        {/* Ліва частина: питання + таймер + відповіді */}
        <div className="flex flex-col min-h-0">
          <div className="px-10 py-8 border-b border-slate-800">
            {!state || state.status === 'idle' ? (
              <div className="text-3xl font-bold text-slate-500 text-center py-16">
                Натисніть «Запустити вікторину»
              </div>
            ) : state.status === 'finished' ? (
              <div className="text-4xl font-black text-center py-12">🏁 Вікторину завершено!</div>
            ) : (
              <>
                <div className="flex items-start gap-8">
                  <div className="flex-1 text-4xl xl:text-5xl font-black leading-tight">
                    {question?.text}
                  </div>
                  <Timer secondsLeft={secondsLeft} total={totalSeconds} />
                </div>
                {!isOpen && (
                  <div className="mt-6 flex flex-wrap items-center gap-4">
                    <div className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold">
                      ⏳ Час вийшов
                    </div>
                    <div className="px-4 py-2 rounded-xl bg-emerald-950 text-emerald-300 font-semibold">
                      Відповідь: {question?.answer || '—'}
                    </div>
                    {winner ? (
                      <div className="px-4 py-2 rounded-xl bg-amber-500/15 text-amber-300 font-bold">
                        🥇 Перший: {winner.displayName || '—'}
                      </div>
                    ) : (
                      <div className="px-4 py-2 rounded-xl bg-slate-800 text-slate-400 font-semibold">
                        Ніхто не вгадав
                      </div>
                    )}
                  </div>
                )}
                {isOpen && winner && (
                  <div className="mt-6 px-4 py-2 inline-block rounded-xl bg-amber-500/15 text-amber-300 font-bold">
                    🥇 Перший правильно: {winner.displayName || '—'}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Стрічка відповідей */}
          <div className="flex-1 overflow-y-auto px-10 py-6 space-y-2">
            {current.length === 0 ? (
              <div className="text-slate-600 text-lg">
                {isOpen ? 'Чекаємо на відповіді в боті…' : 'Відповідей не було'}
              </div>
            ) : (
              current.map(a => <AnswerRow key={a.id} a={a} />)
            )}
          </div>
        </div>

        {/* Права колонка: рейтинг вікторини */}
        <aside className="border-l border-slate-800 bg-slate-900/40 flex flex-col min-h-0">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-2 font-bold">
            <Trophy size={18} className="text-amber-400" />
            Рейтинг вікторини
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {scores.length === 0 ? (
              <div className="text-slate-600 text-sm p-2">Балів ще немає</div>
            ) : (
              scores.map((r, i) => (
                <div
                  key={r.tgId}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-xl',
                    i === 0 ? 'bg-amber-500/15' : 'bg-slate-800/60'
                  )}
                >
                  <span className="w-7 text-center font-black text-slate-400">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>
                  <span className="flex-1 truncate font-semibold">{r.displayName || '—'}</span>
                  <span className="font-black text-lg">{r.points}</span>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

const Timer: React.FC<{ secondsLeft: number; total: number }> = ({ secondsLeft, total }) => {
  const pct = total > 0 ? Math.max(0, Math.min(1, secondsLeft / total)) : 0;
  const danger = secondsLeft > 0 && secondsLeft <= 10;
  return (
    <div className="shrink-0 relative w-32 h-32">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="45" className="stroke-slate-800" strokeWidth="8" fill="none" />
        <circle
          cx="50"
          cy="50"
          r="45"
          className={cn('transition-all duration-200', danger ? 'stroke-red-500' : 'stroke-indigo-500')}
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={2 * Math.PI * 45}
          strokeDashoffset={2 * Math.PI * 45 * (1 - pct)}
        />
      </svg>
      <div
        className={cn(
          'absolute inset-0 flex flex-col items-center justify-center font-black',
          danger ? 'text-red-400' : 'text-slate-100'
        )}
      >
        <Clock size={14} className="opacity-50" />
        <span className="text-4xl leading-none">{secondsLeft}</span>
      </div>
    </div>
  );
}

const AnswerRow: React.FC<{ a: QuizAnswer }> = ({ a }) => {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 rounded-xl text-lg',
        a.isWinner
          ? 'bg-amber-500/15 border border-amber-500/40'
          : a.isCorrect
            ? 'bg-emerald-900/30'
            : 'bg-slate-900/60'
      )}
    >
      <span className="w-6 shrink-0">
        {a.isWinner ? (
          <span className="text-xl">🥇</span>
        ) : a.isCorrect ? (
          <Check size={18} className="text-emerald-400" />
        ) : (
          <X size={18} className="text-slate-600" />
        )}
      </span>
      <span className="font-bold w-48 truncate">{a.displayName || '—'}</span>
      <span className={cn('flex-1 truncate', a.isCorrect ? 'text-slate-100' : 'text-slate-400')}>
        {a.answer}
      </span>
      <span className="text-xs text-slate-600 tabular-nums">
        {new Date(a.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  );
}
