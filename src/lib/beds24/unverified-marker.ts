/**
 * 「Beds24 에서 확인하지 못하고 본문으로 적용한 예약」 표시 (2026-11-26 사용자 결정).
 *
 * 웹훅 확인 읽기가 안 될 때(`verify_unavailable`) 본문을 적용하면서 저장 행의 `raw_payload` 에 이 키를 남긴다.
 * 표시된 예약은 자동 안내를 계획 · 큐에 넣지 않는다 — 지어낸 배달로 손님에게 메시지가 나가지 않게.
 * Beds24 에서 읽은 값으로 쓰는 경로(확인된 웹훅 · 매일 정합 · 백필 · 판매 캘린더 되읽기)는 모두 `raw_payload` 를
 * **통째로 바꾸므로** 표시가 저절로 지워진다. 확인 없이 본문으로 덮는 웹훅(상태가 그대로인 배달)은 표시를 이어 붙인다.
 * 마이그레이션 없음 — docs/engineering/01-beds24-integration.md 「2026-11-26 웹훅 순서 · 확인 · 상한」.
 */
export const UNVERIFIED_MARKER_KEY = "_foldy_unverified_at";
/** 매일 다시 읽기에서 읽었는데도 표시가 남은 행에 그 시각을 적는다 — 다음 날 순서를 뒤로 돌려 다른 예약이 굶지 않게. */
export const UNVERIFIED_RECHECK_AT_KEY = "_foldy_recheck_at";

export function isUnverifiedMarker(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function withUnverifiedMarker<T>(payload: T, unverifiedAt: string | null | undefined): T {
  if (!unverifiedAt || !payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return { ...(payload as Record<string, unknown>), [UNVERIFIED_MARKER_KEY]: unverifiedAt } as T;
}
