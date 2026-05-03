-- ⚠ ОБЕРЕЖНО: видаляє ВСІ дані бота. Структура таблиць і RLS лишаються.
-- Чистить: користувачів, справи, сесії, результати, бали, лог розсилок, налаштування питань.
-- Bigserial-послідовності скидаються до 1.
--
-- Як запустити: Supabase → SQL Editor → New query → вставити → Run.
-- Підтвердження не запитується — будьте уважні.

truncate table
  bot_submissions,
  bot_sessions,
  bot_dispatch_log,
  bot_daily_scores,
  bot_users,
  bot_cases,
  bot_meta
restart identity cascade;
