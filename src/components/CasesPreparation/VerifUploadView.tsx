import React, { useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { tgApi } from '../../services/telegramApi';

// Вкладка «Веб» у Підготовці справ: завантаження справ на ВЕБ-перевірку з файлу,
// експортованого зі сторінки розпізнавання (.json проєкту: tableStructure + results[]).
// Текст (data) + питання (колонки) → verif_cases, зображення (fragmentImage) → група.
// Лише колаборативний режим (AI наперед заповнює відповіді).
interface ImportedProject {
  name: string;
  columns: Array<{ id: string; label?: string; role?: string }>;
  results: Array<{ data?: Record<string, unknown>; fragmentImage?: string; pdfUrl?: string; pageNumber?: number }>;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
// Анти-flood: пауза між завантаженнями + ретрай на лімітах/мережевих збоях.
const UPLOAD_PACING_MS = 400;
const MAX_ATTEMPTS = 3;
const isTransientError = (msg: string) =>
  /\b429\b|flood|too many|rate.?limit|timeout|ETIMEDOUT|ECONNRESET|socket|network|503|502|504/i.test(msg || '');

export const VerifUploadView: React.FC = () => {
  const [archive, setArchive] = useState('');
  const [fund, setFund] = useState('');
  const [opys, setOpys] = useState('');
  const [project, setProject] = useState<ImportedProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState('');

  const metaValid = !!(archive.trim() && fund.trim() && opys.trim());
  const withImageCount = project ? project.results.filter(r => typeof r.fragmentImage === 'string' && r.fragmentImage.includes(',')).length : 0;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const columns = Array.isArray(data.tableStructure) ? data.tableStructure : [];
        const results = Array.isArray(data.results) ? data.results : [];
        if (columns.length === 0) throw new Error('У файлі немає структури таблиці (tableStructure).');
        setProject({ name: data.name || f.name, columns, results });
        const imgs = results.filter((r: any) => typeof r?.fragmentImage === 'string' && r.fragmentImage.includes(',')).length;
        setMsg(`Завантажено «${data.name || f.name}»: ${results.length} справ, ${columns.length} колонок, ${imgs} із зображеннями.`);
      } catch (err: any) {
        setMsg('❌ Не вдалося прочитати файл: ' + err.message);
        setProject(null);
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  const upload = async () => {
    if (!project || !metaValid) return;
    const { columns } = project;
    const questions = columns.map(c => ({ label: c.label || '', role: c.role || 'none' }));
    // pending — лише справи із зображеннями; беремо знімок на початок проходу.
    const pending = project.results.filter(r => typeof r.fragmentImage === 'string' && r.fragmentImage.includes(','));
    const total = pending.length;
    if (total === 0) {
      setMsg('❌ У файлі немає справ із зображеннями (fragmentImage). Експортуйте проєкт із результатами розпізнавання.');
      return;
    }
    setBusy(true);
    setMsg('');
    setProgress({ done: 0, total });
    let done = 0;
    try {
      for (let idx = 0; idx < pending.length; idx++) {
        const r = pending[idx];
        const aiAnswers = columns.map(c => String((r.data || {})[c.id] ?? ''));
        const [meta, b64] = String(r.fragmentImage).split(',');
        const mime = meta.match(/data:([^;]+)/)?.[1] || 'image/png';
        const payload = {
          imageBase64: b64,
          mime,
          sourcePdf: r.pdfUrl || '',
          page: r.pageNumber ?? '',
          bbox: null,
          archive: archive.trim(),
          fund: fund.trim(),
          opys: opys.trim(),
          questions,
          aiAnswers,
        };

        // Ретрай на тимчасових збоях (ліміти Telegram / мережа). На «постійних»
        // помилках (напр. немає таблиці) — кидаємо одразу, щоб не довбати марно.
        let attempt = 0;
        for (;;) {
          try {
            await tgApi.uploadVerifCase(payload);
            break;
          } catch (e: any) {
            attempt++;
            const m = e?.message || '';
            if (attempt >= MAX_ATTEMPTS || !isTransientError(m)) throw e;
            setMsg(`⏳ Тимчасова помилка на справі ${done + 1}/${total} — повтор (${attempt}/${MAX_ATTEMPTS - 1})…`);
            await sleep(1500 * attempt);
          }
        }

        done++;
        setProgress({ done, total });
        // Прибираємо вже завантажену справу зі списку — щоб повторний клік
        // продовжив із решти, без дублювання (як у бот-завантаженні).
        setProject(prev => (prev ? { ...prev, results: prev.results.filter(x => x !== r) } : prev));
        // Пауза між відправками, щоб не впертись у flood-ліміт Telegram.
        if (idx < pending.length - 1) await sleep(UPLOAD_PACING_MS);
      }
      setMsg(`✅ Завантажено ${done} справ на перевірку.`);
      setProject(null);
    } catch (e: any) {
      setMsg(
        `❌ ${e.message}\nЗавантажено: ${done}/${total}. Невідправлені справи лишилися — ` +
          `натисніть «Завантажити» ще раз, продовжимо з того ж місця.`
      );
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(null), 1000);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="text-sm text-slate-600">
        Завантажте <b>.json</b>, експортований зі сторінки розпізнавання («Експорт проєкту»). Текст і питання
        потраплять у чергу веб-перевірки, зображення — у Telegram-групу. Режим — лише колаборативний.
      </div>

      <section className={`border rounded p-3 ${metaValid ? 'bg-slate-50' : 'bg-amber-50 border-amber-300'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Архівні реквізити (обовʼязкові)</div>
          {!metaValid && <div className="text-xs text-amber-700">⚠ Заповніть усі 3 поля</div>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input value={archive} onChange={e => setArchive(e.target.value)} placeholder="Архів *"
            className={`border rounded px-2 py-1.5 text-sm ${!archive.trim() ? 'border-amber-400' : ''}`} />
          <input value={fund} onChange={e => setFund(e.target.value)} placeholder="Фонд *"
            className={`border rounded px-2 py-1.5 text-sm ${!fund.trim() ? 'border-amber-400' : ''}`} />
          <input value={opys} onChange={e => setOpys(e.target.value)} placeholder="Опис *"
            className={`border rounded px-2 py-1.5 text-sm ${!opys.trim() ? 'border-amber-400' : ''}`} />
        </div>
      </section>

      <label className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer text-sm font-medium">
        <Upload size={16} /> Обрати файл .json
        <input type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
      </label>

      {project && (
        <button
          onClick={upload}
          disabled={busy || !metaValid || withImageCount === 0}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded text-sm font-bold"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          Завантажити {withImageCount} справ на перевірку
        </button>
      )}

      {progress && (
        <div className="text-sm text-slate-600">
          Завантаження… {progress.done}/{progress.total}
          <div className="mt-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {msg && <div className="text-sm whitespace-pre-wrap">{msg}</div>}
    </div>
  );
};
