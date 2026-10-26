// Admin 수리·점검 console — presentation helpers.
//
// 데이터는 2026-07-14 기준 실제 값이다 (src/lib/admin-maintenance.ts). 이 모듈은 예전에 Claude Design 핸드오프의
// 목업 픽스처를 담고 있었으나 모두 제거됐다. 남은 것은 디자인의 *어휘*다:
// 상태/우선순위/카테고리 → CSS 클래스 + i18n 키 맵, 보드 컬럼 순서, 카드와 표가 렌더링에 쓰는
// 도쿄 시간 포맷터.
//
// See docs/product/08-maintenance-workflow.md → "2026-07-14 어드민 수리·점검 대시보드".

import type { AdminMaintenanceReport } from "@/lib/admin-maintenance";
import {
  isMaintenanceTerminal,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceStatus,
} from "@/lib/maintenance-constants";
import type { Locale } from "@/lib/i18n";

export type { AdminMaintenanceReport };

// ── 상태 / 우선순위 / 카테고리 메타 ──
export const MAINT_STATUS: Record<MaintenanceStatus, { cls: string; key: string }> = {
  open: { cls: "open", key: "stOpen" },
  in_progress: { cls: "progress", key: "stProg" },
  closed: { cls: "resolved", key: "stClosed" },
  cancelled: { cls: "cancelled", key: "stCancelled" },
};

/** 완료(closed)는 누적 데이터라 보드·목록에서 빼고 별도 "완료" 뷰에서만 본다. */
export const BOARD_ORDER: MaintenanceStatus[] = ["open", "in_progress", "cancelled"];
export const ACTIVE_LIST_STATUS: MaintenanceStatus[] = ["open", "in_progress", "cancelled"];

export const MAINT_PRIORITY: Record<MaintenancePriority, { cls: string; key: string; rank: number }> = {
  urgent: { cls: "urgent", key: "prUrgent", rank: 0 },
  high: { cls: "high", key: "prHigh", rank: 1 },
  normal: { cls: "normal", key: "prNormal", rank: 2 },
  low: { cls: "low", key: "prLow", rank: 3 },
};
export const PRIORITY_ORDER: MaintenancePriority[] = ["urgent", "high", "normal", "low"];

export const MAINT_CATEGORY: Record<MaintenanceCategory, { key: string }> = {
  electric: { key: "cElectric" },
  water: { key: "cWater" },
  air_conditioning_heating: { key: "cAc" },
  wifi: { key: "cWifi" },
  furniture: { key: "cFurniture" },
  appliance: { key: "cAppliance" },
  cleaning_condition: { key: "cClean" },
  supplies: { key: "cSupplies" },
  damage: { key: "cDamage" },
  other: { key: "cOther" },
};
export const CATEGORY_ORDER = Object.keys(MAINT_CATEGORY) as MaintenanceCategory[];

// ── 파생 상태 접근자 ──
// `occupied` / `aging` 은 서버에서 계산한다 (연결된 예약과 도쿄
// 시계가 필요함). 클라이언트는 읽기만 한다. 호출부가 예전과 같게 읽히도록 함수로 둔다.
export function isActive(r: AdminMaintenanceReport): boolean {
  return !isMaintenanceTerminal(r.status);
}
export function isOldOpen(r: AdminMaintenanceReport): boolean {
  return r.aging;
}
export function isOccupied(r: AdminMaintenanceReport): boolean {
  return r.occupied;
}

// ── 시간 헬퍼 (모든 입력은 admin-maintenance.ts 의 도쿄 "YYYY-MM-DD HH:MM") ──
function toAbsMinutes(dateStr: string, minutes: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 60000 + minutes;
}

export function parseTs(ts: string | null): number | null {
  if (!ts) return null;
  const [d, t] = ts.split(" ");
  if (!d) return null;
  const [h, mm] = (t || "00:00").split(":").map(Number);
  return toAbsMinutes(d, h * 60 + mm);
}

/** 순수하지 않음 — 시계를 읽는다. 클라이언트 틱에 다시 실행되는 렌더 경로에서만 호출한다. */
function nowAbsMinutesTokyo(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return toAbsMinutes(
    `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`,
    get("hour") * 60 + get("minute"),
  );
}

export function fmtElapsed(ts: string, locale: Locale): string {
  const abs = parseTs(ts);
  if (abs == null) return "—";
  const mins = nowAbsMinutesTokyo() - abs;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "short" });
  if (mins < 60) {
    const m = Math.max(1, Math.round(mins));
    return formatter.format(-m, "minute");
  }
  const h = Math.floor(mins / 60);
  if (h < 24) {
    return formatter.format(-h, "hour");
  }
  const d = Math.floor(h / 24);
  return formatter.format(-d, "day");
}

export function fmtDate(d: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${d}T00:00:00+09:00`));
}

export function fmtDateTime(ts: string | null, locale: Locale): string {
  if (!ts) return "—";
  const [d, t] = ts.split(" ");
  return `${fmtDate(d, locale)} ${t}`;
}

/** "건물 · 객실" (객실 없는 건물 단위 신고면 buildingOnly 라벨). 검색에도 쓰인다. */
export function locationLabel(
  r: AdminMaintenanceReport,
  buildingOnlyLabel: string,
): string {
  return `${r.buildingLabel} · ${r.room ?? buildingOnlyLabel}`;
}

/** Board column order: 우선순위 높은 순 → 같은 우선순위면 오래된 순(방치 건을 위로). */
export function sortForBoard(list: AdminMaintenanceReport[]): AdminMaintenanceReport[] {
  return list.slice().sort((a, b) => {
    const pr = MAINT_PRIORITY[a.priority].rank - MAINT_PRIORITY[b.priority].rank;
    if (pr !== 0) return pr;
    return (parseTs(a.createdAt) ?? 0) - (parseTs(b.createdAt) ?? 0);
  });
}

// ── 필터 옵션 빌더 (하드코딩 마스터가 아니라 불러온 행에서 파생) ──
export function buildingOptionsOf(reports: readonly AdminMaintenanceReport[]): string[] {
  return [...new Set(reports.map((r) => r.buildingLabel).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
}

export type ReporterOption = { id: string; name: string };

export function reporterOptionsOf(reports: readonly AdminMaintenanceReport[]): ReporterOption[] {
  const map = new Map<string, string>();
  for (const r of reports) {
    if (r.reporterId && !map.has(r.reporterId)) map.set(r.reporterId, r.reporterName);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// 아바타 팔레트 — 청소 콘솔과 같은 방식 (결정적 해시 → 사용자별 고정 색상).
const AVATAR_PALETTE = [
  "#3f7d5a",
  "#a86b3c",
  "#4d6db5",
  "#557a8a",
  "#7a5aa8",
  "#2f4d8f",
  "#8a5a5a",
  "#5a8a6f",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function avatarColorFor(id: string): string {
  return AVATAR_PALETTE[hashString(id) % AVATAR_PALETTE.length];
}

/** 기본 조회 기간 — 이번 달 1일부터 오늘(Tokyo)까지. */
export function defaultRangeTokyo(): { from: string; to: string } {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return { from: `${today.slice(0, 7)}-01`, to: today };
}
