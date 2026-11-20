/**
 * 예약 검색 — 고객명 · 예약번호 · 전화번호.
 *
 * DB 에서는 **넓게** 거르고(`buildGuestSearchPlan` 의 ilike 조각), 최종 판정은 여기서
 * (`matchesGuestName` · `matchesDigits`) 한다. PostgREST 의 ilike 로는 「띄어쓰기 무시」와
 * 「성·이름 순서 무관」을 한 번에 표현할 수 없어서다.
 *
 * 이름 규칙(2026-09-30 사용자 요청):
 * - 대소문자 · 악센트 · 전각/반각 · 띄어쓰기를 무시한다(`kimminsu` = `Kim Minsu` = `KIM MIN SU`).
 * - 성이 앞이든 뒤든 찾는다(`Minsu Kim` = `김 민수` 의 순서를 바꾼 `민수김` 모두).
 */

const MAX_QUERY_LENGTH = 60;

const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/**
 * 정리할 글의 최대 길이(글자 수, 정리 전). DB `guest_search_normalize` 의 `left(p, 200)` 과 같다 — 바꾸면 양쪽을 같이.
 * 이름 · 검색어가 이보다 긴 일은 없지만, 열쇠(저장 칸) 크기가 끝없이 커지지 않게 막는다.
 */
export const GUEST_NORMALIZE_MAX_CHARS = 200;
/** 모든 순서를 만드는 이름의 최대 길이(단어를 붙인 글자 수). 넘으면 원래 순서 · 거꾸로만 — DB 열쇠와 같다. */
export const GUEST_PERMUTE_MAX_COMPACT_CHARS = 40;

/**
 * 비교용 정규화 — NFKC(전각→반각) + 소문자(그리스 끝 시그마 ς 는 σ 로) + 악센트 제거 + 공백 하나로.
 * DB `guest_search_normalize`(202611200002)와 글자까지 같아야 한다 — 바꾸면 SQL · 저장 칸 다시 계산까지 같이.
 */
export function normalizeGuestText(value: string): string {
  const capped = value.length > GUEST_NORMALIZE_MAX_CHARS
    ? Array.from(value).slice(0, GUEST_NORMALIZE_MAX_CHARS).join("")
    : value;
  return capped
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .replace(/[.,·・'’"()\-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(value: string): string[] {
  const normalized = normalizeGuestText(value);
  return normalized ? normalized.split(" ") : [];
}

/** 토큰 순열(5개 · 붙인 글자 40자까지 — 그보다 길면 원래 순서와 역순만). DB `guest_name_search_key` 와 같다. */
function permutations(tokens: string[]): string[][] {
  if (tokens.length > 5 || Array.from(tokens.join("")).length > GUEST_PERMUTE_MAX_COMPACT_CHARS) {
    return [tokens, [...tokens].reverse()];
  }
  return allOrders(tokens);
}

function allOrders(tokens: string[]): string[][] {
  if (tokens.length <= 1) return [tokens];
  const result: string[][] = [];
  tokens.forEach((token, index) => {
    const rest = [...tokens.slice(0, index), ...tokens.slice(index + 1)];
    for (const tail of allOrders(rest)) result.push([token, ...tail]);
  });
  return result;
}

/**
 * 이름이 검색어에 맞는가.
 *
 * 1. 검색어의 **각 단어가 이름 어딘가에** 있으면 맞다 — 순서 무관(`kim minsu` ↔ `Minsu Kim`).
 * 2. 검색어를 붙여 쓴 것이 **이름 단어를 어떤 순서로든 이어 붙인 것** 안에 있으면 맞다
 *    (`minsukim` ↔ `Kim Minsu`, `김민수` ↔ `민수 김`).
 */
export function matchesGuestName(query: string, guestName: string): boolean {
  const queryTokens = tokensOf(query);
  if (queryTokens.length === 0) return false;
  const nameTokens = tokensOf(guestName);
  if (nameTokens.length === 0) return false;

  const nameCompact = nameTokens.join("");
  if (queryTokens.every((token) => nameCompact.includes(token))) return true;

  const queryCompact = queryTokens.join("");
  return permutations(nameTokens).some((order) => order.join("").includes(queryCompact));
}

function digitsOf(value: string): string {
  return value.normalize("NFKC").replace(/\D+/g, "");
}

/**
 * 번호가 검색어에 맞는가 — 숫자만 비교한다(`090-1234-5678` = `09012345678`).
 * 국내식 앞자리 0 은 국가번호(+81 · +82)와 바꿔 써도 맞게 뗀 값으로도 본다.
 */
export function matchesDigits(query: string, value: string | null | undefined): boolean {
  if (!value) return false;
  const q = digitsOf(query);
  if (q.length < 4) return false;
  const v = digitsOf(value);
  if (v.includes(q)) return true;
  return q.startsWith("0") && q.length > 5 && v.includes(q.slice(1));
}

export type GuestSearchPlan = {
  /** 이름 후보를 거르는 ilike 조각 — 전부 들어 있어야 한다(AND). 빈 배열이면 이름으로는 안 찾는다. */
  nameFragments: string[];
  /** 번호 검색에 쓸 숫자(4자리 이상일 때만). */
  digits: string | null;
  /** 예약번호 원문(영숫자) — Beds24 id · 채널 예약번호 · 우리 id 앞부분. */
  reference: string | null;
};

/**
 * DB 에 보낼 넓은 거름.
 *
 * 이름은 검색어 **단어마다 앞 2자와 뒤 2자**가 이름에 있어야 한다. 단어가 이름의 한 단어 안에
 * 있든(띄어 쓴 검색), 여러 단어를 붙인 것이든(붙여 쓴 검색) 첫 두 글자와 끝 두 글자는 대개
 * 이름 한 단어 안에 들어 있다 — 최종 판정은 `matchesGuestName` 이 다시 한다.
 */
export function buildGuestSearchPlan(rawQuery: string): GuestSearchPlan | null {
  const query = rawQuery.slice(0, MAX_QUERY_LENGTH);
  const tokens = tokensOf(query);
  if (tokens.length === 0) return null;

  const fragments = new Set<string>();
  for (const token of tokens) {
    // 한글·가나·한자는 성이 한 글자라 붙여 쓴 `민수김` 의 끝 두 글자(`수김`)가 이름 어디에도 없다 —
    // 한 글자씩만 건다.
    const edge = CJK.test(token) ? 1 : 2;
    if (token.length <= edge) {
      fragments.add(token);
      continue;
    }
    fragments.add(token.slice(0, edge));
    fragments.add(token.slice(-edge));
  }
  // 한 글자짜리만으로는 너무 넓다 — 한글·한자 한 글자 이름은 드물다. 두 글자부터 이름으로 찾는다.
  // 글자 수는 코드 포인트로 센다(DB char_length 와 같게 — 「𠮷」 같은 한 글자를 2로 세지 않는다).
  const compactLength = Array.from(tokens.join("")).length;
  const nameFragments = compactLength >= 2 ? [...fragments] : [];

  const digits = digitsOf(query);
  const reference = query.trim().replace(/\s+/g, "");
  return {
    digits: digits.length >= 4 ? digits : null,
    nameFragments,
    // 예약번호에는 숫자가 들어 있다(Beds24 · 에어비앤비 HM… · 부킹) — 이름만으로는 번호 검색을 하지 않는다.
    reference: /^[A-Za-z0-9-]{4,}$/.test(reference) && /\d/.test(reference) ? reference : null,
  };
}

/**
 * 전화번호 넓은 거름 — 하이픈 · 공백 · 국가번호가 섞여 저장되므로 숫자 사이에 `%` 를 끼운다(국내식 앞자리 0 은 뗀다).
 * 최종 판정은 `matchesDigits`. 6자리 미만은 우연히 맞는 번호가 너무 많아 null.
 */
export function phoneLikePattern(digits: string | null): string | null {
  if (!digits || digits.length < 6) return null;
  const core = digits.startsWith("0") ? digits.slice(1) : digits;
  return `%${core.split("").join("%")}%`;
}

/** DB 함수 인자로 넘기는 ilike 글(PostgREST 필터 문법을 거치지 않는 자리) — 글자는 남기고 `\` · `%` · `_` 만 막는다. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** PostgREST `or()` / `ilike` 안에서 의미가 있는 글자를 뺀다. */
export function escapeIlikeFragment(value: string): string {
  return value.replace(/[%_\\,().*"]/g, "");
}
