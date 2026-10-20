-- 사용자 관리 권한 키 `user.manage` 를 대표 · 전무에게 역할로 기본 부여 (2026-10-20, 사용자 결정 — 권한 정리 ②).
--
-- 2026-07-13 모델은 「개발자가 기본, 개인에게 위임」(roles 없음)이었다. 권한을 바꾸는 자격(`permission.manage`)은 이미 대표 · 전무에게
-- 있는데 화면 입장권이 없어 개발자가 열어 줘야 했다. 위임(개인 부여)은 여전히 개발자만 준다(앱 `developerOnly`).
-- 레지스트리 생성 구간(202609100001)도 같이 고쳤다 — 그 파일은 이미 적용돼 다시 돌지 않으므로 기존 DB 에는 이 파일이 행을 넣는다.

insert into public.capability_roles (capability, role) values
  ('user.manage', 'owner'::public.organization_role),
  ('user.manage', 'senior_managing_director'::public.organization_role)
on conflict do nothing;
