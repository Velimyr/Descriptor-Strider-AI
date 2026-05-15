import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, RefreshCw, Save, UploadCloud, Wand2, Trash2, Plus } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import { TableColumn } from '../../types';
import { tgApi, getAdminSecret, clearAdminSecret, adminLogin } from '../../services/telegramApi';
import { createDefaultColumns, createColumn, COLUMN_ROLE_LABELS, COLUMN_ROLE_OPTIONS, inferColumnRole } from '../../lib/tableColumns';
import { detectViaGemini } from '../../lib/sliceDetection';

interface Props {
  onClose: () => void;
  geminiKey: string;
  initialQuestions?: TableColumn[]; // зазвичай tableStructure активного проєкту
}

type TabKey = 'setup' | 'questions' | 'cases' | 'results' | 'process' | 'overview' | 'integrity';

export const TelegramAdminTab: React.FC<Props> = ({ onClose, geminiKey, initialQuestions }) => {
  const [tab, setTab] = useState<TabKey>('setup');
  const [authed, setAuthed] = useState<boolean>(!!getAdminSecret());

  if (!authed) {
    return <LoginGate onSuccess={() => setAuthed(true)} onClose={onClose} />;
  }

  const logout = () => {
    clearAdminSecret();
    setAuthed(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-bold text-lg">Telegram-бот — адмінка</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={logout} className="px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 rounded">
            Вийти
          </button>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>
      </header>

      <nav className="flex border-b bg-slate-50">
        {([
          ['setup', 'Налаштування'],
          ['questions', 'Питання'],
          ['cases', 'Підготовка справ'],
          ['results', 'Результати'],
          ['process', 'Експортувати опис'],
          ['overview', 'Огляд'],
          ['integrity', 'Перевірка доброчесності'],
        ] as [TabKey, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === k ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'setup' && <SetupView />}
        {tab === 'questions' && <QuestionsView initialQuestions={initialQuestions} />}
        {tab === 'cases' && <CasesView geminiKey={geminiKey} mode="admin" />}
        {tab === 'results' && <ResultsView />}
        {tab === 'process' && <ProcessDescriptionView geminiKey={geminiKey} />}
        {tab === 'overview' && <OverviewView />}
        {tab === 'integrity' && <IntegrityView />}
      </div>
    </div>
  );
};

// ==================== LOGIN GATE ====================

const LoginGate: React.FC<{ onSuccess: () => void; onClose: () => void }> = ({ onSuccess, onClose }) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await adminLogin(login, password, remember);
      onSuccess();
    } catch (ex: any) {
      setErr(ex.message || 'Помилка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-100 flex items-center justify-center">
      <form onSubmit={submit} className="bg-white border rounded-lg shadow-lg p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg">Вхід в адмінку</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Логін</label>
          <input
            value={login}
            onChange={e => setLogin(e.target.value)}
            autoFocus
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Пароль</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          Запамʼятати на цьому пристрої
        </label>
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <button
          type="submit"
          disabled={busy || !login || !password}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Перевіряю…' : 'Увійти'}
        </button>
      </form>
    </div>
  );
};

// ==================== SETUP ====================

const SetupView: React.FC = () => {
  const [health, setHealth] = useState<any>(null);
  const [dbCheck, setDbCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  // Collab-режим: налаштування (ключі з bot_meta).
  const [minConfirmations, setMinConfirmations] = useState('');
  const [collabLockMinutes, setCollabLockMinutes] = useState('');
  const [metaSavedKey, setMetaSavedKey] = useState('');

  const refresh = async () => {
    try {
      setBusy(true);
      const [h, db, m] = await Promise.all([
        tgApi.health(),
        tgApi.checkDb().catch(e => ({ ok: false, error: e.message })),
        tgApi.getMeta().catch(() => ({ meta: {} })),
      ]);
      setHealth(h);
      setDbCheck(db);
      setMinConfirmations(m?.meta?.min_confirmations || '3');
      setCollabLockMinutes(m?.meta?.collab_lock_minutes || '30');
    } catch {
      setHealth(null);
    } finally {
      setBusy(false);
    }
  };

  const saveMeta = async (key: string, value: string) => {
    setMetaSavedKey('');
    try {
      await tgApi.setMeta(key, value);
      setMetaSavedKey(key);
      setTimeout(() => setMetaSavedKey(c => (c === key ? '' : c)), 2000);
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const allEnvOk = health?.env && Object.values(health.env).every(Boolean);
  const dbOk = dbCheck?.ok === true;

  const initialize = async () => {
    setBusy(true);
    setMsg('');
    try {
      const url = `${window.location.origin}/api/telegram/webhook`;
      await tgApi.setWebhook(url);
      setMsg(`✅ Webhook встановлено: ${url}`);
      await refresh();
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Статус */}
      {health && (
        <section className="border rounded p-3 bg-slate-50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {allEnvOk ? '✅ Усі env-змінні на місці' : '⚠ Не вистачає env-змінних'}
            </span>
            <button onClick={() => setShowDetails(s => !s)} className="text-xs text-indigo-600">
              {showDetails ? 'Сховати' : 'Деталі'}
            </button>
          </div>
          {showDetails && (
            <div className="text-xs grid grid-cols-2 gap-1">
              {Object.entries(health.env).map(([k, v]) => (
                <div key={k}>
                  <span className={v ? 'text-green-600' : 'text-red-600'}>{v ? '✓' : '✗'}</span> <code>{k}</code>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Стан Supabase */}
      {dbCheck && (
        <section className="border rounded p-3 bg-slate-50 space-y-1 text-sm">
          <div className="font-medium">
            {dbOk ? '✅ Supabase: схема на місці' : '❌ Supabase: проблема'}
          </div>
          {!dbOk && dbCheck.error && (
            <div className="text-red-600 text-xs">{dbCheck.error}</div>
          )}
          {!dbOk && dbCheck.tables && (
            <div className="text-xs space-y-0.5">
              {Object.entries(dbCheck.tables).map(([t, v]: any) => (
                <div key={t}>
                  <span className={v.ok ? 'text-green-600' : 'text-red-600'}>
                    {v.ok ? '✓' : '✗'}
                  </span>{' '}
                  <code>{t}</code>
                  {!v.ok && v.error ? <span className="text-red-600 ml-2">— {v.error}</span> : null}
                </div>
              ))}
            </div>
          )}
          {!dbOk && (
            <div className="text-xs text-slate-600 mt-2">
              Запустіть <code>supabase/schema.sql</code> у Supabase → SQL Editor, або перевірте{' '}
              <code>SUPABASE_URL</code> / <code>SUPABASE_SERVICE_KEY</code>.
            </div>
          )}
        </section>
      )}

      {/* Webhook стан */}
      {health?.webhook && (
        <section className="border rounded p-3 bg-slate-50 space-y-1 text-sm">
          <div className="font-medium">Webhook Telegram</div>
          <div>
            URL:{' '}
            {health.webhook.url ? (
              <code className="text-xs break-all">{health.webhook.url}</code>
            ) : (
              <span className="text-red-600">не встановлено — натисніть «Налаштувати webhook»</span>
            )}
          </div>
          {health.webhook.pending_update_count > 0 && (
            <div className="text-amber-600">⚠ Накопичилось апдейтів: {health.webhook.pending_update_count}</div>
          )}
          {health.webhook.last_error_message && (
            <div className="text-red-600">Остання помилка: {health.webhook.last_error_message}</div>
          )}
        </section>
      )}

      {/* Налаштування webhook */}
      {allEnvOk && dbOk && (
        <section className="space-y-2">
          <button
            onClick={initialize}
            disabled={busy}
            className="px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Працюю…' : 'Налаштувати webhook на цей домен'}
          </button>
          <p className="text-xs text-slate-500">
            Скаже Telegram-у слати апдейти на{' '}
            <code>{typeof window !== 'undefined' ? window.location.origin : ''}/api/telegram/webhook</code>.
            Виконуйте при першому налаштуванні і після зміни домену.
          </p>
        </section>
      )}

      {/* Collaborative-режим: налаштування */}
      <section className="border rounded p-3 bg-slate-50 space-y-3 text-sm">
        <div className="font-medium">Колективний режим (collaborative)</div>
        <div className="text-xs text-slate-600">
          Параметри діють лише для справ, завантажених у колективному режимі. Зміни застосовуються миттєво для всіх нових подій.
        </div>
        <div className="flex items-center gap-2">
          <label className="w-56">Мін. підтверджень для закриття:</label>
          <input
            type="number"
            min={1}
            value={minConfirmations}
            onChange={e => setMinConfirmations(e.target.value)}
            className="border rounded px-2 py-1 w-20 text-sm"
          />
          <button
            onClick={() => saveMeta('min_confirmations', minConfirmations)}
            className="px-3 py-1 bg-indigo-600 text-white rounded text-xs"
          >
            Зберегти
          </button>
          {metaSavedKey === 'min_confirmations' && (
            <span className="text-green-600 text-xs">✓ збережено</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="w-56">Тривалість блокування (хв):</label>
          <input
            type="number"
            min={1}
            value={collabLockMinutes}
            onChange={e => setCollabLockMinutes(e.target.value)}
            className="border rounded px-2 py-1 w-20 text-sm"
          />
          <button
            onClick={() => saveMeta('collab_lock_minutes', collabLockMinutes)}
            className="px-3 py-1 bg-indigo-600 text-white rounded text-xs"
          >
            Зберегти
          </button>
          {metaSavedKey === 'collab_lock_minutes' && (
            <span className="text-green-600 text-xs">✓ збережено</span>
          )}
        </div>
      </section>

      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
};

// ==================== QUESTIONS ====================

const QuestionsView: React.FC<{ initialQuestions?: TableColumn[] }> = ({ initialQuestions }) => {
  const [questions, setQuestions] = useState<TableColumn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await tgApi.getQuestions();
        if (Array.isArray(r.questions) && r.questions.length > 0) {
          setQuestions(r.questions);
        } else if (initialQuestions && initialQuestions.length > 0) {
          setQuestions(initialQuestions);
        } else {
          setQuestions(createDefaultColumns());
        }
      } catch (e: any) {
        setMsg(e.message);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded) return <div>Завантаження...</div>;

  const update = (i: number, patch: Partial<TableColumn>) => {
    setQuestions(qs => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  };

  const add = () => setQuestions(qs => [...qs, createColumn('Нове питання')]);
  const remove = (i: number) => setQuestions(qs => qs.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    setQuestions(qs => {
      const copy = [...qs];
      const j = i + dir;
      if (j < 0 || j >= copy.length) return copy;
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };

  const importFromProject = () => {
    if (initialQuestions) setQuestions(initialQuestions);
  };

  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      await tgApi.saveQuestions(questions);
      setMsg('✅ Збережено');
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm text-slate-600">
        Питання = структура таблиці. Бот ставить їх по порядку. Тип валідації береться з <code>role</code>.
      </p>
      <div className="flex gap-2">
        <button onClick={importFromProject} className="px-3 py-1.5 bg-slate-200 text-sm rounded">
          Імпортувати з активного проєкту
        </button>
        <button onClick={add} className="px-3 py-1.5 bg-slate-200 text-sm rounded flex items-center gap-1">
          <Plus size={14} /> Додати
        </button>
        <button onClick={save} disabled={busy} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded flex items-center gap-1">
          <Save size={14} /> Зберегти
        </button>
      </div>
      <div className="space-y-2">
        {questions.map((q, i) => (
          <div key={q.id} className="flex gap-2 items-center bg-slate-50 border rounded p-2">
            <div className="flex flex-col">
              <button onClick={() => move(i, -1)} className="text-xs text-slate-500">▲</button>
              <button onClick={() => move(i, 1)} className="text-xs text-slate-500">▼</button>
            </div>
            <input
              value={q.label}
              onChange={e => update(i, { label: e.target.value })}
              className="flex-1 border rounded px-2 py-1 text-sm"
              placeholder="Текст питання"
            />
            <select
              value={q.role || 'none'}
              onChange={e => update(i, { role: e.target.value as any })}
              className="border rounded px-2 py-1 text-sm"
            >
              {COLUMN_ROLE_OPTIONS.map(r => (
                <option key={r} value={r}>
                  {COLUMN_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button onClick={() => remove(i)} className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
};

// ==================== CASES PREPARER ====================

const RENDER_SCALE = 3.0; // високий dpi для якості кропів

type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
  // Якщо groupId === id — зона у власній групі (одна справа = одна зона).
  // Якщо у кількох зон однаковий groupId — це частини однієї справи (можливо на різних сторінках),
  // які при завантаженні склеюються в одне зображення і одну справу.
  groupId: string;
  // Порядок у групі для склеювання (визначається порядком виділення при merge).
  // Менше число = вище у склеєному зображенні. Для одиночних зон не використовується.
  groupOrder?: number;
  // Поворот зони у градусах навколо її центру. Додатне значення — за годинниковою стрілкою.
  // 0 / undefined — вісь-вирівняний прямокутник (поведінка за замовчуванням).
  rotation?: number;
};

// Поворот точки навколо центру на заданий кут (у градусах).
// ВАЖЛИВО: завжди застосовується в ПІКСЕЛЬНОМУ просторі — інакше для
// неквадратних сторінок (PDF A4 ~ 1:1.41) кут у нормалізованих координатах
// «спотворюється», бо нормалізовані одиниці X і Y мають різний фізичний розмір.
function rotatePt(p: { x: number; y: number }, c: { x: number; y: number }, deg: number) {
  if (!deg) return p;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}
function boxCenter(b: Box) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
// Перетворити точку миші (нормовані 0..1) у локальну (вісь-вирівняну) систему
// зони з урахуванням повороту. Конвертуємо в пікселі канвасу, обертаємо, повертаємо назад.
function rotateNormPoint(
  p: { x: number; y: number },
  c: { x: number; y: number },
  deg: number,
  W: number,
  H: number
) {
  if (!deg) return p;
  const pPx = { x: p.x * W, y: p.y * H };
  const cPx = { x: c.x * W, y: c.y * H };
  const r = rotatePt(pPx, cPx, deg);
  return { x: r.x / W, y: r.y / H };
}

const newId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `b_${Date.now()}_${Math.random().toString(36).slice(2)}`
  ).replace(/-/g, '').slice(0, 12);

// Стійкий колір з groupId — щоб зони однієї групи виглядали однаково.
function colorFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 50%)`;
}

// Lines-режим: вертикальні (макс 4) + горизонтальні з привʼязкою до X.
// Горизонтальна лінія "живе" у вертикальній смузі, в яку потрапляє її x.
type HLine = { x: number; y: number };
type LineSet = { v: number[]; h: HLine[] };
const MAX_V_LINES = 4;

// Вертикальні паруються: (V0,V1) → band 0, (V2,V3) → band 1.
function vBands(v: number[]): Array<[number, number]> {
  const sorted = [...v].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < sorted.length; i += 2) out.push([sorted[i], sorted[i + 1]]);
  return out;
}

// Знайти індекс смуги, у яку потрапляє x. -1 якщо не у жодній.
function bandIndexFor(x: number, bands: Array<[number, number]>): number {
  for (let i = 0; i < bands.length; i++) {
    if (x >= bands[i][0] && x <= bands[i][1]) return i;
  }
  return -1;
}

// Зони: для кожної вертикальної смуги — між кожною парою сусідніх горизонталей у ній.
function linesToZones(lines: LineSet): Array<Omit<Box, 'id' | 'groupId'>> {
  const bands = vBands(lines.v);
  const out: Array<Omit<Box, 'id' | 'groupId'>> = [];
  for (let bi = 0; bi < bands.length; bi++) {
    const [vx1, vx2] = bands[bi];
    const ys = lines.h
      .filter(h => bandIndexFor(h.x, bands) === bi)
      .map(h => h.y)
      .sort((a, b) => a - b);
    for (let i = 0; i + 1 < ys.length; i++) {
      out.push({ x: vx1, y: ys[i], w: vx2 - vx1, h: ys[i + 1] - ys[i] });
    }
  }
  return out;
}

// Колір пари за індексом (для підсвітки парних ліній).
function pairColor(pairIdx: number): string {
  return `hsl(${(pairIdx * 67) % 360}, 70%, 45%)`;
}

const SESSION_VERSION = 2;
interface SessionFile {
  version: number;
  savedAt: string;
  pdfName: string;
  pdfBase64: string; // вміст PDF
  pageBoxes: Record<number, Box[]>;
  // v2+: лінії з Lines-режиму (опціонально, лише якщо є на сторінці).
  pageLines?: Record<number, LineSet>;
  meta: { archive: string; fund: string; opys: string };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export type CasesViewMode = 'admin' | 'prep';

export const CasesView: React.FC<{ geminiKey: string; mode?: CasesViewMode }> = ({
  geminiKey,
  mode: viewMode = 'admin',
}) => {
  const [pdf, setPdf] = useState<any>(null);
  const [pdfName, setPdfName] = useState('');
  const [page, setPage] = useState(1);
  const [pageImage, setPageImage] = useState<string>(''); // dataURL поточної сторінки
  // Зони по всіх сторінках. Ключ — номер сторінки (1-based).
  const [pageBoxes, setPageBoxes] = useState<Record<number, Box[]>>({});
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadDone, setUploadDone] = useState<{ count: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Архівні реквізити — обовʼязкові для всієї пачки справ.
  // Архівні реквізити НЕ зберігаються між сесіями — кожен PDF може бути іншим описом.
  const [archive, setArchive] = useState('');
  const [fund, setFund] = useState('');
  const [opys, setOpys] = useState('');
  // Режим обробки для всієї пачки. Фіксується при завантаженні справи.
  const [batchMode, setBatchMode] = useState<'parallel' | 'collaborative'>('collaborative');
  // Згорнути блок «Архівні реквізити + Режим», коли все заповнено і PDF уже відкрито —
  // звільняє ~120px по вертикалі для скану.
  const [metaCollapsed, setMetaCollapsed] = useState(false);
  // Діапазон сторінок для авто-розпізнавання. Порожньо → поточна сторінка.
  const [autoRange, setAutoRange] = useState('');
  const [autoProgress, setAutoProgress] = useState<{ done: number; total: number; page?: number } | null>(null);
  const [skipExisting, setSkipExisting] = useState(true);
  const importInputRef = useRef<HTMLInputElement>(null);
  // Кеш бінарного PDF для повторного відкриття після імпорту і експорту.
  const [pdfBase64, setPdfBase64] = useState<string>('');
  // Виділені зони (id) — для обʼєднання у крос-сторінкові групи.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Lines-режим: альтернативний інструмент введення зон через перетин ліній.
  const [inputMode, setInputMode] = useState<'zones' | 'lines'>('zones');
  const [pageLines, setPageLines] = useState<Record<number, LineSet>>({});
  const [applyAllAxis, setApplyAllAxis] = useState<'vertical' | 'all'>('all');
  const lineDragRef = useRef<{ axis: 'v' | 'h'; index: number } | null>(null);
  const [lineHoverAxis, setLineHoverAxis] = useState<'v' | 'h' | null>(null);
  const [showLog, setShowLog] = useState(false);
  type LogEntry = {
    page: number;
    model: string;
    count: number;
    raw: string;
    error?: string;
    ts: string;
  };
  const [recogLog, setRecogLog] = useState<LogEntry[]>([]);

  const activeApiKey = geminiKey;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  type CanvasAction =
    | { type: 'draw'; startX: number; startY: number }
    | {
        type: 'resize';
        boxId: string;
        handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
        // Заморожений знімок коробки на момент початку drag-у. Усі обчислення
        // ведемо у локальній системі координат preB (нерухомий центр + кут).
        preB: { x: number; y: number; w: number; h: number; rotation: number };
      }
    | {
        type: 'rotate';
        boxId: string;
        // Кут (у градусах) між «вертикаллю вгору» зони і вектором від центру
        // до точки початку drag-у. Різниця між поточним і стартовим кутом дає delta.
        startPointerAngle: number;
        startBoxRotation: number;
      };
  const actionRef = useRef<CanvasAction | null>(null);

  const metaValid = !!(archive.trim() && fund.trim() && opys.trim());
  const boxes: Box[] = pageBoxes[page] || [];

  // Авто-згортання блоку реквізитів — рівно один раз за сесію, в момент
  // ПЕРШОЇ взаємодії з канвасом (mousedown). Тригерити по metaValid не можна:
  // в момент вводу першого символу третього поля metaValid стає true і блок
  // схлопнувся б, не давши донабрати решту значення.
  const autoCollapsedOnceRef = useRef(false);
  const maybeAutoCollapseOnCanvas = () => {
    if (autoCollapsedOnceRef.current) return;
    if (!metaValid) return;
    autoCollapsedOnceRef.current = true;
    setMetaCollapsed(true);
  };
  const totalBoxes = (Object.values(pageBoxes) as Box[][]).reduce((s, b) => s + b.length, 0);
  const pagesWithBoxes = (Object.entries(pageBoxes) as [string, Box[]][])
    .filter(([, v]) => v.length > 0)
    .map(([k]) => parseInt(k, 10))
    .sort((a, b) => a - b);

  const setBoxesForPage = (p: number, fn: (prev: Box[]) => Box[]) => {
    setPageBoxes(prev => ({ ...prev, [p]: fn(prev[p] || []) }));
  };

  // ---------- Lines mode helpers ----------
  const linesForPage = (p: number): LineSet => pageLines[p] || { v: [], h: [] };
  const setLinesForPage = (p: number, fn: (prev: LineSet) => LineSet) => {
    setPageLines(prev => ({ ...prev, [p]: fn(prev[p] || { v: [], h: [] }) }));
  };
  // Поріг хіту лінії в нормалізованих координатах (≈6px у канвасі).
  const lineHitThreshold = (axis: 'v' | 'h') => {
    const c = canvasRef.current;
    if (!c) return 0.005;
    return 6 / (axis === 'v' ? c.width : c.height);
  };
  // Edge-band (15% висоти зверху/знизу) для розпізнавання вертикальних кліків.
  const edgeBandNorm = () => 0.15;
  // x-діапазон, у якому існує горизонтальна лінія (її смуга або весь аркуш, якщо орфан).
  const hSpanFor = (h: HLine, ls: LineSet): [number, number] => {
    const bands = vBands(ls.v);
    const bi = bandIndexFor(h.x, bands);
    return bi >= 0 ? bands[bi] : [0, 1];
  };
  // Точка близько біля × лінії.
  const hitLineCloseHandle = (
    p: { x: number; y: number },
    axis: 'v' | 'h',
    index: number
  ): boolean => {
    const c = canvasRef.current;
    if (!c) return false;
    const ls = linesForPage(page);
    const r = 14;
    if (axis === 'v') {
      const pos = ls.v[index];
      if (pos === undefined) return false;
      const dx = (p.x - pos) * c.width;
      const dy = p.y * c.height - 14;
      return Math.hypot(dx, dy) < r;
    }
    const hl = ls.h[index];
    if (!hl) return false;
    const [, x2] = hSpanFor(hl, ls);
    const dx = (p.x - x2) * c.width + 14;
    const dy = (p.y - hl.y) * c.height;
    return Math.hypot(dx, dy) < r;
  };
  // Знаходить лінію під курсором.
  const hitAnyLine = (p: { x: number; y: number }) => {
    const ls = linesForPage(page);
    const tv = lineHitThreshold('v');
    for (let i = 0; i < ls.v.length; i++) {
      if (Math.abs(p.x - ls.v[i]) < tv) return { axis: 'v' as const, index: i };
    }
    const th = lineHitThreshold('h');
    for (let i = 0; i < ls.h.length; i++) {
      const hl = ls.h[i];
      const [x1, x2] = hSpanFor(hl, ls);
      if (p.x < x1 || p.x > x2) continue;
      if (Math.abs(p.y - hl.y) < th) return { axis: 'h' as const, index: i };
    }
    return null;
  };
  const addVerticalLine = (x: number) => {
    const clamped = Math.max(0, Math.min(1, x));
    setLinesForPage(page, prev => {
      if (prev.v.length >= MAX_V_LINES) return prev;
      return { ...prev, v: [...prev.v, clamped] };
    });
  };
  const addHorizontalLine = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(1, x));
    const cy = Math.max(0, Math.min(1, y));
    setLinesForPage(page, prev => ({ ...prev, h: [...prev.h, { x: cx, y: cy }] }));
  };
  const removeLine = (axis: 'v' | 'h', index: number) => {
    setLinesForPage(page, prev => {
      if (axis === 'v') return { ...prev, v: prev.v.filter((_, i) => i !== index) };
      return { ...prev, h: prev.h.filter((_, i) => i !== index) };
    });
  };
  const moveLine = (axis: 'v' | 'h', index: number, pos: number) => {
    const clamped = Math.max(0, Math.min(1, pos));
    setLinesForPage(page, prev => {
      if (axis === 'v') {
        return { ...prev, v: prev.v.map((v, i) => (i === index ? clamped : v)) };
      }
      return {
        ...prev,
        h: prev.h.map((h, i) => (i === index ? { ...h, y: clamped } : h)),
      };
    });
  };
  const clearLinesPage = () => {
    setLinesForPage(page, () => ({ v: [], h: [] }));
  };
  // Перетворити лінії заданих сторінок у звичайні зони (Box[]).
  const materializePages = (targetPages: number[]) => {
    const pagesToProcess = targetPages
      .map(p => ({ p, v: pageLines[p] }))
      .filter((x): x is { p: number; v: LineSet } => !!x.v && linesToZones(x.v).length > 0);
    if (pagesToProcess.length === 0) return;
    setPageBoxes(prev => {
      const next = { ...prev };
      for (const { p, v } of pagesToProcess) {
        const zones = linesToZones(v);
        const newBoxes: Box[] = zones.map(z => {
          const id = newId();
          return { ...z, id, groupId: id };
        });
        next[p] = [...(next[p] || []), ...newBoxes];
      }
      return next;
    });
    setPageLines(prev => {
      const next = { ...prev };
      for (const { p } of pagesToProcess) delete next[p];
      return next;
    });
  };
  const materializeAll = () => {
    materializePages(Object.keys(pageLines).map(k => parseInt(k, 10)));
    setInputMode('zones');
  };
  const materializeCurrentPage = () => {
    materializePages([page]);
  };
  // Застосувати лінії поточної сторінки до всіх інших сторінок (1..pdf.numPages).
  const applyLinesToAllPages = () => {
    if (!pdf) return;
    const src = linesForPage(page);
    if (src.v.length === 0 && src.h.length === 0) return;
    const total = pdf.numPages;
    setPageLines(prev => {
      const next: Record<number, LineSet> = { ...prev };
      for (let p = 1; p <= total; p++) {
        if (p === page) continue;
        const cur = next[p] || { v: [], h: [] };
        if (applyAllAxis === 'vertical') {
          next[p] = { v: [...src.v], h: cur.h };
        } else {
          next[p] = { v: [...src.v], h: src.h.map(h => ({ ...h })) };
        }
      }
      return next;
    });
  };

  const loadPdf = async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      setMsg('❌ Це не PDF-файл.');
      return;
    }
    setMsg('');
    setUploadDone(null);
    setPageBoxes({});
    setPageLines({});
    const buf = await file.arrayBuffer();
    setPdfBase64(arrayBufferToBase64(buf));
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    setPdf(doc);
    setPdfName(file.name);
    setPage(1);
    await renderPage(doc, 1);
  };

  const renderPage = async (doc: any, pageNum: number) => {
    const p = await doc.getPage(pageNum);
    const viewport = p.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await p.render({ canvasContext: ctx, viewport, canvas }).promise;
    setPageImage(canvas.toDataURL('image/jpeg', 0.92));
    // boxes беруться з pageBoxes[page] — не скидаємо.
  };

  useEffect(() => {
    if (pdf) renderPage(pdf, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Стрілки ←/→ на клавіатурі — гортання сторінок (ігноруємо коли фокус на input/textarea/select).
  useEffect(() => {
    if (!pdf) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (e.key === 'ArrowLeft') setPage(p => Math.max(1, p - 1));
      else setPage(p => Math.min(pdf.numPages, p + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pdf]);

  // Перерендерим зон на canvas при зміні сторінки/боксів.
  useEffect(() => {
    if (!pageImage || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      // У Lines-режимі ручні зони показуємо тьмяніше і без маркерів.
      const dimZones = inputMode === 'lines';
      boxes.forEach((b, idx) => {
        const x = b.x * canvas.width;
        const y = b.y * canvas.height;
        const w = b.w * canvas.width;
        const h = b.h * canvas.height;
        // Якщо зона у крос-сторінковій групі — її колір унікальний за groupId.
        const inGroup = (groups.get(b.groupId)?.length || 0) > 1;
        const color = inGroup ? colorFromId(b.groupId) : 'rgba(99,102,241,0.95)';
        const isSelected = selectedIds.has(b.id);
        ctx.globalAlpha = dimZones ? 0.35 : 1;
        // Поворот зони — обертаємо систему координат навколо центру; усе нижче
        // (рамка, чіп, хрестик, ресайз-маркери) автоматично рендериться повернутим.
        ctx.save();
        if (b.rotation) {
          const cx = (b.x + b.w / 2) * canvas.width;
          const cy = (b.y + b.h / 2) * canvas.height;
          ctx.translate(cx, cy);
          ctx.rotate((b.rotation * Math.PI) / 180);
          ctx.translate(-cx, -cy);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 6 : 3;
        if (isSelected) {
          ctx.setLineDash([10, 6]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        // Чіп номера + позначка групи
        ctx.fillStyle = color;
        const chipW = inGroup ? 56 : 28;
        ctx.fillRect(x, y, chipW, 26);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(String(idx + 1), x + 7, y + 19);
        if (inGroup) {
          ctx.font = 'bold 14px sans-serif';
          ctx.fillText('🔗', x + 30, y + 19);
        }
        if (dimZones) { ctx.globalAlpha = 1; ctx.restore(); return; }
        // Хрестик «видалити»
        const cx = x + w - 14;
        const cy = y + 14;
        ctx.fillStyle = 'rgba(220,38,38,0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy - 5);
        ctx.lineTo(cx + 5, cy + 5);
        ctx.moveTo(cx + 5, cy - 5);
        ctx.lineTo(cx - 5, cy + 5);
        ctx.stroke();

        // Resize-маркери (8 шт.: 4 кути + 4 середини сторін). Білі квадрати з кольоровим бордером.
        const handleSize = 12;
        const handlePoints: [number, number][] = [
          [x, y],                 // nw
          [x + w / 2, y],         // n
          [x + w, y],             // ne
          [x + w, y + h / 2],     // e
          [x + w, y + h],         // se
          [x + w / 2, y + h],     // s
          [x, y + h],             // sw
          [x, y + h / 2],         // w
        ];
        for (const [hx, hy] of handlePoints) {
          ctx.fillStyle = 'white';
          ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
        }
        // Ручка повороту — гачок над верхньою серединою зони. Видима завжди.
        {
          const rx = x + w / 2;
          const ryAnchor = y;
          const rotateOffset = 44; // px над верхньою стороною зони
          const rotateRadius = 16;
          const ryHandle = y - rotateOffset;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(rx, ryAnchor);
          ctx.lineTo(rx, ryHandle + rotateRadius);
          ctx.stroke();
          ctx.fillStyle = 'white';
          ctx.beginPath();
          ctx.arc(rx, ryHandle, rotateRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // іконка «↻» всередині
          ctx.fillStyle = color;
          ctx.font = 'bold 22px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('↻', rx, ryHandle + 1);
          ctx.textAlign = 'start';
          ctx.textBaseline = 'alphabetic';
        }
        ctx.restore();
      });
      ctx.globalAlpha = 1;

      // ----- Lines mode overlay -----
      if (inputMode === 'lines') {
        const ls = pageLines[page] || { v: [], h: [] };
        // Авто-зони (пунктирний прев'ю).
        const previewZones = linesToZones(ls);
        ctx.save();
        ctx.fillStyle = 'rgba(34,197,94,0.10)';
        ctx.strokeStyle = 'rgba(22,163,74,0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        for (const z of previewZones) {
          const zx = z.x * canvas.width;
          const zy = z.y * canvas.height;
          const zw = z.w * canvas.width;
          const zh = z.h * canvas.height;
          ctx.fillRect(zx, zy, zw, zh);
          ctx.strokeRect(zx, zy, zw, zh);
        }
        ctx.restore();

        const bands = vBands(ls.v);
        // Сортуємо вертикалі для пар і дужок-міток.
        const sortedV = [...ls.v].map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
        const drawCloseX = (cx: number, cy: number) => {
          ctx.fillStyle = 'rgba(220,38,38,0.95)';
          ctx.beginPath();
          ctx.arc(cx, cy, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4);
          ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 4, cy + 4);
          ctx.stroke();
        };
        // Вертикальні: пари (V0,V1)→band0, (V2,V3)→band1.
        for (let k = 0; k < sortedV.length; k++) {
          const pairIdx = Math.floor(k / 2);
          const isLast = k === sortedV.length - 1 && sortedV.length % 2 === 1;
          const inPair = !isLast;
          const color = inPair ? pairColor(pairIdx) : 'rgba(148,163,184,0.95)';
          const bracket = k % 2 === 0 ? '[' : ']';
          const label = inPair ? `${bracket}${pairIdx + 1}` : '?';
          const x = sortedV[k].p * canvas.width;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
          ctx.stroke();
          ctx.font = 'bold 16px sans-serif';
          ctx.fillStyle = color;
          ctx.fillText(label, x + 6, 18);
          drawCloseX(x, 14);
        }
        // Горизонтальні: тільки в межах своєї смуги (orphan — сірий пунктир на повну ширину).
        ls.h.forEach((hl, idx) => {
          const bi = bandIndexFor(hl.x, bands);
          const inBand = bi >= 0;
          const [x1, x2] = inBand ? bands[bi] : [0, 1];
          const color = inBand ? pairColor(bi) : 'rgba(148,163,184,0.95)';
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.setLineDash(inBand ? [] : [6, 4]);
          const y = hl.y * canvas.height;
          const px1 = x1 * canvas.width;
          const px2 = x2 * canvas.width;
          ctx.beginPath();
          ctx.moveTo(px1, y); ctx.lineTo(px2, y);
          ctx.stroke();
          ctx.setLineDash([]);
          // Підпис: індекс (1-based) серед лінії своєї смуги по y, або '?' для orphan.
          let label = '?';
          if (inBand) {
            const sameBandSorted = ls.h
              .map((h, i) => ({ h, i }))
              .filter(x => bandIndexFor(x.h.x, bands) === bi)
              .sort((a, b) => a.h.y - b.h.y);
            const order = sameBandSorted.findIndex(x => x.i === idx);
            label = `${bi + 1}.${order + 1}`;
          }
          ctx.font = 'bold 14px sans-serif';
          ctx.fillStyle = color;
          ctx.fillText(label, px1 + 4, y - 4);
          drawCloseX(px2 - 14, y);
        });
      }
    };
    img.src = pageImage;
    // selectedIds + groups впливають на стиль рендеру
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageImage, boxes, selectedIds, pageBoxes, inputMode, pageLines]);

  // Координати в нормалізованій системі (0..1).
  const normFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const localPoint = (point: { x: number; y: number }, b: Box) => {
    if (!b.rotation || !canvasRef.current) return point;
    return rotateNormPoint(point, boxCenter(b), -b.rotation, canvasRef.current.width, canvasRef.current.height);
  };

  // Перевірка попадання в "хрестик видалити".
  const hitCloseHandle = (point: { x: number; y: number }, b: Box): boolean => {
    if (!canvasRef.current) return false;
    const W = canvasRef.current.width;
    const H = canvasRef.current.height;
    const lp = localPoint(point, b);
    const cxPx = (b.x + b.w) * W - 14;
    const cyPx = b.y * H + 14;
    const px = lp.x * W;
    const py = lp.y * H;
    const dx = px - cxPx;
    const dy = py - cyPx;
    return Math.sqrt(dx * dx + dy * dy) <= 14;
  };

  // Перевірка попадання в resize-маркер. Повертає тип маркера або null.
  const hitResizeHandle = (
    point: { x: number; y: number },
    b: Box
  ): 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | null => {
    if (!canvasRef.current) return null;
    const W = canvasRef.current.width;
    const H = canvasRef.current.height;
    const lp = localPoint(point, b);
    const px = lp.x * W;
    const py = lp.y * H;
    // Маркер ~12px, додамо запас 4px для зручності кліку.
    const r = 10;
    const points: [number, number, NonNullable<ReturnType<typeof hitResizeHandle>>][] = [
      [b.x * W, b.y * H, 'nw'],
      [(b.x + b.w / 2) * W, b.y * H, 'n'],
      [(b.x + b.w) * W, b.y * H, 'ne'],
      [(b.x + b.w) * W, (b.y + b.h / 2) * H, 'e'],
      [(b.x + b.w) * W, (b.y + b.h) * H, 'se'],
      [(b.x + b.w / 2) * W, (b.y + b.h) * H, 's'],
      [b.x * W, (b.y + b.h) * H, 'sw'],
      [b.x * W, (b.y + b.h / 2) * H, 'w'],
    ];
    for (const [hx, hy, name] of points) {
      if (Math.abs(px - hx) <= r && Math.abs(py - hy) <= r) return name;
    }
    return null;
  };

  const pointInsideBox = (point: { x: number; y: number }, b: Box): boolean => {
    const lp = localPoint(point, b);
    return lp.x >= b.x && lp.x <= b.x + b.w && lp.y >= b.y && lp.y <= b.y + b.h;
  };

  // Хіт-тест ручки повороту (коло над верхньою серединою зони). Доступна завжди.
  const hitRotateHandle = (point: { x: number; y: number }, b: Box): boolean => {
    if (!canvasRef.current) return false;
    const W = canvasRef.current.width;
    const H = canvasRef.current.height;
    const lp = localPoint(point, b);
    const rxN = b.x + b.w / 2;
    const ryN = b.y - 44 / H;
    const dx = (lp.x - rxN) * W;
    const dy = (lp.y - ryN) * H;
    return Math.sqrt(dx * dx + dy * dy) <= 20;
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Координати протилежного "якоря" відносно вибраного маркера —
  // він не рухається при ресайзі.
  const anchorOf = (b: Box, handle: NonNullable<ReturnType<typeof hitResizeHandle>>) => {
    switch (handle) {
      case 'nw': return { x: b.x + b.w, y: b.y + b.h };
      case 'ne': return { x: b.x,        y: b.y + b.h };
      case 'sw': return { x: b.x + b.w, y: b.y };
      case 'se': return { x: b.x,        y: b.y };
      case 'n':  return { x: b.x + b.w / 2, y: b.y + b.h };
      case 's':  return { x: b.x + b.w / 2, y: b.y };
      case 'w':  return { x: b.x + b.w, y: b.y + b.h / 2 };
      case 'e':  return { x: b.x,        y: b.y + b.h / 2 };
    }
  };

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    maybeAutoCollapseOnCanvas();
    const p = normFromEvent(e);
    // ----- Lines mode -----
    if (inputMode === 'lines') {
      const ls = linesForPage(page);
      // 1) Хрестик на лінії — видалити.
      for (let i = 0; i < ls.v.length; i++) {
        if (hitLineCloseHandle(p, 'v', i)) { removeLine('v', i); return; }
      }
      for (let i = 0; i < ls.h.length; i++) {
        if (hitLineCloseHandle(p, 'h', i)) { removeLine('h', i); return; }
      }
      // 2) Хіт на існуючу лінію — починаємо drag.
      const hit = hitAnyLine(p);
      if (hit) {
        lineDragRef.current = hit;
        return;
      }
      // 3) Інакше — додавання нової. Якщо вже 4 вертикальні — будь-який клік дає горизонтальну.
      // Інакше: edge band зверху/знизу = вертикальна.
      if (ls.v.length >= MAX_V_LINES) {
        addHorizontalLine(p.x, p.y);
        return;
      }
      const eb = edgeBandNorm();
      if (p.y < eb || p.y > 1 - eb) {
        addVerticalLine(p.x);
      } else {
        addHorizontalLine(p.x, p.y);
      }
      return;
    }
    // 1) Хрестик «видалити» — пріоритет.
    const idx = boxes.findIndex(b => hitCloseHandle(p, b));
    if (idx >= 0) {
      removeBox(idx);
      actionRef.current = null;
      return;
    }
    // 2) Ручка повороту.
    for (const b of boxes) {
      if (!hitRotateHandle(p, b)) continue;
      const W = canvasRef.current.width;
      const H = canvasRef.current.height;
      const c = boxCenter(b);
      // Кут рахуємо в ПІКСЕЛЬНОМУ просторі — інакше для неквадратного канвасу
      // він буде спотворений.
      const dx = (p.x - c.x) * W;
      const dy = (p.y - c.y) * H;
      const startPointerAngle = (Math.atan2(dx, -dy) * 180) / Math.PI;
      actionRef.current = {
        type: 'rotate',
        boxId: b.id,
        startPointerAngle,
        startBoxRotation: b.rotation || 0,
      };
      return;
    }
    // 3) Resize-маркер.
    for (const b of boxes) {
      const handle = hitResizeHandle(p, b);
      if (handle) {
        actionRef.current = {
          type: 'resize',
          boxId: b.id,
          handle,
          preB: { x: b.x, y: b.y, w: b.w, h: b.h, rotation: b.rotation || 0 },
        };
        return;
      }
    }
    // 4) Інакше — нова зона (drag).
    actionRef.current = { type: 'draw', startX: p.x, startY: p.y };
  };

  const onCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (inputMode === 'lines') {
      const drag = lineDragRef.current;
      const p = normFromEvent(e);
      if (drag) {
        moveLine(drag.axis, drag.index, drag.axis === 'v' ? p.x : p.y);
        return;
      }
      const hit = hitAnyLine(p);
      const next = hit ? hit.axis : null;
      if (next !== lineHoverAxis) setLineHoverAxis(next);
      return;
    }
    const a = actionRef.current;
    if (!a) return;
    const p = normFromEvent(e);
    if (a.type === 'rotate') {
      if (!canvasRef.current) return;
      const W = canvasRef.current.width;
      const H = canvasRef.current.height;
      setBoxesForPage(page, prev =>
        prev.map(b => {
          if (b.id !== a.boxId) return b;
          const c = boxCenter(b);
          const dx = (p.x - c.x) * W;
          const dy = (p.y - c.y) * H;
          const pointerAngle = (Math.atan2(dx, -dy) * 180) / Math.PI;
          let next = a.startBoxRotation + (pointerAngle - a.startPointerAngle);
          // Shift — снап до 15°.
          if (e.shiftKey) next = Math.round(next / 15) * 15;
          next = ((next + 540) % 360) - 180;
          if (Math.abs(next) < 0.05) next = 0;
          return { ...b, rotation: next };
        })
      );
      return;
    }
    if (a.type !== 'resize') return;
    if (!canvasRef.current) return;
    const W = canvasRef.current.width;
    const H = canvasRef.current.height;
    const preB = a.preB;
    const rotation = preB.rotation || 0;
    // ВАЖЛИВО: всі геометричні обчислення в ПІКСЕЛЬНОМУ просторі. Поворот у нормованих
    // координатах (0..1) спотворюється на неквадратних канвасах (типовий PDF A4).
    const preCenterPx = { x: (preB.x + preB.w / 2) * W, y: (preB.y + preB.h / 2) * H };
    const pPx = { x: p.x * W, y: p.y * H };
    const pLocalPx = rotation ? rotatePt(pPx, preCenterPx, -rotation) : pPx;
    const anchorLocalPx = (() => {
      const ax =
        a.handle.includes('w') ? (preB.x + preB.w) * W :
        a.handle.includes('e') ? preB.x * W :
        (preB.x + preB.w / 2) * W;
      const ay =
        a.handle.includes('n') ? (preB.y + preB.h) * H :
        a.handle.includes('s') ? preB.y * H :
        (preB.y + preB.h / 2) * H;
      return { x: ax, y: ay };
    })();
    let newWpx = preB.w * W;
    let newHpx = preB.h * H;
    if (a.handle.includes('e') || a.handle.includes('w')) {
      newWpx = Math.max(5, Math.abs(pLocalPx.x - anchorLocalPx.x));
    }
    if (a.handle.includes('n') || a.handle.includes('s')) {
      newHpx = Math.max(5, Math.abs(pLocalPx.y - anchorLocalPx.y));
    }
    let offDx = 0;
    let offDy = 0;
    if (a.handle.includes('e')) offDx = +newWpx / 2;
    else if (a.handle.includes('w')) offDx = -newWpx / 2;
    if (a.handle.includes('n')) offDy = -newHpx / 2;
    else if (a.handle.includes('s')) offDy = +newHpx / 2;
    const anchorScreenPx = rotation
      ? rotatePt(anchorLocalPx, preCenterPx, rotation)
      : anchorLocalPx;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const offScreenPx = { x: offDx * cos - offDy * sin, y: offDx * sin + offDy * cos };
    const newCenterPx = {
      x: anchorScreenPx.x + offScreenPx.x,
      y: anchorScreenPx.y + offScreenPx.y,
    };
    const newX = (newCenterPx.x - newWpx / 2) / W;
    const newY = (newCenterPx.y - newHpx / 2) / H;
    const newW = newWpx / W;
    const newH = newHpx / H;
    setBoxesForPage(page, prev =>
      prev.map(b => (b.id === a.boxId ? { ...b, x: newX, y: newY, w: newW, h: newH } : b))
    );
  };

  const onCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    if (inputMode === 'lines') {
      lineDragRef.current = null;
      return;
    }
    const a = actionRef.current;
    actionRef.current = null;
    if (!a) return;
    if (a.type === 'resize' || a.type === 'rotate') return; // готово, оновлення вже сталось у move.
    // Завершення малювання нової зони.
    const p = normFromEvent(e);
    const x = Math.min(a.startX, p.x);
    const y = Math.min(a.startY, p.y);
    const w = Math.abs(p.x - a.startX);
    const h = Math.abs(p.y - a.startY);
    // Малий жест → клік: toggle selection якщо потрапили в існуючу зону.
    if (w < 0.02 || h < 0.02) {
      const hit = boxes.find(b => pointInsideBox(p, b));
      if (hit) toggleSelected(hit.id);
      return;
    }
    const id = newId();
    setBoxesForPage(page, prev => [...prev, { x, y, w, h, id, groupId: id }]);
  };

  const removeBox = (i: number) => {
    setBoxesForPage(page, prev => {
      const removed = prev[i];
      if (removed) {
        setSelectedIds(s => {
          const n = new Set(s);
          n.delete(removed.id);
          return n;
        });
      }
      return prev.filter((_, idx) => idx !== i);
    });
  };
  const clearPage = () => {
    const ids = (pageBoxes[page] || []).map(b => b.id);
    setSelectedIds(s => {
      const n = new Set(s);
      ids.forEach(id => n.delete(id));
      return n;
    });
    setBoxesForPage(page, () => []);
  };

  // ---------- Групування зон (одна справа на кількох сторінках) ----------
  // Збираємо всі зони з усіх сторінок для зручної ітерації.
  const allBoxesWithPage = (Object.entries(pageBoxes) as [string, Box[]][])
    .flatMap(([p, list]) => list.map(b => ({ page: parseInt(p, 10), box: b })));

  // groups: groupId → масив {page, box}, відсортований по (page, y).
  const groups = (() => {
    const map = new Map<string, { page: number; box: Box }[]>();
    for (const item of allBoxesWithPage) {
      const arr = map.get(item.box.groupId) || [];
      arr.push(item);
      map.set(item.box.groupId, arr);
    }
    for (const arr of map.values()) {
      // Якщо груповий порядок заданий явно (merge зробив користувач) — використовуємо його.
      // Інакше — fallback на геометричний порядок (page, y).
      arr.sort((a, b) => {
        const oa = a.box.groupOrder ?? -1;
        const ob = b.box.groupOrder ?? -1;
        if (oa !== ob && oa >= 0 && ob >= 0) return oa - ob;
        return a.page - b.page || a.box.y - b.box.y;
      });
    }
    return map;
  })();

  // Групи з > 1 зон — те, що цікаво показати у панелі.
  const multiBoxGroups = [...groups.entries()].filter(([, items]) => items.length > 1);

  const mergeSelected = () => {
    if (selectedIds.size < 2) return;
    // Як спільний groupId беремо groupId першої виділеної зони.
    // Порядок виділення задає порядок склеювання: перша зверху.
    const orderedIds = [...selectedIds];
    const firstId = orderedIds[0];
    let target = '';
    for (const arr of Object.values(pageBoxes) as Box[][]) {
      const found = arr.find(b => b.id === firstId);
      if (found) {
        target = found.groupId;
        break;
      }
    }
    if (!target) return;
    const orderMap = new Map<string, number>(orderedIds.map((id, i) => [id, i]));
    setPageBoxes(prev => {
      const next: Record<number, Box[]> = {};
      for (const [k, list] of Object.entries(prev) as [string, Box[]][]) {
        next[+k] = list.map(b =>
          selectedIds.has(b.id)
            ? { ...b, groupId: target, groupOrder: orderMap.get(b.id) ?? 0 }
            : b
        );
      }
      return next;
    });
    setSelectedIds(new Set());
    setMsg(`✅ Обʼєднано ${selectedIds.size} зон в одну справу.`);
  };

  const ungroupAll = (groupId: string) => {
    setPageBoxes(prev => {
      const next: Record<number, Box[]> = {};
      for (const [k, list] of Object.entries(prev) as [string, Box[]][]) {
        next[+k] = list.map(b => (b.groupId === groupId ? { ...b, groupId: b.id } : b));
      }
      return next;
    });
  };

  // ---------- Експорт / імпорт сесії ----------
  const exportSession = () => {
    if (!pdfBase64 || !pdfName) {
      setMsg('Немає PDF для експорту.');
      return;
    }
    // Зберігаємо тільки сторінки, на яких є хоч одна лінія.
    const linesToSave: Record<number, LineSet> = {};
    for (const [k, ls] of Object.entries(pageLines) as [string, LineSet][]) {
      if (ls.v.length > 0 || ls.h.length > 0) linesToSave[parseInt(k, 10)] = ls;
    }
    const data: SessionFile = {
      version: SESSION_VERSION,
      savedAt: new Date().toISOString(),
      pdfName,
      pdfBase64,
      pageBoxes,
      ...(Object.keys(linesToSave).length > 0 ? { pageLines: linesToSave } : {}),
      meta: { archive, fund, opys },
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName = pdfName.replace(/\.pdf$/i, '');
    a.href = url;
    a.download = `${baseName}__session-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const linesPages = Object.keys(linesToSave).length;
    setMsg(
      `✅ Сесія експортована (${totalBoxes} зон на ${pagesWithBoxes.length} стор.` +
        (linesPages ? `; лінії на ${linesPages} стор.` : '') +
        ')'
    );
  };

  const importSession = async (file: File) => {
    setMsg('');
    try {
      const text = await file.text();
      const data: SessionFile = JSON.parse(text);
      if (!data?.pdfBase64 || !data?.pdfName) {
        throw new Error('Файл сесії пошкоджений (немає PDF)');
      }
      const buf = base64ToArrayBuffer(data.pdfBase64);
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      setPdf(doc);
      setPdfName(data.pdfName);
      setPdfBase64(data.pdfBase64);
      // Конвертуємо ключі обʼєкта (рядки) у числа.
      const restored: Record<number, Box[]> = {};
      Object.entries(data.pageBoxes || {}).forEach(([k, v]) => {
        const arr = (v as any[]) || [];
        // Backward-compat: старі сесії без id/groupId — генеруємо.
        restored[parseInt(k, 10)] = arr.map(b => {
          const id = b.id || newId();
          return { x: b.x, y: b.y, w: b.w, h: b.h, id, groupId: b.groupId || id };
        });
      });
      setPageBoxes(restored);
      // Відновлюємо лінії (з v2+; для v1 — просто буде {}).
      const restoredLines: Record<number, LineSet> = {};
      Object.entries(data.pageLines || {}).forEach(([k, v]) => {
        const ls = v as any;
        const vArr: number[] = Array.isArray(ls?.v) ? ls.v.filter((n: any) => typeof n === 'number') : [];
        const hRaw: any[] = Array.isArray(ls?.h) ? ls.h : [];
        // Backward-compat: якщо колись зберігали h як number[] — конвертуємо у HLine з x=0.5.
        const hArr: HLine[] = hRaw
          .map(item =>
            typeof item === 'number'
              ? { x: 0.5, y: item }
              : { x: Number(item?.x), y: Number(item?.y) }
          )
          .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (vArr.length > 0 || hArr.length > 0) {
          restoredLines[parseInt(k, 10)] = { v: vArr, h: hArr };
        }
      });
      setPageLines(restoredLines);
      if (data.meta) {
        if (data.meta.archive) setArchive(data.meta.archive);
        if (data.meta.fund) setFund(data.meta.fund);
        if (data.meta.opys) setOpys(data.meta.opys);
      }
      setPage(1);
      await renderPage(doc, 1);
      const totalRestored = Object.values(restored).reduce((s, b) => s + b.length, 0);
      const linesPages = Object.keys(restoredLines).length;
      setMsg(
        `✅ Сесія імпортована: ${totalRestored} зон на ${
          Object.keys(restored).filter(k => restored[+k].length > 0).length
        } стор.` + (linesPages ? `; лінії на ${linesPages} стор.` : '')
      );
    } catch (e: any) {
      setMsg('❌ Не вдалося імпортувати: ' + e.message);
    }
  };

  // Парсер "1-3,5,7-9" → [1,2,3,5,7,8,9]. Дублікати прибираються, сортується.
  const parsePageRange = (raw: string, maxPage: number): number[] => {
    const out = new Set<number>();
    raw.split(',').forEach(part => {
      const t = part.trim();
      if (!t) return;
      const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        const a = Math.max(1, parseInt(m[1], 10));
        const b = Math.min(maxPage, parseInt(m[2], 10));
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
      } else if (/^\d+$/.test(t)) {
        const n = parseInt(t, 10);
        if (n >= 1 && n <= maxPage) out.add(n);
      }
    });
    return [...out].sort((a, b) => a - b);
  };

  const runAuto = async () => {
    if (!pdf || !activeApiKey) {
      setMsg('Потрібно: відкритий PDF + Gemini API key');
      return;
    }
    let pages = autoRange.trim()
      ? parsePageRange(autoRange, pdf.numPages)
      : [page];
    if (pages.length === 0) {
      setMsg('❌ Невалідний діапазон. Приклади: "1-10", "3,5,7", "1-5, 8, 10-12"');
      return;
    }
    // Опція «продовжити» — пропускаємо сторінки які вже мають зони.
    if (skipExisting) {
      const before = pages.length;
      pages = pages.filter(p => !(pageBoxes[p] && pageBoxes[p].length > 0));
      if (pages.length === 0) {
        setMsg(`Усі ${before} сторінок діапазону вже мають зони. Зніміть «пропускати» щоб переробити.`);
        return;
      }
    }
    if (
      pages.length > 50 &&
      !confirm(`Розпізнати ${pages.length} сторінок через Gemini? Це може зайняти час і витратити квоту.`)
    ) {
      return;
    }

    setBusy(true);
    setMsg('');
    setAutoProgress({ done: 0, total: pages.length });
    let totalFound = 0;
    let errors = 0;
    const newLogs: LogEntry[] = [];
    try {
      for (let i = 0; i < pages.length; i++) {
        const pageNum = pages[i];
        setAutoProgress({ done: i, total: pages.length, page: pageNum });
        try {
          const dataUrl = pageNum === page ? pageImage : await renderPageToDataUrl(pdf, pageNum);
          const base64 = dataUrl.split(',')[1];
          const r = await detectViaGemini(base64, 'image/jpeg', activeApiKey);
          const found: Box[] = (r.boxes || []).map(b => {
            const id = newId();
            return { x: b.x, y: b.y, w: b.w, h: b.h, id, groupId: id };
          });
          setBoxesForPage(pageNum, () => found);
          totalFound += found.length;
          newLogs.push({
            page: pageNum,
            model: r.model || '',
            count: found.length,
            raw: r.raw || '',
            ts: new Date().toLocaleTimeString(),
          });
        } catch (e: any) {
          errors++;
          console.error(`detect failed on page ${pageNum}:`, e);
          newLogs.push({
            page: pageNum,
            model: '',
            count: 0,
            raw: '',
            error: e?.message || 'unknown',
            ts: new Date().toLocaleTimeString(),
          });
        }
      }
      setAutoProgress({ done: pages.length, total: pages.length });
      // Показуємо лог автоматично після першого запуску
      setRecogLog(prev => [...newLogs, ...prev].slice(0, 50));
      setShowLog(true);
      const errSuffix = errors > 0 ? `, помилок: ${errors}` : '';
      setMsg(
        pages.length === 1
          ? `✅ Знайдено ${totalFound} зон. Перевірте і скоригуйте. Деталі в розділі «Лог».`
          : `✅ Опрацьовано ${pages.length} сторінок, знайдено ${totalFound} зон${errSuffix}. Деталі в розділі «Лог».`
      );
    } finally {
      setBusy(false);
      setTimeout(() => setAutoProgress(null), 1200);
    }
  };

  // Кропає bbox з заданого jpeg-dataURL (а не з поточної відкритої сторінки).
  // Рендерить будь-яку сторінку PDF у JPEG-dataURL.
  const renderPageToDataUrl = async (doc: any, pageNum: number): Promise<string> => {
    const p = await doc.getPage(pageNum);
    const viewport = p.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await p.render({ canvasContext: ctx, viewport, canvas }).promise;
    return canvas.toDataURL('image/jpeg', 0.92);
  };

  // Кропає bbox і повертає JPEG-dataURL (з префіксом).
  const cropBoxToDataUrl = async (sourceDataUrl: string, box: Box): Promise<string> => {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(box.w * img.width);
        canvas.height = Math.round(box.h * img.height);
        const ctx = canvas.getContext('2d')!;
        if (box.rotation) {
          // Розкручуємо джерело так, щоб повернутий прямокутник став вісь-вирівняним
          // у вихідному канвасі. Точне обернення трансформації, яку ми
          // використовуємо при рендері в редакторі.
          const cx = (box.x + box.w / 2) * img.width;
          const cy = (box.y + box.h / 2) * img.height;
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((-box.rotation * Math.PI) / 180);
          ctx.translate(-cx, -cy);
          ctx.drawImage(img, 0, 0);
        } else {
          ctx.drawImage(
            img,
            box.x * img.width,
            box.y * img.height,
            box.w * img.width,
            box.h * img.height,
            0,
            0,
            canvas.width,
            canvas.height
          );
        }
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = sourceDataUrl;
    });
  };

  // Склеює кілька JPEG-зображень вертикально в одне (нормалізує ширину).
  const stackImagesVertically = async (dataUrls: string[]): Promise<string> => {
    if (dataUrls.length === 1) return dataUrls[0].split(',')[1];
    const imgs = await Promise.all(
      dataUrls.map(
        src =>
          new Promise<HTMLImageElement>(res => {
            const im = new Image();
            im.onload = () => res(im);
            im.src = src;
          })
      )
    );
    const targetWidth = Math.max(...imgs.map(im => im.width));
    const totalHeight = imgs.reduce(
      (s, im) => s + Math.round(im.height * (targetWidth / im.width)),
      0
    );
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d')!;
    let y = 0;
    for (const im of imgs) {
      const h = Math.round(im.height * (targetWidth / im.width));
      ctx.drawImage(im, 0, y, targetWidth, h);
      y += h;
    }
    return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
  };

  const uploadAll = async () => {
    if (totalBoxes === 0) {
      setMsg('Немає зон для завантаження.');
      return;
    }
    if (!metaValid) {
      setMsg('❌ Заповніть Архів / Фонд / Опис перед завантаженням.');
      return;
    }

    // Дефолтний режим — колективний. Якщо обрано інший, перепитуємо.
    if (batchMode !== 'collaborative') {
      const ok = window.confirm(
        'За замовчуванням рекомендується колективний режим (один варіант + підтвердження).\n\n' +
          'Ви обрали "Паралельний" — кожен користувач писатиме власний варіант (≥3 версії на справу). Продовжити?'
      );
      if (!ok) return;
    }

    // Кешуємо зображення сторінок щоб не рендерити одну і ту саму двічі
    // (у випадку груп з кількома зонами на одній сторінці).
    const pageCache = new Map<number, string>();
    const getPageImage = async (p: number): Promise<string> => {
      if (pageCache.has(p)) return pageCache.get(p)!;
      const dataUrl = p === page ? pageImage : await renderPageToDataUrl(pdf, p);
      pageCache.set(p, dataUrl);
      return dataUrl;
    };

    // Збираємо групи (одна група = одна справа в каналі).
    const groupsArr = [...groups.entries()].map(([gid, items]) => ({ gid, items }));
    const total = groupsArr.length;

    setBusy(true);
    setUploadDone(null);
    setMsg('');
    setUploadProgress({ done: 0, total });
    let done = 0;
    try {
      for (const { gid, items } of groupsArr) {
        // items уже відсортовані по (page, y).
        const crops: string[] = [];
        for (const it of items) {
          const dataUrl = await getPageImage(it.page);
          crops.push(await cropBoxToDataUrl(dataUrl, it.box));
        }
        const finalBase64 = await stackImagesVertically(crops);
        const firstPage = items[0].page;
        const allPages = [...new Set(items.map(i => i.page))];
        await tgApi.uploadCase({
          imageBase64: finalBase64,
          mime: 'image/jpeg',
          sourcePdf: pdfName,
          page: allPages.length > 1 ? allPages.join(',') : firstPage,
          bbox: { groupId: gid, parts: items.map(i => ({ page: i.page, ...i.box })) },
          archive: archive.trim(),
          fund: fund.trim(),
          opys: opys.trim(),
          mode: batchMode,
        });
        done++;
        setUploadProgress({ done, total });
        // Прибираємо успішно завантажені зони з UI — щоб ретрай не дублював.
        setPageBoxes(prev => {
          const next: Record<number, Box[]> = {};
          for (const [k, list] of Object.entries(prev) as [string, Box[]][]) {
            const filtered = list.filter(b => b.groupId !== gid);
            if (filtered.length > 0) next[+k] = filtered;
          }
          return next;
        });
      }
      setSelectedIds(new Set());
      setUploadDone({ count: done });
    } catch (e: any) {
      setMsg(
        `❌ ${e.message}\nЗавантажено: ${done}/${total} справ. ` +
          `Незавантажені зони лишилися — натисніть «Завантажити» ще раз, продовжимо з того ж місця.`
      );
    } finally {
      setBusy(false);
      setTimeout(() => setUploadProgress(null), 800);
    }
  };

  return (
    <div className="space-y-2">
      {/* Архівні реквізити — обовʼязкові, спільні для всієї пачки.
          Коли все заповнено і PDF відкрито, згортаємо в один компактний рядок. */}
      {metaCollapsed && metaValid ? (
        <section className="border rounded px-3 py-1.5 bg-slate-50 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-slate-500">Опис:</span>
          <span className="font-medium text-slate-800">
            {archive.trim()} {fund.trim()}-{opys.trim()}
          </span>
          <span className="text-slate-400">•</span>
          <span className="text-slate-500">Режим:</span>
          <span className="font-medium text-slate-800">
            {batchMode === 'collaborative' ? 'Колективний' : 'Паралельний'}
          </span>
          <button
            onClick={() => setMetaCollapsed(false)}
            className="ml-auto px-2 py-1 bg-white border border-slate-300 rounded text-slate-700 hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700"
            title="Розгорнути блок реквізитів і режиму для редагування"
          >
            ✎ Змінити реквізити / режим
          </button>
        </section>
      ) : (
      <section className={`border rounded p-3 ${metaValid ? 'bg-slate-50' : 'bg-amber-50 border-amber-300'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Архівні реквізити (обовʼязкові)</div>
          <div className="flex items-center gap-3">
            {!metaValid && (
              <div className="text-xs text-amber-700">⚠ Заповніть усі 3 поля перед завантаженням</div>
            )}
            {metaValid && (
              <button
                onClick={() => setMetaCollapsed(true)}
                className="text-xs text-slate-500 hover:text-indigo-700"
                title="Згорнути"
              >
                ▲ Згорнути
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            value={archive}
            onChange={e => setArchive(e.target.value)}
            placeholder="Архів *"
            className={`border rounded px-2 py-1.5 text-sm ${!archive.trim() ? 'border-amber-400' : ''}`}
          />
          <input
            value={fund}
            onChange={e => setFund(e.target.value)}
            placeholder="Фонд *"
            className={`border rounded px-2 py-1.5 text-sm ${!fund.trim() ? 'border-amber-400' : ''}`}
          />
          <input
            value={opys}
            onChange={e => setOpys(e.target.value)}
            placeholder="Опис *"
            className={`border rounded px-2 py-1.5 text-sm ${!opys.trim() ? 'border-amber-400' : ''}`}
          />
        </div>
        <div className="text-xs text-slate-500 mt-1.5">
          Усі справи з цього PDF будуть приписані до опису "{archive.trim() || '...'} {fund.trim() || '...'}-{opys.trim() || '...'}".
        </div>
        <div className="mt-3 pt-3 border-t border-slate-200">
          <div className="text-xs font-medium text-slate-700 mb-1">Режим обробки для цієї пачки:</div>
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="batchMode"
                value="parallel"
                checked={batchMode === 'parallel'}
                onChange={() => setBatchMode('parallel')}
              />
              <span><b>Паралельний</b> — кожен юзер пише власний варіант (≥3 версії)</span>
            </label>
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="batchMode"
                value="collaborative"
                checked={batchMode === 'collaborative'}
                onChange={() => setBatchMode('collaborative')}
              />
              <span><b>Колективний</b> — один варіант, інші підтверджують/редагують</span>
            </label>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Режим фіксується при завантаженні справи. Поточні справи в БД не змінюються.
          </div>
        </div>
      </section>
      )}

      {/* Дропзона */}
      {!pdf && (
        <div className="space-y-2">
          <label
            onDragOver={e => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) loadPdf(f);
            }}
            className={`flex flex-col items-center justify-center gap-2 p-10 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              dragOver ? 'bg-indigo-50 border-indigo-400' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'
            }`}
          >
            <UploadCloud size={36} className="text-slate-400" />
            <div className="text-sm font-medium">Натисніть або перетягніть PDF сюди</div>
            <div className="text-xs text-slate-500">Файл буде нарізано на справи і завантажено в канал</div>
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={e => e.target.files?.[0] && loadPdf(e.target.files[0])}
            />
          </label>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>або</span>
            <button
              onClick={() => importInputRef.current?.click()}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 font-medium"
            >
              📂 Відновити збережену сесію (.json)
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={e => e.target.files?.[0] && importSession(e.target.files[0])}
            />
          </div>
        </div>
      )}

      {pdf && (
        <div className="space-y-2">
          <div className="flex gap-3 items-center flex-wrap">
            <div className="text-sm font-medium truncate max-w-xs" title={pdfName}>
              📄 {pdfName}
            </div>
            <button
              onClick={() => {
                if (totalBoxes > 0 && !confirm(`Скинути ${totalBoxes} зон і змінити PDF?`)) return;
                setPdf(null);
                setPdfName('');
                setPageImage('');
                setPageBoxes({});
              }}
              className="text-xs text-slate-500 hover:text-red-600"
            >
              змінити PDF
            </button>
            <div className="flex-1" />
            <button onClick={() => setPage(p => Math.max(1, p - 1))} className="px-2 py-1 bg-slate-200 rounded">
              ←
            </button>
            <span className="text-sm font-mono">
              Стор. {page} / {pdf.numPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(pdf.numPages, p + 1))}
              className="px-2 py-1 bg-slate-200 rounded"
            >
              →
            </button>
            <select
              value={mode}
              onChange={e => setMode(e.target.value as any)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="manual">Ручний</option>
              <option value="auto">Авто (AI)</option>
            </select>
            {mode === 'auto' && (
              <>
                <label
                  className="flex items-center gap-1 text-xs text-slate-600"
                  title="Не запускати розпізнавання на сторінках, які вже мають зони"
                >
                  <input
                    type="checkbox"
                    checked={skipExisting}
                    onChange={e => setSkipExisting(e.target.checked)}
                  />
                  пропускати
                </label>
                <input
                  value={autoRange}
                  onChange={e => setAutoRange(e.target.value)}
                  placeholder={`сторінки (напр. 1-${pdf.numPages})`}
                  title={'Порожньо — поточна сторінка. Формат: "1-10", "3,5,7", "1-5,8,10-12"'}
                  className="border rounded px-2 py-1 text-sm w-44"
                />
                <button
                  onClick={() => setAutoRange(`1-${pdf.numPages}`)}
                  className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded hover:bg-slate-200"
                  title="Усі сторінки PDF"
                >
                  усі
                </button>
                <button
                  onClick={runAuto}
                  disabled={busy || !activeApiKey}
                  title={!activeApiKey ? 'Введіть Gemini API key' : ''}
                  className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded flex items-center gap-1 disabled:opacity-50"
                >
                  <Wand2 size={14} />{' '}
                  {autoRange.trim() ? 'Розпізнати діапазон' : 'Розпізнати'}
                </button>
              </>
            )}
            <button
              onClick={exportSession}
              disabled={!pdfBase64}
              className="px-2.5 py-1.5 bg-slate-200 text-slate-700 text-xs rounded hover:bg-slate-300 disabled:opacity-50"
              title="Зберегти PDF + усі зони у файл .json для продовження пізніше"
            >
              💾 Експорт
            </button>
            {viewMode === 'admin' && (
              <button
                onClick={uploadAll}
                disabled={busy || totalBoxes === 0 || !metaValid}
                title={!metaValid ? 'Заповніть Архів / Фонд / Опис' : ''}
                className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded flex items-center gap-1 disabled:opacity-50"
              >
                <UploadCloud size={14} />{' '}
                {totalBoxes !== groups.size
                  ? `Завантажити (${groups.size} справ із ${totalBoxes} зон)`
                  : `Завантажити всі (${totalBoxes})`}
              </button>
            )}
          </div>

          {/* Бейджи сторінок з зонами — швидка навігація */}
          {pagesWithBoxes.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center text-xs text-slate-600">
              <span>Сторінки з зонами:</span>
              {pagesWithBoxes.map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-2 py-0.5 rounded border ${
                    p === page ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-300 hover:border-indigo-400'
                  }`}
                  title={`Перейти на сторінку ${p}`}
                >
                  {p} <span className="opacity-70">({pageBoxes[p].length})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pageImage && (
        // translate="no" — критично: при увімкненому Google Translate / розширеннях,
        // що підмінюють текстові вузли (типу V={count}), React падає з
        // «Failed to execute removeChild». Робочий регіон редактора не перекладаємо.
        <div className="space-y-1.5" translate="no">
          {/* Перемикач режиму введення */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-500">Режим:</span>
            <div className="inline-flex rounded border border-slate-300 overflow-hidden text-xs">
              <button
                onClick={() => setInputMode('zones')}
                className={`px-3 py-0.5 ${inputMode === 'zones' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
              >
                Зони
              </button>
              <button
                onClick={() => setInputMode('lines')}
                className={`px-3 py-0.5 border-l border-slate-300 ${inputMode === 'lines' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
              >
                Лінії
              </button>
            </div>
            {inputMode === 'lines' && (
              <span
                className="text-xs text-slate-500 truncate"
                title={
                  'Клік зверху/знизу (15% висоти) — вертикальна (макс 4); після 4 — будь-який клік дає горизонтальну. ' +
                  'Вертикалі паруються: [1 ... 1], [2 ... 2] = смуги. Горизонталі живуть у своїй смузі. Зони — між сусідніми горизонталями.'
                }
              >
                клік зверху/знизу — V • далі — H • перетини = авто-зони ⓘ
              </span>
            )}
          </div>
          <p
            className="text-xs text-slate-500 truncate"
            title={
              inputMode === 'zones'
                ? 'Малюйте прямокутники мишкою навколо кожної справи. Натисніть червоний хрестик у куті зони — видалити її. Зони зберігаються при перемиканні сторінок.'
                : 'Тягніть лінію — посунути; клац на червоний хрестик — видалити. Перетин пар вертикальних і горизонтальних — авто-зона (зелений пунктир).'
            }
          >
            {inputMode === 'zones'
              ? 'Малюйте прямокутники навколо справ • × у куті — видалити • зони зберігаються між сторінками'
              : 'Тягніть лінію — посунути • × — видалити • перетин V/H — авто-зона'}
          </p>
          <div className="border rounded bg-slate-50 max-h-[82vh] overflow-auto">
            <canvas
              ref={canvasRef}
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={() => { actionRef.current = null; lineDragRef.current = null; setLineHoverAxis(null); }}
              className={`block mx-auto ${
                inputMode === 'lines' && lineHoverAxis === 'v' ? 'cursor-ew-resize' :
                inputMode === 'lines' && lineHoverAxis === 'h' ? 'cursor-ns-resize' :
                'cursor-crosshair'
              }`}
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          </div>
          {/* Lines mode toolbar */}
          {inputMode === 'lines' && (() => {
            const ls = pageLines[page] || { v: [], h: [] };
            const previewCount = linesToZones(ls).length;
            const totalPreview = (Object.values(pageLines) as LineSet[]).reduce(
              (s, l) => s + linesToZones(l).length,
              0
            );
            return (
              <div className="flex flex-wrap gap-2 items-center bg-emerald-50 border border-emerald-300 rounded p-2 text-xs" translate="no">
                <span>
                  {`На сторінці: V=${ls.v.length}, H=${ls.h.length} → авто-зон: `}
                  <b>{previewCount}</b>
                </span>
                <button
                  onClick={clearLinesPage}
                  disabled={ls.v.length === 0 && ls.h.length === 0}
                  className="px-2 py-1 bg-white border border-slate-300 rounded text-xs disabled:opacity-50"
                >
                  Очистити лінії на сторінці
                </button>
                <span className="ml-auto flex items-center gap-1">
                  <span>Застосувати до всіх сторінок:</span>
                  <select
                    value={applyAllAxis}
                    onChange={e => setApplyAllAxis(e.target.value as 'vertical' | 'all')}
                    className="border rounded px-1 py-0.5"
                  >
                    <option value="vertical">тільки вертикальні</option>
                    <option value="all">всі (V + H)</option>
                  </select>
                  <button
                    onClick={applyLinesToAllPages}
                    disabled={ls.v.length === 0 && ls.h.length === 0}
                    className="px-2 py-1 bg-slate-700 text-white rounded text-xs disabled:opacity-50"
                  >
                    Застосувати
                  </button>
                </span>
                <button
                  onClick={materializeCurrentPage}
                  disabled={previewCount === 0}
                  className="px-3 py-1 bg-emerald-500 text-white rounded text-xs disabled:opacity-50"
                  title="Перетворити лінії поточної сторінки у звичайні зони"
                >
                  ✓ Перевести в зони на цій сторінці ({previewCount})
                </button>
                <button
                  onClick={materializeAll}
                  disabled={totalPreview === 0}
                  className="px-3 py-1 bg-emerald-600 text-white rounded text-xs disabled:opacity-50"
                  title="Перетворити лінії всіх сторінок у звичайні зони"
                >
                  ✓ Перевести в зони скрізь ({totalPreview})
                </button>
              </div>
            );
          })()}
          {/* Панель виділення / обʼєднання */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap gap-2 items-center bg-amber-50 border border-amber-300 rounded p-2 text-sm">
              <span className="font-medium">Виділено: {selectedIds.size}</span>
              <button
                onClick={mergeSelected}
                disabled={selectedIds.size < 2}
                className="px-3 py-1 bg-amber-600 text-white rounded text-xs disabled:opacity-50"
                title="Обʼєднати всі виділені зони в одну справу (склеяться як одне зображення)"
              >
                🔗 Обʼєднати в одну справу
              </button>
              {/* Поворот — застосовується до всіх виділених зон. */}
              {(() => {
                const rotateSelected = (delta: number, set?: number) => {
                  setBoxesForPage(page, prev =>
                    prev.map(b => {
                      if (!selectedIds.has(b.id)) return b;
                      const cur = b.rotation || 0;
                      let next = set !== undefined ? set : cur + delta;
                      // Нормалізуємо в [-180, 180].
                      next = ((next + 540) % 360) - 180;
                      // Округляємо «чисто 0» щоб не тягати дробові.
                      if (Math.abs(next) < 0.001) next = 0;
                      return { ...b, rotation: next };
                    })
                  );
                };
                const firstSel = boxes.find(b => selectedIds.has(b.id));
                const angle = firstSel?.rotation || 0;
                return (
                  <span className="inline-flex items-center gap-1 border-l border-amber-300 pl-2 ml-1">
                    <span className="text-xs text-slate-700">Поворот:</span>
                    <button onClick={() => rotateSelected(-15)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs" title="−15°">↺15°</button>
                    <button onClick={() => rotateSelected(-1)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs" title="−1°">↺1°</button>
                    <span className="font-mono text-xs w-12 text-center">{angle.toFixed(1)}°</span>
                    <button onClick={() => rotateSelected(+1)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs" title="+1°">↻1°</button>
                    <button onClick={() => rotateSelected(+15)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs" title="+15°">↻15°</button>
                    <button onClick={() => rotateSelected(0, 0)} className="px-2 py-1 bg-slate-200 rounded text-xs" title="Скинути до 0°">×</button>
                  </span>
                );
              })()}
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1 bg-slate-200 rounded text-xs"
              >
                Зняти виділення
              </button>
              <span className="text-xs text-slate-600">
                Підказка: клац всередині зони — виділити; клац на хрестик — видалити; зони можна виділяти на різних сторінках.
              </span>
            </div>
          )}

          {boxes.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-xs text-slate-500 mr-1">Зони на цій сторінці:</span>
              {boxes.map((b, i) => {
                const inGroup = (groups.get(b.groupId)?.length || 0) > 1;
                const sel = selectedIds.has(b.id);
                return (
                  <button
                    key={b.id}
                    onClick={() => toggleSelected(b.id)}
                    onDoubleClick={() => removeBox(i)}
                    className={`px-2 py-1 rounded text-xs ${
                      sel ? 'bg-amber-300 text-amber-900' : 'bg-indigo-100 text-indigo-700 hover:bg-amber-100'
                    }`}
                    title="Клац — виділити; Подвійний клац — видалити"
                    style={inGroup ? { borderLeft: `3px solid ${colorFromId(b.groupId)}` } : undefined}
                  >
                    #{i + 1}
                    {inGroup && ' 🔗'}
                  </button>
                );
              })}
              <button
                onClick={clearPage}
                className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs hover:bg-red-100 hover:text-red-700 ml-2"
              >
                Очистити сторінку
              </button>
            </div>
          )}

          {/* Панель крос-сторінкових груп */}
          {multiBoxGroups.length > 0 && (
            <div className="border rounded p-2 bg-slate-50 space-y-1 text-xs">
              <div className="font-medium text-slate-700">
                🔗 Обʼєднані справи ({multiBoxGroups.length})
              </div>
              {multiBoxGroups.map(([gid, items]) => (
                <div
                  key={gid}
                  className="flex items-center gap-2 py-1 border-l-4 pl-2"
                  style={{ borderColor: colorFromId(gid) }}
                >
                  <span className="text-slate-700">
                    {items.length} зон:{' '}
                    {items.map(it => `стор. ${it.page}`).join(' + ')}
                  </span>
                  <button
                    onClick={() => ungroupAll(gid)}
                    className="ml-auto text-slate-500 hover:text-red-600"
                    title="Розгрупувати — кожна зона стане окремою справою"
                  >
                    розгрупувати
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Прогрес-бар */}
      {/* Лог розпізнавання */}
      {recogLog.length > 0 && (
        <div className="border rounded">
          <button
            onClick={() => setShowLog(s => !s)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm bg-slate-50 hover:bg-slate-100"
          >
            <span className="font-medium">
              📜 Лог розпізнавання ({recogLog.length})
            </span>
            <span className="text-xs text-slate-500">
              {showLog ? 'сховати ▲' : 'показати ▼'}
            </span>
          </button>
          {showLog && (
            <div className="p-3 space-y-2 max-h-96 overflow-auto">
              <div className="flex justify-end">
                <button
                  onClick={() => setRecogLog([])}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  очистити лог
                </button>
              </div>
              {recogLog.map((l, i) => (
                <details key={i} className="border rounded">
                  <summary className="cursor-pointer px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-slate-50">
                    <span className="font-mono text-slate-500">{l.ts}</span>
                    <span className="font-medium">стор. {l.page}</span>
                    <span className="text-slate-500">{l.model}</span>
                    {l.error ? (
                      <span className="text-red-600">❌ {l.error}</span>
                    ) : (
                      <span className={l.count > 0 ? 'text-green-700' : 'text-amber-700'}>
                        {l.count > 0 ? `✅ ${l.count} зон` : '⚠ 0 зон'}
                      </span>
                    )}
                  </summary>
                  <pre className="text-[11px] bg-slate-50 p-2 overflow-auto whitespace-pre-wrap max-h-60">
                    {l.raw || '(порожня відповідь)'}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Прогрес авто-розпізнавання */}
      {autoProgress && (
        <div className="border rounded p-3 bg-white shadow-sm space-y-2 sticky bottom-2">
          <div className="flex items-center justify-between text-sm">
            <span>
              🤖 Розпізнавання Gemini{autoProgress.page ? ` (стор. ${autoProgress.page})` : ''}…
            </span>
            <span className="font-mono">
              {autoProgress.done} / {autoProgress.total}
            </span>
          </div>
          <div className="h-2 bg-slate-200 rounded overflow-hidden">
            <div
              className="h-full bg-purple-600 transition-all"
              style={{ width: `${(autoProgress.done / Math.max(1, autoProgress.total)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {uploadProgress && (
        <div className="border rounded p-3 bg-white shadow-sm space-y-2 sticky bottom-2">
          <div className="flex items-center justify-between text-sm">
            <span>Завантаження в канал…</span>
            <span className="font-mono">
              {uploadProgress.done} / {uploadProgress.total}
            </span>
          </div>
          <div className="h-2 bg-slate-200 rounded overflow-hidden">
            <div
              className="h-full bg-indigo-600 transition-all"
              style={{
                width: `${(uploadProgress.done / Math.max(1, uploadProgress.total)) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {uploadDone && (
        <div className="border-2 border-green-500 bg-green-50 rounded p-3 text-sm text-green-800 font-medium">
          ✅ Готово: завантажено {uploadDone.count} справ у канал.
        </div>
      )}

      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
};

// ==================== RESULTS ====================

const ResultsView: React.FC = () => {
  const [data, setData] = useState<{ questions: any[]; submissions: any[] } | null>(null);
  const [allDescriptions, setAllDescriptions] = useState<{ key: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [limit, setLimit] = useState(500);
  // Введені значення фільтрів (керовані інпути).
  const [filterInput, setFilterInput] = useState('');
  const [descFilterInput, setDescFilterInput] = useState('');
  // Застосовані фільтри — саме за ними рендериться таблиця. Оновлюються
  // лише по кнопці «Застосувати» або при оновленні даних.
  const [filter, setFilter] = useState('');
  const [descFilter, setDescFilter] = useState('');

  const applyFilters = () => {
    setFilter(filterInput);
    setDescFilter(descFilterInput);
  };

  // Завантаження списку описів — потрібно для випадного фільтра, легкий запит.
  const loadOverview = async () => {
    try {
      const ov = await tgApi.overview();
      setAllDescriptions(
        (ov.descriptions || []).map((d: any) => ({ key: d.key, name: d.name }))
      );
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    }
  };

  // Завантаження самих результатів — викликається лише за кнопкою.
  const loadResults = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await tgApi.results(limit);
      setData({ questions: r.questions || [], submissions: r.submissions || [] });
      setTableVisible(true);
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Видимість таблиці результатів — за замовч. сховано, щоб не вантажити сторінку.
  const [tableVisible, setTableVisible] = useState(false);

  // Статистика «сьогодні» — окремий запит до БД, не залежить від фільтрів/ліміту.
  const [todayStats, setTodayStats] = useState<{ cases: number; users: number; timezone: string } | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsErr, setStatsErr] = useState('');

  const loadTodayStats = async () => {
    setStatsBusy(true);
    setStatsErr('');
    try {
      const r = await tgApi.todayStats();
      setTodayStats(r);
    } catch (e: any) {
      setStatsErr(e?.message || 'помилка');
    } finally {
      setStatsBusy(false);
    }
  };

  useEffect(() => {
    loadTodayStats();
  }, []);

  const descKeyOf = (s: any) => `${s.archive || ''}|${s.fund || ''}|${s.opys || ''}`;
  const descNameOf = (s: any) => `${s.archive || ''} ${s.fund || ''}-${s.opys || ''}`;

  const buildHeaders = (questions: any[]) => [
    'submitted_at',
    'Тип',
    'Автор',
    'Перевірили',
    'Опис',
    'Файл',
    'Сторінка',
    ...questions.map((q: any, i: number) => q.label || `Q${i + 1}`),
    'case_id',
    'source_link',
  ];

  const summarizeConfirmations = (s: any): string => {
    if (!s.is_collab) return '';
    const list: any[] = Array.isArray(s.confirmations) ? s.confirmations : [];
    const reviewers = list
      .filter(x => x.kind === 'confirm' || x.kind === 'edit')
      .map(x => `${x.display_name || x.tg_id}${x.kind === 'edit' ? ' (правка)' : ''}`);
    const cnt = s.confirmations_count ?? 0;
    const head = `${cnt} підтв.${s.case_status === 'done' ? ' ✓' : ''}`;
    return reviewers.length ? `${head} • ${reviewers.join(', ')}` : head;
  };

  const buildRow = (s: any, questions: any[]) => {
    const answers = Array.isArray(s.answers) ? s.answers : [];
    return [
      s.submitted_at || '',
      s.is_collab ? 'collab' : 'parallel',
      `${s.display_name || ''}${s.tg_id ? ` (${s.tg_id})` : ''}`,
      summarizeConfirmations(s),
      descNameOf(s),
      s.source_pdf || '',
      s.page || '',
      ...questions.map((_: any, i: number) => String(answers[i] ?? '')),
      s.case_id || '',
      s.source_link || '',
    ];
  };

  // Усі описи (із Огляду) — щоб у фільтрі бачити навіть ті, які ще не мають
  // підтверджень у поточному ліміті завантаження.
  const descriptions: [string, string][] = allDescriptions
    .map(d => [d.key, d.name] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));

  const selectedDescriptionName = descFilter
    ? descriptions.find(([k]) => k === descFilter)?.[1] || ''
    : '';

  const filtered = data
    ? data.submissions.filter(s => {
        if (descFilter && descKeyOf(s) !== descFilter) return false;
        if (!filter.trim()) return true;
        const q = filter.toLowerCase();
        const row = buildRow(s, data.questions);
        return row.some(c => String(c).toLowerCase().includes(q));
      })
    : [];

  const downloadCsv = (rowsSource: any[], suffix: string) => {
    if (!data) return;
    const headers = buildHeaders(data.questions);
    const rows = rowsSource.map(s => buildRow(s, data.questions));
    const all = [headers, ...rows];
    const escape = (v: any) => {
      const s = String(v ?? '');
      // Подвоюємо лапки + загортаємо в лапки якщо є кома/перевід рядка/лапка.
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = all.map(r => r.map(escape).join(',')).join('\r\n');
    // BOM щоб Excel правильно відкривав UTF-8
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safe = suffix.replace(/[\\/:*?"<>|]+/g, '_').trim();
    a.href = url;
    a.download = `descriptor-results-${safe ? safe + '-' : ''}${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Експорт усіх записів вибраного опису (без обмеження поточним лімітом/фільтром).
  // Тягнемо ВСІ записи з БД через окремий ендпоінт із пагінацією, а не лише ті,
  // що потрапили у поточну вкладку «Результати» (обмежену limit-ом).
  const exportSelectedDescription = async () => {
    if (!data || !descFilter) return;
    const [archive, fund, opys] = descFilter.split('|');
    try {
      setBusy(true);
      setMsg('Завантажую всі підтвердження опису з БД…');
      const r = await tgApi.submissionsByDescription(archive, fund, opys);
      const rows = (r?.submissions || []) as any[];
      if (rows.length === 0) {
        setMsg(`⚠️ Для опису "${selectedDescriptionName}" у БД 0 підтверджень.`);
        return;
      }
      downloadCsv(rows, selectedDescriptionName);
      setMsg(`✅ Експортовано ${rows.length} рядків опису "${selectedDescriptionName}".`);
    } catch (e: any) {
      setMsg(`❌ Не вдалося експортувати опис: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-sm">
        <div className="border rounded px-3 py-1.5 bg-slate-50">
          Сьогодні опрацьовано справ: <b>{statsBusy ? '…' : todayStats?.cases ?? '—'}</b>
        </div>
        <div className="border rounded px-3 py-1.5 bg-slate-50">
          Сьогодні працювало користувачів: <b>{statsBusy ? '…' : todayStats?.users ?? '—'}</b>
        </div>
        <button
          onClick={loadTodayStats}
          disabled={statsBusy}
          className="px-2 py-1 text-xs rounded bg-slate-200 hover:bg-slate-300 disabled:opacity-50 self-center"
          title="Перерахувати статистику з БД"
        >
          <RefreshCw size={12} />
        </button>
        {statsErr && <span className="text-xs text-rose-700 self-center">{statsErr}</span>}
        {todayStats && (
          <span className="text-xs text-slate-500 self-center">
            ({todayStats.timezone})
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={loadResults}
          disabled={busy}
          className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm flex items-center gap-1"
        >
          <RefreshCw size={14} /> {busy ? 'Завантаження…' : tableVisible ? 'Оновити таблицю' : 'Показати результати'}
        </button>
        {tableVisible && (
          <button
            onClick={() => setTableVisible(false)}
            className="px-3 py-1.5 bg-slate-200 rounded text-sm"
            title="Сховати таблицю"
          >
            Сховати
          </button>
        )}
        <label className="text-sm text-slate-600">Ліміт:</label>
        <select
          value={limit}
          onChange={e => setLimit(parseInt(e.target.value, 10))}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value={100}>100</option>
          <option value={500}>500</option>
          <option value={2000}>2000</option>
          <option value={5000}>5000</option>
        </select>
        <select
          value={descFilterInput}
          onChange={e => setDescFilterInput(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="">Усі описи</option>
          {descriptions.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <input
          value={filterInput}
          onChange={e => setFilterInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') applyFilters();
          }}
          placeholder="Фільтр (текст у будь-якій колонці)"
          className="border rounded px-2 py-1 text-sm flex-1 min-w-[200px]"
        />
        <button
          onClick={applyFilters}
          disabled={!data}
          className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm disabled:opacity-50"
        >
          Застосувати
        </button>
        <button
          onClick={exportSelectedDescription}
          disabled={!data || !descFilter || busy}
          title={descFilter ? `Тягне з БД ВСІ підтвердження опису "${selectedDescriptionName}" (без обмеження поточним лімітом)` : 'Спочатку застосуйте фільтр з обраним описом'}
          className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm disabled:opacity-50"
        >
          Експорт усього опису (з БД)
        </button>
      </div>

      {msg && <div className="text-sm">{msg}</div>}

      {data && tableVisible && (
        <div className="border rounded overflow-auto max-h-[70vh]">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-100 sticky top-0">
              <tr>
                {buildHeaders(data.questions).map((h, i) => (
                  <th key={i} className="text-left p-2 border-b font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={buildHeaders(data.questions).length} className="p-4 text-center text-slate-500">
                    Немає записів
                  </td>
                </tr>
              )}
              {filtered.map((s, idx) => {
                const row = buildRow(s, data.questions);
                return (
                  <tr key={s.id ?? idx} className="border-b hover:bg-slate-50">
                    {row.map((c, i) => (
                      <td key={i} className="p-2 align-top max-w-xs truncate" title={String(c)}>
                        {i === row.length - 1 && c ? (
                          <a href={String(c)} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
                            відкрити
                          </a>
                        ) : (
                          String(c)
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ==================== OVERVIEW ====================

type DescFilter = 'all' | 'done' | 'pending';
const DESC_PAGE_SIZE = 50;
const USERS_PAGE_SIZE = 100;

const OverviewView: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [descFilter, setDescFilter] = useState<DescFilter>('all');
  const [descPage, setDescPage] = useState(1);
  const [usersPage, setUsersPage] = useState(1);

  const refresh = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await tgApi.overview();
      setData(r);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setDescPage(1);
  }, [descFilter]);

  const filteredDescriptions = useMemo(() => {
    const list: any[] = Array.isArray(data?.descriptions) ? data.descriptions : [];
    if (descFilter === 'done') return list.filter(d => d.doneCases >= d.totalCases && d.totalCases > 0);
    if (descFilter === 'pending') return list.filter(d => d.doneCases < d.totalCases);
    return list;
  }, [data, descFilter]);

  const descTotalPages = Math.max(1, Math.ceil(filteredDescriptions.length / DESC_PAGE_SIZE));
  const descPageSafe = Math.min(descPage, descTotalPages);
  const descPageRows = filteredDescriptions.slice(
    (descPageSafe - 1) * DESC_PAGE_SIZE,
    descPageSafe * DESC_PAGE_SIZE
  );

  const usersList: any[] = Array.isArray(data?.users) ? data.users : [];
  const usersTotalPages = Math.max(1, Math.ceil(usersList.length / USERS_PAGE_SIZE));
  const usersPageSafe = Math.min(usersPage, usersTotalPages);
  const usersPageRows = usersList.slice(
    (usersPageSafe - 1) * USERS_PAGE_SIZE,
    usersPageSafe * USERS_PAGE_SIZE
  );

  return (
    <div className="space-y-4 max-w-4xl">
      <button onClick={refresh} disabled={busy} className="px-3 py-1.5 bg-slate-200 rounded text-sm flex items-center gap-1">
        <RefreshCw size={14} /> Оновити
      </button>
      {msg && <div className="text-sm">{msg}</div>}
      {data && (
        <>
          <section>
            <h3 className="font-semibold mb-2">Прогрес</h3>
            <div className="bg-slate-50 border rounded p-3 text-sm space-y-2">
              <div>
                Повністю розпізнано описів: <b>{data.fullyDoneDescriptions ?? 0}</b> з{' '}
                {(data.descriptions || []).length}. Усього справ: {data.cases}.
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-600">Показати:</span>
                {([
                  ['all', 'Всі'],
                  ['pending', 'Незавершені'],
                  ['done', 'Завершені'],
                ] as [DescFilter, string][]).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setDescFilter(k)}
                    className={`px-2 py-1 rounded border ${
                      descFilter === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="ml-auto text-slate-500">
                  {filteredDescriptions.length === 0
                    ? 'нічого не знайдено'
                    : `${(descPageSafe - 1) * DESC_PAGE_SIZE + 1}–${Math.min(
                        descPageSafe * DESC_PAGE_SIZE,
                        filteredDescriptions.length
                      )} з ${filteredDescriptions.length}`}
                </span>
              </div>
              {descPageRows.length > 0 && (
                <table className="w-full text-xs border-collapse mt-1">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="text-left p-1.5">Опис</th>
                      <th className="text-right p-1.5 whitespace-nowrap">Готово</th>
                      <th className="text-right p-1.5 whitespace-nowrap">Справ</th>
                      <th className="text-right p-1.5 whitespace-nowrap">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {descPageRows.map((d: any) => (
                      <tr key={d.key} className="border-b">
                        <td className="p-1.5">{d.name}</td>
                        <td className="p-1.5 text-right">{d.doneCases}</td>
                        <td className="p-1.5 text-right">{d.totalCases}</td>
                        <td className="p-1.5 text-right">{d.donePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {descTotalPages > 1 && (
                <div className="flex items-center justify-end gap-1 text-xs pt-1">
                  <button
                    onClick={() => setDescPage(p => Math.max(1, p - 1))}
                    disabled={descPageSafe <= 1}
                    className="px-2 py-1 rounded border bg-white disabled:opacity-40"
                  >
                    ← Назад
                  </button>
                  <span className="px-2">
                    Стор. {descPageSafe} / {descTotalPages}
                  </span>
                  <button
                    onClick={() => setDescPage(p => Math.min(descTotalPages, p + 1))}
                    disabled={descPageSafe >= descTotalPages}
                    className="px-2 py-1 rounded border bg-white disabled:opacity-40"
                  >
                    Далі →
                  </button>
                </div>
              )}
            </div>
          </section>
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="font-semibold">Користувачі (за балами)</h3>
              <span className="text-xs text-slate-500">
                {usersList.length === 0
                  ? 'нічого не знайдено'
                  : `${(usersPageSafe - 1) * USERS_PAGE_SIZE + 1}–${Math.min(
                      usersPageSafe * USERS_PAGE_SIZE,
                      usersList.length
                    )} з ${usersList.length}`}
              </span>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Імʼя</th>
                  <th className="text-left p-2">TG ID</th>
                  <th className="text-right p-2">Бали</th>
                  <th className="text-left p-2">Статус</th>
                  <th className="text-right p-2">Пропуски</th>
                </tr>
              </thead>
              <tbody>
                {usersPageRows.map((u: any, i: number) => (
                  <tr key={u.tgId} className="border-b">
                    <td className="p-2">{(usersPageSafe - 1) * USERS_PAGE_SIZE + i + 1}</td>
                    <td className="p-2">{u.displayName || '—'}</td>
                    <td className="p-2 font-mono text-xs">{u.tgId}</td>
                    <td className="p-2 text-right">{u.totalPoints}</td>
                    <td className="p-2">{u.status}</td>
                    <td className="p-2 text-right">{u.consecutiveMisses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {usersTotalPages > 1 && (
              <div className="flex items-center justify-end gap-1 text-xs pt-2">
                <button
                  onClick={() => setUsersPage(p => Math.max(1, p - 1))}
                  disabled={usersPageSafe <= 1}
                  className="px-2 py-1 rounded border bg-white disabled:opacity-40"
                >
                  ← Назад
                </button>
                <span className="px-2">
                  Стор. {usersPageSafe} / {usersTotalPages}
                </span>
                <button
                  onClick={() => setUsersPage(p => Math.min(usersTotalPages, p + 1))}
                  disabled={usersPageSafe >= usersTotalPages}
                  className="px-2 py-1 rounded border bg-white disabled:opacity-40"
                >
                  Далі →
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

// ==================== PROCESS DESCRIPTION ====================

type ProcessStep = 'select' | 'step1' | 'step2';
type GroupColor = 'green-full' | 'green-light' | 'green-superlight' | 'yellow' | 'red' | 'purple';

interface NumberInfo {
  base: number | null;
  suffix: string;
}

// "1", "1а", "12б", "" → пара (число, суфікс). Нечислові → base=null.
function parseNumberCell(s: string): NumberInfo {
  const t = (s ?? '').trim();
  if (!t) return { base: null, suffix: '' };
  const m = t.match(/^(\d+)(.*)$/);
  if (!m) return { base: null, suffix: t };
  return { base: parseInt(m[1], 10), suffix: m[2].trim() };
}

function compareNumberInfo(a: NumberInfo, b: NumberInfo): number {
  if (a.base !== b.base) {
    if (a.base == null) return 1;
    if (b.base == null) return -1;
    return a.base - b.base;
  }
  return a.suffix.localeCompare(b.suffix, 'uk');
}

// Базова нормалізація — для групування за номером (просто trim+lower).
const norm = (v: any) => String(v ?? '').trim().toLowerCase();

// Канонізація дат у тексті: «23 января 1890 г.» → «1890-01-23», «01.02.1890» → «1890-02-01».
// Для діапазонів кожна частина нормалізується незалежно. Голий рік («1890») лишається як є.
const MONTHS: Record<string, number> = {
  // ru
  янв: 1, фев: 2, мар: 3, апр: 4, май: 5, мая: 5, июн: 6, июл: 7,
  авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
  // uk
  січ: 1, лют: 2, бер: 3, квіт: 4, трав: 5, черв: 6, лип: 7, серп: 8,
  верес: 9, жовт: 10, листоп: 11, груд: 12,
};
function monthNum(word: string): number | null {
  const w = word.toLowerCase();
  // Шукаємо найдовший збіг префіксу — щоб «листопада» матчилось як «листоп», а не як «лип».
  let best: { len: number; n: number } | null = null;
  for (const [k, v] of Object.entries(MONTHS)) {
    if (w.startsWith(k) && (!best || k.length > best.len)) best = { len: k.length, n: v };
  }
  return best ? best.n : null;
}
// «19.01» або «19 января» + рік-донор → «YYYY-MM-DD». Повертає null, якщо не вдалося.
function partialToIso(partial: string, year: number): string | null {
  const t = partial.trim();
  let m = t.match(/^(\d{1,2})[.\/](\d{1,2})$/);
  if (m) {
    const d = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
  }
  m = t.match(/^(\d{1,2})\s+([а-яіїєґ]+)$/iu);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = monthNum(m[2]);
    if (mo && d >= 1 && d <= 31) {
      return `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

function inheritYearInRanges(t: string): string {
  // <partial> [\s]*-[\s]* YYYY-MM-DD
  t = t.replace(
    /(\d{1,2}[.\/]\d{1,2}|\d{1,2}\s+[а-яіїєґ]+)\s*-\s*(\d{4})-(\d{2})-(\d{2})/giu,
    (full, partial, y, mo, d) => {
      const iso = partialToIso(partial, parseInt(y, 10));
      if (!iso) return full;
      return `${iso}-${y}-${mo}-${d}`;
    }
  );
  // YYYY-MM-DD [\s]*-[\s]* <partial>
  t = t.replace(
    /(\d{4})-(\d{2})-(\d{2})\s*-\s*(\d{1,2}[.\/]\d{1,2}|\d{1,2}\s+[а-яіїєґ]+)(?!\s*-?\s*\d)/giu,
    (full, y, mo, d, partial) => {
      const iso = partialToIso(partial, parseInt(y, 10));
      if (!iso) return full;
      return `${y}-${mo}-${d}-${iso}`;
    }
  );
  return t;
}

function canonicalizeDates(input: string): string {
  let t = input;
  // Уніфікуємо тире.
  t = t.replace(/[–—−]/g, '-');
  // Прибираємо маркери року «г.», «р.». ВАЖЛИВО: JS-regex `\b` не працює з кирилицею,
  // тож використовуємо Unicode-lookbehind «не літера зліва» + lookahead «не літера справа».
  t = t.replace(/(?<![\p{L}])г\.?(?![\p{L}])/giu, '');
  t = t.replace(/(?<![\p{L}])р\.?(?![\p{L}])/giu, '');
  // «D MONTH YYYY» → ISO
  t = t.replace(/(\d{1,2})\s+([а-яіїєґ]+)\s+(\d{4})/giu, (m, d, mon, y) => {
    const n = monthNum(mon);
    if (!n) return m;
    return `${y}-${String(n).padStart(2, '0')}-${String(parseInt(d, 10)).padStart(2, '0')}`;
  });
  // «DD.MM.YYYY» / «D.M.YYYY» → ISO
  t = t.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, (_, d, m, y) =>
    `${y}-${String(parseInt(m, 10)).padStart(2, '0')}-${String(parseInt(d, 10)).padStart(2, '0')}`
  );
  // «DD/MM/YYYY»
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_, d, m, y) =>
    `${y}-${String(parseInt(m, 10)).padStart(2, '0')}-${String(parseInt(d, 10)).padStart(2, '0')}`
  );
  // У діапазонах вигляду «<partial> - YYYY-MM-DD» або «YYYY-MM-DD - <partial>»
  // успадковуємо рік від ISO-частини й добиваємо partial у ISO.
  t = inheritYearInRanges(t);
  return t;
}

// Розширена нормалізація для порівняння відповідей між записами групи:
// • lower + ё→е + уніфіковані апострофи
// • для полів-дат — попередня канонізація дат у ISO
// • прибираємо обрамляючу пунктуацію, схлопуємо пробіли, нормалізуємо тире
// Латино-кириличні гомогліфи (нижній регістр): візуально ідентичні літери,
// які користувачі можуть випадково набирати з різної розкладки. Зводимо до кирилиці.
const HOMOGLYPHS_LAT_TO_CYR: Record<string, string> = {
  a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', i: 'і', m: 'м', t: 'т', h: 'н', b: 'в',
};

const normCompare = (v: any, role?: string): string => {
  let s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/ё/g, 'е');
  s = s.replace(/[ʼ'`ʻ’]/g, "'");
  // Нормалізуємо латино-кириличні гомогліфи (типу «7a» vs «7а»).
  s = s.replace(/[aeopcxykimthb]/g, ch => HOMOGLYPHS_LAT_TO_CYR[ch] || ch);
  if (role === 'date_start' || role === 'date_end' || role === 'year_range') {
    s = canonicalizeDates(s);
  } else {
    // Після крапки перед не-пробілом вставляємо пробіл, але ТІЛЬКИ якщо перед
    // крапкою — літера (щоб «г.К»→«г. К», «ч.2»→«ч. 2», але «192.168» не чіпалось).
    s = s.replace(/(?<=\p{L})\.(?=\S)/gu, '. ');
  }
  // Нормалізуємо роздільник діапазону: «1890 - 1891» → «1890-1891», але всередині ISO
  // («1890-01-23») дефіс не чіпаємо. Замінюємо тільки коли навколо є пробіли.
  s = s.replace(/\s+-\s+/g, '-');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^[\s.,;:!?\-()"'«»]+|[\s.,;:!?\-()"'«»]+$/g, '');
  return s.trim();
};

interface ProcessGroup {
  caseId: string;
  numberDisplay: string;          // представник для сортування/відображення
  numberInfo: NumberInfo;
  numberVariants: string[];       // усі унікальні значення номера в межах групи
  records: any[];
  color: GroupColor;
  selectedIndex: number | null;
  llmReason?: string;
  diag: string;                   // технічне пояснення, чому саме такий колір
}

interface Step2Row {
  id: string;
  isEmpty: boolean;
  answers: string[];
  archive: string;
  fund: string;
  opys: string;
  sourcePdf: string;
  page: string;
}

// Викликає Gemini, щоб обрати найвірогідніший запис серед N варіантів однієї справи.
async function pickBestViaLLM(
  apiKey: string,
  questions: any[],
  records: any[],
  numberColIdx: number
): Promise<{ index: number; reason: string }> {
  const recs = records.map((r: any, i: number) => {
    const ans = Array.isArray(r.answers) ? r.answers : [];
    const obj: Record<string, string> = {};
    questions.forEach((q: any, qi: number) => {
      if (qi === numberColIdx) return; // номер ідентичний у межах групи
      obj[q.label || `Q${qi + 1}`] = String(ans[qi] ?? '');
    });
    return { index: i, ...obj };
  });
  const prompt = [
    'Ти — редактор архівних описів. Дано кілька варіантів заповнення однієї архівної справи різними людьми.',
    'Обери ОДИН найкращий варіант — той, що найімовірніше відповідає істині (повніший, послідовніший, з правильним форматом дат і номерів, без явних описок).',
    'Поверни ТІЛЬКИ JSON: {"index": <ціле 0..N-1>, "reason": "<коротко українською, чому саме цей варіант>"}.',
    '',
    'Записи:',
    JSON.stringify(recs, null, 2),
  ].join('\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Gemini повернув не-JSON');
    parsed = JSON.parse(m[0]);
  }
  const idx = Number(parsed.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= records.length) {
    throw new Error(`Gemini повернув некоректний index: ${parsed.index}`);
  }
  return { index: idx, reason: String(parsed.reason || '') };
}

const ProcessDescriptionView: React.FC<{ geminiKey: string }> = ({ geminiKey }) => {
  const [step, setStep] = useState<ProcessStep>('select');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [questions, setQuestions] = useState<any[]>([]);
  const [descriptions, setDescriptions] = useState<
    { key: string; name: string; donePct: number; doneCases: number; totalCases: number }[]
  >([]);
  const [descKey, setDescKey] = useState('');
  const [numberColIdx, setNumberColIdx] = useState<number>(0);
  const [groups, setGroups] = useState<ProcessGroup[]>([]);
  const [step2Rows, setStep2Rows] = useState<Step2Row[]>([]);
  const [loadedCount, setLoadedCount] = useState<number>(0);
  const [llmBusy, setLlmBusy] = useState<Set<number>>(new Set());
  const [bulkLLM, setBulkLLM] = useState<{ done: number; total: number; current: number | null } | null>(null);
  const bulkCancelRef = useRef(false);

  const descName = descriptions.find(d => d.key === descKey)?.name || '';

  const refresh = async () => {
    setBusy(true);
    setMsg('');
    try {
      const [q, ov] = await Promise.all([tgApi.getQuestions(), tgApi.overview()]);
      const qs = Array.isArray(q.questions) ? q.questions : [];
      setQuestions(qs);
      setDescriptions(
        ((ov.descriptions || []) as any[])
          .map(d => ({
            key: d.key,
            name: d.name,
            donePct: Number(d.donePct) || 0,
            doneCases: Number(d.doneCases) || 0,
            totalCases: Number(d.totalCases) || 0,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      if (numberColIdx >= qs.length) setNumberColIdx(qs.length > 0 ? 0 : -1);
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildGroups = async () => {
    if (!descKey || numberColIdx < 0) return;
    setMsg('');
    setBusy(true);
    let subs: any[] = [];
    try {
      const [archive, fund, opys] = descKey.split('|');
      const r = await tgApi.submissionsByDescription(archive, fund, opys);
      subs = Array.isArray(r.submissions) ? r.submissions : [];
      setLoadedCount(subs.length);
    } catch (e: any) {
      setMsg('❌ ' + e.message);
      setBusy(false);
      return;
    } finally {
      setBusy(false);
    }
    if (subs.length === 0) {
      setMsg('У цьому описі немає підтверджених відповідей.');
      return;
    }
    // Групуємо за case_id — це єдиний фізичний скан справи. Користувачі можуть
    // ввести різні значення «номера» для одного й того самого скану (помилки),
    // але це не привід зливати РІЗНІ скани лише через однакові номери.
    const map = new Map<string, any[]>();
    for (const s of subs) {
      const key = String(s.case_id || '');
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    const result: ProcessGroup[] = [];
    for (const [caseId, records] of map) {
      // Представника номера обираємо як найчастіше значення; ties — перше зустрінуте.
      const counts = new Map<string, number>();
      const variantsOrder: string[] = [];
      for (const r of records) {
        const v = String((r.answers || [])[numberColIdx] ?? '').trim();
        if (!counts.has(v)) variantsOrder.push(v);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      let display = variantsOrder[0] || '';
      let bestCount = -1;
      for (const v of variantsOrder) {
        const c = counts.get(v)!;
        if (c > bestCount) {
          bestCount = c;
          display = v;
        }
      }
      const info = parseNumberCell(display);

      // Підпис кожного запису — нормалізована конкатенація ВСІХ полів.
      // Записи з ідентичним підписом утворюють кластер дублікатів.
      const sigOf = (r: any) =>
        questions
          .map((q: any, i: number) =>
            normCompare((r.answers || [])[i], inferColumnRole(q || {}))
          )
          .join('');
      const clusters = new Map<string, number[]>();
      records.forEach((r, ri) => {
        const sig = sigOf(r);
        if (!clusters.has(sig)) clusters.set(sig, []);
        clusters.get(sig)!.push(ri);
      });
      const sizes = [...clusters.values()].map(a => a.length);
      const largestCluster = [...clusters.values()].sort((a, b) => b.length - a.length)[0];
      const allSame = clusters.size === 1;
      const hasDuplicateCluster = sizes.some(s => s >= 2);

      // Підрахунок розбіжностей за полями (для ідентифікації red) + збір per-field стану для діагностики.
      let diffFields = 0;
      let totalFields = 0;
      const fieldStatus: { label: string; equal: boolean; vals: string[] }[] = [];
      for (let i = 0; i < questions.length; i++) {
        totalFields++;
        const q = questions[i] || {};
        const role = inferColumnRole(q);
        const vals = records.map(r => normCompare((r.answers || [])[i], role));
        const equal = vals.every(v => v === vals[0]);
        if (!equal) diffFields++;
        fieldStatus.push({ label: (q as any).label || `Q${i + 1}`, equal, vals });
      }

      // Серед індексів-кандидатів обираємо запис із максимальною сумою довжин усіх
      // полів (raw text, без нормалізації) — щоб попадати в найповніший варіант.
      const totalChars = (r: any) =>
        (Array.isArray(r.answers) ? r.answers : []).reduce(
          (acc: number, a: any) => acc + String(a ?? '').length,
          0
        );
      const pickLongest = (idxs: number[]) =>
        idxs.reduce((best, i) => (totalChars(records[i]) > totalChars(records[best]) ? i : best), idxs[0]);

      // ----- Перевірка «не-дата поля збігаються, дата відрізняється» -----
      // Дата-роль інферю з лейбла. Будуємо ОКРЕМУ кластеризацію за non-date підписом —
      // щоб ловити випадки, коли тільки субсет записів має ідентичні не-дата поля.
      const dateIdxs: number[] = [];
      for (let i = 0; i < questions.length; i++) {
        const role = inferColumnRole(questions[i] || {});
        if (role === 'date_start' || role === 'date_end' || role === 'year_range') dateIdxs.push(i);
      }
      const nonDateSigOf = (r: any) =>
        questions
          .map((q: any, i: number) => {
            const role = inferColumnRole(q || {});
            const isDate = role === 'date_start' || role === 'date_end' || role === 'year_range';
            return isDate ? '' : normCompare((r.answers || [])[i], role);
          })
          .join('|');
      const nonDateClusters = new Map<string, number[]>();
      records.forEach((r, ri) => {
        const sig = nonDateSigOf(r);
        if (!nonDateClusters.has(sig)) nonDateClusters.set(sig, []);
        nonDateClusters.get(sig)!.push(ri);
      });
      const largestNonDateCluster =
        [...nonDateClusters.values()].sort((a, b) => b.length - a.length)[0] || [];
      const hasNonDateCluster = largestNonDateCluster.length >= 2;

      // Серед записів — обираємо той, у кого найдовший сирий текст у дата-полях.
      const dateChars = (ri: number) =>
        dateIdxs.reduce((acc, qi) => acc + String((records[ri].answers || [])[qi] ?? '').length, 0);
      const pickLongestDate = (idxs: number[]) =>
        idxs.reduce((best, i) => (dateChars(i) > dateChars(best) ? i : best), idxs[0]);

      let color: GroupColor;
      let selectedIndex: number | null = null;
      if (allSame) {
        color = 'green-full';
        selectedIndex = pickLongest(records.map((_, i) => i));
      } else if (hasDuplicateCluster) {
        color = 'green-light';
        selectedIndex = pickLongest(largestCluster);
      } else if (records.length === 1) {
        // Один запис у групі — нема з чим звіряти, рахуємо за зелений.
        color = 'green-full';
        selectedIndex = 0;
      } else if (hasNonDateCluster && dateIdxs.length > 0) {
        // У кластері non-date підписи однакові, але дати в нього входять різні
        // (інакше це був би повний дублікат і ми вже увійшли б у green-light).
        color = 'green-superlight';
        selectedIndex = pickLongestDate(largestNonDateCluster);
      } else if (totalFields > 0 && diffFields === totalFields) {
        color = 'red';
      } else {
        color = 'yellow';
      }

      // ----- Діагностика -----
      const reasonByColor: Record<GroupColor, string> = {
        'green-full': 'усі записи мають ідентичні підписи (allSame=true)',
        'green-light': `є кластер дублікатів (≥2 записи з ідентичним підписом); розміри кластерів: [${sizes.join(', ')}]`,
        'green-superlight': `є кластер з ідентичними не-дата полями розміру ${largestNonDateCluster.length} (records=[${largestNonDateCluster.map(i => 'r' + i).join(',')}]); дат-полів: ${dateIdxs.length}; обрано запис з найдовшим raw у дата-полях`,
        yellow: `немає кластера дублікатів; розбіжностей за полями: ${diffFields}/${totalFields} (не всі поля різні)`,
        red: `немає кластера дублікатів; усі ${totalFields} порівнюваних полів різні`,
        purple: 'розвʼязано LLM',
      };
      const userTags = records.map((r, ri) => `r${ri}=${r.display_name || '?'}/${r.tg_id || '?'}`).join('  ');
      const clustersDump = [...clusters.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([sig, idxs], ci) => `cluster#${ci} size=${idxs.length} records=[${idxs.map(i => 'r' + i).join(',')}] sig="${sig.slice(0, 200)}${sig.length > 200 ? '…' : ''}"`)
        .join('\n');
      const fieldsDump = fieldStatus
        .map(f => {
          if (f.equal) return `  [=] ${f.label}: "${f.vals[0]}"`;
          return `  [≠] ${f.label}:\n` + f.vals.map((v, ri) => `      r${ri}: "${v}"`).join('\n');
        })
        .join('\n');
      const diag =
        `case_id=${caseId} · records=${records.length} · color=${color}\n` +
        `reason: ${reasonByColor[color]}\n` +
        `users:\n  ${userTags}\n` +
        `clusters (${clusters.size} unique signatures):\n${clustersDump}\n` +
        `fields (${diffFields} differ / ${totalFields} total):\n${fieldsDump}`;

      result.push({
        caseId,
        numberDisplay: display,
        numberInfo: info,
        numberVariants: variantsOrder.filter(v => v !== ''),
        records,
        color,
        selectedIndex,
        diag,
      });
    }
    result.sort((a, b) => compareNumberInfo(a.numberInfo, b.numberInfo));
    setGroups(result);
    setStep('step1');
  };

  const setSelected = (gi: number, ri: number | null) => {
    setGroups(prev => prev.map((g, i) => (i === gi ? { ...g, selectedIndex: ri } : g)));
  };

  const runLLMForAllYellow = async () => {
    if (!geminiKey) {
      setMsg('❌ Gemini API key не задано — додайте його в основному екрані.');
      return;
    }
    const yellowIdxs = groups
      .map((g, i) => (g.color === 'yellow' ? i : -1))
      .filter(i => i >= 0);
    if (yellowIdxs.length === 0) {
      setMsg('Немає жовтих груп для розвʼязання.');
      return;
    }
    bulkCancelRef.current = false;
    setBulkLLM({ done: 0, total: yellowIdxs.length, current: null });
    setMsg('');
    const errors: string[] = [];
    for (let k = 0; k < yellowIdxs.length; k++) {
      if (bulkCancelRef.current) break;
      const gi = yellowIdxs[k];
      const g = groups[gi];
      setBulkLLM(prev => (prev ? { ...prev, current: gi } : prev));
      setLlmBusy(prev => {
        const n = new Set(prev);
        n.add(gi);
        return n;
      });
      try {
        const { index, reason } = await pickBestViaLLM(geminiKey, questions, g.records, numberColIdx);
        setGroups(prev =>
          prev.map((gg, j) =>
            j === gi
              ? { ...gg, color: 'purple' as GroupColor, selectedIndex: index, llmReason: reason }
              : gg
          )
        );
      } catch (e: any) {
        errors.push(`№${g.numberDisplay || g.caseId.slice(0, 6)}: ${e.message}`);
      } finally {
        setLlmBusy(prev => {
          const n = new Set(prev);
          n.delete(gi);
          return n;
        });
      }
      setBulkLLM(prev => (prev ? { ...prev, done: prev.done + 1, current: null } : prev));
    }
    setBulkLLM(null);
    if (errors.length > 0) {
      setMsg(`❌ Помилки LLM (${errors.length}):\n` + errors.join('\n'));
    }
  };

  const cancelBulkLLM = () => {
    bulkCancelRef.current = true;
  };

  const runLLMForGroup = async (gi: number) => {
    if (!geminiKey) {
      setMsg('❌ Gemini API key не задано — додайте його в основному екрані.');
      return;
    }
    const g = groups[gi];
    if (!g) return;
    setLlmBusy(prev => {
      const n = new Set(prev);
      n.add(gi);
      return n;
    });
    setMsg('');
    try {
      const { index, reason } = await pickBestViaLLM(geminiKey, questions, g.records, numberColIdx);
      setGroups(prev =>
        prev.map((gg, i) =>
          i === gi ? { ...gg, color: 'purple' as GroupColor, selectedIndex: index, llmReason: reason } : gg
        )
      );
    } catch (e: any) {
      setMsg(`❌ LLM: ${e.message}`);
    } finally {
      setLlmBusy(prev => {
        const n = new Set(prev);
        n.delete(gi);
        return n;
      });
    }
  };

  const proceedToStep2 = () => {
    const missing = groups.filter(g => g.selectedIndex == null);
    if (missing.length > 0) {
      setMsg(
        `Не обрано записів у групах: ${missing
          .map(g => g.numberDisplay || '(порожній)')
          .join(', ')}`
      );
      return;
    }
    setMsg('');
    const selected = groups.map(g => g.records[g.selectedIndex!]);
    const bases = new Set<number>();
    for (const s of selected) {
      const ans = Array.isArray(s.answers) ? s.answers : [];
      const info = parseNumberCell(String(ans[numberColIdx] ?? ''));
      if (info.base != null) bases.add(info.base);
    }
    // Архівні реквізити беремо з descKey (вони однакові для всього опису).
    const [descArchive = '', descFund = '', descOpys = ''] = (descKey || '').split('|');
    const rows: Step2Row[] = selected.map((s, idx) => {
      const ans = Array.isArray(s.answers) ? [...s.answers] : [];
      while (ans.length < questions.length) ans.push('');
      return {
        id: `r${idx}`,
        isEmpty: false,
        answers: ans.map(a => String(a ?? '')),
        archive: String(s.archive ?? descArchive),
        fund: String(s.fund ?? descFund),
        opys: String(s.opys ?? descOpys),
        sourcePdf: String(s.source_pdf ?? ''),
        page: String(s.page ?? ''),
      };
    });
    if (bases.size > 0) {
      const min = Math.min(...bases);
      const max = Math.max(...bases);
      for (let n = min; n <= max; n++) {
        if (!bases.has(n)) {
          const ans = Array(questions.length).fill('');
          if (numberColIdx >= 0) ans[numberColIdx] = String(n);
          rows.push({
            id: `e${n}`,
            isEmpty: true,
            answers: ans,
            archive: descArchive,
            fund: descFund,
            opys: descOpys,
            sourcePdf: '',
            page: '',
          });
        }
      }
    }
    rows.sort((a, b) =>
      compareNumberInfo(
        parseNumberCell(a.answers[numberColIdx] || ''),
        parseNumberCell(b.answers[numberColIdx] || '')
      )
    );
    setStep2Rows(rows);
    setStep('step2');
  };

  const updateCell = (rowIdx: number, qIdx: number, value: string) => {
    setStep2Rows(prev =>
      prev.map((r, i) =>
        i === rowIdx ? { ...r, answers: r.answers.map((a, j) => (j === qIdx ? value : a)) } : r
      )
    );
  };

  const updateMetaCell = (rowIdx: number, field: 'archive' | 'fund' | 'opys' | 'sourcePdf' | 'page', value: string) => {
    setStep2Rows(prev => prev.map((r, i) => (i === rowIdx ? { ...r, [field]: value } : r)));
  };

  const META_COLS: Array<{ key: 'archive' | 'fund' | 'opys' | 'sourcePdf' | 'page'; label: string }> = [
    { key: 'archive', label: 'Архів' },
    { key: 'fund', label: 'Фонд' },
    { key: 'opys', label: 'Опис' },
    { key: 'sourcePdf', label: 'Файл' },
    { key: 'page', label: 'Сторінка' },
  ];

  // Перевірка дублікатів у колонці-«номері» — блокує експорт, поки не виправлено.
  // Порожні значення (—) ігноруємо: вони не вважаються номерами, не порівнюються.
  const duplicateInfo = React.useMemo(() => {
    const byValue = new Map<string, string[]>();
    if (numberColIdx < 0) return { items: [] as { value: string; rowIds: string[] }[], rowIds: new Set<string>() };
    for (const r of step2Rows) {
      const v = String(r.answers[numberColIdx] ?? '').trim();
      if (!v) continue;
      const list = byValue.get(v) || [];
      list.push(r.id);
      byValue.set(v, list);
    }
    const items: { value: string; rowIds: string[] }[] = [];
    const rowIds = new Set<string>();
    for (const [value, ids] of byValue) {
      if (ids.length > 1) {
        items.push({ value, rowIds: ids });
        for (const id of ids) rowIds.add(id);
      }
    }
    items.sort((a, b) =>
      compareNumberInfo(parseNumberCell(a.value), parseNumberCell(b.value))
    );
    return { items, rowIds };
  }, [step2Rows, numberColIdx]);

  const exportCsv = () => {
    if (questions.length === 0) return;
    if (duplicateInfo.items.length > 0) {
      setMsg(
        `❌ Експорт заблоковано — у колонці «${questions[numberColIdx]?.label || 'Номер'}» є дублікати: ` +
          duplicateInfo.items.map(d => `"${d.value}" ×${d.rowIds.length}`).join(', ')
      );
      return;
    }
    const qHeaders = questions.map((q: any, i: number) => q.label || `Q${i + 1}`);
    const metaHeaders = META_COLS.map(c => c.label);
    const headers = [...qHeaders, ...metaHeaders];
    // Сортуємо ще раз — користувач міг змінити номери в Кроці 2.
    const sorted = [...step2Rows].sort((a, b) =>
      compareNumberInfo(
        parseNumberCell(a.answers[numberColIdx] || ''),
        parseNumberCell(b.answers[numberColIdx] || '')
      )
    );
    const rows = sorted.map(r => [
      ...qHeaders.map((_, i) => r.answers[i] ?? ''),
      ...META_COLS.map(c => (r as any)[c.key] ?? ''),
    ]);
    const all = [headers, ...rows];
    const escape = (v: any) => {
      const s = String(v ?? '');
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = all.map(r => r.map(escape).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safe = (descName || 'description').replace(/[\\/:*?"<>|]+/g, '_').trim();
    a.href = url;
    a.download = `descriptor-processed-${safe}-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ----- RENDER -----

  const colorClass = (c: GroupColor) => {
    switch (c) {
      case 'green-full': return 'bg-emerald-200';
      case 'green-light': return 'bg-emerald-100';
      case 'green-superlight': return 'bg-emerald-50';
      case 'yellow': return 'bg-amber-50';
      case 'red': return 'bg-rose-50';
      case 'purple': return 'bg-violet-100';
    }
  };

  const colorBadge = (c: GroupColor) => {
    switch (c) {
      case 'green-full': return 'bg-emerald-600';
      case 'green-light': return 'bg-emerald-500';
      case 'green-superlight': return 'bg-emerald-300';
      case 'yellow': return 'bg-amber-500';
      case 'red': return 'bg-rose-500';
      case 'purple': return 'bg-violet-500';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={refresh}
          disabled={busy}
          className="px-3 py-1.5 bg-slate-200 rounded text-sm flex items-center gap-1"
        >
          <RefreshCw size={14} /> {busy ? 'Завантаження…' : 'Оновити дані'}
        </button>
        <div className="text-sm text-slate-500">
          Крок: <b>{step === 'select' ? '0 — вибір' : step === 'step1' ? '1 — групи' : '2 — заповнення'}</b>
        </div>
      </div>

      {msg && <div className="text-sm whitespace-pre-wrap">{msg}</div>}

      {step === 'select' && (
        <div className="space-y-3 max-w-2xl">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Опис</label>
            <select
              value={descKey}
              onChange={e => setDescKey(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm w-full"
            >
              <option value="">— оберіть опис —</option>
              {descriptions.map(d => (
                <option key={d.key} value={d.key}>
                  {d.name} — {d.donePct}% ({d.doneCases}/{d.totalCases})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Колонка-«номер» (для сортування й групування)</label>
            <select
              value={numberColIdx}
              onChange={e => setNumberColIdx(parseInt(e.target.value, 10))}
              className="border rounded px-2 py-1.5 text-sm w-full"
              disabled={questions.length === 0}
            >
              {questions.map((q: any, i: number) => (
                <option key={i} value={i}>
                  {q.label || `Q${i + 1}`}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={buildGroups}
            disabled={!descKey || numberColIdx < 0 || questions.length === 0}
            className="px-4 py-2 bg-indigo-600 text-white rounded text-sm disabled:opacity-50"
          >
            Далі →
          </button>
        </div>
      )}

      {step === 'step1' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setStep('select');
                setMsg('');
              }}
              className="px-3 py-1.5 bg-slate-200 rounded text-sm"
            >
              ← Назад
            </button>
            <button
              onClick={proceedToStep2}
              className="px-4 py-1.5 bg-indigo-600 text-white rounded text-sm"
            >
              Далі →
            </button>
            <div className="text-sm text-slate-500">
              Опис: <b>{descName}</b> · підтверджень: {loadedCount} · груп: {groups.length} ·
              обрано: {groups.filter(g => g.selectedIndex != null).length}/{groups.length}
            </div>
            {(() => {
              const yellowCount = groups.filter(g => g.color === 'yellow').length;
              if (bulkLLM) {
                const pct = bulkLLM.total > 0 ? Math.round((bulkLLM.done / bulkLLM.total) * 100) : 0;
                return (
                  <div className="flex items-center gap-2 w-full">
                    <div className="flex-1 h-2 bg-slate-200 rounded overflow-hidden min-w-[200px]">
                      <div
                        className="h-2 bg-violet-600 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-600 whitespace-nowrap">
                      LLM: {bulkLLM.done}/{bulkLLM.total}
                      {bulkLLM.current != null
                        ? ` · обробляю №${groups[bulkLLM.current]?.numberDisplay || ''}`
                        : ''}
                    </span>
                    <button
                      onClick={cancelBulkLLM}
                      className="px-2 py-1 bg-rose-100 text-rose-700 rounded text-xs"
                    >
                      Зупинити
                    </button>
                  </div>
                );
              }
              return (
                <button
                  onClick={runLLMForAllYellow}
                  disabled={yellowCount === 0 || !geminiKey}
                  title={
                    !geminiKey
                      ? 'Не задано Gemini API key'
                      : yellowCount === 0
                      ? 'Немає жовтих груп'
                      : `Послідовно розвʼязати ${yellowCount} жовтих груп`
                  }
                  className="px-3 py-1 bg-violet-600 text-white rounded text-xs disabled:opacity-50"
                >
                  🤖 Розвʼязати всі жовті ({yellowCount})
                </button>
              );
            })()}
          </div>
          <div className="text-xs text-slate-500 flex flex-wrap gap-3">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-600" /> усі записи ідентичні</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500" /> є дублікати — обрано з більшого кластера</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-300" /> усі поля крім дати збігаються — обрано з найдовшою датою</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-400" /> часткові розбіжності (можна викликати LLM)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-rose-500" /> усі поля різні</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-violet-500" /> розвʼязано LLM</span>
          </div>
          <div className="border rounded overflow-auto max-h-[70vh]">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-slate-100 sticky top-0">
                <tr>
                  <th className="text-left p-2 border-b w-8">✓</th>
                  <th className="text-left p-2 border-b">Користувач</th>
                  {questions.map((q: any, i: number) => (
                    <th key={i} className="text-left p-2 border-b whitespace-nowrap">
                      {q.label || `Q${i + 1}`}
                      {i === numberColIdx ? ' №' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => (
                  <React.Fragment key={`${g.caseId}-${gi}`}>
                    <tr className={colorClass(g.color)}>
                      <td colSpan={2 + questions.length} className="p-1.5 border-t border-b font-medium text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-block w-2 h-2 rounded-full ${colorBadge(g.color)}`} />
                          <span>
                            № <b>{g.numberDisplay || '(порожньо)'}</b>
                            {g.numberVariants.length > 1 && (
                              <span className="text-rose-700 ml-1">
                                ⚠ варіанти: {g.numberVariants.join(' / ')}
                              </span>
                            )}
                            {' · '}
                            <span className="font-mono text-[10px] text-slate-500">{g.caseId.slice(0, 8)}</span>
                            {' · записів: '}
                            {g.records.length}
                          </span>
                          {g.color === 'yellow' && (
                            <button
                              onClick={() => runLLMForGroup(gi)}
                              disabled={llmBusy.has(gi) || !geminiKey}
                              title={!geminiKey ? 'Не задано Gemini API key' : 'Обрати найкращий запис через Gemini'}
                              className="ml-2 px-2 py-0.5 bg-violet-600 text-white rounded text-xs disabled:opacity-50"
                            >
                              {llmBusy.has(gi) ? '⏳ LLM…' : '🤖 Розвʼязати через LLM'}
                            </button>
                          )}
                          {g.color === 'purple' && g.llmReason && (
                            <span className="text-violet-700 italic">LLM: {g.llmReason}</span>
                          )}
                          <details className="ml-auto">
                            <summary className="cursor-pointer text-[11px] text-slate-600 select-none">
                              🔍 діагностика
                            </summary>
                            <pre className="mt-1 p-2 bg-slate-900 text-slate-100 text-[10px] whitespace-pre-wrap rounded font-mono leading-tight max-h-72 overflow-auto">
{g.diag}
                            </pre>
                          </details>
                        </div>
                      </td>
                    </tr>
                    {g.records.map((r, ri) => {
                      const ans = Array.isArray(r.answers) ? r.answers : [];
                      const checked = g.selectedIndex === ri;
                      return (
                        <tr key={`${gi}-${ri}`} className={`${colorClass(g.color)} border-b`}>
                          <td className="p-2 align-top">
                            <input
                              type="radio"
                              name={`grp-${gi}`}
                              checked={checked}
                              onChange={() => setSelected(gi, ri)}
                            />
                          </td>
                          <td className="p-2 align-top whitespace-nowrap">
                            {r.display_name || '—'}
                            <div className="text-[10px] text-slate-500 font-mono">{r.tg_id}</div>
                          </td>
                          {questions.map((_: any, qi: number) => (
                            <td key={qi} className="p-2 align-top max-w-xs">
                              {String(ans[qi] ?? '')}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 'step2' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStep('step1')}
              className="px-3 py-1.5 bg-slate-200 rounded text-sm"
            >
              ← Назад
            </button>
            <button
              onClick={exportCsv}
              disabled={duplicateInfo.items.length > 0}
              title={
                duplicateInfo.items.length > 0
                  ? 'Є дублікати в колонці-номері — виправте, щоб експортувати'
                  : ''
              }
              className="px-4 py-1.5 bg-emerald-600 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Експорт CSV
            </button>
            <div className="text-sm text-slate-500">
              Рядків: {step2Rows.length} (порожніх: {step2Rows.filter(r => r.isEmpty).length})
            </div>
          </div>
          {duplicateInfo.items.length > 0 && (
            <div className="border border-rose-300 bg-rose-50 rounded p-2 text-xs text-rose-800">
              <div className="font-medium mb-1">
                ⚠ Дублікати в колонці «{questions[numberColIdx]?.label || 'Номер'}» ({duplicateInfo.items.length}):
              </div>
              <div className="flex flex-wrap gap-1">
                {duplicateInfo.items.map(d => (
                  <span key={d.value} className="px-2 py-0.5 bg-rose-100 border border-rose-300 rounded">
                    «{d.value}» ×{d.rowIds.length}
                  </span>
                ))}
              </div>
              <div className="mt-1 text-rose-700/80">
                Виправте значення в підсвічених рядках, щоб розблокувати експорт.
              </div>
            </div>
          )}
          <div className="text-xs text-slate-500">
            Жовтим виділено рядки, додані для відсутніх номерів. Червоним — рядки з дублікатами номера.
          </div>
          <div className="border rounded overflow-auto max-h-[70vh]">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-slate-100 sticky top-0">
                <tr>
                  {questions.map((q: any, i: number) => (
                    <th key={i} className="text-left p-2 border-b whitespace-nowrap">
                      {q.label || `Q${i + 1}`}
                      {i === numberColIdx ? ' №' : ''}
                    </th>
                  ))}
                  {META_COLS.map(c => (
                    <th key={c.key} className="text-left p-2 border-b whitespace-nowrap text-slate-600">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {step2Rows.map((r, ri) => {
                  const isDup = duplicateInfo.rowIds.has(r.id);
                  const rowBg = isDup
                    ? 'bg-rose-100'
                    : r.isEmpty
                    ? 'bg-amber-50'
                    : '';
                  return (
                  <tr key={r.id} className={`${rowBg} border-b`}>
                    {questions.map((_: any, qi: number) => (
                      <td key={qi} className="p-1 align-top">
                        <textarea
                          value={r.answers[qi] ?? ''}
                          onChange={e => updateCell(ri, qi, e.target.value)}
                          rows={1}
                          className={`w-full border rounded px-1.5 py-1 text-xs resize-y ${
                            qi === numberColIdx && isDup
                              ? 'bg-rose-50 border-rose-400'
                              : 'bg-white'
                          }`}
                        />
                      </td>
                    ))}
                    {META_COLS.map(c => (
                      <td key={c.key} className="p-1 align-top">
                        <textarea
                          value={(r as any)[c.key] ?? ''}
                          onChange={e => updateMetaCell(ri, c.key, e.target.value)}
                          rows={1}
                          className="w-full border rounded px-1.5 py-1 text-xs resize-y bg-slate-50"
                        />
                      </td>
                    ))}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== INTEGRITY (Перевірка доброчесності) ====================

type IntegrityField = {
  questionIndex: number;
  questionLabel: string;
  from: string;
  to: string;
  distance: number;
};
type IntegrityUser = { tgId: string; displayName: string; submittedAt: string };
type IntegrityReview = { action: 'penalized' | 'dismissed'; penalizedTgId: string; at: string };
type IntegrityDiff = {
  caseId: string;
  archive: string;
  fund: string;
  opys: string;
  first: IntegrityUser;
  second: IntegrityUser;
  fields: IntegrityField[];
  review: IntegrityReview | null;
};

const PENALTY_POINTS = 100;

type DiffSeg = { text: string; changed: boolean };

// LCS-діф двох рядків посимвольно. Повертає сегменти для лівої («було») та правої
// («стало») сторін: changed=true означає, що символи не входять у LCS.
function diffChars(a: string, b: string): { left: DiffSeg[]; right: DiffSeg[] } {
  const A = Array.from(a);
  const B = Array.from(b);
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const leftRev: DiffSeg[] = [];
  const rightRev: DiffSeg[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (A[i - 1] === B[j - 1]) {
      leftRev.push({ text: A[i - 1], changed: false });
      rightRev.push({ text: B[j - 1], changed: false });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      leftRev.push({ text: A[i - 1], changed: true });
      i--;
    } else {
      rightRev.push({ text: B[j - 1], changed: true });
      j--;
    }
  }
  while (i > 0) {
    leftRev.push({ text: A[i - 1], changed: true });
    i--;
  }
  while (j > 0) {
    rightRev.push({ text: B[j - 1], changed: true });
    j--;
  }
  const merge = (arr: DiffSeg[]): DiffSeg[] => {
    const out: DiffSeg[] = [];
    for (let k = arr.length - 1; k >= 0; k--) {
      const s = arr[k];
      const last = out[out.length - 1];
      if (last && last.changed === s.changed) last.text += s.text;
      else out.push({ text: s.text, changed: s.changed });
    }
    return out;
  };
  return { left: merge(leftRev), right: merge(rightRev) };
}

const renderDiffSegs = (segs: DiffSeg[]): React.ReactNode =>
  segs.map((s, k) =>
    s.changed ? (
      <span key={k} className="bg-rose-300 text-rose-900 rounded px-0.5 font-semibold">
        {s.text}
      </span>
    ) : (
      <React.Fragment key={k}>{s.text}</React.Fragment>
    )
  );

const IntegrityView: React.FC = () => {
  const [diffs, setDiffs] = useState<IntegrityDiff[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [threshold, setThreshold] = useState(5);
  const [filter, setFilter] = useState('');
  const [includeResolved, setIncludeResolved] = useState(false);
  // Фільтр по даті події: значення в годинах, 0 = «весь час».
  const [sinceHours, setSinceHours] = useState<number>(24);
  // Локальний стан по кнопках «Зняти бали»: tgId|caseId|idx → 'busy' | 'done' | 'err:<msg>'
  const [penaltyState, setPenaltyState] = useState<Record<string, string>>({});
  // tg-стан по парах: caseId|first|second → 'busy' | 'err:..'
  const [pairBusy, setPairBusy] = useState<Record<string, string>>({});

  const refresh = async (t = threshold, resolved = includeResolved) => {
    setBusy(true);
    setMsg('');
    try {
      const r = await tgApi.integrity(t, resolved);
      setDiffs(r.diffs || []);
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  // Debounce авто-перезавантаження при зміні порогу / тогла «вже опрацьовані».
  useEffect(() => {
    const t = setTimeout(() => refresh(threshold, includeResolved), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, includeResolved]);

  const pairKeyOf = (d: IntegrityDiff) => {
    const a = d.first.tgId || '';
    const b = d.second.tgId || '';
    const [first, second] = a < b ? [a, b] : [b, a];
    return `${d.caseId}|${first}|${second}`;
  };

  const removeFromList = (d: IntegrityDiff) => {
    if (!diffs) return;
    const key = pairKeyOf(d);
    setDiffs(diffs.filter(x => pairKeyOf(x) !== key));
  };

  const dismissPair = async (d: IntegrityDiff) => {
    if (!d.first.tgId || !d.second.tgId) return;
    if (!window.confirm('Позначити цю пару як «вирішено без штрафу»? Вона зникне зі списку.')) return;
    const key = pairKeyOf(d);
    setPairBusy(s => ({ ...s, [key]: 'busy' }));
    try {
      await tgApi.integrityDismiss(d.caseId, d.first.tgId, d.second.tgId);
      removeFromList(d);
    } catch (e: any) {
      setPairBusy(s => ({ ...s, [key]: `err:${e.message || 'помилка'}` }));
    } finally {
      setPairBusy(s => {
        const next = { ...s };
        if (next[key] === 'busy') delete next[key];
        return next;
      });
    }
  };

  const reopenPair = async (d: IntegrityDiff) => {
    if (!d.first.tgId || !d.second.tgId) return;
    try {
      await tgApi.integrityReopen(d.caseId, d.first.tgId, d.second.tgId);
      // Перезавантажуємо список з сервера, бо ця пара мала б знов зʼявитися.
      refresh(threshold, includeResolved);
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    }
  };

  const userLabel = (u: IntegrityUser) =>
    `${u.displayName || '—'}${u.tgId ? ` (${u.tgId})` : ''}`;

  // Знімає бали з користувача + надсилає йому повідомлення з його ж введеним текстом.
  const penalize = async (
    d: IntegrityDiff,
    side: 'first' | 'second',
    diffIdx: number
  ) => {
    const u = side === 'first' ? d.first : d.second;
    if (!u.tgId) return;
    const fields = d.fields.map(f => ({
      label: f.questionLabel,
      text: side === 'first' ? f.from : f.to,
    }));
    const key = `${u.tgId}|${d.caseId}|${diffIdx}|${side}`;
    const ok = window.confirm(
      `Зняти ${PENALTY_POINTS} балів у користувача "${userLabel(u)}" і надіслати йому повідомлення з його відповіддю?`
    );
    if (!ok) return;
    setPenaltyState(s => ({ ...s, [key]: 'busy' }));
    try {
      const r = await tgApi.penalize({
        tgId: u.tgId,
        points: PENALTY_POINTS,
        caseId: d.caseId,
        archive: d.archive,
        fund: d.fund,
        opys: d.opys,
        fields,
        pairTgIdA: d.first.tgId,
        pairTgIdB: d.second.tgId,
      });
      const warn = (r as any)?.warning ? ` ⚠️ ${(r as any).warning}` : '';
      setPenaltyState(s => ({
        ...s,
        [key]: `done:Новий баланс ${(r as any)?.newTotal ?? '?'}${warn}`,
      }));
      // Прибираємо пару зі списку — бек уже зафіксував її як 'penalized'.
      setTimeout(() => removeFromList(d), 1500);
    } catch (e: any) {
      setPenaltyState(s => ({ ...s, [key]: `err:${e.message || 'помилка'}` }));
    }
  };

  const pairEventTime = (d: IntegrityDiff): number => {
    // "Час події пари" — найпізніша з двох відповідей. Для resolved пар враховуємо
    // ще й момент рішення адміна (review.at), щоб свіжо-вирішені теж потрапляли.
    const candidates: number[] = [];
    if (d.first?.submittedAt) {
      const t = Date.parse(d.first.submittedAt);
      if (!isNaN(t)) candidates.push(t);
    }
    if (d.second?.submittedAt) {
      const t = Date.parse(d.second.submittedAt);
      if (!isNaN(t)) candidates.push(t);
    }
    if (d.review?.at) {
      const t = Date.parse(d.review.at);
      if (!isNaN(t)) candidates.push(t);
    }
    return candidates.length ? Math.max(...candidates) : 0;
  };

  const sinceCutoffMs = sinceHours > 0 ? Date.now() - sinceHours * 3600_000 : 0;

  const filtered = (diffs || []).filter(d => {
    if (sinceCutoffMs > 0 && pairEventTime(d) < sinceCutoffMs) return false;
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      d.caseId.toLowerCase().includes(q) ||
      userLabel(d.first).toLowerCase().includes(q) ||
      userLabel(d.second).toLowerCase().includes(q) ||
      d.fields.some(f =>
        f.from.toLowerCase().includes(q) ||
        f.to.toLowerCase().includes(q) ||
        f.questionLabel.toLowerCase().includes(q)
      )
    );
  });

  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-600">
        Шукаємо пари підтверджень однієї справи, де відповідь відрізняється від
        попередньої більше ніж на N символів (Levenshtein). Допомагає виявити
        користувачів, які не списують текст з зображення.
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => refresh()}
          disabled={busy}
          className="px-3 py-1.5 bg-slate-200 rounded text-sm flex items-center gap-1"
        >
          <RefreshCw size={14} /> {busy ? 'Завантаження…' : 'Оновити'}
        </button>
        <label className="text-sm text-slate-600">Поріг різниці (символів):</label>
        <input
          type="number"
          min={0}
          value={threshold}
          onChange={e => setThreshold(Math.max(0, parseInt(e.target.value, 10) || 0))}
          className="border rounded px-2 py-1 text-sm w-20"
          title="За замовчуванням 5. Сторінка перезавантажиться автоматично."
        />
        <label className="text-sm text-slate-600">Період:</label>
        <select
          value={sinceHours}
          onChange={e => setSinceHours(parseInt(e.target.value, 10))}
          className="border rounded px-2 py-1 text-sm"
          title="За якою свіжістю події фільтрувати пари"
        >
          <option value={24}>Останні 24 години</option>
          <option value={72}>Останні 3 дні</option>
          <option value={168}>Останні 7 днів</option>
          <option value={720}>Останні 30 днів</option>
          <option value={0}>Весь час</option>
        </select>
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Пошук: текст, користувач, case_id"
          className="border rounded px-2 py-1 text-sm flex-1 min-w-[200px]"
        />
        <label className="text-sm text-slate-600 inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={e => setIncludeResolved(e.target.checked)}
          />
          Показувати вже опрацьовані
        </label>
        <div className="text-sm text-slate-600 ml-auto">
          Знайдено: <b>{filtered.length}</b>
        </div>
      </div>

      {msg && <div className="text-sm">{msg}</div>}

      {filtered.length === 0 && !busy && (
        <div className="text-sm text-slate-500 border rounded p-4 bg-slate-50">
          Розбіжностей понад порогом не знайдено.
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((d, idx) => {
          const pk = pairKeyOf(d);
          const pBusy = pairBusy[pk];
          return (
          <div key={`${d.caseId}-${idx}`} className={`border rounded p-3 bg-white shadow-sm ${d.review ? 'opacity-75' : ''}`}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2 text-sm">
              <div className="font-mono text-xs text-slate-500">{d.caseId}</div>
              <div className="text-slate-700">
                {d.archive} {d.fund}-{d.opys}
              </div>
              {d.review && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  d.review.action === 'penalized'
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-slate-200 text-slate-700'
                }`}>
                  {d.review.action === 'penalized' ? '✓ Знято бали' : '✓ Пропущено'} • {d.review.at?.slice(0, 16).replace('T', ' ')}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {!d.review && (
                  <button
                    onClick={() => dismissPair(d)}
                    disabled={pBusy === 'busy' || !d.first.tgId || !d.second.tgId}
                    className="px-2 py-0.5 text-xs rounded bg-slate-200 hover:bg-slate-300 disabled:opacity-50"
                    title="Прибрати зі списку без штрафу"
                  >
                    {pBusy === 'busy' ? '…' : 'Пропустити'}
                  </button>
                )}
                {d.review && (
                  <button
                    onClick={() => reopenPair(d)}
                    className="px-2 py-0.5 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                    title="Повернути в список"
                  >
                    Повернути
                  </button>
                )}
                {pBusy && pBusy.startsWith('err:') && (
                  <span className="text-xs text-rose-700">{pBusy.slice(4)}</span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm mb-2">
              {(['first', 'second'] as const).map(side => {
                const u = side === 'first' ? d.first : d.second;
                const label = side === 'first' ? 'Перша відповідь' : 'Друга відповідь';
                const key = `${u.tgId}|${d.caseId}|${idx}|${side}`;
                const st = penaltyState[key] || '';
                const isBusy = st === 'busy';
                const isDone = st.startsWith('done:');
                const isErr = st.startsWith('err:');
                return (
                  <div key={side} className="border rounded p-2 bg-slate-50 flex flex-col gap-1">
                    <div className="text-xs text-slate-500">{label}</div>
                    <div className="font-medium">{userLabel(u)}</div>
                    <div className="text-xs text-slate-500">{u.submittedAt}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        disabled={!u.tgId || isBusy || isDone}
                        onClick={() => penalize(d, side, idx)}
                        className={`px-2 py-1 text-xs rounded font-medium ${
                          isDone
                            ? 'bg-green-100 text-green-700 cursor-default'
                            : 'bg-rose-100 text-rose-700 hover:bg-rose-200 disabled:opacity-50'
                        }`}
                        title="Зняти 100 балів і повідомити користувача"
                      >
                        {isBusy ? 'Надсилаю…' : isDone ? '✓ Знято −100' : `Зняти −${PENALTY_POINTS} балів`}
                      </button>
                      {isDone && (
                        <span className="text-xs text-green-700">{st.slice(5)}</span>
                      )}
                      {isErr && (
                        <span className="text-xs text-rose-700">{st.slice(4)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="p-1.5 border">Поле</th>
                  <th className="p-1.5 border">Було</th>
                  <th className="p-1.5 border">Стало</th>
                  <th className="p-1.5 border w-16">Δ</th>
                </tr>
              </thead>
              <tbody>
                {d.fields.map(f => {
                  const { left, right } = diffChars(f.from || '', f.to || '');
                  return (
                    <tr key={f.questionIndex} className="align-top">
                      <td className="p-1.5 border font-medium">{f.questionLabel}</td>
                      <td className="p-1.5 border bg-red-50 whitespace-pre-wrap break-words">
                        {f.from ? renderDiffSegs(left) : '—'}
                      </td>
                      <td className="p-1.5 border bg-green-50 whitespace-pre-wrap break-words">
                        {f.to ? renderDiffSegs(right) : '—'}
                      </td>
                      <td className="p-1.5 border text-center font-mono">{f.distance}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          );
        })}
      </div>
    </div>
  );
};
