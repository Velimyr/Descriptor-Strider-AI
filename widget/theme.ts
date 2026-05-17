import type { CSSProperties } from 'react';

// Пресети кольору акценту. Назви мають збігатись з BUTTON_COLOR_PRESETS у бекенді
// (api/core/partners.ts), щоб валідація на сервері мала сенс.
export const COLOR_PRESETS: Record<string, { accent: string; hover: string }> = {
  purple: { accent: '#6b46c1', hover: '#553c9a' }, // дефолт
  blue:   { accent: '#3182ce', hover: '#2b6cb0' },
  green:  { accent: '#38a169', hover: '#2f855a' },
  red:    { accent: '#e53e3e', hover: '#c53030' },
  orange: { accent: '#dd6b20', hover: '#c05621' },
  slate:  { accent: '#4a5568', hover: '#2d3748' },
  pink:   { accent: '#d53f8c', hover: '#b83280' },
  teal:   { accent: '#319795', hover: '#2c7a7b' },
};

export type ThemeMode = 'light' | 'dark' | 'auto';

import type { FloaterPosition } from './api';

// Обчислює inline-стиль для фікс-позиціонованої кнопки-флоатера.
// EDGE = відступ від краю по горизонталі (фіксовано 24px).
// verticalOffset:
//   bottom-*: додається до bottom (позитивне = далі від нижнього краю);
//   top-right: додається до top (позитивне = далі від верхнього краю);
//   middle-*: додається до translateY (позитивне = нижче від центру).
const EDGE = 24;
const BASE = 24;
export function computeFloaterStyle(
  position: FloaterPosition = 'bottom-right',
  verticalOffset = 0
): CSSProperties {
  const off = Math.max(-500, Math.min(500, verticalOffset || 0));
  switch (position) {
    case 'top-right':
      return { top: BASE + off, right: EDGE, bottom: 'auto', left: 'auto' };
    case 'middle-right':
      return { top: '50%', right: EDGE, bottom: 'auto', left: 'auto', transform: `translateY(calc(-50% + ${off}px))` };
    case 'bottom-left':
      return { bottom: BASE + off, left: EDGE, top: 'auto', right: 'auto' };
    case 'middle-left':
      return { top: '50%', left: EDGE, bottom: 'auto', right: 'auto', transform: `translateY(calc(-50% + ${off}px))` };
    case 'bottom-center':
      return { bottom: BASE + off, left: '50%', top: 'auto', right: 'auto', transform: 'translateX(-50%)' };
    case 'bottom-right':
    default:
      return { bottom: BASE + off, right: EDGE, top: 'auto', left: 'auto' };
  }
}

function applyDarkClass(root: HTMLElement, dark: boolean) {
  if (dark) root.classList.add('blkch-dark');
  else root.classList.remove('blkch-dark');
}

// Затемнюємо hex на ~10% для hover-стану кастомного кольору.
function darken(hex: string, ratio = 0.85): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 0xff) * ratio)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 0xff) * ratio)));
  const b = Math.max(0, Math.min(255, Math.round((n & 0xff) * ratio)));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Застосовує тему і колір. Для 'auto' читає prefers-color-scheme і реагує
// на її зміну. Повертає cleanup-функцію (зняти media listener).
export function applyCustomization(
  root: HTMLElement,
  customization: { theme?: ThemeMode; buttonColor?: string; buttonColorCustom?: string }
): () => void {
  // Кастомний hex (якщо валідний) має пріоритет над preset.
  if (customization.buttonColorCustom && /^#[0-9a-fA-F]{6}$/.test(customization.buttonColorCustom)) {
    const accent = customization.buttonColorCustom;
    root.style.setProperty('--blkch-accent', accent);
    root.style.setProperty('--blkch-accent-hover', darken(accent));
  } else {
    const preset = COLOR_PRESETS[customization.buttonColor || 'purple'] || COLOR_PRESETS.purple;
    root.style.setProperty('--blkch-accent', preset.accent);
    root.style.setProperty('--blkch-accent-hover', preset.hover);
  }

  // Тема: light / dark — фіксовано. auto — слухаємо системну.
  const mode = customization.theme || 'light';
  if (mode === 'light') {
    applyDarkClass(root, false);
    return () => {};
  }
  if (mode === 'dark') {
    applyDarkClass(root, true);
    return () => {};
  }
  // auto
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  applyDarkClass(root, mq.matches);
  const onChange = (e: MediaQueryListEvent) => applyDarkClass(root, e.matches);
  // addEventListener для сучасних браузерів; addListener — fallback для старих Safari.
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }
  (mq as any).addListener(onChange);
  return () => (mq as any).removeListener(onChange);
}
