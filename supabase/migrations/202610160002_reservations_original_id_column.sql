-- 예약 원래 번호 열 (2026-10-16 성능 점검).
--
-- 웹훅마다 `findReservationRowsByOriginalBookingId`(`src/lib/beds24/reservation-lookup.ts`)가
-- 같은 채널 번호의 행을 `source_reservation_id = '<번호>'` 와 `LIKE '<번호>::room::%'` 두 번으로
-- 찾았다. 202610160001 의 `text_pattern_ops` 인덱스는 숫자를 그대로 넣은 쿼리에선 8ms 지만,
-- PostgREST 처럼 **값을 매개변수로 넘기면**(일반 계획) LIKE 패턴을 미리 알 수 없어 인덱스를 못 쓰고
-- 예약 1.7만 행을 다 훑는다 — 같은 조건으로 재 보니 5.1초. 누적 DB 시간 1·2위가 이 쿼리였다.
--
-- `::room::` 앞부분(= `toOriginalReservationId()`)을 저장 생성 열로 두고 `=` 로 찾으면 매개변수든
-- 아니든 인덱스를 탄다. 정확한 번호 · 접두어 두 쿼리도 하나로 합친다.

alter table public.reservations
  add column if not exists original_reservation_id text
  generated always as (split_part(source_reservation_id, '::room::', 1)) stored;

create index if not exists reservations_org_original_reservation_id_idx
  on public.reservations (organization_id, original_reservation_id);
