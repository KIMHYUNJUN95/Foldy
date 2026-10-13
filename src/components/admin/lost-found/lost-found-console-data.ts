// Admin 분실물 console — presentation helpers. Mirrors maintenance-console-data.ts 1:1: status/category →
// CSS-class + i18n-key maps, board column order, and the Tokyo time formatters the cards/tables render
// with. Data (AdminLostItemVM) is real — see src/lib/admin-lost-found.ts.
// See docs/product/09-lost-found-workflow.md.

import type { AdminLostItemVM, AdminLostFoundData } from "@/lib/admin-lost-found";
import { isLostItemTerminal, type LostItemCategory, type LostItemStatus } from "@/lib/lost-found-constants";
import type { Locale } from "@/lib/i18n";

export type { AdminLostItemVM, AdminLostFoundData };

export type LFFilters = {
  status: LostItemStatus | "all";
  category: LostItemCategory | "all";
  method: "delivery" | "pickup" | "all";
  building: string;
  reporter: string;
  from: string;
  to: string;
  query: string;
};

// ── status meta (design status name → DB status → CSS class + i18n key) ──
export const LOST_STATUS: Record<LostItemStatus, { cls: string; key: string }> = {
  registered: { cls: "received", key: "stReceived" },
  stored: { cls: "stored", key: "stStored" },
  disposal_scheduled: { cls: "pending", key: "stPending" },
  disposed: { cls: "disposed", key: "stDisposed" },
  returned: { cls: "returned", key: "stReturned" },
};

/** 진행(active) 3종 — 현황 보드 컬럼 순서 그대로 접수 → 보관중 → 폐기예정. */
export const BOARD_ORDER: LostItemStatus[] = ["registered", "stored", "disposal_scheduled"];

export const CATEGORY_KEY: Record<LostItemCategory, string> = {
  electronics: "cElectronics",
  wallet: "cWallet",
  accessory: "cAccessory",
  clothing: "cClothing",
  document: "cDocument",
  bag: "cBag",
  umbrella: "cUmbrella",
  toiletry: "cToiletry",
  other: "cOther",
};
export const CATEGORY_ORDER = Object.keys(CATEGORY_KEY) as LostItemCategory[];

export function isActive(item: AdminLostItemVM): boolean {
  return !isLostItemTerminal(item.status);
}

/** "{n}"을 실제 값으로 치환하는 최소 템플릿 헬퍼 — 기존 photoCount.replace 패턴과 동일. */
export function tpl(template: string, n: number | string): string {
  return template.replace("{n}", String(n));
}

// ── time helpers (all inputs are Tokyo "YYYY-MM-DD[ HH:MM]" from admin-lost-found.ts) ──
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
  return t ? `${fmtDate(d, locale)} ${t}` : fmtDate(d, locale);
}

/** "건물 · 객실" (객실 없는 건물 단위 등록이면 buildingWhole 라벨). 검색에도 쓰인다. */
export function locationLabel(item: AdminLostItemVM, buildingWholeLabel: string): string {
  return `${item.buildingLabel} · ${item.room ?? buildingWholeLabel}`;
}

/** 보드 카드 정렬 — 폐기까지 남은 일수 오름차순, 동률이면 발견일시 오름차순(오래된 건을 위로). */
export function sortForBoard(list: AdminLostItemVM[]): AdminLostItemVM[] {
  return list.slice().sort((a, b) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return (parseTs(a.foundAt) ?? 0) - (parseTs(b.foundAt) ?? 0);
  });
}

// ── filter option builders (derived from the loaded rows, not a hardcoded master) ──
export function buildingOptionsOf(items: readonly AdminLostItemVM[]): string[] {
  return [...new Set(items.map((i) => i.buildingLabel).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
}

export type ReporterOption = { id: string; name: string };

export function reporterOptionsOf(items: readonly AdminLostItemVM[]): ReporterOption[] {
  const map = new Map<string, string>();
  for (const i of items) {
    if (i.reporterId && !map.has(i.reporterId)) map.set(i.reporterId, i.reporterName);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// Avatar palette — same approach as the cleaning/maintenance consoles (deterministic hash → stable
// color per user).
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
