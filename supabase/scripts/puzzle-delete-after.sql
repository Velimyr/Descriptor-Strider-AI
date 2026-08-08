-- ============================================================================
-- Видалення фраз «Описового пазла» після заданої дати (київська).
-- Запусти в Supabase → SQL Editor.
--
-- ПРЕФІКС: прод — bot_ (нижче). Для staging заміни bot_ на botdev_.
-- МЕЖА: '2026-08-07' — видаляється все СТРОГО ПІСЛЯ цієї дати (з 08.08 включно).
--       Сама дата межі та все, що раніше, лишається недоторканим.
--
-- Порядок: спершу блок 1 (перевірка), переконайся в числах, тоді блок 2.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- БЛОК 1. Що саме буде видалено (нічого не змінює — можна запускати сміливо).
-- ---------------------------------------------------------------------------
select
  (select count(*) from bot_puzzles          where date_kyiv > date '2026-08-07') as puzzles,
  (select min(date_kyiv) from bot_puzzles    where date_kyiv > date '2026-08-07') as first_date,
  (select max(date_kyiv) from bot_puzzles    where date_kyiv > date '2026-08-07') as last_date,
  -- Прогрес і переможці на майбутні дати мають бути 0. Якщо ні — межа зачіпає
  -- дні, у які вже грали: зупинись і розберись, перш ніж видаляти.
  (select count(*) from bot_puzzle_progress  where date_kyiv > date '2026-08-07') as progress,
  (select count(*) from bot_puzzle_winners   where date_kyiv > date '2026-08-07') as winners;

-- ---------------------------------------------------------------------------
-- БЛОК 2. Саме видалення. Транзакція: або все, або нічого.
-- Прогрес і переможців чистимо теж — інакше при повторному заповненні тих
-- самих дат лишиться прогрес від старих фраз (PK date+tg_id+word не збігнеться
-- з новим набором слів, і в UI буде сміття).
-- ---------------------------------------------------------------------------
begin;

delete from bot_puzzle_winners  where date_kyiv > date '2026-08-07';
delete from bot_puzzle_progress where date_kyiv > date '2026-08-07';
delete from bot_puzzles         where date_kyiv > date '2026-08-07';

-- Контроль: усі три мають бути 0. Якщо ні — rollback замість commit.
select
  (select count(*) from bot_puzzles          where date_kyiv > date '2026-08-07') as puzzles_left,
  (select count(*) from bot_puzzle_progress  where date_kyiv > date '2026-08-07') as progress_left,
  (select count(*) from bot_puzzle_winners   where date_kyiv > date '2026-08-07') as winners_left;

commit;
-- rollback;  -- ← якщо числа вище не нульові, виконай це замість commit
