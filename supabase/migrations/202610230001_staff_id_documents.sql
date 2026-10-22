-- 직원 신분 서류 — 재류카드(앞 · 뒤) · 마이넘버 카드(앞면만) (재류카드 R2, 2026-10-23).
--
-- 도메인 계약: docs/product/41-residence-card-workflow.md §3 · §5
-- 데이터 모델: docs/engineering/04-data-model.md → staff_id_documents
--
-- 결정:
--   * 쓰기는 서버 액션만(service role) — 본인 확인 · 권한 키 · 상태 전이를 앱이 한 곳에서 판단한다.
--     클라이언트는 사진 파일만 저장소에 직접 올린다(자기 경로만).
--   * 읽기 RLS: 본인 행 + 같은 조직의 `staff_documents.view`. 사진은 공개 URL 이 없고 서버가 짧은 서명 URL 로만 보여 준다.
--   * 마이넘버 개인번호(12자리)는 어떤 칸에도 없다 — 받지도 남기지도 않는다(41 §9-7).
--   * 갱신하면 새 행을 만들고 이전 행은 `is_current = false` 로 이력에 남긴다(41 §3-3).

-- 0) 권한 키 — 기본 대표 · 전무(시드는 202609100001 생성 구간에도 같이 들어 있다).
insert into public.capability_policies (capability, individual_grant, individual_deny, platform_bypass)
values ('staff_documents.view', true, true, true)
on conflict (capability) do update set
  individual_grant = excluded.individual_grant,
  individual_deny = excluded.individual_deny,
  platform_bypass = excluded.platform_bypass;
insert into public.capability_roles (capability, role) values
  ('staff_documents.view', 'owner'::organization_role),
  ('staff_documents.view', 'senior_managing_director'::organization_role)
on conflict do nothing;

-- 1) 표
create table if not exists public.staff_id_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('residence_card', 'my_number_card')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'returned')),
  is_current boolean not null default true,
  front_path text not null,
  back_path text,
  -- 카드에서 읽거나 본인이 고친 값(공통)
  name_roman text,
  birth_date date,
  gender text check (gender is null or gender in ('male', 'female')),
  nationality_text text,
  address text,
  expires_on date,
  -- 재류카드 전용
  card_number text check (card_number is null or card_number ~ '^[A-Z]{2}[0-9]{8}[A-Z]{2}$'),
  residence_status text,
  work_restriction text check (work_restriction is null or work_restriction in
    ('none', 'status_based', 'designated_org', 'designated', 'not_allowed')),
  extra_activity text check (extra_activity is null or extra_activity in ('none', 'weekly_28h', 'per_certificate')),
  -- 자동 읽기 기록: 읽은 값 그대로 + 본인이 고친 칸 이름
  ocr_used boolean not null default false,
  ocr_values jsonb,
  edited_fields text[] not null default '{}',
  -- 확인
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  return_reason text check (return_reason is null or char_length(return_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_id_documents_back_by_kind check (
    (kind = 'residence_card' and back_path is not null) or (kind = 'my_number_card' and back_path is null)
  ),
  constraint staff_id_documents_text_lengths check (
    coalesce(char_length(name_roman), 0) <= 80
    and coalesce(char_length(nationality_text), 0) <= 60
    and coalesce(char_length(address), 0) <= 200
    and coalesce(char_length(residence_status), 0) <= 60
  )
);

comment on table public.staff_id_documents is '직원 신분 서류 — 재류카드 앞 · 뒤 / 마이넘버 카드 앞면(개인번호 없음). docs/product/41';

-- 한 사람 · 한 조직에 지금 카드는 하나.
create unique index if not exists staff_id_documents_one_current
  on public.staff_id_documents (organization_id, user_id) where is_current;
create index if not exists staff_id_documents_org_expiry
  on public.staff_id_documents (organization_id, expires_on) where is_current;

create trigger staff_id_documents_set_updated_at
before update on public.staff_id_documents
for each row execute function public.set_updated_at();

alter table public.staff_id_documents enable row level security;

create policy "own or staff_documents.view can read id documents"
  on public.staff_id_documents
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_platform_admin())
    or public.has_capability(organization_id, (select auth.uid()), 'staff_documents.view')
  );
-- insert · update · delete 정책 없음 — 서버 액션(service role)만 쓴다.

-- 2) 비공개 저장소 — 경로 {org_id}/{user_id}/{document_id}/{front|back}-{임의}.jpg
--    다시 찍을 때마다 새 이름으로 올린다(덮어쓰기 정책을 두지 않으려고). 제출 때 서버가 안 쓰는 파일을 지운다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-documents', 'staff-documents', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 본인 경로에만 올린다(활성 멤버). 읽기 정책은 없다 — 보기는 서버가 서명 URL 로만.
create policy "members upload own staff documents"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'staff-documents'
    and array_length(string_to_array(name, '/'), 1) = 4
    and split_part(name, '/', 2) = (select auth.uid())::text
    and split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 4) ~ '^(front|back)-[0-9a-z]{6,24}\.jpg$'
    and exists (
      select 1 from public.memberships m
      where m.organization_id::text = split_part(name, '/', 1)
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
  );
