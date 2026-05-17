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
