-- 판매 캘린더 「예약 표시」 필터 기억 (2026-11-26).
--
-- 도메인 계약: docs/product/33-calendar-write-features.md 「예약 표시 — 상태 필터」
--
-- 사용자마다 마지막으로 고른 예약 표시(확정 · 문의 · 예약 요청 · 취소)를 남긴다. 주소(`show=`)가 없으면 이 값으로 연다.
-- 비어 있으면(null) 기본 = 확정만. 빈 배열은 「아무것도 안 보기」다. 대시보드 · 모바일이 같은 값을 쓴다.
-- 본인 행만 서버(service-role)가 쓰고 읽는다(`ops_calendar_mode` 와 같은 방식) — 새 RLS 정책 · GRANT 는 없다.
-- 기본값 없는 null 칸 추가라 표를 다시 쓰지 않는다(잠금 짧음).
alter table public.profiles
  add column if not exists ops_calendar_status_filter text[]
    check (
      ops_calendar_status_filter is null
      or ops_calendar_status_filter <@ array['confirmed', 'inquiry', 'request', 'cancelled']::text[]
    );

comment on column public.profiles.ops_calendar_status_filter is
  '판매 캘린더 예약 표시 필터(confirmed·inquiry·request·cancelled 중 고른 것). null 이면 확정만.';
