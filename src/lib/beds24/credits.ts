/**
 * Beds24 응답 헤더의 크레딧 정보.
 *
 * 2026-08-07: 헤더 이름이 **전부 틀려 있었다.** 코드가 찾던 이름은
 * `X-RequestCost` / `X-FiveMinCreditLimit-Remaining` / `X-FiveMinCreditLimit-ResetsIn` 인데,
 * Beds24 가 실제로 내려주는 이름은 아래와 같다(실측: bookings 와 채널 리뷰 엔드포인트 동일):
 *
 *   x-request-cost: 1
 *   x-five-min-limit-remaining: 194
 *   x-five-min-limit-resets-in: 261
 *
 * 헤더 조회는 대소문자를 가리지 않지만 **이름 자체가 다르다.** 그래서 잔여 크레딧은 항상 null
 * 이었고, `MIN_REMAINING_CREDITS` 저크레딧 가드는 **한 번도 발동한 적이 없다.** 안전밸브가
 * 달려 있는 줄 알았지 실제로는 닫혀 있었다.
 *
 * 옛 이름도 같이 읽는다 — Beds24 가 엔드포인트마다 다르게 줄 가능성에 대비한 비용이 0이다.
 */
export type Beds24CreditInfo = {
  requestCost: number | null;
  remaining: number | null;
  resetsIn: number | null;
  /** 5분 한도 자체 — 헤더가 있을 때만(지금 실측으로는 안 온다). 없으면 키가 없다. */
  limit?: number;
};

/** 헤더가 없으면 null 이다. `Number(null) === 0` 이라 이 구분을 빼먹으면 «잔여 0» 으로 읽힌다. */
function readNumericHeader(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw === null) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function readBeds24Credits(headers: Headers): Beds24CreditInfo {
  const limit = readNumericHeader(headers, ["x-five-min-limit", "X-FiveMinCreditLimit"]);
  return {
    ...(limit !== null && limit > 0 ? { limit } : {}),
    requestCost: readNumericHeader(headers, ["x-request-cost", "X-RequestCost"]),
    remaining: readNumericHeader(headers, [
      "x-five-min-limit-remaining",
      "X-FiveMinCreditLimit-Remaining",
    ]),
    resetsIn: readNumericHeader(headers, [
      "x-five-min-limit-resets-in",
      "X-FiveMinCreditLimit-ResetsIn",
    ]),
  };
}
