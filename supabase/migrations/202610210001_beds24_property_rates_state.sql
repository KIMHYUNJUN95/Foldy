-- 건물별 요금 읽기 상태 (2026-10-21).
--
-- 도메인 계약: docs/product/33-calendar-write-features.md 「안전망은 건물을 나눠 돈다 · 웹훅이 놓친 변경 감지」
--
-- 판매 캘린더 요금은 **재고 웹훅이 메인**이다 — 바뀐 건물만 몇 초 안에 다시 읽는다. 15분 주기 동기화
-- (`/api/beds24/rates-sync`)는 놓친 배달을 메우는 안전망인데, 예전에는 매번 9건물 × 12개월을 한 번에
-- 읽어(실측 약 35초) Beds24 연결이 한 번만 늦어도 60초 상한을 넘겼다(2026-10-19 · 10-21 504).
--
-- 이제 안전망은 **가장 오래 안 읽힌 건물부터 몇 곳만** 읽는다. 그 순서를 여기서 정한다. 웹훅이 방금
-- 읽은 건물은 뒤로 밀리므로 안전망은 웹훅이 안 건드린 건물에 크레딧을 쓴다.
--
-- 안전망이 읽었는데 Beds24 가격이 우리 표와 달랐다 = **웹훅이 그 변경을 놓쳤다.** 그 시각·건수를
-- 남긴다(`last_missed_*`). 라우트가 응답에 실어 GitHub Actions 가 실패로 알린다.
--
-- 건물당 한 줄. 서비스 롤 전용.
create table if not exists public.beds24_property_rates_state (
  external_property_id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- 12개월을 통째로 다시 읽은 마지막 시각(웹훅 · 틱 · 안전망 어느 경로든 성공한 읽기).
  last_full_read_at timestamptz,
  -- 'webhook' | 'tick' | 'net'
  last_full_read_source text check (last_full_read_source in ('webhook', 'tick', 'net')),
  -- 이 건물 재고(가격) 웹훅이 마지막으로 도착한 시각. 디바운스로 읽기를 미룬 배달도 센다.
  last_webhook_at timestamptz,
  -- 안전망이 웹훅이 놓친 가격 변경을 찾은 마지막 시각과 그때 건수(칸 수).
  last_missed_at timestamptz,
  last_missed_changes integer,
  updated_at timestamptz not null default now()
);

comment on table public.beds24_property_rates_state is
  '건물별 Beds24 요금 읽기 상태 — 안전망 순서(오래된 건물부터)와 웹훅이 놓친 변경 기록. 서비스 롤 전용.';

create index if not exists beds24_property_rates_state_read_idx
  on public.beds24_property_rates_state (last_full_read_at nulls first);

-- `beds24_deferred_refreshes` 와 같은 방식 — RLS 를 켜고 정책을 두지 않아 anon/authenticated 는 0행.
alter table public.beds24_property_rates_state enable row level security;
revoke all on public.beds24_property_rates_state from anon, authenticated;
grant all on public.beds24_property_rates_state to service_role;
