-- Web-widget: STAGING-розширення схеми (префікс botdev_).
-- Застосовується ПІСЛЯ schema-dev.sql у тому самому Supabase-проєкті.
-- Скрипт ідемпотентний. Не чіпає prod-таблиці bot_*.
--
-- Модель (детально див. schema-widget-prod.sql):
--   • botdev_partners — партнерські сайти.
--   • botdev_users розширюється колонками source ('tg'|'web') і partner_id.
--   • Поліморфний tg_id як PK: для web — "web:<uuid>", для TG — числовий рядок.

-- ========== botdev_partners ==========
create table if not exists botdev_partners (
  partner_id       text primary key,
  name             text        not null,
  nickname_prefix  text        not null,
  api_key_hash     text        not null,
  allowed_origins  text[]      not null default '{}',
  active           boolean     not null default true,
  created_at       timestamptz not null default now()
);
create index if not exists idx_botdev_partners_api_key_hash on botdev_partners(api_key_hash);

alter table botdev_partners enable row level security;

-- ========== botdev_users: web-розширення ==========
alter table botdev_users add column if not exists source     text not null default 'tg';
alter table botdev_users add column if not exists partner_id text;
alter table botdev_users drop constraint if exists botdev_users_source_check;
alter table botdev_users
  add  constraint botdev_users_source_check
  check (source in ('tg','web'));
alter table botdev_users drop constraint if exists botdev_users_partner_fk;
alter table botdev_users
  add  constraint botdev_users_partner_fk
  foreign key (partner_id) references botdev_partners(partner_id) on delete set null;
create index if not exists idx_botdev_users_source_partner on botdev_users(source, partner_id);

-- ========== customization: тема / колір кнопки / текст кнопки ==========
-- jsonb-обʼєкт. Ключі: theme ('light'|'dark'), buttonColor ('purple'|'blue'|...),
-- buttonText (рядок). Дефолти живуть у віджеті — null означає «використати дефолт».
alter table botdev_partners add column if not exists customization jsonb not null default '{}'::jsonb;

-- ========== botdev_link_codes ==========
-- Одноразові коди для прив'язки web-юзера до TG-акаунту через /start link_<code>.
-- Створюється з widget /link/start, споживається в TG-боті обробником /start.
create table if not exists botdev_link_codes (
  code             text primary key,
  web_tg_id        text        not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  used_at          timestamptz,
  telegram_tg_id   text
);
create index if not exists idx_botdev_link_codes_web on botdev_link_codes(web_tg_id);
alter table botdev_link_codes enable row level security;

-- ========== botdev_merge_users(old, new) ==========
-- Атомарний мерж усього стану юзера p_old_tg_id у p_new_tg_id з правильним
-- розв'язанням PK-конфліктів (skipped, case_confirmations, daily_scores).
-- Submissions/dispatch_log оновлюємо напряму (немає PK на tg_id).
-- bot_cases.locked_by/current_author — оновлюємо. integrity_reviews — теж.
-- Бали додаються, потім старий юзер видаляється (bot_sessions cascades).
create or replace function botdev_merge_users(p_old_tg_id text, p_new_tg_id text)
returns void language plpgsql security definer as $$
declare
  old_points numeric;
begin
  if p_old_tg_id = p_new_tg_id then return; end if;

  -- Submissions: tg_id не PK, простий апдейт. Також підтягуємо новий display_name
  -- щоб не показувати в експортах старий nickname.
  update botdev_submissions s
     set tg_id = p_new_tg_id,
         display_name = coalesce((select display_name from botdev_users where tg_id = p_new_tg_id), s.display_name)
   where s.tg_id = p_old_tg_id;

  -- Skipped: PK (tg_id, case_id). Мердж через INSERT...ON CONFLICT DO NOTHING.
  insert into botdev_skipped (tg_id, case_id, skipped_at)
    select p_new_tg_id, case_id, skipped_at
      from botdev_skipped where tg_id = p_old_tg_id
    on conflict (tg_id, case_id) do nothing;
  delete from botdev_skipped where tg_id = p_old_tg_id;

  -- Case confirmations: PK (case_id, tg_id). Якщо TG-юзер вже торкався тієї ж
  -- справи — лишаємо TG-запис (старший за статусом, скоріш за все).
  insert into botdev_case_confirmations (case_id, tg_id, kind, at, answers)
    select case_id, p_new_tg_id, kind, at, answers
      from botdev_case_confirmations where tg_id = p_old_tg_id
    on conflict (case_id, tg_id) do nothing;
  delete from botdev_case_confirmations where tg_id = p_old_tg_id;

  -- Daily scores: PK (tg_id, date_kyiv). На конфлікт — додаємо лічильники.
  insert into botdev_daily_scores (tg_id, date_kyiv, count)
    select p_new_tg_id, date_kyiv, count
      from botdev_daily_scores where tg_id = p_old_tg_id
    on conflict (tg_id, date_kyiv) do update
      set count = botdev_daily_scores.count + EXCLUDED.count;
  delete from botdev_daily_scores where tg_id = p_old_tg_id;

  -- Dispatch log: tg_id не PK.
  update botdev_dispatch_log set tg_id = p_new_tg_id where tg_id = p_old_tg_id;

  -- Cases: посилання на tg_id у lock/author полях.
  update botdev_cases set locked_by_tg_id      = p_new_tg_id where locked_by_tg_id      = p_old_tg_id;
  update botdev_cases set current_author_tg_id = p_new_tg_id where current_author_tg_id = p_old_tg_id;

  -- Integrity reviews: оновлюємо посилання. PK (case_id, first, second) — рідко
  -- конфліктує (треба щоб TG-юзер вже мав review-пару з тим самим іншим юзером
  -- по тій самій справі). На MVP ігноруємо потенційний дублікат — простий update.
  update botdev_integrity_reviews set first_tg_id     = p_new_tg_id where first_tg_id     = p_old_tg_id;
  update botdev_integrity_reviews set second_tg_id    = p_new_tg_id where second_tg_id    = p_old_tg_id;
  update botdev_integrity_reviews set penalized_tg_id = p_new_tg_id where penalized_tg_id = p_old_tg_id;

  -- Бали: переносимо в TG-юзера.
  select total_points into old_points from botdev_users where tg_id = p_old_tg_id;
  if old_points is not null and old_points <> 0 then
    update botdev_users set total_points = total_points + old_points where tg_id = p_new_tg_id;
  end if;

  -- Видаляємо старого юзера. bot_sessions має ON DELETE CASCADE → автоматично.
  delete from botdev_users where tg_id = p_old_tg_id;
end $$;
revoke all on function botdev_merge_users(text, text) from public, anon, authenticated;

-- ========== botdev_partner_stats(from, to) ==========
-- Скільки справ юзери кожного партнера обробили за період [p_from, p_to].
-- Рахуємо submissions (parallel) + case_confirmations (collab create/edit/confirm).
-- Один рядок на партнера, навіть якщо нуль активності.
create or replace function botdev_partner_stats(p_from timestamptz, p_to timestamptz)
returns table(partner_id text, submissions bigint, confirmations bigint)
language sql security definer as $$
  with web_users as (
    select tg_id, partner_id from botdev_users where source = 'web' and partner_id is not null
  ),
  subs as (
    select wu.partner_id, count(*)::bigint as c
    from botdev_submissions s
    join web_users wu on wu.tg_id = s.tg_id
    where s.submitted_at >= p_from and s.submitted_at < p_to
    group by wu.partner_id
  ),
  cons as (
    select wu.partner_id, count(*)::bigint as c
    from botdev_case_confirmations cc
    join web_users wu on wu.tg_id = cc.tg_id
    where cc.at >= p_from and cc.at < p_to
    group by wu.partner_id
  )
  select p.partner_id,
         coalesce(subs.c, 0)::bigint as submissions,
         coalesce(cons.c, 0)::bigint as confirmations
  from botdev_partners p
  left join subs on subs.partner_id = p.partner_id
  left join cons on cons.partner_id = p.partner_id
  order by (coalesce(subs.c, 0) + coalesce(cons.c, 0)) desc;
$$;
revoke all on function botdev_partner_stats(timestamptz, timestamptz) from public, anon, authenticated;
