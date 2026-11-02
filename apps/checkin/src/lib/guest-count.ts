// 예약 원문(raw_payload)의 인원. Foldy `reservation-guests.ts` 와 같은 키 — 성인 + 어린이 + 유아(전원 명부라 유아도 센다).
const ADULT_KEYS = ["numAdult", "num_adult", "num_adults", "adults", "adult"];
const CHILD_KEYS = ["numChild", "num_child", "num_children", "children", "child"];
const INFANT_KEYS = ["numInfant", "num_infant", "infants", "infant"];

function readNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Math.max(0, Math.round(Number(value)));
    }
  }
  return null;
}

/** 모르면 null — 부르는 쪽이 방 하나 1명으로 본다. */
export function guestCountOf(rawPayload: unknown): number | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const record = rawPayload as Record<string, unknown>;
  const parts = [readNumber(record, ADULT_KEYS), readNumber(record, CHILD_KEYS), readNumber(record, INFANT_KEYS)];
  if (parts.every((part) => part === null)) return null;
  return parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
}
