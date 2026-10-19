-- 웹훅 한 건 처리 시간 (2026-10-19)
--
-- 문서: docs/engineering/01-beds24-integration.md
--
-- `beds24_webhook_events` 에는 처리 시간이 없어 웹훅 한 건이 얼마나 걸렸는지 잴 수 없었다(Vercel Hobby 로그는
-- 30분치만 남고 duration 이 없다). 요청을 받은 시각부터 결과가 나온 시각까지(응답 직전)를 ms 로 남긴다.
-- 옛 행과 재조정(reconciliation) 행은 null 이다.
--
-- **적용 순서:** 이 열을 먼저 만들고, 그다음 `recordBeds24WebhookEvent` 가 `duration_ms` 를 쓰게 한다.
-- 코드가 먼저 나가면 없는 열이라 insert 가 통째로 실패한다(기록 실패는 삼켜지므로 조용히 이벤트가 사라진다).
alter table public.beds24_webhook_events
  add column if not exists duration_ms integer;

comment on column public.beds24_webhook_events.duration_ms is
  '웹훅 한 건(배치) 처리 시간(ms) — 요청을 받은 때부터 응답 직전까지. 응답 뒤 작업(after)은 포함하지 않는다.';
