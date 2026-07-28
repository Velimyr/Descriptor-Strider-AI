// Вкладка «Архівний стендап»: тема на екрані, хвилина на жарт, черга охочих
// (клік по картці = виклик на сцену), голосування лайками в боті.
// Хто набрав найбільше лайків у раунді — отримує бали в спільний рейтинг шоу.
import React, { useCallback, useEffect, useState } from 'react';
import { Play, SkipForward, RotateCcw, Square, Timer as TimerIcon, Users } from 'lucide-react';
import { cn } from '../../lib/utils';
import { tgApi, userPhotoUrl } from '../../services/telegramApi';
import type { StandupLive, StandupSignup } from '../../services/telegramApi';
import { Leaderboard, Timer, useNow, secondsUntil } from './shared';

const POLL_MS = 1000;

export function StandupTab() {
  const [live, setLive] = useState<StandupLive | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useNow();

  const poll = useCallback(async () => {
    try {
      setLive(await tgApi.standupLive());
      setErr('');
    } catch (e: any) {
      setErr(e?.message || 'Немає зв’язку з сервером');
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
      await poll();
    } catch (e: any) {
      setErr(e?.message || 'Помилка');
    } finally {
      setBusy(false);
    }
  };

  const state = live?.state;
  const question = live?.question || null;
  const signups = live?.signups || [];
  const running = state?.status === 'running';
  const performer = signups.find(s => s.tgId === state?.performerTgId) || null;
  const secondsLeft = state ? secondsUntil(state.endsAt, now) : 0;
  const thinkTotal = live?.config.thinkSeconds || 60;
  const voteTotal = live?.config.voteSeconds || 60;
  const onStage = running && state?.phase === 'performing' && !!performer;
  const voteOpen = onStage && (!state?.endsAt || secondsLeft > 0);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-slate-800 bg-slate-900/60">
        {state && state.status !== 'idle' && (
          <div className="text-sm font-semibold text-slate-400">
            Тема {state.qIndex + 1} з {state.total}
            {live?.config.pointsPerWin ? ` · +${live.config.pointsPerWin} за перемогу` : ''}
          </div>
        )}
        <div className="flex-1" />
        {!running && (
          <button
            onClick={() => act(() => tgApi.standupStart())}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold disabled:opacity-50"
          >
            <Play size={16} /> {state?.status === 'finished' ? 'Почати заново' : 'Запустити стендап'}
          </button>
        )}
        {onStage && (
          <button
            onClick={() => act(() => tgApi.standupVoteTimer())}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 font-semibold disabled:opacity-50"
          >
            <TimerIcon size={16} /> Хвилина на голосування
          </button>
        )}
        <button
          onClick={() => act(() => tgApi.standupNext())}
          disabled={busy || !running}
          title="Закрити раунд (нарахувати бали) і перейти до наступної теми"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold disabled:opacity-40"
        >
          <SkipForward size={16} /> Наступна тема
        </button>
        <button
          onClick={() => act(() => tgApi.standupRestartThinking())}
          disabled={busy || !running}
          title="Повернутись до хвилини на вигадування"
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
        >
          <RotateCcw size={16} />
        </button>
        <button
          onClick={() => act(() => tgApi.standupStop())}
          disabled={busy || !running}
          title="Завершити стендап (з нарахуванням за поточний раунд)"
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
        >
          <Square size={16} />
        </button>
        <button
          onClick={() => {
            if (confirm('Скинути стендап: стерти черги, лайки й підсумки раундів? Бали залишаться.')) {
              act(() => tgApi.standupReset());
            }
          }}
          disabled={busy}
          title="Стерти черги, лайки й підсумки раундів (бали не чіпає)"
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-red-900/60 text-slate-400 hover:text-red-300 text-xs font-bold"
        >
          Скинути стендап
        </button>
      </header>

      {err && <div className="px-6 py-2 bg-red-950/60 text-red-300 text-sm">{err}</div>}

      <div className="flex-1 grid grid-cols-[1fr_360px] min-h-0">
        <div className="flex flex-col min-h-0">
          {/* Сцена */}
          <div className="px-10 py-8 border-b border-slate-800">
            {!state || state.status === 'idle' ? (
              <div className="text-3xl font-bold text-slate-500 text-center py-16">
                Натисніть «Запустити стендап»
              </div>
            ) : state.status === 'finished' ? (
              <div className="text-4xl font-black text-center py-12">🎤 Стендап завершено!</div>
            ) : onStage && performer ? (
              <div className="flex items-center gap-8">
                <PerformerPhoto key={performer.tgId} signup={performer} />
                <div className="flex-1 min-w-0">
                  <div className="text-2xl xl:text-3xl font-bold text-slate-300 leading-snug">
                    {question?.text}
                  </div>
                  <div className="mt-4 text-4xl xl:text-5xl font-black">
                    Відповідає {performer.displayName || '—'}…
                  </div>
                  <div className="mt-3 text-xl text-amber-300 font-semibold">
                    Оцініть його відповідь у боті — кнопка «😂 Зайшло!»
                  </div>
                  <div className="mt-4 flex items-center gap-4">
                    <div className="px-5 py-2 rounded-2xl bg-amber-500/15 text-amber-300 text-2xl font-black">
                      😂 {performer.likes}
                    </div>
                    <span className={cn('text-sm font-bold', voteOpen ? 'text-emerald-400' : 'text-slate-500')}>
                      {voteOpen ? 'голосування відкрите' : 'голосування закрите'}
                    </span>
                  </div>
                </div>
                {state.endsAt && <Timer secondsLeft={secondsLeft} total={voteTotal} label="голос" />}
              </div>
            ) : (
              <div className="flex items-start gap-8">
                <div className="flex-1 text-4xl xl:text-5xl font-black leading-tight">{question?.text}</div>
                <Timer secondsLeft={secondsLeft} total={thinkTotal} label="на жарт" />
              </div>
            )}
          </div>

          {/* Черга охочих виступити */}
          <div className="flex-1 overflow-y-auto px-10 py-6">
            <div className="flex items-center gap-2 text-slate-400 font-bold mb-4">
              <Users size={16} />
              Черга на сцену ({signups.length})
              {running && <span className="text-slate-600 font-normal">— клікніть, щоб викликати</span>}
            </div>
            {signups.length === 0 ? (
              <div className="text-slate-600 text-lg">
                {running ? 'Ще ніхто не записався…' : 'Черга порожня'}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {signups.map(s => (
                  <SignupCard
                    key={s.tgId}
                    s={s}
                    active={s.tgId === state?.performerTgId}
                    disabled={busy || !running}
                    onCall={() => act(() => tgApi.standupCall(s.tgId))}
                  />
                ))}
              </div>
            )}

            {/* Підсумки вже зіграних раундів */}
            {(live?.rounds || []).length > 0 && (
              <div className="mt-8">
                <div className="text-slate-400 font-bold mb-3">Підсумки раундів</div>
                <div className="space-y-1.5">
                  {live!.rounds.map(r => (
                    <div key={r.qIndex} className="flex items-center gap-3 text-slate-300">
                      <span className="text-slate-500 font-bold w-20">Тема {r.qIndex + 1}</span>
                      <span className="flex-1">
                        {r.winners.length === 0
                          ? '— ніхто не набрав лайків'
                          : r.winners.map(w => `🏆 ${w.displayName || '—'} (${w.likes})`).join(' · ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <Leaderboard scores={live?.leaderboard || []} />
      </div>
    </div>
  );
}

// Фото учасника: спершу з профілю бота, далі — аватар Telegram (це вирішує
// сервер). Прапорець hasPhoto навмисно не перевіряємо: він фіксується в мить
// запису й нічого не знає про аватар — просто пробуємо завантажити.
const PerformerPhoto: React.FC<{ signup: StandupSignup }> = ({ signup }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="shrink-0 w-40 h-40 rounded-3xl bg-slate-800 flex items-center justify-center text-6xl font-black text-slate-600">
        {(signup.displayName || '?').trim().charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={userPhotoUrl(signup.tgId)}
      alt={signup.displayName}
      onError={() => setFailed(true)}
      className="shrink-0 w-40 h-40 rounded-3xl object-cover border-2 border-amber-500/40"
    />
  );
};

const SignupCard: React.FC<{
  s: StandupSignup;
  active: boolean;
  disabled: boolean;
  onCall: () => void;
}> = ({ s, active, disabled, onCall }) => (
  <button
    onClick={onCall}
    disabled={disabled}
    className={cn(
      'flex items-center gap-3 p-3 rounded-2xl border text-left transition-colors disabled:opacity-60',
      active
        ? 'bg-amber-500/15 border-amber-500/50'
        : s.performed
          ? 'bg-slate-900/60 border-slate-800 text-slate-500'
          : 'bg-slate-800/60 border-slate-700 hover:bg-slate-700/60'
    )}
  >
    <span
      className={cn(
        'w-10 h-10 rounded-xl flex items-center justify-center font-black shrink-0',
        active ? 'bg-amber-500/30 text-amber-200' : 'bg-slate-700 text-slate-300'
      )}
    >
      {(s.displayName || '?').trim().charAt(0).toUpperCase()}
    </span>
    <span className="flex-1 min-w-0">
      <span className="block truncate font-bold">{s.displayName || '—'}</span>
      <span className="block text-xs text-slate-500">
        {active ? 'на сцені' : s.performed ? 'уже виступив' : 'чекає'}
      </span>
    </span>
    {s.likes > 0 && <span className="font-black text-amber-300 shrink-0">😂 {s.likes}</span>}
  </button>
);
