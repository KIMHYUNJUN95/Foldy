// 공지 표시 규칙 한 곳(2026-11-20, 공지 unslop). PC 콘솔 · 모바일 목록 · 상세 · 앱 열 때 팝업 · 서버 읽음 집계가
// 모두 여기 함수를 쓴다 — 화면마다 날짜 모양이나 읽음 대상이 달라지지 않게.
// docs/product/11-announcement-workflow.md → 「표시 규칙」.
import type { OrganizationRole } from "@/config/roles";
import type { Locale } from "@/lib/i18n";

const TOKYO_TZ = "Asia/Tokyo";

type Parts = { y: string; m: string; d: string; hh: string; mm: string; date: Date };

function tokyoParts(iso: string | null | undefined): Parts | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  // 일부 ICU 는 hour12:false 에서 자정을 "24" 로 낸다.
  const hh = get("hour") === "24" ? "00" : get("hour");
  return { y: get("year"), m: get("month"), d: get("day"), hh, mm: get("minute"), date };
}

/** 도쿄 날짜 열쇠 「2026-11-18」 — 모바일 목록 날짜 묶음 열쇠. 값이 없거나 깨지면 빈 문자열. */
export function annDayKey(iso: string | null | undefined): string {
  const p = tokyoParts(iso);
  return p ? `${p.y}-${p.m}-${p.d}` : "";
}

/** 도쿄 기준 "YYYY-MM-DD" — PC 작성 창의 날짜 입력 칸 값(annDayKey 와 같은 값). */
export function tokyoDateKey(iso: string | null | undefined): string {
  return annDayKey(iso);
}

/** 도쿄 기준 "HH:mm"(24시간) — PC 작성 창의 시간 입력 칸 값. */
export function tokyoTimeHm(iso: string | null | undefined): string {
  const p = tokyoParts(iso);
  return p ? `${p.hh}:${p.mm}` : "";
}

/** 도쿄 날짜 「2026.11.18」. 값이 없으면 빈 문자열. */
export function annDate(iso: string | null | undefined): string {
  const p = tokyoParts(iso);
  return p ? `${p.y}.${p.m}.${p.d}` : "";
}

/** 도쿄 날짜 + 시각 「2026.11.18 09:05」(24시간). */
export function annDateTime(iso: string | null | undefined): string {
  const p = tokyoParts(iso);
  return p ? `${p.y}.${p.m}.${p.d} ${p.hh}:${p.mm}` : "";
}

const WEEKDAY_TAG: Record<Locale, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };

/** 목록 날짜 묶음 머리 「2026.11.14 (토)」 — 요일만 언어별, 도쿄 기준. */
export function annDayLabel(iso: string | null | undefined, locale: Locale): string {
  const p = tokyoParts(iso);
  if (!p) return "";
  const weekday = new Intl.DateTimeFormat(WEEKDAY_TAG[locale] ?? "en-US", {
    timeZone: TOKYO_TZ,
    weekday: "short",
  }).format(p.date);
  return `${p.y}.${p.m}.${p.d} (${weekday})`;
}

/**
 * 이 사람이 읽음 집계(「안 읽음」 목록 · 읽음 분모)에 들어가는가. 쓴 사람은 빠진다 —
 * 자기 공지를 「안 읽음」으로 세면 숫자가 늘 하나 모자랐다(2026-11-20).
 */
export function countsTowardRead(userId: string, authorId: string | null | undefined): boolean {
  return !authorId || userId !== authorId;
}

/**
 * 받는 사람 수 — 대상(전체 · 역할)의 활성 구성원에서 쓴 사람을 뺀 수. 작성 창 「받는 사람 n명」과
 * 게시 뒤 패널 분모(targetTotal)가 같은 함수를 쓴다(2026-11-20). `authorRole` 은 쓴 사람의 그 조직
 * 활성 역할 — 구성원이 아니면(플랫폼 관리자 등) null 이고 빼지 않는다. countsTowardRead 와 같은 판정.
 */
export function announcementRecipientCount(input: {
  scope: "everyone" | "roles";
  roles: readonly OrganizationRole[];
  roleCounts: Partial<Record<OrganizationRole, number>>;
  orgTotal: number;
  authorRole: OrganizationRole | null | undefined;
}): number {
  const { scope, roles, roleCounts, orgTotal, authorRole } = input;
  const total = scope === "roles" ? roles.reduce((sum, role) => sum + (roleCounts[role] ?? 0), 0) : orgTotal;
  const authorIsTarget = Boolean(authorRole) && (scope !== "roles" || roles.includes(authorRole as OrganizationRole));
  return Math.max(0, total - (authorIsTarget ? 1 : 0));
}

/**
 * 새 공지의 처음 조직 — 지금 보고 있는 조직. 지금 조직이 없거나(플랫폼 관리자) 관리할 수 없는 조직이면
 * 비워 두고 직접 고르게 한다. 조직이 하나뿐이면(고르는 칸이 안 보임) 그 조직.
 */
export function pickInitialAnnouncementOrg(
  organizations: readonly { id: string }[],
  currentOrganizationId: string | null | undefined,
): string {
  if (organizations.length === 1) return organizations[0]!.id;
  if (currentOrganizationId && organizations.some((o) => o.id === currentOrganizationId)) {
    return currentOrganizationId;
  }
  return "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 콘솔에서 이 공지를 패널로 여는 주소. 공지 번호 꼴이 아니면 목록. */
export function announcementPanelHref(id: string): string {
  return UUID_RE.test(id) ? `/admin/announcements?id=${id}` : "/admin/announcements";
}

/** `?id=` 값 — 공지 번호 꼴일 때만 돌려준다. */
export function readAnnouncementPanelId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && UUID_RE.test(raw) ? raw : null;
}
