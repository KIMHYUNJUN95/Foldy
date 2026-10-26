// 관리자 청소 콘솔의 공용 도메인 상수 + 순수 서식 헬퍼. 실제 작업/
// 이력 데이터는 2026-07-14 부로 src/lib/admin-cleaning.ts(서버)에서 온다 — 이 모듈은
// 변하지 않는 도메인 사실(표준 건물 집합과 고정 표시 순서)과 작은
// 클라이언트 안전 날짜/소요시간 포매터만 두며, 오늘 보드 · 이력 보드 · 상세 패널 ·
// 강제 완료 모달이 함께 쓴다. docs/product/07-cleaning-workflow.md →
// "2026-07-14 어드민 청소 대시보드 — 백엔드 연동".

import { CANONICAL_TO_BUILDING_KEY } from "@/lib/room-label-normalization";

export type BuildingKey =
  | "arakicho_a"
  | "arakicho_b"
  | "kabukicho"
  | "stay_ari"
  | "takadanobaba"
  | "okubo_a"
  | "okubo_b"
  | "okubo_c";

/**
 * 청소 현황 · 기록의 건물 순서 — **예약 캘린더와 같은 순서**(`CALENDAR_BUILDING_ORDER`, 2026-10-15 사용자 결정).
 * 사노는 현장 운영에서 빠진 건물이라 넣지 않는다(`isExcludedOperationalProperty`).
 *
 * 2026-10-15 까지 스테이아리가 여기 없었다. 9/29 에 이름표(`CANONICAL_TO_BUILDING_KEY` → `stay_ari`)가 붙으면서 「아는 건물」로
 * 분류됐는데 이 목록에는 없어, 오늘 현황이 그 건물 칸을 **통째로 그리지 않았다**(기타 칸으로도 안 감). 건물을 늘리면 여기에도
 * 넣어야 하고, 빠뜨리면 `cleaning-building-order.test.ts` 가 잡는다.
 */
export const BUILDING_ORDER: BuildingKey[] = [
  "arakicho_a",
  "arakicho_b",
  "kabukicho",
  "stay_ari",
  "takadanobaba",
  "okubo_a",
  "okubo_b",
  "okubo_c",
];

/**
 * 청소 콘솔이 아는 건물이면 그 키, 아니면 null(→ 화면의 「기타」 칸 — 이름 그대로). 이름표가 있어도 `BUILDING_ORDER` 에 없는
 * 건물은 null 로 돌린다 — 키만 있고 순서에 없으면 오늘 현황이 그 칸을 그리지 않아 조용히 사라진다(2026-10-15 스테이아리).
 */
export function buildingKeyOf(canonicalPropertyName: string): BuildingKey | null {
  const key = CANONICAL_TO_BUILDING_KEY[canonicalPropertyName] as BuildingKey | undefined;
  return key && BUILDING_ORDER.includes(key) ? key : null;
}

export type CleaningTaskType = "checkout" | "simple" | "longstay" | "setup";

/* ---------------- 헬퍼 ---------------- */
export function toMin(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
export function fmtDur(min: number | null): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
export function todayDateKeyTokyo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}
export function nowMinutesTokyo(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}
export function nowLabelTokyo(): string {
  const min = nowMinutesTokyo();
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
export function elapsedMin(start: string | null): number | null {
  const s = toMin(start);
  return s == null ? null : nowMinutesTokyo() - s;
}
export function durationMin(start: string | null, end: string | null): number | null {
  const s = toMin(start);
  const e = toMin(end);
  return s == null || e == null ? null : e - s;
}
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
export function iso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}
export function monthRange(y: number, m: number): { from: string; to: string } {
  return { from: iso(y, m, 1), to: iso(y, m, new Date(y, m + 1, 0).getDate()) };
}
export function fmtDate(dateKey: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
  }).format(new Date(`${dateKey}T00:00:00+09:00`));
}
