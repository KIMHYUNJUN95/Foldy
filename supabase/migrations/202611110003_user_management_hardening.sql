-- 사용자 관리 점검(2026-11-11) — 앱을 거치지 않고 PostgREST 로 직접 부를 때 드러나던 구멍과 경합을 닫는다.
-- 앱 화면 동작은 바뀌지 않는다: 아래 표들의 쓰기 · 개인정보 읽기는 모두 서버(service role)가 한다.
-- 문서: docs/engineering/05-rls-permissions.md 「사용자 관리 점검(2026-11-11)」
-- 두 번 돌려도 같은 결과가 되게 썼다(drop if exists · create or replace · revoke/grant).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) invite_codes — 로그인 사용자의 직접 읽기 · 쓰기를 없앤다(H1).
--    「owner office admin can manage invite codes」(FOR ALL) 는 default_role 값을 보지 않아서 office_admin 이
--    default_role = 'owner' 인 초대를 직접 넣어 대표 계정을 만들 수 있었다. 만들기 · 끄기 · 켜기 · 삭제는 모두
--    service role 서버 함수(src/lib/invite-codes-server.ts)이고, 목록 · 개수 읽기도 service role 이다
--    (/admin/users/invites · /mobile/users/invites · user-management-data.ts). 가입은 security definer RPC.
--    초대 코드는 그 자체가 가입 비밀값이라 읽기 정책도 두지 않는다(코드 목록을 사용자 세션으로 볼 일이 없다).
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "owner office admin can manage invite codes" on public.invite_codes;
revoke all on public.invite_codes from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) profiles — 본인 수정을 칸 단위로 좁힌다(H2) · 동료가 읽는 칸을 이름 · 전화로 좁힌다(B).
--    「users can update own profile」 은 칸 제한이 없어 본인이 hire_date(연차 부풀리기) · deleted_at ·
--    can_generate_report 등을 PATCH 로 바꿀 수 있었다. 「users can read own profile」 은 같은 조직 활성 멤버에게
--    행 전체(생년월일 · 성별 · 국적 · 입사일 · 가타카나 · 영문 이름 …)를 보여 줬다.
--
--    앱의 사용자 세션 읽기는 전부 `id, name` / `id, name, phone_number` 와 임베드 `profiles(name)` 뿐이다
--    (2026-11-11 전수 grep). 본인 프로필 · 세션 · 온보딩 · 계정 화면 · 사용자 관리 · 서류 · 급여 · 연차 읽기와
--    모든 프로필 쓰기는 service role 이다(src/lib/identity-rows.ts · src/app/account/actions.ts 등).
--    그래서 표 권한을 칸 권한으로 바꾼다 — 행 범위(RLS)는 그대로, 칸만 좁힌다.
--      읽기: id · name · phone_number 만(본인 포함 — 본인 전체 행은 아래 read_profile() 로).
--      쓰기: 화면 설정 칸(언어 · 테마 · 하단 바 · 판매 캘린더 보기)만. 이름 · 전화는 검증을 거쳐야 해서 서버만.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on public.profiles from anon;
revoke select, insert, update, delete, truncate, references, trigger on public.profiles from authenticated;
grant select (id, name, phone_number) on public.profiles to authenticated;
grant update (preferred_language, theme_preference, bottom_nav_tabs, ops_calendar_mode) on public.profiles to authenticated;

-- 본인(또는 플랫폼 개발자)의 프로필 전체 행 — 칸 권한으로 막힌 칸을 사용자 세션에서 읽어야 할 때의 유일한 길.
-- 앱은 지금 service role 로 읽어 이 함수를 부르지 않는다. 직접 API 사용자에게 「본인 전체 읽기」를 남겨 둔다.
create or replace function public.read_profile(target_user_id uuid default null)
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.profiles p
  where p.id = coalesce(target_user_id, auth.uid())
    and auth.uid() is not null
    and (p.id = auth.uid() or public.is_platform_admin());
$$;

revoke all on function public.read_profile(uuid) from public, anon;
grant execute on function public.read_profile(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) memberships — 조직의 마지막 활성 owner 를 없애는 변경을 DB 가 막는다(경합 방지).
--    두 owner 가 서로를 동시에 강등 · 정지하면 앱의 「남은 owner 수」 확인이 둘 다 2 를 보고 통과해 owner 가
--    0 명이 될 수 있었다. 조직 행을 잠근 뒤 센다 — 같은 조직의 owner 변경은 한 줄로 선다.
--    **AFTER ROW** 트리거다 — 문장이 다 끝난 뒤 돌아서 같은 문장이 바꾼 다른 줄(한 UPDATE 로 owner 둘을 정지)까지 보고 센다.
--    (BEFORE ROW 는 같은 문장의 다른 줄 변경을 못 봐 그 경우를 놓친다.) 오류가 나면 문장 전체가 되돌려진다.
--    조직 자체가 지워지는 중(organizations → memberships cascade)이면 조직 행이 이미 없어 통과한다.
--    오류 메시지 'last_owner' 는 앱의 같은 오류 키로 바뀐다(src/actions/users.ts · src/app/account/actions.ts).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_last_active_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
begin
  if old.role <> 'owner' or old.status <> 'active' then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.role = 'owner'
     and new.status = 'active'
     and new.organization_id = old.organization_id then
    return null;
  end if;

  -- 조직 행 잠금(FOR NO KEY UPDATE — 다른 표의 FK 확인 잠금과는 부딪히지 않는다). 없으면 조직이 지워지는 중이다.
  perform 1 from public.organizations o where o.id = old.organization_id for no key update;
  if not found then
    return null;
  end if;

  -- AFTER 라 이 줄 자신의 변경도 이미 반영돼 있다 — 남은 활성 owner 를 그대로 센다.
  select count(*) into v_remaining
  from public.memberships m
  where m.organization_id = old.organization_id
    and m.role = 'owner'
    and m.status = 'active';

  if v_remaining = 0 then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

revoke all on function public.enforce_last_active_owner() from public, anon, authenticated;

drop trigger if exists memberships_enforce_last_owner on public.memberships;
create trigger memberships_enforce_last_owner
  after update of role, status, organization_id or delete on public.memberships
  for each row execute function public.enforce_last_active_owner();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b) 멤버십 변경 + 개인 부여 · 차단 회수를 **한 거래로**(service role 전용).
--    앱이 둘을 따로 쓰면, 회수 뒤 다음 단계(역할 저장 · 경합 · 마지막 대표)가 실패했을 때 그 사람은 그대로 활성인데 차단(deny)만
--    사라져 역할 기본 권한이 다시 열렸다. 여기서는 멤버십 줄을 잠그고 → 기대 역할 확인 → 바꾸기 → 회수가 함께 되거나 함께 안 된다.
--    돌려주는 값: {"result": "ok" | "stale" | "not_found" | "last_owner", "revoked": [키 …]}
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_membership_change(
  p_membership_id uuid,
  p_actor_user_id uuid,
  p_expected_role public.organization_role,
  p_role public.organization_role default null,
  p_status public.membership_status default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.memberships%rowtype;
  v_role_changed boolean;
  v_revoke boolean;
  v_keys jsonb := '[]'::jsonb;
begin
  select * into v_m from public.memberships m where m.id = p_membership_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if p_expected_role is not null and v_m.role <> p_expected_role then
    return jsonb_build_object('result', 'stale');
  end if;

  v_role_changed := p_role is not null and p_role <> v_m.role;
  -- 역할이 바뀌거나, 활성이 아닌 상태로 바꾸면 이 조직의 개인 부여 · 차단을 전부 회수한다(예전 권한이 조용히 따라가지 않게).
  v_revoke := v_role_changed or (p_status is not null and p_status <> 'active');

  begin
    update public.memberships m
       set role = coalesce(p_role, m.role),
           status = coalesce(p_status, m.status),
           attendance_payroll_admin = case when v_role_changed then false else m.attendance_payroll_admin end,
           leave_approver_role = case when v_role_changed then null else m.leave_approver_role end
     where m.id = p_membership_id;

    if v_revoke then
      with r as (
        update public.membership_permission_overrides o
           set revoked_at = now(), revoked_by_user_id = p_actor_user_id
         where o.organization_id = v_m.organization_id
           and o.user_id = v_m.user_id
           and o.revoked_at is null
        returning o.permission_key
      )
      select coalesce(jsonb_agg(r.permission_key), '[]'::jsonb) into v_keys from r;
    end if;
  exception when raise_exception then
    if sqlerrm = 'last_owner' then
      return jsonb_build_object('result', 'last_owner');
    end if;
    raise;
  end;

  return jsonb_build_object('result', 'ok', 'revoked', v_keys);
end;
$$;

revoke all on function public.apply_membership_change(uuid, uuid, public.organization_role, public.organization_role, public.membership_status)
  from public, anon, authenticated;
grant execute on function public.apply_membership_change(uuid, uuid, public.organization_role, public.organization_role, public.membership_status)
  to service_role;

-- 멤버 완전 삭제의 DB 부분(회수 → 멤버십 삭제 → 다른 조직 멤버십이 없으면 프로필 삭제)을 한 거래로. 로그인 계정(auth) 삭제는
-- 거래에 넣을 수 없어 앱이 이 함수가 성공한 **뒤에** 한다 — 실패해도 로그인만 남고(프로필 · 멤버십 없는 빈 계정) 앱은 로그인을 잠근다.
-- 돌려주는 값: {"result": "ok" | "not_found" | "last_owner", "revoked": [키 …], "profile_deleted": bool}
create or replace function public.delete_membership_atomic(
  p_membership_id uuid,
  p_actor_user_id uuid,
  p_delete_profile boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.memberships%rowtype;
  v_keys jsonb := '[]'::jsonb;
  v_profile_deleted boolean := false;
begin
  select * into v_m from public.memberships m where m.id = p_membership_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  begin
    with r as (
      update public.membership_permission_overrides o
         set revoked_at = now(), revoked_by_user_id = p_actor_user_id
       where o.organization_id = v_m.organization_id
         and o.user_id = v_m.user_id
         and o.revoked_at is null
      returning o.permission_key
    )
    select coalesce(jsonb_agg(r.permission_key), '[]'::jsonb) into v_keys from r;

    delete from public.memberships m where m.id = p_membership_id;

    if p_delete_profile
       and not exists (select 1 from public.memberships m where m.user_id = v_m.user_id) then
      delete from public.profiles p where p.id = v_m.user_id;
      v_profile_deleted := found;
    end if;
  exception when raise_exception then
    if sqlerrm = 'last_owner' then
      return jsonb_build_object('result', 'last_owner');
    end if;
    raise;
  end;

  return jsonb_build_object('result', 'ok', 'revoked', v_keys, 'profile_deleted', v_profile_deleted);
end;
$$;

revoke all on function public.delete_membership_atomic(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.delete_membership_atomic(uuid, uuid, boolean) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) 초대 코드 가입 RPC — 빠져 있던 확인을 채운다.
--    · 조직이 활성(active)이 아니면 가입하지 않는다(정지 · 보관 조직).
--    · 'invited' 멤버십을 활성으로 바꿀 때도 코드의 역할 · 사용 횟수 상한을 따르고 사용 횟수를 센다
--      (전에는 미리 넣어 둔 역할로 그대로 켜고 used_count / max_uses 를 건너뛰었다).
--    · 수동 'invited' 지정은 앱에서 없앴다(src/actions/users.ts) — 남은 예전 행만 이 길을 탄다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.join_organization_with_invite_code(
  p_user_id uuid,
  p_code text
)
returns table (
  organization_id uuid,
  role public.organization_role,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite     public.invite_codes%rowtype;
  v_membership public.memberships%rowtype;
  v_org_status public.organization_status;
  v_code       text := upper(trim(coalesce(p_code, '')));
begin
  if p_user_id is null then
    raise exception 'missing_user' using errcode = 'P0001';
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if v_code = '' then
    raise exception 'missing_invite' using errcode = 'P0001';
  end if;

  select ic.*
    into v_invite
    from public.invite_codes ic
   where ic.code = v_code
   for update;

  if not found then
    raise exception 'invalid_invite' using errcode = 'P0001';
  end if;

  select o.status into v_org_status from public.organizations o where o.id = v_invite.organization_id;
  if v_org_status is distinct from 'active'::public.organization_status then
    raise exception 'invalid_invite' using errcode = 'P0001';
  end if;

  if not v_invite.is_active then
    raise exception 'invite_inactive' using errcode = 'P0001';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;

  select m.*
    into v_membership
    from public.memberships m
   where m.organization_id = v_invite.organization_id
     and m.user_id = p_user_id
   for update;

  if found then
    if v_membership.status = 'active' then
      return query
      select v_membership.organization_id, v_membership.role, v_membership.status::text;
      return;
    end if;

    if v_membership.status in ('suspended', 'removed') then
      raise exception 'membership_blocked' using errcode = 'P0001';
    end if;

    -- 'invited' — 새 가입과 같은 규칙(코드의 역할 · 사용 횟수).
    if v_invite.used_count >= v_invite.max_uses then
      raise exception 'invite_maxed' using errcode = 'P0001';
    end if;

    update public.memberships m
       set status    = 'active',
           role      = v_invite.default_role,
           joined_at = coalesce(m.joined_at, now())
     where m.id = v_membership.id
     returning m.* into v_membership;

    update public.invite_codes ic
       set used_count = ic.used_count + 1
     where ic.id = v_invite.id;

    return query
    select v_membership.organization_id, v_membership.role, v_membership.status::text;
    return;
  end if;

  if v_invite.used_count >= v_invite.max_uses then
    raise exception 'invite_maxed' using errcode = 'P0001';
  end if;

  insert into public.memberships (
    organization_id, user_id, role, status, joined_at
  )
  values (
    v_invite.organization_id, p_user_id,
    v_invite.default_role, 'active', now()
  )
  returning * into v_membership;

  update public.invite_codes ic
     set used_count = ic.used_count + 1
   where ic.id = v_invite.id;

  return query
  select v_membership.organization_id, v_membership.role, v_membership.status::text;
end;
$$;

-- 앱은 service role 로만 부른다(src/app/onboarding/actions.ts · src/lib/auth-invite.ts). 로그인 사용자가 직접 부르면 사유별 오류
-- (만료 · 꺼짐 · 다 씀)로 코드가 있는지 맞혀 볼 수 있어 실행 권한을 뺀다(2026-11-11).
revoke execute on function public.join_organization_with_invite_code(uuid, text) from public, anon, authenticated;
grant execute on function public.join_organization_with_invite_code(uuid, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) 첫 플랫폼 개발자 등록 — 「세고 넣기」 경합을 한 거래로(두 사람이 동시에 눌러 둘 다 개발자가 되는 것을 막는다).
--    표 잠금(SHARE ROW EXCLUSIVE — 자기 자신과 부딪힌다)으로 동시 호출을 한 줄로 세운 뒤 센다. service role 전용.
--    돌려주는 값: 'ok' · 'profile_required' · 'platform_admin_exists'.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_first_platform_admin(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return 'profile_required';
  end if;
  lock table public.platform_admins in share row exclusive mode;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    return 'profile_required';
  end if;
  if exists (select 1 from public.platform_admins) then
    return 'platform_admin_exists';
  end if;
  insert into public.platform_admins (user_id, role, is_active)
  values (p_user_id, 'developer_super_admin', true);
  return 'ok';
end;
$$;

revoke all on function public.claim_first_platform_admin(uuid) from public, anon, authenticated;
grant execute on function public.claim_first_platform_admin(uuid) to service_role;
