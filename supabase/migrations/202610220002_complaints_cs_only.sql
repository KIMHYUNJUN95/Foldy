-- 게스트 피드백(컴플레인 · 리뷰) 작성 · 관리 · 댓글 = CS 관리자 (2026-10-22).
--
-- 도메인 계약: docs/product/27-permission-override-workflow.md 「역할 = 기본 틀」 표, docs/product/25-complaint-workflow.md
-- 원본: src/config/capabilities.ts (시드 202609100001 과 같은 값)
--
-- 사용자: 「게스트 피드백은 누구나 볼 수는 있지만 댓글 달거나 컴플레인 등록하거나 등은 전부 CS 관리자 권한뿐」.
-- 역할 기본: 대표 · 전무 · CS 관리자(개발자는 늘 통과). 오피스 관리자 · 현장 관리자는 기본에서 빠지고, 필요하면 사람마다 켠다.
delete from public.capability_roles
where (capability = 'complaint.write' and role = 'office_admin')
   or (capability = 'complaint.manage' and role = 'office_admin')
   or (capability = 'complaint.comment' and role in ('office_admin', 'field_manager'));

insert into public.capability_roles (capability, role) values
  ('complaint.manage', 'cs_staff'::organization_role)
on conflict do nothing;
