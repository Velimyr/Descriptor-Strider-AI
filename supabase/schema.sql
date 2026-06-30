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
-- Час "засіву" бейджів. NULL = існуючий до фічі користувач: на першій перевірці
-- вже зароблені бейджі видаються ТИХО (без вітань), щоб не спамити ретро-сповіщеннями.
-- Новим користувачам бот ставить це поле одразу при /start, тож їхні справжні
-- досягнення сповіщаються нормально.
alter table bot_users add column if not exists badges_seeded_at timestamptz;
-- Бан користувача ("Перевірка доброчесності"). Заблокований не може виконати жодну
-- дію — бот і веб повертають йому texts.bannedNotice замість обробки. Бан за tg_id;
-- для web-юзерів tg_id="web:<uuid>" з унікальним display_name, тож рядок банить і нік.
alter table bot_users add column if not exists banned     boolean     not null default false;
alter table bot_users add column if not exists ban_reason text;
alter table bot_users add column if not exists banned_at  timestamptz;
alter table bot_users add column if not exists banned_by  text;

-- BYOK: зашифрований JSON-масив Gemini API ключів користувача (AES-256-GCM, base64).
-- Бот розпізнає справи ключами користувача з ротацією. NULL = ключів немає.
alter table bot_users add column if not exists gemini_keys_enc text;

-- Які справи надсилати: all | recognition | verification. Діє на «Нова справа» і розсилку.
alter table bot_users add column if not exists case_filter text not null default 'all';

-- Журнал рішень адміна по парах різночитань ("Перевірка доброчесності").
-- Пара ідентифікується справою + двома tg_id у відсортованому порядку (щоб
-- (A,B) і (B,A) трактувались як одна пара). action: penalized — комусь зняли бали;
-- dismissed — адмін свідомо пропустив пару без штрафу.
create table if not exists bot_integrity_reviews (
  case_id          text        not null,
  first_tg_id      text        not null,
  second_tg_id     text        not null,
  action           text        not null check (action in ('penalized','dismissed')),
  penalized_tg_id  text,
  at               timestamptz not null default now(),
  primary key (case_id, first_tg_id, second_tg_id)
);
create index if not exists idx_integrity_reviews_case on bot_integrity_reviews(case_id);

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
-- За tg_id PK покривав погано (case_id перший), і `getLastUserCaseKind`
-- (читається з кожного dispatch) робив повний скан PK.
create index if not exists idx_confirms_user_at on bot_case_confirmations(tg_id, at desc);

-- Снапшот відповідей користувача в момент події (create/edit/confirm).
-- Потрібен для перевірки доброчесності у collab-режимі: без нього старі
-- відповіді губляться, бо bot_cases.current_answers перезаписується при edit.
alter table bot_case_confirmations add column if not exists answers jsonb not null default '[]'::jsonb;

-- Непідтверджені бали (крок 3). Для create/edit бали не нараховуються одразу, а
-- тримаються як 'unconfirmed' до закриття справи; тоді версію учасника звіряють із
-- фінальною (поле-в-поле, крім ролі 'notes', поріг 5 символів) → 'confirmed' або
-- 'forfeited'. points — нарахована/потенційна сума; final_answers — снапшот фінальної
-- версії на момент розрахунку (щоб екран «де помилився» не бив у bot_cases). Для
-- 'confirm' points_status лишається NULL (бали нараховано одразу, як раніше).
alter table bot_case_confirmations add column if not exists points        numeric;
alter table bot_case_confirmations add column if not exists points_status text;
alter table bot_case_confirmations add column if not exists settled_at    timestamptz;
alter table bot_case_confirmations add column if not exists final_answers jsonb;
create index if not exists idx_confirms_pending on bot_case_confirmations(tg_id, points_status, settled_at desc);

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

-- Місячний рейтинг. month = 'YYYY-MM' (Europe/Kyiv). Бали накопичуються в рядок
-- поточного місяця; новий місяць → новий рядок (рейтинг «сам» обнуляється).
-- display_name денормалізовано для відображення без join. total_points у bot_users
-- лишається накопичувальним (lifetime) — для бейджів і «за весь час».
create table if not exists bot_monthly_points (
  month        text    not null,
  tg_id        text    not null,
  points       numeric not null default 0,
  display_name text    not null default '',
  primary key (month, tg_id)
);
create index if not exists idx_monthly_points on bot_monthly_points(month, points desc);

create table if not exists bot_dispatch_log (
  id       bigserial primary key,
  tg_id    text        not null,
  case_id  text        not null,
  sent_at  timestamptz not null default now()
);
create index if not exists idx_dispatch_user on bot_dispatch_log(tg_id);

-- Отримані користувачем бейджі (досягнення). PK (tg_id, badge_id) гарантує
-- «один раз і назавжди»: повторний insert через on conflict do nothing — no-op.
-- badge_id — стабільний ключ із config.badges, тут не валідуємо (каталог у коді).
create table if not exists bot_user_badges (
  tg_id      text        not null,
  badge_id   text        not null,
  earned_at  timestamptz not null default now(),
  primary key (tg_id, badge_id)
);
create index if not exists idx_user_badges_user on bot_user_badges(tg_id);

-- ===== Описовий пазл (гра «слово дня») =====
-- Речення дня (одне на київську дату). Адмін редагує через вкладку «Пазл».
create table if not exists bot_puzzles (
  date_kyiv   date primary key,
  sentence    text        not null default '',
  -- Слова, що автоматично вважаються «виданими» (підтвердженими) для цієї фрази:
  -- ті, яких немає в розпізнаних колаб-заголовках на момент збереження.
  given_words jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table bot_puzzles add column if not exists given_words jsonb not null default '[]'::jsonb;

-- Зібрані користувачем слова пазла. status: unconfirmed (розпізнав) → confirmed
-- (справу закрили того ж дня). PK не дає зібрати те саме слово двічі.
create table if not exists bot_puzzle_progress (
  date_kyiv    date        not null,
  tg_id        text        not null,
  word         text        not null,
  status       text        not null default 'unconfirmed' check (status in ('unconfirmed','confirmed')),
  case_id      text        not null default '',
  collected_at timestamptz not null default now(),
  confirmed_at timestamptz,
  primary key (date_kyiv, tg_id, word)
);
create index if not exists idx_puzzle_progress_day  on bot_puzzle_progress(date_kyiv);
create index if not exists idx_puzzle_progress_case on bot_puzzle_progress(case_id);

-- Переможці пазла за день. PK(date,place) + unique(date,tg_id): максимум 3 місця,
-- один юзер не може зайняти два.
create table if not exists bot_puzzle_winners (
  date_kyiv  date        not null,
  place      int         not null check (place between 1 and 3),
  tg_id      text        not null,
  points     int         not null default 0,
  awarded_at timestamptz not null default now(),
  primary key (date_kyiv, place),
  unique (date_kyiv, tg_id)
);

alter table bot_puzzles         enable row level security;
alter table bot_puzzle_progress enable row level security;
alter table bot_puzzle_winners  enable row level security;

-- Атомарне присвоєння місця переможцю. Advisory-lock на дату серіалізує одночасні
-- виклики (щоб двоє не отримали одне місце). Повертає place+points або порожньо
-- (юзер уже переможець / усі 3 місця зайняті). Призи: 1→1000, 2→500, 3→300.
create or replace function bot_award_puzzle_winner(p_date date, p_tg_id text)
returns table(place int, points int) language plpgsql security definer as $$
declare
  v_count  int;
  v_place  int;
  v_points int;
begin
  perform pg_advisory_xact_lock(hashtext('bot_puzzle:' || p_date::text));
  if exists (select 1 from bot_puzzle_winners w where w.date_kyiv = p_date and w.tg_id = p_tg_id) then
    return;
  end if;
  select count(*) into v_count from bot_puzzle_winners w where w.date_kyiv = p_date;
  if v_count >= 3 then
    return;
  end if;
  v_place  := v_count + 1;
  v_points := case v_place when 1 then 1000 when 2 then 500 when 3 then 300 else 0 end;
  insert into bot_puzzle_winners(date_kyiv, place, tg_id, points)
    values (p_date, v_place, p_tg_id, v_points);
  return query select v_place, v_points;
end $$;
revoke all on function bot_award_puzzle_winner(date, text) from public, anon, authenticated;

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
alter table bot_integrity_reviews  enable row level security;
alter table bot_user_badges        enable row level security;
alter table bot_monthly_points     enable row level security;

-- Заборонити виконання RPC від імені anon/authenticated.
-- (security definer функція без явного grant не виконається сторонніми ролями.)
revoke all on function bot_inc_daily(text, date) from public, anon, authenticated;

-- Атомарний інкремент місячних балів (повертає нове значення). Оновлює й display_name.
create or replace function bot_inc_monthly(p_month text, p_tg_id text, p_delta numeric, p_name text)
returns numeric language plpgsql security definer as $$
declare v numeric;
begin
  insert into bot_monthly_points (month, tg_id, points, display_name)
  values (p_month, p_tg_id, p_delta, coalesce(p_name, ''))
  on conflict (month, tg_id) do update
    set points = bot_monthly_points.points + p_delta,
        display_name = excluded.display_name
  returning points into v;
  return v;
end $$;
revoke all on function bot_inc_monthly(text, text, numeric, text) from public, anon, authenticated;

-- Список місяців, для яких є дані (новіші — першими).
create or replace function bot_monthly_months()
returns table (month text) language sql security definer as $$
  select distinct month from bot_monthly_points order by month desc;
$$;
revoke all on function bot_monthly_months() from public, anon, authenticated;

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

-- Агрегати для прогнозу завершення фонду. Замінює `getAllCases()` +
-- `computeFundEta()` у JS — повертає одним рядком лише те, що реально
-- використовується для формули. ETA-дата рахується вже на сервері API
-- (вона тривіальна арифметика, але потребує константи фонду з конфіга).
--
-- p_target            — мін. підтверджень/сабмітів, щоб справа = "done".
-- p_window_days       — вікно для оцінки швидкості (днів).
--
-- fully_done_by_bot   — кількість описів, де ВСІ справи done.
-- completions_in_window — серед fully_done — скільки завершились за останні
--                        p_window_days днів (max(updated_at) у вікні).
create or replace function bot_fund_eta_stats(p_target int, p_window_days int)
returns table (fully_done_by_bot int, completions_in_window int)
language sql security definer as $$
  with per_desc as (
    select
      archive, fund, opys,
      count(*) as total_cases,
      count(*) filter (
        where status = 'done'
           or (mode = 'collaborative' and confirmations_count >= p_target)
           or (mode <> 'collaborative' and submissions_count >= p_target)
      ) as done_cases,
      max(updated_at) as last_updated
    from bot_cases
    group by archive, fund, opys
  ),
  fully as (
    select last_updated from per_desc
    where total_cases > 0 and done_cases = total_cases
  )
  select
    (select count(*)::int from fully) as fully_done_by_bot,
    (select count(*)::int from fully
      where last_updated > now() - (p_window_days || ' days')::interval
    ) as completions_in_window;
$$;
revoke all on function bot_fund_eta_stats(int, int) from public, anon, authenticated;

-- Кандидати на dispatch: відкриті справи, не заблоковані іншим юзером,
-- де користувач НЕ брав участі (не сабмітив, не пропустив, не торкався в collab).
-- ORDER BY обов'язковий: PostgREST обрізає відповідь до db_max_rows (~1000),
-- і без сортування старіші описи можуть випадати з вибірки → шедулер їх "не бачить".
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
    )
  order by c.created_at, c.case_id;
$$;
revoke all on function bot_candidate_cases(text) from public, anon, authenticated;

-- v2 (egress-фікс): v1 повертає ВСІ доступні справи (~1000 рядків × ~1.2 КБ JSON
-- на кожну видачу). Логіка вибору в selectNextCaseForUser завжди бере справу або
-- з найстарішого опису серед кандидатів (puzzle/extra-шляхи), або з найстарішого
-- опису, де ще є справи з progress < p_target (primary-шлях). Тому повертаємо лише
-- кандидатів цих одного-двох описів і лише колонки, потрібні для вибору; повний
-- рядок обраної справи код добирає окремим точковим getCase().
create or replace function bot_candidate_cases_v2(p_tg_id text, p_target integer)
returns table (
  case_id text,
  archive text,
  fund text,
  opys text,
  mode text,
  confirmations_count integer,
  submissions_count integer,
  created_at timestamptz,
  current_answers jsonb
) language sql security definer as $$
  with cand as (
    select c.case_id, c.archive, c.fund, c.opys, c.mode,
           c.confirmations_count, c.submissions_count, c.created_at, c.current_answers,
           case when c.mode = 'collaborative' then c.confirmations_count else c.submissions_count end as progress
    from bot_cases c
    where c.status = 'open'
      and not exists (select 1 from bot_submissions s where s.case_id = c.case_id and s.tg_id = p_tg_id)
      and not exists (select 1 from bot_skipped sk where sk.case_id = c.case_id and sk.tg_id = p_tg_id)
      and not exists (select 1 from bot_case_confirmations cc where cc.case_id = c.case_id and cc.tg_id = p_tg_id)
      and (
        c.mode <> 'collaborative'
        or c.locked_until is null
        or c.locked_until < now()
        or c.locked_by_tg_id = p_tg_id
      )
  ),
  ages as (
    select archive, fund, opys, min(created_at) as age
    from cand
    group by archive, fund, opys
  ),
  d_all as (
    select archive, fund, opys from ages order by age, archive, fund, opys limit 1
  ),
  d_prim as (
    select a.archive, a.fund, a.opys
    from ages a
    where exists (
      select 1 from cand c
      where c.archive = a.archive and c.fund = a.fund and c.opys = a.opys
        and c.progress < p_target
    )
    order by a.age, a.archive, a.fund, a.opys
    limit 1
  )
  select c.case_id, c.archive, c.fund, c.opys, c.mode,
         c.confirmations_count, c.submissions_count, c.created_at, c.current_answers
  from cand c
  where (c.archive, c.fund, c.opys) in (
    select archive, fund, opys from d_all
    union
    select archive, fund, opys from d_prim
  )
  order by c.created_at, c.case_id;
$$;
revoke all on function bot_candidate_cases_v2(text, integer) from public, anon, authenticated;

-- =====================================================================
-- ВЕБ-ПЕРЕВІРКА справ (вкладка «Перевірка»). Окремі таблиці — бот їх НЕ читає.
-- Лише колаборативний режим: AI наперед заповнює варіант, люди підтверджують/
-- виправляють. Справа done після N різних перевіряльників (поріг — у коді, зараз 3).
-- Бали/бейджі/рейтинг — СПІЛЬНІ з ботом (bot_users / bot_monthly_points / bot_daily_scores).
-- =====================================================================

-- Черга перевірки. case_id генерує бекенд при імпорті .json з розпізнавання.
-- questions — снапшот колонок проєкту [{label, role}]; ai_answers/current_answers —
-- масиви рядків, вирівняні по questions. current_answers стартує = ai_answers і
-- оновлюється при правці (це й є фінальний зведений варіант для експорту).
create table if not exists bot_verif_cases (
  case_id              text primary key,
  tg_file_id           text        not null default '',
  tg_chat_id           text        not null default '',
  tg_message_id        text        not null default '',
  source_pdf           text        not null default '',
  page                 text        not null default '',
  bbox                 text        not null default '',
  archive              text        not null default '',
  fund                 text        not null default '',
  opys                 text        not null default '',
  sprava               text        not null default '',
  questions            jsonb       not null default '[]'::jsonb,
  ai_answers           jsonb       not null default '[]'::jsonb,
  current_answers      jsonb       not null default '[]'::jsonb,
  confirmations_count  int         not null default 0,
  status               text        not null default 'open' check (status in ('open','done')),
  locked_by            text        not null default '',
  locked_until         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_verif_cases_status on bot_verif_cases(status);
create index if not exists idx_verif_cases_lock   on bot_verif_cases(locked_until);
create index if not exists idx_verif_cases_desc   on bot_verif_cases(archive, fund, opys);

-- Аудит перевірок. PK(case_id, verifier_id): один перевіряльник = одна дія на справу.
-- corrected_words — к-сть слів, що перевіряльник змінив (для балів 0.1×слово).
-- kind: 'confirm' (без правок) | 'edit' (з правками). answers — те, що він підтвердив.
create table if not exists bot_verif_confirmations (
  case_id         text        not null,
  verifier_id     text        not null,
  kind            text        not null check (kind in ('confirm','edit')),
  answers         jsonb       not null default '[]'::jsonb,
  corrected_words int         not null default 0,
  at              timestamptz not null default now(),
  primary key (case_id, verifier_id)
);
create index if not exists idx_verif_confirms_case on bot_verif_confirmations(case_id);
create index if not exists idx_verif_confirms_user on bot_verif_confirmations(verifier_id);

-- Пропущені справи (кнопка «Пропустити»). Не рахуються в консенсус, виключаються
-- з добору цьому перевіряльнику.
create table if not exists bot_verif_skips (
  case_id     text        not null,
  verifier_id text        not null,
  at          timestamptz not null default now(),
  primary key (case_id, verifier_id)
);
create index if not exists idx_verif_skips_user on bot_verif_skips(verifier_id);

-- source у submissions: 'telegram' (дефолт) | 'web'. Уніфікує експорт опису й графік.
alter table bot_submissions add column if not exists source text not null default 'telegram';
create index if not exists idx_subs_source on bot_submissions(source);

alter table bot_verif_cases         enable row level security;
alter table bot_verif_confirmations enable row level security;
alter table bot_verif_skips         enable row level security;

-- Атомарний інкремент накопичувальних балів (lifetime). Дробові бали (0.1×слово).
create or replace function bot_inc_total_points(p_tg_id text, p_delta numeric)
returns numeric language plpgsql security definer as $$
declare v numeric;
begin
  update bot_users set total_points = total_points + p_delta
   where tg_id = p_tg_id
   returning total_points into v;
  return v;
end $$;
revoke all on function bot_inc_total_points(text, numeric) from public, anon, authenticated;

-- Кандидати на перевірку: відкриті справи, де цей перевіряльник ще не діяв і не
-- пропускав, не заблоковані іншим. ORDER BY обов'язковий (PostgREST обрізає до ~1000).
create or replace function bot_verif_candidate_cases(p_verifier_id text)
returns setof bot_verif_cases language sql security definer as $$
  select c.* from bot_verif_cases c
  where c.status = 'open'
    and not exists (select 1 from bot_verif_confirmations cc where cc.case_id = c.case_id and cc.verifier_id = p_verifier_id)
    and not exists (select 1 from bot_verif_skips sk where sk.case_id = c.case_id and sk.verifier_id = p_verifier_id)
    and (c.locked_until is null or c.locked_until < now() or c.locked_by = p_verifier_id)
  order by c.created_at, c.case_id;
$$;
revoke all on function bot_verif_candidate_cases(text) from public, anon, authenticated;

-- Атомарне блокування справи за перевіряльником. Повертає true якщо вдалось
-- (вільна / прострочена / вже моя). Захищає від видачі однієї справи двом людям.
create or replace function bot_verif_lock(p_case_id text, p_verifier_id text, p_minutes int)
returns boolean language plpgsql security definer as $$
declare ok boolean;
begin
  update bot_verif_cases
     set locked_by = p_verifier_id,
         locked_until = now() + (p_minutes || ' minutes')::interval,
         updated_at = now()
   where case_id = p_case_id
     and status = 'open'
     and (locked_until is null or locked_until < now() or locked_by = p_verifier_id)
   returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function bot_verif_lock(text, text, int) from public, anon, authenticated;

-- Зафіксувати перевірку: записати дію перевіряльника, оновити зведений варіант
-- (при edit), перерахувати к-сть різних перевіряльників, закрити справу при досягненні
-- порога, зняти лок. Advisory-lock на case_id серіалізує одночасні сабміти.
-- Повертає актуальні confirmations_count і status. Бали нараховує бекенд окремо.
create or replace function bot_verif_record(
  p_case_id       text,
  p_verifier_id   text,
  p_kind          text,
  p_answers       jsonb,
  p_corrected     int,
  p_threshold     int
) returns table (new_count int, new_status text) language plpgsql security definer as $$
declare v_count int; v_status text;
begin
  perform pg_advisory_xact_lock(hashtext('verif:' || p_case_id));
  insert into bot_verif_confirmations(case_id, verifier_id, kind, answers, corrected_words)
    values (p_case_id, p_verifier_id, p_kind, coalesce(p_answers, '[]'::jsonb), greatest(coalesce(p_corrected, 0), 0))
    on conflict (case_id, verifier_id) do nothing;
  if p_kind = 'edit' then
    update bot_verif_cases
       set current_answers = coalesce(p_answers, '[]'::jsonb), updated_at = now()
     where case_id = p_case_id;
  end if;
  select count(distinct verifier_id) into v_count from bot_verif_confirmations where case_id = p_case_id;
  update bot_verif_cases
     set confirmations_count = v_count,
         status = case when v_count >= p_threshold then 'done' else status end,
         locked_by = '', locked_until = null,
         updated_at = now()
   where case_id = p_case_id
   returning status into v_status;
  return query select v_count, v_status;
end $$;
revoke all on function bot_verif_record(text, text, text, jsonb, int, int) from public, anon, authenticated;

-- Агрегований прогрес описів перевірки (для шапки вкладки). Без підкачки всіх справ.
create or replace function bot_verif_description_progress()
returns table (
  archive text,
  fund text,
  opys text,
  earliest_created_at timestamptz,
  total_cases bigint,
  done_cases bigint
) language sql security definer as $$
  select c.archive, c.fund, c.opys,
    min(c.created_at) as earliest_created_at,
    count(*) as total_cases,
    count(*) filter (where c.status = 'done') as done_cases
  from bot_verif_cases c
  group by c.archive, c.fund, c.opys;
$$;
revoke all on function bot_verif_description_progress() from public, anon, authenticated;

-- Одноразові коди «Вхід через бота» для сайту перевірки. Сайт створює код →
-- юзер тисне /start login_<code> у боті → бот пише tg_id+used_at → сайт опитує статус.
create table if not exists bot_verif_login_codes (
  code        text primary key,
  tg_id       text        not null default '',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists idx_verif_login_codes_exp on bot_verif_login_codes(expires_at);
alter table bot_verif_login_codes enable row level security;

-- =====================================================================
-- LEADERBOARD RPC. Замінюють повний скан bot_users у віджеті (egress-фікс).
-- Один індекс по total_points робить top-N та віконну функцію rank() швидкими.
-- =====================================================================
create index if not exists idx_bot_users_total_points_desc
  on bot_users (total_points desc, tg_id);

-- Топ-N для рейтингу. Повертає лише ті поля, які реально показує віджет.
create or replace function bot_leaderboard_top(p_limit int)
returns table (tg_id text, display_name text, total_points numeric)
language sql security definer as $$
  select tg_id, display_name, total_points
  from bot_users
  order by total_points desc, tg_id
  limit greatest(p_limit, 0);
$$;
revoke all on function bot_leaderboard_top(int) from public, anon, authenticated;

-- Ранг і кількість юзерів для конкретного tg_id (без витягання всієї таблиці).
-- Якщо юзера нема — повертаємо rank = total_users (тобто "в кінці"), points = 0.
create or replace function bot_user_rank(p_tg_id text)
returns table (rank int, total_users int, total_points numeric)
language sql security definer as $$
  with ranked as (
    select tg_id, total_points,
           rank() over (order by total_points desc, tg_id) as r
    from bot_users
  ),
  agg as (
    select count(*)::int as cnt from bot_users
  )
  select
    coalesce((select r::int from ranked where tg_id = p_tg_id),
             (select cnt from agg)) as rank,
    (select cnt from agg) as total_users,
    coalesce((select total_points from ranked where tg_id = p_tg_id), 0) as total_points;
$$;
revoke all on function bot_user_rank(text) from public, anon, authenticated;

-- Лічильники для cron/tick stats. Замінюють `select * from bot_users` лише
-- заради того, щоб порахувати скільки активних/паузнутих/всього.
create or replace function bot_user_status_counts()
returns table (total int, active int, paused int) language sql security definer as $$
  select
    count(*)::int as total,
    count(*) filter (where status = 'active')::int as active,
    count(*) filter (where status <> 'active')::int as paused
  from bot_users;
$$;
revoke all on function bot_user_status_counts() from public, anon, authenticated;

-- ============================================================================
-- Адмін-розсилки (broadcast). Адмін задає вибірку (період + поріг розпізнаних),
-- текст і набір наявних кнопок бота. Доставка — чергою з тротлінгом на cron-tick.
-- Дубльовано в supabase/scripts/broadcast.sql для зручного разового запуску.
-- ============================================================================

-- Кампанія розсилки. Лічильники денормалізовані (sent/failed/clicked) — щоб звіт
-- в адмінці читав ОДИН рядок, а не сканував recipients (egress).
create table if not exists bot_broadcasts (
  id            bigserial primary key,
  title         text        not null default '',
  body          text        not null,
  buttons       jsonb       not null default '[]'::jsonb,  -- масив action-ключів: ['next','leaderboard',...]
  crit_from     timestamptz,                                -- межі періоду критерію (UTC)
  crit_to       timestamptz,
  crit_max      int,                                        -- поріг "розпізнав МЕНШЕ ніж"
  status        text        not null default 'queued' check (status in ('queued','sending','done','canceled')),
  total_count   int         not null default 0,
  sent_count    int         not null default 0,
  failed_count  int         not null default 0,
  clicked_count int         not null default 0,
  created_by    text        not null default '',
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
create index if not exists idx_broadcasts_status on bot_broadcasts(status);

-- Один рядок на отримувача. display_name денормалізовано при створенні, щоб воркер
-- НЕ робив getUser на кожного (нуль додаткових читань під час розсилки).
-- claimed_at — для атомарного claim батчу й reap завислих 'sending'.
create table if not exists bot_broadcast_recipients (
  broadcast_id   bigint      not null references bot_broadcasts(id) on delete cascade,
  tg_id          text        not null,
  display_name   text        not null default '',
  status         text        not null default 'pending' check (status in ('pending','sending','sent','failed')),
  error          text,
  claimed_at     timestamptz,
  sent_at        timestamptz,
  clicked_action text,
  clicked_at     timestamptz,
  primary key (broadcast_id, tg_id)
);
create index if not exists idx_broadcast_recip_pending on bot_broadcast_recipients(broadcast_id, status);

-- Вибірка отримувачів: усі НЕ-банені TG-юзери (web:* виключені — у них немає
-- приватного чату з ботом), що за період [p_from, p_to) розпізнали МЕНШЕ ніж p_max
-- справ. "Розпізнав" = submission (parallel) + collab-подія (create/edit/confirm),
-- як у countUserCases. Юзери з 0 теж включені (left join). Уся агрегація — в БД.
create or replace function bot_broadcast_recipients_select(
  p_from timestamptz, p_to timestamptz, p_max int
)
returns table (tg_id text, display_name text)
language sql security definer as $$
  with subs as (
    select tg_id, count(*) as c
    from bot_submissions
    where submitted_at >= p_from and submitted_at < p_to
    group by tg_id
  ),
  confs as (
    select tg_id, count(*) as c
    from bot_case_confirmations
    where at >= p_from and at < p_to
    group by tg_id
  ),
  totals as (
    select u.tg_id, u.display_name,
           coalesce(s.c, 0) + coalesce(cf.c, 0) as recognized
    from bot_users u
    left join subs  s  on s.tg_id  = u.tg_id
    left join confs cf on cf.tg_id = u.tg_id
    where coalesce(u.banned, false) = false
      and u.tg_id not like 'web:%'
  )
  select tg_id, display_name from totals where recognized < p_max;
$$;
revoke all on function bot_broadcast_recipients_select(timestamptz, timestamptz, int) from public, anon, authenticated;

-- Прев'ю: лише КІЛЬКІСТЬ отримувачів (egress = одне число). Перевикористовує select.
create or replace function bot_broadcast_preview(
  p_from timestamptz, p_to timestamptz, p_max int
)
returns int language sql security definer as $$
  select count(*)::int from bot_broadcast_recipients_select(p_from, p_to, p_max);
$$;
revoke all on function bot_broadcast_preview(timestamptz, timestamptz, int) from public, anon, authenticated;

-- Атомарний claim батчу pending-отримувачів (for update skip locked — захист від
-- паралельних воркерів/тіків, без подвійної відправки). Позначає 'sending'+claimed_at.
create or replace function bot_broadcast_claim_batch(p_id bigint, p_limit int)
returns table (tg_id text, display_name text)
language plpgsql as $$
begin
  return query
  update bot_broadcast_recipients r
  set status = 'sending', claimed_at = now()
  where (r.broadcast_id, r.tg_id) in (
    select br.broadcast_id, br.tg_id
    from bot_broadcast_recipients br
    where br.broadcast_id = p_id and br.status = 'pending'
    order by br.tg_id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  returning r.tg_id, r.display_name;
end;
$$;
revoke all on function bot_broadcast_claim_batch(bigint, int) from public, anon, authenticated;

-- Повертає завислі 'sending' (воркер помер на півдорозі) назад у 'pending'.
create or replace function bot_broadcast_reap(p_id bigint, p_older_seconds int)
returns int language plpgsql as $$
declare n int;
begin
  update bot_broadcast_recipients
  set status = 'pending', claimed_at = null
  where broadcast_id = p_id and status = 'sending'
    and claimed_at < now() - make_interval(secs => p_older_seconds);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function bot_broadcast_reap(bigint, int) from public, anon, authenticated;

-- Інкремент лічильників кампанії одним апдейтом (по підсумку батчу).
create or replace function bot_broadcast_inc(p_id bigint, p_sent int, p_failed int)
returns void language sql as $$
  update bot_broadcasts
  set sent_count = sent_count + p_sent,
      failed_count = failed_count + p_failed
  where id = p_id;
$$;
revoke all on function bot_broadcast_inc(bigint, int, int) from public, anon, authenticated;

-- Реєстрація кліку. Лише ПЕРШИЙ клік юзера інкрементує clicked_count (повертає true).
create or replace function bot_broadcast_click(p_id bigint, p_tg_id text, p_action text)
returns boolean language plpgsql as $$
declare n int;
begin
  update bot_broadcast_recipients
  set clicked_action = p_action, clicked_at = now()
  where broadcast_id = p_id and tg_id = p_tg_id and clicked_at is null;
  get diagnostics n = row_count;  -- 1 рядок оновлено = перший клік
  if n > 0 then
    update bot_broadcasts set clicked_count = clicked_count + 1 where id = p_id;
    return true;
  end if;
  return false;
end;
$$;
revoke all on function bot_broadcast_click(bigint, text, text) from public, anon, authenticated;
