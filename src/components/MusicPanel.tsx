import React, { useEffect, useRef, useState } from 'react';
import { Music, ChevronDown, ChevronUp, VolumeX, Play, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { musicPlayer, TRACKS, Track, isValidTrack } from '../services/musicPlayer';

interface Props {
  isProcessing: boolean;
}

const STORAGE_KEY = 'music_settings';

interface Settings {
  enabled: boolean;
  track: Track;
  volume: number;
}

const defaultSettings: Settings = {
  enabled: true,
  track: 'rock',
  volume: 0.05,
};

const VOLUME_MIN = 0.01;
const VOLUME_MAX = 0.10;

const clampVolume = (v: number) =>
  Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, v));

const loadSettings = (): Settings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = { ...defaultSettings, ...JSON.parse(raw) };
      if (!isValidTrack(parsed.track)) parsed.track = defaultSettings.track;
      parsed.volume = clampVolume(parsed.volume);
      return parsed;
    }
  } catch {}
  return defaultSettings;
};

export const MusicPanel: React.FC<Props> = ({ isProcessing }) => {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [previewing, setPreviewing] = useState(false);
  const previewingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    musicPlayer.setVolume(settings.volume);
  }, [settings.volume]);

  // Auto-play during processing
  useEffect(() => {
    if (isProcessing && settings.enabled) {
      musicPlayer.setVolume(settings.volume);
      musicPlayer.play(settings.track);
      previewingRef.current = false;
      setPreviewing(false);
    } else if (!previewingRef.current) {
      musicPlayer.stop();
    }
  }, [isProcessing, settings.enabled, settings.track]);

  const togglePreview = () => {
    if (previewingRef.current) {
      musicPlayer.stop();
      previewingRef.current = false;
      setPreviewing(false);
    } else {
      musicPlayer.setVolume(settings.volume);
      musicPlayer.play(settings.track);
      previewingRef.current = true;
      setPreviewing(true);
    }
  };

  const isLive = isProcessing && settings.enabled;

  return (
    <div className="px-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
      >
        {settings.enabled ? (
          <Music size={18} className="text-indigo-500" />
        ) : (
          <VolumeX size={18} className="text-slate-400" />
        )}
        <span className="font-medium text-sm flex-1 text-left">Музика</span>
        {(isLive || previewing) && (
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        )}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-3 pb-1 space-y-3">
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => setSettings(s => ({ ...s, enabled: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                Грати під час розпізнавання
              </label>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Мелодія</label>
                <select
                  value={settings.track}
                  disabled={!settings.enabled}
                  onChange={(e) => setSettings(s => ({ ...s, track: e.target.value as Track }))}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs disabled:opacity-50 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  {TRACKS.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Гучність {Math.round(settings.volume * 100)}%
                </label>
                <input
                  type="range"
                  min={VOLUME_MIN}
                  max={VOLUME_MAX}
                  step="0.01"
                  value={settings.volume}
                  disabled={!settings.enabled}
                  onChange={(e) => setSettings(s => ({ ...s, volume: clampVolume(parseFloat(e.target.value)) }))}
                  className="w-full disabled:opacity-50 accent-indigo-600"
                />
              </div>

              <button
                onClick={togglePreview}
                disabled={!settings.enabled || isProcessing}
                className="w-full flex items-center justify-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors text-xs font-medium disabled:opacity-50"
              >
                {previewing ? <><Square size={12} fill="currentColor" /> Зупинити прослуховування</> : <><Play size={12} /> Прослухати</>}
              </button>

              <p className="text-[10px] text-slate-400 leading-relaxed">
                Музика автоматично грає під час розпізнавання — це не дає браузеру сповільнити вкладку, коли вона неактивна.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
