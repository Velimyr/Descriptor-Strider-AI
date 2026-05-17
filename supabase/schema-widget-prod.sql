-- Web-widget: розширення схеми для підтримки сторонніх сайтів-партнерів.
-- Застосовуйте ПІСЛЯ schema.sql. Скрипт ідемпотентний.
--
-- Модель:
--   • bot_partners — список партнерських сайтів з API-ключами та allowed_origins.
--   • bot_users розширюється колонками source ('tg'|'web') і partner_id.
--   • Поліморфний tg_id як PK залишається: для web-юзерів формат "web:<uuid>",
--     для TG — числовий рядок як зараз. Завдяки цьому всі referencing-таблиці
--     (bot_sessions, bot_submissions, bot_skipped, bot_case_confirmations,
--     bot_daily_scores, bot_dispatch_log) і всі RPC (bot_inc_daily,
--     bot_candidate_cases, bot_description_progress) працюють без змін.

-- ========== bot_partners ==========
-- partner_id: kebab-case slug, який також підставляється в anonymous nickname.
-- api_key_hash: sha256(plaintext_key). Plaintext генерується нами, високоентропійний,
--   тож SHA256 без bcrypt безпечний (немає словникових атак).
-- allowed_origins: точні рядки origin (https://example.org). Без wildcard у MVP.
create table if not exists bot_partners (
  partner_id       text primary key,
  name             text        not null,
  nickname_prefix  text        not null,
  api_key_hash     text        not null,
  allowed_origins  text[]      not null default '{}',
  active           boolean     not null default true,
  created_at       timestamptz not null default now()
);
create index if not exists idx_partners_api_key_hash on bot_partners(api_key_hash);

alter table bot_partners enable row level security;

-- ========== bot_users: web-розширення ==========
-- source: 'tg' (існуючі) | 'web' (з віджета). Дефолт 'tg' — для backward compat.
-- partner_id: FK на bot_partners для web-юзерів. NULL для tg.
alter table bot_users add column if not exists source     text not null default 'tg';
alter table bot_users add column if not exists partner_id text;
alter table bot_users drop constraint if exists bot_users_source_check;
alter table bot_users
  add  constraint bot_users_source_check
  check (source in ('tg','web'));
-- FK без CASCADE: якщо партнера видалили — лишаємо юзерів-сиріт зі статою.
alter table bot_users drop constraint if exists bot_users_partner_fk;
alter table bot_users
  add  constraint bot_users_partner_fk
  foreign key (partner_id) references bot_partners(partner_id) on delete set null;
create index if not exists idx_users_source_partner on bot_users(source, partner_id);

-- ========== customization: тема / колір кнопки / текст кнопки ==========
-- jsonb-обʼєкт. Ключі: theme ('light'|'dark'), buttonColor (один із пресетів),
-- buttonText (рядок). Дефолти живуть у віджеті.
alter table bot_partners add column if not exists customization jsonb not null default '{}'::jsonb;

-- ========== bot_link_codes ==========
-- Одноразові коди для прив'язки web-юзера до TG-акаунту.
create table if not exists bot_link_codes (
  code             text primary key,
  web_tg_id        text        not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  used_at          timestamptz,
  telegram_tg_id   text
);
create index if not exists idx_link_codes_web on bot_link_codes(web_tg_id);
alter table bot_link_codes enable row level security;

-- ========== bot_merge_users(old, new) ==========
-- Атомарний мерж усього стану юзера в одну транзакцію.
-- Конфлікти по PK розв'язуються INSERT...ON CONFLICT (skipped, case_confirmations,
-- daily_scores). Бали додаються, старий юзер видаляється.
create or replace function bot_merge_users(p_old_tg_id text, p_new_tg_id text)
returns void language plpgsql security definer as $$
declare
  old_points numeric;
begin
  if p_old_tg_id = p_new_tg_id then return; end if;

  update bot_submissions s
     set tg_id = p_new_tg_id,
         display_name = coalesce((select display_name from bot_users where tg_id = p_new_tg_id), s.display_name)
   where s.tg_id = p_old_tg_id;

  insert into bot_skipped (tg_id, case_id, skipped_at)
    select p_new_tg_id, case_id, skipped_at
      from bot_skipped where tg_id = p_old_tg_id
    on conflict (tg_id, case_id) do nothing;
  delete from bot_skipped where tg_id = p_old_tg_id;

  insert into bot_case_confirmations (case_id, tg_id, kind, at, answers, partner_id)
    select case_id, p_new_tg_id, kind, at, answers, partner_id
      from bot_case_confirmations where tg_id = p_old_tg_id
    on conflict (case_id, tg_id) do nothing;
  delete from bot_case_confirmations where tg_id = p_old_tg_id;

  insert into bot_daily_scores (tg_id, date_kyiv, count)
    select p_new_tg_id, date_kyiv, count
      from bot_daily_scores where tg_id = p_old_tg_id
    on conflict (tg_id, date_kyiv) do update
      set count = bot_daily_scores.count + EXCLUDED.count;
  delete from bot_daily_scores where tg_id = p_old_tg_id;

  update bot_dispatch_log set tg_id = p_new_tg_id where tg_id = p_old_tg_id;

  update bot_cases set locked_by_tg_id      = p_new_tg_id where locked_by_tg_id      = p_old_tg_id;
  update bot_cases set current_author_tg_id = p_new_tg_id where current_author_tg_id = p_old_tg_id;

  update bot_integrity_reviews set first_tg_id     = p_new_tg_id where first_tg_id     = p_old_tg_id;
  update bot_integrity_reviews set second_tg_id    = p_new_tg_id where second_tg_id    = p_old_tg_id;
  update bot_integrity_reviews set penalized_tg_id = p_new_tg_id where penalized_tg_id = p_old_tg_id;

  select total_points into old_points from bot_users where tg_id = p_old_tg_id;
  if old_points is not null and old_points <> 0 then
    update bot_users set total_points = total_points + old_points where tg_id = p_new_tg_id;
  end if;

  delete from bot_users where tg_id = p_old_tg_id;
end $$;
revoke all on function bot_merge_users(text, text) from public, anon, authenticated;

-- ========== Denormalized partner_id у submissions / case_confirmations ==========
-- Зберігає атрибуцію партнера навіть після того, як юзер злив web-акаунт з TG.
alter table bot_submissions        add column if not exists partner_id text;
alter table bot_case_confirmations add column if not exists partner_id text;
create index if not exists idx_submissions_partner        on bot_submissions(partner_id) where partner_id is not null;
create index if not exists idx_case_confirmations_partner on bot_case_confirmations(partner_id) where partner_id is not null;

-- Backfill для існуючих рядків (виконається один раз; повторні запуски — no-op).
update bot_submissions s
   set partner_id = u.partner_id
  from bot_users u
 where s.tg_id = u.tg_id
   and u.source = 'web'
   and u.partner_id is not null
   and s.partner_id is null;

update bot_case_confirmations c
   set partner_id = u.partner_id
  from bot_users u
 where c.tg_id = u.tg_id
   and u.source = 'web'
   and u.partner_id is not null
   and c.partner_id is null;

-- ========== bot_partner_stats(from, to) ==========
-- Скільки справ юзери кожного партнера обробили за період [p_from, p_to).
create or replace function bot_partner_stats(p_from timestamptz, p_to timestamptz)
returns table(partner_id text, submissions bigint, confirmations bigint)
language sql security definer as $$
  with subs as (
    select s.partner_id, count(*)::bigint as c
    from bot_submissions s
    where s.partner_id is not null
      and s.submitted_at >= p_from and s.submitted_at < p_to
    group by s.partner_id
  ),
  cons as (
    select c.partner_id, count(*)::bigint as c
    from bot_case_confirmations c
    where c.partner_id is not null
      and c.at >= p_from and c.at < p_to
    group by c.partner_id
  )
  select p.partner_id,
         coalesce(subs.c, 0)::bigint as submissions,
         coalesce(cons.c, 0)::bigint as confirmations
  from bot_partners p
  left join subs on subs.partner_id = p.partner_id
  left join cons on cons.partner_id = p.partner_id
  order by (coalesce(subs.c, 0) + coalesce(cons.c, 0)) desc;
$$;
revoke all on function bot_partner_stats(timestamptz, timestamptz) from public, anon, authenticated;
