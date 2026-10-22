-- 쓸모없어진 개인 차단 회수 (2026-10-22).
--
-- 역할 기본값을 바꾸면(예: 게스트 피드백 댓글을 CS 관리자 기본으로 — 202610220002) 그 역할이 더는 받지 않는 키에 걸어 둔
-- 개인 차단이 남는다. 판정 결과는 같지만(어차피 꺼짐) 사용자 화면에 「개인 차단 · 역할로는 받음」이라는 틀린 글자가 뜨고,
-- 나중에 그 사람에게 켜 주려 해도 차단이 이겨 켜지지 않는다. 역할 기본으로 받지 않는 키의 활성 차단을 회수한다(기록은 남김).
-- 회수자 = 가장 먼저 등록된 활성 플랫폼 개발자.
update public.membership_permission_overrides o
set revoked_at = now(),
    revoked_by_user_id = (select pa.user_id from public.platform_admins pa where pa.is_active order by pa.created_at limit 1)
from public.memberships m
where o.revoked_at is null
  and o.effect = 'deny'
  and m.organization_id = o.organization_id
  and m.user_id = o.user_id
  and not exists (
    select 1 from public.capability_roles cr
    where cr.capability = o.permission_key
      and (cr.role = m.role or (m.role = 'senior_managing_director' and cr.role = 'owner'))
  );
