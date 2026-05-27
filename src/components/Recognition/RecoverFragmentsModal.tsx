import React, { useMemo, useState } from 'react';
import { X, Loader2, Upload, Wand2 } from 'lucide-react';
import { ArchivalRecord } from '../../types';
import { openPdf, preparePage, locate } from '../../lib/fragmentLocate';

// 🧪 Експеримент: відновлення hi-res фрагментів зі старого проєкту через
// template-matching на оригінальному PDF. Нічого не псує, доки не «Застосувати».
interface Recovered {
  dataUrl: string;
  score: number;
}

export const RecoverFragmentsModal: React.FC<{
  results: ArchivalRecord[];
  onApply: (updated: ArchivalRecord[]) => void;
  onClose: () => void;
}> = ({ results, onApply, onClose }) => {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [recovered, setRecovered] = useState<Record<string, Recovered>>({});
  const [minScore, setMinScore] = useState(0.4);
  const [msg, setMsg] = useState('');
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  const candidates = useMemo(
    () => results.filter(r => typeof r.fragmentImage === 'string' && r.fragmentImage && r.pageNumber),
    [results]
  );

  const run = async (file: File) => {
    setBusy(true);
    setMsg('');
    setRecovered({});
    try {
      const buf = await file.arrayBuffer();
      const pdf = await openPdf(buf);

      // Беремо справи, чий pdfUrl схожий на обраний файл; якщо таких немає — усі.
      const name = file.name.toLowerCase();
      let targets = candidates.filter(r => (r.pdfUrl || '').toLowerCase().includes(name) || name.includes((r.pdfUrl || '').toLowerCase()));
      if (targets.length === 0) targets = candidates;

      // Групуємо за сторінкою — рендеримо кожну сторінку один раз.
      const byPage = new Map<number, ArchivalRecord[]>();
      for (const r of targets) {
        const arr = byPage.get(r.pageNumber) || [];
        arr.push(r);
        byPage.set(r.pageNumber, arr);
      }

      const total = targets.length;
      let done = 0;
      setProgress({ done, total });
      const out: Record<string, Recovered> = {};

      for (const [pageNum, recs] of byPage) {
        if (pageNum < 1 || pageNum > pdf.numPages) {
          done += recs.length;
          setProgress({ done, total });
          continue;
        }
        const page = await pdf.getPage(pageNum);
        const pr = await preparePage(page);
        for (const r of recs) {
          try {
            const res = await locate(pr, r.fragmentImage!);
            out[r.id] = { dataUrl: res.dataUrl, score: res.score };
          } catch {
            /* пропускаємо невдалі */
          }
          done++;
          setProgress({ done, total });
          // даємо UI перемалюватись
          await new Promise(res => setTimeout(res, 0));
        }
      }
      setRecovered(out);
      const good = (Object.values(out) as Recovered[]).filter(v => v.score >= minScore).length;
      setMsg(`Готово: оброблено ${total}, відновлено ${Object.keys(out).length}, надійних (score ≥ ${minScore}): ${good}.`);
    } catch (e: any) {
      setMsg('❌ ' + (e?.message || 'Помилка обробки PDF'));
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(null), 800);
    }
  };

  const apply = () => {
    const updated = results.map(r => {
      const rec = recovered[r.id];
      if (rec && rec.score >= minScore) return { ...r, fragmentImage: rec.dataUrl };
      return r;
    });
    onApply(updated);
    onClose();
  };

  const scoreColor = (s: number) => (s >= 0.6 ? 'text-emerald-600' : s >= minScore ? 'text-amber-600' : 'text-red-600');
  const appliedCount = (Object.values(recovered) as Recovered[]).filter(v => v.score >= minScore).length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold flex items-center gap-2">
            <Wand2 size={18} className="text-indigo-600" /> 🧪 Відновлення hi-res фрагментів (експеримент)
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded text-slate-500"><X size={18} /></button>
        </div>

        <div className="px-5 py-3 border-b bg-slate-50 text-sm text-slate-600 space-y-2">
          <p>
            Оберіть <b>оригінальний PDF</b> цього опису. Інструмент знайде кожен фрагмент на сторінці
            (template-matching) і вирізатиме hi-res-версію. Справ із картинками: <b>{candidates.length}</b>.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded cursor-pointer text-sm font-medium">
              <Upload size={15} /> Обрати PDF і запустити
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={busy}
                onChange={e => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }}
                className="hidden"
              />
            </label>
            <label className="text-xs text-slate-500 flex items-center gap-2">
              Поріг надійності (score):
              <input type="range" min={0} max={0.9} step={0.05} value={minScore} onChange={e => setMinScore(Number(e.target.value))} />
              <span className="font-mono">{minScore.toFixed(2)}</span>
            </label>
          </div>
          {progress && (
            <div className="text-xs text-slate-500">
              Обробка… {progress.done}/{progress.total}
              <div className="mt-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}
          {msg && <div className="text-sm">{msg}</div>}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {Object.keys(recovered).length === 0 ? (
            <div className="text-center text-slate-400 py-12 text-sm">{busy ? <Loader2 className="animate-spin mx-auto" /> : 'Результати порівняння зʼявляться тут.'}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {results.filter(r => recovered[r.id]).map(r => {
                const rec = recovered[r.id];
                return (
                  <div key={r.id} className="border rounded-lg p-2">
                    <div className="text-[11px] text-slate-400 mb-1 flex justify-between">
                      <span>стор. {r.pageNumber}</span>
                      <span className={scoreColor(rec.score)}>score {rec.score.toFixed(2)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[10px] text-slate-400 mb-0.5">Було</div>
                        <img
                          src={r.fragmentImage}
                          onClick={() => setZoomSrc(r.fragmentImage || null)}
                          className="w-full border rounded bg-slate-50 cursor-zoom-in"
                          title="Клік — на весь екран"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 mb-0.5">Стало (hi-res)</div>
                        <img
                          src={rec.dataUrl}
                          onClick={() => setZoomSrc(rec.dataUrl)}
                          className="w-full border rounded bg-slate-50 cursor-zoom-in"
                          title="Клік — на весь екран"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between">
          <span className="text-xs text-slate-500">Застосується до {appliedCount} справ (score ≥ {minScore.toFixed(2)}).</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded">Скасувати</button>
            <button
              onClick={apply}
              disabled={busy || appliedCount === 0}
              className="px-4 py-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded"
            >
              Застосувати до проєкту
            </button>
          </div>
        </div>
      </div>

      {zoomSrc && (
        <div
          className="fixed inset-0 z-[60] bg-slate-900/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={e => { e.stopPropagation(); setZoomSrc(null); }}
        >
          <img src={zoomSrc} className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
        </div>
      )}
    </div>
  );
};
