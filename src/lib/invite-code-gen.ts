import { tokyoToday, ymdShift } from "@/lib/tokyo-date";
import { pickDefaultInviteOrganization } from "@/lib/users-display";

/**
 * 초대코드 자동 생성 규칙 (2026-09-09).
 *
 * 초대코드 생성 폼은 **조직과 역할만** 고르면 되도록 바뀌었다. 나머지 네 값(이름 / 코드 / 만료일 /
 * 최대 사용 횟수)은 여기서 만들어진다. 폼의 "세부 설정"을 펼치면 사용자가 덮어쓸 수 있고, 비워서
 * 보내면 서버 액션이 같은 헬퍼로 다시 채운다 — 그래서 클라이언트와 서버가 한 규칙을 공유한다.
 */

/**
 * 코드 문자 집합. 0/O, 1/I/L 처럼 인쇄물·손글씨로 옮겨 적을 때 헷갈리는 글자는 뺐다.
 * 초대코드는 화면에서 복사하기도 하지만 구두로 불러주거나 종이에 적어 전달되는 경우가 많다.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const INVITE_CODE_SUFFIX_LENGTH = 6;
export const INVITE_CODE_PREFIX_LENGTH = 6;
export const DEFAULT_INVITE_MAX_USES = 10;
export const DEFAULT_INVITE_EXPIRY_DAYS = 30;

/** 조직 slug(없으면 이름)에서 코드 앞자리를 뽑는다. "haru" → "HARU", 비면 "ORG". */
export function inviteCodePrefix(source: string): string {
  const cleaned = (source ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, INVITE_CODE_PREFIX_LENGTH) || "ORG";
}

/**
 * 균등 분포 랜덤 문자열. `% ALPHABET.length` 만 쓰면 앞쪽 글자가 조금 더 자주 뽑히므로,
 * 나머지 구간에 걸린 바이트는 버리고 다시 뽑는다(rejection sampling).
 */
function randomChars(length: number): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = "";

  while (out.length < length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);

    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (out.length === length) break;
    }
  }

  return out;
}

/** `HARU-K7M2QP` 형태. `source` 는 조직 slug 또는 이름. */
export function generateInviteCode(source: string): string {
  return `${inviteCodePrefix(source)}-${randomChars(INVITE_CODE_SUFFIX_LENGTH)}`;
}

/** 기본 만료일 = 도쿄 기준 오늘 + 30일. */
export function defaultInviteExpiry(today: string = tokyoToday()): string {
  return ymdShift(today, DEFAULT_INVITE_EXPIRY_DAYS);
}

/**
 * 기본 초대코드 이름. `template` 은 i18n 의 `admin.settings.inviteAutoName`
 * (`"{role} 초대 {date}"`) — ko/ja/en 각각의 문장을 그대로 쓴다.
 */
export function buildInviteName(
  template: string,
  roleLabel: string,
  today: string = tokyoToday(),
): string {
  return template.replace("{role}", roleLabel).replace("{date}", today.slice(5));
}

/**
 * 초대 만들기 폼의 처음 값 — PC `/admin/users/invites` · 모바일 `/mobile/users/invites` 가 같이 쓴다(2026-11-19).
 * 조직은 **지금 보고 있는 조직**(관리할 수 없으면 목록 첫 조직), 코드 앞자리는 그 조직, 만료일은 오늘 + 30일.
 * 코드의 랜덤값은 서버가 한 번 정해 내려 준다 — 클라이언트 첫 렌더에서 뽑으면 SSR 결과와 어긋난다.
 */
export function inviteFormDefaults(
  organizations: readonly { id: string; slug?: string | null; name?: string | null }[],
  currentOrganizationId: string | null | undefined,
  today: string = tokyoToday(),
): { organizationId: string; code: string; expiresAt: string; maxUses: number } {
  const organization = pickDefaultInviteOrganization(organizations, currentOrganizationId);
  return {
    organizationId: organization?.id ?? "",
    code: generateInviteCode(organization?.slug || organization?.name || ""),
    expiresAt: defaultInviteExpiry(today),
    maxUses: DEFAULT_INVITE_MAX_USES,
  };
}
