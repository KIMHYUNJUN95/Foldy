-- 셀프 체크인 `checkin` 스키마 (2026-11-02, 초안).
--
-- 설계: docs/engineering/16-self-checkin-technical-design.md §3 · docs/product/44-self-checkin-prd.md
-- 상태: **초안 — 운영 DB 에 적용하지 않는다.** 적용은 사용자 확인 뒤(CLAUDE.md 규칙 10).
--
-- 원칙(43 §8-9): 기존 Foldy 에 영향 없음.
--   · `public` 표는 바꾸지 않는다. `checkin` → `public` 외래 키도 두지 않는다(id 값만 저장).
--   · 손님 · 태블릿의 쓰기는 전부 `apps/checkin` 서버 라우트(service_role). anon 정책 없음.
--   · 직원(Foldy 로그인)은 **읽기만** — 권한 `checkin.view` / `checkin.documents` / `checkin.manage`.
--     권한 키 등록(capability_roles · capability_policies)은 직원 화면 단계에서 따로 넣는다.
--     그 전까지 `has_capability()` 는 플랫폼 개발자만 true → 직원은 아무것도 못 본다(안전한 기본값).
--   · delete 정책 없음(43 §8-14). 자동 삭제는 서버 크론(`jobs/retention`)이 service_role 로.
--   · 자식 표에도 organization_id 를 둔다 — RLS 가 부모 join 없이 한 줄로 판단(16 §3 보다 한 칸 추가).

create schema if not exists checkin;

revoke all on schema checkin from public, anon;
grant usage on schema checkin to authenticated, service_role;

-- ── 기기 ────────────────────────────────────────────────────────────────────
create table checkin.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  property_key text not null,
  name text not null check (char_length(name) between 1 and 60),
  token_hash text not null unique,
  registered_by uuid,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  app_version text,
  device_model text,
  os_version text,
  battery smallint check (battery between 0 and 100)
);
create index devices_org_property_idx on checkin.devices (organization_id, property_key) where revoked_at is null;

create table checkin.enrollment_codes (
  code text primary key check (code ~ '^[0-9]{8}$'),
  organization_id uuid not null,
  property_key text not null,
  device_name text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  used_at timestamptz
);

-- ── 건물 설정(계약의 재료) ──────────────────────────────────────────────────
create table checkin.property_settings (
  organization_id uuid not null,
  property_key text not null,
  languages text[] not null default array['ja', 'en', 'zh-Hans', 'ko'],
  welcome_text jsonb not null default '{}'::jsonb,
  terms_text jsonb not null default '{}'::jsonb,
  terms_version integer not null default 1 check (terms_version > 0),
  required_fields jsonb not null default '[]'::jsonb,
  video_seconds_per_guest smallint not null default 5 check (video_seconds_per_guest between 3 and 15),
  support_contacts jsonb not null default '{}'::jsonb,
  idle_seconds_input smallint not null default 240,
  idle_seconds_done smallint not null default 30,
  verification_method text not null default 'video'
    check (verification_method in ('video', 'staff_call', 'auto_match')),
  staff_pin_hash text,
  mrz_autofill boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, property_key)
);

-- ── 체크인 한 건 = 채널 예약 번호 하나 ──────────────────────────────────────
create table checkin.stays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  reservation_group_key text not null,          -- public.reservations.original_reservation_id
  property_key text not null,
  check_in_date date not null,                  -- 도쿄 날짜
  check_out_date date not null,
  guest_count_expected smallint not null default 1 check (guest_count_expected > 0),
  checkin_code text check (checkin_code ~ '^[0-9]{6}$'),
  status text not null default 'pending'
    check (status in ('pending', 'pre_registered', 'in_progress', 'checked_in', 'expired', 'cancelled')),
  pre_reg_token_hash text unique,
  pre_reg_sent_at timestamptz,
  reminded_at timestamptz,
  checked_in_at timestamptz,
  verified_at timestamptz,
  verified_by uuid,
  retain_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out_date > check_in_date),
  unique (organization_id, reservation_group_key)
);
create index stays_org_date_idx on checkin.stays (organization_id, check_in_date, property_key);
-- 6자리 코드는 기간 안에서만 겹치지 않으면 된다 — 진행 중인 stay 끼리만 unique.
create unique index stays_active_code_idx on checkin.stays (organization_id, checkin_code)
  where checkin_code is not null and status in ('pending', 'pre_registered', 'in_progress');
create index stays_retain_idx on checkin.stays (retain_until) where retain_until is not null;

create table checkin.stay_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stay_id uuid not null references checkin.stays (id) on delete cascade,
  reservation_id uuid not null,                 -- public.reservations.id (FK 없음)
  room_id text,
  room_label text not null,
  unique (stay_id, reservation_id)
);
create index stay_rooms_reservation_idx on checkin.stay_rooms (reservation_id);

-- ── 명부 ────────────────────────────────────────────────────────────────────
create table checkin.guests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stay_id uuid not null references checkin.stays (id) on delete cascade,
  stay_room_id uuid references checkin.stay_rooms (id) on delete set null,
  is_representative boolean not null default false,
  guest_type text not null default 'adult' check (guest_type in ('adult', 'child')),
  name_roman text,
  name_kana text,
  nationality char(3),                           -- ISO 3166-1 alpha-3
  has_japan_address boolean,
  address text,
  postal_code text,
  phone text,
  email text,
  birth_date date,
  gender text,
  occupation text,
  passport_number text,
  passport_expiry date,
  prev_stay text,
  next_dest text,
  source text not null default 'guest' check (source in ('beds24', 'guest', 'staff', 'mrz')),
  mrz_raw text,
  mrz_valid boolean,
  no_passport_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index guests_stay_idx on checkin.guests (stay_id);
create unique index guests_one_representative_idx on checkin.guests (stay_id) where is_representative;

create table checkin.guest_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  guest_id uuid not null references checkin.guests (id) on delete cascade,
  kind text not null check (kind in ('passport', 'face_video', 'id_card')),
  storage_path text not null unique,
  byte_size integer check (byte_size > 0),
  width integer,
  height integer,
  duration_s numeric(5, 2),
  captured_at timestamptz not null default now(),
  captured_on text not null check (captured_on in ('kiosk', 'guest_web', 'staff')),
  device_id uuid references checkin.devices (id) on delete set null,
  replaced_by uuid references checkin.guest_documents (id) on delete set null,
  retain_until date,
  sha256 text
);
create index guest_documents_guest_idx on checkin.guest_documents (guest_id);
create index guest_documents_device_idx on checkin.guest_documents (device_id);
create index guest_documents_replaced_idx on checkin.guest_documents (replaced_by);

create table checkin.consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stay_id uuid not null references checkin.stays (id) on delete cascade,
  guest_id uuid references checkin.guests (id) on delete set null,
  terms_version integer not null,
  agreed_at timestamptz not null default now(),
  locale text not null,
  device_id uuid references checkin.devices (id) on delete set null
);
create index consents_stay_idx on checkin.consents (stay_id);
create index consents_guest_idx on checkin.consents (guest_id);
create index consents_device_idx on checkin.consents (device_id);

-- ── 태블릿 진행(이어 하기 · 동시 잠금) ──────────────────────────────────────
create table checkin.sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stay_id uuid not null references checkin.stays (id) on delete cascade,
  device_id uuid references checkin.devices (id) on delete set null,
  started_at timestamptz not null default now(),
  last_step text,
  step_payload jsonb not null default '{}'::jsonb,
  finished_at timestamptz,
  abandoned_at timestamptz,
  locked_until timestamptz
);
create index sessions_stay_idx on checkin.sessions (stay_id);
create index sessions_device_idx on checkin.sessions (device_id);

-- ── 기록 ────────────────────────────────────────────────────────────────────
create table checkin.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  actor_user_id uuid,
  device_id uuid,
  action text not null,
  stay_id uuid,
  guest_id uuid,
  document_id uuid,
  at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  check (actor_user_id is not null or device_id is not null)
);
create index audit_log_org_at_idx on checkin.audit_log (organization_id, at desc);
create index audit_log_stay_idx on checkin.audit_log (stay_id) where stay_id is not null;

-- 자동 삭제 기록 — 개인 정보 없음.
create table checkin.deletions (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  stay_key text not null,
  deleted_at timestamptz not null default now(),
  counts jsonb not null default '{}'::jsonb
);

-- ── 권한 · RLS ──────────────────────────────────────────────────────────────
grant select on all tables in schema checkin to authenticated;
grant insert on checkin.audit_log to authenticated;
grant all on all tables in schema checkin to service_role;
grant usage, select on all sequences in schema checkin to service_role;

alter table checkin.devices enable row level security;
alter table checkin.enrollment_codes enable row level security;
alter table checkin.property_settings enable row level security;
alter table checkin.stays enable row level security;
alter table checkin.stay_rooms enable row level security;
alter table checkin.guests enable row level security;
alter table checkin.guest_documents enable row level security;
alter table checkin.consents enable row level security;
alter table checkin.sessions enable row level security;
alter table checkin.audit_log enable row level security;
alter table checkin.deletions enable row level security;

-- 현황 · 명부: checkin.view
create policy "checkin viewers read stays" on checkin.stays for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.view'));
create policy "checkin viewers read stay rooms" on checkin.stay_rooms for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.view'));
create policy "checkin viewers read guests" on checkin.guests for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.view'));
create policy "checkin viewers read consents" on checkin.consents for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.view'));
create policy "checkin viewers read sessions" on checkin.sessions for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.view'));

-- 여권 사진 · 동영상 줄: checkin.documents (파일 자체는 서버가 1~5분 서명 URL 로만 준다)
create policy "checkin document viewers read documents" on checkin.guest_documents for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.documents'));

-- 기기 · 건물 설정 · 기록: checkin.manage
create policy "checkin managers read devices" on checkin.devices for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.manage'));
create policy "checkin managers read enrollment codes" on checkin.enrollment_codes for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.manage'));
create policy "checkin managers read property settings" on checkin.property_settings for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.manage'));
create policy "checkin managers read audit log" on checkin.audit_log for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.manage'));
create policy "checkin managers read deletions" on checkin.deletions for select to authenticated
  using (public.has_capability(organization_id, (select auth.uid()), 'checkin.manage'));

-- 기록은 본인 이름으로 넣기만(열람 · 내보내기 기록). update · delete 정책 없음.
create policy "checkin viewers write own audit rows" on checkin.audit_log for insert to authenticated
  with check (
    actor_user_id = (select auth.uid())
    and device_id is null
    and public.has_capability(organization_id, (select auth.uid()), 'checkin.view')
  );

-- ── 파일 버킷(비공개) ───────────────────────────────────────────────────────
-- storage.objects 정책은 두지 않는다: 업로드 · 열람 모두 서버가 만든 서명 URL 로만.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checkin-documents',
  'checkin-documents',
  false,
  62914560,  -- 60MB: 동영상 상한(60초 · 약 1MB/초)
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
on conflict (id) do nothing;
