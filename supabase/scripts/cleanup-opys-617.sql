-- Одноразове видалення опису ЦДІАК 442/617 перед повторним завантаженням.
--
-- Стан на 2026-11-15: 17 справ (стор. 4–5), залиті 2026-11-14 08:09–08:10 UTC,
-- жодної відповіді, підтверджень, сесій, пропусків чи записів розсилки.
-- Guard-и нижче зупиняють скрипт, якщо хтось уже встиг почати роботу з опису.
--
-- Запуск: увесь файл одним шматком (SQL Editor). Будь-який guard → RAISE → ROLLBACK.

begin;

create temp table _del on commit drop as
select case_id
from bot_cases
where archive = 'ЦДІАК' and fund = '442' and opys = '617';

do $$
declare v_n int; v_work int; v_conf int; v_subs int; v_sess int;
begin
  select count(*) into v_n from _del;
  if v_n <> 17 then
    raise exception 'Очікувалось 17 справ опису 617, знайдено % — перевір, чи не почали заливати повторно', v_n;
  end if;

  select count(*) into v_work from bot_cases
  where case_id in (select case_id from _del)
    and (jsonb_array_length(current_answers) > 0 or status = 'done' or locked_by_tg_id <> '');
  if v_work > 0 then
    raise exception 'Справи вже в роботі (відповіді/закриті/залочені): %', v_work;
  end if;

  select count(*) into v_conf from bot_case_confirmations where case_id in (select case_id from _del);
  select count(*) into v_subs from bot_submissions        where case_id in (select case_id from _del);
  select count(*) into v_sess from bot_sessions           where case_id in (select case_id from _del);
  if v_conf + v_subs + v_sess > 0 then
    raise exception 'Є пов''язані дані: confirmations=%, submissions=%, sessions=%', v_conf, v_subs, v_sess;
  end if;
end $$;

delete from bot_skipped      where case_id in (select case_id from _del);
delete from bot_dispatch_log where case_id in (select case_id from _del);
update bot_users set last_dispatched_case_id = ''
where last_dispatched_case_id in (select case_id from _del);

delete from bot_cases where case_id in (select case_id from _del);

do $$
declare v_left int;
begin
  select count(*) into v_left from bot_cases
  where archive = 'ЦДІАК' and fund = '442' and opys = '617';
  if v_left <> 0 then
    raise exception 'Після видалення лишилось % справ опису 617', v_left;
  end if;
  raise notice 'OK: опис 617 видалено, можна заливати повторно';
end $$;

commit;
