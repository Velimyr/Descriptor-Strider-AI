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

type TabKey = 'setup' | 'questions' | 'cases' | 'overview';

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

const CasesView: React.FC<{ geminiKey: string }> = ({ geminiKey }) => {
  const [pdf, setPdf] = useState<any>(null);
  const [pdfName, setPdfName] = useState('');
  const [page, setPage] = useState(1);
  const [pageImage, setPageImage] = useState<string>(''); // dataURL у високому dpi
  const [boxes, setBoxes] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadDone, setUploadDone] = useState<{ count: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<{ startX: number; startY: number } | null>(null);

  const loadPdf = async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      setMsg('❌ Це не PDF-файл.');
      return;
    }
    setMsg('');
    setUploadDone(null);
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
    // 0.92 — баланс якість/розмір
    setPageImage(canvas.toDataURL('image/jpeg', 0.92));
    setBoxes([]);
  };

  useEffect(() => {
    if (pdf) renderPage(pdf, page);
  }, [page]);

  // малювання прямокутників
  useEffect(() => {
    if (!pageImage || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      ctx.strokeStyle = 'rgba(99,102,241,0.9)';
      ctx.lineWidth = 3;
      boxes.forEach((b, idx) => {
        ctx.strokeRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
        ctx.fillStyle = 'rgba(99,102,241,0.9)';
        ctx.font = '20px sans-serif';
        ctx.fillText(String(idx + 1), b.x * canvas.width + 4, b.y * canvas.height + 22);
      });
    };
    img.src = pageImage;
  }, [pageImage, boxes]);

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    drawingRef.current = {
      startX: (e.clientX - rect.left) / rect.width,
      startY: (e.clientY - rect.top) / rect.height,
    };
  };
  const onCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !drawingRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const endX = (e.clientX - rect.left) / rect.width;
    const endY = (e.clientY - rect.top) / rect.height;
    const x = Math.min(drawingRef.current.startX, endX);
    const y = Math.min(drawingRef.current.startY, endY);
    const w = Math.abs(endX - drawingRef.current.startX);
    const h = Math.abs(endY - drawingRef.current.startY);
    drawingRef.current = null;
    if (w < 0.02 || h < 0.02) return;
    setBoxes(b => [...b, { x, y, w, h }]);
  };
  const removeBox = (i: number) => setBoxes(b => b.filter((_, idx) => idx !== i));

  const runAuto = async () => {
    if (!pageImage || !geminiKey) {
      setMsg('Потрібно: відкрита сторінка + Gemini API key (у головному екрані)');
      return;
    }
    setBusy(true);
    try {
      const base64 = pageImage.split(',')[1];
      const r = await tgApi.detectBoxes(base64, 'image/jpeg', geminiKey);
      setBoxes(r.boxes || []);
      setMsg(`✅ Знайдено ${r.boxes?.length || 0} справ. Перевірте і скоригуйте.`);
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const cropBoxToBase64 = async (box: { x: number; y: number; w: number; h: number }): Promise<string> => {
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
      img.src = pageImage;
    });
  };

  const uploadAll = async () => {
    if (boxes.length === 0) return;
    setBusy(true);
    setUploadDone(null);
    setMsg('');
    const total = boxes.length;
    setUploadProgress({ done: 0, total });
    try {
      for (let i = 0; i < total; i++) {
        const base64 = await cropBoxToBase64(boxes[i]);
        await tgApi.uploadCase({
          imageBase64: base64,
          mime: 'image/jpeg',
          sourcePdf: pdfName,
          page,
          bbox: boxes[i],
        });
        setUploadProgress({ done: i + 1, total });
      }
      setBoxes([]);
      setUploadDone({ count: total });
    } catch (e: any) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
      setTimeout(() => setUploadProgress(null), 800);
    }
  };

  return (
    <div className="space-y-4">
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
        <div className="flex gap-3 items-center flex-wrap">
          <div className="text-sm font-medium truncate max-w-xs" title={pdfName}>
            📄 {pdfName}
          </div>
          <button
            onClick={() => {
              setPdf(null);
              setPdfName('');
              setPageImage('');
              setBoxes([]);
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
            <button
              onClick={runAuto}
              disabled={busy}
              className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded flex items-center gap-1 disabled:opacity-50"
            >
              <Wand2 size={14} /> Розпізнати
            </button>
          )}
          <button
            onClick={uploadAll}
            disabled={busy || boxes.length === 0}
            className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded flex items-center gap-1 disabled:opacity-50"
          >
            <UploadCloud size={14} /> Завантажити в канал ({boxes.length})
          </button>
        </div>
      )}

      {pageImage && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            Малюйте прямокутники мишкою навколо кожної справи. Клацніть на номер у списку, щоб видалити.
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
            <div className="flex flex-wrap gap-1">
              {boxes.map((_, i) => (
                <button
                  key={i}
                  onClick={() => removeBox(i)}
                  className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs hover:bg-red-100 hover:text-red-700"
                >
                  #{i + 1} ✕
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Прогрес-бар */}
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
