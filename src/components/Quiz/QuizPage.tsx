// Сторінка шоу для стріму (/quiz). Дві вкладки — «Вікторина» й «Архівний
// стендап» — зі спільним рейтингом балів. Доступ за адмін-логіном (той самий,
// що й у адмінці бота).
import React, { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { cn } from '../../lib/utils';
import { AdminAuthProvider, useAdminAuth } from '../TelegramAdmin/adminAuth';
import { LoginGate } from './shared';
import { QuizTab } from './QuizTab';
import { StandupTab } from './StandupTab';

type Tab = 'quiz' | 'standup';
const TAB_KEY = 'quiz_page_tab';

export function QuizPage() {
  return (
    <AdminAuthProvider
      renderLogin={onSuccess => <LoginGate onDone={onSuccess} />}
      renderLoading={() => (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
          Перевіряю доступ…
        </div>
      )}
    >
      <QuizShell />
    </AdminAuthProvider>
  );
}

function QuizShell() {
  const { can, logout } = useAdminAuth();
  const [tab, setTab] = useState<Tab>(() =>
    (typeof window !== 'undefined' && localStorage.getItem(TAB_KEY)) === 'standup' ? 'standup' : 'quiz'
  );

  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  if (!can('quiz')) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-950 text-slate-300">
        <div className="text-sm">У вашого акаунта немає доступу до сторінки шоу.</div>
        <button onClick={logout} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">
          Вийти
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col">
      <div className="flex items-center gap-2 px-6 py-2 border-b border-slate-800 bg-slate-900 shrink-0">
        {([['quiz', '🎙 Вікторина'], ['standup', '🎤 Архівний стендап']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-bold transition-colors',
              tab === key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'
            )}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={logout}
          title="Вийти"
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400"
        >
          <LogOut size={16} />
        </button>
      </div>

      {/* Обидві вкладки опитують сервер лише поки відкриті — монтуємо по одній. */}
      {tab === 'quiz' ? <QuizTab /> : <StandupTab />}
    </div>
  );
}
