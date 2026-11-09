# 오쿠보A ↔ 오쿠보B 이름 맞바꾸기 — 실행 순서

운영 DB 쓰기다. 사용자가 Supabase Dashboard → SQL Editor 에서 직접 돌린다(에이전트는 실행하지 않음).
대상은 조직 `f393a735-eb57-4f95-8b82-361ba46b81a5` 하나. 데모 조직(`cfa0239d…`)은 건드리지 않고, 02 가 끝에서 「다른 조직 값 그대로」를 검사한다.

## 상황(2026-11-09 확인)
- Beds24: 205165 `Okubo_A (B棟)` → `Okubo_B`, 294552 `Okubo_B (A棟)` → `Okubo_A`.
- Foldy 마스터는 아직 옛 이름이고, 웹훅에 propName 이 없어 **지금 있는 기록은 전부 옛 이름**이다(11/8 예약까지).
  → 시각 구분 없이 전부 바꾸고, 마스터 이름도 같은 트랜잭션에서 바꾼다.

## 언제
예약 · 청소가 조용한 시간에 돌린다. 교통비 표는 트리거를 잠깐 끄는 동안 잠기고, 전체는 최대 10분(statement_timeout)이다.

## 1. 연습 실행 — `02-swap.sql`
그대로(`apply = false`) 전체 실행. 일부러 오류로 끝나며 전부 되돌아가고, 오류 메시지에 아래 내용이 나온다:
- 표별 바꾼 행 수
- f393 의 값별 건수 전 → 후

맞게 됐는지 볼 것:
- `Okubo_A (B棟)` 건수는 `Okubo_B` 로, `Okubo_B (A棟)` 건수는 `Okubo_A` 로 그대로 옮겨 갔는지
- 오쿠보A ↔ 오쿠보B, okubo_a ↔ okubo_b 건수가 서로 맞바뀌었는지
- 오쿠보C 와 다른 건물은 그대로인지

다음 오류가 나면 아무것도 바뀌지 않은 것이다(전부 되돌아감):
- 「마스터가 예상한 옛 이름이 아닙니다」: 이미 적용했거나 동기화가 이름을 바꾼 것이다. 멈추고 알려 줄 것.
- 「다른 조직 값이 바뀌었습니다」 또는 duplicate key 오류: 알려 줄 것.
- 에디터가 「current transaction is aborted」를 내면 `rollback;` 를 한 번 실행한다.

## 2. 적용
`apply = true` 로 바꿔 **한 번만** 실행 → commit, 마지막에 값별 전 → 후 표.
두 번째 실행은 맨 앞 검사(마스터가 옛 이름인가)가 막는다.

## 3. 확인 — `03-verify.sql`(블록 하나씩)
**적용 직후 바로 블록 3 을 먼저** 돌린다. 트랜잭션 도중에 들어온 웹훅이 옛 이름으로 쓴 행이 있으면 여기서 잡힌다(있으면 알려 줄 것).
1. 205165 = `Okubo_B`, 294552 = `Okubo_A`. Airbnb 링크(952403875937085488 / 1517052329343209381)가 같은 객실에 그대로 붙어 있는가.
   `room_listing_links` 는 room_id 로 묶여 있어서 바꿀 필요가 없다.
2. 값별 건수에서 f393 에 옛 원문이 남지 않았는가(객실 라벨 칸은 제외). 다른 조직(other) 줄은 02 전과 같은가.
3. 0줄이어야 한다.
4. 예약이 집 id 별로 새 이름 하나씩만 보이는가.
5. 몇 분 뒤 `dirty_months` 가 0이 되는가(판매 집계 다시 계산).
그다음 화면을 한 번씩 본다: 판매 캘린더, 매출, 청소 기록 · 배정 설정(고정 인력 · 메인 건물), 자동화 청소 목록의 제외 건물, 셀프 체크인 기기 · 건물 설정.

## 일부러 바꾸지 않은 것
**Beds24 원본 객실 라벨** — 바꾸지 않은 칸:
- `rooms.room_label` / `rooms.name`
- `reservations.room_label`
- `room_blocks.room_label`
- `beds24_block_logs.room_label`
- `price_change_logs.room_label`
- `checkin.stay_rooms.room_label`
- 리뷰 · 불만 · 제안의 `room_label`

이유: 객실 이름의 주인은 Beds24 동기화다. 또 예약 키가 `<번호>::room::<객실 라벨>` 이라서, 객실 라벨을 바꾸면 다음 웹훅이 같은 예약을 **새 행으로 또 만든다**.
오쿠보는 객실을 건물 이름으로 읽으므로 화면은 바뀐 건물 이름을 따른다.
**확인 필요:** Beds24 에서 **객실 이름도** 바뀌었다면(03 블록 1 의 room_label 과 Beds24 를 비교) 동기화가 rooms 를 새 이름으로 바꾸고,
그 뒤 웹훅부터 예약 키가 달라져 중복이 생길 수 있다. 그 경우는 따로 알려 줄 것.

## 코드에도 집마다 박힌 값이 있다(DB 밖 — 따로 코드 수정 필요)
`src/lib/property-map-links.ts` 의 `PROPERTY_MAP_META` 는 「오쿠보A」 키에 주소 · 지도 링크를 박아 두었다(「오쿠보B와 동일한 위치」 같은 문구 포함).
`src/lib/property-locations.ts` · `src/lib/admin-building-map.ts` · `src/components/calendar/building-map/building-map.tsx` 도 오쿠보A/B 를 직접 쓴다.
DB 만 맞바꾸면 이 값들은 반대 집을 가리킨다. 적용과 같은 때에 코드도 맞바꿔 배포해야 한다.

## 예약을 Beds24 에서 다시 받아 오는 방법(대안 — 권하지 않음)
`backfillBeds24Reservations` 도 property_name 을 「그 집 id 의 지금 마스터 이름」으로 다시 쓴다.
하지만 마스터를 먼저 바꿔야 하고, 개발 전용 라우트(`/api/dev/beds24/backfill-reservations`, localhost)로만 돈다. 또 날짜 구간 안의 예약만 받아 오고 Beds24 비용이 든다.
→ 02 의 SQL(전 기록 한 번에)이 더 안전하다.
