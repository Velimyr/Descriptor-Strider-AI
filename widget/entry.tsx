// Entry-point віджета. Бандлиться у dist/widget/widget.js (IIFE).
// Партнер встановлює тег:
//   <script src="https://blukach.app/widget.js"
//           data-partner-key="blkch_..."
//           data-api-base="https://blukach.app"
//           async></script>
//
// Послідовність ініціалізації:
//   1. Знаходимо наш <script>, читаємо data-атрибути.
//   2. Створюємо shadow root, інлайнимо CSS.
//   3. Тягнемо partner-config (тема, колір, текст кнопки) — швидкий публічний запит.
//   4. Застосовуємо тему/колір до root.
//   5. Монтуємо React-додаток.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient, PartnerConfig } from './api';
import { App } from './App';
import { applyCustomization } from './theme';
import widgetCss from './styles.css?inline';

const DEFAULT_BUTTON_TEXT = 'Допомогти архіву';

function findOwnScript(): HTMLScriptElement | null {
  const all = Array.from(document.scripts) as HTMLScriptElement[];
  return all.find(s => s.dataset.partnerKey) || null;
}

async function init() {
  const script = findOwnScript();
  if (!script) {
    console.warn('[blukach-widget] no script with data-partner-key found');
    return;
  }
  const partnerKey = script.dataset.partnerKey || '';
  const partnerIdHint = script.dataset.partnerId || partnerKey.slice(0, 12);
  const apiBase =
    script.dataset.apiBase ||
    (script.src ? new URL(script.src).origin : window.location.origin);

  if (!partnerKey) {
    console.warn('[blukach-widget] missing data-partner-key');
    return;
  }

  const host = document.createElement('div');
  host.id = 'blukach-widget-host';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = widgetCss;
  shadow.appendChild(style);

  const mountPoint = document.createElement('div');
  mountPoint.className = 'blkch-root';
  shadow.appendChild(mountPoint);

  const api = new ApiClient({ baseUrl: apiBase, partnerKey });

  // Тягнемо partner-config. Якщо падає (403, мережа) — мовчки беремо дефолти
  // і показуємо віджет з дефолтним стилем; реальна помилка зʼявиться коли юзер
  // натисне кнопку (у поп-апі побачить error stage).
  let config: PartnerConfig | null = null;
  try {
    config = await api.partnerConfig();
  } catch (e) {
    console.warn('[blukach-widget] partner-config failed, using defaults', e);
  }

  applyCustomization(mountPoint, {
    theme: config?.customization.theme,
    buttonColor: config?.customization.buttonColor,
  });

  const buttonText = config?.customization.buttonText || DEFAULT_BUTTON_TEXT;
  const partnerId = config?.partnerId || partnerIdHint;
  const help = config?.help || null;
  const position = config?.customization.position || 'bottom-right';
  const verticalOffset = config?.customization.verticalOffset || 0;
  const tgBotUsername = config?.tgBotUsername || 'descriptorstriderbot';

  const root = createRoot(mountPoint);
  root.render(
    <App
      api={api}
      partnerId={partnerId}
      buttonText={buttonText}
      help={help}
      position={position}
      verticalOffset={verticalOffset}
      tgBotUsername={tgBotUsername}
    />
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
