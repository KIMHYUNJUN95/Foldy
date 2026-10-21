-- 역할 = 기본 틀, 대표 · 전무 · 개발자가 사람마다 켜고 끈다 (2026-10-21).
--
-- 도메인 계약: docs/product/27-permission-override-workflow.md 「역할 = 기본 틀 · 사람마다 켜고 끈다」
--
-- 역할 이름 · 따로 붙은 표시로 고정돼 있던 권한을 권한 키로 옮긴다:
--   admin_web.access · attendance.manage · payroll.view · payroll.manage · wages.manage · transport.manage ·
--   leave.approve · lost_found.handle
-- 근태와 급여를 나눈다 — 근태를 넘겨받은 아르바이트 리더에게 동료 급여가 보이면 안 된다.
-- 예전 표시(memberships.attendance_payroll_admin · leave_approver_role · profiles.can_generate_report)는 같은 권한의
-- 개인 부여로 옮기고, 판정에서는 더 이상 보지 않는다(컬럼은 남김 — 되돌릴 때 필요).

-- 1) 새 키의 정책 · 역할 기본값 (원본: src/config/capabilities.ts, 시드 202609100001 과 같은 값)
insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass) values
  ('admin_web.access', true, true, true),
  ('attendance.manage', true, true, true),
  ('payroll.view', true, true, true),
  ('payroll.manage', true, true, true),
  ('wages.manage', true, true, true),
  ('transport.manage', true, true, true),
  ('leave.approve', true, true, true),
  ('lost_found.handle', true, true, true)
on conflict (capability) do update set
  individual_grant = excluded.individual_grant,
  individual_deny = excluded.individual_deny,
  platform_bypass = excluded.platform_bypass;

insert into public.capability_roles (capability, role) values
  ('admin_web.access', 'owner'::organization_role),
  ('admin_web.access', 'senior_managing_director'::organization_role),
  ('admin_web.access', 'office_admin'::organization_role),
  ('admin_web.access', 'cs_staff'::organization_role),
  ('admin_web.access', 'field_manager'::organization_role),
  ('admin_web.access', 'staff'::organization_role),
  ('attendance.manage', 'owner'::organization_role),
  ('attendance.manage', 'senior_managing_director'::organization_role),
  ('payroll.view', 'owner'::organization_role),
  ('payroll.view', 'senior_managing_director'::organization_role),
  ('payroll.manage', 'owner'::organization_role),
  ('payroll.manage', 'senior_managing_director'::organization_role),
  ('wages.manage', 'owner'::organization_role),
  ('wages.manage', 'senior_managing_director'::organization_role),
  ('transport.manage', 'owner'::organization_role),
  ('transport.manage', 'senior_managing_director'::organization_role),
  ('leave.approve', 'owner'::organization_role),
  ('leave.approve', 'senior_managing_director'::organization_role),
  ('lost_found.handle', 'owner'::organization_role),
  ('lost_found.handle', 'senior_managing_director'::organization_role),
  ('lost_found.handle', 'office_admin'::organization_role),
  ('lost_found.handle', 'cs_staff'::organization_role),
  ('lost_found.handle', 'field_manager'::organization_role),
  ('lost_found.handle', 'staff'::organization_role)
on conflict do nothing;

-- 2) 예전 표시 → 개인 부여 (역할 기본으로 이미 가진 사람은 건너뜀). 부여자는 활성 플랫폼 개발자 중 본인이 아닌 사람.
with granter as (
  select pa.user_id from public.platform_admins pa where pa.is_active order by pa.created_at limit 2
),
flagged as (
  select m.organization_id, m.user_id, k.key
  from public.memberships m
  cross join lateral (
    select unnest(array['attendance.manage', 'payroll.view', 'payroll.manage', 'wages.manage', 'transport.manage']) as key
    where m.attendance_payroll_admin
    union all
    select 'leave.approve' where m.leave_approver_role is not null
  ) k
  where m.status = 'active'
    and m.role not in ('owner', 'senior_managing_director')
  union all
  select m.organization_id, m.user_id, 'can_generate_report'
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.status = 'active' and p.can_generate_report and m.role = 'part_time_staff'
)
insert into public.membership_permission_overrides
  (organization_id, user_id, permission_key, effect, granted_by_user_id, reason, expires_at)
select f.organization_id, f.user_id, f.key, 'grant',
  (select g.user_id from granter g where g.user_id <> f.user_id limit 1),
  'migrated from legacy flag (2026-10-21)', null
from flagged f
where exists (select 1 from granter g where g.user_id <> f.user_id)
  and not exists (
    select 1 from public.membership_permission_overrides o
    where o.organization_id = f.organization_id and o.user_id = f.user_id
      and o.permission_key = f.key and o.effect = 'grant' and o.revoked_at is null
  );

-- 3) RLS 헬퍼 — 권한 키로 판정
create or replace function public.can_manage_attendance_payroll(target_organization_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  -- 근태 표(출퇴근 · 휴게 · 정정 · 변경 기록 · QR · 시도 기록) 읽기 — 근태 관리 또는 급여 보기.
  select public.is_platform_admin()
    or public.has_capability(target_organization_id, auth.uid(), 'attendance.manage')
    or public.has_capability(target_organization_id, auth.uid(), 'payroll.view');
$function$;

create or replace function public.can_view_payroll(target_organization_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  -- 금액이 든 표(시급 · 고용형태 · 월 마감 · 추가수당) 읽기 — 근태 관리만으로는 안 열린다.
  select public.is_platform_admin()
    or public.has_capability(target_organization_id, auth.uid(), 'payroll.view')
    or public.has_capability(target_organization_id, auth.uid(), 'payroll.manage')
    or public.has_capability(target_organization_id, auth.uid(), 'wages.manage');
$function$;

create or replace function public.can_manage_transport(target_organization_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select public.is_platform_admin()
    or public.has_capability(target_organization_id, auth.uid(), 'transport.manage');
$function$;

create or replace function public.is_leave_approver(target_organization_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select public.is_platform_admin()
    or public.has_capability(target_organization_id, auth.uid(), 'leave.approve');
$function$;

grant execute on function public.can_view_payroll(uuid) to authenticated;
grant execute on function public.can_manage_transport(uuid) to authenticated;

-- 4) 금액 · 교통비 표는 각자의 키로
alter policy "users read own hourly rate history" on public.hourly_rate_history
  using (((select auth.uid()) is not null) and ((user_id = (select auth.uid())) or public.can_view_payroll(organization_id)));
alter policy "users read own employment type history" on public.employment_type_history
  using (((select auth.uid()) is not null) and ((user_id = (select auth.uid())) or public.can_view_payroll(organization_id)));
alter policy "users read own month snapshots" on public.attendance_month_snapshots
  using (((select auth.uid()) is not null) and ((user_id = (select auth.uid())) or public.can_view_payroll(organization_id)));
alter policy "attendance_pay_allowances_self_or_admin_select" on public.attendance_pay_allowances
  using ((organization_id = any ((select public.current_user_active_organization_ids())::uuid[]))
    and ((target_user_id = (select auth.uid())) or public.can_view_payroll(organization_id)));
alter policy "transport_reports_self_or_admin_select" on public.transport_reimbursement_reports
  using (((select auth.uid()) is not null)
    and (organization_id = any ((select public.current_user_active_organization_ids())::uuid[]))
    and ((user_id = (select auth.uid())) or public.can_manage_transport(organization_id)));
alter policy "transport_items_self_or_admin_select" on public.transport_reimbursement_items
  using (((select auth.uid()) is not null)
    and (organization_id = any ((select public.current_user_active_organization_ids())::uuid[]))
    and ((user_id = (select auth.uid())) or public.can_manage_transport(organization_id)));
alter policy "transport_images_self_or_admin_select" on public.transport_reimbursement_item_images
  using (((select auth.uid()) is not null)
    and (organization_id = any ((select public.current_user_active_organization_ids())::uuid[]))
    and ((user_id = (select auth.uid())) or public.can_manage_transport(organization_id)));
alter policy "annual_leave_baselines_self_or_admin_select" on public.annual_leave_baselines
  using (((select auth.uid()) is not null)
    and (organization_id = any ((select public.current_user_active_organization_ids())::uuid[]))
    and ((user_id = (select auth.uid())) or public.is_leave_approver(organization_id)
      or public.can_manage_attendance_payroll(organization_id)));

-- 5) 분실물 처리 — 역할 목록 대신 권한 키(작성자 본인 수정은 그대로)
alter policy "reporter or manager can update lost items" on public.lost_items
  using (((select auth.uid()) is not null)
    and ((reported_by_user_id = (select auth.uid()))
      or (select public.is_platform_admin())
      or public.has_capability(organization_id, (select auth.uid()), 'lost_found.handle')));
