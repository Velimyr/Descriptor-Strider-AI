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

// Парсимо CSS background-color у RGB. Підтримуємо rgb() / rgba() / hex.
// Повертає null якщо колір не вдалось розпарсити або повністю прозорий.
function parseBg(s: string): { r: number; g: number; b: number } | null {
  if (!s) return null;
  // rgb(255, 255, 255) або rgba(255, 255, 255, 0.5) або new CSS rgb(255 255 255 / 50%)
  const m = s.match(/rgba?\s*\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.%]+))?\s*\)/i);
  if (m) {
    const a = m[4] === undefined ? 1 : (m[4].includes('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    if (a < 0.05) return null; // повністю прозорий
    return { r: +m[1], g: +m[2], b: +m[3] };
  }
  // #rgb / #rrggbb
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const exp = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return {
      r: parseInt(exp.slice(0, 2), 16),
      g: parseInt(exp.slice(2, 4), 16),
      b: parseInt(exp.slice(4, 6), 16),
    };
  }
  return null;
}

// Визначає, чи сайт-носій використовує темну тему. Логіка:
// 1. Шукаємо непрозорий background у body → html → найближчого предка.
// 2. Рахуємо відносну яскравість (sRGB luminance). < 128 = темно.
// Так само працюємо коли сайт використовує `class="dark"` чи custom CSS — нам важлива
// підсумкова кольорова картина, не назва класу.
function detectHostDarkness(): boolean {
  const candidates: Element[] = [document.body, document.documentElement];
  for (const el of candidates) {
    if (!el) continue;
    const bg = getComputedStyle(el).backgroundColor;
    const rgb = parseBg(bg);
    if (rgb) {
      const luminance = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
      return luminance < 128;
    }
  }
  // Fallback на системну якщо нічого не визначили.
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Застосовує тему і колір. Для 'auto' — реагує на тему ХОСТ-САЙТУ (не системну):
// читає background-color body, перевіряємо повторно при змінах атрибутів/класів
// document.documentElement (MutationObserver). Повертає cleanup-функцію.
export function applyCustomization(
  root: HTMLElement,
  customization: { theme?: ThemeMode; buttonColor?: string; buttonColorCustom?: string }
): () => void {
  if (customization.buttonColorCustom && /^#[0-9a-fA-F]{6}$/.test(customization.buttonColorCustom)) {
    const accent = customization.buttonColorCustom;
    root.style.setProperty('--blkch-accent', accent);
    root.style.setProperty('--blkch-accent-hover', darken(accent));
  } else {
    const preset = COLOR_PRESETS[customization.buttonColor || 'purple'] || COLOR_PRESETS.purple;
    root.style.setProperty('--blkch-accent', preset.accent);
    root.style.setProperty('--blkch-accent-hover', preset.hover);
  }

  const mode = customization.theme || 'light';
  if (mode === 'light') { applyDarkClass(root, false); return () => {}; }
  if (mode === 'dark')  { applyDarkClass(root, true);  return () => {}; }

  // auto = відстежуємо тему сайту-носія.
  const refresh = () => applyDarkClass(root, detectHostDarkness());
  refresh();

  // Спостерігаємо за змінами класу/атрибутів на <html> і <body> — більшість тем-перемикачів
  // саме там додають/прибирають "dark" або data-theme=...
  const observers: MutationObserver[] = [];
  for (const target of [document.documentElement, document.body]) {
    if (!target) continue;
    const obs = new MutationObserver(refresh);
    obs.observe(target, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    observers.push(obs);
  }

  // Системна — як останній fallback (на випадок коли сайт не змінює background при тему-перемиканні
  // взагалі і покладається повністю на prefers-color-scheme).
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onSys = () => refresh();
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onSys);
  else (mq as any).addListener(onSys);

  return () => {
    observers.forEach(o => o.disconnect());
    if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onSys);
    else (mq as any).removeListener(onSys);
  };
}
