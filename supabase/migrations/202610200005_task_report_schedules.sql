-- 업무일지 예약 보내기 (2026-10-20, 시안 「업무일지 예약 보내기 · 시안」 A안).
--
-- 도메인 계약: docs/product/18-todo-task-workflow.md 「업무일지 예약 보내기」
--
-- 업무일지 시트에서 「보낼 시각」을 고르면 그 순간의 본문을 여기 저장하고, 그 시각에 서버가 Slack 으로 보낸다.
-- 앱이 꺼져 있어도 보낸다. 깨우는 방식은 Beds24 틱과 같다(202609300004) — pg_cron 이 **매 분** 아주 싼 검사만 하고,
-- 보낼 때가 된 예약이 있을 때만 pg_net 으로 `/api/tasks/report-tick` 을 부른다. 토큰은 Vault 에서 난수로 만든다.

-- ── ① 표 ───────────────────────────────────────────────────────────────────────
create table if not exists public.task_report_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- 어느 날의 업무일지인가(도쿄 날짜).
  report_date date not null,
  -- 예약한 순간의 본문 그대로 보낸다(나중에 시트에서 고쳐도 「바뀐 내용으로 예약」을 누르기 전엔 이 값).
  body text not null check (char_length(body) between 1 and 40000),
  send_at timestamptz not null,
  -- scheduled → sending → sent | failed, 또는 cancelled.
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  -- 실패 이유 코드(not_configured · forbidden · slack_rejected · error · stuck). 본문 · 웹훅 주소는 남기지 않는다.
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.task_report_schedules is
  'Daily work-log (업무일지) Slack sends scheduled by a user. Written only by server code (service role); users read their own rows.';

-- 한 사람 · 한 날짜에 살아 있는 예약은 하나 — 다시 예약하면 서버가 이전 것을 취소하고 새로 넣는다.
create unique index if not exists task_report_schedules_one_active
  on public.task_report_schedules (user_id, report_date)
  where status in ('scheduled', 'sending');

-- 틱이 「보낼 때가 된 것」을 찾는 인덱스 — 살아 있는 예약만 담는다(부분 인덱스).
create index if not exists task_report_schedules_due
  on public.task_report_schedules (send_at)
  where status = 'scheduled';

-- 목록 · 시트가 「내 최근 날짜들의 예약」을 읽는다.
create index if not exists task_report_schedules_user_date
  on public.task_report_schedules (user_id, report_date desc);

create index if not exists task_report_schedules_org
  on public.task_report_schedules (organization_id);

drop trigger if exists set_task_report_schedules_updated_at on public.task_report_schedules;
create trigger set_task_report_schedules_updated_at
  before update on public.task_report_schedules
  for each row execute function public.set_updated_at();

-- ── ② RLS — 본인 것만 읽는다. 쓰기는 서버(service role)만 ────────────────────────────
alter table public.task_report_schedules enable row level security;

drop policy if exists "task report schedules: read own" on public.task_report_schedules;
create policy "task report schedules: read own"
  on public.task_report_schedules for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- ── ③ 보낼 것 가져가기 — 원자적으로 'sending' 으로 바꾸며 가져간다 ──────────────────────
--
-- 틱이 겹쳐 돌아도 같은 예약을 두 번 보내지 않게 `for update skip locked`. 'sending' 에서 10분 넘게 멈춘 것은
-- **다시 보내지 않고** 실패로 돌린다 — Slack 이 이미 받았을 수 있어 두 번 나가는 것보다 「못 보냄 · 다시 보내기」가 낫다.
create or replace function public.claim_due_task_report_schedules(p_limit integer default 20)
returns setof public.task_report_schedules
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.task_report_schedules
     set status = 'failed', error = 'stuck'
   where status = 'sending' and claimed_at < now() - interval '10 minutes';

  return query
  update public.task_report_schedules s
     set status = 'sending', claimed_at = now()
   where s.id in (
     select id from public.task_report_schedules
      where status = 'scheduled' and send_at <= now()
      order by send_at
      limit greatest(1, least(p_limit, 50))
      for update skip locked
   )
  returning s.*;
end;
$$;

revoke all on function public.claim_due_task_report_schedules(integer) from public, anon, authenticated;
grant execute on function public.claim_due_task_report_schedules(integer) to service_role;

-- ── ④ Vault — 토큰(난수)과 호출 주소 ──────────────────────────────────────────────
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'task_report_tick_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'task_report_tick_token',
      'Bearer token pg_cron sends to /api/tasks/report-tick. Rotate with vault.update_secret; never print.'
    );
  end if;
  -- 프로덕션 도메인: docs/engineering/07-environment-setup.md (2026-10-20 확인 — stay-ops-two.vercel.app)
  if not exists (select 1 from vault.secrets where name = 'task_report_tick_url') then
    perform vault.create_secret(
      'https://stay-ops-two.vercel.app/api/tasks/report-tick',
      'task_report_tick_url',
      'Endpoint pg_cron calls when a scheduled work-log send is due.'
    );
  end if;
end;
$$;

create or replace function public.task_report_tick_token_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select length(p_token) >= 32
         and extensions.digest(p_token, 'sha256') = extensions.digest(s.decrypted_secret, 'sha256')
        from vault.decrypted_secrets s
       where s.name = 'task_report_tick_token'
       limit 1
    ),
    false
  );
$$;

revoke all on function public.task_report_tick_token_ok(text) from public, anon, authenticated;
grant execute on function public.task_report_tick_token_ok(text) to service_role;

-- ── ⑤ 매 분 — 보낼 때가 된 것이 있을 때만 부른다 ─────────────────────────────────────
-- 돌려주는 값은 cron.job_run_details.return_message 에 남는다: 'idle' · 'not_configured' · 'fired'.
create or replace function public.task_report_tick_if_needed()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  if not exists (
    select 1 from public.task_report_schedules
     where (status = 'scheduled' and send_at <= now())
        or (status = 'sending' and claimed_at < now() - interval '10 minutes')
  ) then
    return 'idle';
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'task_report_tick_url' limit 1;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'task_report_tick_token' limit 1;
  if v_url is null or v_token is null then
    return 'not_configured';
  end if;

  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
    timeout_milliseconds := 60000
  );
  return 'fired';
end;
$$;

revoke all on function public.task_report_tick_if_needed() from public, anon, authenticated;
grant execute on function public.task_report_tick_if_needed() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'task-report-tick') then
    perform cron.unschedule('task-report-tick');
  end if;
  perform cron.schedule('task-report-tick', '* * * * *', 'select public.task_report_tick_if_needed()');
end;
$$;
