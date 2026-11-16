-- Одноразове очищення опису ЦДІАК 442/599 від дублів повторного завантаження.
--
-- Що сталося: опис уперше залили 2026-10-20 (355 справ, сторінки 6–41, усі вже
-- status='done'). 2026-11-11 о 20:26:49 UTC його залили ще раз з трохи іншою
-- розміткою (ще 355 справ на тих самих сторінках). Друга партія — повний дубль.
--
-- Що видаляємо: ВСЮ другу партію (created_at >= 2026-11-11 20:26:49):
--   * 351 справа без жодної відповіді (open, current_answers = []);
--   * 4 справи, які встигли розпізнати, але це дублі вже готових справ стор. 6:
--       d28a2de150374ae586317cc9884bbf9b  «1»   (done)  ↔ стара 853ff0f3… «1»
--       3f5460208cae4371baf099813f47ee3b  «1 а» (done)  ↔ стара 30c9ad72… «1а»
--       0090492e2eee4d879da89fc75059661a  «1б»  (open)  ↔ стара de556666… «16»(=1б)
--       f80848b3656e476fab5cbac2b80d52c6  «1в»  (open)  ↔ стара 1a195a08… «1в»
-- Перша партія (2026-10-20) НЕ чіпається — фільтр за created_at + guard-и нижче.
--
-- Бали:
--   * confirmed/confirm-рядки в bot_case_confirmations (вже нараховані бали) лишаємо
--     як історію — bot_users.total/місячні бали не змінюються;
--   * 2 рядки 'unconfirmed' (по 3 бали, ще не нараховані) видаляємо: справа-дубль
--     ніколи не закриється, тож вони висіли б «в очікуванні» назавжди.
--
-- Запуск: увесь файл одним шматком (SQL Editor). Будь-який guard → RAISE → ROLLBACK.

begin;

-- 0. Партія-дубль у тимчасову таблицю.
create temp table _dup on commit drop as
select case_id, status, jsonb_array_length(current_answers) as n_answers
from bot_cases
where archive = 'ЦДІАК' and fund = '442' and opys = '599'
  and created_at >= '2026-11-11 20:26:49+00';

-- 1. Guard-и: якщо стан БД не той, що очікуємо — нічого не видаляємо.
do $$
declare
  v_dup        int;
  v_dup_work   int;
  v_old        int;
  v_old_notdone int;
  v_subs       int;
  v_sess       int;
begin
  select count(*) into v_dup from _dup;
  if v_dup <> 355 then
    raise exception 'Очікувалось 355 справ у партії-дублі, знайдено %', v_dup;
  end if;

  -- Розпізнані/закриті серед дублів — рівно ті 4, що перевірені вручну.
  select count(*) into v_dup_work from _dup
  where (n_answers > 0 or status = 'done')
    and case_id not in ('d28a2de150374ae586317cc9884bbf9b','3f5460208cae4371baf099813f47ee3b',
                        '0090492e2eee4d879da89fc75059661a','f80848b3656e476fab5cbac2b80d52c6');
  if v_dup_work > 0 then
    raise exception 'З''явились нові розпізнані справи в партії-дублі (%), перевір вручну', v_dup_work;
  end if;

  -- Основна партія: 355 справ, усі done (її і зберігаємо).
  select count(*), count(*) filter (where status <> 'done') into v_old, v_old_notdone
  from bot_cases
  where archive = 'ЦДІАК' and fund = '442' and opys = '599'
    and created_at < '2026-11-11 20:26:49+00';
  if v_old <> 355 or v_old_notdone <> 0 then
    raise exception 'Основна партія не та: % справ, не done: %', v_old, v_old_notdone;
  end if;

  select count(*) into v_subs from bot_submissions where case_id in (select case_id from _dup);
  if v_subs > 0 then
    raise exception 'На справах-дублях є bot_submissions (%), перевір вручну', v_subs;
  end if;

  -- Хтось саме зараз розпізнає справу-дубль — краще перезапустити пізніше.
  select count(*) into v_sess from bot_sessions where case_id in (select case_id from _dup);
  if v_sess > 0 then
    raise exception 'Є активні сесії на справах-дублях (%), запусти пізніше', v_sess;
  end if;
end $$;

-- 2. Залежні дані.
delete from bot_case_confirmations
where case_id in (select case_id from _dup) and points_status = 'unconfirmed';

delete from bot_skipped     where case_id in (select case_id from _dup);
delete from bot_dispatch_log where case_id in (select case_id from _dup);

update bot_users set last_dispatched_case_id = ''
where last_dispatched_case_id in (select case_id from _dup);

-- 3. Самі справи.
delete from bot_cases where case_id in (select case_id from _dup);

-- 4. Контроль: має лишитись рівно 355 справ опису, усі з першої партії.
do $$
declare v_left int; v_new int;
begin
  select count(*), count(*) filter (where created_at >= '2026-11-11 20:26:49+00')
    into v_left, v_new
  from bot_cases where archive = 'ЦДІАК' and fund = '442' and opys = '599';
  if v_left <> 355 or v_new <> 0 then
    raise exception 'Після очищення: % справ, з них нових %', v_left, v_new;
  end if;
  raise notice 'OK: опис 599 — % справ, дублі видалено', v_left;
end $$;

commit;
