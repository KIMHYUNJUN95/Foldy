import type { OpsBarKind } from "@/lib/ops-reservation-kind";

/**
 * 판매 캘린더 「예약 표시」 필터 (2026-11-26). **순수하다** — 서버(page) · 화면 · 저장 액션이 같이 쓴다.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 표시 — 상태 필터」
 *
 * - 항목은 확정 · 문의 · 예약 요청 · 취소. 차단(BLOCK)은 넣지 않는다(예약이 아니다).
 * - 기본은 **확정만**. 예전 「취소 보기」(`cancelled=1`)는 이 필터에 합쳤다 — 옛 링크는 취소를 더한 값으로 읽는다.
 * - 고른 값은 **URL(`show=`)이 먼저**, 없으면 사람마다 저장한 값(`profiles.ops_calendar_status_filter`), 그것도 없으면 기본.
 * - 순서는 늘 `OPS_STATUS_FILTER_KEYS` 순서 — 같은 선택이 URL 두 개로 갈리지 않는다.
 */
export const OPS_STATUS_FILTER_KEYS = ["confirmed", "inquiry", "request", "cancelled"] as const satisfies readonly OpsBarKind[];
export type OpsStatusFilterKey = (typeof OPS_STATUS_FILTER_KEYS)[number];
export type OpsStatusFilter = OpsStatusFilterKey[];

export const DEFAULT_OPS_STATUS_FILTER: OpsStatusFilter = ["confirmed"];

/** 아무것도 안 고른 상태의 URL 값 — 빈 값(= 기본)과 구분한다. */
const NONE_TOKEN = "none";

/** URL 값(`"confirmed,inquiry"`) · 저장값(글자 배열)을 읽는다. 읽을 것이 없으면 `null`(= 다음 단계로). */
export function parseOpsStatusFilter(value: unknown): OpsStatusFilter | null {
  let tokens: unknown[];
  if (typeof value === "string") {
    if (value.trim() === NONE_TOKEN) return [];
    tokens = value.split(",");
  } else if (Array.isArray(value)) {
    tokens = value;
  } else {
    return null;
  }
  const picked = new Set(tokens.map((token) => (typeof token === "string" ? token.trim() : "")));
  const result = OPS_STATUS_FILTER_KEYS.filter((key) => picked.has(key));
  if (result.length === 0) return Array.isArray(value) && value.length === 0 ? [] : null;
  return result;
}

export function resolveOpsStatusFilter(args: {
  url: unknown;
  saved: unknown;
  /** 예전 `cancelled=1` 링크. */
  legacyCancelled?: boolean;
}): OpsStatusFilter {
  const fromUrl = parseOpsStatusFilter(args.url);
  if (fromUrl) return fromUrl;
  if (args.legacyCancelled) return ["confirmed", "cancelled"];
  return parseOpsStatusFilter(args.saved) ?? [...DEFAULT_OPS_STATUS_FILTER];
}

export function isDefaultOpsStatusFilter(filter: readonly OpsStatusFilterKey[]): boolean {
  return opsStatusFilterBadgeCount(filter) === 0;
}

/** URL 에 적을 값. 기본이면 `undefined`(칸을 뺀다). */
export function serializeOpsStatusFilter(filter: readonly OpsStatusFilterKey[]): string | undefined {
  if (isDefaultOpsStatusFilter(filter)) return undefined;
  const ordered = OPS_STATUS_FILTER_KEYS.filter((key) => filter.includes(key));
  return ordered.length === 0 ? NONE_TOKEN : ordered.join(",");
}

/** 버튼의 「+N」 — 기본과 다른 항목 수(더한 것 + 뺀 것). */
export function opsStatusFilterBadgeCount(filter: readonly OpsStatusFilterKey[]): number {
  let count = 0;
  for (const key of OPS_STATUS_FILTER_KEYS) {
    if (filter.includes(key) !== DEFAULT_OPS_STATUS_FILTER.includes(key)) count += 1;
  }
  return count;
}

export function isOpsBarShown(kind: OpsBarKind, filter: readonly OpsStatusFilterKey[]): boolean {
  return filter.includes(kind);
}

/**
 * 필터 팝오버가 고른 값으로 가는 주소. **늘 `show=` 를 단다**(기본으로 되돌리기도 `show=confirmed`) — 주소의 값이 이 사람의
 * 저장값이 되므로(`ops-calendar-status-filter-preference.ts`), 빼면 「기본으로 되돌리기」가 저장되지 않는다.
 * `baseHref` 는 `show` 를 뺀 지금 화면 주소.
 */
export function opsStatusFilterHref(baseHref: string, filter: readonly OpsStatusFilterKey[]): string {
  const ordered = OPS_STATUS_FILTER_KEYS.filter((key) => filter.includes(key));
  const value = ordered.length === 0 ? NONE_TOKEN : ordered.join(",");
  const [path, query = ""] = baseHref.split("?");
  const params = new URLSearchParams(query);
  params.set("show", value);
  return `${path}?${params.toString()}`;
}
