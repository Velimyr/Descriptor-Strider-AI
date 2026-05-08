import React, { useEffect, useState } from 'react';
import { CasesView } from '../TelegramAdmin/TelegramAdminTab';

// Публічна сторінка підготовки справ. Не захищена паролем — їй тільки треба
// Gemini API key користувача для авто-розпізнавання зон.
// Завантаження в БД тут НЕ виконується (це тільки для адмінки).
export const CasesPreparationPage: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [geminiKey, setGeminiKey] = useState<string>(
    () => localStorage.getItem('gemini_key') || ''
  );
  const [draft, setDraft] = useState(geminiKey);

  useEffect(() => {
    setDraft(geminiKey);
  }, [geminiKey]);

  const saveKey = () => {
    const k = draft.trim();
    setGeminiKey(k);
    if (k) localStorage.setItem('gemini_key', k);
  };

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <h2 className="font-bold text-lg">Підготовка справ</h2>
        <button onClick={onClose} className="px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 rounded">
          Закрити
        </button>
      </header>

      <div className="border-b bg-slate-50 px-6 py-2 flex flex-wrap gap-2 items-center text-xs text-slate-700">
        <span>Gemini API key:</span>
        <input
          type="password"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={saveKey}
          placeholder="ключ зберігається у браузері (localStorage)"
          className="border rounded px-2 py-1 text-xs flex-1 max-w-md"
        />
        {geminiKey && draft === geminiKey && (
          <span className="text-green-600">✓ збережено</span>
        )}
        <span className="text-slate-500">
          Підготуйте проєкт і збережіть його через «Експорт» — потім імпортуйте в адмінці для завантаження в канал.
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <CasesView geminiKey={geminiKey} mode="prep" />
      </div>
    </div>
  );
};
