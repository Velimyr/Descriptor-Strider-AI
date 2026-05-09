import React, { useEffect, useRef, useState } from 'react';
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

type TabKey = 'setup' | 'questions' | 'cases' | 'results' | 'process' | 'overview';

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
          ['process', 'Опрацювати опис'],
          ['overview', 'Огляд'],
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

  const refresh = async () => {
    try {
      setBusy(true);
      const [h, db] = await Promise.all([
        tgApi.health(),
        tgApi.checkDb().catch(e => ({ ok: false, error: e.message })),
      ]);
      setHealth(h);
      setDbCheck(db);
    } catch {
      setHealth(null);
    } finally {
      setBusy(false);
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
};

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

const SESSION_VERSION = 1;
interface SessionFile {
  version: number;
  savedAt: string;
  pdfName: string;
  pdfBase64: string; // вміст PDF
  pageBoxes: Record<number, Box[]>;
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
  // Діапазон сторінок для авто-розпізнавання. Порожньо → поточна сторінка.
  const [autoRange, setAutoRange] = useState('');
  const [autoProgress, setAutoProgress] = useState<{ done: number; total: number; page?: number } | null>(null);
  const [skipExisting, setSkipExisting] = useState(true);
  const importInputRef = useRef<HTMLInputElement>(null);
  // Кеш бінарного PDF для повторного відкриття після імпорту і експорту.
  const [pdfBase64, setPdfBase64] = useState<string>('');
  // Виділені зони (id) — для обʼєднання у крос-сторінкові групи.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
        anchorX: number; // фіксована протилежна точка
        anchorY: number;
      };
  const actionRef = useRef<CanvasAction | null>(null);

  const metaValid = !!(archive.trim() && fund.trim() && opys.trim());
  const boxes: Box[] = pageBoxes[page] || [];
  const totalBoxes = (Object.values(pageBoxes) as Box[][]).reduce((s, b) => s + b.length, 0);
  const pagesWithBoxes = (Object.entries(pageBoxes) as [string, Box[]][])
    .filter(([, v]) => v.length > 0)
    .map(([k]) => parseInt(k, 10))
    .sort((a, b) => a - b);

  const setBoxesForPage = (p: number, fn: (prev: Box[]) => Box[]) => {
    setPageBoxes(prev => ({ ...prev, [p]: fn(prev[p] || []) }));
  };

  const loadPdf = async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      setMsg('❌ Це не PDF-файл.');
      return;
    }
    setMsg('');
    setUploadDone(null);
    setPageBoxes({});
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
      boxes.forEach((b, idx) => {
        const x = b.x * canvas.width;
        const y = b.y * canvas.height;
        const w = b.w * canvas.width;
        const h = b.h * canvas.height;
        // Якщо зона у крос-сторінковій групі — її колір унікальний за groupId.
        const inGroup = (groups.get(b.groupId)?.length || 0) > 1;
        const color = inGroup ? colorFromId(b.groupId) : 'rgba(99,102,241,0.95)';
        const isSelected = selectedIds.has(b.id);
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
      });
    };
    img.src = pageImage;
    // selectedIds + groups впливають на стиль рендеру
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageImage, boxes, selectedIds, pageBoxes]);

  // Координати в нормалізованій системі (0..1).
  const normFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  // Перевірка попадання в "хрестик видалити".
  const hitCloseHandle = (point: { x: number; y: number }, b: Box): boolean => {
    if (!canvasRef.current) return false;
    const W = canvasRef.current.width;
    const H = canvasRef.current.height;
    const cxPx = (b.x + b.w) * W - 14;
    const cyPx = b.y * H + 14;
    const px = point.x * W;
    const py = point.y * H;
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
    const px = point.x * W;
    const py = point.y * H;
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

  const pointInsideBox = (point: { x: number; y: number }, b: Box): boolean =>
    point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h;

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
    const p = normFromEvent(e);
    // 1) Хрестик «видалити» — пріоритет.
    const idx = boxes.findIndex(b => hitCloseHandle(p, b));
    if (idx >= 0) {
      removeBox(idx);
      actionRef.current = null;
      return;
    }
    // 2) Resize-маркер.
    for (const b of boxes) {
      const handle = hitResizeHandle(p, b);
      if (handle) {
        const a = anchorOf(b, handle);
        actionRef.current = {
          type: 'resize',
          boxId: b.id,
          handle,
          anchorX: a.x,
          anchorY: a.y,
        };
        return;
      }
    }
    // 3) Інакше — нова зона (drag).
    actionRef.current = { type: 'draw', startX: p.x, startY: p.y };
  };

  const onCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const a = actionRef.current;
    if (!a || a.type !== 'resize') return;
    const p = normFromEvent(e);
    setBoxesForPage(page, prev =>
      prev.map(b => {
        if (b.id !== a.boxId) return b;
        // Залежно від типу маркера — змінюємо лише потрібні осі. По осі, яку
        // не рухаємо, беремо поточні значення (anchor + сторона).
        let newX = b.x, newY = b.y, newW = b.w, newH = b.h;
        const movesX = a.handle.includes('e') || a.handle.includes('w');
        const movesY = a.handle.includes('n') || a.handle.includes('s');
        if (movesX) {
          newX = Math.min(a.anchorX, p.x);
          newW = Math.abs(a.anchorX - p.x);
        }
        if (movesY) {
          newY = Math.min(a.anchorY, p.y);
          newH = Math.abs(a.anchorY - p.y);
        }
        // Не даємо колапс у нуль.
        if (newW < 0.005) newW = 0.005;
        if (newH < 0.005) newH = 0.005;
        return { ...b, x: newX, y: newY, w: newW, h: newH };
      })
    );
  };

  const onCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const a = actionRef.current;
    actionRef.current = null;
    if (!a) return;
    if (a.type === 'resize') return; // готово, оновлення вже сталось у move.
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
      arr.sort((a, b) => a.page - b.page || a.box.y - b.box.y);
    }
    return map;
  })();

  // Групи з > 1 зон — те, що цікаво показати у панелі.
  const multiBoxGroups = [...groups.entries()].filter(([, items]) => items.length > 1);

  const mergeSelected = () => {
    if (selectedIds.size < 2) return;
    // Як спільний groupId беремо groupId першої виділеної зони.
    const firstId = [...selectedIds][0];
    let target = '';
    for (const arr of Object.values(pageBoxes) as Box[][]) {
      const found = arr.find(b => b.id === firstId);
      if (found) {
        target = found.groupId;
        break;
      }
    }
    if (!target) return;
    setPageBoxes(prev => {
      const next: Record<number, Box[]> = {};
      for (const [k, list] of Object.entries(prev) as [string, Box[]][]) {
        next[+k] = list.map(b => (selectedIds.has(b.id) ? { ...b, groupId: target } : b));
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
    const data: SessionFile = {
      version: SESSION_VERSION,
      savedAt: new Date().toISOString(),
      pdfName,
      pdfBase64,
      pageBoxes,
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
    setMsg(`✅ Сесія експортована (${totalBoxes} зон на ${pagesWithBoxes.length} стор.)`);
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
      if (data.meta) {
        if (data.meta.archive) setArchive(data.meta.archive);
        if (data.meta.fund) setFund(data.meta.fund);
        if (data.meta.opys) setOpys(data.meta.opys);
      }
      setPage(1);
      await renderPage(doc, 1);
      const totalRestored = Object.values(restored).reduce((s, b) => s + b.length, 0);
      setMsg(
        `✅ Сесія імпортована: ${totalRestored} зон на ${
          Object.keys(restored).filter(k => restored[+k].length > 0).length
        } стор.`
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
    <div className="space-y-4">
      {/* Архівні реквізити — обовʼязкові, спільні для всієї пачки */}
      <section className={`border rounded p-3 ${metaValid ? 'bg-slate-50' : 'bg-amber-50 border-amber-300'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Архівні реквізити (обовʼязкові)</div>
          {!metaValid && (
            <div className="text-xs text-amber-700">⚠ Заповніть усі 3 поля перед завантаженням</div>
          )}
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
      </section>

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
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            Малюйте прямокутники мишкою навколо кожної справи. Натисніть <span className="text-red-600 font-medium">червоний хрестик</span> у куті зони — видалити її.
            {' '}Зони зберігаються при перемиканні сторінок.
          </p>
          <div className="border rounded bg-slate-50 max-h-[70vh] overflow-auto">
            <canvas
              ref={canvasRef}
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={() => { actionRef.current = null; }}
              className="cursor-crosshair block mx-auto"
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          </div>
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
  const [filter, setFilter] = useState('');
  const [descFilter, setDescFilter] = useState(''); // 'archive|fund|opys' або '' для всіх

  const refresh = async () => {
    setBusy(true);
    setMsg('');
    try {
      const [r, ov] = await Promise.all([tgApi.results(limit), tgApi.overview()]);
      setData({ questions: r.questions || [], submissions: r.submissions || [] });
      setAllDescriptions(
        (ov.descriptions || []).map((d: any) => ({ key: d.key, name: d.name }))
      );
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

  const descKeyOf = (s: any) => `${s.archive || ''}|${s.fund || ''}|${s.opys || ''}`;
  const descNameOf = (s: any) => `${s.archive || ''} ${s.fund || ''}-${s.opys || ''}`;

  const buildHeaders = (questions: any[]) => [
    'submitted_at',
    'display_name',
    'tg_id',
    'Опис',
    'Файл',
    'Сторінка',
    ...questions.map((q: any, i: number) => q.label || `Q${i + 1}`),
    'case_id',
    'source_link',
  ];

  const buildRow = (s: any, questions: any[]) => {
    const answers = Array.isArray(s.answers) ? s.answers : [];
    return [
      s.submitted_at || '',
      s.display_name || '',
      s.tg_id || '',
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

  const exportCsv = () => downloadCsv(filtered, '');

  // Експорт усіх записів вибраного опису (без обмеження поточним текстовим фільтром).
  const exportSelectedDescription = () => {
    if (!data || !descFilter) return;
    const rows = data.submissions.filter(s => descKeyOf(s) === descFilter);
    downloadCsv(rows, selectedDescriptionName);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={refresh}
          disabled={busy}
          className="px-3 py-1.5 bg-slate-200 rounded text-sm flex items-center gap-1"
        >
          <RefreshCw size={14} /> {busy ? 'Завантаження…' : 'Оновити'}
        </button>
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
          value={descFilter}
          onChange={e => setDescFilter(e.target.value)}
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
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Фільтр (текст у будь-якій колонці)"
          className="border rounded px-2 py-1 text-sm flex-1 min-w-[200px]"
        />
        <button
          onClick={exportCsv}
          disabled={!data || filtered.length === 0}
          className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm disabled:opacity-50"
        >
          Експорт CSV ({filtered.length})
        </button>
        <button
          onClick={exportSelectedDescription}
          disabled={!data || !descFilter}
          title={descFilter ? `Експортувати всі записи опису "${selectedDescriptionName}"` : 'Спочатку оберіть опис'}
          className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm disabled:opacity-50"
        >
          Експорт опису
        </button>
      </div>

      {msg && <div className="text-sm">{msg}</div>}

      {data && (
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

const OverviewView: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

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
              {Array.isArray(data.descriptions) && data.descriptions.length > 0 && (
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
                    {data.descriptions.map((d: any) => (
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
            </div>
          </section>
          <section>
            <h3 className="font-semibold mb-2">Користувачі (за балами)</h3>
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
                {data.users.map((u: any, i: number) => (
                  <tr key={u.tgId} className="border-b">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2">{u.displayName || '—'}</td>
                    <td className="p-2 font-mono text-xs">{u.tgId}</td>
                    <td className="p-2 text-right">{u.totalPoints}</td>
                    <td className="p-2">{u.status}</td>
                    <td className="p-2 text-right">{u.consecutiveMisses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
};

// ==================== PROCESS DESCRIPTION ====================

type ProcessStep = 'select' | 'step1' | 'step2';
type GroupColor = 'green-full' | 'green-light' | 'yellow' | 'red' | 'purple';

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
  const [descriptions, setDescriptions] = useState<{ key: string; name: string }[]>([]);
  const [descKey, setDescKey] = useState('');
  const [numberColIdx, setNumberColIdx] = useState<number>(0);
  const [groups, setGroups] = useState<ProcessGroup[]>([]);
  const [step2Rows, setStep2Rows] = useState<Step2Row[]>([]);
  const [loadedCount, setLoadedCount] = useState<number>(0);
  const [llmBusy, setLlmBusy] = useState<Set<number>>(new Set());

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
          .map(d => ({ key: d.key, name: d.name }))
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
      } else if (totalFields > 0 && diffFields === totalFields) {
        color = 'red';
      } else {
        color = 'yellow';
      }

      // ----- Діагностика -----
      const reasonByColor: Record<GroupColor, string> = {
        'green-full': 'усі записи мають ідентичні підписи (allSame=true)',
        'green-light': `є кластер дублікатів (≥2 записи з ідентичним підписом); розміри кластерів: [${sizes.join(', ')}]`,
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
    const rows: Step2Row[] = selected.map((s, idx) => {
      const ans = Array.isArray(s.answers) ? [...s.answers] : [];
      while (ans.length < questions.length) ans.push('');
      return { id: `r${idx}`, isEmpty: false, answers: ans.map(a => String(a ?? '')) };
    });
    if (bases.size > 0) {
      const min = Math.min(...bases);
      const max = Math.max(...bases);
      for (let n = min; n <= max; n++) {
        if (!bases.has(n)) {
          const ans = Array(questions.length).fill('');
          if (numberColIdx >= 0) ans[numberColIdx] = String(n);
          rows.push({ id: `e${n}`, isEmpty: true, answers: ans });
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

  const exportCsv = () => {
    if (questions.length === 0) return;
    const headers = questions.map((q: any, i: number) => q.label || `Q${i + 1}`);
    // Сортуємо ще раз — користувач міг змінити номери в Кроці 2.
    const sorted = [...step2Rows].sort((a, b) =>
      compareNumberInfo(
        parseNumberCell(a.answers[numberColIdx] || ''),
        parseNumberCell(b.answers[numberColIdx] || '')
      )
    );
    const rows = sorted.map(r => headers.map((_, i) => r.answers[i] ?? ''));
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
      case 'green-light': return 'bg-emerald-50';
      case 'yellow': return 'bg-amber-50';
      case 'red': return 'bg-rose-50';
      case 'purple': return 'bg-violet-100';
    }
  };

  const colorBadge = (c: GroupColor) => {
    switch (c) {
      case 'green-full': return 'bg-emerald-600';
      case 'green-light': return 'bg-emerald-400';
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
                  {d.name}
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
          </div>
          <div className="text-xs text-slate-500 flex flex-wrap gap-3">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-600" /> усі записи ідентичні</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-400" /> є дублікати — обрано з більшого кластера</span>
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
              className="px-4 py-1.5 bg-emerald-600 text-white rounded text-sm"
            >
              Експорт CSV
            </button>
            <div className="text-sm text-slate-500">
              Рядків: {step2Rows.length} (порожніх: {step2Rows.filter(r => r.isEmpty).length})
            </div>
          </div>
          <div className="text-xs text-slate-500">
            Жовтим виділено рядки, додані для відсутніх номерів. Усі поля редаговані.
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
                </tr>
              </thead>
              <tbody>
                {step2Rows.map((r, ri) => (
                  <tr key={r.id} className={`${r.isEmpty ? 'bg-amber-50' : ''} border-b`}>
                    {questions.map((_: any, qi: number) => (
                      <td key={qi} className="p-1 align-top">
                        <textarea
                          value={r.answers[qi] ?? ''}
                          onChange={e => updateCell(ri, qi, e.target.value)}
                          rows={1}
                          className="w-full border rounded px-1.5 py-1 text-xs resize-y bg-white"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
