-- 개인 부여 · 차단은 키 정책과 무관하게 판정에 든다 — 개발자 예외 (2026-10-21).
--
-- 도메인 계약: docs/product/27-permission-override-workflow.md 「개발자는 어떤 권한이든 켜고 끈다」
-- 원본: 202609300008_has_capability_self_only.sql
--
-- 사용자 결정: 개발자는 역할로 정해진 기본 기능이라도 사람마다 켜고 끌 수 있어야 한다. 그래서 키의
-- individual_grant · individual_deny 는 「대표 · 전무가 걸 수 있는가」의 규칙으로만 남기고(앱 서버 액션이 본다),
-- 판정에서는 활성 부여 · 차단 행이 있으면 그대로 따른다. 앱 판정식(`evaluateCapability`)과 같은 규칙이다.
-- 차단 면역(owner · 전무 · 플랫폼 개발자)과 자기 자신만 묻기(auth.uid())는 그대로.
-- 플래그에 어긋나는 행은 지금까지 만들 수 없었으므로(서버가 막음) 기존 판정 결과는 바뀌지 않는다.
create or replace function public.has_capability(target_organization_id uuid, target_user_id uuid, target_capability text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select
      exists (
        select 1 from public.platform_admins pa
        where pa.user_id = target_user_id and pa.is_active = true
      ) as is_platform,
      (
        select m.role from public.memberships m
        where m.organization_id = target_organization_id
          and m.user_id = target_user_id
          and m.status = 'active'
        limit 1
      ) as role
  ),
  policy as (
    select
      coalesce((select cp.platform_bypass from public.capability_policies cp
                where cp.capability = target_capability), true) as platform_bypass
  ),
  effects as (
    select
      bool_or(o.effect = 'grant') as granted,
      bool_or(o.effect = 'deny') as denied
    from public.membership_permission_overrides o
    where o.organization_id = target_organization_id
      and o.user_id = target_user_id
      and o.permission_key = target_capability
      and o.revoked_at is null
      and (o.expires_at is null or o.expires_at > now())
  )
  select
    -- 로그인 사용자는 자기 자신만 물을 수 있다(서비스 롤·SQL 직접 실행은 auth.uid() 가 null).
    (auth.uid() is null or target_user_id = auth.uid())
    and not (
      coalesce((select denied from effects), false)
      and coalesce((select role from me), 'staff'::organization_role)
          not in ('owner', 'senior_managing_director')
      and not coalesce((select is_platform from me), false)
    )
    and (
      (coalesce((select is_platform from me), false) and (select platform_bypass from policy))
      or coalesce((select granted from effects), false)
      or exists (
        select 1 from public.capability_roles cr
        where cr.capability = target_capability
          and (
            cr.role = (select role from me)
            or ((select role from me) = 'senior_managing_director' and cr.role = 'owner')
          )
      )
    );
$function$;
