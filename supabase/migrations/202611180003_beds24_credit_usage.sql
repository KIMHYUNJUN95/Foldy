-- Beds24 크레딧 사용 기록 (2026-11-18)
--
-- 문서: docs/engineering/01-beds24-integration.md → 「크레딧 사용 기록」
--       docs/engineering/04-data-model.md · docs/engineering/05-rls-permissions.md
--
-- Beds24 V2 는 **계정 단위 5분 크레딧**(한도 200)을 모든 경로가 같이 쓴다. 지금까지는 마지막 값 하나
-- (`beds24_sync_locks` 'account_credit')만 있어서 「누가 · 어디에 썼나」를 알 수 없었다.
-- 모든 Beds24 호출(`src/lib/beds24/credit-ledger.ts` → `beds24Fetch`)이 여기 한 줄씩 남긴다.
--
-- - 쓰기: service role 만(서버의 기록 함수). 사람 세션 쓰기 정책 없음.
-- - 읽기: `ops_admin.access` 를 가진 조직의 줄만(202609300007 과 같은 `capability_organization_ids` 방식).
--   `organization_id` 가 없는 줄(계정 전체 작업 — 조직을 정할 수 없는 크론 · 토큰 갱신)은 이 정책으로 안 보인다.
--   화면은 서버 함수(service role, `beds24_credit_usage_windows`)로 읽고, 거기서 「이 조직 줄 + 조직 없는 줄」만 고른다.
-- - 보관: 30일. 매일 pg_cron 이 지운다(하드 삭제).
-- - `credential_key`: 어느 Beds24 토큰(계정)으로 불렀나. 지금은 토큰이 하나라 전부 'main'.
--   나중에 하위 계정 · 다른 토큰으로 기능마다 크레딧을 나눠 쓰면 그 키가 들어간다(다시 마이그레이션하지 않게 자리만).
--
-- 토큰 · 요청 본문 · 헤더 원문은 남기지 않는다 — 숫자 헤더 3개와 상태 코드만.
--
-- 적용 필요: 운영 Supabase 에 아직 적용 전.
-- 되돌리기:
--   select cron.unschedule('beds24-credit-usage-purge');
--   drop function if exists public.beds24_record_account_credit(timestamptz, text, jsonb);
--   drop function if exists public.beds24_credit_usage_windows(uuid, timestamptz, timestamptz, text);
--   drop table if exists public.beds24_credit_usage;

create table if not exists public.beds24_credit_usage (
  id bigint generated always as identity primary key,
  called_at timestamptz not null default now(),
  organization_id uuid references public.organizations(id) on delete cascade,
  credential_key text not null default 'main',
  feature text not null check (feature in (
    'rates_write', 'rates_read', 'block_write', 'booking_write', 'bookings_sync',
    'guest_messages', 'reviews_sync', 'rooms_sync', 'auth', 'other'
  )),
  action text not null,
  item_count integer check (item_count is null or item_count >= 0),
  actor_kind text not null check (actor_kind in ('user', 'auto')),
  -- 사람이 지워져도 기록은 30일 남는다 — 이름은 사본(actor_name)으로 보인다.
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  actor_job text,
  -- 헤더가 없던 응답(실패 · 일부 429 · 네트워크 오류)은 null.
  cost integer,
  remaining integer,
  resets_at timestamptz,
  -- 네트워크 오류(응답 없음)는 null.
  http_status smallint,
  check (actor_kind <> 'auto' or actor_job is not null)
);

comment on table public.beds24_credit_usage is
  'Beds24 호출 한 번 = 한 줄. 누가(actor_*) · 어디에(feature) · 얼마(cost) · 남은 값(remaining · resets_at). 30일 보관. 쓰기는 service role.';
comment on column public.beds24_credit_usage.organization_id is
  '호출한 조직. 계정 전체 작업(조직을 정할 수 없는 크론 · 토큰 갱신)은 null.';
comment on column public.beds24_credit_usage.credential_key is
  '어느 Beds24 토큰(계정)으로 불렀나. 지금은 항상 main.';

-- 시간 범위 훑기 + 30일 지우기.
create index if not exists beds24_credit_usage_called_at_idx
  on public.beds24_credit_usage (called_at desc);
-- (organization_id, credential_key, called_at) 색인은 두지 않는다 — 줄 대부분이 한 조직 + 조직 없음이라
-- 조직 조건이 거의 안 걸러지고, 걸러 주는 건 시각 범위다. 실측(21만 줄)에서도 플래너가 called_at 색인만 썼다.
-- 사람이 지워질 때 `on delete set null` 이 표 전체를 훑지 않게.
create index if not exists beds24_credit_usage_actor_user_idx
  on public.beds24_credit_usage (actor_user_id)
  where actor_user_id is not null;

alter table public.beds24_credit_usage enable row level security;

drop policy if exists "ops admins can read beds24 credit usage" on public.beds24_credit_usage;
create policy "ops admins can read beds24 credit usage"
on public.beds24_credit_usage
for select
to authenticated
using (
  organization_id = any ((select public.capability_organization_ids('ops_admin.access'))::uuid[])
);

revoke all on public.beds24_credit_usage from public, anon, authenticated;
grant select on public.beds24_credit_usage to authenticated;
grant all on public.beds24_credit_usage to service_role;

-- ---------------------------------------------------------------------------
-- 창(5분)별 집계 — 화면 조회용. service role 만 부른다.
-- ---------------------------------------------------------------------------
--
-- 창 묶기: 같은 창의 호출은 `resets_at` 이 몇 초 안으로 같다(우리 시계 + resets-in 초). 다음 창은 적어도
-- 4분 넘게 떨어진다. 그래서 `resets_at` 순으로 늘어놓고 **60초 넘게 벌어지면 새 창**으로 본다(섬 나누기).
-- 헤더가 없는 줄(실패 · 429)은 호출 시각이 들어가는 창에 붙인다.
-- 한계: 이웃 창의 `resets_at` 이 60초 이하로만 벌어지면(Beds24 가 창을 짧게 끊거나 시계가 크게 흔들릴 때) 두 창이
-- 하나로 합쳐진다. 지금 헤더(resets-in 은 창 끝까지 남은 초)로는 그렇게 될 수 없어 그대로 둔다.
--
-- 범위: 「그 창이 범위 안에서 끝나는가」(resets_at > p_from). 범위 시작에 걸친 창은 시작 전 줄까지 통째로 센다 —
-- 반쪽만 세면 「Foldy 밖」이 부풀려진다. 그래서 6분 앞부터 읽는다.
--
-- 쉰 때(window_paused_at): 그 창에서 429 를 받았거나 남은 값이 10 아래로 내려간 첫 시각(`LOW_CREDIT_THRESHOLD`
-- 와 같은 선 — 이 두 경우에 호출부가 쿨다운을 켠다).
create or replace function public.beds24_credit_usage_windows(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_credential_key text default 'main'
)
returns table (
  credential_key text,
  window_resets_at timestamptz,
  window_min_remaining integer,
  window_paused_at timestamptz,
  actor_kind text,
  actor_user_id uuid,
  actor_name text,
  actor_job text,
  feature text,
  calls integer,
  cost integer,
  rate_limited integer,
  first_at timestamptz,
  last_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select u.id, u.called_at, u.resets_at, u.remaining, u.cost, u.http_status,
           u.actor_kind, u.actor_user_id, u.actor_name, u.actor_job, u.feature
    from public.beds24_credit_usage u
    where u.credential_key = p_credential_key
      and (u.organization_id = p_organization_id or u.organization_id is null)
      and u.called_at >= p_from - interval '6 minutes'
      and u.called_at < p_to
  ),
  ordered as (
    select b.id, b.resets_at,
           lag(b.resets_at) over (order by b.resets_at, b.id) as prev_resets_at
    from base b
    where b.resets_at is not null
  ),
  islands as (
    select o.id, o.resets_at,
           sum(case when o.prev_resets_at is null or o.resets_at - o.prev_resets_at > interval '60 seconds' then 1 else 0 end)
             over (order by o.resets_at, o.id) as grp
    from ordered o
  ),
  windows as (
    select i.grp, max(i.resets_at) as resets_at
    from islands i
    group by i.grp
  ),
  assigned as (
    select b.*, coalesce(w1.resets_at, w2.resets_at) as win
    from base b
    left join islands i on i.id = b.id
    left join windows w1 on w1.grp = i.grp
    left join lateral (
      select w.resets_at
      from windows w
      where b.resets_at is null
        and b.called_at > w.resets_at - interval '305 seconds'
        and b.called_at <= w.resets_at + interval '5 seconds'
      order by w.resets_at
      limit 1
    ) w2 on true
  ),
  scoped as (
    select a.*,
           min(a.remaining) over (partition by a.win) as w_min_remaining,
           min(a.called_at) filter (where a.http_status = 429 or a.remaining < 10) over (partition by a.win) as w_paused_at
    from assigned a
    where (a.win is not null and a.win > p_from)
       or (a.win is null and a.called_at >= p_from)
  )
  select p_credential_key,
         s.win,
         min(s.w_min_remaining)::integer,
         min(s.w_paused_at),
         s.actor_kind,
         s.actor_user_id,
         max(s.actor_name),
         s.actor_job,
         s.feature,
         count(*)::integer,
         coalesce(sum(s.cost), 0)::integer,
         (count(*) filter (where s.http_status = 429))::integer,
         min(s.called_at),
         max(s.called_at)
  from scoped s
  group by s.win, s.actor_kind, s.actor_user_id, s.actor_job, s.feature
  order by s.win nulls last;
$$;

comment on function public.beds24_credit_usage_windows(uuid, timestamptz, timestamptz, text) is
  'Beds24 크레딧 기록을 5분 창 × 누가 × 어디에로 묶는다(이 조직 줄 + 조직 없는 줄). service role 전용. 계산은 src/lib/beds24/credit-usage-model.ts.';

revoke all on function public.beds24_credit_usage_windows(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.beds24_credit_usage_windows(uuid, timestamptz, timestamptz, text) to service_role;

-- ---------------------------------------------------------------------------
-- 계정 마지막 값('account_credit') 쓰기 — 늦게 도착한 값이 지금 값을 덮지 않게.
-- ---------------------------------------------------------------------------
-- 기준: 계정 남은 값은 **순서가 지켜져야 한다.** 앱은 호출마다 바로 쓰지만(`credit-ledger.ts`, 앱 안 줄 세우기 없음)
-- 도착 순서는 호출 순서와 다를 수 있다. 그래서 판정은 여기 한 곳에서 한다.
--
-- 용어: E = 있는 줄, I = 들어온 값. 「살아 있음」= expires_at > now(). 「같은 창」= 두 expires_at 차이 30초 이하.
-- 「남은 값 있음」= metadata.remaining 이 숫자. 「추정」= metadata.expiresEstimated = true(리셋 헤더가 없어
-- 앱이 만료를 「5분 뒤」로 채운 값 — 진짜 창 끝이 아니다).
--
-- 위에서부터 처음 맞는 줄로 정한다.
--   #   E                          I                                         결과
--   1   없음                       무엇이든                                   쓴다(insert)
--   2   살아 있음                  진짜 · 이미 지남(만료 ≤ now)                안 쓴다
--   3   추정                       진짜                                       쓴다 — 만료 · resetsAt · 추정 표시는 I(진짜)로 바꾸고,
--                                                                             E 가 살아 있고 E 남은 값이 숫자면 남은 값은 E 를 넘지 않게
--                                                                             (I 가 숫자면 작은 쪽, I 가 숫자가 아니면 E 그대로).
--                                                                             E 가 지났거나 E 도 숫자가 아니면 I 그대로
--   4   진짜                       진짜 · 옛 창(I 만료 < E 만료 − 30초)        안 쓴다
--   5   진짜 · 살아 있음           진짜 · 새 창(I 만료 > E 만료 + 30초)        쓴다
--   6   살아 있음 · 남은 값 있음   같은 창이거나 추정 · 남은 값 없음           안 쓴다
--   7   살아 있음 · 남은 값 있음   같은 창이거나 추정 · 남은 값이 더 큼         안 쓴다
--   8   살아 있음 · 남은 값 있음   같은 창 · 진짜 · 같거나 작음                쓴다
--   9   살아 있음 · 남은 값 있음   추정 · 같거나 작음                          쓴다, 만료 · resetsAt · 추정 표시는 E 그대로
--  10   살아 있음 · 남은 값 없음   같은 창 · 진짜                              쓴다
--  11   살아 있음 · 남은 값 없음   추정                                       쓴다, 만료 · resetsAt · 추정 표시는 E 그대로
--  12   지남                       그 밖의 모든 값(살아 있음 · 추정 포함)       쓴다
--
-- 숫자 꺼내기는 case 안에서만 한다(OR 평가 순서에 기대지 않게).
create or replace function public.beds24_record_account_credit(
  p_expires_at timestamptz,
  p_source text,
  p_metadata jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_row public.beds24_sync_locks%rowtype;
  v_live boolean;
  v_in_est boolean := coalesce(p_metadata -> 'expiresEstimated' = 'true'::jsonb, false);
  v_old_est boolean;
  v_in_rem numeric := case when jsonb_typeof(p_metadata -> 'remaining') = 'number'
    then (p_metadata ->> 'remaining')::numeric end;
  v_old_rem numeric;
  v_expires timestamptz := p_expires_at;
  v_metadata jsonb := p_metadata;
begin
  -- 1
  insert into public.beds24_sync_locks (name, locked_by, locked_at, expires_at, reason, metadata, updated_at)
  values ('account_credit', p_source, v_now, p_expires_at, null, p_metadata, v_now)
  on conflict (name) do nothing;
  if found then
    return;
  end if;

  select * into v_row from public.beds24_sync_locks where name = 'account_credit' for update;
  if not found then
    return;
  end if;
  v_live := v_row.expires_at > v_now;
  v_old_est := coalesce(v_row.metadata -> 'expiresEstimated' = 'true'::jsonb, false);
  v_old_rem := case when jsonb_typeof(v_row.metadata -> 'remaining') = 'number'
    then (v_row.metadata ->> 'remaining')::numeric end;

  -- 2
  if v_live and not v_in_est and p_expires_at <= v_now then
    return;
  end if;

  -- 3: 진짜 만료가 추정을 바꾼다. 같은 실제 창일 수 있어 남은 값은 되올리지 않는다.
  if v_old_est and not v_in_est then
    if v_live and v_old_rem is not null and (v_in_rem is null or v_in_rem > v_old_rem) then
      v_metadata := p_metadata || jsonb_build_object('remaining', v_row.metadata -> 'remaining');
    end if;
  else
    -- 4~11
    -- 4
    if not v_old_est and not v_in_est and p_expires_at < v_row.expires_at - interval '30 seconds' then
      return;
    end if;
    -- 6~11 (5 는 여기에 걸리지 않고 그대로 쓴다)
    if v_live and (v_in_est or abs(extract(epoch from (v_row.expires_at - p_expires_at))) <= 30) then
      if v_old_rem is not null and (v_in_rem is null or v_in_rem > v_old_rem) then
        return;
      end if;
      if v_in_est then
        v_expires := v_row.expires_at;
        v_metadata := (p_metadata - 'expiresEstimated')
          || jsonb_build_object('resetsAt', coalesce(v_row.metadata -> 'resetsAt', 'null'::jsonb))
          || case when v_old_est then '{"expiresEstimated": true}'::jsonb else '{}'::jsonb end;
      end if;
    end if;
  end if;

  -- 3 · 5 · 8~12 쓰기
  update public.beds24_sync_locks
     set locked_by = p_source,
         locked_at = v_now,
         expires_at = v_expires,
         reason = null,
         metadata = v_metadata,
         updated_at = v_now
   where name = 'account_credit';
end;
$$;

comment on function public.beds24_record_account_credit(timestamptz, text, jsonb) is
  'beds24_sync_locks account_credit 줄 쓰기. 판정표 12줄(마이그레이션 주석 · docs/engineering/01 「크레딧 사용 기록」) — 옛 창 · 지난 값 · 같은 창 되올림 · 빈 남은 값은 덮지 않고, 추정 만료는 살아 있는 창의 만료를 바꾸지 않는다. service role 전용.';

revoke all on function public.beds24_record_account_credit(timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.beds24_record_account_credit(timestamptz, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 30일 지난 줄 지우기 — 매일 도쿄 0:35(UTC 15:35). 분실물 정리(202607180001)와 같은 방식.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$ begin
  perform cron.unschedule('beds24-credit-usage-purge');
exception
  when others then null;
end $$;

select cron.schedule(
  'beds24-credit-usage-purge',
  '35 15 * * *',
  $$ delete from public.beds24_credit_usage where called_at < now() - interval '30 days'; $$
);
