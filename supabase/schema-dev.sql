-- Telegram-бот: STAGING-схема (префікс botdev_) для Supabase.
-- Запускається в тому ж проєкті, що й prod schema.sql. Не чіпає таблиці bot_*.
-- Скрипт ідемпотентний.

create table if not exists botdev_users (
  tg_id                    text primary key,
  display_name             text        not null default '',
  total_points             numeric     not null default 0,
  last_dispatched_case_id  text        not null default '',
  last_dispatched_at       timestamptz,
  consecutive_misses       int         not null default 0,
  status                   text        not null default 'active' check (status in ('active','paused')),
  pending_action           text        not null default '',
  created_at               timestamptz not null default now()
);
alter table botdev_users add column if not exists pending_action text not null default '';

create table if not exists botdev_cases (
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
alter table botdev_cases add column if not exists archive text not null default '';
alter table botdev_cases add column if not exists fund    text not null default '';
alter table botdev_cases add column if not exists opys    text not null default '';
alter table botdev_cases add column if not exists sprava  text not null default '';
create index if not exists idx_botdev_cases_status on botdev_cases(status);
create index if not exists idx_botdev_cases_count  on botdev_cases(submissions_count);

-- Collaborative-режим: нові поля для справи.
-- mode = 'parallel' (як зараз, кожен юзер пише власний варіант) | 'collaborative' (один спільний варіант)
alter table botdev_cases add column if not exists mode                 text        not null default 'parallel';
alter table botdev_cases add column if not exists current_answers      jsonb       not null default '[]'::jsonb;
alter table botdev_cases add column if not exists current_author_tg_id text        not null default '';
alter table botdev_cases add column if not exists confirmations_count  int         not null default 0;
-- Блокування при видачі справи юзеру (collab-режим). locked_until null = вільна.
alter table botdev_cases add column if not exists locked_by_tg_id      text        not null default '';
alter table botdev_cases add column if not exists locked_until         timestamptz;
-- updated_at: фіксується при collab-подіях (create/edit/confirm), щоб коректно сортувати експорт.
alter table botdev_cases add column if not exists updated_at           timestamptz not null default now();
alter table botdev_cases drop constraint if exists botdev_cases_mode_check;
alter table botdev_cases
  add  constraint botdev_cases_mode_check
  check (mode in ('parallel','collaborative'));
create index if not exists idx_botdev_cases_mode on botdev_cases(mode);
create index if not exists idx_botdev_cases_lock on botdev_cases(locked_until);

-- Аудит-таблиця для collab-режиму. UNIQUE (case_id, tg_id) гарантує:
-- один юзер = одна дія на справу (create XOR edit XOR confirm).
create table if not exists botdev_case_confirmations (
  case_id text        not null,
  tg_id   text        not null,
  kind    text        not null check (kind in ('create','edit','confirm')),
  at      timestamptz not null default now(),
  primary key (case_id, tg_id)
);
create index if not exists idx_botdev_confirms_case on botdev_case_confirmations(case_id);

create table if not exists botdev_sessions (
  tg_id         text primary key references botdev_users(tg_id) on delete cascade,
  case_id       text        not null,
  answers_json  text        not null default '[]',
  current_q     int         not null default 0,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  state         text        not null default 'asking' check (state in ('asking','confirming','editing'))
);

alter table botdev_sessions drop constraint if exists botdev_sessions_state_check;
alter table botdev_sessions
  add  constraint botdev_sessions_state_check
  check (state in ('asking','confirming','editing','previewing'));

create table if not exists botdev_submissions (
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
create index if not exists idx_botdev_subs_case on botdev_submissions(case_id);
create index if not exists idx_botdev_subs_user on botdev_submissions(tg_id);
alter table botdev_submissions add column if not exists archive    text not null default '';
alter table botdev_submissions add column if not exists fund       text not null default '';
alter table botdev_submissions add column if not exists opys       text not null default '';
alter table botdev_submissions add column if not exists sprava     text not null default '';
alter table botdev_submissions add column if not exists source_pdf text not null default '';
alter table botdev_submissions add column if not exists page       text not null default '';

create table if not exists botdev_daily_scores (
  tg_id      text not null,
  date_kyiv  date not null,
  count      int  not null default 0,
  primary key (tg_id, date_kyiv)
);

create table if not exists botdev_dispatch_log (
  id       bigserial primary key,
  tg_id    text        not null,
  case_id  text        not null,
  sent_at  timestamptz not null default now()
);
create index if not exists idx_botdev_dispatch_user on botdev_dispatch_log(tg_id);

create table if not exists botdev_skipped (
  tg_id      text        not null,
  case_id    text        not null,
  skipped_at timestamptz not null default now(),
  primary key (tg_id, case_id)
);
create index if not exists idx_botdev_skipped_user on botdev_skipped(tg_id);

create table if not exists botdev_meta (
  key   text primary key,
  value text not null default ''
);

create or replace function botdev_inc_daily(p_tg_id text, p_date date)
returns int language plpgsql security definer as $$
declare new_count int;
begin
  insert into botdev_daily_scores (tg_id, date_kyiv, count)
  values (p_tg_id, p_date, 1)
  on conflict (tg_id, date_kyiv) do update set count = botdev_daily_scores.count + 1
  returning count into new_count;
  return new_count;
end $$;

-- RLS: ті самі правила, що  й на  проді — service_role обходить, інші ролі не мають доступу.
alter table botdev_users        enable row level security;
alter table botdev_cases        enable row level security;
alter table botdev_sessions     enable row level security;
alter table botdev_submissions  enable row level security;
alter table botdev_daily_scores enable row level security;
alter table botdev_dispatch_log enable row level security;
alter table botdev_skipped      enable row level security;
alter table botdev_meta         enable row level security;
alter table botdev_case_confirmations enable row level security;

revoke all on function botdev_inc_daily(text, date) from public, anon, authenticated;
