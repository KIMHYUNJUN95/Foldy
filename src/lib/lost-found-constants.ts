// 분실물 상태·상수 — 클라이언트 안전(client-safe). `lost-found.ts`는 `@/lib/supabase/server`
// (→ next/headers)를 import 하므로 "use client" 컴포넌트에서 직접 import 하면 빌드가 깨진다.
// 상태 배열·가드·상한 같은 순수 상수는 여기 두고, 서버 lib은 이 파일을 재수출한다.
// (수리·점검의 maintenance-constants.ts와 동일한 분리 패턴.)
import type { Database } from "@/types/database";
import { tokyoDateOf, tokyoToday, ymdShift } from "@/lib/tokyo-date";

export type LostItemStatus = Database["public"]["Enums"]["lost_item_status"];
export type LostItemCategory = Database["public"]["Enums"]["lost_item_category"];
export type LostReturnMethod = Database["public"]["Enums"]["lost_return_method"];

// 표시 순서 = 접수 → 보관 → 폐기예정 → 폐기완료 → 반환완료(신규).
// 읽기 전용 진행바(폐기 경로)는 'returned'를 제외한 4개만 쓴다 — 상세 페이지에서 필터링한다.
export const lostItemStatuses: readonly LostItemStatus[] = [
  "registered",
  "stored",
  "disposal_scheduled",
  "disposed",
  "returned",
];

// 폐기 경로 진행바용(반환완료 제외). 손님 반환은 이 선형 흐름 밖의 종결이다.
export const lostItemLinearStatuses: readonly LostItemStatus[] = [
  "registered",
  "stored",
  "disposal_scheduled",
  "disposed",
];

export function isLostItemStatus(value: string): value is LostItemStatus {
  return (lostItemStatuses as readonly string[]).includes(value);
}

// 종결 상태 = 반환완료 또는 폐기완료. 이 상태에서는 처리 블록 대신 처리 이력을 보여준다.
export function isLostItemTerminal(status: LostItemStatus): boolean {
  return status === "returned" || status === "disposed";
}

export const LOST_FOUND_HANDLING_IMAGE_LIMIT = 5;

// 품목 분류 9종 — 등록 폼 선택지 + 콘솔 필터/뱃지. (모바일 폼도 이 배열을 쓴다.)
export const lostItemCategories: readonly LostItemCategory[] = [
  "electronics",
  "wallet",
  "accessory",
  "clothing",
  "document",
  "bag",
  "umbrella",
  "toiletry",
  "other",
];

// 반환 방식 — 배송(송장 기록) / 직접 수령.
export const lostReturnMethods: readonly LostReturnMethod[] = ["delivery", "pickup"];

export function isLostItemCategory(value: string): value is LostItemCategory {
  return (lostItemCategories as readonly string[]).includes(value);
}

export function isLostReturnMethod(value: string): value is LostReturnMethod {
  return (lostReturnMethods as readonly string[]).includes(value);
}

// 보관 생애주기(도쿄 기준, 파생 계산 — 저장 안 함).
// 발견 후 14일 보관 → 폐기예정(만료 3일 전부터) → 만료 시 자동 폐기.
export const LOST_FOUND_STORAGE_DAYS = 14;
export const LOST_FOUND_DUE_SOON_DAYS = 3;
// 폐기 후 90일 경과 시 하드 삭제(자동 정리). 삭제 7일 전부터 "삭제 임박".
export const LOST_FOUND_DISPOSAL_RETENTION_DAYS = 90;
export const LOST_FOUND_PURGE_SOON_DAYS = 7;

export type LostItemClock = {
  /** "YYYY-MM-DD" = hold_until ?? 발견일 + 14. */
  dueDate: string;
  storedDays: number;
  daysLeft: number;
  isDueSoon: boolean;
  isExpired: boolean;
  isExtended: boolean;
};

/**
 * 보관 시계(도쿄 달력) — 모바일 상세 · 요청 목록용 파생 계산. 어드민은 `admin-lost-found.ts` 가 같은 규칙으로 계산한다.
 * 종결(반환 · 폐기) 건은 null.
 */
export function lostItemClock(
  item: { status: LostItemStatus; found_at: string; hold_until: string | null },
  todayKey: string = tokyoToday(),
): LostItemClock | null {
  if (isLostItemTerminal(item.status)) return null;
  const foundDate = tokyoDateOf(item.found_at) ?? todayKey;
  const dueDate = item.hold_until ?? ymdShift(foundDate, LOST_FOUND_STORAGE_DAYS);
  const diff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
  const daysLeft = diff(dueDate, todayKey);
  return {
    dueDate,
    storedDays: Math.max(0, diff(todayKey, foundDate)),
    daysLeft,
    isDueSoon: daysLeft >= 0 && daysLeft <= LOST_FOUND_DUE_SOON_DAYS,
    isExpired: daysLeft < 0,
    isExtended: item.hold_until != null,
  };
}
