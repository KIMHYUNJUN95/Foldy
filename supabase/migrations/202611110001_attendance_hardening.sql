-- 근태 점검 1차 (2026-11-11) — 마감 · 수정 경합, 겹치는 근무, QR 토큰 읽기 범위.
--
-- 문서: docs/product/24-attendance-workflow.md 「근태 점검 1차 (2026-11-11)」, docs/engineering/04-data-model.md,
-- docs/engineering/05-rls-permissions.md.
--
-- 앱은 「읽고 확인 → 쓰기」를 따로 해서, 확인과 쓰기 사이에 다른 요청이 끼어들 수 있었다.
--   · 마감(스냅샷 저장)과 근무 수정 · 정정 승인이 동시에 오면, 마감 금액은 옛 기록으로 굳고 기록만 바뀐다.
--   · 세션 없는 정정 두 건을 동시에 승인하면 둘 다 겹침 검사를 통과해 같은 시간이 두 번 지급된다.
-- 그래서 한 사람 · 한 달마다 같은 잠금(advisory lock, 키는 20260811012820 의 함수들과 같다)을 걸고,
-- 확인과 쓰기를 한 트랜잭션 안에서 한다.
--
-- 1) 근무 행 쓰기 가드(트리거): 급여 칸이 바뀌는 넣기 · 바꾸기마다 그 사람 · 그 달 잠금을 잡고, 마감된 달이면 거절한다.
--    급여 칸이 그대로인 바꾸기(FK on delete set null 등)는 통과 — 계정 · QR 토큰 삭제를 막지 않는다.
--    잠금 순서는 어디서나 「행 → 사람 · 달」(조직 전체가 걸리면 「조직 · 달 → 사람 · 달」).
--    지우기는 막지 않는다(조직 삭제 등 cascade).
-- 2) 마감: 앱이 계산 전에 받아 둔 「지문」(그 달 급여 입력 전체의 해시)을 잠금 안에서 다시 떠서 같을 때만 저장한다.
-- 3) 근무 넣기 · 바꾸기: 잠금 안에서 마감 · 낙관적 동시성(updated_at) · 겹침을 확인하고 쓴다.
-- 3a) 정정 승인: 요청을 approved 로 바꾸는 것도 근무 넣기 · 바꾸기 함수 안(같은 트랜잭션)에서 한다.
-- 3b) 수당 쓰기 가드(트리거): 대상 있으면 사람 · 달, 조직 전체면 조직 · 달(독점) 잠금 후 마감 확인. 마감은 조직 · 달을 공유로 잡는다.
-- 4) QR 토큰 읽기는 근태 설정(attendance.settings) 권한만. 앱은 service role 로만 읽으므로 적용 전후 모두 동작한다.
--
-- 20260811012820 의 *_atomic 함수들은 지금 앱 동작(개발 서버의 이번 달 마감, 겹침 · updated_at 검사, 휴게 재작성 없음)과
-- 맞지 않아 쓰지 않는다 — 그 파일은 고치지 않고 그대로 둔다.

-- ── 공용: 한 사람 · 한 달 잠금 ─────────────────────────────────────────────────
create or replace function public.attendance_lock_user_month(p_organization_id uuid, p_user_id uuid, p_day date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_user_id::text || ':' || date_trunc('month', p_day)::date::text,
      0
    )
  );
end;
$$;

-- 조직 · 달 잠금 — 조직 전체 수당(대상 없음)은 독점으로, 마감은 공유로 잡는다. 마감끼리는 서로 막지 않고,
-- 조직 전체 수당 추가 · 취소와 그 달 어느 마감이든 서로 기다린다(리뷰 7, 2026-11-11).
create or replace function public.attendance_lock_org_month(p_organization_id uuid, p_day date, p_shared boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key bigint := hashtextextended(
    p_organization_id::text || ':org:' || date_trunc('month', p_day)::date::text, 0
  );
begin
  if p_shared then
    perform pg_advisory_xact_lock_shared(v_key);
  else
    perform pg_advisory_xact_lock(v_key);
  end if;
end;
$$;

create or replace function public.attendance_user_month_finalized(p_organization_id uuid, p_user_id uuid, p_day date)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.attendance_month_snapshots
    where organization_id = p_organization_id
      and user_id = p_user_id
      and target_month = date_trunc('month', p_day)::date
      and status = 'finalized'
  );
$$;

-- ── 1) 근무 행 쓰기 가드 ───────────────────────────────────────────────────────
create or replace function public.attendance_sessions_month_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- 급여 계산이 읽는 칸(앱 PAYROLL_SESSION_SELECT 와 같다)이 그대로인 바꾸기는 통과 — 잠금도 잡지 않는다.
  -- FK on delete set null(만든 사람 · 무효 처리한 사람 · QR 토큰 비우기)이 마감된 달에서 계정 · 토큰 삭제를 막지 않게.
  if tg_op = 'UPDATE'
     and (old.organization_id, old.user_id, old.operating_date, old.status, old.review_state,
          old.clock_in_at, old.clock_out_at, old.clock_in_site_id, old.clock_out_site_id, old.manual_created)
         is not distinct from
         (new.organization_id, new.user_id, new.operating_date, new.status, new.review_state,
          new.clock_in_at, new.clock_out_at, new.clock_in_site_id, new.clock_out_site_id, new.manual_created) then
    return new;
  end if;
  perform public.attendance_lock_user_month(new.organization_id, new.user_id, new.operating_date);
  if tg_op = 'UPDATE'
     and (old.user_id, date_trunc('month', old.operating_date)) is distinct from
         (new.user_id, date_trunc('month', new.operating_date)) then
    perform public.attendance_lock_user_month(old.organization_id, old.user_id, old.operating_date);
    if public.attendance_user_month_finalized(old.organization_id, old.user_id, old.operating_date) then
      raise exception 'attendance_month_finalized' using errcode = 'P0001';
    end if;
  end if;
  if public.attendance_user_month_finalized(new.organization_id, new.user_id, new.operating_date) then
    raise exception 'attendance_month_finalized' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_sessions_month_guard on public.attendance_sessions;
create trigger attendance_sessions_month_guard
before insert or update on public.attendance_sessions
for each row execute function public.attendance_sessions_month_guard();

-- ── 2) 마감 — 지문 비교 후 저장 ─────────────────────────────────────────────────
-- 지문 = 그 사람 · 그 달의 급여 입력 전체(근무 · 휴게 · 정정 요청 · 수당 · 시급 · 고용형태)를 행 그대로 이은 해시.
-- 앱이 금액을 계산하기 **전에** 받고, 저장할 때 잠금 안에서 다시 떠 비교한다 — 그 사이 무엇이든 바뀌면 다르다.
create or replace function public.attendance_month_fingerprint(
  p_organization_id uuid,
  p_user_id uuid,
  p_target_month date
)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  with month_sessions as (
    select s.* from public.attendance_sessions s
    where s.organization_id = p_organization_id and s.user_id = p_user_id
      and s.operating_date >= p_target_month
      and s.operating_date < (p_target_month + interval '1 month')::date
  )
  select md5(concat_ws('#',
    (select string_agg(s::text, '|' order by s.id) from month_sessions s),
    (select string_agg(b::text, '|' order by b.id)
       from public.attendance_breaks b where b.session_id in (select id from month_sessions)),
    (select string_agg(r::text, '|' order by r.id)
       from public.attendance_correction_requests r
       where r.organization_id = p_organization_id and r.requested_by_user_id = p_user_id
         and (r.session_id in (select id from month_sessions) or (r.session_id is null and r.target_month = p_target_month))),
    (select string_agg(a::text, '|' order by a.id)
       from public.attendance_pay_allowances a
       where a.organization_id = p_organization_id
         and (a.target_user_id is null or a.target_user_id = p_user_id)
         and a.target_date >= p_target_month
         and a.target_date < (p_target_month + interval '1 month')::date),
    (select string_agg(h::text, '|' order by h.id)
       from public.hourly_rate_history h where h.organization_id = p_organization_id and h.user_id = p_user_id),
    (select string_agg(e::text, '|' order by e.id)
       from public.employment_type_history e where e.organization_id = p_organization_id and e.user_id = p_user_id)
  ));
$$;

create or replace function public.finalize_attendance_month_checked(
  p_organization_id uuid,
  p_user_id uuid,
  p_target_month date,
  p_actor_user_id uuid,
  p_expected_fingerprint text,
  p_total_paid_minutes integer,
  p_gross_amount numeric,
  p_rate_breakdown jsonb,
  p_allowance_breakdown jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prior_id uuid;
  v_snapshot_id uuid;
begin
  -- 잠금 순서: 조직 · 달(공유) → 사람 · 달. 조직 전체 수당 트리거는 조직 · 달(독점)만 잡는다.
  perform public.attendance_lock_org_month(p_organization_id, p_target_month, true);
  perform public.attendance_lock_user_month(p_organization_id, p_user_id, p_target_month);

  if public.attendance_user_month_finalized(p_organization_id, p_user_id, p_target_month) then
    return jsonb_build_object('result', 'already_finalized');
  end if;
  if p_expected_fingerprint is null
     or public.attendance_month_fingerprint(p_organization_id, p_user_id, p_target_month) <> p_expected_fingerprint then
    return jsonb_build_object('result', 'stale');
  end if;

  select id into v_prior_id
  from public.attendance_month_snapshots
  where organization_id = p_organization_id and user_id = p_user_id
    and target_month = p_target_month and status <> 'superseded'
  order by created_at desc
  limit 1;

  update public.attendance_month_snapshots
  set status = 'superseded'
  where organization_id = p_organization_id and user_id = p_user_id
    and target_month = p_target_month and status <> 'superseded';

  insert into public.attendance_month_snapshots (
    organization_id, user_id, target_month, status, total_paid_minutes, gross_amount,
    rate_breakdown, allowance_breakdown, finalized_by_user_id, finalized_at, supersedes_snapshot_id
  ) values (
    p_organization_id, p_user_id, p_target_month, 'finalized', p_total_paid_minutes, p_gross_amount,
    coalesce(p_rate_breakdown, '[]'::jsonb), coalesce(p_allowance_breakdown, '[]'::jsonb),
    p_actor_user_id, now(), v_prior_id
  ) returning id into v_snapshot_id;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_organization_id, p_actor_user_id, 'attendance_month_finalize', 'attendance_month_snapshot', v_snapshot_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'target_month', p_target_month,
      'gross_amount', p_gross_amount,
      'total_paid_minutes', p_total_paid_minutes,
      'supersedes_snapshot_id', v_prior_id
    )
  );

  return jsonb_build_object('result', 'ok', 'id', v_snapshot_id);
end;
$$;

-- ── 3) 근무 넣기 · 바꾸기 — 잠금 안에서 확인 ────────────────────────────────────
-- 겹침 규칙은 앱의 `findOverlappingSession`(src/lib/attendance-overlap.ts)과 같다: [출근, 퇴근) 이 겹치면 겹침,
-- 맞닿기만 하면 아님. 근무 중(open · reopened)은 끝이 열린 것, 퇴근 없이 넘어간 것(abandoned)은 출근 한 점.
create or replace function public.attendance_session_overlaps(
  p_organization_id uuid,
  p_user_id uuid,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
  p_exclude_session_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.attendance_sessions s
    cross join lateral (
      select
        s.clock_in_at as o_start,
        coalesce(
          s.clock_out_at,
          case when s.status in ('open', 'reopened') then 'infinity'::timestamptz else s.clock_in_at end
        ) as o_end
    ) w
    where s.organization_id = p_organization_id
      and s.user_id = p_user_id
      and s.status <> 'invalid'
      and s.clock_in_at is not null
      and (p_exclude_session_id is null or s.id <> p_exclude_session_id)
      and case
        when w.o_end = w.o_start then
          p_clock_in_at <= w.o_start and w.o_start < coalesce(p_clock_out_at, 'infinity'::timestamptz)
        else
          p_clock_in_at < w.o_end and w.o_start < coalesce(p_clock_out_at, 'infinity'::timestamptz)
      end
  );
$$;

-- 정정 요청을 「승인」으로 — 근무 반영과 같은 트랜잭션에서(리뷰 6, 2026-11-11). 내가 잡은 in_review 일 때만.
-- p_approve: {id, actor_user_id, comment, reviewed_at}. 바꾼 행이 없으면 false.
create or replace function public.attendance_approve_request_in_tx(p_organization_id uuid, p_approve jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.attendance_correction_requests
  set status = 'approved',
      review_comment = nullif(p_approve ->> 'comment', ''),
      reviewed_by_user_id = (p_approve ->> 'actor_user_id')::uuid,
      reviewed_at = coalesce((p_approve ->> 'reviewed_at')::timestamptz, now())
  where id = (p_approve ->> 'id')::uuid
    and organization_id = p_organization_id
    and status = 'in_review'
    and reviewed_by_user_id = (p_approve ->> 'actor_user_id')::uuid
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- 인자가 바뀐 함수는 옛 버전을 먼저 지운다 — 기본값 인자 때문에 옛 · 새 두 버전이 함께 있으면 호출이 애매해진다(is not unique).
drop function if exists public.attendance_insert_session_checked(jsonb);
create or replace function public.attendance_insert_session_checked(p_values jsonb, p_approve_request jsonb default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := (p_values ->> 'organization_id')::uuid;
  v_user uuid := (p_values ->> 'user_id')::uuid;
  v_day date := (p_values ->> 'operating_date')::date;
  v_in timestamptz := (p_values ->> 'clock_in_at')::timestamptz;
  v_out timestamptz := (p_values ->> 'clock_out_at')::timestamptz;
  v_id uuid;
begin
  if v_org is null or v_user is null or v_day is null or v_in is null then
    return jsonb_build_object('result', 'invalid');
  end if;
  perform public.attendance_lock_user_month(v_org, v_user, v_day);
  if public.attendance_user_month_finalized(v_org, v_user, v_day) then
    return jsonb_build_object('result', 'finalized');
  end if;
  if public.attendance_session_overlaps(v_org, v_user, v_in, v_out, null) then
    return jsonb_build_object('result', 'overlap');
  end if;
  begin
    insert into public.attendance_sessions (
      organization_id, user_id, operating_date, status, review_state,
      clock_in_at, clock_in_site_id, clock_in_method,
      clock_out_at, clock_out_site_id, clock_out_method,
      manual_location, manual_created, manual_created_by_user_id, manual_created_reason
    ) values (
      v_org, v_user, v_day, p_values ->> 'status', p_values ->> 'review_state',
      v_in, (p_values ->> 'clock_in_site_id')::uuid, p_values ->> 'clock_in_method',
      v_out, (p_values ->> 'clock_out_site_id')::uuid, p_values ->> 'clock_out_method',
      p_values ->> 'manual_location', coalesce((p_values ->> 'manual_created')::boolean, false),
      (p_values ->> 'manual_created_by_user_id')::uuid, p_values ->> 'manual_created_reason'
    ) returning id into v_id;
    -- 세션 없는 정정 승인: 요청 상태도 여기서. 못 바꾸면(그 사이 다른 처리) 넣은 근무까지 이 블록째 되돌린다.
    if p_approve_request is not null and not public.attendance_approve_request_in_tx(v_org, p_approve_request) then
      raise exception 'attendance_request_changed' using errcode = 'P0001';
    end if;
  exception
    when unique_violation then
      -- 열린 근무는 사람당 하나(attendance_sessions_one_open_per_user_idx).
      return jsonb_build_object('result', 'open_conflict');
    when raise_exception then
      if sqlerrm = 'attendance_request_changed' then
        return jsonb_build_object('result', 'request_changed');
      end if;
      raise;
  end;
  return jsonb_build_object('result', 'ok', 'id', v_id);
end;
$$;

drop function if exists public.attendance_update_session_checked(uuid, uuid, timestamptz, jsonb);
create or replace function public.attendance_update_session_checked(
  p_organization_id uuid,
  p_session_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_approve_request jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid;
  v_day date;
  v_row public.attendance_sessions;
  v_in timestamptz;
  v_out timestamptz;
  v_status text;
  v_updated_at timestamptz;
begin
  -- 잠금 순서: 행 잠금(FOR UPDATE) → 사람 · 달 잠금. 앱이 직접 하는 UPDATE(퇴근 · 미퇴근 처리)도 행을 먼저 잡고 트리거에서
  -- 사람 · 달 잠금을 잡으므로 같은 순서다 — 반대로 잡으면 서로 기다리는 교착이 생긴다(리뷰 2, 2026-11-11).
  -- 사람 · 운영일은 이 함수가 바꾸지 않으므로 행을 잡은 뒤 잠금 키가 달라지지 않는다.
  select * into v_row
  from public.attendance_sessions
  where id = p_session_id and organization_id = p_organization_id
  for update;
  if v_row.id is null then
    return jsonb_build_object('result', 'not_found');
  end if;
  v_user := v_row.user_id;
  v_day := v_row.operating_date;
  perform public.attendance_lock_user_month(p_organization_id, v_user, v_day);
  if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('result', 'stale');
  end if;
  if public.attendance_user_month_finalized(p_organization_id, v_row.user_id, v_row.operating_date) then
    return jsonb_build_object('result', 'finalized');
  end if;

  v_in := case when p_changes ? 'clock_in_at' then (p_changes ->> 'clock_in_at')::timestamptz else v_row.clock_in_at end;
  v_out := case when p_changes ? 'clock_out_at' then (p_changes ->> 'clock_out_at')::timestamptz else v_row.clock_out_at end;
  v_status := case when p_changes ? 'status' then p_changes ->> 'status' else v_row.status end;

  -- 시각이 바뀌었거나 무효에서 되살릴 때만 겹침을 본다(검토 표시만 바꾸는 수정은 안 본다 — 앱과 같다).
  if v_status <> 'invalid' and v_in is not null
     and (v_in is distinct from v_row.clock_in_at or v_out is distinct from v_row.clock_out_at or v_row.status = 'invalid')
     and public.attendance_session_overlaps(p_organization_id, v_row.user_id, v_in, v_out, v_row.id) then
    return jsonb_build_object('result', 'overlap');
  end if;
  -- 세션 정정 승인: 요청 상태를 같은 트랜잭션에서 먼저 — 못 바꾸면 아무것도 쓰지 않는다(리뷰 6).
  if p_approve_request is not null and not public.attendance_approve_request_in_tx(p_organization_id, p_approve_request) then
    return jsonb_build_object('result', 'request_changed');
  end if;

  update public.attendance_sessions
  set clock_in_at = v_in,
      clock_out_at = v_out,
      clock_in_site_id = case when p_changes ? 'clock_in_site_id' then (p_changes ->> 'clock_in_site_id')::uuid else clock_in_site_id end,
      clock_out_site_id = case when p_changes ? 'clock_out_site_id' then (p_changes ->> 'clock_out_site_id')::uuid else clock_out_site_id end,
      status = v_status,
      review_state = case when p_changes ? 'review_state' then p_changes ->> 'review_state' else review_state end,
      invalidated_at = case when p_changes ? 'invalidated_at' then (p_changes ->> 'invalidated_at')::timestamptz else invalidated_at end,
      invalidated_by_user_id = case when p_changes ? 'invalidated_by_user_id' then (p_changes ->> 'invalidated_by_user_id')::uuid else invalidated_by_user_id end,
      invalidated_reason = case when p_changes ? 'invalidated_reason' then p_changes ->> 'invalidated_reason' else invalidated_reason end,
      abandoned_at = case when p_changes ? 'abandoned_at' then (p_changes ->> 'abandoned_at')::timestamptz else abandoned_at end
  where id = v_row.id
  returning updated_at into v_updated_at;

  return jsonb_build_object('result', 'ok', 'updated_at', v_updated_at);
end;
$$;

-- ── 수당 쓰기 가드 (리뷰 7, 2026-11-11) ────────────────────────────────────────
-- 수당 추가 · 취소도 근무처럼 잠금 안에서 마감을 확인한다. 대상이 있으면 그 사람 · 달, 없으면(조직 전체) 조직 · 달 독점 잠금 후
-- 그 달 마감이 하나라도 있으면 거절 — 앱의 isUserMonthFinalized / anyUserMonthFinalized 와 같은 규칙. 급여 칸은 대상 · 날짜 · 상태 ·
-- 금액 · 종류 · 구분(category — 추가수당 / 특별수당 열을 가른다). 급여에 닿지 않는 칸만
-- 바뀌면(메모 등) 통과, 지우기는 막지 않는다.
create or replace function public.attendance_pay_allowances_month_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rec record;
begin
  if tg_op = 'UPDATE'
     and (old.organization_id, old.target_user_id, old.target_date, old.status, old.amount_yen, old.allowance_type, old.category)
         is not distinct from
         (new.organization_id, new.target_user_id, new.target_date, new.status, new.amount_yen, new.allowance_type, new.category) then
    return new;
  end if;
  for v_rec in
    select new.organization_id as org, new.target_user_id as usr, new.target_date as day
    union
    select old.organization_id, old.target_user_id, old.target_date where tg_op = 'UPDATE'
  loop
    if v_rec.usr is not null then
      perform public.attendance_lock_user_month(v_rec.org, v_rec.usr, v_rec.day);
      if public.attendance_user_month_finalized(v_rec.org, v_rec.usr, v_rec.day) then
        raise exception 'attendance_month_finalized' using errcode = 'P0001';
      end if;
    else
      perform public.attendance_lock_org_month(v_rec.org, v_rec.day, false);
      if exists (
        select 1 from public.attendance_month_snapshots
        where organization_id = v_rec.org
          and target_month = date_trunc('month', v_rec.day)::date
          and status = 'finalized'
      ) then
        raise exception 'attendance_month_finalized' using errcode = 'P0001';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists attendance_pay_allowances_month_guard on public.attendance_pay_allowances;
create trigger attendance_pay_allowances_month_guard
before insert or update on public.attendance_pay_allowances
for each row execute function public.attendance_pay_allowances_month_guard();

-- service role 전용 — 권한 확인은 서버 액션이 하고, DB 함수는 트랜잭션 경계만 맡는다.
revoke all on function public.attendance_lock_user_month(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.attendance_user_month_finalized(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.attendance_month_fingerprint(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.finalize_attendance_month_checked(uuid, uuid, date, uuid, text, integer, numeric, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.attendance_session_overlaps(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.attendance_insert_session_checked(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.attendance_update_session_checked(uuid, uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.attendance_sessions_month_guard() from public, anon, authenticated;
revoke all on function public.attendance_lock_org_month(uuid, date, boolean) from public, anon, authenticated;
revoke all on function public.attendance_approve_request_in_tx(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.attendance_pay_allowances_month_guard() from public, anon, authenticated;

grant execute on function public.attendance_lock_user_month(uuid, uuid, date) to service_role;
grant execute on function public.attendance_lock_org_month(uuid, date, boolean) to service_role;
grant execute on function public.attendance_approve_request_in_tx(uuid, jsonb) to service_role;
grant execute on function public.attendance_user_month_finalized(uuid, uuid, date) to service_role;
grant execute on function public.attendance_month_fingerprint(uuid, uuid, date) to service_role;
grant execute on function public.finalize_attendance_month_checked(uuid, uuid, date, uuid, text, integer, numeric, jsonb, jsonb)
  to service_role;
grant execute on function public.attendance_session_overlaps(uuid, uuid, timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.attendance_insert_session_checked(jsonb, jsonb) to service_role;
grant execute on function public.attendance_update_session_checked(uuid, uuid, timestamptz, jsonb, jsonb) to service_role;

-- ── 4) QR 토큰 읽기 — 근태 설정 권한만 ──────────────────────────────────────────
-- 예전: 근태 관리 · 급여 보기(can_manage_attendance_payroll)면 토큰 원문을 읽을 수 있었다 — 급여 담당이 토큰을 들고
-- 현장 밖에서 QR 을 만들 수 있는 셈. 앱의 토큰 읽기(打刻 · 설정 · 인쇄)는 전부 service role 이라 영향이 없다.
drop policy if exists "attendance admins can read qr tokens" on public.attendance_qr_tokens;
drop policy if exists "attendance settings can read qr tokens" on public.attendance_qr_tokens;
create policy "attendance settings can read qr tokens"
on public.attendance_qr_tokens
for select
using (
  (select auth.uid()) is not null
  and (
    public.is_platform_admin()
    or public.has_capability(organization_id, (select auth.uid()), 'attendance.settings')
  )
);

-- ── 5) 급여 · 시급 화면 실시간 신호 (2026-11-11) ──────────────────────────────────
-- PC 급여 · 시급 화면이 다른 사람의 마감 · 수당 · 시급 변경을 따라오게(`attendancePayrollLiveSources` ·
-- `attendanceWagesLiveSources`). 신호만 쓰고, 각 테이블의 select RLS 를 그대로 통과한 행의 신호만 온다(202610290001 과 같은 방식).
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array[
    'attendance_month_snapshots',
    'attendance_pay_allowances',
    'hourly_rate_history',
    'employment_type_history'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
