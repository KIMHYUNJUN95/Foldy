-- 신분 서류 자동 읽기 기록 — 해외 이전 동의 기록(APPI 28조) + 하루 읽기 횟수 제한 (재류카드 R2, 2026-10-23).
--
-- 도메인 계약: docs/product/41-residence-card-workflow.md §10
-- 데이터 모델: docs/engineering/04-data-model.md → staff_id_ocr_reads
--
-- 결정:
--   * 사진을 미국 서버로 보내기 직전(서버 액션 `readIdCard`)에 한 줄 남긴다 — 동의한 사람 · 시각 · 동의 문구 판(version) · 화면 언어.
--     이 시점엔 아직 서류 행이 없을 수 있어(제출 전) `staff_id_documents` 칸이 아니라 따로 둔다. `document_id` 는 FK 없이 같은 id 를 담는다.
--   * 같은 표를 횟수 제한에도 쓴다(사람 하루 10번 · 조직 하루 200번, 도쿄 날짜). 서버리스라 메모리 대신 DB 로 센다.
--   * 쓰기 · 읽기 모두 서버(service role)만 — 정책 없음. 이 프로젝트는 새 표에 기본 권한이 붙지 않으므로 GRANT 를 꼭 같이 둔다(202610230002 교훈).
--   * 지우기: 퇴사 3년 뒤 정리 작업이 서류 · 사진과 함께 하드 삭제한다(41 §6).

create table if not exists public.staff_id_ocr_reads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null,
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  locale text not null check (locale in ('ko', 'ja', 'en')),
  created_at timestamptz not null default now()
);

comment on table public.staff_id_ocr_reads is '신분 서류 자동 읽기 기록 — 해외 이전 동의(누가 · 언제 · 문구 판 · 언어) + 하루 횟수 제한. docs/product/41 §10';

create index if not exists staff_id_ocr_reads_user_created
  on public.staff_id_ocr_reads (user_id, created_at);
create index if not exists staff_id_ocr_reads_org_created
  on public.staff_id_ocr_reads (organization_id, created_at);

alter table public.staff_id_ocr_reads enable row level security;
-- 정책 없음 — authenticated 는 읽기 · 쓰기 모두 막힌다. 서버 액션(service role)만 쓴다.

grant all on public.staff_id_ocr_reads to service_role;
