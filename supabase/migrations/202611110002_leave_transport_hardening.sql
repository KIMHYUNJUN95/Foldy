-- 연차 · 교통비 점검 1차 수정 (2026-11-11).
--
-- 도메인 계약: docs/product/26-annual-leave-workflow.md 「2026-11-11 점검 수정」,
--             docs/product/21-attendance-payroll-workflow.md · 24-attendance-workflow.md 교통비 부분,
--             docs/engineering/04-data-model.md · 05-rls-permissions.md 연차 · 교통비 부분.
--
-- 담는 것:
--   1. 연차 기준 잔여 「확인 전」 표시 칸(confirmed_at · confirmed_by_user_id) — 본인 입력은 결재자가 확인할 때까지 확인 전(M11).
--      기존 행은 처음 적용할 때 한 번만 「확인됨」(confirmed_at = updated_at, 확인자 null).
--   2. 연차 신청 제출 경로 칸(submitted_via) — 상세 화면이 늘 「모바일」로 찍던 것(LOW).
--      원래 휴무로 뺀 날짜 칸(excluded_dates) — 일수 셈법 안 A(2026-11-11 사용자 결정).
--   3. 승인 한 번에 처리하는 함수 approve_annual_leave_request_atomic — 같은 사람 잠금 · 겹침 · 잔여 경합 ·
--      자기 승인 금지 · 잔여 초과 사유 저장 · 문서 번호(숫자 기준 최대 + 1)를 한 거래 안에서(M6 · M7 · M8 · LOW).
--   4. 「승인된 휴가는 조직 전원이 모든 칸을 읽는」 정책 삭제(H4). 모바일 팀 달력은 service-role 로 읽는다.
--   5. 저장소 사진 지우기: 교통비 · 연차 경로를 「올린 사람 또는 관리 권한」으로 좁힘(M13).
--   6. 교통비: 자동 연결 항목의 연결 출처 채우기(H2 기존 행) · 합계 칸을 항목에서 늘 다시 계산(M12) ·
--      잠긴 정산서(제출 · 검토 · 승인)의 항목 추가 · 수정 막기(LOW).
--
-- 배포 순서: 앱 코드가 먼저 나가도 된다 — 코드는 새 칸 · 함수가 없으면 예전 방식으로 동작한다
-- (새 칸은 `*` 로 읽고, 쓰기는 칸이 없으면 그 칸을 빼고 다시 쓰고, 승인 함수가 없으면 예전 승인 경로).
--
-- 모든 쓰기 함수는 service-role 전용이다 — 권한 판정은 서버 액션이 하고, 함수는 거래 경계를 준다
-- (20260811012820 과 같은 방식).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. 연차 기준 잔여 확인
-- ════════════════════════════════════════════════════════════════════════════

-- 이 칸이 생기기 전의 행은 전부 「확인됨」으로 채운다(사용자 결정 2026-11-11). 확인한 사람은 알 수 없어 null 로 둔다.
-- 칸을 **처음 만드는 실행에서만** 채운다 — 다시 돌려도 그 뒤 본인이 넣은 「확인 전」 행을 확인됨으로 바꾸지 않는다(멱등).
-- 채우는 동안 updated_at 트리거를 꺼서 기존 수정 시각이 바뀌지 않게 한다.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'annual_leave_baselines' and column_name = 'confirmed_at'
  ) then
    alter table public.annual_leave_baselines
      add column confirmed_at timestamptz,
      add column if not exists confirmed_by_user_id uuid references public.profiles(id) on delete set null;
    alter table public.annual_leave_baselines disable trigger annual_leave_baselines_set_updated_at;
    update public.annual_leave_baselines set confirmed_at = coalesce(updated_at, now());
    alter table public.annual_leave_baselines enable trigger annual_leave_baselines_set_updated_at;
  end if;
end $$;

alter table public.annual_leave_baselines
  add column if not exists confirmed_by_user_id uuid references public.profiles(id) on delete set null;

comment on column public.annual_leave_baselines.confirmed_at is
  '결재자가 이 기준 잔여를 확인한 시각. null = 확인 전(본인 입력 · 결재자 자기 저장). 이 칸 생기기 전 행은 updated_at 으로 확인됨 처리.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. 제출 경로
-- ════════════════════════════════════════════════════════════════════════════

alter table public.annual_leave_requests
  add column if not exists submitted_via text;

alter table public.annual_leave_requests
  drop constraint if exists annual_leave_requests_submitted_via_check;
alter table public.annual_leave_requests
  add constraint annual_leave_requests_submitted_via_check
  check (submitted_via is null or submitted_via in ('mobile', 'admin', 'admin_proxy'));

-- 원래 휴무로 뺀 날짜(2026-11-11 사용자 결정 안 A). 일수 = 기간 날짜 수 − 이 칸의 날짜 수 — 계산과 검증
-- (기간 안 · 중복 없음 · 0일 금지)은 앱의 `normalizeLeaveRequest` 한 곳이 하고, 여기서는 크기만 막는다.
-- 겹침 검사는 뺀 날짜도 기간 안으로 본다(단순 · 안전).
alter table public.annual_leave_requests
  add column if not exists excluded_dates date[] not null default '{}';

alter table public.annual_leave_requests
  drop constraint if exists annual_leave_requests_excluded_dates_max;
alter table public.annual_leave_requests
  add constraint annual_leave_requests_excluded_dates_max
  check (coalesce(array_length(excluded_dates, 1), 0) <= 60);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. 승인 함수
-- ════════════════════════════════════════════════════════════════════════════

-- 휴가 기간을 반나절 칸으로 바꾼다. 종일 d = [2d, 2d+2), 오전 = [2d, 2d+1), 오후 = [2d+1, 2d+2).
-- 같은 날 오전 + 오후는 겹치지 않는다 — 앱의 `leaveSpansOverlap` 과 같은 규칙.
create or replace function public.annual_leave_half_day_span(p_start date, p_end date, p_unit text)
returns int4range
language sql
immutable
set search_path = public
as $$
  select int4range(
    (p_start - date '2000-01-01') * 2 + case when p_unit = 'pm' then 1 else 0 end,
    (p_end - date '2000-01-01') * 2 + case when p_unit = 'am' then 1 else 2 end
  );
$$;

-- 반환값: 'ok' | 'not_found' | 'not_requested' | 'self_approval' | 'overlap' | 'stale'
--   stale = 서버가 잔여를 계산한 뒤 같은 사람의 다른 휴가가 먼저 승인됐다(잔여 경합) — 서버가 다시 계산한다.
--   p_expected_used_days = 서버가 잔여 계산에 쓴 「이 사람의 승인된 유급 + 특별 일수 합」. null 이면 확인 안 함.
create or replace function public.approve_annual_leave_request_atomic(
  p_organization_id uuid,
  p_request_id uuid,
  p_actor_user_id uuid,
  p_approved_role text,
  p_override_reason text,
  p_expected_used_days numeric
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.annual_leave_requests%rowtype;
  v_used numeric;
  v_ym text;
  v_prefix text;
  v_next integer;
begin
  select * into v_row
  from public.annual_leave_requests
  where id = p_request_id and organization_id = p_organization_id
  for update;
  if not found then return 'not_found'; end if;
  if v_row.status <> 'requested' then return 'not_requested'; end if;
  if v_row.user_id = p_actor_user_id then return 'self_approval'; end if;

  -- 같은 사람의 승인을 한 줄로 세운다 — 겹치는 두 신청 · 합치면 잔여를 넘는 두 신청이 동시에 통과하지 못한다.
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || v_row.user_id::text || ':annual_leave', 0)
  );

  if exists (
    select 1 from public.annual_leave_requests o
    where o.organization_id = p_organization_id
      and o.user_id = v_row.user_id
      and o.status = 'approved'
      and o.id <> p_request_id
      and public.annual_leave_half_day_span(o.start_date, o.end_date, o.duration_unit)
        && public.annual_leave_half_day_span(v_row.start_date, v_row.end_date, v_row.duration_unit)
  ) then
    return 'overlap';
  end if;

  if p_expected_used_days is not null then
    select coalesce(sum(days_count), 0) into v_used
    from public.annual_leave_requests
    where organization_id = p_organization_id
      and user_id = v_row.user_id
      and status = 'approved'
      and leave_type in ('paid', 'special');
    if v_used <> p_expected_used_days then return 'stale'; end if;
  end if;

  update public.annual_leave_requests
  set status = 'approved',
      approved_by_user_id = p_actor_user_id,
      approved_role = p_approved_role,
      approved_at = now(),
      balance_override_reason = nullif(btrim(coalesce(p_override_reason, '')), '')
  where id = p_request_id;

  -- 休暇届 문서 번호 AL-YYYY-MM-NNN. 숫자로 최대값을 찾는다 — 예전 글자 정렬은 999 다음 1000 을 못 찾았다.
  -- 1000 이상은 자릿수를 자르지 않는다(lpad 는 길면 잘라 버린다).
  if v_row.document_number is null then
    v_ym := to_char(timezone('Asia/Tokyo', now()), 'YYYY-MM');
    v_prefix := 'AL-' || v_ym || '-';
    perform pg_advisory_xact_lock(
      hashtextextended(p_organization_id::text || ':annual_leave_docnum:' || v_ym, 0)
    );
    select coalesce(max(substring(document_number from char_length(v_prefix) + 1)::integer), 0) + 1
      into v_next
    from public.annual_leave_requests
    where organization_id = p_organization_id
      and document_number ~ ('^AL-' || v_ym || '-[0-9]+$');
    update public.annual_leave_requests
    set document_number = v_prefix || case when v_next < 1000 then lpad(v_next::text, 3, '0') else v_next::text end
    where id = p_request_id;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.approve_annual_leave_request_atomic(uuid, uuid, uuid, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.approve_annual_leave_request_atomic(uuid, uuid, uuid, text, text, numeric)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. 승인된 휴가 조직 전체 읽기 정책 삭제 (H4)
-- ════════════════════════════════════════════════════════════════════════════
-- 이 정책은 승인된 행의 **모든 칸**(비상 연락처 · 사유 · 사진 · 결재자)을 조직 전원에게 열었고, realtime 으로도
-- 흘렀다. 모바일 팀 달력(`listApprovedLeaveForMonth`)은 service-role 로 이름 · 종류 · 기간만 읽으므로 필요 없다.
-- 사용자 세션으로 이 표를 읽는 곳은 없다(서버 읽기는 모두 service-role). 실시간 구독(관리자 연차 화면 · 근태
-- 대기열 · 모바일 내 신청 이력)은 본인 · 결재자 정책(`annual_leave_requests_self_or_approver_select`)으로 충분하다.
drop policy if exists "annual_leave_requests_org_approved_select" on public.annual_leave_requests;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. 저장소 사진 지우기 정책 (M13)
-- ════════════════════════════════════════════════════════════════════════════
-- 예전: 같은 조직 활성 멤버면 누구나 남의 교통비 영수증 · 연차 증빙 사진을 지울 수 있었다.
-- 이제: 올린 사람(owner_id) 또는 관리 권한(교통비 = transport.manage, 연차 = leave.approve) · 플랫폼 관리자.
-- 앱의 실제 지우기는 service-role 서버 액션이 하므로 이 정책은 사용자 세션의 직접 호출만 좁힌다.

drop policy if exists "org members can delete transport reimbursement images" on storage.objects;
create policy "org members can delete transport reimbursement images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'request-images'
    and array_length(string_to_array(name, '/'), 1) = 5
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 2) = 'transport-reimbursements'
    and split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (
      exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active = true)
      or (
        exists (
          select 1 from public.memberships m
          where m.organization_id::text = split_part(objects.name, '/', 1)
            and m.user_id = auth.uid()
            and m.status = 'active'
        )
        and (
          owner_id = (auth.uid())::text
          or public.has_capability(
            case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(name, '/', 1)::uuid end,
            auth.uid(),
            'transport.manage'
          )
        )
      )
    )
  );

drop policy if exists "org members can delete annual leave request images" on storage.objects;
create policy "org members can delete annual leave request images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'request-images'
    and array_length(string_to_array(name, '/'), 1) = 4
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 2) = 'annual-leave-requests'
    and split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (
      exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active = true)
      or (
        exists (
          select 1 from public.memberships m
          where m.organization_id::text = split_part(objects.name, '/', 1)
            and m.user_id = auth.uid()
            and m.status = 'active'
        )
        and (
          owner_id = (auth.uid())::text
          or public.has_capability(
            case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(name, '/', 1)::uuid end,
            auth.uid(),
            'leave.approve'
          )
        )
      )
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 6. 교통비
-- ════════════════════════════════════════════════════════════════════════════

-- 6a. 기존 「자동 연결」 행 정리 (H2). 연결 출처(linkedSourceType · linkedSourceId)가 없는 linked 행은
--     수정할 때마다 검사 트리거(validate_transport_reimbursement_item)에 걸린다. 근태 기록이 그날 · 그 사람 것으로
--     확인되면 출처를 채우고, 확인되지 않는 나머지는 직접 입력(manual)으로 돌린다. 2026-11-11 운영 기준 linked 0건.
update public.transport_reimbursement_items i
set work_context = coalesce(i.work_context, '{}'::jsonb)
  || jsonb_build_object('linkedSourceType', 'attendance', 'linkedSourceId', i.attendance_session_id::text)
where i.entry_mode = 'linked'
  and (i.work_context ->> 'linkedSourceType') is null
  and i.attendance_session_id is not null
  and exists (
    select 1 from public.attendance_sessions s
    where s.id = i.attendance_session_id
      and s.organization_id = i.organization_id
      and s.user_id = i.user_id
      and s.operating_date = i.usage_date
      and s.status <> 'invalid'
  );

update public.transport_reimbursement_items
set entry_mode = 'manual'
where entry_mode = 'linked'
  and (work_context ->> 'linkedSourceType') is null;

-- 6b. 합계 칸(total_amount_cached)을 항목에서 늘 다시 계산한다 (M12). 예전에는 앱이 항목을 쓴 뒤 따로 다시 셌고,
--     그 읽기가 실패하면 칸이 어긋났다 — 급여(이 칸)와 사람별 내보내기(항목 합)가 다른 숫자를 냈다.
create or replace function public.sync_transport_report_total()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.transport_reimbursement_reports r
    set total_amount_cached = coalesce((
      select sum(i.amount_yen) from public.transport_reimbursement_items i where i.report_id = old.report_id
    ), 0)
    where r.id = old.report_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.report_id is distinct from old.report_id or new.amount_yen is distinct from old.amount_yen) then
    update public.transport_reimbursement_reports r
    set total_amount_cached = coalesce((
      select sum(i.amount_yen) from public.transport_reimbursement_items i where i.report_id = new.report_id
    ), 0)
    where r.id = new.report_id;
  end if;
  return null;
end;
$$;

drop trigger if exists transport_reimbursement_items_sync_total on public.transport_reimbursement_items;
create trigger transport_reimbursement_items_sync_total
after insert or update or delete on public.transport_reimbursement_items
for each row execute function public.sync_transport_report_total();

-- 지금 어긋난 칸을 한 번 맞춘다(실행 전 확인 쿼리: docs/product/26 · 21 「운영 적용 순서」).
update public.transport_reimbursement_reports r
set total_amount_cached = coalesce((
  select sum(i.amount_yen) from public.transport_reimbursement_items i where i.report_id = r.id
), 0)
where r.total_amount_cached is distinct from coalesce((
  select sum(i.amount_yen) from public.transport_reimbursement_items i where i.report_id = r.id
), 0);

-- 6c. 잠긴 정산서(제출 · 검토 중 · 승인)의 항목은 추가하거나 **금액 · 날짜 · 소속 · 방식**(amount_yen · usage_date ·
--     report_id · entry_mode)을 바꿀 수 없다 (LOW). 앱은 「고칠 수 있는 상태」를 읽은 뒤 쓰는데, 그 사이 관리자가
--     승인하면 승인된 금액이 바뀔 수 있었다. 표시용 칸(work_context · memo)과 연결 칸 비우기(property_id · room_id ·
--     attendance_session_id — 건물 · 방 · 근태가 지워질 때의 set null, 건물 이름 맞바꾸기 스크립트)는 막지 않는다.
--     지우기도 막지 않는다(정산서 연쇄 삭제 · 개발용 정리 스크립트). 앱이 먼저 상태를 본다.
create or replace function public.guard_transport_item_report_editable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE'
     and new.amount_yen is not distinct from old.amount_yen
     and new.usage_date is not distinct from old.usage_date
     and new.report_id is not distinct from old.report_id
     and new.entry_mode is not distinct from old.entry_mode then
    return new;
  end if;
  -- 다른 정산서로 옮기는 경우는 나가는 쪽도 잠겨 있지 않아야 한다.
  if tg_op = 'UPDATE' and new.report_id is distinct from old.report_id then
    select status into v_status from public.transport_reimbursement_reports where id = old.report_id;
    if v_status is not null and v_status not in ('draft', 'rejected', 'changes_requested') then
      raise exception 'transport report is not editable' using errcode = 'P0001';
    end if;
  end if;
  select status into v_status
  from public.transport_reimbursement_reports
  where id = new.report_id;
  if v_status is not null and v_status not in ('draft', 'rejected', 'changes_requested') then
    raise exception 'transport report is not editable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists transport_reimbursement_items_guard_editable on public.transport_reimbursement_items;
create trigger transport_reimbursement_items_guard_editable
before insert or update on public.transport_reimbursement_items
for each row execute function public.guard_transport_item_report_editable();

revoke all on function public.sync_transport_report_total() from public, anon, authenticated;
revoke all on function public.guard_transport_item_report_editable() from public, anon, authenticated;

-- 6d. PC 교통비 화면 실시간 갱신 — 정산서 상태 · 합계가 바뀌면 관리자 화면이 새로 읽는다(2026-11-11).
--     실시간 알림은 RLS 를 따른다(본인 · 교통비 관리자만 받는다). 발행이 없는 환경(로컬 시험 DB)은 건너뛴다.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transport_reimbursement_reports'
     ) then
    alter publication supabase_realtime add table public.transport_reimbursement_reports;
  end if;
end
$$;
