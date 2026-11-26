/**
 * 판매 캘린더 막대 종류(확정 · 문의 · 예약 요청 · 취소) — **PC 격자와 모바일 캘린더가 같이 쓴다**(2026-11-26).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 표시 필터」
 *
 * - 층 순서: 확정이 늘 0층(위), 그다음 문의 · 요청, 취소가 맨 아래(`assignBarLanes` 의 `rank`).
 * - 이름 앞 꼬리표: 문의 · 요청 막대에만 「문의 · 」/「요청 · 」 — 빗금과 같이 써서 색만으로 구분하지 않는다.
 */

import type { OpsBarKind } from "@/lib/ops-reservation-kind";

export function opsBarLaneRank(kind: OpsBarKind | undefined): number {
  if (kind === "inquiry" || kind === "request") return 1;
  if (kind === "cancelled") return 2;
  return 0;
}

export function opsBarPrefix(
  kind: OpsBarKind | undefined,
  copy: { barPrefixInquiry: string; barPrefixRequest: string },
): string {
  if (kind === "inquiry") return copy.barPrefixInquiry;
  if (kind === "request") return copy.barPrefixRequest;
  return "";
}

export function isPendingBarKind(kind: OpsBarKind | undefined): boolean {
  return kind === "inquiry" || kind === "request";
}
