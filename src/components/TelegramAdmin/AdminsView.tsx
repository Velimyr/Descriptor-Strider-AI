// Вкладка «Модератори»: список акаунтів адмінки та їхні права.
// Доступна за скоупом 'admins' — на практиці лише суперадмінам.
//
// Пароль сервер генерує сам і повертає рівно один раз (при створенні та при
// скиданні) — тут його показуємо в жовтій плашці, далі відновити неможливо.
import React, { useEffect, useState } from 'react';
import { RefreshCw, Trash2, KeyRound, Plus, AlertTriangle } from 'lucide-react';
import { ADMIN_SCOPES, ADMIN_SCOPE_LABELS, AdminScope } from '../../telegram-bot/adminScopes';
import { AdminRow, tgApi } from '../../services/telegramApi';
import { useAdminAuth } from './adminAuth';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export const AdminsView: React.FC = () => {
  const { profile } = useAdminAuth();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  // Одноразовий показ згенерованого пароля.
  const [issued, setIssued] = useState<{ login: string; password: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await tgApi.listAdmins();
      setRows(res.admins);
    } catch (e: any) {
      setErr(e?.message || 'Помилка');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const patch = async (id: string, p: Parameters<typeof tgApi.updateAdmin>[1]) => {
    setErr('');
    try {
      const res = await tgApi.updateAdmin(id, p);
      setRows(rs => rs.map(r => (r.id === id ? res.admin : r)));
    } catch (e: any) {
      setErr(e?.message || 'Помилка');
    }
  };

  const toggleScope = (row: AdminRow, scope: AdminScope) => {
    const next = row.scopes.includes(scope)
      ? row.scopes.filter(s => s !== scope)
      : [...row.scopes, scope];
    patch(row.id, { scopes: next });
  };

  const resetPassword = async (row: AdminRow) => {
    if (!confirm(`Скинути пароль для «${row.login}»? Поточний перестане працювати.`)) return;
    setErr('');
    try {
      const res = await tgApi.resetAdminPassword(row.id);
      setIssued({ login: row.login, password: res.password });
    } catch (e: any) {
      setErr(e?.message || 'Помилка');
    }
  };

  const remove = async (row: AdminRow) => {
    if (!confirm(`Видалити акаунт «${row.login}»?`)) return;
    setErr('');
    try {
      await tgApi.deleteAdmin(row.id);
      setRows(rs => rs.filter(r => r.id !== row.id));
    } catch (e: any) {
      setErr(e?.message || 'Помилка');
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">Модератори</h3>
        <button
          onClick={load}
          disabled={loading}
          className="p-1.5 hover:bg-slate-100 rounded text-slate-600 disabled:opacity-50"
          title="Оновити"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setCreating(v => !v)}
          className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm"
        >
          <Plus size={15} /> Додати модератора
        </button>
      </div>

      <div className="text-xs text-slate-500 bg-slate-50 border rounded p-3 space-y-1">
        <div>Кожна позначка — одна вкладка адмінки. Без позначок акаунт входить, але не бачить нічого.</div>
        <div>
          Ви увійшли як <b>{profile.login}</b>. Зміна прав або скидання пароля миттєво розлогінює
          того модератора — наступного разу він зайде вже з новим набором.
        </div>
      </div>

      {err && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {issued && (
        <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm space-y-2">
          <div className="font-medium">
            Пароль для «{issued.login}» — покажеться лише зараз, збережіть його:
          </div>
          <code className="block bg-white border rounded px-3 py-2 font-mono text-base select-all">
            {issued.password}
          </code>
          <button
            onClick={() => setIssued(null)}
            className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded"
          >
            Я записав
          </button>
        </div>
      )}

      {creating && (
        <CreateAdminForm
          onCancel={() => setCreating(false)}
          onCreated={(row, password) => {
            setRows(rs => [...rs, row]);
            setIssued({ login: row.login, password });
            setCreating(false);
          }}
          onError={setErr}
        />
      )}

      {rows.length === 0 && !loading && (
        <div className="text-sm text-slate-500">
          Модераторів ще немає. Ви зайшли аварійним акаунтом з env-змінних — він завжди суперадмін.
        </div>
      )}

      <div className="space-y-3">
        {rows.map(row => (
          <div key={row.id} className="border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="font-medium">{row.login}</div>
              {row.displayName && <span className="text-sm text-slate-500">{row.displayName}</span>}
              {row.isSuper && (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">суперадмін</span>
              )}
              {!row.active && (
                <span className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-600">вимкнено</span>
              )}
              <div className="flex-1" />
              <span className="text-xs text-slate-400">
                створив {row.createdBy || '—'} · вхід {fmtDate(row.lastLoginAt)}
              </span>
              <button
                onClick={() => resetPassword(row)}
                className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-slate-50"
                title="Згенерувати новий пароль"
              >
                <KeyRound size={13} /> Скинути пароль
              </button>
              <button
                onClick={() => remove(row)}
                className="p-1.5 rounded text-red-600 hover:bg-red-50"
                title="Видалити"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={row.active}
                  onChange={e => patch(row.id, { active: e.target.checked })}
                />
                Активний
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={row.isSuper}
                  onChange={e => patch(row.id, { isSuper: e.target.checked })}
                />
                Суперадмін (усі права)
              </label>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {ADMIN_SCOPES.map(s => (
                <label
                  key={s}
                  className={`flex items-center gap-1.5 text-sm ${
                    row.isSuper ? 'text-slate-400' : 'text-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={row.isSuper || row.scopes.includes(s)}
                    disabled={row.isSuper}
                    onChange={() => toggleScope(row, s)}
                  />
                  {ADMIN_SCOPE_LABELS[s]}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const CreateAdminForm: React.FC<{
  onCancel: () => void;
  onCreated: (row: AdminRow, password: string) => void;
  onError: (msg: string) => void;
}> = ({ onCancel, onCreated, onError }) => {
  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [scopes, setScopes] = useState<AdminScope[]>([]);
  const [isSuper, setIsSuper] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      const res = await tgApi.createAdmin({ login, displayName, scopes, isSuper });
      onCreated(res.admin, res.password);
    } catch (ex: any) {
      onError(ex?.message || 'Помилка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="border rounded-lg p-4 space-y-3 bg-slate-50">
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Логін</label>
          <input
            value={login}
            onChange={e => setLogin(e.target.value)}
            autoFocus
            placeholder="latynkoyu-bez-probiliv"
            className="border rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Імʼя (для себе)</label>
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={isSuper} onChange={e => setIsSuper(e.target.checked)} />
        Суперадмін (усі права, включно з керуванням модераторами)
      </label>

      {!isSuper && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ADMIN_SCOPES.map(s => (
            <label key={s} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={() =>
                  setScopes(cur => (cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]))
                }
              />
              {ADMIN_SCOPE_LABELS[s]}
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !login.trim()}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm disabled:opacity-50"
        >
          {busy ? 'Створюю…' : 'Створити'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 border rounded text-sm hover:bg-white"
        >
          Скасувати
        </button>
      </div>
    </form>
  );
};
