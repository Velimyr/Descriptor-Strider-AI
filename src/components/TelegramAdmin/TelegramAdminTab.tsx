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

type Box = { x: number; y: number; w: number; h: number };

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
        ctx.strokeStyle = 'rgba(99,102,241,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);
        // Білий чіп з номером
        ctx.fillStyle = 'rgba(99,102,241,0.95)';
        ctx.fillRect(x, y, 28, 26);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(String(idx + 1), x + 7, y + 19);
        // Червоний хрестик у правому верхньому куті зони
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
  }, [pageImage, boxes]);

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
      setBoxesForPage(page, prev => prev.filter((_, i) => i !== idx));
      drawingRef.current = null;
      return;
    }
    drawingRef.current = { startX: p.x, startY: p.y };
  };
  const onCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !drawingRef.current) return;
    const p = normFromEvent(e);
    const x = Math.min(drawingRef.current.startX, p.x);
    const y = Math.min(drawingRef.current.startY, p.y);
    const w = Math.abs(p.x - drawingRef.current.startX);
    const h = Math.abs(p.y - drawingRef.current.startY);
    drawingRef.current = null;
    if (w < 0.02 || h < 0.02) return;
    setBoxesForPage(page, prev => [...prev, { x, y, w, h }]);
  };

  const removeBox = (i: number) => setBoxesForPage(page, prev => prev.filter((_, idx) => idx !== i));
  const clearPage = () => setBoxesForPage(page, () => []);

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
    if (!pdf || !geminiKey) {
      setMsg('Потрібно: відкритий PDF + Gemini API key (у головному екрані)');
      return;
    }
    const pages = autoRange.trim()
      ? parsePageRange(autoRange, pdf.numPages)
      : [page];
    if (pages.length === 0) {
      setMsg('❌ Невалідний діапазон. Приклади: "1-10", "3,5,7", "1-5, 8, 10-12"');
      return;
    }
    if (pages.length > 50 && !confirm(`Розпізнати ${pages.length} сторінок? Це може зайняти час і витратити квоту Gemini.`)) {
      return;
    }

    setBusy(true);
    setMsg('');
    setAutoProgress({ done: 0, total: pages.length });
    let totalFound = 0;
    let errors = 0;
    try {
      for (let i = 0; i < pages.length; i++) {
        const pageNum = pages[i];
        setAutoProgress({ done: i, total: pages.length, page: pageNum });
        try {
          const dataUrl = pageNum === page ? pageImage : await renderPageToDataUrl(pdf, pageNum);
          const base64 = dataUrl.split(',')[1];
          const r = await tgApi.detectBoxes(base64, 'image/jpeg', geminiKey);
          const found = r.boxes || [];
          setBoxesForPage(pageNum, () => found);
          totalFound += found.length;
          if (pages.length === 1 && found.length === 0 && r.raw) {
            // Покажемо адміну що повернула модель — щоб зрозуміти чому нічого не знайшло.
            console.log('[Gemini raw response]', r.raw);
            setMsg(
              `⚠ Gemini не знайшла зон. Відповідь моделі (перші 300 символів):\n${String(r.raw).slice(0, 300)}`
            );
          }
        } catch (e: any) {
          errors++;
          console.error(`detect failed on page ${pageNum}:`, e);
        }
      }
      setAutoProgress({ done: pages.length, total: pages.length });
      const errSuffix = errors > 0 ? `, помилок: ${errors}` : '';
      setMsg(
        pages.length === 1
          ? `✅ Знайдено ${totalFound} зон. Перевірте і скоригуйте.`
          : `✅ Опрацьовано ${pages.length} сторінок, знайдено ${totalFound} зон${errSuffix}.`
      );
    } finally {
      setBusy(false);
      setTimeout(() => setAutoProgress(null), 1200);
    }
  };

  // Кропає bbox з заданого jpeg-dataURL (а не з поточної відкритої сторінки).
  const cropBoxFromDataUrl = async (dataUrl: string, box: Box): Promise<string> => {
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
        const data = canvas.toDataURL('image/jpeg', 0.85);
        resolve(data.split(',')[1]);
      };
      img.src = dataUrl;
    });
  };

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

    setBusy(true);
    setUploadDone(null);
    setMsg('');
    setUploadProgress({ done: 0, total: totalBoxes });
    let done = 0;
    try {
      for (const pageNum of pagesWithBoxes) {
        const dataUrl = pageNum === page ? pageImage : await renderPageToDataUrl(pdf, pageNum);
        const items = pageBoxes[pageNum];
        for (const box of items) {
          const base64 = await cropBoxFromDataUrl(dataUrl, box);
          await tgApi.uploadCase({
            imageBase64: base64,
            mime: 'image/jpeg',
            sourcePdf: pdfName,
            page: pageNum,
            bbox: box,
            archive: archive.trim(),
            fund: fund.trim(),
            opys: opys.trim(),
            sprava: sprava.trim(),
          });
          done++;
          setUploadProgress({ done, total: totalBoxes });
        }
      }
      setPageBoxes({});
      setUploadDone({ count: done });
    } catch (e: any) {
      setMsg(`❌ ${e.message}. Завантажено до помилки: ${done}/${totalBoxes}.`);
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
              <option value="auto">Авто (Gemini)</option>
            </select>
            {mode === 'auto' && (
              <>
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
                  disabled={busy}
                  className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded flex items-center gap-1 disabled:opacity-50"
                >
                  <Wand2 size={14} />{' '}
                  {autoRange.trim() ? 'Розпізнати діапазон' : 'Розпізнати'}
                </button>
              </>
            )}
            <button
              onClick={uploadAll}
              disabled={busy || totalBoxes === 0 || !metaValid}
              title={!metaValid ? 'Заповніть Архів / Фонд / Опис / Справа' : ''}
              className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded flex items-center gap-1 disabled:opacity-50"
            >
              <UploadCloud size={14} /> Завантажити всі ({totalBoxes})
            </button>
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
              onMouseUp={onCanvasMouseUp}
              className="cursor-crosshair block mx-auto"
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          </div>
          {boxes.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-xs text-slate-500 mr-1">Зони на цій сторінці:</span>
              {boxes.map((_, i) => (
                <button
                  key={i}
                  onClick={() => removeBox(i)}
                  className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs hover:bg-red-100 hover:text-red-700"
                  title="Видалити зону"
                >
                  #{i + 1} ✕
                </button>
              ))}
              <button
                onClick={clearPage}
                className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs hover:bg-red-100 hover:text-red-700 ml-2"
              >
                Очистити сторінку
              </button>
            </div>
          )}
        </div>
      )}

      {/* Прогрес-бар */}
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
