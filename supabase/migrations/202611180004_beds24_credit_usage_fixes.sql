-- Beds24 크레딧 사용 기록 — 점검 수정 3가지 (2026-11-18)
--
-- 문서: docs/engineering/01-beds24-integration.md → 「2026-11-18 크레딧 사용 기록」
--       docs/engineering/04-data-model.md · docs/engineering/05-rls-permissions.md
-- 앞 마이그레이션: 202611180003_beds24_credit_usage.sql (운영 적용 2026-11-18 — 그 파일의 SQL 은 고치지 않는다).
--
-- 1. 읽기 정책을 서버 판정과 같게.
--    `beds24_credit_usage` select 정책이 `ops_admin.access` 만 봤다. 서버 판정 `canViewBeds24Credit`
--    (`src/lib/beds24/credit-access.ts`)는 `ops_admin.access` + `admin_web.access` 둘 다 요구한다.
--    → 같은 `capability_organization_ids` 방식으로 `admin_web.access` 조건을 하나 더한다(정책 drop + create).
--
-- 2. `beds24_record_account_credit` — 「같은 창인가」 판정을 한 곳에 모음.
--    0003 은 줄마다 방향 한쪽씩 판정해, 창이 다른 값이 「같은 창의 작은 값」으로 끼어들어 남은 값이 새 창 내내 낮게
--    고정되는 길이 셋 있었다: (a) 옛 창 끝의 추정 E → 새 창 진짜 I(3번 줄이 E 의 낮은 값을 남김),
--    (b) 진짜 E(새 창) ← 늦게 온 옛 창 끝의 추정 I(9번 줄이 씀), (c) 진짜 E ← 이미 지난 추정 I(2번 줄이 진짜만 막음).
--    → 모든 조합(E 진짜/추정 × I 진짜/추정 × E 살아 있음/지남)이 **한 판정 `관계(I, E)` = 옛 창 · 같은 창 · 새 창** 을 쓴다.
--      추정 값의 호출 시각 = 만료 − 300초. 진짜 창 W(끝 = 만료)는 [W − 300초, W). 시계 여유 30초.
--        진짜 · 진짜: I 만료 < E 만료 − 30초 → 옛 창 / > E 만료 + 30초 → 새 창 / 그 사이 → 같은 창
--        진짜 E · 추정 I: I 추정 만료 > E 만료 + 30초 → 같은 창(I 가 E 창 시작 30초 뒤 이후에 찍힘), 아니면 옛 창
--        추정 E · 진짜 I: E 추정 만료 > I 만료 + 30초 → 같은 창, 아니면 새 창(E 가 앞 창)
--        추정 · 추정: 가를 근거가 없다 → 같은 창으로 다룬다(보수적 — 남은 한계 ①)
--      한 규칙: 「진짜 창이 시작하고 30초 안에 찍힌 추정 값은 앞 창 값으로 본다」 — 두 방향(진짜 E · 추정 I / 추정 E · 진짜 I)이 같은 경계를 쓴다.
--    결과: 옛 창 → 안 쓴다. 새 창 → 통째로 I. 같은 창 → 남은 값은 작은 쪽(한쪽만 숫자면 그 값 — 빈 값은 같은 창 값을 지우지 않는다),
--          만료 · resetsAt · 추정 표시는 진짜 쪽(둘 다 진짜면 I, 진짜 E · 추정 I 면 E — 추정 만료는 진짜 창을 늘리지 않는다).
--          둘 다 추정이면 만료는 **남기는 남은 값을 찍은 호출의 추정 만료** — 만료가 판정 기준 시각이라 남은 값과 같은 호출이어야
--          이어 오는 진짜 값의 창을 맞게 가른다(`least(E, I)` 보다 정확: 더 이른 호출이 더 큰 값이면 그 시각은 남은 값과 무관하다).
--          I 에 없는 칸(limit 등)은 E 것을 남긴다.
--          바뀌는 것이 없으면(남은 값이 안 낮아지고 진짜 만료도 새로 안 생기면) 쓰지 않는다.
--    E 가 살아 있으면 이미 지난 I(진짜 · 추정 모두)는 쓰지 않는다 — 그 창은 끝났다. E 가 지났으면 무엇이든 쓴다(지난 줄은 읽을 때 「없음」).
--    빈 값의 규칙: 같은 창 값은 지우지 않지만, **새 창의 빈 진짜 값은 앞 창 남은 값을 비운다**(앞 창 값은 이 창에 맞지 않는다 — 화면은 「모름」).
--
--    남는 한계(원리상 — 헤더가 없는 값에는 창을 가를 근거가 없다):
--      ① 추정끼리: 옛 창 끝의 추정 낮은 값(예: 3) 뒤에 새 창의 추정 값(예: 190)만 오면 「같은 창의 더 큰 값」으로 버려져
--         **그 낮은 값을 찍은 호출 + 300초까지 최대 5분 남은 값이 낮게 고정**된다. 그 사이 새 창의 진짜 값이 하나라도 오면 바로 풀린다
--         (남긴 값의 호출이 새 창 시작 전이라 「새 창」으로 갈린다 — 만료를 남긴 값의 호출 것으로 두는 이유).
--      ② 진짜 창 시작 30초 안에 찍힌 추정 값은 앞 창으로 본다: 진짜 E 뒤에 오면 버려지고(같은 창의 더 낮은 값이었다면 그 낮은 값을 놓친다),
--         추정 E 뒤에 같은 창 진짜 I 가 오면 통째로 바뀌어 남은 값이 잠깐 올라가거나 비워진다. 다음 진짜 값이 바로 고친다.
--      ③ 추정끼리 같은 창에서 더 작은 값이 더 늦은 호출이면 만료(살아 있는 시간)가 그 호출 + 300초로 늘어난다 — 그 값 자체의 추정 만료라
--         새로 들어온 추정 값과 같은 대우다. 진짜 E 의 만료는 추정이 늘리지 않는다.
--      ④ 같은 창 진짜 · 진짜에서 둘 다 남은 값이 없으면 쓰지 않는다(예전 10번 줄은 I 로 덮었다 — 바뀌는 것이 만료 30초 안쪽뿐).
--
-- 3. `beds24_credit_usage_windows` 결과 순서를 전체 순서로.
--    `order by s.win nulls last` 뿐이라 같은 창 안의 줄 순서가 정해지지 않았다. 앱이 결과를 1,000줄씩
--    `.range()` 로 나눠 읽으므로 묶음 키 전부(actor_kind · actor_user_id · actor_job · feature)를 뒤에 붙인다.
--    group by 키 전부라 결과 줄마다 정렬 키가 다르다 → 완전히 정해진 순서. 인자 · 반환 칸 · 의미는 그대로.
--
-- 대시보드 SQL 편집기에 통째로 붙여 한 번에 돌린다. 두 번 돌려도 안전하다(drop if exists · create or replace).
--
-- 적용 필요: 운영 Supabase 에 아직 적용 전.
-- 되돌리기: 202611180003_beds24_credit_usage.sql 의 정책 블록(drop policy … create policy …) ·
--   `beds24_credit_usage_windows` · `beds24_record_account_credit` 정의를 그대로 다시 돌린다(같은 이름 · 같은 인자라 create or replace 로 덮인다).

-- ---------------------------------------------------------------------------
-- 1. 읽기 정책 — ops_admin.access + admin_web.access
-- ---------------------------------------------------------------------------
drop policy if exists "ops admins can read beds24 credit usage" on public.beds24_credit_usage;
create policy "ops admins can read beds24 credit usage"
on public.beds24_credit_usage
for select
to authenticated
using (
  organization_id = any ((select public.capability_organization_ids('ops_admin.access'))::uuid[])
  and organization_id = any ((select public.capability_organization_ids('admin_web.access'))::uuid[])
);

-- ---------------------------------------------------------------------------
-- 2. 창별 집계 — 전체 순서(묶음 키 전부)
-- ---------------------------------------------------------------------------
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
  -- group by 키 전부 = 전체 순서(.range() 페이지가 겹치거나 빠지지 않게).
  order by s.win nulls last, s.actor_kind, s.actor_user_id nulls last, s.actor_job nulls last, s.feature;
$$;

comment on function public.beds24_credit_usage_windows(uuid, timestamptz, timestamptz, text) is
  'Beds24 크레딧 기록을 5분 창 × 누가 × 어디에로 묶는다(이 조직 줄 + 조직 없는 줄). 순서는 묶음 키 전부(전체 순서 — 나눠 읽기용). service role 전용. 계산은 src/lib/beds24/credit-usage-model.ts.';

revoke all on function public.beds24_credit_usage_windows(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.beds24_credit_usage_windows(uuid, timestamptz, timestamptz, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. 계정 마지막 값 쓰기 — 「같은 창인가」 한 판정
-- ---------------------------------------------------------------------------
-- 용어: E = 있는 줄, I = 들어온 값. 「살아 있음」= expires_at > now(). 「추정」= metadata.expiresEstimated = true.
-- 관계(I, E) 는 머리말 2번의 표. 위에서부터 처음 맞는 줄로 정한다.
--   #   상황                                   결과
--   1   E 없음                                 쓴다(insert)
--   2   E 지남                                 쓴다(통째로 I — 추정 · 지난 값 포함)
--   3   E 살아 있음 · I 이미 지남(진짜 · 추정)  안 쓴다
--   4   관계 = 옛 창                           안 쓴다
--   5   관계 = 새 창                           쓴다 — 통째로 I(I 남은 값이 비어 있어도)
--   6   관계 = 같은 창                         남은 값 = 작은 쪽(한쪽만 숫자면 그 값). 만료 · resetsAt · 추정 표시 = 진짜 쪽
--                                              (둘 다 진짜 → I, 추정 E · 진짜 I → I, 진짜 E · 추정 I → E,
--                                              둘 다 추정 → 남기는 남은 값을 찍은 호출의 추정 만료). I 에 없는 칸(limit 등)은 E 것을 남긴다.
--                                              바뀌는 것이 없으면 안 쓴다: I 남은 값이 E 보다 작거나 같은 숫자가 아니고,
--                                              「추정 E · 진짜 I」(진짜 만료가 새로 생김)도 아니면.
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
  v_slack constant interval := interval '30 seconds';
  v_row public.beds24_sync_locks%rowtype;
  v_in_est boolean := coalesce(p_metadata -> 'expiresEstimated' = 'true'::jsonb, false);
  v_old_est boolean;
  v_in_rem numeric := case when jsonb_typeof(p_metadata -> 'remaining') = 'number'
    then (p_metadata ->> 'remaining')::numeric end;
  v_old_rem numeric;
  v_rel text;
  v_lower boolean;
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
  v_old_est := coalesce(v_row.metadata -> 'expiresEstimated' = 'true'::jsonb, false);
  v_old_rem := case when jsonb_typeof(v_row.metadata -> 'remaining') = 'number'
    then (v_row.metadata ->> 'remaining')::numeric end;

  -- 관계(I, E) — 판정은 여기 한 곳.
  if v_row.expires_at <= v_now then
    v_rel := 'newer';                                   -- 2
  elsif p_expires_at <= v_now then
    return;                                             -- 3
  elsif not v_old_est and not v_in_est then
    v_rel := case
      when p_expires_at < v_row.expires_at - v_slack then 'older'
      when p_expires_at > v_row.expires_at + v_slack then 'newer'
      else 'same' end;
  elsif not v_old_est and v_in_est then
    v_rel := case when p_expires_at > v_row.expires_at + v_slack then 'same' else 'older' end;
  elsif v_old_est and not v_in_est then
    v_rel := case when v_row.expires_at > p_expires_at + v_slack then 'same' else 'newer' end;
  else
    v_rel := 'same';                                    -- 추정끼리: 가를 근거 없음(남은 한계 ①)
  end if;

  -- 4
  if v_rel = 'older' then
    return;
  end if;

  -- 6
  if v_rel = 'same' then
    v_lower := v_in_rem is not null and (v_old_rem is null or v_in_rem <= v_old_rem);
    if not v_lower and not (v_old_est and not v_in_est) then
      return;
    end if;
    -- I 에 없는 칸(예: limit)은 E 것을 남긴다. 추정 표시는 아래에서 정한다.
    v_metadata := (v_row.metadata - 'expiresEstimated') || (p_metadata - 'expiresEstimated');
    if v_in_est and not v_old_est then
      -- 진짜 E · 추정 I: 만료 · resetsAt 은 E(추정 만료가 진짜 창을 늘리지 않게).
      v_expires := v_row.expires_at;
      v_metadata := v_metadata
        || jsonb_build_object('resetsAt', coalesce(v_row.metadata -> 'resetsAt', 'null'::jsonb));
    elsif v_in_est then
      -- 추정끼리(여기 오면 I 남은 값이 더 작다): 만료는 **남기는 남은 값을 찍은 호출의 것**(= I 추정 만료).
      -- 만료가 곧 판정 기준 시각이라, 남은 값과 다른 호출의 시각을 남기면 이어 오는 진짜 값의 창을 잘못 가른다.
      v_expires := p_expires_at;
      v_metadata := v_metadata || '{"expiresEstimated": true}'::jsonb;
    end if;
    if not v_lower then
      v_metadata := v_metadata || jsonb_build_object('remaining', coalesce(v_row.metadata -> 'remaining', 'null'::jsonb));
    end if;
  end if;

  -- 2 · 5 · 6 쓰기
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
  'beds24_sync_locks account_credit 줄 쓰기. 모든 조합이 한 판정 관계(I, E) = 옛 창 · 같은 창 · 새 창(추정 값 호출 시각 = 만료 − 300초, 시계 여유 30초)을 쓴다 — 옛 창 · 지난 값은 안 쓰고, 같은 창은 작은 남은 값 · 진짜 만료, 새 창은 통째로. 202611180004 머리말 · docs/engineering/01 「크레딧 사용 기록」. service role 전용.';

revoke all on function public.beds24_record_account_credit(timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.beds24_record_account_credit(timestamptz, text, jsonb) to service_role;
