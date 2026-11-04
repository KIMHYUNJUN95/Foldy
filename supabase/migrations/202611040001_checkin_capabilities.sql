-- 셀프 체크인 권한 키 등록 (2026-11-04, 44 FR-S09 · 43 §8-16).
--
-- 기본 대표 · 전무(개발자는 platform_bypass), 그 밖은 개인 부여만 — 기한 없음 · 차단 없음(`ops_admin.access` 와 같은 정책).
-- 판정은 앱 서버(레지스트리 `src/config/capabilities.ts`) — 이 표는 DB 사본이다. `checkin` 표에는 이 키를 보는 RLS 정책이 없다(직원도 service_role 서버 액션으로만).
-- `checkin` 스키마와 무관하게 먼저 적용해도 안전하다(키만 등록).
insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass) values
  ('checkin.view', true, false, true),
  ('checkin.documents', true, false, true),
  ('checkin.manage', true, false, true)
on conflict (capability) do update set
  individual_grant = excluded.individual_grant,
  individual_deny = excluded.individual_deny,
  platform_bypass = excluded.platform_bypass;

insert into public.capability_roles (capability, role) values
  ('checkin.view', 'owner'::organization_role),
  ('checkin.view', 'senior_managing_director'::organization_role),
  ('checkin.documents', 'owner'::organization_role),
  ('checkin.documents', 'senior_managing_director'::organization_role),
  ('checkin.manage', 'owner'::organization_role),
  ('checkin.manage', 'senior_managing_director'::organization_role)
on conflict do nothing;
