-- 손님 메시지 — 과거 메시지 가져오기(한 번만 돌리는 이어 받기). docs/product/47-guest-messaging.md 「과거 메시지 가져오기」
--
-- 2026-11-12 사용자 결정: Beds24 가 주는 과거 메시지(maxAge=999일)를 전부 가져온다.
-- `GET /bookings/messages?maxAge=999&page=N` 를 한 번에 몇 페이지씩 읽고, 어디까지 읽었는지(next_page)를 여기에 남겨 다음 실행이 이어 받는다.
--
-- - 조직마다 한 줄(organization_id 가 기본 키). 실행은 그 조직 기준으로 계정 전체를 한 번 훑고, 다른 조직 예약은 건너뛴다(세기만).
-- - 쓰기는 서버(service_role)만. 화면은 `guest_messages.manage` 가 있는 사람만 읽는다(진행 표시용).
-- - 동시에 두 번 돌지 않게 `guest_message_backfill_claim()` 이 한 문장으로 잡는다(lease 30~300초, 서버가 페이지마다 늘림 · 지나면 다시 잡을 수 있음).
--
-- 이 파일은 아직 운영에 적용되지 않았다(사용자가 대시보드 SQL 편집기로 적용).

create table if not exists public.guest_message_backfill_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null default 'beds24' check (provider in ('beds24')),
  status text not null default 'idle' check (status in ('idle', 'running', 'paused', 'done', 'failed')),
  max_age_days integer not null default 999 check (max_age_days between 1 and 999),
  -- 다음 실행이 읽을 페이지(1부터). 끝나면 그대로 둔다.
  next_page integer not null default 1 check (next_page >= 1),
  pages_done integer not null default 0 check (pages_done >= 0),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  -- 이미 있던 메시지(중복) — 다시 돌려도 늘기만 하고 메시지는 두 번 들어가지 않는다.
  skipped_count integer not null default 0 check (skipped_count >= 0),
  -- 조직을 못 정했거나(매핑 없음) · 다른 조직이거나 · 조직이 엇갈린 예약의 메시지 수.
  unrouted_count integer not null default 0 check (unrouted_count >= 0),
  failed_bookings integer not null default 0 check (failed_bookings >= 0),
  -- 지금 커서 페이지(next_page)에서 예약 넣기가 실패한 횟수. 3번이면 실패 예약 번호를 남기고 넘어간다(독이 든 페이지에 영원히 막히지 않게).
  page_attempts integer not null default 0 check (page_attempts >= 0),
  -- 3번 실패로 넘어간 예약 번호(Beds24 예약 id, 최대 500개). 손님 이름 · 본문은 없다.
  failed_booking_ids text[] not null default '{}',
  started_at timestamptz,
  finished_at timestamptz,
  last_run_at timestamptz,
  -- 멈춘 이유(low_credit · rate_limited · cooldown · paused · max_pages · http_error · request_error · token · missing_env · failed_bookings).
  last_error text,
  -- 429 · 저크레딧으로 멈췄을 때 Beds24 가 알려 준 리셋 시각(이 뒤에 다시 돌리면 된다).
  resume_after timestamptz,
  -- 재기 모드(maxAge=7 첫 페이지만) 결과: { at, rows, requestCost, remaining, resetsIn, nextPageExists, order }.
  last_measure jsonb,
  lease_until timestamptz,
  -- 지금 실행의 번호. claim 이 새로 만들고, 서버는 모든 쓰기를 `status = 'running' and run_id = <내 번호>` 로 건다
  -- (lease 가 지나 다른 실행이 잡았으면 늦게 끝난 앞 실행의 쓰기가 0행이 된다).
  run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists guest_message_backfill_state_set_updated_at on public.guest_message_backfill_state;
create trigger guest_message_backfill_state_set_updated_at
before update on public.guest_message_backfill_state
for each row execute function public.set_updated_at();

alter table public.guest_message_backfill_state enable row level security;

-- 읽기: 그 조직에서 `guest_messages.manage` 를 가진 사람(+ 플랫폼 개발자).
-- 넣기 · 고치기 · 지우기 정책은 일부러 두지 않는다 — 화면에서 쓰지 않고 서버(service_role)만 쓴다(권한도 select 만 줌).
drop policy if exists "guest message backfill: managers can read" on public.guest_message_backfill_state;
create policy "guest message backfill: managers can read"
on public.guest_message_backfill_state
for select
to authenticated
using (
  (select public.is_platform_admin())
  or public.has_capability(organization_id, (select auth.uid()), 'guest_messages.manage')
);

revoke all on table public.guest_message_backfill_state from public, anon, authenticated;
grant select on table public.guest_message_backfill_state to authenticated;
grant all on table public.guest_message_backfill_state to service_role;

-- 실행 잡기 — 줄이 없으면 만들고, 지금 도는 실행이 없을 때만(또는 lease 가 지났을 때만) running 으로 바꾸고 새 run_id 를 붙여 돌려준다.
-- 잡지 못하면 빈 결과. p_restart 면 처음(1페이지)부터 다시 — 끝난(done) 줄은 p_restart 일 때만 다시 잡는다.
create or replace function public.guest_message_backfill_claim(
  p_organization_id uuid,
  p_restart boolean default false,
  p_lease_seconds integer default 120,
  p_now timestamptz default now()
)
returns setof public.guest_message_backfill_state
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.guest_message_backfill_state (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  return query
  update public.guest_message_backfill_state s
  set
    status = 'running',
    run_id = gen_random_uuid(),
    lease_until = p_now + make_interval(secs => least(greatest(p_lease_seconds, 30), 300)),
    next_page = case when p_restart then 1 else s.next_page end,
    pages_done = case when p_restart then 0 else s.pages_done end,
    fetched_count = case when p_restart then 0 else s.fetched_count end,
    imported_count = case when p_restart then 0 else s.imported_count end,
    skipped_count = case when p_restart then 0 else s.skipped_count end,
    unrouted_count = case when p_restart then 0 else s.unrouted_count end,
    failed_bookings = case when p_restart then 0 else s.failed_bookings end,
    page_attempts = case when p_restart then 0 else s.page_attempts end,
    failed_booking_ids = case when p_restart then '{}'::text[] else s.failed_booking_ids end,
    started_at = case when p_restart or s.started_at is null then p_now else s.started_at end,
    finished_at = case when p_restart then null else s.finished_at end,
    last_error = null
  where s.organization_id = p_organization_id
    and (s.status <> 'running' or s.lease_until is null or s.lease_until < p_now)
    and (s.status <> 'done' or p_restart)
  returning s.*;
end;
$$;

revoke all on function public.guest_message_backfill_claim(uuid, boolean, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.guest_message_backfill_claim(uuid, boolean, integer, timestamptz) to service_role;

comment on table public.guest_message_backfill_state is
  '손님 메시지 과거 가져오기 진행(조직마다 한 줄). 서버만 쓴다. docs/product/47-guest-messaging.md 「과거 메시지 가져오기」';
