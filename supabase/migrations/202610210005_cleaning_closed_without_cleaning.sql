-- 청소 배정 「처리 끝」을 청소 기록으로 남기기 (2026-10-21)
--
-- 도메인 계약: docs/product/37-cleaning-shift-assignment.md 「미루기 · 처리 끝」 · docs/product/07-cleaning-workflow.md
--
-- 처리 끝(청소가 필요 없어짐)을 누르면 PC 청소 대시보드 강제완료처럼 그 방 그날 청소 기록(`cleaning_sessions`, 완료)을 하나 남긴다.
-- 실제로 청소한 것이 아니므로 표시를 붙인다 — 화면은 「처리 끝 · 청소 안 함」으로 보여 주고, 사람별 숫자(교통비 건물 · 현장 활동 ·
-- 급여 상세의 청소 · 월 비교표 · 내 오늘 청소)에서는 뺀다. 기록의 담당자는 처리 끝을 누른 관리자, 소요 시간은 비운다.
-- 되돌리기는 그 기록을 지운다 — 미룸 줄이 어떤 기록인지 기억한다(`closed_session_id`).

alter table public.cleaning_sessions
  add column if not exists closed_without_cleaning boolean not null default false;

comment on column public.cleaning_sessions.closed_without_cleaning is
  '청소 배정 「처리 끝」으로 남긴 기록(청소 안 함) — 사람별 숫자에서 뺀다.';

alter table public.cleaning_room_holds
  add column if not exists closed_session_id uuid references public.cleaning_sessions(id) on delete set null;

comment on column public.cleaning_room_holds.closed_session_id is
  '처리 끝(resolved)이 남긴 청소 기록 — 되돌리기가 지운다.';
