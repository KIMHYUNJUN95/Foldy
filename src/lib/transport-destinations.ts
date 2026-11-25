/**
 * 교통비 「출근지」 — **순수 모듈. 서버 import 없음** (2026-09-11).
 *
 * 입력 화면(클라이언트)과 저장 경로(서버)가 **같은 키와 같은 판정**을 써야 한다. 특히
 * `transportDestinationRequiresMemo` 가 갈라지면 화면은 통과시키고 서버는 거절하는(또는 그
 * 반대) 상태가 된다. 목록을 실제로 읽어오는 쪽은 `transport-destinations-server.ts` 다.
 *
 * ## 왜 만들었나
 *
 * 예전에는 출근지가 **코드에 박힌 문자열 목록**이었다(`transport-statement.tsx` 의
 * `BUILDING_KEYS`). 그래서 두 가지가 동시에 틀어져 있었다.
 *
 * 1. **새로 연 건물이 목록에 없었다.** 2026-09 에 문을 연 STAY ARI Apartment Hotel 로 출근한
 *    알바생은 고를 항목 자체가 없었다. 목록에는 대신 `스카이` 가 있었는데, 그건 같은 건물의
 *    **오픈 전 이름**이었다.
 * 2. **저장되는 값이 「번역된 라벨」이었다.** 일본어로 쓰는 직원이 고르면 `高田馬場`, 한국어면
 *    `다카다노바바` 가 저장된다 — 같은 건물이 언어별로 다른 값이 된다. 금액을 기억하려면 이 값을
 *    키로 삼아야 하는데 키로 쓸 수가 없었다.
 *
 * 그래서 **캘린더가 쓰는 건물 목록과 같은 곳**에서 가져온다. 건물이 늘면 따라오고, 저장은 라벨이
 * 아니라 `property_id` 로 한다.
 *
 * ## 목록의 구성
 *
 * - **건물** — Beds24 에서 동기화된 운영 건물. 사노는 운영 대상이 아니라 빠진다(캘린더와 동일
 *   기준: `isExcludedOperationalProperty`).
 * - **사무실** — 건물이 아니지만 출근한다. `property_id` 가 없으므로 고정 키로 구분한다.
 * - **기타** — 건물 외 영수증(가끔 있다). **메모가 필수다** — 어디에 왜 썼는지가 없으면 나중에
 *   정산할 수가 없다.
 */

/** 저장·조회에 쓰는 안 흔들리는 키. 건물은 `property_id`, 나머지는 고정값. */
export const TRANSPORT_OFFICE_KEY = "office";
export const TRANSPORT_OTHER_KEY = "other";

export type TransportDestination = {
  /** 금액 기억과 저장에 쓰는 키. 건물이면 `property_id`. */
  key: string;
  /** 화면에 보이는 이름(로케일 반영). 저장 키로 쓰지 말 것. */
  label: string;
  /** 서버로 보내고 저장하는 한국어 기준 이름(`아라키초A`). 화면에는 `label` 을 쓰고, 값은 이쪽을 쓴다. */
  canonicalLabel: string;
  /** 건물이면 `properties.id`, 사무실·기타는 null. */
  propertyId: string | null;
  kind: "property" | "office" | "other";
};

/**
 * 저장할 출근지 키 — **서버가 다시 만든다**(2026-11-25). 화면 키 문자열은 믿지 않는다.
 * 키 규칙은 목록(`listTransportDestinations`)과 같다: 건물 = `property_id`, 사무실 · 기타 = 위 상수.
 * - 같은 조직으로 **확인된** 건물 id 가 있으면 그 id.
 * - 없으면 화면 키가 사무실 · 기타 상수일 때만 그 값.
 * - 그 밖(엉뚱한 문자열, 확인 안 된 건물 id)은 비움.
 * 금액 기억 키(`property_id ?? destinationKey`)는 화면이 목록 키를 그대로 보내던 지금까지의 저장값과 같다.
 */
export function resolveTransportDestinationKey(
  verifiedPropertyId: string | null,
  rawKey: string | null | undefined,
): string | null {
  if (verifiedPropertyId) return verifiedPropertyId;
  const key = rawKey?.trim();
  return key === TRANSPORT_OFFICE_KEY || key === TRANSPORT_OTHER_KEY ? key : null;
}

/** `기타` 는 메모가 없으면 저장할 수 없다. 화면과 서버가 같은 판정을 쓴다. */
export function transportDestinationRequiresMemo(key: string): boolean {
  return key === TRANSPORT_OTHER_KEY;
}

/**
 * 근무 기록의 **건물 이름**으로 출근지를 찾는다 — `property_id` 가 없을 때의 대비책 (2026-09-11).
 *
 * 자동 연결은 원래 근무지(`attendance_sites`)의 건물 FK 를 따라간다. 그런데 실제로는 **모든
 * 근무지의 `property_id` 가 비어 있어서**(2026-09-11 확인) 무엇도 이어지지 않았다 — 근무 기록을
 * 골라도 건물 칸이 그대로 비어 있었다.
 *
 * FK 를 채우는 것이 정답이지만, 그건 운영 데이터 정리다. 그 사이에도 화면은 동작해야 하므로
 * 이름으로 맞춰 본다. 「사무실」처럼 **애초에 건물이 아닌 근무지**는 FK 가 채워져도 여전히
 * 이름으로만 이어지므로, 이 대비책은 정리 뒤에도 쓸모가 남는다.
 *
 * 표기 차이(`다카다노바바` / `타카다노바바`)는 정규화 함수가 흡수한다. 못 찾으면 `null` —
 * 엉뚱한 건물을 고르느니 비워 두는 편이 낫다.
 */
export function matchDestinationByLabel(
  destinations: readonly TransportDestination[],
  label: string,
  canonicalize: (name: string) => string,
): TransportDestination | null {
  const wanted = label.trim();
  if (!wanted) return null;

  const exact = destinations.find((d) => d.label === wanted);
  if (exact) return exact;

  const canonicalWanted = canonicalize(wanted);
  const canonical = destinations.find((d) => canonicalize(d.label) === canonicalWanted);
  return canonical ?? null;
}
