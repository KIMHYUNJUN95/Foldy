-- 판매 캘린더 바꾸기 권한 키 `ops_calendar.write` (2026-10-20, 권한 정리 5-1).
--
-- 보기는 `ops_admin.access`, 쓰기(가격 · 최소숙박 · 차단 · 수기 예약 · 예약 수정 · 옮기기 · 취소 · 되돌리기 · 대기 가격 보내기)는 이 키.
-- 기본 역할은 대표 · 전무로 `ops_admin.access` 와 같아 지금 쓰는 사람에게는 달라지는 게 없다. 판정은 앱 서버 액션이 한다(RLS 와 무관) —
-- 이 표는 `has_capability` 가 읽는 DB 사본이다. 레지스트리 생성 구간(202609100001)도 같이 고쳤다.

insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass) values
  ('ops_calendar.write', true, true, true)
on conflict (capability) do update set
  individual_grant = excluded.individual_grant,
  individual_deny = excluded.individual_deny,
  platform_bypass = excluded.platform_bypass;

insert into public.capability_roles (capability, role) values
  ('ops_calendar.write', 'owner'::public.organization_role),
  ('ops_calendar.write', 'senior_managing_director'::public.organization_role)
on conflict do nothing;
