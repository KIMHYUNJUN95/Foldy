/**
 * 사용자 관리(직원 목록 · 초대 · 직원 서류)가 화면에 그릴 때만 쓰는 표시 규칙 — PC `/admin/users*` · 모바일 `/mobile/users*` ·
 * 본인 `/account/id-card` 가 같이 쓴다(2026-11-19 unslop 2차 3순위, docs/product/41 §3-3).
 *
 * - 날짜는 한 가지로 — 「2026.11.19」. 관리자 콘솔에서 연 · 월 · 일 전체를 쓰는 곳(가입일 · 지원일 · 리뷰일 · 리넨 · 조직 설정)이
 *   이미 이 모양이다. 저장 값 · 서버로 보내는 값은 그대로(`YYYY-MM-DD`).
 * - `timestamptz` 는 도쿄 날짜로 바꾼 뒤 찍는다(UTC 로 자르면 오전 0~9시가 하루 전으로 보인다).
 * - 재류자격은 카드 원문(일본어)을 저장한다. 화면 언어 사전에 있으면 번역 + 원문, 없으면 원문만.
 */

import { isNationalityCode, nationalityName } from "@/lib/identity-names";
import { tokyoDateOf } from "@/lib/tokyo-date";

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})/;

/** `2026-11-19` → `2026.11.19`. 빈 값 · 모양이 다른 값은 빈 문자열 / 받은 그대로. */
export function dotDateKey(key: string | null | undefined): string {
  if (!key) return "";
  const hit = DATE_KEY.exec(key);
  return hit ? `${hit[1]}.${hit[2]}.${hit[3]}` : key;
}

/** `timestamptz` → 도쿄 날짜 → `2026.11.19`. */
export function dotDateOfIso(iso: string | null | undefined): string {
  return dotDateKey(tokyoDateOf(iso ?? null));
}

/**
 * 초대 만들기의 처음 조직 — **지금 보고 있는 조직**. 그 조직을 관리할 수 없을 때(목록에 없음)만 목록 첫 조직.
 * 예전에는 늘 목록 첫 조직이라, 여러 조직을 관리하는 사람이 다른 조직 코드를 만들 뻔했다(2026-11-19).
 */
export function pickDefaultInviteOrganization<T extends { id: string }>(
  organizations: readonly T[],
  currentOrganizationId: string | null | undefined,
): T | null {
  if (currentOrganizationId) {
    const current = organizations.find((organization) => organization.id === currentOrganizationId);
    if (current) return current;
  }
  return organizations[0] ?? null;
}

/**
 * 재류자격 표시 — 사전(`dictionary.idCard.residenceStatusNames`)에 원문이 있으면 `{ label: 번역, original: 원문 }`,
 * 없으면(일본어 화면 · 모르는 자격) `{ label: 원문, original: null }`.
 */
export function residenceStatusDisplay(
  raw: string | null | undefined,
  names: Readonly<Record<string, string>>,
): { label: string; original: string | null } {
  const original = (raw ?? "").normalize("NFKC").trim();
  if (!original) return { label: "", original: null };
  const translated = Object.prototype.hasOwnProperty.call(names, original) ? names[original] : "";
  if (!translated || translated === original) return { label: original, original: null };
  return { label: translated, original };
}

/**
 * 재류자격을 한 줄 글자로 — `title` · 글자만 그리는 목록용. 번역과 원문 사이는 띄어쓰기 하나(붙어 보이지 않게).
 * 화면에 그릴 때는 `ResidenceStatusText`(같은 띄어쓰기 + 원문을 작게)를 쓴다.
 */
export function residenceStatusText(raw: string | null | undefined, names: Readonly<Record<string, string>>): string {
  const { label, original } = residenceStatusDisplay(raw, names);
  return original ? `${label} ${original}` : label;
}

/** 카드의 「국적 · 지역」 칸 — 두 글자 나라 코드(VN)면 화면 언어 이름(베트남), 글자로 적힌 값은 그대로. */
export function nationalityTextDisplay(raw: string | null | undefined, locale: string): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  const upper = value.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && isNationalityCode(upper)) return nationalityName(upper, locale);
  return value;
}
