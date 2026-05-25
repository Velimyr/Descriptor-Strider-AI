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
-- Час показу онбординг-підказки «З чого складається опис».
alter table botdev_users add column if not exists intro_shown_at timestamptz;
-- Час "засіву" бейджів (див. коментар у schema.sql). NULL = тиха видача на першій перевірці.
alter table botdev_users add column if not exists badges_seeded_at timestamptz;

create table if not exists botdev_integrity_reviews (
  case_id          text        not null,
  first_tg_id      text        not null,
  second_tg_id     text        not null,
  action           text        not null check (action in ('penalized','dismissed')),
  penalized_tg_id  text,
  at               timestamptz not null default now(),
  primary key (case_id, first_tg_id, second_tg_id)
);
create index if not exists idx_botdev_integrity_reviews_case on botdev_integrity_reviews(case_id);

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

-- Снапшот відповідей користувача в момент події (create/edit/confirm).
-- Потрібен для перевірки доброчесності у collab-режимі: без нього старі
-- відповіді губляться, бо botdev_cases.current_answers перезаписується при edit.
alter table botdev_case_confirmations add column if not exists answers jsonb not null default '[]'::jsonb;

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

-- Місячний рейтинг (staging).
create table if not exists botdev_monthly_points (
  month        text    not null,
  tg_id        text    not null,
  points       numeric not null default 0,
  display_name text    not null default '',
  primary key (month, tg_id)
);
create index if not exists idx_botdev_monthly_points on botdev_monthly_points(month, points desc);

create table if not exists botdev_dispatch_log (
  id       bigserial primary key,
  tg_id    text        not null,
  case_id  text        not null,
  sent_at  timestamptz not null default now()
);
create index if not exists idx_botdev_dispatch_user on botdev_dispatch_log(tg_id);

-- Отримані бейджі (досягнення). PK (tg_id, badge_id) → «один раз і назавжди».
create table if not exists botdev_user_badges (
  tg_id      text        not null,
  badge_id   text        not null,
  earned_at  timestamptz not null default now(),
  primary key (tg_id, badge_id)
);
create index if not exists idx_botdev_user_badges_user on botdev_user_badges(tg_id);

-- ===== Описовий пазл (гра «слово дня») — staging =====
create table if not exists botdev_puzzles (
  date_kyiv  date primary key,
  sentence   text        not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists botdev_puzzle_progress (
  date_kyiv    date        not null,
  tg_id        text        not null,
  word         text        not null,
  status       text        not null default 'unconfirmed' check (status in ('unconfirmed','confirmed')),
  case_id      text        not null default '',
  collected_at timestamptz not null default now(),
  confirmed_at timestamptz,
  primary key (date_kyiv, tg_id, word)
);
create index if not exists idx_botdev_puzzle_progress_day  on botdev_puzzle_progress(date_kyiv);
create index if not exists idx_botdev_puzzle_progress_case on botdev_puzzle_progress(case_id);

create table if not exists botdev_puzzle_winners (
  date_kyiv  date        not null,
  place      int         not null check (place between 1 and 3),
  tg_id      text        not null,
  points     int         not null default 0,
  awarded_at timestamptz not null default now(),
  primary key (date_kyiv, place),
  unique (date_kyiv, tg_id)
);

alter table botdev_puzzles         enable row level security;
alter table botdev_puzzle_progress enable row level security;
alter table botdev_puzzle_winners  enable row level security;

create or replace function botdev_award_puzzle_winner(p_date date, p_tg_id text)
returns table(place int, points int) language plpgsql security definer as $$
declare
  v_count  int;
  v_place  int;
  v_points int;
begin
  perform pg_advisory_xact_lock(hashtext('botdev_puzzle:' || p_date::text));
  if exists (select 1 from botdev_puzzle_winners w where w.date_kyiv = p_date and w.tg_id = p_tg_id) then
    return;
  end if;
  select count(*) into v_count from botdev_puzzle_winners w where w.date_kyiv = p_date;
  if v_count >= 3 then
    return;
  end if;
  v_place  := v_count + 1;
  v_points := case v_place when 1 then 1000 when 2 then 500 when 3 then 300 else 0 end;
  insert into botdev_puzzle_winners(date_kyiv, place, tg_id, points)
    values (p_date, v_place, p_tg_id, v_points);
  return query select v_place, v_points;
end $$;
revoke all on function botdev_award_puzzle_winner(date, text) from public, anon, authenticated;

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
alter table botdev_integrity_reviews  enable row level security;
alter table botdev_user_badges        enable row level security;
alter table botdev_monthly_points     enable row level security;

revoke all on function botdev_inc_daily(text, date) from public, anon, authenticated;

create or replace function botdev_inc_monthly(p_month text, p_tg_id text, p_delta numeric, p_name text)
returns numeric language plpgsql security definer as $$
declare v numeric;
begin
  insert into botdev_monthly_points (month, tg_id, points, display_name)
  values (p_month, p_tg_id, p_delta, coalesce(p_name, ''))
  on conflict (month, tg_id) do update
    set points = botdev_monthly_points.points + p_delta,
        display_name = excluded.display_name
  returning points into v;
  return v;
end $$;
revoke all on function botdev_inc_monthly(text, text, numeric, text) from public, anon, authenticated;

create or replace function botdev_monthly_months()
returns table (month text) language sql security definer as $$
  select distinct month from botdev_monthly_points order by month desc;
$$;
revoke all on function botdev_monthly_months() from public, anon, authenticated;

-- Агрегований прогрес опису. Уникає підкачки всіх справ у код.
create or replace function botdev_description_progress(p_target int)
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
  from botdev_cases c
  group by c.archive, c.fund, c.opys;
$$;
revoke all on function botdev_description_progress(int) from public, anon, authenticated;

-- Кандидати на dispatch: відкриті справи, не заблоковані іншим юзером,
-- де користувач НЕ брав участі (не сабмітив, не пропустив, не торкався в collab).
-- ORDER BY обов'язковий: PostgREST обрізає відповідь до db_max_rows (~1000),
-- і без сортування старіші описи можуть випадати з вибірки → шедулер їх "не бачить".
create or replace function botdev_candidate_cases(p_tg_id text)
returns setof botdev_cases language sql security definer as $$
  select c.* from botdev_cases c
  where c.status = 'open'
    and not exists (select 1 from botdev_submissions s where s.case_id = c.case_id and s.tg_id = p_tg_id)
    and not exists (select 1 from botdev_skipped sk where sk.case_id = c.case_id and sk.tg_id = p_tg_id)
    and not exists (select 1 from botdev_case_confirmations cc where cc.case_id = c.case_id and cc.tg_id = p_tg_id)
    and (
      c.mode <> 'collaborative'
      or c.locked_until is null
      or c.locked_until < now()
      or c.locked_by_tg_id = p_tg_id
    )
  order by c.created_at, c.case_id;
$$;
revoke all on function botdev_candidate_cases(text) from public, anon, authenticated;
