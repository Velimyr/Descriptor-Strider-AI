// Per-опис оверрайди порогу підтверджень і базових балів (спільні для бота й
// веб-перевірки). Використовується і при завантаженні опису (Підготовка справ),
// і для редагування вже завантаженого опису (Експортувати опис).
import { useEffect, useState } from 'react';
import { tgApi } from '../../services/telegramApi';

export interface DescriptionSettingsValue {
  targetSubmissions: number | null;
  pointsRecognition: number | null;
  pointsVerification: number | null;
}

export const EMPTY_DESCRIPTION_SETTINGS: DescriptionSettingsValue = {
  targetSubmissions: null,
  pointsRecognition: null,
  pointsVerification: null,
};

// Тягне поточні оверрайди + глобальні дефолти для опису (archive/fund/opys), коли
// всі 3 поля заповнені. Використовується і для префілу при завантаженні (щоб другий
// батч того ж опису не "скидав" уже виставлені значення), і для екрана редагування.
export function useDescriptionSettings(archive: string, fund: string, opys: string) {
  const [settings, setSettings] = useState<DescriptionSettingsValue>(EMPTY_DESCRIPTION_SETTINGS);
  const [defaults, setDefaults] = useState({ targetSubmissions: 2, pointsRecognition: 3, pointsVerification: 1 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const a = archive.trim();
    const f = fund.trim();
    const o = opys.trim();
    if (!a || !f || !o) {
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    tgApi
      .getDescriptionSettings(a, f, o)
      .then(res => {
        if (cancelled) return;
        setSettings(res.settings);
        setDefaults(res.defaults);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [archive, fund, opys]);

  return { settings, setSettings, defaults, loaded };
}

// Три поля-оверрайди: поріг підтверджень, бали за розпізнавання, бали за перевірку.
// showRecognition=false ховає поле балів за розпізнавання (для веб-перевірки —
// там немає окремої дії "розпізнавання", вона робиться AI).
export function DescriptionSettingsFields({
  value,
  onChange,
  defaults,
  showRecognition = true,
}: {
  value: DescriptionSettingsValue;
  onChange: (v: DescriptionSettingsValue) => void;
  defaults: { targetSubmissions: number; pointsRecognition: number; pointsVerification: number };
  showRecognition?: boolean;
}) {
  const numOrNull = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <div className="text-xs font-medium text-slate-700 mb-1">
        Налаштування для цього опису (порожньо = дефолт):
      </div>
      <div className={`grid grid-cols-1 gap-2 ${showRecognition ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        <label className="text-xs text-slate-500">
          Поріг підтверджень
          <input
            type="number"
            min={1}
            value={value.targetSubmissions ?? ''}
            onChange={e => onChange({ ...value, targetSubmissions: numOrNull(e.target.value) })}
            placeholder={`Дефолт: ${defaults.targetSubmissions}`}
            className="mt-0.5 border rounded px-2 py-1.5 text-sm w-full"
          />
        </label>
        {showRecognition && (
          <label className="text-xs text-slate-500">
            Бали за розпізнавання
            <input
              type="number"
              min={0}
              step="0.1"
              value={value.pointsRecognition ?? ''}
              onChange={e => onChange({ ...value, pointsRecognition: numOrNull(e.target.value) })}
              placeholder={`Дефолт: ${defaults.pointsRecognition}`}
              className="mt-0.5 border rounded px-2 py-1.5 text-sm w-full"
            />
          </label>
        )}
        <label className="text-xs text-slate-500">
          Бали за перевірку
          <input
            type="number"
            min={0}
            step="0.1"
            value={value.pointsVerification ?? ''}
            onChange={e => onChange({ ...value, pointsVerification: numOrNull(e.target.value) })}
            placeholder={`Дефолт: ${defaults.pointsVerification}`}
            className="mt-0.5 border rounded px-2 py-1.5 text-sm w-full"
          />
        </label>
      </div>
    </div>
  );
}
