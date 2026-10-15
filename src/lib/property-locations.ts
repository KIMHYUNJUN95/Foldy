// 건물 위치(위도 · 경도) — 예약 캘린더 건물 지도(2026-10-15)에 쓴다.
//
// 출입 비밀번호가 든 `property-map-links.ts` 를 클라이언트로 보내지 않으려고 좌표만 따로 둔다.
// 값의 출처: 각 건물 `googleMapsUrl` 의 `!3d<위도>!4d<경도>`(구글 지도 핀), STAY ARI Apartment Hotel 은 링크에 좌표가
// 없어 국토지리원 주소 검색(大久保一丁目9番26号)으로 찾았다 — 같은 검색으로 오쿠보A(一丁目5番19号)를 찾으면 구글 핀과
// 2 m 안쪽으로 맞는다. 오쿠보B 는 오쿠보A 와 같은 자리(세 채 중 가장 왼쪽 집)라 서쪽으로 몇 m 만 옮겨 둔다.
// 새 건물이 생기면 여기 한 줄을 더한다(없으면 지도엔 안 나오고 목록에만 나온다).
// 문서: docs/product/15-reservation-calendar.md → 「건물 지도」.

export type PropertyLocation = { lat: number; lng: number };

export const PROPERTY_LOCATIONS: Record<string, PropertyLocation> = {
  아라키초A: { lat: 35.691589, lng: 139.7235419 },
  아라키초B: { lat: 35.6913069, lng: 139.7242565 },
  가부키초: { lat: 35.6979227, lng: 139.7025887 },
  다카다노바바: { lat: 35.7113447, lng: 139.6966335 },
  오쿠보A: { lat: 35.7002401, lng: 139.706157 },
  오쿠보B: { lat: 35.7002401, lng: 139.70603 },
  오쿠보C: { lat: 35.699386, lng: 139.7038418 },
  "STAY ARI Apartment Hotel": { lat: 35.700054, lng: 139.70488 },
};

export function getPropertyLocation(canonicalName: string): PropertyLocation | null {
  return PROPERTY_LOCATIONS[canonicalName] ?? null;
}
