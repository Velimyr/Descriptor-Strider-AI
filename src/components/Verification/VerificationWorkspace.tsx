import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Check, SkipForward, Pencil, Rows, Columns, RotateCcw, Award, ExternalLink } from 'lucide-react';
import * as verifApi from '../../services/verifApi';
import type { VerifCase, VerifStatsResp } from '../../services/verifApi';

type Orientation = 'horizontal' | 'vertical';
const ORIENT_KEY = 'verif_orientation';

// Редактор одного поля з можливістю клацнути на окреме слово й виправити його.
const FieldEditor: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [fullEdit, setFullEdit] = useState(false);

  // Токени: слова + роздільники (пробіли) чергуються — join('') відновлює рядок без втрат.
  const tokens = useMemo(() => (value.length ? value.split(/(\s+)/) : []), [value]);
  const isWord = (t: string) => t.length > 0 && !/^\s+$/.test(t);

  const commitWord = (i: number) => {
    const next = [...tokens];
    next[i] = draft;
    onChange(next.join(''));
    setEditingIdx(null);
  };

  if (fullEdit) {
    return (
      <input
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => setFullEdit(false)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            setFullEdit(false);
          }
        }}
        className="w-full p-2 bg-white border border-indigo-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-y-1 p-2 bg-slate-50 border border-slate-200 rounded text-sm leading-relaxed">
      {tokens.length === 0 ? (
        <span className="text-slate-300 italic cursor-text" onClick={() => setFullEdit(true)}>
          (порожньо)
        </span>
      ) : (
        tokens.map((t, i) =>
          isWord(t) ? (
            editingIdx === i ? (
              <input
                key={i}
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={() => commitWord(i)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitWord(i);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingIdx(null);
                  }
                }}
                style={{ width: `${Math.max(2, draft.length + 1)}ch` }}
                className="px-0.5 bg-white border border-indigo-400 rounded outline-none"
              />
            ) : (
              <span
                key={i}
                onClick={() => {
                  setDraft(t);
                  setEditingIdx(i);
                }}
                className="cursor-pointer rounded px-0.5 hover:bg-amber-100"
                title="Клік — редагувати слово"
              >
                {t}
              </span>
            )
          ) : (
            <span key={i} style={{ whiteSpace: 'pre' }}>
              {t}
            </span>
          )
        )
      )}
      <button
        onClick={() => setFullEdit(true)}
        title="Редагувати все поле"
        className="ml-1 text-slate-300 hover:text-indigo-500"
      >
        <Pencil size={13} />
      </button>
    </div>
  );
};

// Символи, яких немає на українській розкладці: російські (ъ ы э ё) + дореформені
// (ѣ і ѳ ѵ). Кожен — у нижньому й верхньому регістрі.
const VK_KEYS = ['ё', 'ъ', 'ы', 'э', 'ѣ', 'і', 'ѳ', 'ѵ', 'Ё', 'Ъ', 'Ы', 'Э', 'Ѣ', 'І', 'Ѳ', 'Ѵ'];

// Вставляє символ у поле, що зараз у фокусі (input/textarea), через нативний сеттер +
// подію input — щоб React (контрольований інпут) підхопив зміну.
function insertIntoActive(ch: string): boolean {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return false;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + ch + el.value.slice(end);
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const pos = start + ch.length;
  el.setSelectionRange(pos, pos);
  return true;
}

const VirtualKeyboard: React.FC = () => {
  const [hint, setHint] = useState(false);
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1">
        {VK_KEYS.map(ch => (
          <button
            key={ch}
            // mousedown + preventDefault: не даємо полю втратити фокус (інакше слово
            // «закоммітиться» і інпут зникне до вставки).
            onMouseDown={e => {
              e.preventDefault();
              if (!insertIntoActive(ch)) setHint(true);
              else setHint(false);
            }}
            className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded hover:bg-indigo-50 hover:border-indigo-300 text-sm text-slate-700"
            title={`Вставити «${ch}»`}
          >
            {ch}
          </button>
        ))}
      </div>
      <div className="text-[10px] text-slate-400 mt-1">
        {hint ? 'Спочатку клацніть у поле (або слово), потім — символ.' : 'Спецсимволи (рос. / дореформені) — для відсутніх на укр. розкладці.'}
      </div>
    </div>
  );
};

// Будує посилання на повний PDF опису: база (конфігуровна) + назва файлу + #page=N.
// Якщо source_pdf уже повний URL — лишаємо як є. Скрол до сторінки через #page=
// (працює у вбудованих PDF-переглядачах Chrome/Firefox/Edge).
function buildOpysUrl(base: string, sourcePdf: string, page: string): string {
  if (!sourcePdf) return '';
  const root = base || 'https://cdiak.archives.gov.ua/files/';
  const url = /^https?:\/\//i.test(sourcePdf) ? sourcePdf : `${root}${sourcePdf}`;
  const p = parseInt(String(page || '').match(/\d+/)?.[0] || '', 10);
  return Number.isFinite(p) && p > 0 ? `${url}#page=${p}` : url;
}

export const VerificationWorkspace: React.FC<{ opysBaseUrl?: string }> = ({ opysBaseUrl }) => {
  const [orientation, setOrientation] = useState<Orientation>(() =>
    (localStorage.getItem(ORIENT_KEY) as Orientation) === 'vertical' ? 'vertical' : 'horizontal'
  );
  const [cse, setCse] = useState<VerifCase | null>(null);
  const [working, setWorking] = useState<string[]>([]);
  const [stats, setStats] = useState<VerifStatsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const [toast, setToast] = useState<string>('');
  const [zoom, setZoom] = useState(false);
  const [celebrate, setCelebrate] = useState<{ id: string; title: string; text: string; media: 'image' | 'video' }[]>([]);
  const [err, setErr] = useState('');

  // Тримаємо id «своєї» (взятої, ще не зданої) справи, щоб звільнити лок при виході.
  const ownedRef = useRef<string | null>(null);

  const setOrient = (o: Orientation) => {
    setOrientation(o);
    localStorage.setItem(ORIENT_KEY, o);
  };

  const loadNext = useCallback(async () => {
    setLoading(true);
    setErr('');
    setZoom(false);
    try {
      const [next, st] = await Promise.all([verifApi.getNext(), verifApi.getStats()]);
      setStats(st);
      if (!next) {
        setCse(null);
        setNoMore(true);
        ownedRef.current = null;
      } else {
        const ans = [...next.answers];
        while (ans.length < next.questions.length) ans.push('');
        setCse(next);
        setWorking(ans);
        setNoMore(false);
        ownedRef.current = next.caseId;
      }
    } catch (e: any) {
      setErr(e?.message || 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNext();
  }, [loadNext]);

  // Звільняємо лок взятої справи при розмонтуванні / закритті вкладки.
  useEffect(() => {
    const release = () => {
      const id = ownedRef.current;
      if (!id) return;
      ownedRef.current = null;
      verifApi.releaseCase(id).catch(() => {});
    };
    window.addEventListener('beforeunload', release);
    return () => {
      window.removeEventListener('beforeunload', release);
      release();
    };
  }, []);

  const original = cse ? cse.answers : [];
  const edited = useMemo(
    () => cse != null && JSON.stringify(working) !== JSON.stringify(padTo(original, working.length)),
    [working, original, cse]
  );

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const onSubmit = async () => {
    if (!cse || submitting) return;
    setSubmitting(true);
    setErr('');
    try {
      const r = await verifApi.submitCase(cse.caseId, working);
      ownedRef.current = null;
      const parts = [`+${r.pointsEarned} б.`];
      if (r.correctedWords > 0) parts.push(`виправлено слів: ${r.correctedWords}`);
      if (r.done) parts.push('справу перевірено повністю ✓');
      else parts.push(`підтверджень: ${r.confirmationsCount}/3`);
      flashToast(parts.join(' · '));
      if (r.earnedBadges && r.earnedBadges.length > 0) setCelebrate(r.earnedBadges);
      await loadNext();
    } catch (e: any) {
      setErr(e?.message || 'Не вдалося зберегти');
    } finally {
      setSubmitting(false);
    }
  };

  const onSkip = async () => {
    if (!cse || submitting) return;
    setSubmitting(true);
    setErr('');
    try {
      await verifApi.skipCase(cse.caseId);
      ownedRef.current = null;
      await loadNext();
    } catch (e: any) {
      setErr(e?.message || 'Не вдалося пропустити');
    } finally {
      setSubmitting(false);
    }
  };

  // Гарячі клавіші: Enter — підтвердити/зберегти; коли фокус у полі — не перехоплюємо.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cse, working, submitting]);

  const curDesc = cse
    ? stats?.descriptions.find(d => d.archive === cse.archive && d.fund === cse.fund && d.opys === cse.opys)
    : undefined;

  return (
    <div className="space-y-4">
      {/* Шапка */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
        <div>
          {cse ? (
            <>
              <div className="text-lg font-bold text-slate-800">
                Опис: {cse.archive} {cse.fund}-{cse.opys}
              </div>
              <div className="text-sm text-slate-500">
                Перевірено {curDesc ? curDesc.done : 0} / {curDesc ? curDesc.total : 0} справ
                {stats && (
                  <span className="text-xs text-slate-400">
                    {'  '}(описів: {stats.total_descriptions}, лишилось: {stats.remaining_descriptions})
                  </span>
                )}
              </div>
              {cse.sourcePdf && (
                <a
                  href={buildOpysUrl(opysBaseUrl || '', cse.sourcePdf, cse.page)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-0.5"
                >
                  <ExternalLink size={12} /> Відкрити повний опис{cse.page ? ` (стор. ${cse.page})` : ''}
                </a>
              )}
            </>
          ) : (
            <div className="text-lg font-bold text-slate-600">Перевірка справ</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400 mr-1">Вигляд:</span>
          <button
            onClick={() => setOrient('horizontal')}
            className={`p-2 rounded-lg border ${orientation === 'horizontal' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500'}`}
            title="Поряд (зображення зліва)"
          >
            <Columns size={16} />
          </button>
          <button
            onClick={() => setOrient('vertical')}
            className={`p-2 rounded-lg border ${orientation === 'vertical' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500'}`}
            title="Стовпчиком (зображення зверху)"
          >
            <Rows size={16} />
          </button>
        </div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : noMore || !cse ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500">
          <Award size={40} className="mx-auto mb-3 text-amber-400" />
          <h3 className="text-xl font-bold text-slate-600 mb-1">Наразі немає справ для перевірки</h3>
          <p className="text-sm mb-4">Усі доступні справи опрацьовано або зайняті іншими.</p>
          <button
            onClick={loadNext}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-sm font-medium"
          >
            <RotateCcw size={16} /> Перевірити ще раз
          </button>
        </div>
      ) : (
        <>
          <div className={orientation === 'horizontal' ? 'flex gap-4 items-start' : 'flex flex-col gap-4'}>
            {/* Зображення */}
            <div className={orientation === 'horizontal' ? 'w-1/2 shrink-0' : 'w-full'}>
              <div className="bg-slate-900/5 border border-slate-200 rounded-xl p-2 overflow-auto" style={{ maxHeight: '70vh' }}>
                <img
                  src={cse.imageUrl}
                  alt="Справа"
                  onClick={() => setZoom(true)}
                  className="w-full h-auto rounded cursor-zoom-in"
                  referrerPolicy="no-referrer"
                />
              </div>
              <VirtualKeyboard />
            </div>

            {/* Поля по питаннях */}
            <div className={orientation === 'horizontal' ? 'flex-1 space-y-3' : 'w-full space-y-3'}>
              {cse.questions.map((q, i) => {
                const changed = (working[i] ?? '') !== (original[i] ?? '');
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        {q.label || `Поле ${i + 1}`}
                      </label>
                      {changed && (
                        <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                          змінено
                        </span>
                      )}
                    </div>
                    <FieldEditor
                      value={working[i] ?? ''}
                      onChange={v => setWorking(prev => prev.map((x, j) => (j === i ? v : x)))}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Дії */}
          <div className="flex flex-wrap items-center gap-3 sticky bottom-0 bg-gradient-to-t from-slate-50 to-transparent py-3">
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg font-bold shadow-md"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              {edited ? 'Зберегти зміни' : 'Підтвердити'}
              <span className="text-xs opacity-70">(Enter)</span>
            </button>
            <button
              onClick={onSkip}
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 font-medium"
            >
              <SkipForward size={18} /> Пропустити
            </button>
            {edited && (
              <button
                onClick={() => setWorking(padTo(original, cse.questions.length))}
                disabled={submitting}
                className="flex items-center gap-2 px-3 py-2.5 text-slate-400 hover:text-slate-600 text-sm"
              >
                <RotateCcw size={15} /> Скинути правки
              </button>
            )}
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-8 right-8 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl text-sm z-50">
          {toast}
        </div>
      )}

      {zoom && cse && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setZoom(false)}
        >
          <img src={cse.imageUrl} alt="Справа" className="max-w-full max-h-full rounded-lg" referrerPolicy="no-referrer" />
        </div>
      )}

      {celebrate.length > 0 && (
        <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setCelebrate([])}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center space-y-4" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-bold text-amber-600 uppercase tracking-wider">🏅 Нове досягнення!</div>
            <div className="space-y-5">
              {celebrate.map(b => (
                <div key={b.id} className="space-y-2">
                  {b.media === 'video' ? (
                    <video
                      src={`/api/verif/badge/${encodeURIComponent(b.id)}/image`}
                      className="w-28 h-28 object-contain mx-auto rounded-xl"
                      autoPlay
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={`/api/verif/badge/${encodeURIComponent(b.id)}/image`}
                      alt={b.title}
                      className="w-28 h-28 object-contain mx-auto rounded-xl"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="text-lg font-bold text-slate-800">{b.title}</div>
                  <div className="text-sm text-slate-500">{b.text}</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setCelebrate([])}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold"
            >
              Клас!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function padTo(arr: string[], len: number): string[] {
  const out = [...arr];
  while (out.length < len) out.push('');
  return out;
}
