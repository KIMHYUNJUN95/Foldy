const SOURCE_CANONICAL_MAP = new Map<string, string>([
  ["booking", "Booking.com"],
  ["booking.com", "Booking.com"],
  ["airbnb", "Airbnb"],
  ["api", "API"],
  ["direct", "Direct"],
  ["agoda", "Agoda"],
]);

function toCanonicalUnknownSource(value: string) {
  const normalizedWhitespace = value.replace(/\s+/g, " ").trim().toLowerCase();
  return normalizedWhitespace.replace(/(^|[\s/_-])([a-z])/g, (_, prefix: string, char: string) => {
    return `${prefix}${char.toUpperCase()}`;
  });
}

// 정규화 정책:
// - 알려진 채널은 고정된 표시/중복 제거 이름으로 매핑한다.
// - 알 수 없는 채널은 대소문자를 정규화해 foo/FOO/Foo 가 중복 제거 키를 쪼개지 않게 한다.
// - 취소/수정 매칭의 예약 식별은 원래 Beds24 예약 id
//   (`toOriginalReservationId`)를 쓰며, 정규화된 source 문자열은 쓰지 않는다.
export function normalizeReservationSource(rawSource: string | null | undefined) {
  const trimmed = rawSource?.trim();
  if (!trimmed) return "beds24";

  const normalizedKey = trimmed.toLowerCase();
  return SOURCE_CANONICAL_MAP.get(normalizedKey) ?? toCanonicalUnknownSource(trimmed);
}
