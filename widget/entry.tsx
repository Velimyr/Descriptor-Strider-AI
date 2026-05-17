// Entry-point віджета. Бандлиться у dist/widget/widget.js (IIFE).
// Партнер встановлює тег:
//   <script src="https://blukach.app/widget.js"
//           data-partner-key="blkch_..."
//           data-api-base="https://blukach.app"
//           async></script>
//
// На завантаженні: знаходить свій <script>, читає data-атрибути, монтує React-додаток
// у Shadow DOM (повна ізоляція стилів від хост-сторінки).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient } from './api';
import { App } from './App';
import widgetCss from './styles.css?inline';

function findOwnScript(): HTMLScriptElement | null {
  // У продакшні шукаємо за data-partner-key. Якщо є кілька — беремо перший.
  const all = Array.from(document.scripts) as HTMLScriptElement[];
  return all.find(s => s.dataset.partnerKey) || null;
}

function init() {
  const script = findOwnScript();
  if (!script) {
    console.warn('[blukach-widget] no script with data-partner-key found');
    return;
  }
  const partnerKey = script.dataset.partnerKey || '';
  // partnerId — публічна частина (slug). Потрібен для localStorage namespace.
  // Якщо не вказаний — fallback на перші 8 символів ключа.
  const partnerId = script.dataset.partnerId || partnerKey.slice(0, 12);
  // Базовий URL: за замовчанням походить з src самого скрипта.
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

  // Інлайнимо CSS у shadow root.
  const style = document.createElement('style');
  style.textContent = widgetCss;
  shadow.appendChild(style);

  const mountPoint = document.createElement('div');
  mountPoint.className = 'blkch-root';
  shadow.appendChild(mountPoint);

  const api = new ApiClient({ baseUrl: apiBase, partnerKey });
  const root = createRoot(mountPoint);
  root.render(<App api={api} partnerId={partnerId} />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
