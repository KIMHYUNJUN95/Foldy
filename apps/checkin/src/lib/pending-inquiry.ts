// Beds24 문의(`inquiry` · 5) · 예약 요청(`request` · 3) 판별(2026-11-19). Foldy `src/lib/beds24/reservation-status.ts` 의
// `isPendingBeds24Inquiry` 와 같은 규칙을 따로 둔다 — 체크인 앱은 Foldy 코드를 가져오지 않는다(16 §2). 바꾸면 두 곳을 같이 고친다.
// Foldy 표에는 `status = 'confirmed'` 로 적히고 원본 상태는 `raw_payload.status` 에만 남는다. 상태가 없으면 문의가 아니다.
// 정확히 이 값만(Foldy DB 거르기와 같은 집합) — 대소문자 · 공백이 다른 값은 문의로 보지 않는다.

const PENDING: ReadonlyArray<string | number> = ["inquiry", "request", "3", "5", 3, 5];

export function isPendingBeds24Inquiry(rawPayload: unknown): boolean {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return false;
  const status = (rawPayload as Record<string, unknown>).status;
  if (typeof status !== "string" && typeof status !== "number") return false;
  return PENDING.includes(status);
}
