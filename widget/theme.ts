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

function applyDarkClass(root: HTMLElement, dark: boolean) {
  if (dark) root.classList.add('blkch-dark');
  else root.classList.remove('blkch-dark');
}

// Застосовує тему і колір. Для 'auto' читає prefers-color-scheme і реагує
// на її зміну. Повертає cleanup-функцію (зняти media listener).
export function applyCustomization(
  root: HTMLElement,
  customization: { theme?: ThemeMode; buttonColor?: string }
): () => void {
  // Колір — статичний, виставляємо одразу.
  const preset = COLOR_PRESETS[customization.buttonColor || 'purple'] || COLOR_PRESETS.purple;
  root.style.setProperty('--blkch-accent', preset.accent);
  root.style.setProperty('--blkch-accent-hover', preset.hover);

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
