-- 보안 점검(2026-10-28) 후속 — 앱을 거치지 않고 PostgREST 로 직접 부를 때만 드러나던 구멍 4가지를 닫는다.
-- 앱 화면 동작은 바뀌지 않는다: 아래 표들의 쓰기는 모두 서버 액션이 service role 로 하고 있다.
-- 문서: docs/engineering/05-rls-permissions.md 「보안 점검 후속(2026-10-28)」

-- 1) memberships — 로그인 사용자의 직접 쓰기 정책을 없앤다.
--    「owner office admin can manage memberships」(FOR ALL) 는 바뀌는 행 · role 값을 보지 않아서
--    office_admin 이 자기 role 을 owner 로 올리거나 owner 를 정지시킬 수 있었다.
--    역할 · 상태 변경, 삭제, 대표 추가, 탈퇴는 모두 service role 서버 액션(src/actions/users.ts 등)이고,
--    초대 코드 가입은 security definer RPC(join_organization_with_invite_code)라 이 정책이 필요 없다.
drop policy if exists "owner office admin can manage memberships" on public.memberships;
revoke insert, update, delete on public.memberships from authenticated, anon;

-- 2) has_capability — 개인 부여(grant)도 활성 멤버십이 있을 때만 통한다.
--    전에는 정지 · 제외된 사람도 개인 부여 행이 남아 있으면 참이 돼서, staff_id_documents(재류카드) 같은
--    정책을 계속 통과했다. 플랫폼 개발자는 지금처럼 platform_bypass 분기로 판정한다.
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
      -- 개인 부여는 이 조직의 활성 멤버(또는 플랫폼 개발자)일 때만.
      or (
        coalesce((select granted from effects), false)
        and ((select role from me) is not null or coalesce((select is_platform from me), false))
      )
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

-- 3) attendance_trusted_devices — 로그인 사용자의 UPDATE 를 없앤다.
--    「해지만」이 의도였지만 WITH CHECK · 컬럼 제한이 없어 token_hash · expires_at · revoked_at 을 바꿔
--    다른 직원 기기로 출퇴근을 찍거나 해지된 기기를 되살릴 수 있었다. 등록 · 갱신 · 해지는 모두
--    service role(src/lib/attendance-trusted-device.ts)이다.
drop policy if exists "users or org admins can revoke trusted devices" on public.attendance_trusted_devices;
revoke insert, update, delete on public.attendance_trusted_devices from authenticated, anon;

-- 4) 작성자가 자기 글 · 기록의 organization_id 를 바꿔 다른 조직에 넣지 못하게 막는다.
--    board_posts · bug_reports · linen_return_records 의 UPDATE 정책이 조직 소속을 보지 않았다.
--    조직을 옮기는 기능은 없으므로 어떤 경로로든 organization_id 변경은 거부한다.
create or replace function public.forbid_organization_id_change()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.forbid_organization_id_change() from public, anon, authenticated;

drop trigger if exists board_posts_forbid_org_change on public.board_posts;
create trigger board_posts_forbid_org_change
  before update of organization_id on public.board_posts
  for each row execute function public.forbid_organization_id_change();

drop trigger if exists bug_reports_forbid_org_change on public.bug_reports;
create trigger bug_reports_forbid_org_change
  before update of organization_id on public.bug_reports
  for each row execute function public.forbid_organization_id_change();

drop trigger if exists linen_return_records_forbid_org_change on public.linen_return_records;
create trigger linen_return_records_forbid_org_change
  before update of organization_id on public.linen_return_records
  for each row execute function public.forbid_organization_id_change();
