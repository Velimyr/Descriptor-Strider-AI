// Спільні шматки сторінки стріму /quiz: вхід ведучого, круговий таймер,
// панель рейтингу (бали спільні для вікторини й стендапу) і локальний тік часу.
import React, { useEffect, useState } from 'react';
import { Clock, Trophy } from 'lucide-react';
import { cn } from '../../lib/utils';
import { adminLogin } from '../../services/telegramApi';
import type { AdminProfile, QuizScore } from '../../services/telegramApi';

export const LoginGate: React.FC<{ onDone: (profile: AdminProfile) => void }> = ({ onDone }) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      onDone(await adminLogin(login, password, true));
    } catch (e: any) {
      setErr(e?.message || 'Помилка входу');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 p-8 bg-slate-900 rounded-2xl border border-slate-800">
        <h1 className="text-2xl font-bold text-center">🎙 Шоу Блукача</h1>
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
};

// Тік раз на 200 мс — щоб таймери йшли плавно між опитуваннями сервера.
export function useNow(intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Секунди, що лишились до ISO-моменту (0, якщо момент порожній або минув).
export function secondsUntil(endsAt: string, now: number): number {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 1000));
}

export const Timer: React.FC<{ secondsLeft: number; total: number; label?: string }> = ({
  secondsLeft,
  total,
  label,
}) => {
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
        {label && <span className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">{label}</span>}
      </div>
    </div>
  );
};

// Кнопка небезпечної дії з підтвердженням у два кліки. Навмисно без window.confirm:
// той блокує головний потік на весь час, поки діалог відкритий (браузер рахує це
// як «обробник заблокував UI» в INP), та ще й виглядає як системне вікно посеред
// стріму. Перший клік «зводить» кнопку, другий виконує; через ARM_MS сама скидається.
const ARM_MS = 4000;

export const ConfirmButton: React.FC<{
  label: string;
  armedLabel: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  onConfirm: () => void;
}> = ({ label, armedLabel, title, disabled, className, onConfirm }) => {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  return (
    <button
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      disabled={disabled}
      title={title}
      className={cn(
        'px-3 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50',
        armed
          ? 'bg-red-600 text-white hover:bg-red-500'
          : 'bg-slate-800 text-slate-400 hover:bg-red-900/60 hover:text-red-300',
        className
      )}
    >
      {armed ? armedLabel : label}
    </button>
  );
};

// Рейтинг — спільний для вікторини й стендапу.
export const Leaderboard: React.FC<{ scores: QuizScore[] }> = ({ scores }) => (
  <aside className="border-l border-slate-800 bg-slate-900/40 flex flex-col min-h-0">
    <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-2 font-bold">
      <Trophy size={18} className="text-amber-400" />
      Рейтинг
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
);
