-- 시프트 신청 · 청소 배정 (2026-10-20)
--
-- 도메인 계약: docs/product/37-cleaning-shift-assignment.md
--
-- Hotelsmart 의 청소 배정(그날 시프트를 신청한 알바를 그날 체크아웃 객실에 넣기)을 Foldy 로 옮긴다. 체크인은 Hotelsmart 그대로.
-- 배정 = 확정(단계 하나). 방 키는 **물리 객실 키**(「건물_표시 객실」 — 아라키초 `_2` 판매 리스팅을 접은 것, `cleaning_list_extra_rooms` 와 같다).
--
-- 모든 표는 RLS 를 켜고 정책을 두지 않는다 — **service-role 전용**. 읽기 · 쓰기는 서버(src/lib/cleaning-assign/*)가 권한 키
-- (`cleaning.work` · `cleaning.assign`)를 확인한 뒤 한다. 알바가 동료 배정을 「내가 배정된 날 중 오늘 · 내일만」 보는 규칙도 서버가 데이터를 걸러 지킨다.

-- ── ① 시프트 신청 ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.cleaning_shift_applications (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  -- self = 본인이 앱에서 · admin = 관리자가 대신 넣음(급한 건 · 앱 쓰기 어려운 사람)
  source text not null default 'self' check (source in ('self', 'admin')),
  -- 그날만 다른 출근 시각(없으면 사람별 기본 시각)
  start_time time,
  -- 관리자가 그날 일정을 취소했다(당일 예약 취소 등) — 「배정 없음」
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  -- 배정된 날 본인이 보낸 취소 요청(관리자 확인 대기)
  cancel_requested_at timestamptz,
  cancel_request_note text check (cancel_request_note is null or char_length(cancel_request_note) between 1 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, work_date)
);
create index if not exists cleaning_shift_applications_org_date_idx
  on public.cleaning_shift_applications (organization_id, work_date);

comment on table public.cleaning_shift_applications is
  '청소 시프트 신청(사람 × 날짜). 배정 = 확정이라 확정 열이 없다. service-role 전용 — docs/product/37-cleaning-shift-assignment.md';

-- ── ② 배정 — 방 하나 × 사람 하나가 한 줄 ─────────────────────────────────────────────────────────
-- 한 방에 여러 명(큰 방 2~3명 · 견습)이 들어가므로 (날짜, 방, 사람)이 유일하다. 같은 사람을 같은 방에 두 번 넣는 것을 DB 가 막는다 —
-- 담당 여러 명이 동시에 눌러도 하나만 들어간다. 저장은 방 한 건씩(하루를 통째로 덮어쓰는 저장이 없다).
create table if not exists public.cleaning_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_date date not null,
  room_key text not null check (char_length(room_key) between 1 and 80),
  property_name text not null check (char_length(property_name) between 1 and 80),
  room_label text not null check (char_length(room_label) between 1 and 40),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, work_date, room_key, user_id)
);
create index if not exists cleaning_assignments_org_date_idx on public.cleaning_assignments (organization_id, work_date);
create index if not exists cleaning_assignments_org_user_date_idx on public.cleaning_assignments (organization_id, user_id, work_date);

comment on table public.cleaning_assignments is
  '청소 배정(날짜 × 물리 객실 키 × 사람). 유일 (조직, 날짜, 방, 사람). service-role 전용.';

-- ── ③ 못 한 방 처리 — 미루기 · 처리 끝 ─────────────────────────────────────────────────────────
-- 그날 청소가 안 된 방은 다음 날 미배정 맨 위로 계속 뜬다(「어제부터 · N일째」). 여기 줄이 있으면:
--   kind = 'defer'   → until_date 전까지 숨고 그날 다시 뜬다(날짜 정해 미루기). until_date 가 다음 날이면 「다음 날로 미룸」(사유만 남김).
--   kind = 'resolved' → 청소가 필요 없게 됐다(처리 끝) — 더 뜨지 않는다.
create table if not exists public.cleaning_room_holds (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  room_key text not null check (char_length(room_key) between 1 and 80),
  -- 원래 청소해야 했던 날
  origin_date date not null,
  property_name text not null check (char_length(property_name) between 1 and 80),
  room_label text not null check (char_length(room_label) between 1 and 40),
  kind text not null check (kind in ('defer', 'resolved')),
  until_date date,
  reason text check (reason is null or char_length(reason) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, room_key, origin_date),
  check (kind <> 'defer' or until_date is not null)
);

comment on table public.cleaning_room_holds is
  '청소 못 한 방의 미루기(defer, until_date 까지 숨김) · 처리 끝(resolved). service-role 전용.';

-- ── ④ 배정 설정 — 제안 규칙(조직 하나에 한 벌) · 비교표 기준 ─────────────────────────────────────
create table if not exists public.cleaning_assign_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- [{ "key": "fixed_staff", "enabled": true }, …] — 순서가 곧 우선순위. 키 목록은 앱(src/lib/cleaning-assign/rules.ts)이 정한다.
  rules jsonb not null default '[]'::jsonb,
  -- 월 비교표 「평균에서 N% 넘게 벗어남」
  flag_threshold smallint not null default 25 check (flag_threshold between 5 and 90),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.cleaning_assign_setting_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  -- { "area": "rules" | "fixed" | "staff" | "room", "summary": "…", "before": …, "after": … }
  changes jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists cleaning_assign_setting_logs_org_idx on public.cleaning_assign_setting_logs (organization_id, created_at desc);

-- ── ⑤ 건물별 고정 인력 — 1 · 2 · 3순위(관리자가 직접, 4순위 이상도) ──────────────────────────────
create table if not exists public.cleaning_fixed_staff (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_name text not null check (char_length(property_name) between 1 and 80),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier smallint not null check (tier between 1 and 9),
  position smallint not null default 0,
  primary key (organization_id, property_name, user_id)
);

-- ── ⑥ 사람별 — 우선 배정 · 견습 · 견습 담당 · 기본 출근 시각 · 비공개 메모 · 메인 건물 ─────────────
create table if not exists public.cleaning_staff_profiles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  priority boolean not null default false,
  trainee boolean not null default false,
  -- 「아직 견습인가요?」를 물을 견습 횟수(처음 6, 「계속 견습」이면 +2)
  trainee_check_at smallint not null default 6 check (trainee_check_at between 1 and 99),
  trainer boolean not null default false,
  default_start_time time,
  memo text check (memo is null or char_length(memo) <= 200),
  -- 배정 담당의 메인 건물(하루 보기 기본 필터)
  main_properties text[] not null default '{}',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- ── ⑦ 객실별 보통 인원(큰 방 2명) ────────────────────────────────────────────────────────────────
create table if not exists public.cleaning_room_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  room_key text not null check (char_length(room_key) between 1 and 80),
  usual_headcount smallint not null default 1 check (usual_headcount between 1 and 5),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, room_key)
);

-- ── ⑧ RLS — 켜고 정책 없음(service-role 전용) ────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'cleaning_shift_applications', 'cleaning_assignments', 'cleaning_room_holds', 'cleaning_assign_settings',
    'cleaning_assign_setting_logs', 'cleaning_fixed_staff', 'cleaning_staff_profiles', 'cleaning_room_settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

-- ── ⑨ 권한 키 `cleaning.assign` — 배정 · 배정 설정 · 대신 넣기 · 취소 요청 처리 ─────────────────────
-- 기본 대표 · 전무 · 현장 매니저. 배정 담당이 건물마다 2명 정도라 개인 부여 · 차단을 연다. 판정은 앱 서버(레지스트리) — 이 표는 DB 사본.
insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass) values
  ('cleaning.assign', true, true, true)
on conflict (capability) do update set
  individual_grant = excluded.individual_grant,
  individual_deny = excluded.individual_deny,
  platform_bypass = excluded.platform_bypass;

insert into public.capability_roles (capability, role) values
  ('cleaning.assign', 'owner'::public.organization_role),
  ('cleaning.assign', 'senior_managing_director'::public.organization_role),
  ('cleaning.assign', 'field_manager'::public.organization_role)
on conflict do nothing;
