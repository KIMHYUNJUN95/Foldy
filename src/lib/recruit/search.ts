import type { ApplicationListRow } from "@/lib/recruit/applications";

/**
 * 지원자 목록 검색 (2026-09-11).
 *
 * **브라우저에서 돈다.** 예전에는 검색어를 쿼리스트링에 넣어 서버가 걸렀는데, 그러면 글자를
 * 지울 때 손에 있는 건 이미 좁혀진 목록뿐이라 서버 왕복이 끝나야 넓어졌다 — 「한 글자만 쳐도
 * 바로, 지우면 바로 전체」가 안 되던 원인이다. 목록은 탭 기준 전량이 이미 와 있으므로 여기서
 * 거르면 즉시 끝난다.
 *
 * 조건은 **서버가 쓰던 것과 같다** — 이름 또는 전화번호 부분일치, 대소문자 무시
 * (`applicant_name.ilike.%q%,phone.ilike.%q%`). 다른 조건을 쓰면 링크로 들어온 `?q=` 와 화면에서
 * 친 검색이 다른 결과를 낸다.
 *
 * 전화는 **뒤 4자리만** 비교한다. 목록에 그 4자리만 내려오기 때문이고, 그건 문서에 적힌 검색
 * 방식이기도 하다(`ApplicationListRow.phoneTail`).
 */
export function filterApplicationsBySearch<T extends Pick<ApplicationListRow, "name" | "phoneTail">>(
  rows: readonly T[],
  query: string,
): readonly T[] {
  const needle = query.trim().toLowerCase();
  // 공백만 친 경우도 「검색 안 함」이다 — 빈 목록을 보여주면 다 사라진 것처럼 보인다.
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      (row.phoneTail !== null && row.phoneTail.includes(needle)),
  );
}

/**
 * 검색어를 주소의 `q` 에 반영한 새 쿼리스트링(앞의 `?` 포함, 비면 빈 문자열)을 돌려준다 (2026-11-17).
 * 앞뒤 공백만 있는 검색어는 「검색 안 함」이라 `q` 를 지운다. 다른 필터는 그대로 둔다.
 */
export function recruitSearchWithQuery(search: string, value: string): string {
  const params = new URLSearchParams(search);
  const trimmed = value.trim();
  if (trimmed) params.set("q", trimmed);
  else params.delete("q");
  const next = params.toString();
  return next ? `?${next}` : "";
}

/**
 * 상세 패널을 닫는 주소 — 지금 주소에서 `application` 만 뺀다(2026-11-17).
 * 서버가 렌더 때 만든 주소를 쓰면 패널을 연 뒤 바꾼 검색어(`q`)가 옛 값으로 돌아간다.
 */
export function recruitCloseHref(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("application");
  const next = params.toString();
  return next ? `/admin/recruit?${next}` : "/admin/recruit";
}
