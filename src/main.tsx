import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { QuizPage } from './components/Quiz/QuizPage.tsx';
import './index.css';

// Сторінка вікторини для стріму — окремий екран без бічної панелі застосунку
// (щоб показувати на весь екран). Роутера в проєкті немає, тому вибір за шляхом.
const isQuiz = /^\/quiz\/?$/.test(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isQuiz ? <QuizPage /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
