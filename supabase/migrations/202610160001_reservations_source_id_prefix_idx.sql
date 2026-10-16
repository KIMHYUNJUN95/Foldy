-- 예약 번호 앞부분 검색용 인덱스 (2026-10-16).
--
-- 웹훅마다 `findReservationRowsByOriginalBookingId`(`src/lib/beds24/reservation-lookup.ts`)가
-- `source_reservation_id LIKE '<채널번호>::room::%'` 로 다객실 예약의 형제 행을 찾는다. 기존
-- `(organization_id, source, source_reservation_id)` 유니크 인덱스는 `source` 가 가운데 있고
-- DB 정렬이 en_US 라 LIKE 앞부분 검색에 쓰이지 않는다 — 매번 예약 전체(1.7만 행)를 훑었다.
-- 이 검색 두 종류가 DB 실행 시간의 절반 이상이었고, 2026-10-16 08:04(도쿄) 웹훅이 몰린 3분 동안
-- DB 가 8초 제한을 넘겨 판매 캘린더 · 웹훅 · 자동화가 같이 실패했다.
--
-- `text_pattern_ops` 라야 en_US 정렬에서도 LIKE 'prefix%' 가 인덱스 범위 검색이 된다.
-- 같은 열의 `=` 검색(정확한 번호)도 이 인덱스를 쓸 수 있다.

create index if not exists reservations_org_source_reservation_id_pattern_idx
  on public.reservations (organization_id, source_reservation_id text_pattern_ops);
