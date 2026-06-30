import React, { useEffect, useState } from 'react';
import { RefreshCw, Send, Calculator, Ban } from 'lucide-react';
import { tgApi, BroadcastRow } from '../../services/telegramApi';

// Додає N днів до дати YYYY-MM-DD і повертає YYYY-MM-DD (для ексклюзивної межі "До").
function addDays(dateStr: string, days: number): string {
  const t = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(t)) return dateStr;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(s: BroadcastRow['status']): { text: string; cls: string } {
  switch (s) {
    case 'queued':   return { text: 'У черзі', cls: 'bg-amber-100 text-amber-700' };
    case 'sending':  return { text: 'Надсилання', cls: 'bg-blue-100 text-blue-700' };
    case 'done':     return { text: 'Завершено', cls: 'bg-green-100 text-green-700' };
    case 'canceled': return { text: 'Скасовано', cls: 'bg-slate-200 text-slate-600' };
  }
}

export const BroadcastView: React.FC = () => {
  // --- форма ---
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState(addDays(todayStr(), -30));
  const [to, setTo] = useState(todayStr());
  const [maxCases, setMaxCases] = useState(5);
  const [body, setBody] = useState('');
  const [available, setAvailable] = useState<Array<{ action: string; label: string }>>([]);
  const [selected, setSelected] = useState<string[]>([]);

  // --- стан ---
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [list, setList] = useState<BroadcastRow[]>([]);

  // Період критерію: from інклюзивний, to робимо ексклюзивним (наступна доба після
  // обраної дати), щоб увесь день "До" враховувався. Межі — у UTC.
  const critFrom = from;
  const critTo = addDays(to, 1);

  const loadButtons = async () => {
    try {
      const r = await tgApi.broadcastButtons();
      setAvailable(r.buttons);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const loadList = async () => {
    try {
      const r = await tgApi.listBroadcasts();
      setList(r.broadcasts);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    loadButtons();
    loadList();
  }, []);

  // Будь-яка зміна критеріїв робить попередній підрахунок неактуальним.
  useEffect(() => {
    setPreview(null);
  }, [from, to, maxCases]);

  const toggleBtn = (action: string) =>
    setSelected(prev => (prev.includes(action) ? prev.filter(a => a !== action) : [...prev, action]));

  const doPreview = async () => {
    setError('');
    setBusy(true);
    try {
      const r = await tgApi.broadcastPreview({ from: critFrom, to: critTo, maxCases });
      setPreview(r.count);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doSend = async () => {
    setError('');
    if (!body.trim()) {
      setError('Введіть текст повідомлення');
      return;
    }
    const n = preview;
    const confirmMsg =
      n != null
        ? `Надіслати повідомлення ${n} користувач(ам)? Дію не можна скасувати для вже надісланих.`
        : 'Кількість отримувачів ще не підраховано. Усе одно надіслати?';
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await tgApi.createBroadcast({
        title: title.trim(),
        body: body.trim(),
        buttons: selected,
        from: critFrom,
        to: critTo,
        maxCases,
      });
      setBody('');
      setTitle('');
      setSelected([]);
      setPreview(null);
      await loadList();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doDrain = async (id: number) => {
    setBusy(true);
    try {
      await tgApi.drainBroadcast(id);
      await loadList();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async (id: number) => {
    if (!window.confirm('Скасувати розсилку? Ще не надіслані повідомлення не підуть.')) return;
    setBusy(true);
    try {
      await tgApi.cancelBroadcast(id);
      await loadList();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-8">
      {error && (
        <div className="rounded bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">{error}</div>
      )}

      {/* ---- Форма нової розсилки ---- */}
      <section className="space-y-4">
        <h3 className="font-semibold text-slate-800">Нова розсилка</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-sm text-slate-600">Період від</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-sm text-slate-600">Період до (включно)</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-sm text-slate-600">Розпізнав менше ніж</span>
            <input type="number" min={1} value={maxCases}
              onChange={e => setMaxCases(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="mt-1 w-full border rounded px-2 py-1" />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={doPreview} disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-50">
            <Calculator size={15} /> Порахувати отримувачів
          </button>
          {preview != null && (
            <span className="text-sm text-slate-700">
              Потрапляє у вибірку: <b>{preview}</b> користувач(ів)
            </span>
          )}
        </div>

        <label className="block">
          <span className="text-sm text-slate-600">Назва (для адмінки, необовʼязково)</span>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)}
            className="mt-1 w-full border rounded px-2 py-1" placeholder="напр. Нагадування неактивним" />
        </label>

        <label className="block">
          <span className="text-sm text-slate-600">Текст повідомлення (підтримує HTML Telegram)</span>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={5}
            className="mt-1 w-full border rounded px-2 py-1 font-mono text-sm"
            placeholder="Привіт! Давно тебе не було — повертайся розпізнавати справи 🙂" />
        </label>

        <div>
          <span className="text-sm text-slate-600">Кнопки під повідомленням</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {available.map(b => (
              <button key={b.action} onClick={() => toggleBtn(b.action)}
                className={`px-3 py-1.5 text-sm rounded border ${
                  selected.includes(b.action)
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}>
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={doSend} disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
          <Send size={16} /> Надіслати
        </button>
      </section>

      {/* ---- Список кампаній ---- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Минулі розсилки</h3>
          <button onClick={loadList} disabled={busy}
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
            <RefreshCw size={14} /> Оновити
          </button>
        </div>

        {list.length === 0 && <p className="text-sm text-slate-500">Ще немає розсилок.</p>}

        <div className="space-y-2">
          {list.map(b => {
            const st = statusLabel(b.status);
            const clickRate = b.sentCount > 0 ? Math.round((b.clickedCount / b.sentCount) * 100) : 0;
            return (
              <div key={b.id} className="border rounded p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>{st.text}</span>
                    <span className="font-medium truncate">{b.title || `Розсилка #${b.id}`}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(b.status === 'queued' || b.status === 'sending') && (
                      <>
                        <button onClick={() => doDrain(b.id)} disabled={busy}
                          className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 disabled:opacity-50">
                          Продовжити
                        </button>
                        <button onClick={() => doCancel(b.id)} disabled={busy}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100 disabled:opacity-50">
                          <Ban size={12} /> Скасувати
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-slate-600 line-clamp-2 whitespace-pre-wrap">{b.body}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Усього: <b className="text-slate-700">{b.totalCount}</b></span>
                  <span>Надіслано: <b className="text-green-700">{b.sentCount}</b></span>
                  <span>Помилок: <b className="text-red-700">{b.failedCount}</b></span>
                  <span>Натиснули: <b className="text-indigo-700">{b.clickedCount}</b> ({clickRate}%)</span>
                  {b.buttons.length > 0 && <span>Кнопки: {b.buttons.join(', ')}</span>}
                  <span>{new Date(b.createdAt).toLocaleString('uk-UA')}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
