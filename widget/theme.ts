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

// Застосовуємо тему/колір до root-елемента shadow DOM через CSS-змінні.
// Викликається один раз при ініціалізації віджета.
export function applyCustomization(
  root: HTMLElement,
  customization: { theme?: 'light' | 'dark'; buttonColor?: string }
) {
  if (customization.theme === 'dark') root.classList.add('blkch-dark');
  else root.classList.remove('blkch-dark');

  const preset = COLOR_PRESETS[customization.buttonColor || 'purple'] || COLOR_PRESETS.purple;
  root.style.setProperty('--blkch-accent', preset.accent);
  root.style.setProperty('--blkch-accent-hover', preset.hover);
}
