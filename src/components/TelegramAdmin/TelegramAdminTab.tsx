import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, RefreshCw, Save, UploadCloud, Wand2, Trash2, Plus, AlertTriangle } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import { TableColumn } from '../../types';
import { tgApi, getAdminSecret, clearAdminSecret, adminLogin } from '../../services/telegramApi';
import { createDefaultColumns, createColumn, COLUMN_ROLE_LABELS, COLUMN_ROLE_OPTIONS, inferColumnRole } from '../../lib/tableColumns';
import { detectViaGemini } from '../../lib/sliceDetection';
import { VerifUploadView } from '../CasesPreparation/VerifUploadView';

interface Props {
  onClose: () => void;
  geminiKey: string;
  initialQuestions?: TableColumn[]; // зазвичай tableStructure активного проєкту
}

type TabKey = 'setup' | 'questions' | 'cases' | 'results' | 'process' | 'overview' | 'integrity' | 'chart' | 'partners' | 'puzzle';

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
          ['chart', 'Графік'],
          ['integrity', 'Перевірка доброчесності'],
          ['partners', 'Партнери'],
          ['puzzle', 'Пазл'],
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
        {tab === 'cases' && <CasesPrepAdmin geminiKey={geminiKey} />}
        {tab === 'results' && <ResultsView />}
        {tab === 'process' && <ProcessDescriptionView geminiKey={geminiKey} />}
        {tab === 'overview' && <OverviewView />}
        {tab === 'chart' && <ChartView />}
        {tab === 'integrity' && <IntegrityView />}
        {tab === 'partners' && <PartnersView />}
        {tab === 'puzzle' && <PuzzleView />}
      </div>
    </div>
  );
};

// ==================== LOGIN GATE ====================

// Вкладка «Підготовка справ» в адмінці: під-вкладки Телеграм (нарізка→бот) і Веб (імпорт→перевірка).
const CasesPrepAdmin: React.FC<{ geminiKey: string }> = ({ geminiKey }) => {
  const [sub, setSub] = useState<'telegram' | 'web'>('telegram');
  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b">
        {([['telegram', 'Телеграм'], ['web', 'Веб']] as [typeof sub, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className={`px-4 py-2 text-sm font-medium ${
              sub === k ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {sub === 'telegram' ? <CasesView geminiKey={geminiKey} mode="admin" /> : <VerifUploadView />}
    </div>
  );
};

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
  pdfBase64: string; // вміст PDF (legacy JSON-формат)
  pageBoxes: Record<number, Box[]>;
  // v2+: лінії з Lines-режиму (опціонально, лише якщо є на сторінці).
  pageLines?: Record<number, LineSet>;
  meta: { archive: string; fund: string; opys: string };
}

// Бінарний контейнер сесії — щоб не тримати весь PDF у вигляді base64-рядка
// (для PDF на 100+ МБ JSON.stringify падав з RangeError / OOM при експорті).
// Layout: 4 байти магік "DSDP", 1 байт версії, 4 байти LE — довжина JSON-метаданих,
// далі JSON-метадані (UTF-8) і весь PDF як бінарні байти.
const CONTAINER_MAGIC = [0x44, 0x53, 0x44, 0x50] as const; // "DSDP"
const CONTAINER_VERSION = 1;
const CONTAINER_HEADER_BYTES = 9; // 4 magic + 1 ver + 4 jsonLen
interface SessionContainerMetadata {
  version: number;
  container: 'dsdp-1';
  savedAt: string;
  pdfName: string;
  pageBoxes: Record<number, Box[]>;
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
  // Тримаємо як ArrayBuffer — base64 для експорту створюємо лише на вимогу,
  // щоб уникнути дорогої конвертації (і можливих RangeError у btoa) при відкритті
  // великих файлів. Для PDF на 100+ МБ base64-рядок виходив ~133+ МБ і падав на завантаженні.
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  // Рятувальний режим: у користувача .dsds з порожньою PDF-секцією (наслідок
  // старого бага експорту). Метадані з .dsds лишилися цілими — чекаємо, поки
  // користувач прикріпить оригінальний PDF, і склеюємо їх докупи.
  type PendingRecovery = {
    pdfName: string;
    pageBoxes: Record<number, Box[]>;
    pageLines?: Record<number, LineSet>;
    meta?: { archive: string; fund: string; opys: string };
  };
  const [pendingRecovery, setPendingRecovery] = useState<PendingRecovery | null>(null);
  const recoveryPdfInputRef = useRef<HTMLInputElement>(null);
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
  // Прямокутники чіпів номерів зон (у нормованих координатах) — для того, щоб
  // клацанням по конкретному номеру можна було виділити саме потрібну зону зі
  // стопки накладених. Заповнюється під час малювання канвасу.
  const chipRectsRef = useRef<Array<{ id: string; x: number; y: number; w: number; h: number }>>([]);

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

  // Рятівне склеювання: береться pending-метадані з пошкодженого .dsds і
  // окремий PDF-файл, який користувач щойно прикріпив. На виході — повноцінна
  // сесія в state, готова до експорту й роботи.
  const recoverSessionWithPdf = async (pdfFile: File) => {
    if (!pendingRecovery) return;
    setMsg('');
    try {
      // Зчитаємо перші 5 байт — переконатися, що це насправді PDF.
      const head = new Uint8Array(await pdfFile.slice(0, 5).arrayBuffer());
      const isPdf =
        head.length >= 5 &&
        head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
      if (!isPdf) {
        setMsg('❌ Прикріплений файл не схожий на PDF.');
        return;
      }
      const pdfBuf = await pdfFile.arrayBuffer();
      // pdfName у відновленій сесії беремо з .dsds (бо саме так він буде
      // називатися при наступному експорті); попередження, якщо імена не збігаються.
      if (pdfFile.name !== pendingRecovery.pdfName) {
        const ok = window.confirm(
          `Імена не збігаються:\n  у сесії: ${pendingRecovery.pdfName}\n  у файлі: ${pdfFile.name}\n\nВсе одно склеїти?`
        );
        if (!ok) return;
      }
      const r = await applyImportedSession(
        {
          pdfName: pendingRecovery.pdfName,
          pageBoxes: pendingRecovery.pageBoxes,
          pageLines: pendingRecovery.pageLines,
          meta: pendingRecovery.meta,
        },
        pdfBuf
      );
      setPendingRecovery(null);
      setMsg(
        `✅ Сесію відновлено: ${r.totalRestored} зон на ${r.pagesWithBoxes} стор.` +
          (r.linesPages ? `; лінії на ${r.linesPages} стор.` : '') +
          ' Тепер можна одразу натиснути «💾 Експорт», щоб отримати валідний .dsds.'
      );
    } catch (e: any) {
      setMsg(`❌ Не вдалося відновити сесію: ${e?.message || e}`);
    }
  };

  // Універсальний обробник: розпізнає тип за магіком всередині файлу, а не за
  // розширенням чи MIME (це важливо, коли файл прийшов через Telegram / пошту
  // і втратив правильне розширення).
  const dispatchDroppedFile = async (file: File) => {
    setMsg('');
    try {
      const headBuf = await file.slice(0, 5).arrayBuffer();
      const head = new Uint8Array(headBuf);
      const isDsds =
        head.length >= 4 &&
        head[0] === CONTAINER_MAGIC[0] &&
        head[1] === CONTAINER_MAGIC[1] &&
        head[2] === CONTAINER_MAGIC[2] &&
        head[3] === CONTAINER_MAGIC[3];
      const isPdf =
        head.length >= 5 &&
        head[0] === 0x25 && // %
        head[1] === 0x50 && // P
        head[2] === 0x44 && // D
        head[3] === 0x46 && // F
        head[4] === 0x2d;   // -
      const isJsonLike = head.length >= 1 && (head[0] === 0x7b || head[0] === 0x20 || head[0] === 0x0a);
      if (isDsds || isJsonLike) {
        await importSession(file);
        return;
      }
      if (isPdf) {
        // Якщо чекаємо на PDF для відновлення сесії — підставляємо саме його.
        if (pendingRecovery) {
          await recoverSessionWithPdf(file);
          return;
        }
        await loadPdf(file);
        return;
      }
      setMsg('❌ Не вдалося розпізнати файл. Очікувався PDF або файл сесії (.dsds / .json).');
    } catch (e: any) {
      setMsg(`❌ Помилка при відкритті файлу: ${e?.message || e}`);
    }
  };

  const loadPdf = async (file: File) => {
    // type у Файла від Telegram-завантажень може бути порожнім — звіряємось додатково за PDF-магіком.
    if (!file) {
      setMsg('❌ Файл не обрано.');
      return;
    }
    if (file.type && file.type !== 'application/pdf') {
      // Перевіримо магік: %PDF- (для випадку коли .pdf перейменований / type зіпсований).
      try {
        const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
        const ok =
          head.length >= 5 &&
          head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
        if (!ok) {
          setMsg('❌ Це не PDF-файл.');
          return;
        }
      } catch {
        setMsg('❌ Не вдалося прочитати файл.');
        return;
      }
    }
    setMsg('');
    setUploadDone(null);
    setPageBoxes({});
    setPageLines({});
    try {
      const buf = await file.arrayBuffer();
      // ВАЖЛИВО: передаємо pdf.js НЕЗАЛЕЖНУ копію байтів. Інакше воркер pdf.js
      // може «відірвати» (detach) наш ArrayBuffer, і pdfBuffer перетвориться
      // на 0-байтовий — експорт сесії запише в .dsds порожній PDF, який потім
      // не можна імпортувати.
      const forPdfjs = new Uint8Array(buf.byteLength);
      forPdfjs.set(new Uint8Array(buf));
      setPdfBuffer(buf);
      const doc = await pdfjs.getDocument({ data: forPdfjs }).promise;
      setPdf(doc);
      setPdfName(file.name);
      setPage(1);
      await renderPage(doc, 1);
    } catch (e: any) {
      setMsg(`❌ Не вдалося відкрити PDF: ${e?.message || e}`);
      setPdfBuffer(null);
      setPdf(null);
      setPdfName('');
    }
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
      // Скидаємо реєстр чіпів — заповниться нижче під час обходу зон.
      chipRectsRef.current = [];
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
        // Чіп номера + позначка групи. У мультизонній групі — лейбл «N.M»,
        // де N — номер групи, M — порядок частини всередині (1 = найвища).
        const chipLabel = labelForBox(b, idx);
        ctx.font = 'bold 18px sans-serif';
        const labelWidth = ctx.measureText(chipLabel).width;
        const chipW = Math.max(28, labelWidth + 14) + (inGroup ? 22 : 0);
        const chipH = 26;
        // Якщо чіп перекривається з уже намальованим чіпом іншої зони — опускаємо
        // його на висоту чіпа + 2px зазору, щоб номери накладених зон були всі видні.
        let chipX = x;
        let chipY = y;
        for (let guard = 0; guard < 20; guard++) {
          const overlap = chipRectsRef.current.some(r => {
            const rx = r.x * canvas.width;
            const ry = r.y * canvas.height;
            const rw = r.w * canvas.width;
            const rh = r.h * canvas.height;
            return !(chipX + chipW < rx || chipX > rx + rw || chipY + chipH < ry || chipY > ry + rh);
          });
          if (!overlap) break;
          chipY += chipH + 2;
        }
        chipRectsRef.current.push({
          id: b.id,
          x: chipX / canvas.width,
          y: chipY / canvas.height,
          w: chipW / canvas.width,
          h: chipH / canvas.height,
        });
        ctx.fillStyle = color;
        ctx.fillRect(chipX, chipY, chipW, chipH);
        ctx.fillStyle = 'white';
        ctx.fillText(chipLabel, chipX + 7, chipY + 19);
        if (inGroup) {
          ctx.font = 'bold 14px sans-serif';
          ctx.fillText('🔗', chipX + labelWidth + 12, chipY + 19);
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

        // Кнопка «розʼєднати» — лише для виділеної зони у спільній справі.
        // Слейт-коло з білою стрілкою «↮» ліворуч від хрестика видалення.
        if (inGroup && selectedIds.has(b.id)) {
          const ux = cx - 34;
          const uy = cy;
          ctx.fillStyle = 'rgba(71, 85, 105, 0.95)';
          ctx.beginPath();
          ctx.arc(ux, uy, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = 'white';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('↮', ux, uy + 1);
          ctx.textAlign = 'start';
          ctx.textBaseline = 'alphabetic';

          // Кнопка «змінити послідовність» — ліворуч від «розʼєднати».
          // Клік: натиснута зона міняється місцями з попередньою у груповому порядку
          // (з обгортанням). Для пари 1.1↔1.2 — простий своп.
          const rx = cx - 66;
          const ry = cy;
          ctx.fillStyle = 'rgba(71, 85, 105, 0.95)';
          ctx.beginPath();
          ctx.arc(rx, ry, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = 'white';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('⇅', rx, ry + 1);
          ctx.textAlign = 'start';
          ctx.textBaseline = 'alphabetic';
        }

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

  // Кнопка «розʼєднати» — лише коли зона виділена і входить у спільну справу.
  // Положення: коло (r=14) ліворуч від хрестика видалення (зазор 6px між колами).
  const hitUngroupHandle = (point: { x: number; y: number }, b: Box): boolean => {
    if (!canvasRef.current) return false;
    if (!selectedIds.has(b.id)) return false;
    const items = groups.get(b.groupId);
    if (!items || items.length <= 1) return false;
    const W = canvasRef.current.width;
    const H = canvasRef.current.height;
    const lp = localPoint(point, b);
    const cxPx = (b.x + b.w) * W - 14 - 34; // 34px ліворуч від close X
    const cyPx = b.y * H + 14;
    const px = lp.x * W;
    const py = lp.y * H;
    const dx = px - cxPx;
    const dy = py - cyPx;
    return Math.sqrt(dx * dx + dy * dy) <= 14;
  };

  // Кнопка «змінити послідовність» — ліворуч від «розʼєднати», ще на 32px.
  const hitReorderHandle = (point: { x: number; y: number }, b: Box): boolean => {
    if (!canvasRef.current) return false;
    if (!selectedIds.has(b.id)) return false;
    const items = groups.get(b.groupId);
    if (!items || items.length <= 1) return false;
    const W = canvasRef.current.width;
    const H = canvasRef.current.height;
    const lp = localPoint(point, b);
    const cxPx = (b.x + b.w) * W - 14 - 66;
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
    // Якщо зона у складі спільної справи (крос-сторінкова група >1 зони) —
    // виділяємо/знімаємо ВСІ зони цієї справи разом, бо вони працюють як одне ціле.
    const target = allBoxesWithPage.find(it => it.box.id === id);
    const groupItems = target ? groups.get(target.box.groupId) : null;
    const ids =
      groupItems && groupItems.length > 1 ? groupItems.map(it => it.box.id) : [id];
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        for (const i of ids) next.delete(i);
      } else {
        for (const i of ids) next.add(i);
      }
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
    // 0) Кнопка «змінити послідовність» — найвищий пріоритет (виділена зона + у групі).
    for (const b of boxes) {
      if (hitReorderHandle(p, b)) {
        reorderGroupOnClick(b.id, b.groupId);
        actionRef.current = null;
        return;
      }
    }
    // 0.1) Кнопка «розʼєднати» — пріоритет (тільки для виділеної зони у спільній справі).
    for (const b of boxes) {
      if (hitUngroupHandle(p, b)) {
        ungroupAll(b.groupId);
        actionRef.current = null;
        return;
      }
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
      // Спершу перевіряємо клік по чіпу номера (у зворотному порядку — верхній
      // намальований чіп має пріоритет). Це дає змогу клацанням саме по номеру
      // виділити потрібну зону зі стопки накладених, а не «верхню» за тілом.
      for (let i = chipRectsRef.current.length - 1; i >= 0; i--) {
        const r = chipRectsRef.current[i];
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
          toggleSelected(r.id);
          return;
        }
      }
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

  // Нумерація мультизонних груп: groupId → послідовний номер (1, 2, 3...). Стабільна
  // в межах сесії: при дод/видаленні груп номери можуть зсунутись, що ОК для UI.
  const groupNumber = new Map<string, number>(
    multiBoxGroups.map(([gid], i) => [gid, i + 1])
  );

  // Допоміжне: повертає UI-лейбл для зони. Для самотніх зон — її індекс на сторінці
  // (`1`, `2`...). Для зон у складі мультизонної групи — `groupN.partM` (напр., `1.1`).
  const labelForBox = (box: Box, pageIndex: number): string => {
    const groupItems = groups.get(box.groupId);
    if (groupItems && groupItems.length > 1) {
      const partIdx = groupItems.findIndex(it => it.box.id === box.id);
      const groupN = groupNumber.get(box.groupId) || 0;
      return `${groupN}.${partIdx + 1}`;
    }
    return String(pageIndex + 1);
  };

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

  // «Розплодити» спільну СПРАВУ (одну або кілька зон) на N окремих справ.
  // Anchor-набір = усі зони групи першої виділеної зони. Якщо перша виділена
  // у складі спільної справи (1.1+1.2) — anchor-набір = [1.1, 1.2]; інакше —
  // одна зона. Решта виділених зон, що НЕ належать цій групі, — партнери.
  // Перший партнер «забирає» оригінальні anchor-зони у нову групу; кожен
  // наступний — клонує anchor-зони (нові id, та сама геометрія) і додається сам.
  const distributeMerge = () => {
    if (selectedIds.size < 2) return;
    const ordered = [...selectedIds];
    const firstId = ordered[0];
    const firstItem = allBoxesWithPage.find(it => it.box.id === firstId);
    if (!firstItem) return;
    const anchorGroupId = firstItem.box.groupId;
    const anchorItems = allBoxesWithPage
      .filter(it => it.box.groupId === anchorGroupId)
      .sort((a, b) => {
        const oa = a.box.groupOrder ?? -1;
        const ob = b.box.groupOrder ?? -1;
        if (oa !== ob && oa >= 0 && ob >= 0) return oa - ob;
        return a.page - b.page || a.box.y - b.box.y;
      });
    const anchorIdSet = new Set(anchorItems.map(it => it.box.id));
    const partnerIds = ordered.filter(id => !anchorIdSet.has(id));
    if (partnerIds.length === 0) return;
    const anchorN = anchorItems.length;
    setPageBoxes(prev => {
      const next: Record<number, Box[]> = {};
      for (const [k, list] of Object.entries(prev) as [string, Box[]][]) {
        next[+k] = [...list];
      }
      partnerIds.forEach((partnerId, idx) => {
        const groupId = newId();
        if (idx === 0) {
          // Перший партнер: усі anchor-зони + партнер ідуть у нову групу.
          // Anchor-зони отримують groupOrder 0..N-1 (у тому порядку, що в anchorItems),
          // партнер — groupOrder N.
          for (const k of Object.keys(next)) {
            next[+k] = next[+k].map(b => {
              if (anchorIdSet.has(b.id)) {
                const order = anchorItems.findIndex(it => it.box.id === b.id);
                return { ...b, groupId, groupOrder: order };
              }
              if (b.id === partnerId) {
                return { ...b, groupId, groupOrder: anchorN };
              }
              return b;
            });
          }
        } else {
          // Наступні партнери: клонуємо КОЖНУ anchor-зону на її сторінці у нову групу,
          // партнер додається останнім.
          anchorItems.forEach((it, ai) => {
            next[it.page] = [
              ...next[it.page],
              { ...it.box, id: newId(), groupId, groupOrder: ai },
            ];
          });
          for (const k of Object.keys(next)) {
            next[+k] = next[+k].map(b =>
              b.id === partnerId ? { ...b, groupId, groupOrder: anchorN } : b
            );
          }
        }
      });
      return next;
    });
    setSelectedIds(new Set());
    const shared = anchorN === 1 ? 'спільною зоною' : `спільними ${anchorN} зонами`;
    setMsg(`✅ Створено ${partnerIds.length} справ зі ${shared}.`);
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

  // Поміняти натиснуту зону місцями з попередньою у груповому порядку (з обгортанням).
  // Для пари — простий своп (1.1 ↔ 1.2). Для більших груп — кожен клік піднімає
  // натиснуту зону на одну позицію вгору; коли вона зверху, наступний клік скидає
  // її в самий низ. Послідовні кліки циклічно перебирають усі позиції.
  const reorderGroupOnClick = (clickedBoxId: string, groupId: string) => {
    setPageBoxes(prev => {
      type Mem = { page: number; box: Box };
      const members: Mem[] = [];
      for (const [k, list] of Object.entries(prev) as [string, Box[]][]) {
        for (const b of list) {
          if (b.groupId === groupId) members.push({ page: +k, box: b });
        }
      }
      if (members.length < 2) return prev;
      // Той самий порядок сортування, що й у viewer `groups`:
      // groupOrder якщо заданий, інакше — геометричний (page, y).
      members.sort((a, b) => {
        const oa = a.box.groupOrder ?? -1;
        const ob = b.box.groupOrder ?? -1;
        if (oa !== ob && oa >= 0 && ob >= 0) return oa - ob;
        return a.page - b.page || a.box.y - b.box.y;
      });
      const idx = members.findIndex(m => m.box.id === clickedBoxId);
      if (idx < 0) return prev;
      const prevIdx = (idx - 1 + members.length) % members.length;
      const newSeq = members.slice();
      [newSeq[idx], newSeq[prevIdx]] = [newSeq[prevIdx], newSeq[idx]];
      const orderById = new Map<string, number>();
      newSeq.forEach((m, i) => orderById.set(m.box.id, i));
      const next: Record<number, Box[]> = {};
      for (const [k, list] of Object.entries(prev) as [string, Box[]][]) {
        next[+k] = list.map(b =>
          orderById.has(b.id) ? { ...b, groupOrder: orderById.get(b.id)! } : b
        );
      }
      return next;
    });
  };

  // ---------- Експорт / імпорт сесії ----------
  const exportSession = () => {
    if (!pdfBuffer || !pdfName) {
      setMsg('Немає PDF для експорту.');
      return;
    }
    // Зберігаємо тільки сторінки, на яких є хоч одна лінія.
    const linesToSave: Record<number, LineSet> = {};
    for (const [k, ls] of Object.entries(pageLines) as [string, LineSet][]) {
      if (ls.v.length > 0 || ls.h.length > 0) linesToSave[parseInt(k, 10)] = ls;
    }
    const metadata: SessionContainerMetadata = {
      version: SESSION_VERSION,
      container: 'dsdp-1',
      savedAt: new Date().toISOString(),
      pdfName,
      pageBoxes,
      ...(Object.keys(linesToSave).length > 0 ? { pageLines: linesToSave } : {}),
      meta: { archive, fund, opys },
    };
    let jsonBytes: Uint8Array;
    try {
      jsonBytes = new TextEncoder().encode(JSON.stringify(metadata));
    } catch (e: any) {
      setMsg(`❌ Не вдалося серіалізувати метадані сесії: ${e?.message || e}`);
      return;
    }
    const header = new Uint8Array(CONTAINER_HEADER_BYTES);
    header[0] = CONTAINER_MAGIC[0];
    header[1] = CONTAINER_MAGIC[1];
    header[2] = CONTAINER_MAGIC[2];
    header[3] = CONTAINER_MAGIC[3];
    header[4] = CONTAINER_VERSION;
    new DataView(header.buffer).setUint32(5, jsonBytes.length, true);
    try {
      // Blob склеює без додаткових копій великих рядків — на 100+ МБ працює без btoa.
      const blob = new Blob([header, jsonBytes, pdfBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const baseName = pdfName.replace(/\.pdf$/i, '');
      a.href = url;
      a.download = `${baseName}__session-${ts}.dsds`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setMsg(`❌ Не вдалося зберегти файл сесії: ${e?.message || e}`);
      return;
    }
    const linesPages = Object.keys(linesToSave).length;
    setMsg(
      `✅ Сесія експортована (${totalBoxes} зон на ${pagesWithBoxes.length} стор.` +
        (linesPages ? `; лінії на ${linesPages} стор.` : '') +
        ')'
    );
  };

  // Спільне відновлення стану зі вже декодованих метаданих + сирого PDF-буферу.
  // Викликається з обох гілок імпорту (новий бінарний контейнер і старий JSON).
  const applyImportedSession = async (
    data: {
      pdfName: string;
      pageBoxes: Record<number, Box[]>;
      pageLines?: Record<number, LineSet>;
      meta?: { archive: string; fund: string; opys: string };
    },
    pdfBuf: ArrayBuffer
  ): Promise<{ totalRestored: number; linesPages: number; pagesWithBoxes: number }> => {
    // Передаємо pdf.js окрему копію — щоб наш pdfBuf лишився цілим (для майбутнього експорту).
    const forPdfjs = new Uint8Array(pdfBuf.byteLength);
    forPdfjs.set(new Uint8Array(pdfBuf));
    const doc = await pdfjs.getDocument({ data: forPdfjs }).promise;
    setPdf(doc);
    setPdfName(data.pdfName);
    setPdfBuffer(pdfBuf);
    const restored: Record<number, Box[]> = {};
    Object.entries(data.pageBoxes || {}).forEach(([k, v]) => {
      const arr = (v as any[]) || [];
      restored[parseInt(k, 10)] = arr.map(b => {
        const id = b.id || newId();
        return { x: b.x, y: b.y, w: b.w, h: b.h, id, groupId: b.groupId || id };
      });
    });
    setPageBoxes(restored);
    const restoredLines: Record<number, LineSet> = {};
    Object.entries(data.pageLines || {}).forEach(([k, v]) => {
      const ls = v as any;
      const vArr: number[] = Array.isArray(ls?.v) ? ls.v.filter((n: any) => typeof n === 'number') : [];
      const hRaw: any[] = Array.isArray(ls?.h) ? ls.h : [];
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
    return {
      totalRestored,
      linesPages: Object.keys(restoredLines).length,
      pagesWithBoxes: Object.keys(restored).filter(k => restored[+k].length > 0).length,
    };
  };

  const importSession = async (file: File) => {
    setMsg('');
    try {
      // Перші байти — диспетчер формату. "DSDP" → новий бінарний контейнер; інакше — старий JSON.
      const headBuf = await file.slice(0, CONTAINER_HEADER_BYTES).arrayBuffer();
      const headBytes = new Uint8Array(headBuf);
      const isContainer =
        headBytes.length >= 4 &&
        headBytes[0] === CONTAINER_MAGIC[0] &&
        headBytes[1] === CONTAINER_MAGIC[1] &&
        headBytes[2] === CONTAINER_MAGIC[2] &&
        headBytes[3] === CONTAINER_MAGIC[3];
      if (isContainer) {
        const ver = headBytes[4];
        if (ver !== CONTAINER_VERSION) {
          throw new Error(`Невідома версія контейнера: ${ver}`);
        }
        const jsonLen = new DataView(headBytes.buffer, headBytes.byteOffset, headBytes.byteLength)
          .getUint32(5, true);
        // Метадані — окремо як невелика частина; PDF — як решта файлу.
        const jsonBuf = await file.slice(CONTAINER_HEADER_BYTES, CONTAINER_HEADER_BYTES + jsonLen).arrayBuffer();
        const metaParsed = JSON.parse(new TextDecoder().decode(jsonBuf));
        if (!metaParsed?.pdfName) throw new Error('Контейнер пошкоджений: немає pdfName');
        const pdfBlob = file.slice(CONTAINER_HEADER_BYTES + jsonLen);
        const pdfBuf = await pdfBlob.arrayBuffer();
        if (pdfBuf.byteLength === 0) {
          // PDF-секція порожня (наслідок старого бага експорту). Метадані цілі —
          // переходимо в режим відновлення: пропонуємо прикріпити оригінальний PDF.
          setPendingRecovery({
            pdfName: metaParsed.pdfName,
            pageBoxes: metaParsed.pageBoxes || {},
            pageLines: metaParsed.pageLines,
            meta: metaParsed.meta,
          });
          setMsg(
            `ℹ️ PDF всередині .dsds порожній (наслідок старого бага). Прикріпіть оригінальний PDF "${metaParsed.pdfName}" — і всі зони / реквізити відновляться.`
          );
          return;
        }
        const r = await applyImportedSession(
          {
            pdfName: metaParsed.pdfName,
            pageBoxes: metaParsed.pageBoxes || {},
            pageLines: metaParsed.pageLines,
            meta: metaParsed.meta,
          },
          pdfBuf
        );
        setMsg(
          `✅ Сесія імпортована: ${r.totalRestored} зон на ${r.pagesWithBoxes} стор.` +
            (r.linesPages ? `; лінії на ${r.linesPages} стор.` : '')
        );
        return;
      }
      // ---- Старий JSON-формат: повна сесія в одному рядку з PDF як base64. ----
      const text = await file.text();
      const data: SessionFile = JSON.parse(text);
      if (!data?.pdfBase64 || !data?.pdfName) {
        throw new Error('Файл сесії пошкоджений (немає PDF)');
      }
      const buf = base64ToArrayBuffer(data.pdfBase64);
      const forPdfjs = new Uint8Array(buf.byteLength);
      forPdfjs.set(new Uint8Array(buf));
      const doc = await pdfjs.getDocument({ data: forPdfjs }).promise;
      setPdf(doc);
      setPdfName(data.pdfName);
      setPdfBuffer(buf);
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

      {/* Банер відновлення сесії з пошкодженого .dsds */}
      {!pdf && pendingRecovery && (
        <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm space-y-2">
          <div className="font-medium text-amber-900">
            🛟 Чекаємо на оригінальний PDF для відновлення сесії
          </div>
          <div className="text-xs text-amber-900/90">
            У файлі .dsds, який ви відкрили, PDF-секція виявилась порожньою
            (стара помилка експорту). Метадані цілі —{' '}
            <b>{(Object.values(pendingRecovery.pageBoxes || {}) as Box[][]).reduce((s, a) => s + a.length, 0)}</b>{' '}
            зон на{' '}
            {Object.keys(pendingRecovery.pageBoxes || {}).filter(k => ((pendingRecovery.pageBoxes as Record<number, Box[]>)[+k]?.length || 0) > 0).length}{' '}
            стор. Прикріпіть оригінальний PDF <b>{pendingRecovery.pdfName}</b>, і вся робота повернеться.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => recoveryPdfInputRef.current?.click()}
              className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded hover:bg-amber-700"
            >
              📎 Прикріпити оригінальний PDF
            </button>
            <input
              ref={recoveryPdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={e => e.target.files?.[0] && recoverSessionWithPdf(e.target.files[0])}
            />
            <button
              onClick={() => {
                setPendingRecovery(null);
                setMsg('');
              }}
              className="px-3 py-1 text-xs text-amber-900 hover:underline"
            >
              скасувати
            </button>
          </div>
        </div>
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
              if (f) dispatchDroppedFile(f);
            }}
            className={`flex flex-col items-center justify-center gap-2 p-10 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              dragOver ? 'bg-indigo-50 border-indigo-400' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'
            }`}
          >
            <UploadCloud size={36} className="text-slate-400" />
            <div className="text-sm font-medium">Натисніть або перетягніть PDF чи файл сесії сюди</div>
            <div className="text-xs text-slate-500">
              PDF буде нарізано на справи; файл сесії (.dsds / .json) — відкриє збережену роботу
            </div>
            <input
              type="file"
              className="hidden"
              onChange={e => e.target.files?.[0] && dispatchDroppedFile(e.target.files[0])}
            />
          </label>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>або</span>
            <button
              onClick={() => importInputRef.current?.click()}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 font-medium"
            >
              📂 Відновити збережену сесію (.dsds / .json)
            </button>
            <input
              ref={importInputRef}
              type="file"
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
              disabled={!pdfBuffer}
              className="px-2.5 py-1.5 bg-slate-200 text-slate-700 text-xs rounded hover:bg-slate-300 disabled:opacity-50"
              title="Зберегти PDF + усі зони у файл .dsds для продовження пізніше"
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
              <button
                onClick={distributeMerge}
                disabled={selectedIds.size < 2}
                className="px-3 py-1 bg-amber-700 text-white rounded text-xs disabled:opacity-50"
                title="Перша виділена зона — спільна. Кожна наступна об'єднається з її клоном в окрему нову справу. Створиться (N-1) справ."
              >
                🔀 Створити справи зі спільною
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
                const label = labelForBox(b, i);
                return (
                  <button
                    key={b.id}
                    onClick={() => toggleSelected(b.id)}
                    onDoubleClick={() => removeBox(i)}
                    className={`px-2 py-1 rounded text-xs ${
                      sel ? 'bg-amber-300 text-amber-900' : 'bg-indigo-100 text-indigo-700 hover:bg-amber-100'
                    }`}
                    title={inGroup
                      ? `Справа №${groupNumber.get(b.groupId)}, частина ${(groups.get(b.groupId)!.findIndex(it => it.box.id === b.id) + 1)}. Клац — виділити; подвійний клац — видалити`
                      : 'Клац — виділити; Подвійний клац — видалити'}
                    style={inGroup ? { borderLeft: `3px solid ${colorFromId(b.groupId)}` } : undefined}
                  >
                    {inGroup ? label : `#${i + 1}`}
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
              {multiBoxGroups.map(([gid, items], gi) => (
                <div
                  key={gid}
                  className="flex items-center gap-2 py-1 border-l-4 pl-2"
                  style={{ borderColor: colorFromId(gid) }}
                >
                  <span className="text-slate-700">
                    <b>Справа №{gi + 1}</b>
                  </span>
                  <button
                    onClick={() => ungroupAll(gid)}
                    className="text-xs text-slate-500 hover:text-red-600 underline"
                    title="Розгрупувати цю справу — кожна її зона стане окремою справою"
                  >
                    розгрупувати
                  </button>
                  <span className="text-slate-700">
                    · {items.length} {items.length === 1 ? 'частина' : 'частин'}:{' '}
                    {items.map((it, ii) => `${gi + 1}.${ii + 1} (стор. ${it.page})`).join(' + ')}
                  </span>
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

// ==================== EGRESS DISCLAIMER ====================
// Невеликий банер-попередження для вкладок, які тягнуть багато даних з БД.
// Мета — нагадати адміну: відкриття/оновлення цієї вкладки спалює quota Supabase
// (egress 5 GB/міс на Free tier). Бекендна частина вже кешує важкі ендпоінти, але
// часті ручні оновлення (особливо ?nocache=1) усе ще створюють навантаження.
const EgressWarning: React.FC<{
  level?: 'heavy' | 'very-heavy';
  endpoints: string[];      // напр. ['/admin/integrity'] — для прозорості
  cacheNote?: string;       // напр. 'Кешується 30 хв на бекенді.'
  children?: React.ReactNode; // довільний додатковий текст
}> = ({ level = 'heavy', endpoints, cacheNote, children }) => {
  const isVeryHeavy = level === 'very-heavy';
  const cls = isVeryHeavy
    ? 'bg-rose-50 border-rose-300 text-rose-900'
    : 'bg-amber-50 border-amber-300 text-amber-900';
  const label = isVeryHeavy ? 'Дуже важка вкладка' : 'Важка вкладка';
  return (
    <div className={`flex gap-2 items-start border rounded px-3 py-2 text-xs ${cls}`}>
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <div className="space-y-1">
        <div>
          <b>{label} за egress.</b>{' '}
          Кожне завантаження тягне багато даних з Supabase. На Free tier (5 GB/міс)
          часті оновлення швидко вичерпують квоту — оновлюйте лише за потреби.
        </div>
        {cacheNote && <div className="opacity-80">{cacheNote}</div>}
        <div className="opacity-60">Запити: {endpoints.join(', ')}</div>
        {children && <div>{children}</div>}
      </div>
    </div>
  );
};

// ==================== RESULTS ====================

const ResultsView: React.FC = () => {
  const [data, setData] = useState<{ questions: any[]; submissions: any[] } | null>(null);
  const [allDescriptions, setAllDescriptions] = useState<{ key: string; name: string; source: string }[]>([]);
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
        (ov.descriptions || []).map((d: any) => ({ key: d.key, name: d.name, source: d.source || 'telegram' }))
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
    loadFundEta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Видимість таблиці результатів — за замовч. сховано, щоб не вантажити сторінку.
  const [tableVisible, setTableVisible] = useState(false);

  // Статистика «сьогодні» — окремий запит до БД, не залежить від фільтрів/ліміту.
  const [todayStats, setTodayStats] = useState<{ cases: number; users: number; timezone: string } | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsErr, setStatsErr] = useState('');

  // Прогноз завершення фонду.
  type FundEta = Awaited<ReturnType<typeof tgApi.fundEta>>;
  const [fundEta, setFundEta] = useState<FundEta | null>(null);
  const [etaErr, setEtaErr] = useState('');
  const loadFundEta = async () => {
    setEtaErr('');
    try {
      const r = await tgApi.fundEta();
      setFundEta(r);
    } catch (e: any) {
      setEtaErr(e?.message || 'помилка');
    }
  };

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
    'Джерело',
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
      s.source === 'web' ? 'веб' : 'телеграм',
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
  // value кодує джерело: "<source>::<archive|fund|opys>" — щоб фільтр був точним
  // (телеграм і веб можуть мати однаковий опис).
  const descriptions: [string, string][] = allDescriptions
    .map(d => [`${d.source}::${d.key}`, `${d.name} (${d.source === 'web' ? 'веб' : 'телеграм'})`] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));

  const selectedDescriptionName = descFilter
    ? descriptions.find(([k]) => k === descFilter)?.[1] || ''
    : '';

  const filtered = data
    ? data.submissions.filter(s => {
        if (descFilter) {
          const sep = descFilter.indexOf('::');
          const src = sep >= 0 ? descFilter.slice(0, sep) : 'telegram';
          const key = sep >= 0 ? descFilter.slice(sep + 2) : descFilter;
          if ((s.source || 'telegram') !== src || descKeyOf(s) !== key) return false;
        }
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
    const sep = descFilter.indexOf('::');
    const src = sep >= 0 ? descFilter.slice(0, sep) : 'telegram';
    const rest = sep >= 0 ? descFilter.slice(sep + 2) : descFilter;
    const [archive, fund, opys] = rest.split('|');
    try {
      setBusy(true);
      setMsg('Завантажую всі підтвердження опису з БД…');
      const r = src === 'web'
        ? await tgApi.verifSubmissionsByDescription(archive, fund, opys)
        : await tgApi.submissionsByDescription(archive, fund, opys);
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
      <EgressWarning
        level="heavy"
        endpoints={['/admin/results', '/admin/overview', '/admin/fund-eta', '/admin/today-stats']}
        cacheNote="overview і today-stats кешуються 2–5 хв; results і fund-eta — без кешу."
      >
        Кнопка «Завантажити результати» тягне до {`${5000}`} останніх сабмішнів з усіма відповідями — найважчий запит цієї вкладки.
      </EgressWarning>
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
          onChange={e => { setDescFilterInput(e.target.value); setDescFilter(e.target.value); }}
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

      {/* Прогноз завершення фонду — завжди останнім рядком. */}
      <div className="text-sm border-t pt-3 mt-2">
        {etaErr && <div className="text-rose-700">Не вдалося порахувати прогноз: {etaErr}</div>}
        {!etaErr && fundEta && (
          <>
            <div>
              До завершення розпізнавання фонду №<b>{fundEta.fundNumber}</b> залишилося розпізнати{' '}
              <b>{fundEta.remaining}</b>{' '}
              {fundEta.remaining === 1 ? 'опис' : fundEta.remaining < 5 && fundEta.remaining > 0 ? 'описи' : 'описів'}
              .
            </div>
            <div className="text-slate-700">
              Прогнозована дата завершення розпізнавання, виходячи з поточної швидкості розпізнавання:{' '}
              {fundEta.etaDateLocal ? (
                <b>{fundEta.etaDateLocal}</b>
              ) : fundEta.remaining === 0 ? (
                <b>фонд уже повністю розпізнано 🎉</b>
              ) : (
                <span className="text-slate-500">
                  невідомо (за останні {fundEta.windowDays} дн. не завершився жоден опис)
                </span>
              )}
              {fundEta.etaDateLocal && (
                <span className="text-xs text-slate-500">
                  {' '}
                  · темп: {fundEta.ratePerDay.toFixed(2)} опис./день за останні {fundEta.windowDays} дн.; готово{' '}
                  {fundEta.totalDone}/{fundEta.totalDescriptions}
                </span>
              )}
            </div>
          </>
        )}
        {!fundEta && !etaErr && <span className="text-slate-500">Прогноз завантажується…</span>}
      </div>
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
  const [sub, setSub] = useState<'progress' | 'users'>('progress');
  const [descFilter, setDescFilter] = useState<DescFilter>('all');
  const [descPage, setDescPage] = useState(1);
  const [usersPage, setUsersPage] = useState(1);
  // Користувачі: режим балів — «весь час» (total_points) або «помісячно».
  const [userMode, setUserMode] = useState<'total' | 'monthly'>('total');
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState('');
  const [monthly, setMonthly] = useState<Array<{ tgId: string; points: number; displayName: string }>>([]);
  const [monthlyBusy, setMonthlyBusy] = useState(false);
  const [monthlyPage, setMonthlyPage] = useState(1);
  // Профіль користувача — модалка по кліку на рядок.
  const [profileTgId, setProfileTgId] = useState<string | null>(null);

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

  const loadMonthly = async (m?: string) => {
    setMonthlyBusy(true);
    setMsg('');
    try {
      const r = await tgApi.monthly(m);
      setMonths(r.months || []);
      setMonth(r.month || '');
      setMonthly(r.leaderboard || []);
      setMonthlyPage(1);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setMonthlyBusy(false);
    }
  };

  // Egress-фікс: не вантажимо автоматично при відкритті вкладки — лише по кнопці «Оновити».
  // (Раніше тут був useEffect(() => refresh(), []).)

  useEffect(() => {
    setDescPage(1);
  }, [descFilter]);

  // Перший перехід у «помісячно» — підвантажуємо місяці.
  useEffect(() => {
    if (userMode === 'monthly' && months.length === 0) loadMonthly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMode]);

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

  const monthlyTotalPages = Math.max(1, Math.ceil(monthly.length / USERS_PAGE_SIZE));
  const monthlyPageSafe = Math.min(monthlyPage, monthlyTotalPages);
  const monthlyPageRows = monthly.slice(
    (monthlyPageSafe - 1) * USERS_PAGE_SIZE,
    monthlyPageSafe * USERS_PAGE_SIZE
  );

  const srcLabel = (s?: string) => (s === 'web' ? 'веб' : 'телеграм');

  return (
    <div className="space-y-4 max-w-4xl">
      <EgressWarning
        level="heavy"
        endpoints={['/admin/overview', '/admin/monthly']}
        cacheNote="/admin/overview кешується 5 хв на бекенді."
      >
        Один запит тягне усіх юзерів + усі описи справ. Натискай «Оновити» тільки коли реально треба свіжі дані.
      </EgressWarning>
      <div className="flex items-center gap-2">
        <button onClick={refresh} disabled={busy} className="px-3 py-1.5 bg-slate-200 rounded text-sm flex items-center gap-1">
          <RefreshCw size={14} /> Оновити
        </button>
        <div className="flex gap-1">
          {([['progress', 'Прогрес'], ['users', 'Користувачі (за балами)']] as [typeof sub, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSub(k)}
              className={`px-3 py-1.5 text-sm rounded ${sub === k ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {msg && <div className="text-sm">{msg}</div>}

      {!data && !busy && (
        <div className="p-6 text-center text-sm text-slate-500 border border-dashed rounded">
          Дані не завантажено. Натисніть «Оновити», щоб підвантажити з БД.
        </div>
      )}

      {data && sub === 'progress' && (
        <section>
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
                    <th className="text-left p-1.5 whitespace-nowrap">Джерело</th>
                    <th className="text-right p-1.5 whitespace-nowrap">Готово</th>
                    <th className="text-right p-1.5 whitespace-nowrap">Справ</th>
                    <th className="text-right p-1.5 whitespace-nowrap">%</th>
                  </tr>
                </thead>
                <tbody>
                  {descPageRows.map((d: any) => (
                    <tr key={`${d.source || 'tg'}:${d.key}`} className="border-b">
                      <td className="p-1.5">{d.name}</td>
                      <td className="p-1.5">{srcLabel(d.source)}</td>
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
                <button onClick={() => setDescPage(p => Math.max(1, p - 1))} disabled={descPageSafe <= 1}
                  className="px-2 py-1 rounded border bg-white disabled:opacity-40">← Назад</button>
                <span className="px-2">Стор. {descPageSafe} / {descTotalPages}</span>
                <button onClick={() => setDescPage(p => Math.min(descTotalPages, p + 1))} disabled={descPageSafe >= descTotalPages}
                  className="px-2 py-1 rounded border bg-white disabled:opacity-40">Далі →</button>
              </div>
            )}
          </div>
        </section>
      )}

      {data && sub === 'users' && (
        <section>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {([['total', 'Весь час'], ['monthly', 'Помісячно']] as [typeof userMode, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setUserMode(k)}
                className={`px-3 py-1 text-xs rounded border ${userMode === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-300'}`}
              >
                {label}
              </button>
            ))}
            {userMode === 'monthly' && (
              <>
                <select
                  value={month}
                  onChange={e => loadMonthly(e.target.value)}
                  disabled={monthlyBusy || months.length === 0}
                  className="border rounded px-2 py-1 text-xs"
                >
                  {months.length === 0 && <option value="">— немає даних —</option>}
                  {months.map((m, i) => (
                    <option key={m} value={m}>{m}{i === 0 ? ' (поточний)' : ''}</option>
                  ))}
                </select>
                {monthlyBusy && <RefreshCw size={14} className="animate-spin text-slate-400" />}
              </>
            )}
          </div>

          {userMode === 'total' ? (
            <>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Імʼя</th>
                    <th className="text-left p-2">TG ID</th>
                    <th className="text-right p-2">Бали (всього)</th>
                    <th className="text-left p-2">Статус</th>
                    <th className="text-right p-2">Пропуски</th>
                  </tr>
                </thead>
                <tbody>
                  {usersPageRows.map((u: any, i: number) => (
                    <tr
                      key={u.tgId}
                      className="border-b cursor-pointer hover:bg-slate-50"
                      onClick={() => setProfileTgId(u.tgId)}
                      title="Натисніть, щоб відкрити профіль"
                    >
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
                  <button onClick={() => setUsersPage(p => Math.max(1, p - 1))} disabled={usersPageSafe <= 1}
                    className="px-2 py-1 rounded border bg-white disabled:opacity-40">← Назад</button>
                  <span className="px-2">Стор. {usersPageSafe} / {usersTotalPages}</span>
                  <button onClick={() => setUsersPage(p => Math.min(usersTotalPages, p + 1))} disabled={usersPageSafe >= usersTotalPages}
                    className="px-2 py-1 rounded border bg-white disabled:opacity-40">Далі →</button>
                </div>
              )}
            </>
          ) : (
            <>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Імʼя</th>
                    <th className="text-left p-2">TG ID</th>
                    <th className="text-right p-2">Бали ({month || '—'})</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyPageRows.length === 0 && !monthlyBusy && (
                    <tr><td colSpan={4} className="p-3 text-center text-slate-500">Немає даних за цей місяць</td></tr>
                  )}
                  {monthlyPageRows.map((u, i) => (
                    <tr
                      key={u.tgId}
                      className="border-b cursor-pointer hover:bg-slate-50"
                      onClick={() => setProfileTgId(u.tgId)}
                      title="Натисніть, щоб відкрити профіль"
                    >
                      <td className="p-2">{(monthlyPageSafe - 1) * USERS_PAGE_SIZE + i + 1}</td>
                      <td className="p-2">{u.displayName || '—'}</td>
                      <td className="p-2 font-mono text-xs">{u.tgId}</td>
                      <td className="p-2 text-right">{Math.round(u.points * 100) / 100}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {monthlyTotalPages > 1 && (
                <div className="flex items-center justify-end gap-1 text-xs pt-2">
                  <button onClick={() => setMonthlyPage(p => Math.max(1, p - 1))} disabled={monthlyPageSafe <= 1}
                    className="px-2 py-1 rounded border bg-white disabled:opacity-40">← Назад</button>
                  <span className="px-2">Стор. {monthlyPageSafe} / {monthlyTotalPages}</span>
                  <button onClick={() => setMonthlyPage(p => Math.min(monthlyTotalPages, p + 1))} disabled={monthlyPageSafe >= monthlyTotalPages}
                    className="px-2 py-1 rounded border bg-white disabled:opacity-40">Далі →</button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {profileTgId && (
        <UserProfileModal tgId={profileTgId} onClose={() => setProfileTgId(null)} />
      )}
    </div>
  );
};

// Модалка з повним профілем юзера (вкл. приватні поля).
const UserProfileModal: React.FC<{ tgId: string; onClose: () => void }> = ({ tgId, onClose }) => {
  const [p, setP] = useState<Awaited<ReturnType<typeof tgApi.userProfile>> | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);
  // Нарахування бонусних балів
  const [bonusPoints, setBonusPoints] = useState('');
  const [bonusReason, setBonusReason] = useState('');
  const [bonusBusy, setBonusBusy] = useState(false);
  const [bonusMsg, setBonusMsg] = useState('');

  const reload = () => {
    setBusy(true);
    setErr('');
    return tgApi
      .userProfile(tgId)
      .then(r => setP(r))
      .catch(e => setErr(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setErr('');
    tgApi
      .userProfile(tgId)
      .then(r => { if (!cancelled) setP(r); })
      .catch(e => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [tgId]);

  const grantBonus = async () => {
    const pts = Math.round(Number(bonusPoints) * 100) / 100;
    if (!Number.isFinite(pts) || pts <= 0) {
      setBonusMsg('⚠ Вкажіть додатну кількість балів');
      return;
    }
    if (!bonusReason.trim()) {
      setBonusMsg('⚠ Вкажіть причину нарахування');
      return;
    }
    setBonusBusy(true);
    setBonusMsg('');
    try {
      const r = await tgApi.grantBonus({ tgId, points: pts, reason: bonusReason.trim() });
      setBonusMsg(r.warning ? `✅ Нараховано (${r.newTotal}). ${r.warning}` : `✅ Нараховано! Новий баланс: ${r.newTotal}`);
      setBonusPoints('');
      setBonusReason('');
      await reload();
    } catch (e: any) {
      setBonusMsg(`⚠ ${e.message}`);
    } finally {
      setBonusBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-slate-800">Профіль користувача</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded text-slate-500">✕</button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          {busy && <div className="text-slate-500">Завантаження…</div>}
          {err && <div className="text-red-600">⚠ {err}</div>}
          {p && (
            <>
              <div className="flex items-start gap-4">
                {p.hasPhoto ? (
                  <img
                    src={tgApi.userPhotoUrl(p.tgId)}
                    alt={p.displayName}
                    className="w-24 h-24 rounded-lg object-cover border bg-slate-100"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-lg border bg-slate-100 flex items-center justify-center text-3xl text-slate-400">👤</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-base">{p.displayName || '—'}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">tg_id: {p.tgId}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Балів: {p.totalPoints} · {p.status}</div>
                  {p.source === 'web' && <div className="text-xs text-amber-600 mt-0.5">web-юзер{p.partnerId ? ` (partner: ${p.partnerId})` : ''}</div>}
                </div>
              </div>

              <Field label="Місто / село" value={p.city || '—'} />

              <div className="pt-3 border-t">
                <div className="text-xs font-semibold uppercase text-slate-400 mb-2">Приватне (лише адмін)</div>
                <Field
                  label="Telegram"
                  value={p.tgUsername
                    ? <a href={`https://t.me/${p.tgUsername}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">@{p.tgUsername}</a>
                    : <span className="text-slate-400">— (username не відомий)</span>}
                />
                <Field
                  label="Телефон"
                  value={p.phoneNumber
                    ? <a href={`tel:${p.phoneNumber}`} className="text-indigo-600 hover:underline">{p.phoneNumber}</a>
                    : '—'}
                />
                <Field
                  label="Facebook"
                  value={p.facebookUrl
                    ? <a href={p.facebookUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline break-all">{p.facebookUrl}</a>
                    : '—'}
                />
              </div>
              <div className="text-xs text-slate-400 pt-2 border-t">Створено: {p.createdAt ? new Date(p.createdAt).toLocaleString('uk-UA') : '—'}</div>

              {/* Нарахування бонусних балів за особливі заслуги */}
              <div className="pt-3 border-t">
                <div className="text-xs font-semibold uppercase text-slate-400 mb-2">🎉 Бонусні бали</div>
                <div className="space-y-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={bonusPoints}
                    onChange={e => setBonusPoints(e.target.value)}
                    placeholder="Кількість балів"
                    className="w-full border rounded px-2 py-1.5 text-sm"
                  />
                  <textarea
                    value={bonusReason}
                    onChange={e => setBonusReason(e.target.value)}
                    placeholder="За що саме (це побачить користувач у Telegram)"
                    rows={2}
                    className="w-full border rounded px-2 py-1.5 text-sm resize-y"
                  />
                  <button
                    onClick={grantBonus}
                    disabled={bonusBusy}
                    className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded disabled:opacity-50"
                  >
                    {bonusBusy ? 'Нараховую…' : 'Нарахувати бонус'}
                  </button>
                  {p.source === 'web' && (
                    <div className="text-xs text-amber-600">web-юзер: бали нарахуються, але повідомлення в Telegram не надійде.</div>
                  )}
                  {bonusMsg && <div className="text-xs text-slate-700">{bonusMsg}</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="grid grid-cols-[120px_1fr] gap-2">
    <div className="text-slate-500">{label}:</div>
    <div className="text-slate-800">{value}</div>
  </div>
);

// ==================== CHART ====================

type ChartPoint = { date: string; cases: number; users: number };

const ChartView: React.FC = () => {
  const [days, setDays] = useState(30);
  const [source, setSource] = useState<'all' | 'telegram' | 'web'>('all');
  const [data, setData] = useState<ChartPoint[] | null>(null);
  const [tz, setTz] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hover, setHover] = useState<number | null>(null);

  const load = async (d = days) => {
    setBusy(true);
    setErr('');
    try {
      const r = await tgApi.dailyActivity(d, source);
      setData(r.days || []);
      setTz(r.timezone || '');
    } catch (e: any) {
      setErr(e?.message || 'помилка');
    } finally {
      setBusy(false);
    }
  };

  // Egress-фікс: не вантажимо автоматично — ні на mount, ні при зміні period/source.
  // Адмін явно натискає «Оновити», коли реально треба свіжі дані.

  // Геометрія SVG.
  const width = 900;
  const height = 320;
  const padL = 50;
  const padR = 50;
  const padT = 20;
  const padB = 50;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const points = data || [];
  const n = points.length;
  const maxCases = Math.max(1, ...points.map(p => p.cases));
  const maxUsers = Math.max(1, ...points.map(p => p.users));

  // Дві осі Y: ліва — справи, права — користувачі. Кожна шкала автоматична.
  const xOf = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yCases = (v: number) => padT + plotH - (v / maxCases) * plotH;
  const yUsers = (v: number) => padT + plotH - (v / maxUsers) * plotH;

  const pathFor = (yFn: (v: number) => number, key: 'cases' | 'users') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yFn(p[key]).toFixed(1)}`).join(' ');

  // Сітка/тіки по 4 позначки.
  const ticks = 4;
  const casesTicks = Array.from({ length: ticks + 1 }, (_, i) => Math.round((maxCases * i) / ticks));
  const usersTicks = Array.from({ length: ticks + 1 }, (_, i) => Math.round((maxUsers * i) / ticks));

  // Скільки підписів дат показувати на осі X — щоб не наїжджали.
  const labelStep = Math.max(1, Math.ceil(n / 10));

  return (
    <div className="space-y-3 max-w-5xl">
      <EgressWarning
        level="heavy"
        endpoints={['/admin/daily-activity']}
        cacheNote="Кешується 10 хв за ключем (days, source). Автозавантаження вимкнено — тягне дані лише по кнопці «Оновити»."
      >
        Один запит — пагінація по 3 таблицях за N днів (особливо важко для 60/90 днів).
        Зміна періоду / джерела сама по собі НЕ робить запит — потрібно явно натиснути «Оновити».
      </EgressWarning>
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-sm text-slate-600">Період:</label>
        <select
          value={days}
          onChange={e => setDays(parseInt(e.target.value, 10))}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value={7}>7 днів</option>
          <option value={14}>14 днів</option>
          <option value={30}>30 днів</option>
          <option value={60}>60 днів</option>
          <option value={90}>90 днів</option>
        </select>
        <label className="text-sm text-slate-600 ml-2">Джерело:</label>
        <select
          value={source}
          onChange={e => setSource(e.target.value as 'all' | 'telegram' | 'web')}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="all">Все</option>
          <option value="telegram">Телеграм</option>
          <option value="web">Веб</option>
        </select>
        <button
          onClick={() => load(days)}
          disabled={busy}
          className="px-3 py-1.5 bg-slate-200 rounded text-sm flex items-center gap-1"
        >
          <RefreshCw size={14} /> {busy ? 'Завантаження…' : 'Оновити'}
        </button>
        {tz && <span className="text-xs text-slate-500 self-center">({tz})</span>}
        {err && <span className="text-xs text-rose-700 self-center">{err}</span>}
      </div>

      <div className="flex gap-4 text-sm">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-4 h-0.5 bg-indigo-600"></span>
          Розпізнаних справ
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-4 h-0.5 bg-emerald-600"></span>
          Користувачів
        </span>
      </div>

      <div className="border rounded bg-white p-2 overflow-x-auto">
        {data && n > 0 ? (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto"
            onMouseLeave={() => setHover(null)}
          >
            {/* Сітка та ліві тіки (справи) */}
            {casesTicks.map((v, i) => {
              const y = yCases(v);
              return (
                <g key={`gc${i}`}>
                  <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={1} />
                  <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#4f46e5">
                    {v}
                  </text>
                </g>
              );
            })}
            {/* Праві тіки (користувачі) */}
            {usersTicks.map((v, i) => {
              const y = yUsers(v);
              return (
                <text
                  key={`gu${i}`}
                  x={width - padR + 6}
                  y={y + 3}
                  textAnchor="start"
                  fontSize="10"
                  fill="#059669"
                >
                  {v}
                </text>
              );
            })}
            {/* Підписи осі X */}
            {points.map((p, i) =>
              i % labelStep === 0 || i === n - 1 ? (
                <text
                  key={`x${i}`}
                  x={xOf(i)}
                  y={height - padB + 14}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#64748b"
                >
                  {p.date.slice(5)}
                </text>
              ) : null
            )}
            {/* Лінія: справи */}
            <path d={pathFor(yCases, 'cases')} fill="none" stroke="#4f46e5" strokeWidth={2} />
            {/* Лінія: користувачі */}
            <path d={pathFor(yUsers, 'users')} fill="none" stroke="#059669" strokeWidth={2} />
            {/* Точки */}
            {points.map((p, i) => (
              <g key={`pt${i}`}>
                <circle cx={xOf(i)} cy={yCases(p.cases)} r={hover === i ? 4 : 2.5} fill="#4f46e5" />
                <circle cx={xOf(i)} cy={yUsers(p.users)} r={hover === i ? 4 : 2.5} fill="#059669" />
                {/* Інвізабельна "товста" зона для hover */}
                <rect
                  x={xOf(i) - plotW / (n * 2) - 1}
                  y={padT}
                  width={plotW / Math.max(1, n) + 2}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            ))}
            {/* Tooltip */}
            {hover !== null && points[hover] && (() => {
              const p = points[hover];
              const cx = xOf(hover);
              const tipW = 150;
              const tipH = 56;
              const tx = Math.max(padL, Math.min(width - padR - tipW, cx - tipW / 2));
              const ty = padT + 4;
              return (
                <g>
                  <line x1={cx} x2={cx} y1={padT} y2={padT + plotH} stroke="#94a3b8" strokeDasharray="3 3" />
                  <rect x={tx} y={ty} width={tipW} height={tipH} rx={4} fill="white" stroke="#cbd5e1" />
                  <text x={tx + 8} y={ty + 16} fontSize="11" fill="#0f172a">
                    {p.date}
                  </text>
                  <text x={tx + 8} y={ty + 32} fontSize="11" fill="#4f46e5">
                    Справ: <tspan fontWeight="700">{p.cases}</tspan>
                  </text>
                  <text x={tx + 8} y={ty + 48} fontSize="11" fill="#059669">
                    Користувачів: <tspan fontWeight="700">{p.users}</tspan>
                  </text>
                </g>
              );
            })()}
            {/* Підпис осей */}
            <text x={padL - 30} y={padT + plotH / 2} fontSize="10" fill="#4f46e5"
                  transform={`rotate(-90 ${padL - 30} ${padT + plotH / 2})`} textAnchor="middle">
              Справ
            </text>
            <text x={width - padR + 30} y={padT + plotH / 2} fontSize="10" fill="#059669"
                  transform={`rotate(90 ${width - padR + 30} ${padT + plotH / 2})`} textAnchor="middle">
              Користувачів
            </text>
          </svg>
        ) : (
          <div className="p-8 text-center text-sm text-slate-500">
            {busy
              ? 'Завантаження…'
              : data
                ? 'Немає даних за обраний період.'
                : 'Дані не завантажено. Натисніть «Оновити», щоб підвантажити з БД.'}
          </div>
        )}
      </div>
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
  const [tgQuestions, setTgQuestions] = useState<any[]>([]);
  const [descriptions, setDescriptions] = useState<
    { key: string; name: string; donePct: number; doneCases: number; totalCases: number; source: 'tg' | 'web' }[]
  >([]);
  const [descKey, setDescKey] = useState('');
  const [descSource, setDescSource] = useState<'tg' | 'web'>('tg');
  const [webCache, setWebCache] = useState<{ key: string; submissions: any[] } | null>(null);
  // Те саме для TG — щоб повторне «Побудувати групи» для того ж descKey
  // не робило ще один важкий запит. Це state-memo (живе доки відкрита вкладка),
  // НЕ TTL-кеш — користувач явно просив без кешу.
  const [tgCache, setTgCache] = useState<{ key: string; submissions: any[] } | null>(null);
  const [numberColIdx, setNumberColIdx] = useState<number>(0);
  const [groups, setGroups] = useState<ProcessGroup[]>([]);
  const [step2Rows, setStep2Rows] = useState<Step2Row[]>([]);
  const [loadedCount, setLoadedCount] = useState<number>(0);
  const [llmBusy, setLlmBusy] = useState<Set<number>>(new Set());
  const [bulkLLM, setBulkLLM] = useState<{ done: number; total: number; current: number | null } | null>(null);
  const bulkCancelRef = useRef(false);

  const descName =
    descriptions.find(d => d.key === descKey && d.source === descSource)?.name || '';

  const refresh = async () => {
    setBusy(true);
    setMsg('');
    // Явна «Оновити дані» = адмін хоче свіжі дані. Скидаємо state-memo підвантажених
    // груп — інакше повторний buildGroups для того ж descKey віддав би старі subs.
    setTgCache(null);
    setWebCache(null);
    try {
      // Egress-фікс: замість важкого overview() (всі юзери + всі описи) —
      // легкий /admin/descriptions, який віддає лише агрегати по описах
      // (TG-частина через SQL bot_description_progress, без скану bot_cases у коді).
      const [q, descs] = await Promise.all([
        tgApi.getQuestions(),
        tgApi.descriptions('all'),
      ]);
      const qs = Array.isArray(q.questions) ? q.questions : [];
      setTgQuestions(qs);
      setQuestions(prev => (descSource === 'web' ? prev : qs));
      const all = ((descs.descriptions || []) as any[]).map(d => ({
        key: d.key,
        name: `${d.name} ${d.source === 'web' ? '(веб)' : '(телеграм)'}`,
        donePct: Number(d.donePct) || 0,
        doneCases: Number(d.doneCases) || 0,
        totalCases: Number(d.totalCases) || 0,
        source: (d.source === 'web' ? 'web' : 'tg') as 'tg' | 'web',
      }));
      setDescriptions(all.sort((a, b) => a.name.localeCompare(b.name)));
      if (descSource === 'tg' && numberColIdx >= qs.length) setNumberColIdx(qs.length > 0 ? 0 : -1);
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const onSelectDescription = async (value: string) => {
    setMsg('');
    if (!value) {
      setDescKey('');
      setDescSource('tg');
      setQuestions(tgQuestions);
      setNumberColIdx(tgQuestions.length > 0 ? 0 : -1);
      setWebCache(null);
      return;
    }
    const sep = value.indexOf('::');
    const src = (value.slice(0, sep) as 'tg' | 'web');
    const key = value.slice(sep + 2);
    setDescKey(key);
    setDescSource(src);
    if (src === 'web') {
      const [a, f, o] = key.split('|');
      setBusy(true);
      try {
        const r = await tgApi.verifSubmissionsByDescription(a, f, o);
        const qs = Array.isArray(r.questions) ? r.questions : [];
        setQuestions(qs);
        setNumberColIdx(qs.length > 0 ? 0 : -1);
        setWebCache({ key, submissions: Array.isArray(r.submissions) ? r.submissions : [] });
      } catch (e: any) {
        setMsg('❌ ' + e.message);
      } finally {
        setBusy(false);
      }
    } else {
      setQuestions(tgQuestions);
      setNumberColIdx(tgQuestions.length > 0 ? 0 : -1);
      setWebCache(null);
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
      if (descSource === 'web') {
        if (webCache && webCache.key === descKey) {
          subs = webCache.submissions;
        } else {
          const r = await tgApi.verifSubmissionsByDescription(archive, fund, opys);
          subs = Array.isArray(r.submissions) ? r.submissions : [];
          setWebCache({ key: descKey, submissions: subs });
        }
      } else {
        // Egress-фікс: state-memo для TG. Якщо для того ж descKey уже тягнули в цій
        // сесії — не повторюємо важкий запит. Очищається лише при перезавантаженні
        // вкладки/сторінки (як просив користувач — без TTL-кешу).
        if (tgCache && tgCache.key === descKey) {
          subs = tgCache.submissions;
        } else {
          const r = await tgApi.submissionsByDescription(archive, fund, opys);
          subs = Array.isArray(r.submissions) ? r.submissions : [];
          setTgCache({ key: descKey, submissions: subs });
        }
      }
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
    rows.sort((a, b) =>
      compareNumberInfo(
        parseNumberCell(a.answers[numberColIdx] || ''),
        parseNumberCell(b.answers[numberColIdx] || '')
      )
    );
    setStep2Rows(rows);
    setMissingNumbers(null);
    setStep('step2');
  };

  // Перевірка пропусків у номерах справ на Кроці 2. Запускається явно по кнопці.
  // null  → ще не перевіряли; масив → результат останньої перевірки.
  const [missingNumbers, setMissingNumbers] = useState<number[] | null>(null);

  const checkMissingNumbers = () => {
    if (numberColIdx < 0) {
      setMissingNumbers([]);
      return;
    }
    const bases = new Set<number>();
    for (const r of step2Rows) {
      if (r.isEmpty) continue;
      const info = parseNumberCell(String(r.answers[numberColIdx] ?? ''));
      if (info.base != null) bases.add(info.base);
    }
    if (bases.size === 0) {
      setMissingNumbers([]);
      return;
    }
    const min = Math.min(...bases);
    const max = Math.max(...bases);
    const missing: number[] = [];
    for (let n = min; n <= max; n++) if (!bases.has(n)) missing.push(n);
    setMissingNumbers(missing);
  };

  const addMissingNumbersAsEmpty = () => {
    if (!missingNumbers || missingNumbers.length === 0) return;
    const [descArchive = '', descFund = '', descOpys = ''] = (descKey || '').split('|');
    const existingEmpty = new Set(
      step2Rows
        .filter(r => r.isEmpty)
        .map(r => {
          const info = parseNumberCell(String(r.answers[numberColIdx] ?? ''));
          return info.base;
        })
        .filter((n): n is number => n != null)
    );
    const toAdd = missingNumbers.filter(n => !existingEmpty.has(n));
    if (toAdd.length === 0) {
      setMissingNumbers([]);
      return;
    }
    const extra: Step2Row[] = toAdd.map(n => {
      const ans = Array(questions.length).fill('');
      if (numberColIdx >= 0) ans[numberColIdx] = String(n);
      return {
        id: `e${n}`,
        isEmpty: true,
        answers: ans,
        archive: descArchive,
        fund: descFund,
        opys: descOpys,
        sourcePdf: '',
        page: '',
      };
    });
    const merged = [...step2Rows, ...extra].sort((a, b) =>
      compareNumberInfo(
        parseNumberCell(a.answers[numberColIdx] || ''),
        parseNumberCell(b.answers[numberColIdx] || '')
      )
    );
    setStep2Rows(merged);
    setMissingNumbers([]);
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
      <EgressWarning
        level="heavy"
        endpoints={['/admin/descriptions', '/admin/submissions-by-description', '/admin/verif-submissions-by-description']}
        cacheNote="Список описів — легка SQL-агрегація. Submissions-by-description — без кешу, але в межах сесії результат для того ж опису перевикористовується (не тягнемо знову)."
      >
        «Побудувати групи» завантажує ВСІ сабмішни/підтвердження обраного опису.
        Великі описи (сотні справ × 3 підтвердження) — мегабайти на один клік.
        Натискання «Оновити дані» свідомо скидає state-memo й змусить повторне завантаження.
      </EgressWarning>
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
              value={descKey ? `${descSource}::${descKey}` : ''}
              onChange={e => onSelectDescription(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm w-full"
            >
              <option value="">— оберіть опис —</option>
              {descriptions.map(d => (
                <option key={`${d.source}::${d.key}`} value={`${d.source}::${d.key}`}>
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
            <button
              onClick={checkMissingNumbers}
              disabled={numberColIdx < 0}
              title={
                numberColIdx < 0
                  ? 'Спершу позначте колонку-«номер» у питаннях'
                  : 'Пошукати номери справ, відсутні між мін. і макс. у поточній таблиці'
              }
              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-sm disabled:opacity-50"
            >
              Перевірити наявність незаповнених справ
            </button>
            <div className="text-sm text-slate-500">
              Рядків: {step2Rows.length} (порожніх: {step2Rows.filter(r => r.isEmpty).length})
            </div>
          </div>

          {missingNumbers !== null && (
            missingNumbers.length === 0 ? (
              <div className="border border-emerald-300 bg-emerald-50 rounded p-2 text-xs text-emerald-800">
                ✓ Пропусків у нумерації не знайдено.
              </div>
            ) : (
              <div className="border border-amber-300 bg-amber-50 rounded p-2 text-xs text-amber-900 space-y-1">
                <div className="font-medium">
                  ⚠ Знайдено {missingNumbers.length} відсутніх номерів між мін. і макс.:
                </div>
                <div className="flex flex-wrap gap-1">
                  {missingNumbers.map(n => (
                    <span key={n} className="px-1.5 py-0.5 bg-amber-100 border border-amber-300 rounded">
                      {n}
                    </span>
                  ))}
                </div>
                <div className="pt-1">
                  <button
                    onClick={addMissingNumbersAsEmpty}
                    className="px-3 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700"
                  >
                    Додати {missingNumbers.length} порожніх рядків
                  </button>
                  <button
                    onClick={() => setMissingNumbers(null)}
                    className="ml-2 px-3 py-1 bg-white border rounded text-xs hover:bg-slate-50"
                  >
                    Сховати
                  </button>
                </div>
              </div>
            )
          )}
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
  // Чи вже хоч раз завантажували перевірку. До цього таблиця не рендериться,
  // і автоперезавантаження по зміні параметрів не запускається.
  const [loaded, setLoaded] = useState(false);
  // Локальний стан по кнопках «Зняти бали»: tgId|caseId → 'busy' | 'done:<msg>' | 'err:<msg>'
  const [penaltyState, setPenaltyState] = useState<Record<string, string>>({});
  // Стан кнопок «Заблокувати»: tgId|caseId → 'busy' | 'done' | 'err:<msg>'
  const [banState, setBanState] = useState<Record<string, string>>({});
  // Список заблокованих користувачів (вантажиться по кнопці) + стан кнопок «Розблокувати».
  type BannedUser = { tgId: string; displayName: string; banReason: string; bannedAt: string; bannedBy: string; source: 'tg' | 'web' };
  const [bannedList, setBannedList] = useState<BannedUser[] | null>(null);
  const [bannedBusy, setBannedBusy] = useState(false);
  const [bannedErr, setBannedErr] = useState('');
  const [unbanState, setUnbanState] = useState<Record<string, string>>({});

  const refresh = async (t = threshold, resolved = includeResolved) => {
    setBusy(true);
    setMsg('');
    try {
      const r = await tgApi.integrity(t, resolved);
      setDiffs(r.diffs || []);
      setLoaded(true);
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  // Egress-фікс: прибрали авто-перезавантаження при зміні порогу / тогла.
  // Раніше debounce 400мс підтягував свіжий результат після кожної правки —
  // тепер адмін явно натискає «Оновити», коли вибрав цільові параметри.

  const pairKeyOf = (d: IntegrityDiff) => {
    const a = d.first.tgId || '';
    const b = d.second.tgId || '';
    const [first, second] = a < b ? [a, b] : [b, a];
    return `${d.caseId}|${first}|${second}`;
  };

  const userLabel = (u: IntegrityUser) =>
    `${u.displayName || '—'}${u.tgId ? ` (${u.tgId})` : ''}`;

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

  // Згортаємо попарні різниці в одну картку на справу.
  type CaseGroup = {
    caseId: string;
    archive: string;
    fund: string;
    opys: string;
    participants: { tgId: string; displayName: string; submittedAt: string }[];
    questions: { questionIndex: number; questionLabel: string; perUser: Record<string, string> }[];
    pairs: IntegrityDiff[];
    eventTime: number;
    reviewSummary: { open: number; penalized: number; dismissed: number };
  };

  const groups: CaseGroup[] = useMemo(() => {
    const byCase = new Map<string, IntegrityDiff[]>();
    for (const d of filtered) {
      const arr = byCase.get(d.caseId);
      if (arr) arr.push(d);
      else byCase.set(d.caseId, [d]);
    }
    const out: CaseGroup[] = [];
    for (const [caseId, pairs] of byCase) {
      const meta = pairs[0];
      const participantsMap = new Map<string, { tgId: string; displayName: string; submittedAt: string }>();
      const qMap = new Map<number, { questionIndex: number; questionLabel: string; perUser: Record<string, string> }>();
      for (const p of pairs) {
        if (p.first.tgId) participantsMap.set(p.first.tgId, p.first);
        if (p.second.tgId) participantsMap.set(p.second.tgId, p.second);
        for (const f of p.fields) {
          let q = qMap.get(f.questionIndex);
          if (!q) {
            q = { questionIndex: f.questionIndex, questionLabel: f.questionLabel, perUser: {} };
            qMap.set(f.questionIndex, q);
          }
          if (p.first.tgId) q.perUser[p.first.tgId] = f.from;
          if (p.second.tgId) q.perUser[p.second.tgId] = f.to;
        }
      }
      const summary = { open: 0, penalized: 0, dismissed: 0 };
      for (const p of pairs) {
        if (!p.review) summary.open++;
        else if (p.review.action === 'penalized') summary.penalized++;
        else summary.dismissed++;
      }
      const participants = Array.from(participantsMap.values()).sort((a, b) =>
        a.submittedAt.localeCompare(b.submittedAt)
      );
      const questions = Array.from(qMap.values()).sort((a, b) => a.questionIndex - b.questionIndex);
      out.push({
        caseId,
        archive: meta.archive,
        fund: meta.fund,
        opys: meta.opys,
        participants,
        questions,
        pairs,
        eventTime: Math.max(...pairs.map(pairEventTime)),
        reviewSummary: summary,
      });
    }
    out.sort((a, b) => b.eventTime - a.eventTime);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  // Обираємо «еталонне» значення поля — найчастіше серед учасників.
  // При нічиї бере перше за порядком; пусті рядки рахуються нарівні.
  const pickReference = (perUser: Record<string, string>, order: string[]): string => {
    const counts = new Map<string, number>();
    for (const tg of order) {
      const v = perUser[tg] ?? '';
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    let best = perUser[order[0]] ?? '';
    let bestCount = -1;
    for (const tg of order) {
      const v = perUser[tg] ?? '';
      const c = counts.get(v) || 0;
      if (c > bestCount) {
        best = v;
        bestCount = c;
      }
    }
    return best;
  };

  // Дії над усією карткою.
  const dismissCase = async (g: CaseGroup) => {
    const open = g.pairs.filter(p => !p.review && p.first.tgId && p.second.tgId);
    if (open.length === 0) return;
    if (!window.confirm(`Позначити справу як «вирішено без штрафу» (${open.length} пар)?`)) return;
    setBusy(true);
    try {
      for (const p of open) {
        await tgApi.integrityDismiss(p.caseId, p.first.tgId, p.second.tgId);
      }
      if (diffs) {
        const ids = new Set(open.map(pairKeyOf));
        setDiffs(diffs.filter(x => !ids.has(pairKeyOf(x))));
      }
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const reopenCase = async (g: CaseGroup) => {
    const resolved = g.pairs.filter(p => p.review && p.first.tgId && p.second.tgId);
    if (resolved.length === 0) return;
    setBusy(true);
    try {
      for (const p of resolved) {
        await tgApi.integrityReopen(p.caseId, p.first.tgId, p.second.tgId);
      }
      await refresh(threshold, includeResolved);
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  // Штрафує користувача: знімає бали один раз (по першій його відкритій парі),
  // а решту відкритих пар з його участю — закриває як «вирішено без штрафу».
  const penalizeUser = async (g: CaseGroup, tgId: string) => {
    const pairsWithUser = g.pairs.filter(p => p.first.tgId === tgId || p.second.tgId === tgId);
    const openWithUser = pairsWithUser.filter(p => !p.review);
    if (openWithUser.length === 0) return;
    const u = openWithUser[0].first.tgId === tgId ? openWithUser[0].first : openWithUser[0].second;
    const key = `${tgId}|${g.caseId}`;
    if (!window.confirm(`Зняти ${PENALTY_POINTS} балів у "${userLabel(u)}" і повідомити його?`)) return;
    setPenaltyState(s => ({ ...s, [key]: 'busy' }));
    try {
      const firstPair = openWithUser[0];
      const side: 'first' | 'second' = firstPair.first.tgId === tgId ? 'first' : 'second';
      const fields = firstPair.fields.map(f => ({
        label: f.questionLabel,
        text: side === 'first' ? f.from : f.to,
      }));
      const r = await tgApi.penalize({
        tgId,
        points: PENALTY_POINTS,
        caseId: g.caseId,
        archive: g.archive,
        fund: g.fund,
        opys: g.opys,
        fields,
        pairTgIdA: firstPair.first.tgId,
        pairTgIdB: firstPair.second.tgId,
      });
      // Інші відкриті пари з цим юзером — закриваємо без додаткового штрафу.
      for (const p of openWithUser.slice(1)) {
        try {
          await tgApi.integrityDismiss(p.caseId, p.first.tgId, p.second.tgId);
        } catch {
          /* мовчки — основна дія вже відбулася */
        }
      }
      const warn = (r as any)?.warning ? ` ⚠️ ${(r as any).warning}` : '';
      setPenaltyState(s => ({
        ...s,
        [key]: `done:Новий баланс ${(r as any)?.newTotal ?? '?'}${warn}`,
      }));
      // Локально прибираємо всі пари з цим юзером — справа для нього вирішена.
      if (diffs) {
        setDiffs(
          diffs.filter(x => !(x.caseId === g.caseId && (x.first.tgId === tgId || x.second.tgId === tgId)))
        );
      }
    } catch (e: any) {
      setPenaltyState(s => ({ ...s, [key]: `err:${e.message || 'помилка'}` }));
    }
  };

  // Заблокувати учасника: після цього він не зможе виконати жодну дію (бот + веб).
  const banParticipant = async (g: CaseGroup, tgId: string) => {
    const u = g.participants.find(p => p.tgId === tgId);
    if (!u || !tgId) return;
    if (!window.confirm(
      `Заблокувати "${userLabel(u)}"?\n\nКористувач більше не зможе виконати жодну дію — ` +
      `і в боті, і на сайті йому повертатиметься повідомлення про блокування.`
    )) return;
    const key = `${tgId}|${g.caseId}`;
    setBanState(s => ({ ...s, [key]: 'busy' }));
    try {
      // Прикріплюємо одну з відкритих пар із цим юзером — щоб вона зникла зі списку.
      const openPair = g.pairs.find(
        p => !p.review && (p.first.tgId === tgId || p.second.tgId === tgId)
      );
      const r = await tgApi.integrityBan({
        tgId,
        caseId: openPair?.caseId,
        pairTgIdA: openPair?.first.tgId,
        pairTgIdB: openPair?.second.tgId,
      });
      const warn = (r as any)?.warning ? ` ⚠️ ${(r as any).warning}` : '';
      setBanState(s => ({ ...s, [key]: warn ? `err:${warn.trim()}` : 'done' }));
      // Локально прибираємо всі пари з цим юзером — для нього все вирішено.
      if (diffs) {
        setDiffs(
          diffs.filter(x => !(x.caseId === g.caseId && (x.first.tgId === tgId || x.second.tgId === tgId)))
        );
      }
    } catch (e: any) {
      setBanState(s => ({ ...s, [key]: `err:${e.message || 'помилка'}` }));
    }
  };

  // Завантажити список заблокованих (легкий slim-запит).
  const loadBanned = async () => {
    setBannedBusy(true);
    setBannedErr('');
    try {
      const r = await tgApi.bannedUsers();
      setBannedList(r.users || []);
    } catch (e: any) {
      setBannedErr(e.message || 'помилка');
    } finally {
      setBannedBusy(false);
    }
  };

  // Розблокувати одного користувача.
  const unbanOne = async (tgId: string) => {
    if (!window.confirm('Розблокувати цього користувача? Він знову зможе виконувати дії.')) return;
    setUnbanState(s => ({ ...s, [tgId]: 'busy' }));
    try {
      await tgApi.integrityUnban(tgId);
      setUnbanState(s => ({ ...s, [tgId]: 'done' }));
      setBannedList(list => (list ? list.filter(u => u.tgId !== tgId) : list));
    } catch (e: any) {
      setUnbanState(s => ({ ...s, [tgId]: `err:${e.message || 'помилка'}` }));
    }
  };

  return (
    <div className="space-y-3">
      <EgressWarning
        level="very-heavy"
        endpoints={['/admin/integrity']}
        cacheNote="Кешується 30 хв за ключем (threshold, includeResolved). Автозавантаження вимкнено — запит лише по кнопці."
      >
        НАЙВАЖЧИЙ ендпоінт адмінки: тягне ВСІ сабмішни, підтвердження, справи й перевірки.
        Виставляй поріг і тогл «вже опрацьовані» до бажаних значень, далі — кнопка
        «Завантажити перевірку» / «Оновити». Зміна параметрів сама по собі НЕ робить запит.
      </EgressWarning>
      <div className="text-sm text-slate-600">
        Шукаємо пари підтверджень однієї справи, де відповідь відрізняється від
        попередньої більше ніж на N символів (Levenshtein). Допомагає виявити
        користувачів, які не списують текст з зображення.
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => refresh()}
          disabled={busy}
          className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm flex items-center gap-1"
        >
          <RefreshCw size={14} /> {busy ? 'Завантаження…' : loaded ? 'Оновити' : 'Завантажити перевірку'}
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
          {loaded ? <>Справ зі суперечками: <b>{groups.length}</b></> : 'Натисніть «Завантажити перевірку»'}
        </div>
      </div>

      {/* Заблоковані користувачі — окрема легка панель (slim-запит, вантажиться по кнопці). */}
      <div className="border rounded p-3 bg-white">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={loadBanned}
            disabled={bannedBusy}
            className="px-3 py-1.5 bg-slate-700 text-white rounded text-sm flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw size={14} />
            {bannedBusy ? 'Завантаження…' : bannedList ? 'Оновити список заблокованих' : '🚫 Показати заблокованих'}
          </button>
          {bannedList && (
            <span className="text-sm text-slate-600">Заблоковано: <b>{bannedList.length}</b></span>
          )}
        </div>
        {bannedErr && <div className="text-sm text-rose-700 mt-2">{bannedErr}</div>}
        {bannedList && bannedList.length === 0 && (
          <div className="text-sm text-slate-500 mt-2">Заблокованих користувачів немає.</div>
        )}
        {bannedList && bannedList.length > 0 && (
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
            {bannedList.map(u => {
              const ust = unbanState[u.tgId] || '';
              const ubusy = ust === 'busy';
              const uerr = ust.startsWith('err:');
              return (
                <div
                  key={u.tgId}
                  className="border rounded p-2 bg-slate-50 flex items-start justify-between gap-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {u.displayName || '—'}{' '}
                      <span className="text-xs text-slate-400">({u.source === 'web' ? 'веб' : 'TG'})</span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono truncate">{u.tgId}</div>
                    {u.bannedAt && (
                      <div className="text-xs text-slate-400">
                        заблоковано: {new Date(u.bannedAt).toLocaleString('uk-UA')}
                      </div>
                    )}
                    {u.banReason && <div className="text-xs text-slate-500">причина: {u.banReason}</div>}
                    {uerr && <div className="text-xs text-rose-700">{ust.slice(4)}</div>}
                  </div>
                  <button
                    onClick={() => unbanOne(u.tgId)}
                    disabled={ubusy}
                    className="px-2 py-1 text-xs rounded font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0"
                  >
                    {ubusy ? 'Розблокування…' : 'Розблокувати'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {msg && <div className="text-sm">{msg}</div>}

      {loaded && groups.length === 0 && !busy && (
        <div className="text-sm text-slate-500 border rounded p-4 bg-slate-50">
          Розбіжностей понад порогом не знайдено.
        </div>
      )}

      {loaded && (
        <div className="space-y-3">
          {groups.map(g => {
            const order = g.participants.map(p => p.tgId);
            const allResolved = g.reviewSummary.open === 0 && (g.reviewSummary.penalized + g.reviewSummary.dismissed) > 0;
            return (
              <div key={g.caseId} className={`border rounded p-3 bg-white shadow-sm ${allResolved ? 'opacity-75' : ''}`}>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2 text-sm">
                  <div className="font-mono text-xs text-slate-500">{g.caseId}</div>
                  <div className="text-slate-700">
                    {g.archive} {g.fund}-{g.opys}
                  </div>
                  <div className="text-xs text-slate-500">
                    {g.participants.length} уч. • {g.pairs.length} пар
                    {g.reviewSummary.penalized > 0 && ` • ${g.reviewSummary.penalized} штраф.`}
                    {g.reviewSummary.dismissed > 0 && ` • ${g.reviewSummary.dismissed} пропущ.`}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {g.reviewSummary.open > 0 && (
                      <button
                        onClick={() => dismissCase(g)}
                        disabled={busy}
                        className="px-2 py-0.5 text-xs rounded bg-slate-200 hover:bg-slate-300 disabled:opacity-50"
                        title="Закрити всі відкриті пари цієї справи без штрафу"
                      >
                        Пропустити справу
                      </button>
                    )}
                    {allResolved && (
                      <button
                        onClick={() => reopenCase(g)}
                        disabled={busy}
                        className="px-2 py-0.5 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                        title="Повернути всі пари справи в список"
                      >
                        Повернути
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-sm mb-2">
                  {g.participants.map(u => {
                    const key = `${u.tgId}|${g.caseId}`;
                    const st = penaltyState[key] || '';
                    const isBusy = st === 'busy';
                    const isDone = st.startsWith('done:');
                    const isErr = st.startsWith('err:');
                    const bst = banState[key] || '';
                    const banBusy = bst === 'busy';
                    const banDone = bst === 'done';
                    const banErr = bst.startsWith('err:');
                    return (
                      <div key={u.tgId} className="border rounded p-2 bg-slate-50 flex flex-col gap-1">
                        <div className="font-medium">{userLabel(u)}</div>
                        <div className="text-xs text-slate-500">{u.submittedAt}</div>
                        <div className="flex items-center flex-wrap gap-2 mt-1">
                          <button
                            disabled={!u.tgId || isBusy || isDone}
                            onClick={() => penalizeUser(g, u.tgId)}
                            className={`px-2 py-1 text-xs rounded font-medium ${
                              isDone
                                ? 'bg-green-100 text-green-700 cursor-default'
                                : 'bg-rose-100 text-rose-700 hover:bg-rose-200 disabled:opacity-50'
                            }`}
                            title="Зняти 100 балів і повідомити користувача"
                          >
                            {isBusy ? 'Надсилаю…' : isDone ? '✓ Знято −100' : `Зняти −${PENALTY_POINTS} балів`}
                          </button>
                          <button
                            disabled={!u.tgId || banBusy || banDone}
                            onClick={() => banParticipant(g, u.tgId)}
                            className={`px-2 py-1 text-xs rounded font-medium ${
                              banDone
                                ? 'bg-slate-300 text-slate-700 cursor-default'
                                : 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50'
                            }`}
                            title="Заблокувати користувача — він не зможе виконати жодну дію"
                          >
                            {banBusy ? 'Блокую…' : banDone ? '✓ Заблоковано' : '🚫 Заблокувати'}
                          </button>
                        </div>
                        {isDone && <span className="text-xs text-green-700">{st.slice(5)}</span>}
                        {isErr && <span className="text-xs text-rose-700">{st.slice(4)}</span>}
                        {banErr && <span className="text-xs text-rose-700">{bst.slice(4)}</span>}
                      </div>
                    );
                  })}
                </div>

                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-left">
                      <th className="p-1.5 border w-48">Поле</th>
                      {g.participants.map(u => (
                        <th key={u.tgId} className="p-1.5 border">
                          {u.displayName || u.tgId}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.questions.map(q => {
                      const ref = pickReference(q.perUser, order);
                      return (
                        <tr key={q.questionIndex} className="align-top">
                          <td className="p-1.5 border font-medium">{q.questionLabel}</td>
                          {g.participants.map(u => {
                            const text = q.perUser[u.tgId] ?? '';
                            const matches = text === ref;
                            if (!text) {
                              return (
                                <td key={u.tgId} className="p-1.5 border whitespace-pre-wrap break-words text-slate-400">
                                  —
                                </td>
                              );
                            }
                            if (matches) {
                              return (
                                <td key={u.tgId} className="p-1.5 border whitespace-pre-wrap break-words bg-emerald-50">
                                  {text}
                                </td>
                              );
                            }
                            const { right } = diffChars(ref, text);
                            return (
                              <td key={u.tgId} className="p-1.5 border whitespace-pre-wrap break-words bg-rose-50">
                                {renderDiffSegs(right)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ==================== PARTNERS VIEW ====================
// CRUD сайтів-партнерів, що встановлюють віджет blukach. API-ключ показується
// один раз при створенні і більше ніколи — далі лише sha256 у БД.
type PartnerTheme = 'light' | 'dark' | 'auto';
type FloaterPosition = 'bottom-right' | 'top-right' | 'middle-right' | 'bottom-left' | 'middle-left' | 'bottom-center';
type ButtonDisplayMode = 'text' | 'image';
interface PartnerCustomization {
  theme?: PartnerTheme;
  buttonColor?: string;
  buttonColorCustom?: string;
  buttonText?: string;
  buttonDisplayMode?: ButtonDisplayMode;
  position?: FloaterPosition;
  verticalOffset?: number;
}
const POSITION_OPTIONS: [FloaterPosition, string][] = [
  ['bottom-right',  'Справа внизу (дефолт)'],
  ['top-right',     'Справа вверху'],
  ['middle-right',  'Справа посередині'],
  ['bottom-left',   'Зліва внизу'],
  ['middle-left',   'Зліва посередині'],
  ['bottom-center', 'По центру внизу'],
];
interface Partner {
  partnerId: string;
  name: string;
  nicknamePrefix: string;
  allowedOrigins: string[];
  active: boolean;
  createdAt: string;
  customization: PartnerCustomization;
}

const BUTTON_COLOR_OPTIONS = [
  { value: 'purple', label: 'Фіолетовий (дефолт)', swatch: '#6b46c1' },
  { value: 'blue',   label: 'Синій',               swatch: '#3182ce' },
  { value: 'green',  label: 'Зелений',             swatch: '#38a169' },
  { value: 'red',    label: 'Червоний',            swatch: '#e53e3e' },
  { value: 'orange', label: 'Помаранчевий',        swatch: '#dd6b20' },
  { value: 'slate',  label: 'Сірий',               swatch: '#4a5568' },
  { value: 'pink',   label: 'Рожевий',             swatch: '#d53f8c' },
  { value: 'teal',   label: 'Бірюзовий',           swatch: '#319795' },
];

// Спільний UI-блок «Кастомізація віджета» — використовується і в Create, і в Edit формах.
const CustomizationFields: React.FC<{
  theme: PartnerTheme;
  setTheme: (v: PartnerTheme) => void;
  buttonColor: string;
  setButtonColor: (v: string) => void;
  buttonColorCustom: string;
  setButtonColorCustom: (v: string) => void;
  buttonText: string;
  setButtonText: (v: string) => void;
  buttonDisplayMode: ButtonDisplayMode;
  setButtonDisplayMode: (v: ButtonDisplayMode) => void;
  position: FloaterPosition;
  setPosition: (v: FloaterPosition) => void;
  verticalOffset: number;
  setVerticalOffset: (v: number) => void;
}> = ({ theme, setTheme, buttonColor, setButtonColor, buttonColorCustom, setButtonColorCustom, buttonText, setButtonText, buttonDisplayMode, setButtonDisplayMode, position, setPosition, verticalOffset, setVerticalOffset }) => (
  <>
    <div>
      <label className="block text-xs font-medium mb-1">Тема</label>
      <div className="flex gap-2">
        {([
          ['light', 'Світла'],
          ['dark', 'Темна'],
          ['auto', 'Адаптивна (за системою)'],
        ] as [PartnerTheme, string][]).map(([t, label]) => (
          <button
            type="button"
            key={t}
            onClick={() => setTheme(t)}
            className={`px-3 py-1 rounded border text-sm ${
              theme === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-1">
        «Адаптивна» — підлаштовується під тему сайту-носія (читає background body, реагує на зміну класів/data-theme). Якщо сайт не задає кольору — використовує системну тему.
      </p>
    </div>
    <div>
      <label className="block text-xs font-medium mb-1">Колір кнопки</label>
      <div className="flex gap-2 flex-wrap">
        {BUTTON_COLOR_OPTIONS.map(opt => (
          <button
            type="button"
            key={opt.value}
            onClick={() => setButtonColor(opt.value)}
            className={`px-2 py-1 rounded border text-xs flex items-center gap-1.5 ${
              buttonColor === opt.value ? 'border-slate-800 ring-2 ring-slate-300' : 'border-slate-300 bg-white'
            }`}
            title={opt.label}
          >
            <span style={{ width: 14, height: 14, background: opt.swatch, borderRadius: 3, display: 'inline-block' }} />
            {opt.label}
          </button>
        ))}
      </div>
    </div>
    <div>
      <label className="block text-xs font-medium mb-1">
        Кастомний колір (hex, перебиває preset вище)
      </label>
      <div className="flex gap-2 items-center">
        <input
          type="color"
          value={buttonColorCustom || '#6b46c1'}
          onChange={e => setButtonColorCustom(e.target.value)}
          className="w-12 h-8 border rounded cursor-pointer"
        />
        <input
          type="text"
          value={buttonColorCustom}
          onChange={e => setButtonColorCustom(e.target.value)}
          placeholder="#RRGGBB або порожньо щоб скинути"
          pattern="^#[0-9a-fA-F]{6}$"
          className="flex-1 px-2 py-1 border rounded text-sm font-mono bg-white"
        />
        {buttonColorCustom && (
          <button
            type="button"
            onClick={() => setButtonColorCustom('')}
            className="px-2 py-1 text-xs border rounded text-slate-600 hover:bg-slate-50"
            title="Очистити (використати preset)"
          >Очистити</button>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1">Формат: #RRGGBB. Поки задано — preset вище ігнорується.</p>
    </div>
    <div>
      <label className="block text-xs font-medium mb-1">Варіант кнопки</label>
      <div className="flex gap-2">
        {([
          ['text', 'Текст + аватар'],
          ['image', 'Тільки логотип'],
        ] as [ButtonDisplayMode, string][]).map(([v, label]) => (
          <button
            type="button"
            key={v}
            onClick={() => setButtonDisplayMode(v)}
            className={`px-3 py-1 rounded border text-sm ${
              buttonDisplayMode === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-1">
        «Тільки логотип» — кругла кнопка-іконка Блукача без тексту (компактніше).
      </p>
    </div>
    <div>
      <label className="block text-xs font-medium mb-1">Текст кнопки (до 60 символів)</label>
      <input
        value={buttonText}
        onChange={e => setButtonText(e.target.value)}
        className="w-full px-2 py-1 border rounded text-sm bg-white"
        placeholder="Описовий Блукач"
        maxLength={60}
        disabled={buttonDisplayMode === 'image'}
      />
      <p className="text-xs text-slate-500 mt-1">
        {buttonDisplayMode === 'image'
          ? 'Не використовується в режимі «Тільки логотип» (буде у tooltip/aria-label).'
          : 'Залиш порожнім, щоб використати дефолт «Описовий Блукач».'}
      </p>
    </div>
    <div>
      <label className="block text-xs font-medium mb-1">Позиція кнопки на сторінці</label>
      <select
        value={position}
        onChange={e => setPosition(e.target.value as FloaterPosition)}
        className="w-full px-2 py-1 border rounded text-sm bg-white"
      >
        {POSITION_OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </div>
    <div>
      <label className="block text-xs font-medium mb-1">
        Зміщення по вертикалі (px, від -500 до +500)
      </label>
      <input
        type="number"
        min={-500}
        max={500}
        step={1}
        value={verticalOffset}
        onChange={e => setVerticalOffset(Math.max(-500, Math.min(500, parseInt(e.target.value, 10) || 0)))}
        className="w-full px-2 py-1 border rounded text-sm bg-white"
      />
      <p className="text-xs text-slate-500 mt-1">
        Для «внизу» — позитивне значення піднімає кнопку вище. Для «вверху» — опускає нижче. Для «посередині» — зсуває по центру.
      </p>
    </div>
  </>
);

// За замовчуванням — останні 30 днів. Дати у форматі YYYY-MM-DD (для input type=date).
function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(fromDate), to: fmt(now) };
}
interface StatsRow { partnerId: string; submissions: number; confirmations: number; }

const PartnersView: React.FC = () => {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [stats, setStats] = useState<Record<string, StatsRow>>({});
  const [busy, setBusy] = useState(false);
  const [statsBusy, setStatsBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newKeyForId, setNewKeyForId] = useState<{ id: string; key: string } | null>(null);
  const [{ from, to }, setRange] = useState(defaultDateRange());

  const load = async () => {
    setBusy(true); setErr('');
    try {
      const r = await tgApi.listPartners();
      setPartners(r.partners || []);
    } catch (e: any) { setErr(e?.message || 'Помилка'); }
    finally { setBusy(false); }
  };
  const loadStats = async () => {
    setStatsBusy(true);
    try {
      // Кінцеву дату беремо як кінець дня (день+1 у 00:00 UTC), щоб включити весь to.
      const fromIso = new Date(from + 'T00:00:00Z').toISOString();
      const toIso = new Date(new Date(to + 'T00:00:00Z').getTime() + 24 * 60 * 60 * 1000).toISOString();
      const r = await tgApi.partnerStats(fromIso, toIso);
      const map: Record<string, StatsRow> = {};
      for (const row of r.stats || []) map[row.partnerId] = row;
      setStats(map);
    } catch (e: any) { setErr(e?.message || 'Помилка стат'); }
    finally { setStatsBusy(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { loadStats(); }, [from, to]);

  const onDelete = async (partnerId: string) => {
    if (!confirm(`Видалити партнера «${partnerId}»? Юзери, створені через нього, лишаться у БД, але без partner_id.`)) return;
    try { await tgApi.deletePartner(partnerId); load(); }
    catch (e: any) { setErr(e?.message || 'Помилка'); }
  };

  const onToggleActive = async (p: Partner) => {
    try { await tgApi.updatePartner(p.partnerId, { active: !p.active }); load(); }
    catch (e: any) { setErr(e?.message || 'Помилка'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold">Партнери</h2>
        <div className="flex gap-2 flex-wrap items-center">
          <label className="text-xs text-slate-600">З:
            <input type="date" value={from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="ml-1 px-2 py-1 border rounded text-sm" />
          </label>
          <label className="text-xs text-slate-600">До:
            <input type="date" value={to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="ml-1 px-2 py-1 border rounded text-sm" />
          </label>
          <button
            onClick={() => setRange(defaultDateRange())}
            className="px-2 py-1 text-xs border rounded text-slate-600 hover:bg-slate-50"
            title="Останні 30 днів"
          >За місяць</button>
          <button onClick={() => { load(); loadStats(); }} className="px-3 py-1 text-sm border rounded hover:bg-slate-50">
            <RefreshCw size={14} className="inline mr-1" /> Оновити
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            <Plus size={14} className="inline mr-1" /> Додати партнера
          </button>
        </div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {newKeyForId && (
        <div className="border-2 border-amber-400 bg-amber-50 rounded p-3 space-y-2">
          <p className="text-sm font-semibold">⚠ API-ключ для «{newKeyForId.id}» — показуємо один раз, скопіюйте зараз:</p>
          <code className="block bg-white p-2 rounded border border-amber-300 break-all text-xs font-mono">
            {newKeyForId.key}
          </code>
          <button
            onClick={() => { navigator.clipboard.writeText(newKeyForId.key); }}
            className="px-2 py-1 text-xs bg-amber-600 text-white rounded"
          >
            Скопіювати
          </button>
          <button
            onClick={() => setNewKeyForId(null)}
            className="px-2 py-1 text-xs border border-amber-600 text-amber-700 rounded ml-2"
          >
            Я зберіг(ла) — приховати
          </button>
        </div>
      )}

      {showCreate && (
        <CreatePartnerForm
          onCreated={(p, key) => { setShowCreate(false); setNewKeyForId({ id: p.partnerId, key }); load(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {busy ? <p className="text-sm text-slate-500">Завантажую…</p> : (
        <table className="w-full text-sm">
          <thead className="text-left bg-slate-50 border-y">
            <tr>
              <th className="px-2 py-1">ID</th>
              <th className="px-2 py-1">Назва</th>
              <th className="px-2 py-1">Префікс</th>
              <th className="px-2 py-1">Origins</th>
              <th className="px-2 py-1" title="Сума submissions (parallel) + case_confirmations (collab) за обраний період">
                Справ у періоді
              </th>
              <th className="px-2 py-1">Статус</th>
              <th className="px-2 py-1">Створено</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {partners.length === 0 && (
              <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-500">Партнерів ще немає</td></tr>
            )}
            {partners.map(p => (
              <React.Fragment key={p.partnerId}>
                <tr className="border-b">
                  <td className="px-2 py-2 font-mono text-xs">{p.partnerId}</td>
                  <td className="px-2 py-2">{p.name}</td>
                  <td className="px-2 py-2">{p.nicknamePrefix}</td>
                  <td className="px-2 py-2 text-xs">
                    {p.allowedOrigins.map(o => <div key={o}>{o}</div>)}
                  </td>
                  <td className="px-2 py-2 text-sm font-mono">
                    {statsBusy ? (
                      <span className="text-slate-400">…</span>
                    ) : stats[p.partnerId] ? (
                      <span title={`розпізнавання: ${stats[p.partnerId].submissions}, collab-події: ${stats[p.partnerId].confirmations}`}>
                        {stats[p.partnerId].submissions + stats[p.partnerId].confirmations}
                      </span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => onToggleActive(p)}
                      className={`px-2 py-0.5 text-xs rounded ${p.active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}
                    >
                      {p.active ? 'active' : 'inactive'}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500">{p.createdAt?.slice(0, 10)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <button
                      onClick={() => setEditingId(editingId === p.partnerId ? null : p.partnerId)}
                      className="text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded text-xs"
                    >
                      {editingId === p.partnerId ? 'Закрити' : 'Редагувати'}
                    </button>
                    <button onClick={() => onDelete(p.partnerId)} className="text-red-600 hover:bg-red-50 p-1 rounded ml-1">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
                {editingId === p.partnerId && (
                  <tr className="bg-slate-50 border-b">
                    <td colSpan={8} className="px-4 py-4">
                      <EditPartnerForm
                        partner={p}
                        onSaved={() => { setEditingId(null); load(); }}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const CreatePartnerForm: React.FC<{
  onCreated: (p: Partner, apiKey: string) => void;
  onCancel: () => void;
}> = ({ onCreated, onCancel }) => {
  const [partnerId, setPartnerId] = useState('');
  const [name, setName] = useState('');
  const [nicknamePrefix, setNicknamePrefix] = useState('');
  const [origins, setOrigins] = useState('');
  const [theme, setTheme] = useState<PartnerTheme>('light');
  const [buttonColor, setButtonColor] = useState('purple');
  const [buttonColorCustom, setButtonColorCustom] = useState('');
  const [buttonText, setButtonText] = useState('');
  const [buttonDisplayMode, setButtonDisplayMode] = useState<ButtonDisplayMode>('text');
  const [position, setPosition] = useState<FloaterPosition>('bottom-right');
  const [verticalOffset, setVerticalOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await tgApi.createPartner({
        partnerId: partnerId.trim(),
        name: name.trim(),
        nicknamePrefix: nicknamePrefix.trim(),
        allowedOrigins: origins.split('\n').map(s => s.trim()).filter(Boolean),
        customization: {
          theme,
          buttonColor,
          buttonColorCustom: buttonColorCustom.trim() || undefined,
          buttonText: buttonText.trim() || undefined,
          buttonDisplayMode,
          position,
          verticalOffset,
        },
      });
      onCreated(r.partner, r.apiKey);
    } catch (e: any) {
      setErr(e?.message || 'Помилка');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSubmit} className="border rounded p-4 bg-slate-50 space-y-3">
      <h3 className="font-semibold">Новий партнер</h3>
      <div>
        <label className="block text-xs font-medium mb-1">ID (slug, латинські букви/цифри/дефіси)</label>
        <input
          value={partnerId}
          onChange={e => setPartnerId(e.target.value)}
          className="w-full px-2 py-1 border rounded text-sm"
          placeholder="archium"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">Назва (для адмінки)</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-2 py-1 border rounded text-sm"
          placeholder="Архіум"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">
          Префікс анонімного nickname (буде «{nicknamePrefix || 'Префікс'}-XXXX»)
        </label>
        <input
          value={nicknamePrefix}
          onChange={e => setNicknamePrefix(e.target.value)}
          className="w-full px-2 py-1 border rounded text-sm"
          placeholder="Архіум"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">Allowed origins (по одному на рядок, точний рядок)</label>
        <textarea
          value={origins}
          onChange={e => setOrigins(e.target.value)}
          className="w-full px-2 py-1 border rounded text-sm font-mono text-xs"
          rows={3}
          placeholder="https://archium.org&#10;https://www.archium.org"
        />
      </div>
      <hr className="border-slate-200" />
      <h4 className="text-sm font-semibold">Кастомізація віджета</h4>
      <CustomizationFields
        theme={theme}
        setTheme={setTheme}
        buttonColor={buttonColor}
        setButtonColor={setButtonColor}
        buttonColorCustom={buttonColorCustom}
        setButtonColorCustom={setButtonColorCustom}
        buttonText={buttonText}
        setButtonText={setButtonText}
        buttonDisplayMode={buttonDisplayMode}
        setButtonDisplayMode={setButtonDisplayMode}
        position={position}
        setPosition={setPosition}
        verticalOffset={verticalOffset}
        setVerticalOffset={setVerticalOffset}
      />
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="px-3 py-1 bg-indigo-600 text-white rounded text-sm disabled:opacity-50">
          {busy ? 'Створюю…' : 'Створити'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1 border rounded text-sm">
          Скасувати
        </button>
      </div>
    </form>
  );
};

// Редагування існуючого партнера. partnerId не міняємо — це PK.
const EditPartnerForm: React.FC<{
  partner: Partner;
  onSaved: () => void;
  onCancel: () => void;
}> = ({ partner, onSaved, onCancel }) => {
  const [name, setName] = useState(partner.name);
  const [nicknamePrefix, setNicknamePrefix] = useState(partner.nicknamePrefix);
  const [origins, setOrigins] = useState(partner.allowedOrigins.join('\n'));
  const [theme, setTheme] = useState<PartnerTheme>((partner.customization?.theme as PartnerTheme) || 'light');
  const [buttonColor, setButtonColor] = useState(partner.customization?.buttonColor || 'purple');
  const [buttonColorCustom, setButtonColorCustom] = useState(partner.customization?.buttonColorCustom || '');
  const [buttonText, setButtonText] = useState(partner.customization?.buttonText || '');
  const [buttonDisplayMode, setButtonDisplayMode] = useState<ButtonDisplayMode>((partner.customization?.buttonDisplayMode as ButtonDisplayMode) || 'text');
  const [position, setPosition] = useState<FloaterPosition>((partner.customization?.position as FloaterPosition) || 'bottom-right');
  const [verticalOffset, setVerticalOffset] = useState(partner.customization?.verticalOffset || 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await tgApi.updatePartner(partner.partnerId, {
        name: name.trim(),
        nicknamePrefix: nicknamePrefix.trim(),
        allowedOrigins: origins.split('\n').map(s => s.trim()).filter(Boolean),
        customization: {
          theme,
          buttonColor,
          buttonColorCustom: buttonColorCustom.trim() || undefined,
          buttonText: buttonText.trim() || undefined,
          buttonDisplayMode,
          position,
          verticalOffset,
        },
      });
      onSaved();
    } catch (e: any) {
      setErr(e?.message || 'Помилка');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h3 className="font-semibold text-sm">Редагування «{partner.partnerId}»</h3>
      <div className="text-xs text-slate-500">ID партнера не редагується. Щоб змінити — створіть нового і видаліть цей.</div>
      <div>
        <label className="block text-xs font-medium mb-1">Назва</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-2 py-1 border rounded text-sm bg-white"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">
          Префікс анонімного nickname (буде «{nicknamePrefix || 'Префікс'}-XXXX»)
        </label>
        <input
          value={nicknamePrefix}
          onChange={e => setNicknamePrefix(e.target.value)}
          className="w-full px-2 py-1 border rounded text-sm bg-white"
          required
        />
        <p className="text-xs text-slate-500 mt-1">
          Зміна вплине тільки на нових юзерів. Існуючі нікнейми залишаться як були.
        </p>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">Allowed origins (по одному на рядок, точний рядок)</label>
        <textarea
          value={origins}
          onChange={e => setOrigins(e.target.value)}
          className="w-full px-2 py-1 border rounded text-sm font-mono text-xs bg-white"
          rows={4}
          placeholder="https://archium.org&#10;https://www.archium.org"
        />
        <p className="text-xs text-slate-500 mt-1">
          Без trailing slash. Кожна піддомен/протокол — окремий рядок.
        </p>
      </div>
      <hr className="border-slate-200" />
      <h4 className="text-sm font-semibold">Кастомізація віджета</h4>
      <CustomizationFields
        theme={theme}
        setTheme={setTheme}
        buttonColor={buttonColor}
        setButtonColor={setButtonColor}
        buttonColorCustom={buttonColorCustom}
        setButtonColorCustom={setButtonColorCustom}
        buttonText={buttonText}
        setButtonText={setButtonText}
        buttonDisplayMode={buttonDisplayMode}
        setButtonDisplayMode={setButtonDisplayMode}
        position={position}
        setPosition={setPosition}
        verticalOffset={verticalOffset}
        setVerticalOffset={setVerticalOffset}
      />
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="px-3 py-1 bg-indigo-600 text-white rounded text-sm disabled:opacity-50">
          {busy ? 'Зберігаю…' : 'Зберегти'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1 border rounded text-sm">
          Скасувати
        </button>
      </div>
    </form>
  );
};

// ==================== PUZZLE VIEW (Описовий пазл) ====================

function puzzleTodayKyiv(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const PuzzleDayView: React.FC<{ date: string; setDate: (d: string) => void }> = ({ date, setDate }) => {
  const [sentence, setSentence] = useState('');
  const [savedSentence, setSavedSentence] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avail, setAvail] = useState<{
    titleConfigured: boolean;
    words: Array<{ word: string; count: number }>;
  } | null>(null);
  const [progress, setProgress] = useState<{
    total: number;
    words: string[];
    givenWords: string[];
    participants: Array<{
      tgId: string;
      displayName: string;
      collected: number;
      confirmed: number;
      place: number | null;
      words: Record<string, 'confirmed' | 'unconfirmed'>;
    }>;
    winners: Array<{ place: number; tgId: string; points: number; displayName: string }>;
  } | null>(null);

  const load = async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const [p, prog] = await Promise.all([tgApi.getPuzzle(d), tgApi.puzzleProgress(d)]);
      setSentence(p.sentence || '');
      setSavedSentence(p.sentence || '');
      setProgress(prog);
    } catch (e: any) {
      setError(e.message || 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Дебаунс індикатора наявності слів.
  useEffect(() => {
    const s = sentence.trim();
    if (!s) {
      setAvail(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setAvail(await tgApi.puzzleWordAvailability(s));
      } catch {
        /* мовчки — індикатор не критичний */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [sentence]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await tgApi.savePuzzle(date, sentence);
      await load(date);
    } catch (e: any) {
      setError(e.message || 'Помилка збереження');
    } finally {
      setSaving(false);
    }
  };

  const dirty = sentence !== savedSentence;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h3 className="font-bold text-lg mb-1">🧩 Описовий пазл</h3>
        <p className="text-sm text-slate-600">
          Задайте «фразу дня». Гравці збирають її слова, розпізнаючи справи. Збирати й
          підтверджувати всі слова потрібно протягом одного дня.
        </p>
      </div>

      {/* Фраза дня (збережена) */}
      <div className="rounded border bg-slate-50 p-3">
        <div className="text-xs uppercase text-slate-500 mb-1">Фраза дня ({date})</div>
        <div className="text-base">
          {savedSentence ? (
            <span>«{savedSentence}»</span>
          ) : (
            <span className="text-slate-400">не задано</span>
          )}
        </div>
      </div>

      {/* Редактор */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">Дата (Київ):</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <textarea
          value={sentence}
          onChange={e => setSentence(e.target.value)}
          rows={3}
          placeholder="Введіть речення дня…"
          className="w-full border rounded px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-3 py-1 bg-indigo-600 text-white rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Зберігаю…' : 'Зберегти фразу'}
          </button>
          <button
            onClick={() => load(date)}
            disabled={loading}
            className="px-3 py-1 border rounded text-sm disabled:opacity-50"
          >
            {loading ? 'Оновлюю…' : 'Оновити'}
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Індикатор наявності слів */}
      {avail && (
        <div className="rounded border p-3 space-y-2">
          <div className="text-sm font-medium">Які слова цієї фрази збираються?</div>
          {!avail.titleConfigured && (
            <div className="text-xs text-amber-700">
              ⚠ Поле «Заголовок справи» (роль title) не налаштоване у вкладці «Питання» — індикатор
              не працюватиме.
            </div>
          )}
          {avail.words.length === 0 ? (
            <span className="text-xs text-slate-400">
              немає слів для збору (усе — стоп-слова)
            </span>
          ) : (
            (() => {
              const yes = avail.words.filter(w => w.count > 0);
              const no = avail.words.filter(w => w.count === 0);
              return (
                <>
                  <div>
                    <div className="text-xs text-emerald-700 mb-1">
                      ✅ Збираються ({yes.length}) — трапляються в розпізнаних заголовках:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {yes.length === 0 ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        yes.map(w => (
                          <span
                            key={w.word}
                            className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800"
                            title={`Трапляється у ${w.count} заголовках`}
                          >
                            {w.word} · {w.count}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-rose-700 mb-1">
                      🚫 Не збираються ({no.length}) — немає в базі, будуть видані гравцям автоматично:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {no.length === 0 ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        no.map(w => (
                          <span
                            key={w.word}
                            className="text-xs px-2 py-0.5 rounded bg-rose-100 text-rose-800"
                          >
                            {w.word}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </>
              );
            })()
          )}
          <div className="text-xs text-slate-500">
            Орієнтир за вже розпізнаними колаб-заголовками (не гарантія на сьогодні). «Не збираються»
            видаються гравцям як уже зараховані.
          </div>
        </div>
      )}

      {/* Учасники дня */}
      <div className="space-y-2">
        <div className="text-sm font-medium">
          Учасники {progress ? `(слів у фразі: ${progress.total})` : ''}
        </div>
        {!progress || progress.participants.length === 0 ? (
          <div className="text-sm text-slate-400">Поки що ніхто не збирає цю фразу.</div>
        ) : (
          <>
            <div className="text-xs text-slate-500 mb-1">
              Слова:{' '}
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">підтверджене</span>{' '}
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">зібране</span>{' '}
              <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">видане</span>{' '}
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">не зібране</span>
            </div>
            <table className="w-full text-sm border">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-2 py-1 border-b">#</th>
                  <th className="px-2 py-1 border-b">Нік</th>
                  <th className="px-2 py-1 border-b">Підтв.</th>
                  <th className="px-2 py-1 border-b">Зібр.</th>
                  <th className="px-2 py-1 border-b">Місце</th>
                  <th className="px-2 py-1 border-b">Слова фрази</th>
                </tr>
              </thead>
              <tbody>
                {progress.participants.map((p, i) => (
                  <tr key={p.tgId} className={p.place ? 'bg-amber-50' : ''}>
                    <td className="px-2 py-1 border-b text-slate-400">{i + 1}</td>
                    <td className="px-2 py-1 border-b whitespace-nowrap">{p.displayName || p.tgId}</td>
                    <td className="px-2 py-1 border-b">
                      {p.confirmed}/{progress.total}
                    </td>
                    <td className="px-2 py-1 border-b">
                      {p.collected}/{progress.total}
                    </td>
                    <td className="px-2 py-1 border-b">{p.place ? `🏅 ${p.place}` : '—'}</td>
                    <td className="px-2 py-1 border-b">
                      <div className="flex flex-wrap gap-1">
                        {progress.words.map(w => {
                          const given = progress.givenWords.includes(w);
                          const st = p.words[w];
                          const cls = given
                            ? 'bg-violet-100 text-violet-800 italic'
                            : st === 'confirmed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : st === 'unconfirmed'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-400';
                          return (
                            <span key={w} className={`text-xs px-1.5 py-0.5 rounded ${cls}`}>
                              {w}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
};

// ---- Масове заповнення фраз на дні вперед ----
const PuzzleBulkView: React.FC = () => {
  const [text, setText] = useState('');
  const [startDate, setStartDate] = useState(puzzleTodayKyiv());
  const [preview, setPreview] = useState<Array<{ date: string; sentence: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const phrases = () => text.split('\n').map(s => s.trim()).filter(Boolean);

  const doPreview = async () => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const r = await tgApi.bulkPuzzles(phrases(), startDate, true);
      setPreview(r.assignments);
    } catch (e: any) {
      setError(e.message || 'Помилка');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await tgApi.bulkPuzzles(phrases(), startDate, false);
      setPreview(r.assignments);
      setDone(`Збережено фраз: ${r.assignments.length}.`);
    } catch (e: any) {
      setError(e.message || 'Помилка');
    } finally {
      setBusy(false);
    }
  };

  const count = phrases().length;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="font-bold text-lg mb-1">Масове заповнення</h3>
        <p className="text-sm text-slate-600">
          По одній фразі в рядку. Кожна потрапляє на найближчий <b>порожній</b> день, починаючи з
          вказаної дати; уже задані дні не перезаписуються.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600">Починати з (Київ):</label>
        <input
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        />
        <span className="text-xs text-slate-400">фраз у списку: {count}</span>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={8}
        placeholder={'Фраза першого дня\nФраза другого дня\n…'}
        className="w-full border rounded px-3 py-2 text-sm font-mono"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={doPreview}
          disabled={busy || count === 0}
          className="px-3 py-1 border rounded text-sm disabled:opacity-50"
        >
          {busy ? 'Рахую…' : 'Прев’ю'}
        </button>
        <button
          onClick={apply}
          disabled={busy || count === 0}
          className="px-3 py-1 bg-indigo-600 text-white rounded text-sm disabled:opacity-50"
        >
          {busy ? 'Зберігаю…' : 'Зберегти'}
        </button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {done && <div className="text-sm text-emerald-700">{done}</div>}
      {preview && preview.length > 0 && (
        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="px-2 py-1 border-b">Дата</th>
              <th className="px-2 py-1 border-b">Фраза</th>
            </tr>
          </thead>
          <tbody>
            {preview.map(a => (
              <tr key={a.date}>
                <td className="px-2 py-1 border-b whitespace-nowrap">{a.date}</td>
                <td className="px-2 py-1 border-b">{a.sentence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ---- Список усіх фраз (минулі/сьогодні/майбутні) ----
const PuzzleListView: React.FC<{ onEdit: (d: string) => void }> = ({ onEdit }) => {
  const [puzzles, setPuzzles] = useState<Array<{ date: string; sentence: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const today = puzzleTodayKyiv();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await tgApi.listPuzzles();
      setPuzzles(r.puzzles);
    } catch (e: any) {
      setError(e.message || 'Помилка');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const marker = (d: string) =>
    d < today ? <span className="text-slate-400">минуле</span>
      : d === today ? <span className="text-emerald-700 font-medium">сьогодні</span>
      : <span className="text-indigo-700">майбутнє</span>;

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg">Усі фрази</h3>
        <button onClick={load} disabled={loading} className="px-3 py-1 border rounded text-sm disabled:opacity-50">
          {loading ? 'Оновлюю…' : 'Оновити'}
        </button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!puzzles || puzzles.length === 0 ? (
        <div className="text-sm text-slate-400">Фраз ще немає.</div>
      ) : (
        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="px-2 py-1 border-b whitespace-nowrap">Дата</th>
              <th className="px-2 py-1 border-b">Коли</th>
              <th className="px-2 py-1 border-b">Фраза</th>
              <th className="px-2 py-1 border-b"></th>
            </tr>
          </thead>
          <tbody>
            {puzzles.map(p => (
              <tr key={p.date} className={p.date === today ? 'bg-emerald-50' : ''}>
                <td className="px-2 py-1 border-b whitespace-nowrap">{p.date}</td>
                <td className="px-2 py-1 border-b whitespace-nowrap">{marker(p.date)}</td>
                <td className="px-2 py-1 border-b">{p.sentence || <span className="text-slate-300">—</span>}</td>
                <td className="px-2 py-1 border-b">
                  <button onClick={() => onEdit(p.date)} className="text-indigo-600 hover:underline">
                    Редагувати
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// Обгортка з підвкладками День / Масово / Список.
const PuzzleView: React.FC = () => {
  const [sub, setSub] = useState<'day' | 'bulk' | 'list'>('day');
  const [date, setDate] = useState<string>(puzzleTodayKyiv());
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b pb-2">
        {([
          ['day', 'День'],
          ['bulk', 'Масово'],
          ['list', 'Список'],
        ] as Array<['day' | 'bulk' | 'list', string]>).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className={`px-3 py-1 text-sm rounded ${
              sub === k ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {sub === 'day' && <PuzzleDayView date={date} setDate={setDate} />}
      {sub === 'bulk' && <PuzzleBulkView />}
      {sub === 'list' && (
        <PuzzleListView
          onEdit={d => {
            setDate(d);
            setSub('day');
          }}
        />
      )}
    </div>
  );
};
