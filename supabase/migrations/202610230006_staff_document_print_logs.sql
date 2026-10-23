-- 신분 서류 A4 인쇄 기록 — 누가 · 언제 · 누구 것을 뽑았나 (재류카드 R3, 2026-10-23).
--
-- 도메인 계약: docs/product/41-residence-card-workflow.md §3-4 · §10
-- 데이터 모델: docs/engineering/04-data-model.md → staff_document_print_logs
--
-- 결정:
--   * 인쇄 화면(`/account/id-card/print`)에서 인쇄할 때마다(인쇄 버튼 · 브라우저 Ctrl+P 모두) 서버 액션이 대상 한 사람당 한 줄 남긴다.
--   * `document_id` 는 그때 뽑은 서류 행 id. 서류 행은 갱신 · 정리로 사라질 수 있어 FK 를 걸지 않는다(기록이 서류보다 오래 남지 않게 정리 작업이 같이 지운다).
--   * 쓰기 · 읽기 모두 서버(service role)만 — 정책 없음. 이 프로젝트는 새 표에 기본 권한이 붙지 않으므로 GRANT 를 꼭 같이 둔다(202610230002 교훈).
--   * 지우기: 퇴사 3년 뒤 정리 작업(`src/lib/staff-documents/retention.ts`)이 그 사람(대상) 기록을 서류 · 사진과 함께 하드 삭제한다(41 §6).

create table if not exists public.staff_document_print_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  printed_by uuid references public.profiles(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null,
  printed_at timestamptz not null default now()
);

comment on table public.staff_document_print_logs is '신분 서류 A4 인쇄 기록 — 인쇄한 사람 · 대상 · 서류 · 시각. docs/product/41 §3-4';

create index if not exists staff_document_print_logs_org_user
  on public.staff_document_print_logs (organization_id, user_id, printed_at);

alter table public.staff_document_print_logs enable row level security;
-- 정책 없음 — authenticated 는 읽기 · 쓰기 모두 막힌다. 서버 액션(service role)만 쓴다.

grant all on public.staff_document_print_logs to service_role;
