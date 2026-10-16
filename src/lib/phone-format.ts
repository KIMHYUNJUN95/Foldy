import { AsYouType, parsePhoneNumberFromString, type MetadataJson } from "libphonenumber-js/core";
import metadataModule from "libphonenumber-js/metadata.min";

// guest-country.ts 와 같은 이유로 메타데이터를 직접 넘긴다(tsx 가 JSON 을 `{ default }` 로 감싸는 문제).
const METADATA = ((metadataModule as unknown as { default?: MetadataJson }).default ??
  metadataModule) as MetadataJson;

/**
 * 화면에 보여 줄 전화번호 — 자리마다 **하이픈**으로 끊는다(2026-10-14 사용자 요청: 「+33 6 12 34 56 78」 → 「+33-6-12-34-56-78」).
 *
 * - 국제 번호(`+` 로 시작하거나 Airbnb 처럼 `+` 없는 E.164)는 그 나라 규칙으로 끊는다 — `+81-90-1234-5678`.
 * - `0` 으로 시작하는 국내 번호는 일본 번호로 보고 국내 형식 — `090-1234-5678`.
 * - 끊을 수 없는 번호는 **받은 그대로** 돌려준다(숫자를 지어내거나 빼지 않는다).
 *
 * 걸기(`tel:`)와 복사에는 원래 값을 쓰고, 이 값은 보여 줄 때만 쓴다.
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return "";
  const value = raw.trim();
  if (!value) return "";
  const digits = value.replace(/[^\d+]/g, "");
  try {
    if (digits.startsWith("0") && !digits.startsWith("00")) {
      const parsed = parsePhoneNumberFromString(digits, "JP", METADATA);
      if (parsed?.isPossible()) return parsed.formatNational().replace(/\s+/g, "-");
      return value;
    }
    const international = digits.startsWith("+") ? digits : digits.startsWith("00") ? `+${digits.slice(2)}` : `+${digits}`;
    const parsed = parsePhoneNumberFromString(international, METADATA);
    if (parsed?.isPossible()) return parsed.formatInternational().replace(/\s+/g, "-");
  } catch {
    return value;
  }
  return value;
}

/** `tel:` 링크용 — 숫자와 맨 앞 `+` 만. */
export function phoneHref(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

/**
 * 입력칸용 — **치는 대로 하이픈을 넣는다**(2026-10-16 판매 캘린더 화이트 리디자인 · 수기 예약 전화).
 *
 * - `+` 로 시작하면 국가 코드 뒤부터 그 나라 규칙으로 끊는다 — `+14155550142` → `+1-415-555-0142`.
 * - `0` 으로 시작하면 일본 국내 번호로 끊는다 — `09012345678` → `090-1234-5678`.
 * - 그 밖의 값(`+` 없는 숫자, 글자가 섞인 값, `00` 국제 접두)은 **친 그대로** 둔다 — 숫자를 지어내거나 빼지 않는다.
 * - 끝에 하이픈을 남기지 않는다 — 지우기(Backspace)가 하이픈에 걸려 멈추지 않는다.
 *
 * 저장 값은 이 문자열 그대로다(Beds24 전화 칸은 자유 문자열이고, `countryFromPhone` 은 숫자만 본다).
 */
export function formatPhoneInput(raw: string): string {
  const value = raw.replace(/^\s+/, "");
  if (!value) return "";
  if (/[^\d+\s\-().]/.test(value)) return raw;
  const plus = value.startsWith("+");
  const digits = value.replace(/\D/g, "");
  if (plus && !digits) return "+";
  if (!plus && (!digits.startsWith("0") || digits.startsWith("00"))) return raw;
  try {
    const typed = new AsYouType(plus ? undefined : "JP", METADATA).input(`${plus ? "+" : ""}${digits}`);
    const hyphened = typed
      .replace(/[()]/g, "")
      .trim()
      .replace(/[\s-]+/g, "-")
      .replace(/-$/, "");
    // 형식기가 숫자를 바꾸면(있어서는 안 되지만) 친 숫자를 그대로 쓴다.
    if (hyphened.replace(/\D/g, "") !== digits) return `${plus ? "+" : ""}${digits}`;
    return hyphened;
  } catch {
    return `${plus ? "+" : ""}${digits}`;
  }
}
