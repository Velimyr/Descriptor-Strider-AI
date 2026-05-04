import React, { useEffect, useRef, useState } from 'react';
import { X, RefreshCw, Save, UploadCloud, Wand2, Trash2, Plus } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import { TableColumn } from '../../types';
import { tgApi, getAdminSecret, clearAdminSecret, adminLogin } from '../../services/telegramApi';
import { createDefaultColumns, createColumn, COLUMN_ROLE_LABELS, COLUMN_ROLE_OPTIONS } from '../../lib/tableColumns';

interface Props {
  onClose: () => void;
  geminiKey: string;
  initialQuestions?: TableColumn[]; // зазвичай tableStructure активного проєкту
}

type TabKey = 'setup' | 'questions' | 'cases' | 'results' | 'overview';

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
        {tab === 'cases' && <CasesView geminiKey={geminiKey} />}
        {tab === 'results' && <ResultsView />}
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
  meta: { archive: string; fund: string; opys: string; sprava: string };
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

const CasesView: React.FC<{ geminiKey: string }> = ({ geminiKey }) => {
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
  const [archive, setArchive] = useState(() => localStorage.getItem('tg_admin_archive') || '');
  const [fund, setFund] = useState(() => localStorage.getItem('tg_admin_fund') || '');
  const [opys, setOpys] = useState(() => localStorage.getItem('tg_admin_opys') || '');
  const [sprava, setSprava] = useState(() => localStorage.getItem('tg_admin_sprava') || '');
  // Діапазон сторінок для авто-розпізнавання. Порожньо → поточна сторінка.
  const [autoRange, setAutoRange] = useState('');
  const [autoProgress, setAutoProgress] = useState<{ done: number; total: number; page?: number } | null>(null);
  // Провайдер для авто-розпізнавання.
  type Provider = 'gemini' | 'claude' | 'groq';
  const [provider, setProvider] = useState<Provider>(
    (localStorage.getItem('tg_admin_provider') as Provider) || 'gemini'
  );
  const [claudeKey, setClaudeKey] = useState(() => localStorage.getItem('tg_admin_claude_key') || '');
  const [groqKey, setGroqKey] = useState(() => localStorage.getItem('tg_admin_groq_key') || '');
  const [skipExisting, setSkipExisting] = useState(true);
  const importInputRef = useRef<HTMLInputElement>(null);
  // Кеш бінарного PDF для повторного відкриття після імпорту і експорту.
  const [pdfBase64, setPdfBase64] = useState<string>('');
  // Виділені зони (id) — для обʼєднання у крос-сторінкові групи.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showLog, setShowLog] = useState(false);
  type LogEntry = {
    page: number;
    provider: string;
    model: string;
    count: number;
    raw: string;
    error?: string;
    ts: string;
  };
  const [recogLog, setRecogLog] = useState<LogEntry[]>([]);

  const activeApiKey =
    provider === 'claude' ? claudeKey : provider === 'groq' ? groqKey : geminiKey;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<{ startX: number; startY: number } | null>(null);

  const metaValid = !!(archive.trim() && fund.trim() && opys.trim() && sprava.trim());
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

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const p = normFromEvent(e);
    // Якщо клац у "хрестик" будь-якої зони — видаляємо її і не починаємо drag.
    const idx = boxes.findIndex(b => hitCloseHandle(p, b));
    if (idx >= 0) {
      removeBox(idx);
      drawingRef.current = null;
      return;
    }
    drawingRef.current = { startX: p.x, startY: p.y };
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

  const onCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !drawingRef.current) return;
    const p = normFromEvent(e);
    const x = Math.min(drawingRef.current.startX, p.x);
    const y = Math.min(drawingRef.current.startY, p.y);
    const w = Math.abs(p.x - drawingRef.current.startX);
    const h = Math.abs(p.y - drawingRef.current.startY);
    drawingRef.current = null;
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
      meta: { archive, fund, opys, sprava },
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
        if (data.meta.sprava) setSprava(data.meta.sprava);
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
      const which =
        provider === 'claude' ? 'Claude' : provider === 'groq' ? 'Groq' : 'Gemini';
      const where =
        provider === 'gemini' ? '(у головному екрані)' : '(введіть нижче в полі провайдера)';
      setMsg(`Потрібно: відкритий PDF + ${which} API key ${where}`);
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
      !confirm(`Розпізнати ${pages.length} сторінок через ${provider}? Це може зайняти час і витратити квоту.`)
    ) {
      return;
    }

    // Запам'ятовуємо вибір провайдера.
    localStorage.setItem('tg_admin_provider', provider);
    if (provider === 'claude' && claudeKey) localStorage.setItem('tg_admin_claude_key', claudeKey);
    if (provider === 'groq' && groqKey) localStorage.setItem('tg_admin_groq_key', groqKey);

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
          const r = await tgApi.detectBoxes(base64, 'image/jpeg', activeApiKey, provider);
          const found: Box[] = (r.boxes || []).map((b: any) => {
            const id = newId();
            return { x: b.x, y: b.y, w: b.w, h: b.h, id, groupId: id };
          });
          setBoxesForPage(pageNum, () => found);
          totalFound += found.length;
          newLogs.push({
            page: pageNum,
            provider: r.provider || provider,
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
            provider,
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
      setMsg('❌ Заповніть Архів / Фонд / Опис / Справа перед завантаженням.');
      return;
    }
    localStorage.setItem('tg_admin_archive', archive.trim());
    localStorage.setItem('tg_admin_fund', fund.trim());
    localStorage.setItem('tg_admin_opys', opys.trim());
    localStorage.setItem('tg_admin_sprava', sprava.trim());

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
          sprava: sprava.trim(),
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
            <div className="text-xs text-amber-700">⚠ Заповніть усі 4 поля перед завантаженням</div>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
          <input
            value={sprava}
            onChange={e => setSprava(e.target.value)}
            placeholder="Справа *"
            className={`border rounded px-2 py-1.5 text-sm ${!sprava.trim() ? 'border-amber-400' : ''}`}
          />
        </div>
        <div className="text-xs text-slate-500 mt-1.5">
          Ці значення додаються до кожної справи з цього PDF і потрапляють у Результати разом з імʼям файлу і номером сторінки.
          Зберігаються між сесіями.
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
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value as Provider)}
                  className="border rounded px-2 py-1 text-sm"
                  title="Модель для розпізнавання"
                >
                  <option value="gemini">Gemini Flash</option>
                  <option value="claude">Claude Opus</option>
                  <option value="groq">Llama (Groq, free)</option>
                </select>
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
                  title={!activeApiKey ? `Введіть ${provider === 'claude' ? 'Claude' : provider === 'groq' ? 'Groq' : 'Gemini'} API key` : ''}
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
            <button
              onClick={uploadAll}
              disabled={busy || totalBoxes === 0 || !metaValid}
              title={!metaValid ? 'Заповніть Архів / Фонд / Опис / Справа' : ''}
              className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded flex items-center gap-1 disabled:opacity-50"
            >
              <UploadCloud size={14} />{' '}
              {totalBoxes !== groups.size
                ? `Завантажити (${groups.size} справ із ${totalBoxes} зон)`
                : `Завантажити всі (${totalBoxes})`}
            </button>
          </div>

          {/* Поле ключа Claude */}
          {mode === 'auto' && provider === 'claude' && (
            <div className="flex gap-2 items-center text-xs">
              <span className="text-slate-600">Claude API key:</span>
              <input
                type="password"
                value={claudeKey}
                onChange={e => setClaudeKey(e.target.value)}
                onBlur={() => localStorage.setItem('tg_admin_claude_key', claudeKey)}
                placeholder="sk-ant-..."
                className="flex-1 max-w-md border rounded px-2 py-1"
              />
              {claudeKey && <span className="text-green-600">✓ збережено</span>}
            </div>
          )}
          {/* Поле ключа Groq */}
          {mode === 'auto' && provider === 'groq' && (
            <div className="flex gap-2 items-center text-xs">
              <span className="text-slate-600">Groq API key:</span>
              <input
                type="password"
                value={groqKey}
                onChange={e => setGroqKey(e.target.value)}
                onBlur={() => localStorage.setItem('tg_admin_groq_key', groqKey)}
                placeholder="gsk_..."
                className="flex-1 max-w-md border rounded px-2 py-1"
              />
              {groqKey && <span className="text-green-600">✓ збережено</span>}
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 underline"
              >
                отримати безкоштовно
              </a>
            </div>
          )}

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
              onMouseUp={onCanvasMouseUp}
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
                    <span className="text-slate-500">{l.provider}/{l.model}</span>
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
              🤖 Розпізнавання {provider === 'claude' ? 'Claude' : 'Gemini'}{autoProgress.page ? ` (стор. ${autoProgress.page})` : ''}…
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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [limit, setLimit] = useState(500);
  const [filter, setFilter] = useState('');

  const refresh = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await tgApi.results(limit);
      setData({ questions: r.questions || [], submissions: r.submissions || [] });
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

  const buildHeaders = (questions: any[]) => [
    'submitted_at',
    'display_name',
    'tg_id',
    'Архів',
    'Фонд',
    'Опис',
    'Справа',
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
      s.archive || '',
      s.fund || '',
      s.opys || '',
      s.sprava || '',
      s.source_pdf || '',
      s.page || '',
      ...questions.map((_: any, i: number) => String(answers[i] ?? '')),
      s.case_id || '',
      s.source_link || '',
    ];
  };

  const filtered = data
    ? data.submissions.filter(s => {
        if (!filter.trim()) return true;
        const q = filter.toLowerCase();
        const row = buildRow(s, data.questions);
        return row.some(c => String(c).toLowerCase().includes(q));
      })
    : [];

  const exportCsv = () => {
    if (!data) return;
    const headers = buildHeaders(data.questions);
    const rows = filtered.map(s => buildRow(s, data.questions));
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
    a.href = url;
    a.download = `descriptor-results-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
            <div className="bg-slate-50 border rounded p-3 text-sm">
              {data.progress.donePct}% — {data.progress.doneCases} з {data.progress.totalCases} повністю.{' '}
              Усього справ: {data.cases}.
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
