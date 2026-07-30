// Вкладка «Вікторина»: питання з конфігу, хвилина на відповідь, стрічка
// відповідей учасників наживо. Бал отримує той, хто перший відповів правильно.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, SkipForward, RotateCcw, Square, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { tgApi } from '../../services/telegramApi';
import type { QuizAnswer, QuizLive, QuizScore } from '../../services/telegramApi';
import { ConfirmButton, Leaderboard, Timer, useNow, secondsUntil } from './shared';

const POLL_MS = 1000;

export function QuizTab() {
  const [live, setLive] = useState<QuizLive | null>(null);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  // Рейтинг сервер віддає не щоразу (лише коли міг змінитись) — тримаємо окремо.
  const [scores, setScores] = useState<QuizScore[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const sinceRef = useRef(0);
  const sessionRef = useRef('');
  // Захист від паралельних опитувань: інтервал раз на секунду може накластися на
  // повільний запит (холодний старт функції) або на poll() після дії ведучого.
  // Обидва пішли б з тим самим since і принесли б ті самі рядки двічі.
  const inFlightRef = useRef(false);

  const poll = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const since = sinceRef.current;
      const data = await tgApi.quizLive(since);
      // since === 0 (перше завантаження чи дія ведучого) — сервер віддав усю
      // стрічку сесії, тож починаємо з чистого; інакше доливаємо в наявну.
      const reset = since === 0 || data.state.sessionId !== sessionRef.current;
      sessionRef.current = data.state.sessionId;
      if (reset || data.answers.length) {
        // Зливаємо за id: навіть якщо ті самі рядки прилетять повторно, у стрічці
        // вони залишаться в однині.
        setAnswers(prev => {
          const byId = new Map<number, QuizAnswer>(
            (reset ? [] : prev).map(a => [a.id, a] as const)
          );
          for (const a of data.answers) byId.set(a.id, a);
          return [...byId.values()].sort((a, b) => a.id - b.id);
        });
      }
      if (data.answers.length) {
        sinceRef.current = Math.max(sinceRef.current, ...data.answers.map(a => a.id));
      }
      if (data.leaderboard) setScores(data.leaderboard);
      setLive(data);
      setErr('');
    } catch (e: any) {
      setErr(e?.message || 'Немає зв’язку з сервером');
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

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
  const secondsLeft = state?.status === 'running' ? secondsUntil(state.endsAt, now) : 0;
  const isOpen = !!state && state.status === 'running' && secondsLeft > 0;
  const totalSeconds = live?.config.answerSeconds || 60;

  // На екрані показуємо відповіді на ПОТОЧНЕ питання (найновіші зверху).
  const current = useMemo(() => {
    if (!state || state.status === 'idle') return [];
    return answers.filter(a => a.qIndex === state.qIndex).slice().reverse();
  }, [answers, state]);
  const winner = useMemo(() => current.find(a => a.isWinner) || null, [current]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Кнопки керування блокуються лише на час запиту (busy). За станом гри їх
          НЕ гасимо: у прямому ефірі мертва кнопка — гірше за зайвий клік, а сервер
          усе одно валідує (nextQuestion при зупиненій грі просто стартує нову). */}
      <header className="flex items-center gap-3 px-6 py-3 border-b border-slate-800 bg-slate-900/60">
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
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold disabled:opacity-40"
        >
          <SkipForward size={16} /> Наступне питання
        </button>
        <button
          onClick={() => act(() => tgApi.quizRestartTimer())}
          disabled={busy}
          title="Перезапустити таймер поточного питання"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
        >
          <RotateCcw size={16} />
        </button>
        <button
          onClick={() => act(() => tgApi.quizStop())}
          disabled={busy}
          title="Завершити вікторину"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
        >
          <Square size={16} />
        </button>
        <ConfirmButton
          label="Скинути все"
          armedLabel="Точно скинути?"
          title="Обнулити бали, стерти відповіді й зупинити вікторину"
          disabled={busy}
          onConfirm={() => act(() => tgApi.quizReset())}
        />
      </header>

      {err && <div className="px-6 py-2 bg-red-950/60 text-red-300 text-sm">{err}</div>}

      <div className="flex-1 grid grid-cols-[1fr_360px] min-h-0">
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

        <Leaderboard scores={scores} />
      </div>
    </div>
  );
}

const AnswerRow: React.FC<{ a: QuizAnswer }> = ({ a }) => (
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
