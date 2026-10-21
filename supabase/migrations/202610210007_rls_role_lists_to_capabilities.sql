-- DB 보안 규칙의 역할 목록 → 권한 키 (2026-10-21).
--
-- 도메인 계약: docs/engineering/05-rls-permissions.md 「역할 목록 → 권한 키」, docs/product/27-permission-override-workflow.md
--
-- 앱은 이미 권한 키(역할 기본 + 개인 부여 · 차단)로 막는다. DB 규칙이 역할 목록으로 남아 있으면 사람마다 켠 권한이 DB 에서 막히거나
-- (켠 사람의 직접 요청), 끈 권한이 DB 에서 열린다(끈 사람의 직접 요청). 권한 키가 있는 기능만 옮긴다 — 계정 · 조직 · 초대 코드 ·
-- 권한 표(memberships · organizations · invite_codes · membership_permission_overrides)와 키가 없는 예약 내부 메모 · 저장소(storage) 규칙은 그대로.
-- 역할 기본값이 예전 역할 목록과 같도록 키를 골랐다(주문 UPDATE 는 주문 처리 ∨ 남의 요청 삭제 = 예전 목록).

-- 0) 새 키 — 근태 설정(출근 장소 · QR · 등록 기기). 예전엔 대표 · 전무 · 개발자 역할 비교.
insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass)
values ('attendance.settings', true, true, true)
on conflict (capability) do update set
  individual_grant = excluded.individual_grant,
  individual_deny = excluded.individual_deny,
  platform_bypass = excluded.platform_bypass;
insert into public.capability_roles (capability, role) values
  ('attendance.settings', 'owner'::organization_role),
  ('attendance.settings', 'senior_managing_director'::organization_role)
on conflict do nothing;

-- 1) 공지
alter policy "users can read their own announcement reads" on public.announcement_reads
  using (((select auth.uid()) = user_id) or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'announcement.manage'));
alter policy "members except part time can create announcements" on public.announcements
  with check ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'announcement.create'));
alter policy "creators and admins can delete announcements" on public.announcements
  using ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'announcement.manage')
    or (created_by_user_id = (select auth.uid())
      and public.has_capability(organization_id, (select auth.uid()), 'announcement.create')));
alter policy "creators and admins can update announcements" on public.announcements
  using ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'announcement.manage')
    or (created_by_user_id = (select auth.uid())
      and public.has_capability(organization_id, (select auth.uid()), 'announcement.create')))
  with check ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'announcement.manage')
    or (created_by_user_id = (select auth.uid())
      and public.has_capability(organization_id, (select auth.uid()), 'announcement.create')));

-- 2) 근태 등록 기기
alter policy "users can read own trusted devices" on public.attendance_trusted_devices
  using (((select auth.uid()) is not null) and ((user_id = (select auth.uid())) or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'attendance.settings')));
alter policy "users or org admins can revoke trusted devices" on public.attendance_trusted_devices
  using (((select auth.uid()) is not null) and ((user_id = (select auth.uid())) or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'attendance.settings')));

-- 3) 게시판
alter policy "board comments: authors and admins can delete" on public.board_comments
  using ((created_by_user_id = (select auth.uid()))
    or public.has_capability(organization_id, (select auth.uid()), 'board.manage'));
alter policy "board posts: authors and admins can delete" on public.board_posts
  using ((created_by_user_id = (select auth.uid()))
    or public.has_capability(organization_id, (select auth.uid()), 'board.manage'));
alter policy "board posts: authors and admins can update" on public.board_posts
  using ((deleted_at is null) and ((created_by_user_id = (select auth.uid()))
    or public.has_capability(organization_id, (select auth.uid()), 'board.manage')))
  with check ((created_by_user_id = (select auth.uid()))
    or public.has_capability(organization_id, (select auth.uid()), 'board.manage'));

-- 4) 버그 신고
alter policy "bug reports: reporter or reviewer can read" on public.bug_reports
  using ((reported_by_user_id = (select auth.uid()))
    or public.has_capability(organization_id, (select auth.uid()), 'bug.review'));
alter policy "bug reports: reviewer can update status" on public.bug_reports
  using (public.has_capability(organization_id, (select auth.uid()), 'bug.review'))
  with check (public.has_capability(organization_id, (select auth.uid()), 'bug.review'));

-- 5) 청소 기록
alter policy "field members can start own cleaning sessions" on public.cleaning_sessions
  with check (((select auth.uid()) is not null) and (staff_user_id = (select auth.uid()))
    and (status = 'in_progress'::cleaning_status) and (completed_at is null) and (duration_seconds is null)
    and ((select public.is_platform_admin())
      or public.has_capability(organization_id, (select auth.uid()), 'cleaning.work')));
alter policy "members can read relevant cleaning sessions" on public.cleaning_sessions
  using (((select auth.uid()) is not null) and ((select public.is_platform_admin())
    or (staff_user_id = (select auth.uid()))
    or public.has_capability(organization_id, (select auth.uid()), 'cleaning.read_all')));
alter policy "staff can complete own active cleaning sessions" on public.cleaning_sessions
  with check (((select auth.uid()) is not null) and (staff_user_id = (select auth.uid()))
    and (status = any (array['completed'::cleaning_status, 'cancelled'::cleaning_status]))
    and (completed_at is not null) and (duration_seconds is not null)
    and ((select public.is_platform_admin())
      or public.has_capability(organization_id, (select auth.uid()), 'cleaning.work')));

-- 6) 린넨
alter policy "admins can manage linen items" on public.linen_items
  using (((select auth.uid()) is not null) and ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'linen.manage')))
  with check (((select auth.uid()) is not null) and ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'linen.manage')));
alter policy "author or admin can delete linen return records" on public.linen_return_records
  using (((select auth.uid()) is not null) and ((registered_by_user_id = (select auth.uid()))
    or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'linen.manage')));
alter policy "author or admin can update linen return records" on public.linen_return_records
  using (((select auth.uid()) is not null) and ((registered_by_user_id = (select auth.uid()))
    or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'linen.manage')));
alter policy "delete line items of editable linen return records" on public.linen_return_record_items
  using (((select auth.uid()) is not null) and exists (
    select 1 from public.linen_return_records r
    where r.id = linen_return_record_items.return_record_id
      and ((r.registered_by_user_id = (select auth.uid())) or (select public.is_platform_admin())
        or public.has_capability(r.organization_id, (select auth.uid()), 'linen.manage'))));
alter policy "mutate line items of editable linen return records" on public.linen_return_record_items
  using (((select auth.uid()) is not null) and exists (
    select 1 from public.linen_return_records r
    where r.id = linen_return_record_items.return_record_id
      and ((r.registered_by_user_id = (select auth.uid())) or (select public.is_platform_admin())
        or public.has_capability(r.organization_id, (select auth.uid()), 'linen.manage'))));
alter policy "insert line items of editable linen return records" on public.linen_return_record_items
  with check ((auth.uid() is not null) and exists (
    select 1 from public.linen_return_records r
    where r.id = linen_return_record_items.return_record_id
      and (((r.registered_by_user_id = auth.uid()) and public.has_active_membership(r.organization_id))
        or public.is_platform_admin()
        or public.has_capability(r.organization_id, auth.uid(), 'linen.manage'))));

-- 7) 요청(분실물 · 수리 · 주문)
alter policy "reporter or manager can delete lost items" on public.lost_items
  using (((select auth.uid()) is not null) and ((reported_by_user_id = (select auth.uid()))
    or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'request.delete_any')));
alter policy "reporter or manager can delete maintenance reports" on public.maintenance_reports
  using (((select auth.uid()) is not null) and ((reported_by_user_id = (select auth.uid()))
    or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'request.delete_any')));
alter policy "reporter or manager can update maintenance reports" on public.maintenance_reports
  using (((select auth.uid()) is not null) and ((reported_by_user_id = (select auth.uid()))
    or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'maintenance_status_change')));
alter policy "reporter or manager can delete order requests" on public.order_requests
  using (((select auth.uid()) is not null) and ((reported_by_user_id = (select auth.uid()))
    or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'request.delete_any')));
alter policy "reporter or manager can update order requests" on public.order_requests
  using (((select auth.uid()) is not null) and ((reported_by_user_id = (select auth.uid()))
    or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'order_processor')
    or public.has_capability(organization_id, (select auth.uid()), 'request.delete_any')));

-- 처리 칸(상태 · 배송일 · 관리자 메모)은 트리거가 주문 처리 권한으로만 바꾸게 한다.
create or replace function public.enforce_order_request_processing()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.reported_by_user_id is distinct from old.reported_by_user_id then
    raise exception 'order request ownership cannot change' using errcode = '42501';
  end if;

  if (new.status is distinct from old.status
      or new.delivery_date is distinct from old.delivery_date
      or new.delivery_start_date is distinct from old.delivery_start_date
      or new.delivery_end_date is distinct from old.delivery_end_date
      or new.admin_memo is distinct from old.admin_memo)
     and not (
       (select public.is_platform_admin())
       or public.has_capability(old.organization_id, (select auth.uid()), 'order_processor')
     ) then
    raise exception 'order request processing is office-level only' using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- 8) 건물 운영 정보
alter policy "admin members can delete property operation infos" on public.property_operation_infos
  using (((select auth.uid()) is not null) and ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'property_info.edit')));
alter policy "admin members can insert property operation infos" on public.property_operation_infos
  with check (((select auth.uid()) is not null) and ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'property_info.edit')));
alter policy "admin members can update property operation infos" on public.property_operation_infos
  using (((select auth.uid()) is not null) and ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'property_info.edit')))
  with check (((select auth.uid()) is not null) and ((select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'property_info.edit')));

-- 9) 연차 기준일수 — 시급제 역할(아르바이트 · 리더)은 연차 대상이 아니다(앱 `isLeaveHourlyRole` 과 같게).
create or replace function public.set_annual_leave_baseline_atomic(
  p_organization_id uuid,
  p_user_id uuid,
  p_hire_date date,
  p_base_amount numeric,
  p_bonus_amount numeric,
  p_baseline_date date,
  p_allow_overwrite boolean default false
)
returns text
language plpgsql
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and m.role not in ('part_time_staff', 'staff')
  ) then
    return 'target_not_found';
  end if;

  if p_base_amount < 0 or p_base_amount > 40 or p_bonus_amount < 0 or p_bonus_amount > 8 then
    return 'invalid_amount';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_user_id::text, 0));

  if not p_allow_overwrite and exists (
    select 1 from public.annual_leave_baselines
    where organization_id = p_organization_id and user_id = p_user_id
  ) then
    return 'baseline_exists';
  end if;

  update public.profiles
  set hire_date = p_hire_date
  where id = p_user_id;
  if not found then return 'target_not_found'; end if;

  insert into public.annual_leave_baselines (
    organization_id, user_id, base_amount, bonus_amount, baseline_date
  ) values (
    p_organization_id, p_user_id, p_base_amount, p_bonus_amount, p_baseline_date
  )
  on conflict (organization_id, user_id) do update
  set base_amount = excluded.base_amount,
      bonus_amount = excluded.bonus_amount,
      baseline_date = excluded.baseline_date;

  return 'ok';
end;
$function$;
