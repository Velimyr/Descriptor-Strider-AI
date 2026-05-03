-- Telegram-бот: схема для Supabase.
-- Запустіть один раз у Supabase → SQL Editor → New query → Paste → Run.
-- Скрипт ідемпотентний: можна запускати повторно після правок.

create table if not exists bot_users (
  tg_id                    text primary key,
  display_name             text        not null default '',
  total_points             numeric     not null default 0,
  last_dispatched_case_id  text        not null default '',
  last_dispatched_at       timestamptz,
  consecutive_misses       int         not null default 0,
  status                   text        not null default 'active' check (status in ('active','paused')),
  created_at               timestamptz not null default now()
);

create table if not exists bot_cases (
  case_id            text primary key,
  tg_file_id         text        not null,
  tg_chat_id         text        not null,
  tg_message_id      text        not null,
  source_pdf         text        not null default '',
  page               text        not null default '',
  bbox               text        not null default '',
  archive            text        not null default '',
  fund               text        not null default '',
  opys               text        not null default '',
  sprava             text        not null default '',
  submissions_count  int         not null default 0,
  status             text        not null default 'open' check (status in ('open','done')),
  created_at         timestamptz not null default now()
);
-- Міграція для існуючих установок (no-op якщо колонки вже є)
alter table bot_cases add column if not exists archive text not null default '';
alter table bot_cases add column if not exists fund    text not null default '';
alter table bot_cases add column if not exists opys    text not null default '';
alter table bot_cases add column if not exists sprava  text not null default '';
create index if not exists idx_cases_status on bot_cases(status);
create index if not exists idx_cases_count  on bot_cases(submissions_count);

create table if not exists bot_sessions (
  tg_id         text primary key references bot_users(tg_id) on delete cascade,
  case_id       text        not null,
  answers_json  text        not null default '[]',
  current_q     int         not null default 0,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  state         text        not null default 'asking' check (state in ('asking','confirming'))
);

-- Підтверджені відповіді. answers — jsonb-масив у тому самому порядку, що bot_meta.questions.
-- Метадані справи (archive/fund/opys/sprava/source_pdf/page) денормалізовані сюди,
-- щоб «Результати» були самодостатні навіть якщо bot_cases поправлять/чистять.
create table if not exists bot_submissions (
  id            bigserial primary key,
  case_id       text        not null,
  tg_id         text        not null,
  display_name  text        not null default '',
  submitted_at  timestamptz not null default now(),
  answers       jsonb       not null default '[]'::jsonb,
  source_link   text        not null default '',
  archive       text        not null default '',
  fund          text        not null default '',
  opys          text        not null default '',
  sprava        text        not null default '',
  source_pdf    text        not null default '',
  page          text        not null default ''
);
create index if not exists idx_subs_case on bot_submissions(case_id);
create index if not exists idx_subs_user on bot_submissions(tg_id);
-- Міграція для існуючих установок
alter table bot_submissions add column if not exists archive    text not null default '';
alter table bot_submissions add column if not exists fund       text not null default '';
alter table bot_submissions add column if not exists opys       text not null default '';
alter table bot_submissions add column if not exists sprava     text not null default '';
alter table bot_submissions add column if not exists source_pdf text not null default '';
alter table bot_submissions add column if not exists page       text not null default '';

create table if not exists bot_daily_scores (
  tg_id      text not null,
  date_kyiv  date not null,
  count      int  not null default 0,
  primary key (tg_id, date_kyiv)
);

create table if not exists bot_dispatch_log (
  id       bigserial primary key,
  tg_id    text        not null,
  case_id  text        not null,
  sent_at  timestamptz not null default now()
);
create index if not exists idx_dispatch_user on bot_dispatch_log(tg_id);

create table if not exists bot_meta (
  key   text primary key,
  value text not null default ''
);

-- Атомарна функція "інкремент денного лічильника" (повертає нове значення).
create or replace function bot_inc_daily(p_tg_id text, p_date date)
returns int language plpgsql security definer as $$
declare new_count int;
begin
  insert into bot_daily_scores (tg_id, date_kyiv, count)
  values (p_tg_id, p_date, 1)
  on conflict (tg_id, date_kyiv) do update set count = bot_daily_scores.count + 1
  returning count into new_count;
  return new_count;
end $$;

-- ========== ROW LEVEL SECURITY ==========
-- Вмикаємо RLS на всіх таблицях БЕЗ створення policies.
-- Це означає: anon і authenticated клієнти НЕ мають жодного доступу.
-- Бекенд бота використовує service_role key — він обходить RLS і працює як зазвичай.
-- Якщо колись захочете дати фронтенду прямий read-only доступ до агрегованих даних —
-- додавайте конкретні policies для anon/authenticated тут.

alter table bot_users        enable row level security;
alter table bot_cases        enable row level security;
alter table bot_sessions     enable row level security;
alter table bot_submissions  enable row level security;
alter table bot_daily_scores enable row level security;
alter table bot_dispatch_log enable row level security;
alter table bot_meta         enable row level security;

-- Заборонити виконання RPC від імені anon/authenticated.
-- (security definer функція без явного grant не виконається сторонніми ролями.)
revoke all on function bot_inc_daily(text, date) from public, anon, authenticated;
