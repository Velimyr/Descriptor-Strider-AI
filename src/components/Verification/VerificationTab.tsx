import React, { useEffect, useRef, useState } from 'react';
import { Loader2, LogOut, User as UserIcon, Award, Pencil, X, Check, Send } from 'lucide-react';
import * as verifApi from '../../services/verifApi';
import type { VerifProfile, VerifConfig } from '../../services/verifApi';
import { VerificationWorkspace } from './VerificationWorkspace';

// Вхід через бота: створюємо одноразовий код, відкриваємо t.me/<bot>?start=login_<code>,
// опитуємо статус, поки користувач не натисне Старт у боті. Надійніше за Login Widget
// (не залежить від oauth.telegram.org / cookies / підтвердження телефоном).
const BotLoginButton: React.FC<{ onLoggedIn: () => void }> = ({ onLoggedIn }) => {
  const [waiting, setWaiting] = useState(false);
  const [deepLink, setDeepLink] = useState('');
  const [err, setErr] = useState('');
  const pollRef = useRef<number | null>(null);

  const stop = () => {
    if (pollRef.current) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => () => stop(), []);

  const start = async () => {
    setErr('');
    try {
      const r = await verifApi.loginStart();
      setDeepLink(r.deep_link);
      window.open(r.deep_link, '_blank');
      setWaiting(true);
      const deadline = Date.now() + 3 * 60 * 1000;
      const tick = async () => {
        try {
          const s = await verifApi.loginStatus(r.code);
          if (s.status === 'completed') {
            stop();
            setWaiting(false);
            onLoggedIn();
            return;
          }
          if (s.status === 'expired' || s.status === 'unknown') {
            stop();
            setWaiting(false);
            setErr('Код входу прострочено. Спробуйте ще раз.');
            return;
          }
        } catch {
          /* мережева похибка — продовжуємо опитування */
        }
        if (Date.now() > deadline) {
          stop();
          setWaiting(false);
          setErr('Час очікування вийшов. Спробуйте ще раз.');
          return;
        }
        pollRef.current = window.setTimeout(tick, 2000);
      };
      pollRef.current = window.setTimeout(tick, 2000);
    } catch {
      setErr('Не вдалося почати вхід. Спробуйте ще раз.');
    }
  };

  if (waiting) {
    return (
      <div className="flex flex-col items-center gap-2 text-sm text-slate-600">
        <span className="flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Очікуємо підтвердження в боті…
        </span>
        <a href={deepLink} target="_blank" rel="noreferrer" className="text-[#229ED9] hover:underline">
          Відкрити бота ще раз
        </a>
        {err && <span className="text-red-600">{err}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={start}
        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#229ED9] hover:bg-[#1d8bbf] text-white rounded-lg font-bold shadow-sm"
      >
        <Send size={18} /> Увійти через Telegram
      </button>
      {err && <span className="text-sm text-red-600">{err}</span>}
    </div>
  );
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

      <VerificationWorkspace opysBaseUrl={config?.opys_base_url} />

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

        <div className="flex flex-col items-center gap-2">
          <BotLoginButton onLoggedIn={onLoggedIn} />
          <span className="text-[11px] text-slate-400">Бали зберігаються у спільному рейтингу з ботом</span>
        </div>

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
  // Завжди тягнемо свіжий профіль при відкритті — щоб бали/місце були актуальні
  // (інакше показувало б стан на момент логіну, доки не оновиш сторінку).
  const [profile, setProfile] = useState<VerifProfile>(user);
  useEffect(() => {
    let alive = true;
    verifApi.getMe().then(p => { if (alive) setProfile(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await verifApi.rename(nick.trim());
      await onChanged();
      try { setProfile(await verifApi.getMe()); } catch {/* ignore */}
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
              <button onClick={() => { setEditing(false); setNick(profile.nickname); setErr(''); }}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600">
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold text-slate-800">{profile.nickname}</span>
              <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700">
                <Pencil size={14} /> Змінити
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-lg font-bold text-slate-800">{profile.total}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Балів</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-lg font-bold text-slate-800">#{profile.rank}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Місце</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-lg font-bold text-slate-800 flex items-center justify-center gap-1">
              <Award size={16} className="text-amber-500" />{profile.badges.length}
            </div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Бейджів</div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100">
          {profile.linked_telegram ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <Check size={16} /> Звʼязано з Telegram
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-slate-600">Привʼяжіть Telegram, щоб не втратити бали:</div>
              <BotLoginButton onLoggedIn={onRelinked} />
            </div>
          )}
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}
      </div>
    </div>
  );
};
