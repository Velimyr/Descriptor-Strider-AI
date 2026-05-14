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
  pending_action           text        not null default '',
  created_at               timestamptz not null default now()
);
-- Міграція для існуючих установок (no-op якщо колонка вже є).
-- pending_action: '' | 'rename' — стан очікування вводу від користувача поза опитуванням.
alter table bot_users add column if not exists pending_action text not null default '';
-- Час, коли користувачу показали онбординг-підказку «З чого складається опис».
-- NULL означає «ще не показували» — наступна дія тригерить показ.
alter table bot_users add column if not exists intro_shown_at timestamptz;

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

-- Collaborative-режим: нові поля для справи.
-- mode = 'parallel' (як зараз, кожен юзер пише власний варіант) | 'collaborative' (один спільний варіант)
alter table bot_cases add column if not exists mode                 text        not null default 'parallel';
alter table bot_cases add column if not exists current_answers      jsonb       not null default '[]'::jsonb;
alter table bot_cases add column if not exists current_author_tg_id text        not null default '';
alter table bot_cases add column if not exists confirmations_count  int         not null default 0;
-- Блокування при видачі справи юзеру (collab-режим). locked_until null = вільна.
alter table bot_cases add column if not exists locked_by_tg_id      text        not null default '';
alter table bot_cases add column if not exists locked_until         timestamptz;
-- updated_at: фіксується при collab-подіях (create/edit/confirm), щоб коректно сортувати експорт.
alter table bot_cases add column if not exists updated_at           timestamptz not null default now();
alter table bot_cases drop constraint if exists bot_cases_mode_check;
alter table bot_cases
  add  constraint bot_cases_mode_check
  check (mode in ('parallel','collaborative'));
create index if not exists idx_cases_mode on bot_cases(mode);
create index if not exists idx_cases_lock on bot_cases(locked_until);

-- Аудит-таблиця для collab-режиму. UNIQUE (case_id, tg_id) гарантує:
-- один юзер = одна дія на справу (create XOR edit XOR confirm).
create table if not exists bot_case_confirmations (
  case_id text        not null,
  tg_id   text        not null,
  kind    text        not null check (kind in ('create','edit','confirm')),
  at      timestamptz not null default now(),
  primary key (case_id, tg_id)
);
create index if not exists idx_confirms_case on bot_case_confirmations(case_id);

-- Снапшот відповідей користувача в момент події (create/edit/confirm).
-- Потрібен для перевірки доброчесності у collab-режимі: без нього старі
-- відповіді губляться, бо bot_cases.current_answers перезаписується при edit.
alter table bot_case_confirmations add column if not exists answers jsonb not null default '[]'::jsonb;

create table if not exists bot_sessions (
  tg_id         text primary key references bot_users(tg_id) on delete cascade,
  case_id       text        not null,
  answers_json  text        not null default '[]',
  current_q     int         not null default 0,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  state         text        not null default 'asking' check (state in ('asking','confirming','editing'))
);

-- Якщо таблиця вже існувала зі старим CHECK — перестворюємо обмеження.
-- Ідемпотентно: безпечно запускати повторно.
alter table bot_sessions drop constraint if exists bot_sessions_state_check;
alter table bot_sessions
  add  constraint bot_sessions_state_check
  check (state in ('asking','confirming','editing','previewing'));

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

-- Справи, від яких користувач відмовився (натиснув "Скасувати" під час опитування).
-- Виключаються при доборі наступної справи цьому користувачу.
create table if not exists bot_skipped (
  tg_id      text        not null,
  case_id    text        not null,
  skipped_at timestamptz not null default now(),
  primary key (tg_id, case_id)
);
create index if not exists idx_skipped_user on bot_skipped(tg_id);

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
alter table bot_skipped      enable row level security;
alter table bot_meta         enable row level security;
alter table bot_case_confirmations enable row level security;

-- Заборонити виконання RPC від імені anon/authenticated.
-- (security definer функція без явного grant не виконається сторонніми ролями.)
revoke all on function bot_inc_daily(text, date) from public, anon, authenticated;

-- Агрегований прогрес опису. Уникає підкачки всіх справ у код.
create or replace function bot_description_progress(p_target int)
returns table (
  archive text,
  fund text,
  opys text,
  earliest_created_at timestamptz,
  total_cases bigint,
  done_cases bigint,
  capped_sum bigint
) language sql security definer as $$
  select
    c.archive, c.fund, c.opys,
    min(c.created_at) as earliest_created_at,
    count(*) as total_cases,
    count(*) filter (
      where c.status = 'done'
         or (c.mode = 'collaborative' and c.confirmations_count >= p_target)
         or (c.mode <> 'collaborative' and c.submissions_count >= p_target)
    ) as done_cases,
    sum(least(
      case when c.mode = 'collaborative' then c.confirmations_count else c.submissions_count end,
      p_target
    )) as capped_sum
  from bot_cases c
  group by c.archive, c.fund, c.opys;
$$;
revoke all on function bot_description_progress(int) from public, anon, authenticated;

-- Кандидати на dispatch: відкриті справи, не заблоковані іншим юзером,
-- де користувач НЕ брав участі (не сабмітив, не пропустив, не торкався в collab).
create or replace function bot_candidate_cases(p_tg_id text)
returns setof bot_cases language sql security definer as $$
  select c.* from bot_cases c
  where c.status = 'open'
    and not exists (select 1 from bot_submissions s where s.case_id = c.case_id and s.tg_id = p_tg_id)
    and not exists (select 1 from bot_skipped sk where sk.case_id = c.case_id and sk.tg_id = p_tg_id)
    and not exists (select 1 from bot_case_confirmations cc where cc.case_id = c.case_id and cc.tg_id = p_tg_id)
    and (
      c.mode <> 'collaborative'
      or c.locked_until is null
      or c.locked_until < now()
      or c.locked_by_tg_id = p_tg_id
    );
$$;
revoke all on function bot_candidate_cases(text) from public, anon, authenticated;
