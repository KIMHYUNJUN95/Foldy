import "server-only";

// 관리자 분실물(lost & found) 콘솔의 실제 데이터 계층. `admin-maintenance.ts` 와 같은 형태:
// 표시용으로 평평하게 만든 뷰 모델, 조직 범위 쿼리, 그리고 KPI 줄이
// 오해를 부르는 0 대신 "-" 를 보이게 하는 `loadError` 플래그.
//
// 분실물 콘솔은 수리·점검 형태 위에 DERIVED 보관 생애주기를 더한다:
//   · 보관 시계 — 발견 후 14일(또는 hold_until)까지 보관, 만료 3일 전부터 폐기예정, 만료 시 자동 폐기.
//   · 삭제 시계 — 폐기 후 90일이 지나면 자동 하드 삭제(삭제 7일 전부터 임박).
// 이 값들은 저장하지 않고 조회 시점에 도쿄 날짜로 계산한다. docs/product/09-lost-found-workflow.md 참고.

import {
  LOST_FOUND_DISPOSAL_RETENTION_DAYS,
  LOST_FOUND_DUE_SOON_DAYS,
  LOST_FOUND_PURGE_SOON_DAYS,
  LOST_FOUND_STORAGE_DAYS,
  type LostItemCategory,
  type LostItemStatus,
  type LostReturnMethod,
} from "@/lib/lost-found-constants";
import { getOrgLostItems, type LostItemWithReporter } from "@/lib/lost-found";
import { resolveRequestLocation } from "@/lib/request-location";
import { getActiveRoomCatalogServer, type ActiveRoomCatalogItem } from "@/lib/rooms";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type AdminLostItemVM = {
  id: string;
  /** 화면에 노출하는 짧은 번호. uuid 앞 6자리(대문자). */
  shortId: string;
  itemName: string;
  category: LostItemCategory;
  status: LostItemStatus;
  buildingLabel: string;
  buildingRaw: string | null;
  /** null = 건물 전체/공용부. */
  room: string | null;
  reporterId: string;
  reporterName: string;
  /** "YYYY-MM-DD HH:MM" (도쿄). */
  foundAt: string;
  photoCount: number;
  photos: readonly string[];
  /** 등록 메모(memo). */
  description: string;
  guest: { name: string; checkIn: string; checkOut: string } | null;
  // 보관 시계(도쿄, 파생 — 저장 안 함)
  /** "YYYY-MM-DD" = hold_until ?? 발견일+14. */
  dueDate: string;
  storedDays: number;
  daysLeft: number;
  isDueSoon: boolean;
  isExpired: boolean;
  isExtended: boolean;
  holdReason: string | null;
  // 처리/완료 이력
  handledAt: string | null;
  /** 자동 폐기면 null. */
  handledByName: string | null;
  isAutoDisposed: boolean;
  returnMethod: LostReturnMethod | null;
  returnTrackingNo: string | null;
  handlingMemo: string | null;
  handlingPhotos: readonly string[];
  // 삭제 시계(disposed 전용, 도쿄, 파생)
  disposedDate: string | null;
  deleteDate: string | null;
  deleteDaysLeft: number | null;
  isDeleteSoon: boolean;
};

export type AdminLostFoundData = {
  items: AdminLostItemVM[];
  loadError: boolean;
};

const TOKYO_TZ = "Asia/Tokyo";

/** 도쿄 기준 "YYYY-MM-DD". */
function tokyoDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** 도쿄 기준 "YYYY-MM-DD HH:MM" — 콘솔 포매터가 기대하는 형식. */
function tokyoStamp(iso: string | null): string | null {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function todayKeyTokyo(): string {
  return tokyoDateKey(new Date().toISOString());
}

/** "YYYY-MM-DD" + n일 (달력 날짜 연산, TZ 흔들림 없이 UTC 자정으로 파싱). */
function addDays(dateKey: string, days: number): string {
  const base = new Date(`${dateKey}T00:00:00Z`).getTime();
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** later - earlier, 일수(정수). 둘 다 "YYYY-MM-DD". */
function dayDiff(later: string, earlier: string): number {
  const a = new Date(`${later}T00:00:00Z`).getTime();
  const b = new Date(`${earlier}T00:00:00Z`).getTime();
  return Math.round((a - b) / 86_400_000);
}

type ReservationRow = {
  id: string;
  check_in_date: string;
  check_out_date: string;
  guest_name: string;
};

// DB 에이전트가 추가 중인 신규 컬럼(category/return_method/return_tracking_no/hold_until/hold_reason)을
// 참조하기 위한 로컬 확장. types 반영 전까지 여기서 형을 좁힌다.
type LostRow = LostItemWithReporter & {
  category: LostItemCategory;
  return_method: LostReturnMethod | null;
  return_tracking_no: string | null;
  hold_until: string | null;
  hold_reason: string | null;
};

/**
 * 링크된 예약을 배치로 한 번씩만 조회한다(행마다 조회하면 N+1). 실패해도 목록 자체는 살아야 하므로
 * 빈 Map으로 degrade한다. (admin-maintenance collectLinks 축약판 — 분실물은 청소 링크를 쓰지 않는다.)
 */
async function collectReservations(
  items: LostRow[],
): Promise<Map<string, ReservationRow>> {
  const reservationIds = [...new Set(items.map((r) => r.reservation_id).filter(Boolean))] as string[];
  if (reservationIds.length === 0) return new Map();

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("reservations")
    .select("id, guest_name, check_in_date, check_out_date")
    .in("id", reservationIds);
  return new Map(((data ?? []) as ReservationRow[]).map((r) => [r.id, r] as const));
}

export async function getAdminLostFound(
  session: AppSession,
  /** 건물 라벨 사전 (dictionary.cleaning.buildingLabels) — 청소 콘솔과 같은 표기를 쓰기 위해. */
  buildingLabels: Record<string, string>,
): Promise<AdminLostFoundData> {
  let loadError = false;

  const [rawItems, roomCatalog] = await Promise.all([
    getOrgLostItems(session).catch(() => {
      loadError = true;
      return [] as LostItemWithReporter[];
    }),
    getActiveRoomCatalogServer(session.organization.id).catch(() => undefined),
  ]);

  const items = rawItems as LostRow[];
  const reservations = await collectReservations(items).catch(() => new Map<string, ReservationRow>());

  const catalog: ActiveRoomCatalogItem[] | undefined = roomCatalog;
  const today = todayKeyTokyo();

  const mapped: AdminLostItemVM[] = items.map((row) => {
    const location = resolveRequestLocation(row.room_label, catalog, buildingLabels, row.property_name);

    const active =
      row.status === "registered" || row.status === "stored" || row.status === "disposal_scheduled";

    const foundDate = tokyoDateKey(row.found_at);
    const dueDate = row.hold_until ?? addDays(foundDate, LOST_FOUND_STORAGE_DAYS);
    const storedDays = dayDiff(today, foundDate);
    const daysLeft = dayDiff(dueDate, today);
    const isDueSoon = active && daysLeft >= 0 && daysLeft <= LOST_FOUND_DUE_SOON_DAYS;
    const isExpired = active && daysLeft < 0;

    const isAutoDisposed = row.status === "disposed" && row.handled_by == null;
    const disposedDate = row.status === "disposed" ? tokyoDateKey(row.handled_at ?? row.updated_at) : null;
    const deleteDate = disposedDate ? addDays(disposedDate, LOST_FOUND_DISPOSAL_RETENTION_DAYS) : null;
    const deleteDaysLeft = deleteDate ? dayDiff(deleteDate, today) : null;
    const isDeleteSoon =
      row.status === "disposed" &&
      deleteDaysLeft != null &&
      deleteDaysLeft >= 0 &&
      deleteDaysLeft <= LOST_FOUND_PURGE_SOON_DAYS;

    const reservation = row.reservation_id ? (reservations.get(row.reservation_id) ?? null) : null;
    const guest = reservation
      ? {
          name: reservation.guest_name,
          checkIn: reservation.check_in_date,
          checkOut: reservation.check_out_date,
        }
      : row.guest_name
        ? { name: row.guest_name, checkIn: "", checkOut: "" }
        : null;

    return {
      id: row.id,
      shortId: row.id.slice(0, 6).toUpperCase(),
      itemName: row.item_name,
      category: row.category,
      status: row.status,
      buildingLabel: location.buildingLabel ?? (row.property_name ?? ""),
      buildingRaw: row.property_name,
      room: location.roomLabel || null,
      reporterId: row.reported_by_user_id,
      reporterName: row.reporter_name,
      foundAt: tokyoStamp(row.found_at) ?? "",
      photoCount: row.image_urls.length,
      photos: row.image_urls,
      description: row.memo ?? "",
      guest,
      dueDate,
      storedDays,
      daysLeft,
      isDueSoon,
      isExpired,
      isExtended: row.hold_until != null,
      holdReason: row.hold_reason,
      handledAt: tokyoStamp(row.handled_at),
      handledByName: isAutoDisposed ? null : row.handled_by_name,
      isAutoDisposed,
      returnMethod: row.return_method,
      returnTrackingNo: row.return_tracking_no,
      handlingMemo: row.handling_memo,
      handlingPhotos: row.handling_image_urls,
      disposedDate,
      deleteDate,
      deleteDaysLeft,
      isDeleteSoon,
    };
  });

  return { items: mapped, loadError };
}
