-- Адмін-розсилки (broadcast): таблиці + RPC.
-- Разовий запуск: Supabase → SQL Editor → New query → Paste → Run.
-- Ідемпотентно (можна запускати повторно). Дубль секції з schema.sql.

create table if not exists bot_broadcasts (
  id            bigserial primary key,
  title         text        not null default '',
  body          text        not null,
  buttons       jsonb       not null default '[]'::jsonb,
  crit_from     timestamptz,
  crit_to       timestamptz,
  crit_max      int,
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

-- RLS без політик: anon/authenticated не мають доступу, бот ходить service_role.
alter table bot_broadcasts           enable row level security;
alter table bot_broadcast_recipients enable row level security;

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

create or replace function bot_broadcast_preview(
  p_from timestamptz, p_to timestamptz, p_max int
)
returns int language sql security definer as $$
  select count(*)::int from bot_broadcast_recipients_select(p_from, p_to, p_max);
$$;
revoke all on function bot_broadcast_preview(timestamptz, timestamptz, int) from public, anon, authenticated;

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

create or replace function bot_broadcast_inc(p_id bigint, p_sent int, p_failed int)
returns void language sql as $$
  update bot_broadcasts
  set sent_count = sent_count + p_sent,
      failed_count = failed_count + p_failed
  where id = p_id;
$$;
revoke all on function bot_broadcast_inc(bigint, int, int) from public, anon, authenticated;

create or replace function bot_broadcast_click(p_id bigint, p_tg_id text, p_action text)
returns boolean language plpgsql as $$
declare n int;
begin
  update bot_broadcast_recipients
  set clicked_action = p_action, clicked_at = now()
  where broadcast_id = p_id and tg_id = p_tg_id and clicked_at is null;
  get diagnostics n = row_count;
  if n > 0 then
    update bot_broadcasts set clicked_count = clicked_count + 1 where id = p_id;
    return true;
  end if;
  return false;
end;
$$;
revoke all on function bot_broadcast_click(bigint, text, text) from public, anon, authenticated;
