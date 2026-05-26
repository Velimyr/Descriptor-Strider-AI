import React, { useEffect, useRef, useState } from 'react';
import { Loader2, LogOut, User as UserIcon, Award, Pencil, X, Check } from 'lucide-react';
import * as verifApi from '../../services/verifApi';
import type { VerifProfile, VerifConfig } from '../../services/verifApi';
import { VerificationWorkspace } from './VerificationWorkspace';

// Кнопка офіційного Telegram Login Widget у REDIRECT-режимі (data-auth-url):
// Telegram робить повний top-level перехід на наш серверний колбек із параметрами
// профілю — без popup/iframe/сторонніх cookies (надійніше за callback-режим).
// `anon` — токен поточної анонімної сесії (для мержу балів при привʼязці).
const TelegramLoginButton: React.FC<{ botUsername: string }> = ({ botUsername }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.innerHTML = '';
    const anon = verifApi.getToken();
    const authUrl =
      `${window.location.origin}/api/verif/auth/telegram/callback` +
      (anon ? `?anon=${encodeURIComponent(anon)}` : '');
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.async = true;
    s.setAttribute('data-telegram-login', botUsername);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-radius', '8');
    s.setAttribute('data-auth-url', authUrl);
    s.setAttribute('data-request-access', 'write');
    container.appendChild(s);
    return () => {
      if (container) container.innerHTML = '';
    };
  }, [botUsername]);

  return <div ref={ref} />;
};

const errText = (code?: string): string => {
  switch (code) {
    case 'nickname_taken': return 'Цей нік уже зайнятий — оберіть інший.';
    case 'nickname_too_short': return 'Нік має містити щонайменше 2 символи.';
    case 'invalid_telegram_signature': return 'Не вдалося підтвердити вхід через Telegram.';
    default: return 'Сталася помилка. Спробуйте ще раз.';
  }
};

export const VerificationTab: React.FC = () => {
  const [user, setUser] = useState<VerifProfile | null>(null);
  const [config, setConfig] = useState<VerifConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCabinet, setShowCabinet] = useState(false);

  const refreshMe = async () => {
    try {
      const me = await verifApi.getMe();
      setUser(me);
    } catch (e: any) {
      if (e?.status === 401) verifApi.clearToken();
      setUser(null);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        setConfig(await verifApi.getConfig());
      } catch {/* ignore */}
      if (verifApi.getToken()) await refreshMe();
      setLoading(false);
    })();
  }, []);

  const onLoggedIn = async () => {
    setLoading(true);
    await refreshMe();
    setLoading(false);
  };

  const logout = () => {
    verifApi.clearToken();
    setUser(null);
    setShowCabinet(false);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (!user) {
    return <AuthGate config={config} onLoggedIn={onLoggedIn} />;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="text-sm text-slate-500">Ви увійшли як</div>
          <div className="text-xl font-bold flex items-center gap-2">
            <UserIcon size={18} className="text-indigo-600" />
            {user.nickname}
            {!user.linked_telegram && (
              <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                без Telegram
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCabinet(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-sm font-medium shadow-sm"
          >
            <UserIcon size={16} /> Кабінет
          </button>
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-sm font-medium shadow-sm"
          >
            <LogOut size={16} /> Вийти
          </button>
        </div>
      </div>

      <VerificationWorkspace />

      {showCabinet && (
        <CabinetModal
          user={user}
          config={config}
          onClose={() => setShowCabinet(false)}
          onChanged={refreshMe}
          onRelinked={onLoggedIn}
        />
      )}
    </div>
  );
};

const AuthGate: React.FC<{ config: VerifConfig | null; onLoggedIn: () => void }> = ({ config, onLoggedIn }) => {
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const e = sessionStorage.getItem('verif_login_error');
    if (e) {
      setErr(errText(e));
      sessionStorage.removeItem('verif_login_error');
    }
  }, []);

  const doRegister = async () => {
    setBusy(true);
    setErr('');
    try {
      await verifApi.register(nick.trim());
      await onLoggedIn();
    } catch (e: any) {
      setErr(errText(e?.code));
    } finally {
      setBusy(false);
    }
  };

  const onDev = async () => {
    setBusy(true);
    setErr('');
    try {
      await verifApi.authDev();
      await onLoggedIn();
    } catch (e: any) {
      setErr(errText(e?.code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-700">Вхід до перевірки</h2>
          <p className="text-sm text-slate-500 mt-1">
            Щоб перевіряти справи й отримувати бали, увійдіть або зареєструйтесь.
          </p>
        </div>

        {config?.tg_bot_username && (
          <div className="flex flex-col items-center gap-2">
            <TelegramLoginButton botUsername={config.tg_bot_username} />
            <span className="text-[11px] text-slate-400">Бали зберігаються у спільному рейтингу з ботом</span>
          </div>
        )}

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <div className="flex-1 h-px bg-slate-200" />
          або зареєструйтесь ніком
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        <div className="space-y-2">
          <input
            value={nick}
            onChange={e => setNick(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && nick.trim().length >= 2 && !busy) doRegister(); }}
            placeholder="Ваш нік для рейтингу"
            maxLength={40}
            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <button
            onClick={doRegister}
            disabled={busy || nick.trim().length < 2}
            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg font-bold transition-colors"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : null}
            Зареєструватися
          </button>
        </div>

        {config?.dev_login && (
          <button
            onClick={onDev}
            disabled={busy}
            className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 border border-dashed border-slate-200 rounded-lg"
          >
            DEV-вхід (локальна розробка)
          </button>
        )}

        {err && <div className="text-sm text-red-600 text-center">{err}</div>}
      </div>
    </div>
  );
};

const CabinetModal: React.FC<{
  user: VerifProfile;
  config: VerifConfig | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onRelinked: () => void;
}> = ({ user, config, onClose, onChanged, onRelinked }) => {
  const [editing, setEditing] = useState(false);
  const [nick, setNick] = useState(user.nickname);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await verifApi.rename(nick.trim());
      await onChanged();
      setEditing(false);
    } catch (e: any) {
      setErr(errText(e?.code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-700">Особистий кабінет</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded text-slate-500">
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Імʼя для рейтингу</label>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={nick}
                onChange={e => setNick(e.target.value)}
                maxLength={40}
                className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <button onClick={save} disabled={busy || nick.trim().length < 2}
                className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              </button>
              <button onClick={() => { setEditing(false); setNick(user.nickname); setErr(''); }}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600">
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold text-slate-800">{user.nickname}</span>
              <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700">
                <Pencil size={14} /> Змінити
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-lg font-bold text-slate-800">{user.total}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Балів</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-lg font-bold text-slate-800">#{user.rank}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Місце</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-lg font-bold text-slate-800 flex items-center justify-center gap-1">
              <Award size={16} className="text-amber-500" />{user.badges.length}
            </div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Бейджів</div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100">
          {user.linked_telegram ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <Check size={16} /> Звʼязано з Telegram
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-slate-600">Привʼяжіть Telegram, щоб не втратити бали:</div>
              {config?.tg_bot_username && (
                <TelegramLoginButton botUsername={config.tg_bot_username} />
              )}
            </div>
          )}
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}
      </div>
    </div>
  );
};
