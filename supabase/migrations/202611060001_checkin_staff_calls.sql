-- 셀프 체크인 직원 통화 (2026-11-06). 문서: docs/product/46-self-checkin-staff-call.md §3 · §4
-- 상태: 운영 적용 2026-11-10(사용자 SQL Editor). 알림 만들기 정책은 운영 모양(202610160003)을 지키고 종류 제한만 더함.
--
-- 통화 자체는 저장하지 않는다. 이 표에는 시각 · 건물 · 기기 · 받은 직원 · 누른 단계 · 언어만 남긴다.
-- `alter type ... add value` 를 트랜잭션 안에서 돌려도 되도록 이 파일 안에서는 새 enum 값을 쓰지 않는다
-- (`notify_staff` 는 실행할 때 text 를 바꾼다).

-- ── 통화 ────────────────────────────────────────────────────────────────────
create table checkin.staff_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  property_key text not null,
  device_id uuid not null references checkin.devices (id) on delete cascade,
  stay_id uuid references checkin.stays (id) on delete set null,
  room_name text not null unique check (room_name ~ '^call-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  status text not null default 'ringing'
    check (status in ('ringing', 'accepted', 'ended', 'no_answer', 'canceled', 'failed')),
  step text not null check (step in ('welcome', 'find', 'passport', 'face', 'address', 'done', 'other')),
  language text not null check (language in ('ja', 'en', 'zh-Hans', 'ko')),
  ring_deadline_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid,
  ended_at timestamptz,
  ended_by text check (ended_by in ('guest', 'staff', 'timeout', 'system')),
  check (status <> 'accepted' or (accepted_at is not null and accepted_by is not null)),
  check (status in ('ringing', 'accepted') or ended_at is not null)
);

-- 기기 하나에 진행 중 통화는 하나뿐.
create unique index staff_calls_one_active_per_device_idx on checkin.staff_calls (device_id)
  where status in ('ringing', 'accepted');
-- 직원 앱의 「지금 울리는 통화」.
create index staff_calls_org_ringing_idx on checkin.staff_calls (organization_id, ring_deadline_at)
  where status = 'ringing';
create index staff_calls_org_created_idx on checkin.staff_calls (organization_id, created_at desc);
create index staff_calls_device_created_idx on checkin.staff_calls (device_id, created_at desc);
create index staff_calls_stay_idx on checkin.staff_calls (stay_id) where stay_id is not null;

-- 다른 `checkin` 표와 같다: RLS 켬 · 정책 없음 · service_role 만.
revoke all on checkin.staff_calls from public, anon, authenticated;
grant all on checkin.staff_calls to service_role;
alter table checkin.staff_calls enable row level security;

-- ── 건물 설정 ───────────────────────────────────────────────────────────────
alter table checkin.property_settings
  add column staff_call_enabled boolean not null default false;

-- ── 권한 키 (202611040001 과 같은 형식) ────────────────────────────────────
-- 전화만 받는 키. 명부 열람(`checkin.view`)과 나눈다.
insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass) values
  ('checkin.call', true, false, true)
on conflict (capability) do update set
  individual_grant = excluded.individual_grant,
  individual_deny = excluded.individual_deny,
  platform_bypass = excluded.platform_bypass;

insert into public.capability_roles (capability, role) values
  ('checkin.call', 'owner'::public.organization_role),
  ('checkin.call', 'senior_managing_director'::public.organization_role)
on conflict do nothing;

-- ── 알림 종류 ───────────────────────────────────────────────────────────────
alter type public.notification_type add value if not exists 'checkin_staff_call';
alter type public.notification_type add value if not exists 'checkin_call_missed';
alter type public.notification_type add value if not exists 'checkin_staff_check';

-- ── 체크인 알림은 서버만 만든다 ─────────────────────────────────────────────
-- 정책 본문은 202610160003(쿼리당 한 번 계산) 뒤의 운영 모양 그대로이고 종류 제한만 더한다. 조직 멤버가 가짜 전화 알림을 넣지 못하게.
-- 202606030001 의 옛 모양(`auth.uid()` · `has_active_membership(organization_id)` 행마다 계산)으로 되돌리지 않는다(2026-11-10 운영 적용 전 확인).
-- `type::text` 로 비교하므로 위에서 더한 enum 값을 이 트랜잭션에서 쓰지 않는다.
drop policy "org members can create notifications for org recipients" on public.notifications;
create policy "org members can create notifications for org recipients"
on public.notifications
for insert
with check (
  (select auth.uid()) is not null
  and organization_id = any ((select public.current_user_active_organization_ids())::uuid[])
  and exists (
    select 1
    from public.memberships m
    where m.organization_id = notifications.organization_id
      and m.user_id = notifications.recipient_user_id
      and m.status = 'active'
  )
  and type::text not in ('checkin_staff_call', 'checkin_call_missed', 'checkin_staff_check')
);

-- 위 제한은 만들기만 막는다. UPDATE 정책 「recipients can mark own notifications read」는 누구의 행인지만 봐서, 수신자가 자기
-- 알림의 type · payload · href · recipient_user_id 등을 바꿔 전화 알림으로 둔갑시킬 수 있었다. 앱이 쓰는 칸은 읽음 시각뿐이므로
-- (src/lib/notifications/queries.ts) 칸 권한으로 좁힌다. service_role 은 그대로이고, 모든 알림 종류에 적용된다. 이 두 줄은 다시 돌려도 안전하다.
revoke update on public.notifications from public, anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ── 받는 사람 규칙 ─────────────────────────────────────────────────────────
-- apps/checkin 은 Foldy 코드를 가져올 수 없어 앱의 `memberIdsWithCapability`(src/lib/capabilities-server.ts)와 같은 규칙을 여기 둔다:
--   이 조직의 활성 멤버 + (활성 개인 부여 또는 역할 기본값, 전무는 owner 를 물려받음) − 활성 개인 차단(대표 · 전무는 면역) − Auth 정지 계정.
-- `has_capability` 를 부르지 않는 이유: 그 함수는 플랫폼 개발자를 통과시키지만, 알림 받는 사람에는 넣지 않는다(앱과 같다).
-- security definer: `auth.users.banned_until` 을 읽어야 한다. 세 함수 모두 service_role 만 실행한다.
create function checkin.member_can_receive(p_organization_id uuid, p_user_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and not exists (
        select 1 from auth.users u
        where u.id = m.user_id and u.banned_until > now()
      )
      and not (
        m.role not in ('owner', 'senior_managing_director')
        and exists (
          select 1 from public.membership_permission_overrides o
          where o.organization_id = p_organization_id
            and o.user_id = m.user_id
            and o.permission_key = p_capability
            and o.effect = 'deny'
            and o.revoked_at is null
            and (o.expires_at is null or o.expires_at > now())
        )
      )
      and (
        exists (
          select 1 from public.membership_permission_overrides o
          where o.organization_id = p_organization_id
            and o.user_id = m.user_id
            and o.permission_key = p_capability
            and o.effect = 'grant'
            and o.revoked_at is null
            and (o.expires_at is null or o.expires_at > now())
        )
        or exists (
          select 1 from public.capability_roles cr
          where cr.capability = p_capability
            and (cr.role = m.role or (m.role = 'senior_managing_director' and cr.role = 'owner'))
        )
      )
  );
$$;

-- 받은 직원이 아직 통화를 이어 가도 되는가. 활성 플랫폼 개발자는 `checkinGate("checkin.call")` 를 지나 받을 수 있으므로
-- (활성 멤버십 + 계정 정지 아님이면) 여기서도 통과시킨다 — 빼면 받자마자 다음 확인에서 통화가 끊긴다.
create function checkin.can_take_call(p_organization_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select checkin.member_can_receive(p_organization_id, p_user_id, 'checkin.call')
    or exists (
      select 1
      from public.platform_admins pa
      join public.memberships m on m.user_id = pa.user_id
      where pa.user_id = p_user_id
        and pa.is_active = true
        and m.organization_id = p_organization_id
        and m.status = 'active'
        and not exists (
          select 1 from auth.users u
          where u.id = p_user_id and u.banned_until > now()
        )
    );
$$;

-- ── 알림 넣기 ───────────────────────────────────────────────────────────────
-- 돌려주는 값은 받는 사람 수다. 중복 키로 건너뛴 행도 센다 — 0 이면 「받을 사람이 없음」으로 읽는다.
create function checkin.notify_staff(
  p_organization_id uuid,
  p_capability text,
  p_type text,
  p_dedupe_key text,
  p_href text,
  p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipients uuid[];
  v_call_id uuid := (p_payload ->> 'callId')::uuid;
  v_source_id uuid := coalesce(v_call_id, (p_payload ->> 'stayId')::uuid);
begin
  if v_source_id is null then
    raise exception 'notify_staff: payload 에 callId 또는 stayId 가 필요합니다' using errcode = '22023';
  end if;

  select coalesce(array_agg(m.user_id), '{}')
  into v_recipients
  from public.memberships m
  where m.organization_id = p_organization_id
    and m.status = 'active'
    and checkin.member_can_receive(p_organization_id, m.user_id, p_capability);

  insert into public.notifications (organization_id, recipient_user_id, type, href, source_type, source_id, dedupe_key, payload)
  select
    p_organization_id,
    recipient,
    p_type::public.notification_type,
    p_href,
    case when v_call_id is null then 'checkin_stay' else 'checkin_staff_call' end,
    v_source_id,
    p_dedupe_key,
    p_payload
  from unnest(v_recipients) as recipient
  on conflict (recipient_user_id, dedupe_key) do nothing;

  return cardinality(v_recipients);
end;
$$;

revoke all on function checkin.member_can_receive(uuid, uuid, text) from public, anon, authenticated;
revoke all on function checkin.can_take_call(uuid, uuid) from public, anon, authenticated;
revoke all on function checkin.notify_staff(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function checkin.member_can_receive(uuid, uuid, text) to service_role;
grant execute on function checkin.can_take_call(uuid, uuid) to service_role;
grant execute on function checkin.notify_staff(uuid, text, text, text, text, jsonb) to service_role;
