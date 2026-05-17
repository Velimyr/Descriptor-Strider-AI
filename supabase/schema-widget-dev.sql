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
