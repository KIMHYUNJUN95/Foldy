-- 남이 쓴 요청(수리 · 분실물 · 주문) 삭제 권한 `request.delete_any` 에서 현장 관리자를 뺀다 (2026-11-10).
--
-- 도메인 계약: docs/product/08-maintenance-workflow.md · 09-lost-found-workflow.md · 10-order-request-workflow.md
--   「현장 관리자는 남이 쓴 요청을 지우지 못한다(본인 것만)」. 앱(src/config/capabilities.ts)과 이 표가 field_manager 를 넣고 있어
--   문서와 반대로 열려 있었다.
-- 원본: src/config/capabilities.ts (시드 202609100001 생성 구간도 같이 고쳤다 — 이미 적용된 DB 에서는 이 파일이 행을 지운다).
--
-- 영향: 요청 삭제 RLS(202610210007 — maintenance_reports · lost_items · order_requests DELETE) 와 요청 사진 Storage 삭제
--   정책(202610220001) 이 모두 `has_capability(..., 'request.delete_any')` 로 이 표를 읽으므로 이 한 줄로 같이 닫힌다.
--   본인이 쓴 요청 삭제(reported_by_user_id = auth.uid())는 그대로다. 개인 부여 · 차단은 이 키에서 닫혀 있다(individual_grant = false).
delete from public.capability_roles
where capability = 'request.delete_any'
  and role = 'field_manager'::public.organization_role;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 요청 처리 칸 보호 — 등록(INSERT) · 신고자 본인 수정(UPDATE) (2026-11-10)
--
-- 도메인 계약: docs/product/08 「Status Change Permission」 · 09 「권한」 · 10 「Status Change Permission」, docs/engineering/05-rls-permissions.md
--
-- A. INSERT 정책은 「신고자 본인 + 조직 멤버」만 본다. 그래서 처리 권한이 없는 사람도 앱을 거치지 않고 DB 에 직접 넣으면 처음부터
--    `ordered` 주문 · 완료된 수리 · 반환된 분실물을, 처리자 · 배송일 · 관리자 메모까지 채워서 만들 수 있었다. 주문 보호 트리거
--    (202610190006)는 BEFORE UPDATE 만이었다. → 처리 권한이 없으면 시작 상태 · 빈 처리 칸으로만 넣게 한다.
-- B. UPDATE 정책은 신고자 본인에게 행 전체를 연다(수리 202610210007 · 분실물 202610210005). 앱에는 신고자가 자기 신고를 고치는 화면이
--    없다 — 상태 · 처리 칸 · 본문 · 사진을 바꾸는 길은 처리 권한 키를 보는 서버 액션뿐이다. → 수리 · 분실물에 주문과 같은 칸 보호
--    트리거를 단다: 처리 권한(`maintenance_status_change` · `lost_found.handle`)이 없으면 updated_at 말고 아무 칸도 못 바꾼다.
--    행의 소속(organization_id · reported_by_user_id)은 누구도 못 바꾼다.
--
-- service_role · cron(auth.uid() 가 없는 서버 경로 — 밤 자동 폐기 `lostfound_auto_dispose` 등)은 통과한다. 서버 코드는 자체 게이트를 거친다.
-- 권한 판정은 앱과 같은 `has_capability`(역할 기본 + 개인 부여 · 차단) + 플랫폼 관리자.

-- 주문 — 등록(INSERT)만 새로. UPDATE 는 기존 `enforce_order_request_processing` 그대로.
create or replace function public.enforce_order_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (select public.is_platform_admin())
     or public.has_capability(new.organization_id, (select auth.uid()), 'order_processor') then
    return new;
  end if;
  if new.status is distinct from 'requested'::public.order_request_status
     or new.delivery_date is not null
     or new.delivery_start_date is not null
     or new.delivery_end_date is not null
     or new.admin_memo is not null then
    raise exception 'order request must start as requested with empty processing fields' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_order_request_insert() from public, anon, authenticated;

drop trigger if exists order_requests_insert_guard on public.order_requests;
create trigger order_requests_insert_guard
  before insert on public.order_requests
  for each row
  execute function public.enforce_order_request_insert();

-- 수리 · 점검 — 등록 · 수정 둘 다.
create or replace function public.enforce_maintenance_report_processing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := case when tg_op = 'INSERT' then new.organization_id else old.organization_id end;
  v_handler boolean;
  v_new jsonb;
  v_old jsonb;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and (new.organization_id is distinct from old.organization_id
          or new.reported_by_user_id is distinct from old.reported_by_user_id) then
    raise exception 'maintenance report ownership cannot change' using errcode = '42501';
  end if;

  v_handler := (select public.is_platform_admin())
    or public.has_capability(v_org, (select auth.uid()), 'maintenance_status_change');
  if v_handler then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'open'::public.maintenance_status
       or new.completed_at is not null
       or new.completed_by is not null
       or new.completed_by_admin is distinct from false
       or new.resolution_memo is not null
       or coalesce(cardinality(new.resolution_image_urls), 0) > 0 then
      raise exception 'maintenance report must start open with empty processing fields' using errcode = '42501';
    end if;
    return new;
  end if;

  -- 처리 권한 없는 사람(신고자 본인 포함)은 아무 칸도 못 바꾼다(updated_at 은 트리거가 찍는다).
  -- 단, 외래 키 `on delete set null`(청소 기록 · 예약 · 처리자 프로필이 지워질 때)은 지운 사람의 권한으로 이 행을 고치므로 막지 않는다 —
  -- 막으면 청소 기록 되돌리기 같은 남의 화면 동작이 깨진다. 그 칸이 null 로 바뀌는 것만 비교에서 뺀다.
  v_new := to_jsonb(new) - 'updated_at';
  v_old := to_jsonb(old) - 'updated_at';
  if new.cleaning_session_id is null then v_new := v_new - 'cleaning_session_id'; v_old := v_old - 'cleaning_session_id'; end if;
  if new.reservation_id is null then v_new := v_new - 'reservation_id'; v_old := v_old - 'reservation_id'; end if;
  if new.completed_by is null then v_new := v_new - 'completed_by'; v_old := v_old - 'completed_by'; end if;
  if v_new is distinct from v_old then
    raise exception 'maintenance report can only be changed by handlers' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_maintenance_report_processing() from public, anon, authenticated;

drop trigger if exists maintenance_reports_processing_guard on public.maintenance_reports;
create trigger maintenance_reports_processing_guard
  before insert or update on public.maintenance_reports
  for each row
  execute function public.enforce_maintenance_report_processing();

-- 분실물 — 등록 · 수정 둘 다.
create or replace function public.enforce_lost_item_processing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := case when tg_op = 'INSERT' then new.organization_id else old.organization_id end;
  v_handler boolean;
  v_new jsonb;
  v_old jsonb;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and (new.organization_id is distinct from old.organization_id
          or new.reported_by_user_id is distinct from old.reported_by_user_id) then
    raise exception 'lost item ownership cannot change' using errcode = '42501';
  end if;

  v_handler := (select public.is_platform_admin())
    or public.has_capability(v_org, (select auth.uid()), 'lost_found.handle');
  if v_handler then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'registered'::public.lost_item_status
       or new.handled_at is not null
       or new.handled_by is not null
       or new.handled_by_admin is distinct from false
       or new.handling_memo is not null
       or coalesce(cardinality(new.handling_image_urls), 0) > 0
       or new.return_method is not null
       or nullif(new.return_tracking_no, '') is not null
       or new.hold_until is not null
       or new.hold_reason is not null then
      raise exception 'lost item must start registered with empty processing fields' using errcode = '42501';
    end if;
    return new;
  end if;

  -- 외래 키 `on delete set null` 은 막지 않는다(수리와 같은 이유).
  v_new := to_jsonb(new) - 'updated_at';
  v_old := to_jsonb(old) - 'updated_at';
  if new.cleaning_session_id is null then v_new := v_new - 'cleaning_session_id'; v_old := v_old - 'cleaning_session_id'; end if;
  if new.reservation_id is null then v_new := v_new - 'reservation_id'; v_old := v_old - 'reservation_id'; end if;
  if new.handled_by is null then v_new := v_new - 'handled_by'; v_old := v_old - 'handled_by'; end if;
  if v_new is distinct from v_old then
    raise exception 'lost item can only be changed by handlers' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_lost_item_processing() from public, anon, authenticated;

drop trigger if exists lost_items_processing_guard on public.lost_items;
create trigger lost_items_processing_guard
  before insert or update on public.lost_items
  for each row
  execute function public.enforce_lost_item_processing();
