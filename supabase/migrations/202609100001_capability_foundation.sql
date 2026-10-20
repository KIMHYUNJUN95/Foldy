-- 권한 아키텍처 토대 (2026-09-10).
--
-- 「누가 이 기능을 쓸 수 있는가」의 단위를 역할 배열에서 **권한 키(capability)** 로 옮긴다.
-- 설계: docs/engineering/14-permission-architecture.md
--
-- 이 마이그레이션은 **어떤 권한도 바꾸지 않는다.** 아직 아무 정책도 has_capability() 를 부르지
-- 않고, 앱 코드도 기존 역할 술어를 그대로 쓴다. 순수하게 토대만 놓는다.
--
-- 지금 하는 이유: 2026-09-10 실측 기준 membership_permission_overrides 0행,
-- can_generate_report 0명, attendance_payroll_admin 0명 — 이전할 데이터가 없어 키 이름과 스키마를
-- 자유롭게 정할 수 있다.

-- ---------------------------------------------------------------------------
-- 1. capability_roles — 역할↔권한 매핑의 DB 쪽 사본
-- ---------------------------------------------------------------------------
--
-- 원본은 src/config/capabilities.ts 다. RLS 는 SQL 안에서 판정해야 하므로 DB 에도 사본이 필요하고,
-- 그 사본은 **코드가 생성한다**(아래 생성 구간). 손으로 적으면 정의가 두 벌이 되고, 이 저장소는
-- 판정식이 갈라지는 사고를 반복해서 겪었다.
create table if not exists public.capability_roles (
  capability text not null,
  role organization_role not null,
  primary key (capability, role)
);

alter table public.capability_roles enable row level security;

-- 키별 정책의 DB 사본. 역할표와 같은 이유로 존재한다 — `has_capability` 가 SQL 안에서
-- 「개인 부여가 가능한 키인가 · 차단이 가능한 키인가 · 개발자가 통과하는가」를 알아야 앱과 같은
-- 답을 낸다. 이것이 없으면 판정이 갈린다(2026-09-10 감사에서 실제로 갈려 있었다).
create table if not exists public.capability_policies (
  capability text primary key,
  individual_grant boolean not null,
  individual_deny boolean not null,
  platform_bypass boolean not null
);

alter table public.capability_policies enable row level security;

drop policy if exists "capability policies: readable by members" on public.capability_policies;
create policy "capability policies: readable by members"
  on public.capability_policies for select
  using ((select auth.uid()) is not null);

grant select on public.capability_policies to authenticated;
grant all on public.capability_policies to service_role;

-- 조직 데이터가 아니라 **설정표**다. 로그인한 사용자는 읽을 수 있어야 has_capability() 가 그
-- 사용자의 권한으로 동작한다. 쓰기는 마이그레이션(서비스 역할)만 한다.
drop policy if exists "capability roles: readable by members" on public.capability_roles;
create policy "capability roles: readable by members"
  on public.capability_roles for select
  using ((select auth.uid()) is not null);

grant select on public.capability_roles to authenticated;
grant all on public.capability_roles to service_role;

-- >>> generated: capability_roles seed (do not edit by hand)
-- 원본: src/config/capabilities.ts. 손으로 고치지 않는다 —
-- src/lib/__tests__/capability-registry.test.ts 가 붙여넣을 내용을 출력한다.
delete from public.capability_roles;
insert into public.capability_roles (capability, role) values
  ('permission.manage', 'owner'::organization_role),
  ('permission.manage', 'senior_managing_director'::organization_role),
  ('job_application.read', 'owner'::organization_role),
  ('job_application.read', 'senior_managing_director'::organization_role),
  ('job_application.triage', 'owner'::organization_role),
  ('job_application.triage', 'senior_managing_director'::organization_role),
  ('job_application.delete', 'owner'::organization_role),
  ('job_application.delete', 'senior_managing_director'::organization_role),
  ('user.manage', 'owner'::organization_role),
  ('user.manage', 'senior_managing_director'::organization_role),
  ('order_processor', 'owner'::organization_role),
  ('order_processor', 'senior_managing_director'::organization_role),
  ('order_processor', 'office_admin'::organization_role),
  ('order_processor', 'cs_staff'::organization_role),
  ('maintenance_status_change', 'owner'::organization_role),
  ('maintenance_status_change', 'senior_managing_director'::organization_role),
  ('maintenance_status_change', 'office_admin'::organization_role),
  ('maintenance_status_change', 'cs_staff'::organization_role),
  ('maintenance_status_change', 'field_manager'::organization_role),
  ('maintenance_status_change', 'staff'::organization_role),
  ('can_generate_report', 'owner'::organization_role),
  ('can_generate_report', 'senior_managing_director'::organization_role),
  ('can_generate_report', 'office_admin'::organization_role),
  ('can_generate_report', 'cs_staff'::organization_role),
  ('can_generate_report', 'field_manager'::organization_role),
  ('can_generate_report', 'staff'::organization_role),
  ('ops_admin.access', 'owner'::organization_role),
  ('ops_admin.access', 'senior_managing_director'::organization_role),
  ('ops_calendar.write', 'owner'::organization_role),
  ('ops_calendar.write', 'senior_managing_director'::organization_role),
  ('room_links.access', 'owner'::organization_role),
  ('room_links.access', 'senior_managing_director'::organization_role),
  ('board.moderate', 'owner'::organization_role),
  ('board.moderate', 'office_admin'::organization_role),
  ('announcement.create', 'owner'::organization_role),
  ('announcement.create', 'senior_managing_director'::organization_role),
  ('announcement.create', 'office_admin'::organization_role),
  ('announcement.create', 'cs_staff'::organization_role),
  ('announcement.create', 'field_manager'::organization_role),
  ('announcement.create', 'staff'::organization_role),
  ('announcement.manage', 'owner'::organization_role),
  ('announcement.manage', 'senior_managing_director'::organization_role),
  ('announcement.manage', 'office_admin'::organization_role),
  ('cleaning.work', 'owner'::organization_role),
  ('cleaning.work', 'senior_managing_director'::organization_role),
  ('cleaning.work', 'field_manager'::organization_role),
  ('cleaning.work', 'staff'::organization_role),
  ('cleaning.work', 'part_time_staff'::organization_role),
  ('cleaning.read_all', 'owner'::organization_role),
  ('cleaning.read_all', 'senior_managing_director'::organization_role),
  ('cleaning.read_all', 'office_admin'::organization_role),
  ('cleaning.read_all', 'cs_staff'::organization_role),
  ('cleaning.read_all', 'field_manager'::organization_role),
  ('cleaning.assign', 'owner'::organization_role),
  ('cleaning.assign', 'senior_managing_director'::organization_role),
  ('cleaning.assign', 'field_manager'::organization_role),
  ('cleaning.force_complete', 'owner'::organization_role),
  ('cleaning.force_complete', 'senior_managing_director'::organization_role),
  ('cleaning.force_complete', 'office_admin'::organization_role),
  ('cleaning.force_complete', 'field_manager'::organization_role),
  ('linen.manage', 'owner'::organization_role),
  ('linen.manage', 'senior_managing_director'::organization_role),
  ('linen.manage', 'office_admin'::organization_role),
  ('linen.manage', 'cs_staff'::organization_role),
  ('linen.manage', 'field_manager'::organization_role),
  ('property_info.edit', 'owner'::organization_role),
  ('property_info.edit', 'senior_managing_director'::organization_role),
  ('property_info.edit', 'office_admin'::organization_role),
  ('property_info.edit', 'cs_staff'::organization_role),
  ('complaint.write', 'owner'::organization_role),
  ('complaint.write', 'senior_managing_director'::organization_role),
  ('complaint.write', 'office_admin'::organization_role),
  ('complaint.write', 'cs_staff'::organization_role),
  ('complaint.manage', 'owner'::organization_role),
  ('complaint.manage', 'senior_managing_director'::organization_role),
  ('complaint.manage', 'office_admin'::organization_role),
  ('complaint.comment', 'owner'::organization_role),
  ('complaint.comment', 'senior_managing_director'::organization_role),
  ('complaint.comment', 'office_admin'::organization_role),
  ('complaint.comment', 'cs_staff'::organization_role),
  ('complaint.comment', 'field_manager'::organization_role),
  ('complaint.comment', 'staff'::organization_role),
  ('request.delete_any', 'owner'::organization_role),
  ('request.delete_any', 'senior_managing_director'::organization_role),
  ('request.delete_any', 'office_admin'::organization_role),
  ('request.delete_any', 'cs_staff'::organization_role),
  ('request.delete_any', 'field_manager'::organization_role),
  ('bug.review', 'owner'::organization_role),
  ('bug.review', 'senior_managing_director'::organization_role),
  ('bug.review', 'office_admin'::organization_role),
  ('board.manage', 'owner'::organization_role),
  ('board.manage', 'senior_managing_director'::organization_role),
  ('board.manage', 'office_admin'::organization_role);

delete from public.capability_policies;
insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass) values
  ('permission.manage', false, false, true),
  ('job_application.read', true, false, true),
  ('job_application.triage', true, false, true),
  ('job_application.delete', true, false, true),
  ('user.manage', true, false, true),
  ('order_processor', true, true, true),
  ('maintenance_status_change', true, true, true),
  ('property_room_manage', true, false, true),
  ('can_generate_report', true, true, true),
  ('ops_admin.access', true, false, true),
  ('ops_calendar.write', true, true, true),
  ('room_links.access', true, false, true),
  ('automation.manage', true, false, true),
  ('board.moderate', true, true, true),
  ('announcement.create', false, false, true),
  ('announcement.manage', false, false, true),
  ('cleaning.work', false, false, true),
  ('cleaning.read_all', false, false, true),
  ('cleaning.assign', true, true, true),
  ('cleaning.force_complete', false, false, true),
  ('linen.manage', false, false, true),
  ('property_info.edit', false, false, true),
  ('complaint.write', false, false, true),
  ('complaint.manage', false, false, true),
  ('complaint.comment', false, false, true),
  ('request.delete_any', false, false, true),
  ('bug.review', false, false, true),
  ('board.manage', false, false, true);
-- <<< generated

-- ---------------------------------------------------------------------------
-- 2. membership_permission_overrides — 차단(deny)과 무기한 부여를 받아들인다
-- ---------------------------------------------------------------------------
--
-- 기존 표를 그대로 쓴다. 부여자·사유·회수·조직 격리·자기부여 금지가 이미 있다.
--
-- effect: 지금까지는 「더하기」만 가능했다. 「사무직인데 이 사람만 제외」를 표현하려면 역할을
--   강등하는 수밖에 없었고, 그러면 그 사람의 다른 권한까지 함께 사라졌다.
alter table public.membership_permission_overrides
  add column if not exists effect text not null default 'grant';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.membership_permission_overrides'::regclass
      and conname = 'membership_permission_overrides_effect_check'
  ) then
    alter table public.membership_permission_overrides
      add constraint membership_permission_overrides_effect_check
      check (effect in ('grant', 'deny'));
  end if;
end
$$;

-- expires_at NULL 허용 = 무기한.
--
-- 「모든 부여는 시한부」(27-permission-override-workflow.md) 를 폐기하는 것이 아니라 **키별 정책**
-- 으로 일반화한 것이다. 일시적 예외는 여전히 기한이 필수이고(레지스트리의 requiresExpiry),
-- 상시 업무 지정만 무기한을 허용한다 — 상시 업무에 기한을 걸면 어느 날 조용히 만료돼 담당자가
-- 일을 못 하게 된다. 기한 필수 여부는 **서버가 레지스트리를 보고** 판단한다.
alter table public.membership_permission_overrides
  alter column expires_at drop not null;

-- 같은 사람에게 같은 키의 같은 방향 부여가 중복되지 않게 한다(활성 행 기준).
-- grant 와 deny 가 동시에 있는 것은 막지 않는다 — 판정식이 deny 우선으로 해소한다.
create unique index if not exists membership_permission_overrides_active_uniq
  on public.membership_permission_overrides (organization_id, user_id, permission_key, effect)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 3. has_capability() — 앱과 같은 판정식
-- ---------------------------------------------------------------------------
--
--   can = NOT denied
--     AND ( granted OR role ∈ capability_roles OR (platform_admin AND bypass) )
--
-- **차단이 최우선이다.** 개인 부여보다도 앞선다 — 「빼라」가 「줘라」보다 강해야 판단이 갈릴 때
-- 안전한 쪽으로 실패한다.
--
-- 차단 면역: owner / senior_managing_director / 플랫폼 관리자. 소유자를 잠그면 되돌릴 사람이 없다.
--
-- platformBypass 는 현재 모든 키에서 true 라 SQL 에서는 상수로 둔다. 키별로 달라지면 그 값도
-- capability_roles 옆에 시드해야 한다(그때 이 주석을 갱신할 것).
create or replace function public.has_capability(
  target_organization_id uuid,
  target_user_id uuid,
  target_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      -- `is_platform_admin()` 은 **호출자**(auth.uid())를 본다. 이 함수는 인자로 받은 **대상자**를
      -- 판정해야 한다 — 관리 화면이 「이 사람의 최종 유효 권한」을 미리 보여줄 때 남의 권한을
      -- 물어보기 때문이다. 그래서 표를 직접 본다.
      exists (
        select 1
        from public.platform_admins pa
        where pa.user_id = target_user_id
          and pa.is_active = true
      ) as is_platform,
      (
        select m.role
        from public.memberships m
        where m.organization_id = target_organization_id
          and m.user_id = target_user_id
          and m.status = 'active'
        limit 1
      ) as role
  ),
  policy as (
    -- 키별 정책. 없는 키는 「개인 지정 불가 · 개발자 통과」로 본다 — 레지스트리에 없는 문자열이
    -- 부여 행으로 들어와도 그것만으로 권한이 열리지 않게 한다.
    select
      coalesce((select cp.individual_grant from public.capability_policies cp
                where cp.capability = target_capability), false) as individual_grant,
      coalesce((select cp.individual_deny from public.capability_policies cp
                where cp.capability = target_capability), false) as individual_deny,
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
    -- 차단이 최우선. 단 **차단이 허용된 키에서만** 적용되고, 차단 면역 역할에는 걸리지 않는다.
    -- (앱의 evaluateCapability 와 같은 순서·같은 조건이어야 한다.)
    not (
      coalesce((select denied from effects), false)
      and (select individual_deny from policy)
      and coalesce((select role from me), 'staff'::organization_role)
          not in ('owner', 'senior_managing_director')
      and not coalesce((select is_platform from me), false)
    )
    and (
      (coalesce((select is_platform from me), false) and (select platform_bypass from policy))
      or (coalesce((select granted from effects), false) and (select individual_grant from policy))
      or exists (
        -- 전무(senior_managing_director)는 owner 와 동등하다. DB 헬퍼 has_org_role 이 이미
        -- 「목록에 owner 가 있으면 전무도 통과」로 동작하므로 여기서도 같아야 한다 — 다르면 같은
        -- 권한이 앱에서는 열리고 RLS 에서는 막히는 상태가 된다. 앱 쪽 roleHasCapability 와 대응.
        select 1
        from public.capability_roles cr
        where cr.capability = target_capability
          and (
            cr.role = (select role from me)
            or ((select role from me) = 'senior_managing_director' and cr.role = 'owner')
          )
      )
    );
$$;

comment on function public.has_capability(uuid, uuid, text) is
  '권한 키 판정. 앱 쪽 evaluateCapability(src/config/capabilities.ts)와 같은 규칙. 차단 우선.';

revoke all on function public.has_capability(uuid, uuid, text) from public;
grant execute on function public.has_capability(uuid, uuid, text) to authenticated, service_role;
