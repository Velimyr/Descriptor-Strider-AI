// «Працівники місяця» — плаваюча кнопка справа знизу + popup-podium з топ-3 минулого місяця.
// Авто-відкриття 1-7 числа нового місяця (один раз; флаг у localStorage).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trophy, Download, Loader2, Sparkles, Star } from 'lucide-react';
import { toPng } from 'html-to-image';

interface Winner {
  place: 1 | 2 | 3;
  tgId: string;
  displayName: string;
  points: number;
  city: string;
  hasPhoto: boolean;
}

interface HofResponse {
  month: string; // 'YYYY-MM'
  winners: Winner[];
}

const STORAGE_KEY_PREFIX = 'hof_seen_'; // hof_seen_2026-04

function monthLabelUk(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [y, m] = month.split('-').map(Number);
  const names = ['січень','лютий','березень','квітень','травень','червень',
                 'липень','серпень','вересень','жовтень','листопад','грудень'];
  return `${names[m - 1]} ${y}`;
}

function todayDayKyiv(): number {
  return parseInt(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Kyiv', day: '2-digit',
    }).format(new Date()),
    10
  );
}

function initialsOf(name: string): string {
  const t = (name || '').trim();
  if (!t) return '?';
  const parts = t.split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]!.toUpperCase()).join('') || '?';
}

const photoUrl = (tgId: string) => `/api/telegram/hof/photo/${encodeURIComponent(tgId)}`;

// Тестові режими через ?hof=open|demo[&hof_month=YYYY-MM].
// Безпечні: на проді просто не використовуй; в коді жодних дозволів не змінюють.
function readDebugFlags(): { open: boolean; demo: boolean; month: string | null } {
  if (typeof window === 'undefined') return { open: false, demo: false, month: null };
  const sp = new URLSearchParams(window.location.search);
  const v = sp.get('hof');
  const month = sp.get('hof_month');
  return {
    open: v === 'open' || v === 'demo',
    demo: v === 'demo',
    month: month && /^\d{4}-\d{2}$/.test(month) ? month : null,
  };
}

const DEMO_DATA: HofResponse = {
  month: 'demo',
  winners: [
    { place: 1, tgId: 'demo1', displayName: 'Олена Архівна', points: 1240.5, city: 'Львів', hasPhoto: false },
    { place: 2, tgId: 'demo2', displayName: 'Петро Описовий', points: 980, city: 'Київ', hasPhoto: false },
    { place: 3, tgId: 'demo3', displayName: 'Марія Фондова',  points: 760.25, city: 'Бучач', hasPhoto: false },
  ],
};

export const HallOfFameWidget: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<HofResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const flags = useMemo(readDebugFlags, []);

  const load = async () => {
    if (flags.demo) {
      setData(DEMO_DATA);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const url = flags.month ? `/api/telegram/hof?month=${flags.month}` : '/api/telegram/hof';
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as HofResponse;
      setData(j);
    } catch (e: any) {
      setErr(e?.message || 'Не вдалось завантажити');
    } finally {
      setBusy(false);
    }
  };

  // Лінива підвантажка при першому відкритті — і при авто-відкритті.
  useEffect(() => {
    if (open && !data && !busy) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Авто-відкриття 1-7 числа місяця, один раз.
  // Якщо у минулому місяці нікого не було — мовчимо (кнопка лишається,
  // користувач може відкрити вручну, але порожнім вікном не б'ємо).
  useEffect(() => {
    // Дебаг-режим: ?hof=open|demo — ігноруємо календарні/localStorage перевірки.
    if (flags.open) {
      setOpen(true);
      return;
    }
    const day = todayDayKyiv();
    if (day < 1 || day > 7) return;
    (async () => {
      try {
        const r = await fetch('/api/telegram/hof');
        if (!r.ok) return;
        const j = (await r.json()) as HofResponse;
        setData(j);
        const flag = `${STORAGE_KEY_PREFIX}${j.month}`;
        if (localStorage.getItem(flag)) return;
        if (j.winners.length === 0) {
          // Фіксуємо flag, щоб не перетягувати API на кожному рендері цього місяця.
          localStorage.setItem(flag, 'empty');
          return;
        }
        setOpen(true);
        localStorage.setItem(flag, new Date().toISOString());
      } catch {
        // тихо
      }
    })();
  }, []);

  return (
    <>
      <FloatingButton onClick={() => setOpen(true)} />
      <AnimatePresence>
        {open && (
          <PodiumModal
            data={data}
            busy={busy}
            err={err}
            onRetry={load}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
};

const FloatingButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <motion.button
    onClick={onClick}
    aria-label="Працівники місяця"
    title="Працівники місяця"
    initial={{ scale: 0, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.3 }}
    whileHover={{ scale: 1.08 }}
    whileTap={{ scale: 0.95 }}
    className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-xl bg-gradient-to-br from-amber-400 to-amber-500 text-white flex items-center justify-center hover:shadow-2xl"
    style={{ boxShadow: '0 10px 30px -10px rgba(245, 158, 11, 0.55)' }}
  >
    <Trophy size={26} strokeWidth={2.2} />
  </motion.button>
);

const PodiumModal: React.FC<{
  data: HofResponse | null;
  busy: boolean;
  err: string;
  onRetry: () => void;
  onClose: () => void;
}> = ({ data, busy, err, onRetry, onClose }) => {
  const winners = data?.winners || [];
  const byPlace = useMemo(() => {
    const m = new Map<number, Winner>();
    for (const w of winners) m.set(w.place, w);
    return m;
  }, [winners]);
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const saveImage = async () => {
    if (!cardRef.current) return;
    setSaving(true);
    setSaveErr('');
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2, // 2x для чіткості
        backgroundColor: '#fffbeb', // amber-50 — бо контейнер має градієнт
      });
      const a = document.createElement('a');
      const monthSlug = data?.month || 'hof';
      a.download = `workers-of-the-month-${monthSlug}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e: any) {
      setSaveErr(e?.message || 'Не вдалось зберегти');
    } finally {
      setSaving(false);
    }
  };

  const canSave = !busy && !err && winners.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
        onClick={e => e.stopPropagation()}
        className="relative max-w-2xl w-full max-h-[90vh] overflow-auto"
      >
        {/* Кнопки керування — поза «карткою-для-скріншоту», щоб не потрапляли в PNG. */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          {canSave && (
            <button
              onClick={saveImage}
              disabled={saving}
              title="Зберегти як картинку"
              className="px-3 py-2 rounded-full bg-white/95 shadow-md hover:shadow-lg text-slate-700 hover:text-amber-700 transition flex items-center gap-1.5 text-sm font-medium disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              <span className="hidden sm:inline">Зберегти</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/95 hover:bg-white text-slate-500 hover:text-slate-700 transition shadow-md"
          >
            <X size={18} />
          </button>
        </div>

        <div
          ref={cardRef}
          className="relative bg-gradient-to-br from-amber-50 via-white to-orange-50 rounded-3xl shadow-2xl overflow-hidden"
        >
          {/* Декоративні плями градієнтів на фоні */}
          <div className="pointer-events-none absolute -top-20 -left-20 w-64 h-64 rounded-full bg-amber-200/30 blur-3xl" />
          <div className="pointer-events-none absolute -top-10 -right-16 w-56 h-56 rounded-full bg-orange-200/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 w-72 h-72 rounded-full bg-yellow-200/30 blur-3xl" />
          {/* Конфеті — крапки/зірочки в шапці */}
          <ConfettiDecor />

        <div className="relative px-6 sm:px-10 pt-8 pb-6">
          <div className="flex flex-col items-center mb-3">
            {/* Лого Блукача в кружальці з обідком */}
            <div className="relative mb-3">
              <div className="w-16 h-16 rounded-full bg-white shadow-lg ring-4 ring-amber-200 flex items-center justify-center overflow-hidden">
                <img src="/logo.png" alt="Блукач" className="w-12 h-12 object-contain" />
              </div>
              {/* Маленькі іскри по краях лого */}
              <Sparkles size={14} className="absolute -top-1 -right-1 text-amber-400 drop-shadow" />
              <Sparkles size={12} className="absolute -bottom-1 -left-1 text-orange-400 drop-shadow" />
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 text-white text-xs font-bold uppercase tracking-wider shadow-md">
              <Trophy size={14} /> Працівники місяця
            </div>
          </div>
          <h2 className="text-center text-2xl sm:text-3xl font-extrabold text-slate-800">
            {data ? monthLabelUk(data.month) : '…'}
          </h2>
          <p className="text-center text-amber-700 text-sm sm:text-base mt-2 font-semibold">
            Найкращі розпізнавачі архівних описів! 🎉
          </p>
        </div>

        <div className="relative px-6 sm:px-10 pb-10">
          {busy && <div className="text-center py-12 text-slate-400">Завантаження…</div>}
          {err && (
            <div className="text-center py-8">
              <div className="text-red-500 mb-2">⚠ {err}</div>
              <button onClick={onRetry} className="text-indigo-600 hover:underline text-sm">Спробувати ще раз</button>
            </div>
          )}
          {!busy && !err && winners.length === 0 && (
            <div className="text-center py-10">
              <div className="text-5xl mb-3">🏆</div>
              <div className="text-slate-700 font-semibold mb-1">Поки немає переможців</div>
              <div className="text-slate-500 text-sm">
                Опрацьовуйте справи — у новому місяці саме ви можете опинитись на цьому подіумі!
              </div>
            </div>
          )}
          {!busy && !err && winners.length > 0 && (
            <Podium first={byPlace.get(1)} second={byPlace.get(2)} third={byPlace.get(3)} />
          )}
        </div>
        </div>
        {saveErr && (
          <div className="mt-2 px-4 py-2 bg-red-50 text-red-700 text-sm rounded-lg text-center">
            ⚠ {saveErr}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

const Podium: React.FC<{ first?: Winner; second?: Winner; third?: Winner }> = ({ first, second, third }) => (
  <div className="flex items-end justify-center gap-3 sm:gap-6 pt-2">
    {/* 2-е місце (ліворуч) */}
    <div className="flex-1 flex flex-col items-center max-w-[180px]">
      {second ? <WinnerCard winner={second} /> : <EmptySlot place={2} />}
      <PodiumBar place={2} />
    </div>
    {/* 1-е місце (центр, найвище) */}
    <div className="flex-1 flex flex-col items-center max-w-[220px]">
      {first ? <WinnerCard winner={first} /> : <EmptySlot place={1} />}
      <PodiumBar place={1} />
    </div>
    {/* 3-е місце (праворуч) */}
    <div className="flex-1 flex flex-col items-center max-w-[180px]">
      {third ? <WinnerCard winner={third} /> : <EmptySlot place={3} />}
      <PodiumBar place={3} />
    </div>
  </div>
);

const PLACE_STYLE = {
  1: {
    medal: '🥇',
    ring: 'ring-amber-400',
    bg: 'bg-gradient-to-b from-amber-400 to-amber-500',
    label: 'text-amber-700',
    barHeight: 'h-32',
    avatarSize: 'w-28 h-28 sm:w-32 sm:h-32',
    nameSize: 'text-base sm:text-lg',
  },
  2: {
    medal: '🥈',
    ring: 'ring-slate-300',
    bg: 'bg-gradient-to-b from-slate-300 to-slate-400',
    label: 'text-slate-600',
    barHeight: 'h-20',
    avatarSize: 'w-20 h-20 sm:w-24 sm:h-24',
    nameSize: 'text-sm sm:text-base',
  },
  3: {
    medal: '🥉',
    ring: 'ring-orange-400',
    bg: 'bg-gradient-to-b from-orange-400 to-orange-500',
    label: 'text-orange-700',
    barHeight: 'h-14',
    avatarSize: 'w-20 h-20 sm:w-24 sm:h-24',
    nameSize: 'text-sm sm:text-base',
  },
} as const;

const WinnerCard: React.FC<{ winner: Winner }> = ({ winner }) => {
  const s = PLACE_STYLE[winner.place];
  const [imgErr, setImgErr] = useState(false);
  const showPhoto = winner.hasPhoto && !imgErr;
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.1 + (3 - winner.place) * 0.12, type: 'spring', stiffness: 180, damping: 18 }}
      className="flex flex-col items-center text-center pb-2"
    >
      <div className="relative mb-2">
        <div className={`${s.avatarSize} rounded-full ring-4 ${s.ring} ring-offset-2 ring-offset-amber-50 overflow-hidden bg-slate-100 flex items-center justify-center shadow-lg`}>
          {showPhoto ? (
            <img
              src={photoUrl(winner.tgId)}
              alt={winner.displayName}
              onError={() => setImgErr(true)}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="text-2xl sm:text-3xl font-bold text-slate-500">{initialsOf(winner.displayName)}</span>
          )}
        </div>
        <div className="absolute -bottom-1 -right-1 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white shadow-md flex items-center justify-center text-2xl sm:text-3xl leading-none">
          {s.medal}
        </div>
      </div>
      <div className={`${s.nameSize} font-bold text-slate-800 leading-tight max-w-[160px] break-words`}>
        {winner.displayName || '—'}
      </div>
      {winner.city && (
        <div className="text-xs text-slate-500 mt-0.5">{winner.city}</div>
      )}
      <div className={`${s.label} text-xs font-bold uppercase tracking-wider mt-1`}>
        {winner.points} балів
      </div>
    </motion.div>
  );
};

const EmptySlot: React.FC<{ place: 1 | 2 | 3 }> = ({ place }) => {
  const s = PLACE_STYLE[place];
  return (
    <div className="flex flex-col items-center text-center pb-2 opacity-50">
      <div className={`${s.avatarSize} rounded-full border-2 border-dashed border-slate-300 mb-2 flex items-center justify-center text-3xl`}>
        {s.medal}
      </div>
      <div className="text-xs text-slate-400">вільно</div>
    </div>
  );
};

// Декоративне «конфеті» у шапці: яскраві кружальця/зірочки/іскри.
// Абсолютне позиціонування — не впливає на лейаут. Лагідні анімації через motion.
const ConfettiDecor: React.FC = () => (
  <div className="pointer-events-none absolute inset-x-0 top-0 h-44 overflow-hidden">
    {/* Зірочки лівого боку */}
    <motion.div
      initial={{ opacity: 0, y: -10, rotate: -20 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ delay: 0.2, duration: 0.6 }}
      className="absolute top-3 left-6 text-amber-400"
    >
      <Star size={18} fill="currentColor" />
    </motion.div>
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35, duration: 0.6 }}
      className="absolute top-12 left-3 text-orange-400"
    >
      <Sparkles size={16} />
    </motion.div>
    {/* Зірочки правого боку */}
    <motion.div
      initial={{ opacity: 0, y: -10, rotate: 20 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ delay: 0.25, duration: 0.6 }}
      className="absolute top-4 right-20 text-amber-400"
    >
      <Star size={14} fill="currentColor" />
    </motion.div>
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.6 }}
      className="absolute top-14 right-8 text-orange-400"
    >
      <Sparkles size={18} />
    </motion.div>
    {/* Кольорові крапки-конфеті */}
    {[
      { left: '15%', top: '8px',  color: 'bg-amber-400',  size: 'w-2 h-2', delay: 0.3 },
      { left: '28%', top: '24px', color: 'bg-orange-400', size: 'w-1.5 h-1.5', delay: 0.4 },
      { left: '42%', top: '6px',  color: 'bg-rose-400',   size: 'w-2 h-2', delay: 0.5 },
      { left: '58%', top: '22px', color: 'bg-yellow-400', size: 'w-1.5 h-1.5', delay: 0.45 },
      { left: '72%', top: '10px', color: 'bg-amber-500',  size: 'w-2 h-2', delay: 0.35 },
      { left: '85%', top: '26px', color: 'bg-orange-300', size: 'w-1.5 h-1.5', delay: 0.5 },
    ].map((c, i) => (
      <motion.div
        key={i}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: c.delay, duration: 0.5 }}
        className={`absolute rounded-full ${c.size} ${c.color}`}
        style={{ left: c.left, top: c.top }}
      />
    ))}
  </div>
);

const PodiumBar: React.FC<{ place: 1 | 2 | 3 }> = ({ place }) => {
  const s = PLACE_STYLE[place];
  return (
    <motion.div
      initial={{ scaleY: 0 }}
      animate={{ scaleY: 1 }}
      transition={{ delay: 0.05 + (3 - place) * 0.1, duration: 0.5, ease: 'easeOut' }}
      style={{ transformOrigin: 'bottom' }}
      className={`w-full ${s.barHeight} ${s.bg} rounded-t-xl shadow-inner flex items-start justify-center pt-2`}
    >
      <span className="text-white font-extrabold text-2xl drop-shadow">{place}</span>
    </motion.div>
  );
};
