-- Позначає всі відкриті справи як «завершені».
-- Алгоритм видачі (selectNextCaseForUser) у першому пріоритеті фільтрує по status='open',
-- тож такі справи більше не потраплятимуть у звичайну видачу і не будуть надсилатись користувачам.
--
-- ⚠ Зверніть увагу: якщо в src/telegram-bot/config.ts увімкнено
--    cases.allowExtraAfterTarget = true (за замовчуванням true), то "закриті" справи
--    можуть з'являтися як "fallback" для користувачів, які їх ще НЕ бачили.
--    Якщо ви хочете повністю зупинити видачу — або вимкніть allowExtraAfterTarget,
--    або скористайтесь wipe-data.sql.
--
-- Як запустити: Supabase → SQL Editor → New query → вставити → Run.

update bot_cases
   set status = 'done'
 where status <> 'done';

-- Повернути кількість змінених справ:
-- (postgres сам надрукує "UPDATE N" — це і є кількість)
