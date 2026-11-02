// 사전 등록 웹 「예약 찾기」 판정(DB 없음 — 테스트로 덮는다). 44 FR-W01 · §14-7.
// 이름 + 체크인 날짜 + (채널 예약 번호 | 전화 뒤 4자리) 셋이 **한 예약에만** 맞을 때만 연다(FR-K19).

export type ClaimCandidate = {
  stayId: string;
  checkInDate: string;
  /** 예약 묶음의 줄들(방마다 한 줄) — 이름 · 번호 · 전화는 줄마다 같지만 다를 수도 있어 모두 본다. */
  rows: { guestName: string; apiReference: string | null; phone: string | null }[];
};

export type ClaimInput = {
  lastName: string;
  firstName: string;
  checkInDate: string;
  reference?: string;
  phoneLast4?: string;
};

// 이름: 대소문자 · 공백 · 점 · 하이픈 · 악센트 무시, 성 · 이름 순서 무시.
function nameTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[.,'’\-_]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function sameName(guestName: string, lastName: string, firstName: string): boolean {
  const booked = nameTokens(guestName);
  const given = [...nameTokens(lastName), ...nameTokens(firstName)];
  if (booked.length === 0 || given.length === 0) return false;
  const sorted = (tokens: string[]) => [...tokens].sort().join(" ");
  if (sorted(booked) === sorted(given)) return true;
  // 띄어 쓰지 않은 이름(「TANAKAYUKI」 · 「田中由紀」) — 이어 붙여 두 순서 모두 비교.
  const joined = booked.join("");
  return joined === given.join("") || joined === [...given].reverse().join("");
}

// 예약 번호: 대소문자 · 공백 · 하이픈 무시, Airbnb 「HM」 접두는 있어도 없어도 맞춤.
export function normalizeReference(value: string): string {
  const compact = value.toUpperCase().replace(/[\s\-_]/g, "");
  return compact.startsWith("HM") ? compact.slice(2) : compact;
}

export function phoneLast4Of(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export type ClaimMatch = { kind: "one"; stayId: string } | { kind: "none" };

export function matchClaim(candidates: ClaimCandidate[], input: ClaimInput): ClaimMatch {
  const reference = input.reference ? normalizeReference(input.reference) : "";
  const phone = input.phoneLast4?.replace(/\D/g, "") ?? "";
  if (!reference && phone.length !== 4) return { kind: "none" };

  const hits = candidates.filter(
    (candidate) =>
      candidate.checkInDate === input.checkInDate &&
      candidate.rows.some(
        (row) =>
          sameName(row.guestName, input.lastName, input.firstName) &&
          (reference
            ? !!row.apiReference && normalizeReference(row.apiReference) === reference
            : phoneLast4Of(row.phone) === phone),
      ),
  );
  // 둘 이상이면 어느 것도 열지 않는다 — 남의 예약을 보여 주지 않는 쪽이 안전하다.
  return hits.length === 1 ? { kind: "one", stayId: hits[0].stayId } : { kind: "none" };
}
