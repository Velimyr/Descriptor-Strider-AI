-- ============================================================================
-- Одноразовий seed місячного рейтингу: перенести наявні total_points у поточний
-- (київський) місяць. Запусти ОДИН раз після міграції bot_monthly_points.
-- Ідемпотентно: on conflict do nothing — повторний запуск нічого не змінить.
-- Для staging заміни bot_ на botdev_.
-- ============================================================================

insert into bot_monthly_points (month, tg_id, points, display_name)
select to_char((now() at time zone 'Europe/Kyiv'), 'YYYY-MM'),
       tg_id,
       total_points,
       display_name
from bot_users
where total_points <> 0
on conflict (month, tg_id) do nothing;
