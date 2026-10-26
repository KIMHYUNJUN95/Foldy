-- 직원 신분 서류 — 관리자 대신 올리기(재류카드 R4, 2026-10-26).
--
-- 도메인 계약: docs/product/41-residence-card-workflow.md §3-2 · 「R4 구현」
-- 데이터 모델: docs/engineering/04-data-model.md → staff_id_documents
--
-- 결정(2026-10-26 사용자):
--   * 관리자가 종이 복사본을 스캔해 대신 올린 서류는 바로 「확인함」 — 올린 사람 = 확인한 사람.
--   * 화면에 「관리자가 올림」을 보이려고 올린 사람을 남긴다. 본인이 올린 행은 null 이다(지금까지의 행 모두).
--   * 사진은 서버가 만든 일회용 서명 업로드 주소로 올린다(대상 사람 경로) — 저장소 insert 정책(본인 경로만)은 그대로 둔다.

alter table public.staff_id_documents
  add column if not exists uploaded_by uuid references public.profiles(id) on delete set null;

comment on column public.staff_id_documents.uploaded_by is
  '대신 올린 관리자(재류카드 R4). 본인이 올린 행은 null. docs/product/41 §3-2';
