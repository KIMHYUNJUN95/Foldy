-- 아르바이트 리더(`staff`) = 알바 기본, 청소 배정은 사무실도 (2026-10-21).
--
-- 도메인 계약: docs/product/27-permission-override-workflow.md 「역할 = 기본 틀」 표
-- 원본: src/config/capabilities.ts (시드 202609100001 과 같은 값)
--
-- 사용자: 「리더는 정직원이 아니라 오래 일해서 정직원 대신 업무를 해 주는 알바. 누구를 서포트하느냐에 따라 업무가 많이 달라진다.」
-- → 리더의 역할 기본은 아르바이트와 같게(청소 작업만) 두고, 필요한 권한은 사람마다 켠다.
-- 「청소 배정은 사무실 알바 리더와 현장 직원이 나눠서 한다, CS 는 안 한다」 → 오피스 관리자 기본에 청소 배정 추가.
delete from public.capability_roles
where role = 'staff'
  and capability in (
    'maintenance_status_change',
    'can_generate_report',
    'announcement.create',
    'complaint.comment',
    'admin_web.access',
    'lost_found.handle'
  );

insert into public.capability_roles (capability, role) values
  ('cleaning.assign', 'office_admin'::organization_role)
on conflict do nothing;
