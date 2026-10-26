"use client";

import { LiveWash } from "@/components/shared/live-wash";
import "./requests-list.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSplitPush } from "@/components/shell/split-list";
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  Package,
  ShoppingCart,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  deleteLostItem,
  deleteMaintenanceReport,
  deleteOrderRequest,
} from "@/actions/request-delete";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import {
  DateRangeCalendar,
  type DateRangeValue,
} from "@/components/requests/date-range-calendar";
import type { Locale } from "@/lib/i18n";
import type { LostItemWithReporter } from "@/lib/lost-found";
import { lostItemClock } from "@/lib/lost-found-constants";
import type { MaintenanceReportWithReporter } from "@/lib/maintenance-reports";
import type {
  OrderRequestStatus,
  OrderRequestWithReporter,
  OrderRequestItem,
} from "@/lib/order-requests";
import type { RequestDatePreset } from "@/lib/request-filters";
import {
  OrderDeliveryCalendar,
  type DeliveryCalendarOrder,
} from "@/components/requests/order-delivery-calendar";
import { getCanonicalPropertyName, localizePropertyName } from "@/lib/room-label-normalization";
import { resolveRequestCatalogLocation, resolveRequestLocation, type RequestLocationDisplay } from "@/lib/request-location";
import type { ActiveRoomCatalogItem } from "@/lib/rooms";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { FoldyEmpty } from "@/components/shared/foldy-empty";

type LostItemStatus = Database["public"]["Enums"]["lost_item_status"];
type MaintenanceStatus = Database["public"]["Enums"]["maintenance_status"];

type OrderStatus = OrderRequestStatus;

type ScopeFilter = "all" | "mine";
// 「전체」 다시 추가(2026-10-13 화이트 리디자인 시안 Req-Phone, 사용자 승인): 세 종류를 날짜별 한 목록으로 섞어 보고,
// 종류 탭으로 하나만 볼 수도 있다. 긴 혼합 목록은 줄 높이를 낮춘 한 줄 행으로 줄였다.
type TypeFilter = "all" | "lost-found" | "maintenance" | "order";
type StatusFilter = "all" | "active" | "closed";

const DEFAULT_TYPE: TypeFilter = "all";

// 목록 필터 상태에 속하는 키의 화이트리스트.
const LIST_FILTER_KEYS = [
  "scope", "type", "status", "building", "date", "startDate", "endDate",
] as const;

// 이 집합들은 모듈 수준 상수이므로 렌더 사이에 참조가 안정적이다.
const activeLostStatuses = new Set<LostItemStatus>([
  "registered",
  "stored",
  "disposal_scheduled",
]);
const activeMaintenanceStatuses = new Set<MaintenanceStatus>(["open", "in_progress"]);
// active: requested/approved/ordered, closed: received/closed
const activeOrderStatuses = new Set<OrderStatus>(["requested", "approved", "ordered"]);

// ── Date grouping (Tokyo operating date) ─────────────────────────────────────
// 요청을 Asia/Tokyo 달력 날짜로 오늘 / 어제 / 이전으로
// 나누므로, 서버/러너 시간대와 상관없이 묶음이 안정적이다.
type DateGroupKey = "today" | "yesterday" | "earlier";

function tokyoDateKey(value: string): string {
  // en-CA → "YYYY-MM-DD"
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function shiftDateKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="rqw-gh">
      <span>{label}</span>
      <b>{count}</b>
    </div>
  );
}

// delivery_date 는 날짜만 있다. 03:00 UTC(= 일본 정오)와 명시적 Asia/Tokyo 를 써서
// 러너 시간대와 상관없이 달력 날짜가 항상 안정적이게 한다.
/** 오늘 · 어제는 시각만, 그 전은 「9/26 14:05」(도쿄) — 「이전」 묶음에서 날짜가 안 보이던 것. */
function formatTime(value: string, locale: Locale) {
  const hm = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  const key = tokyoDateKey(value);
  const today = tokyoDateKey(new Date().toISOString());
  if (key === today || key === shiftDateKey(today, -1)) return hm;
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)} ${hm}`;
}

function formatDeliveryDate(value: string, locale: Locale) {
  const [y, m, d] = value.split("-").map(Number);
  const noonJst = new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(noonJst);
}

function formatDeliveryDateWindow(
  startDate: string | null,
  endDate: string | null,
  exactDate: string | null,
  locale: Locale,
) {
  if (startDate && endDate) {
    return `${formatDeliveryDate(startDate, locale)} - ${formatDeliveryDate(endDate, locale)}`;
  }
  if (exactDate) {
    return formatDeliveryDate(exactDate, locale);
  }
  return null;
}

type FilterLabels = {
  building: string;
  calendarApply: string;
  calendarClear: string;
  calendarClose: string;
  calendarPreviousMonth: string;
  calendarNextMonth: string;
  clearBuildingFilter: string;
  calendarSelectEnd: string;
  calendarSelectStart: string;
  calendarTitle: string;
  filterAll: string;
  filterButton: string;
  filterCustomRange: string;
  filterLostFound: string;
  filterMaintenance: string;
  filterOrder: string;
  filterActive: string;
  filterClosed: string;
  filterLast7Days: string;
  filterLast30Days: string;
  filterScopeMine: string;
  filterScopeMineRequest: string;
  filterToday: string;
  groupDate: string;
  groupScope: string;
  groupStatus: string;
  groupType: string;
  groupToday: string;
  groupYesterday: string;
  groupEarlier: string;
  openCountTemplate: string;
  noFilterResults: string;
  returnedEntry: string;
  disposedEntry: string;
};

type LostFoundCopy = {
  fromCleaningTag: string;
  groupActive: string;
  groupClosed: string;
  mobileListTitle: string;
  noRecords: string;
  reporter: string;
  room: string;
  statusLabels: Record<LostItemStatus, string>;
};

type MaintenanceCopy = {
  /** 「건물 전체」 신고(is_building_only)의 방 자리 표시. */
  buildingOnly: string;
  fromCleaningTag: string;
  mobileListTitle: string;
  noRecords: string;
  reporter: string;
  room: string;
  statusLabels: Record<MaintenanceStatus, string>;
  urgentLabel: string;
};

type OrderCopy = {
  sectionTitle: string;
  statusLabels: Record<OrderStatus, string>;
  deliveryDateShort: string;
  groupActive: string;
  groupDeliv: string;
  groupPast: string;
  arriveToday: string;
  arriveTomorrow: string;
  arriveOn: string;
  reqOn: string;
};

type DeliveryCalendarCopy = {
  title: string;
  openLabel: string;
  empty: string;
  dayEmpty: string;
  today: string;
  close: string;
  previousMonth: string;
  nextMonth: string;
  countTemplate: string;
  rangeLabel: string;
  monthCountTemplate: string;
  tomorrow: string;
};

type EnrichedOrder = OrderRequestWithReporter & {
  parsedItems: OrderRequestItem[];
};

type DeleteCopy = {
  confirmTitle: string;
  confirmBody: string;
  deleteAction: string;
  cancel: string;
  deleteFailed: string;
};

type RequestsFilterViewProps = {
  buildingLabels: Record<string, string>;
  currentUserId: string;
  /** 남이 쓴 요청 삭제 권한(`request.delete_any`, 역할 기본 + 개인 부여 · 차단) — 서버가 계산해 넘긴다. */
  canDeleteAny: boolean;
  datePreset: RequestDatePreset;
  deleteCopy: DeleteCopy;
  endDate?: string;
  filterLabels: FilterLabels;
  locale: Locale;
  lostFoundCopy: LostFoundCopy;
  lostItems: LostItemWithReporter[];
  maintenanceCopy: MaintenanceCopy;
  maintenanceReports: MaintenanceReportWithReporter[];
  orderRequests: OrderRequestWithReporter[];
  orderCopy: OrderCopy;
  deliveryCalendarCopy: DeliveryCalendarCopy;
  roomCatalog: ActiveRoomCatalogItem[];
  startDate?: string;
};

function SegTrack({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-slate-200/80 bg-white/80 p-1 shadow-[0_10px_22px_-20px_rgba(31,58,95,0.42)]">
      {children}
    </div>
  );
}

function SegButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold transition-all",
        active
          ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
          : "text-slate-500 hover:text-slate-900",
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

const KIND_ICON: Record<ListKind, React.ReactNode> = {
  "lost-found": <Package aria-hidden="true" />,
  maintenance: <Wrench aria-hidden="true" />,
  order: <ShoppingCart aria-hidden="true" />,
};

// 화이트 리디자인(2026-10-13, 시안 Req-Phone): 카드 · 사진 · 메모 · 배지 대신 한 줄 행 — 종류 아이콘 · 제목(긴급) · 「호실 · 건물 · 신고자 · 시각」 · 상태 글자.
// 눌림 반응(scale) · 삭제는 오른쪽 작은 휴지통(권한 있을 때만).
const RequestListCard = memo(function RequestListCard({
  kind,
  href,
  title,
  urgentLabel = null,
  meta,
  statusLabel,
  statusTone,
  onDelete,
  deleteLabel,
  live,
}: {
  kind: ListKind;
  href: string;
  title: string;
  urgentLabel?: string | null;
  meta: (string | null | undefined)[];
  statusLabel: string;
  statusTone: "open" | "prog" | "done" | "soon";
  onDelete?: () => void;
  deleteLabel: string;
  /** 새 줄이 위에서 내려오는 움직임의 열쇠(`LiveWash move`). */
  live: string;
}) {
  return (
    <Link className="rqw-row" href={href} data-live={live}>
      <span className="rqw-row__ic">{KIND_ICON[kind]}</span>
      <span className="rqw-row__b">
        <span className="rqw-row__t">
          {title}
          {urgentLabel ? <em>{urgentLabel}</em> : null}
        </span>
        <span className="rqw-row__m">{meta.filter((x, i, arr) => x && x !== "-" && arr.indexOf(x) === i).join(" · ")}</span>
      </span>
      <span className={`rqw-row__s is-${statusTone}`}>{statusLabel}</span>
      {onDelete ? (
        <button
          className="rqw-row__del"
          aria-label={deleteLabel}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" />
        </button>
      ) : null}
    </Link>
  );
});

function sanitizeScope(val: string | null): ScopeFilter {
  if (val === "mine") return "mine";
  return "all";
}

function sanitizeType(val: string | null): TypeFilter {
  if (val === "all" || val === "lost-found" || val === "maintenance" || val === "order") return val;
  return DEFAULT_TYPE;
}

function sanitizeStatus(val: string | null): StatusFilter {
  if (val === "active" || val === "closed") return val;
  return "all";
}

// 보강된 항목 타입: 위치를 미리 붙여 두어 카탈로그 조회를 반복하지 않는다.
type EnrichedLostItem = LostItemWithReporter & { location: RequestLocationDisplay; buildingKey: string | null };
type EnrichedMaintenance = MaintenanceReportWithReporter & { location: RequestLocationDisplay; buildingKey: string | null };

/** 건물 거르기용 키 — 저장된 이름(한국어 기준 · 옛 표기)을 기준 이름 하나로 모은다. */
function buildingKeyOf(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? getCanonicalPropertyName(trimmed) : null;
}

/** 모든 기록을 삭제할 수 있는 역할(본인 것만이 아님). DB RLS 정책과 같다. */

type ListKind = "lost-found" | "maintenance" | "order";

type DeleteTarget = {
  type: "lost-found" | "maintenance" | "order";
  id: string;
  title: string;
};

export function RequestsFilterView({
  buildingLabels,
  currentUserId,
  canDeleteAny,
  datePreset,
  deleteCopy,
  endDate,
  filterLabels,
  locale,
  lostFoundCopy,
  lostItems,
  maintenanceCopy,
  maintenanceReports,
  orderRequests,
  orderCopy,
  deliveryCalendarCopy,
  roomCatalog,
  startDate,
}: RequestsFilterViewProps) {
  const pathname = usePathname();
  const router = useRouter();
  const splitPush = useSplitPush();
  const searchParams = useSearchParams();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [deliveryCalOpen, setDeliveryCalOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  // ── 삭제 상태 ──────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();


  const openDelete = useCallback((target: DeleteTarget) => {
    setDeleteTarget(target);
    setDeleteError(null);
  }, []);

  const closeDelete = useCallback(() => {
    if (isDeleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }, [isDeleting]);

  function handleConfirmDelete() {
    if (!deleteTarget || isDeleting) return;
    startDeleteTransition(async () => {
      const action =
        deleteTarget.type === "lost-found" ? deleteLostItem :
        deleteTarget.type === "maintenance" ? deleteMaintenanceReport :
        deleteOrderRequest;
      const result = await action(deleteTarget.id);
      if (!result.ok) {
        setDeleteError(deleteCopy.deleteFailed);
        return;
      }
      setDeleteTarget(null);
      setDeleteError(null);
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

  // 필터 시트 포커스 관리용 ref.
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetWasOpenRef = useRef(false);

  // 열릴 때 포커스를 시트 안으로 옮기고, 닫히면 트리거로 되돌린다.
  useEffect(() => {
    if (filterSheetOpen) {
      sheetWasOpenRef.current = true;
      const first = sheetRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    } else if (sheetWasOpenRef.current) {
      sheetWasOpenRef.current = false;
      sheetTriggerRef.current?.focus();
    }
  }, [filterSheetOpen]);

  // Esc 닫기 · 배경 스크롤 잠금은 공용 BottomSheet 가 한다(2026-10-26 — 예전엔 여기서 한 번 더 걸어 두 번 잠겼다).

  // Tab 포커스를 시트 패널 안에 가둔다.
  function handleSheetKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // URL 에서 가져온 필터 상태. 범위/종류/상태에는 로컬 useState 를 쓰지 않는다.
  const scopeFilter = sanitizeScope(searchParams.get("scope"));
  const typeFilter = sanitizeType(searchParams.get("type"));
  const statusFilter = sanitizeStatus(searchParams.get("status"));
  const selectedBuildingKey = searchParams.get("building");

  // 화이트리스트로 거른 쿼리 문자열을 만들어 카드 href 에 붙인다.
  // 상세 페이지 전용 파라미터(예: created=1)가 목록 URL 에 섞이지 않게 한다.
  const listQueryString = useMemo(() => {
    const filtered = new URLSearchParams();
    for (const key of LIST_FILTER_KEYS) {
      const val = searchParams.get(key);
      if (val) filtered.set(key, val);
    }
    return filtered.toString();
  }, [searchParams]);

  const hasCustomRange = Boolean(startDate || endDate);
  const activePreset = hasCustomRange ? null : datePreset;

  // URL 갱신 유틸 하나: null 이면 키를 지우고, 문자열이면 설정한다.
  function updateQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function setDatePreset(nextPreset: RequestDatePreset) {
    updateQuery({
      date: nextPreset === "all" ? null : nextPreset,
      startDate: null,
      endDate: null,
    });
  }

  function applyRange(range: DateRangeValue) {
    updateQuery({
      date: null,
      startDate: range.startDate || null,
      endDate: range.endDate || null,
    });
    setCalendarOpen(false);
  }

  function clearRange() {
    updateQuery({ startDate: null, endDate: null });
    setCalendarOpen(false);
  }

  function formatRangeDate(value: string) {
    return new Intl.DateTimeFormat(locale, {
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(`${value}T00:00:00`));
  }

  const rangeLabel = hasCustomRange
    ? startDate && endDate && startDate !== endDate
      ? `${formatRangeDate(startDate)} ~ ${formatRangeDate(endDate)}`
      : formatRangeDate((startDate ?? endDate) as string)
    : filterLabels.filterCustomRange;

  // 메모이즈: roomCatalog/buildingLabels/locale 이 바뀌지 않는 한 안정적이다.
  const buildingOptions = useMemo(
    () =>
      Array.from(
        new Set(
          roomCatalog
            .map((item) => item.propertyName)
            .filter((propertyName) => Boolean(propertyName)),
        ),
      )
        .map((propertyName) => ({
          key: propertyName,
          label: localizePropertyName(propertyName, buildingLabels),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [roomCatalog, buildingLabels, locale],
  );

  const selectedBuildingLabel = useMemo(() => {
    if (!selectedBuildingKey) return null;
    return buildingOptions.find((option) => option.key === selectedBuildingKey)?.label ?? null;
  }, [buildingOptions, selectedBuildingKey]);
  // 건물 거르기는 번역된 이름이 아니라 건물 키(한국어 기준 이름)끼리 비교한다(2026-10-26) — 예전엔 주문의 기준 이름을
  // 번역된 라벨과 비교해 ja · en 에서 주문이 전부 사라졌다.
  const selectedBuildingCanonical = useMemo(
    () => (selectedBuildingKey ? getCanonicalPropertyName(selectedBuildingKey) : null),
    [selectedBuildingKey],
  );

  function setBuildingFilter(nextBuildingKey: string | null) {
    updateQuery({ building: nextBuildingKey });
  }

  // 항목마다 위치를 한 번씩 미리 계산한다.
  // resolveRequestLocation 은 호출마다 카탈로그 find/filter(O(catalog))를 하므로
  // 여기서 메모이즈해 범위/종류/상태 필터가 바뀔 때마다 다시 돌지 않게 한다.
  const enrichedLostItems = useMemo<EnrichedLostItem[]>(
    () =>
      lostItems.map((item) => ({
        ...item,
        location: resolveRequestLocation(item.room_label, roomCatalog, buildingLabels),
        buildingKey: buildingKeyOf(
          item.property_name ?? resolveRequestCatalogLocation(item.room_label, roomCatalog, buildingLabels).buildingName,
        ),
      })),
    [lostItems, roomCatalog, buildingLabels],
  );

  const enrichedMaintenance = useMemo<EnrichedMaintenance[]>(
    () =>
      maintenanceReports.map((report) => ({
        ...report,
        location: resolveRequestLocation(
          report.is_building_only ? "" : report.room_label,
          roomCatalog,
          buildingLabels,
          report.property_name,
        ),
        buildingKey: buildingKeyOf(
          report.property_name ?? resolveRequestCatalogLocation(report.room_label, roomCatalog, buildingLabels).buildingName,
        ),
      })),
    [maintenanceReports, roomCatalog, buildingLabels],
  );

  // 한 번에 도는 필터 파이프라인: 범위 + 종류 + 상태 + 건물을 함께 적용한다.
  // 보강된 데이터나 활성 필터가 실제로 바뀔 때만 다시 돈다.
  const baseLostItems = useMemo<EnrichedLostItem[]>(() => {
    return enrichedLostItems.filter((item) => {
      if (scopeFilter === "mine" && item.reported_by_user_id !== currentUserId) return false;
      if (selectedBuildingCanonical && item.buildingKey !== selectedBuildingCanonical) return false;
      if (statusFilter === "active") return activeLostStatuses.has(item.status);
      if (statusFilter === "closed") return !activeLostStatuses.has(item.status);
      return true;
    });
  }, [enrichedLostItems, scopeFilter, statusFilter, selectedBuildingCanonical, currentUserId]);
  const visibleLostItems = useMemo(() => (typeFilter === "all" || typeFilter === "lost-found" ? baseLostItems : []), [typeFilter, baseLostItems]);

  const baseMaintenance = useMemo<EnrichedMaintenance[]>(() => {
    return enrichedMaintenance.filter((report) => {
      if (scopeFilter === "mine" && report.reported_by_user_id !== currentUserId) return false;
      if (selectedBuildingCanonical && report.buildingKey !== selectedBuildingCanonical) return false;
      if (statusFilter === "active") return activeMaintenanceStatuses.has(report.status);
      if (statusFilter === "closed") return !activeMaintenanceStatuses.has(report.status);
      return true;
    });
  }, [enrichedMaintenance, scopeFilter, statusFilter, selectedBuildingCanonical, currentUserId]);
  const visibleMaintenance = useMemo(() => (typeFilter === "all" || typeFilter === "maintenance" ? baseMaintenance : []), [typeFilter, baseMaintenance]);

  const enrichedOrders = useMemo<EnrichedOrder[]>(
    () =>
      orderRequests.map((order) => ({
        ...order,
        parsedItems: Array.isArray(order.items) ? (order.items as OrderRequestItem[]) : [],
      })),
    [orderRequests],
  );

  const baseOrders = useMemo<EnrichedOrder[]>(() => {
    return enrichedOrders.filter((order) => {
      if (scopeFilter === "mine" && order.reported_by_user_id !== currentUserId) return false;
      if (selectedBuildingCanonical && buildingKeyOf(order.building_name) !== selectedBuildingCanonical) return false;
      if (statusFilter === "active") return activeOrderStatuses.has(order.status);
      if (statusFilter === "closed") return !activeOrderStatuses.has(order.status);
      return true;
    });
  }, [enrichedOrders, scopeFilter, statusFilter, selectedBuildingCanonical, currentUserId]);
  const visibleOrders = useMemo(() => (typeFilter === "all" || typeFilter === "order" ? baseOrders : []), [typeFilter, baseOrders]);

  const hasAnyResults =
    visibleLostItems.length > 0 || visibleMaintenance.length > 0 || visibleOrders.length > 0;

  // 배송 캘린더 데이터셋 — 조직 전체(또는 내) 발주, 목록의 상태/건물
  // 필터와 무관하다. 캘린더 컴포넌트 자체가 배송 날짜/기간이 있는 것만 남긴다.
  const deliveryCalendarOrders = useMemo<DeliveryCalendarOrder[]>(
    () =>
      enrichedOrders
        .filter((o) => scopeFilter !== "mine" || o.reported_by_user_id === currentUserId)
        .map((o) => ({
          id: o.id,
          buildingName: o.building_name,
          roomLabel: o.room_label,
          title: o.title,
          reporterName: o.reporter_name,
          status: o.status,
          deliveryDate: o.delivery_date,
          deliveryStartDate: o.delivery_start_date,
          deliveryEndDate: o.delivery_end_date,
        })),
    [enrichedOrders, scopeFilter, currentUserId],
  );

  // ── 날짜 묶음(도쿄 운영 날짜): 오늘 / 어제 / 이전.
  const todayKey = useMemo(() => tokyoDateKey(new Date().toISOString()), []);
  const yesterdayKey = useMemo(() => shiftDateKey(todayKey, -1), [todayKey]);

  const groupByDate = useCallback(
    <T,>(items: T[], getTime: (item: T) => string) => {
      const labels: Record<DateGroupKey, string> = {
        today: filterLabels.groupToday,
        yesterday: filterLabels.groupYesterday,
        earlier: filterLabels.groupEarlier,
      };
      const buckets: Record<DateGroupKey, T[]> = { today: [], yesterday: [], earlier: [] };
      for (const item of items) {
        const key = tokyoDateKey(getTime(item));
        const bucket: DateGroupKey =
          key === todayKey ? "today" : key === yesterdayKey ? "yesterday" : "earlier";
        buckets[bucket].push(item);
      }
      return (["today", "yesterday", "earlier"] as DateGroupKey[])
        .filter((key) => buckets[key].length > 0)
        .map((key) => ({ key, label: labels[key], items: buckets[key] }));
    },
    [todayKey, yesterdayKey, filterLabels.groupToday, filterLabels.groupYesterday, filterLabels.groupEarlier],
  );

  const hasDateFilter = hasCustomRange || datePreset !== "all";
  const presetLabel =
    datePreset === "today"
      ? filterLabels.filterToday
      : datePreset === "7d"
        ? filterLabels.filterLast7Days
        : datePreset === "30d"
          ? filterLabels.filterLast30Days
          : null;
  const dateChipLabel = hasCustomRange ? rangeLabel : presetLabel;

  // 기본값이 아닌 활성 필터를 탭 아래 빠른 해제 칩으로 보여 준다.
  // 범위("내 것")는 일부러 뺀다 — 이제 필터 시트 옵션이 아니라
  // 필터 줄의 전용 토글 스위치다.
  const activeChips: { id: string; label: string; onClear: () => void }[] = [];
  if (statusFilter === "active" || statusFilter === "closed") {
    activeChips.push({
      id: "status",
      label: statusFilter === "active" ? filterLabels.filterActive : filterLabels.filterClosed,
      onClear: () => updateQuery({ status: null }),
    });
  }
  if (hasDateFilter && dateChipLabel) {
    activeChips.push({
      id: "date",
      label: dateChipLabel,
      onClear: () => updateQuery({ date: null, startDate: null, endDate: null }),
    });
  }
  if (selectedBuildingLabel) {
    activeChips.push({
      id: "building",
      label: selectedBuildingLabel,
      onClear: () => setBuildingFilter(null),
    });
  }
  const activeFilterCount = activeChips.length;

  function resetFilters() {
    updateQuery({
      scope: null,
      status: null,
      date: null,
      startDate: null,
      endDate: null,
      building: null,
    });
  }

  const typeTabs: { id: TypeFilter; label: string; count: number }[] = [
    { id: "all", label: filterLabels.filterAll, count: baseLostItems.length + baseMaintenance.length + baseOrders.length },
    { id: "maintenance", label: filterLabels.filterMaintenance, count: baseMaintenance.length },
    { id: "lost-found", label: filterLabels.filterLostFound, count: baseLostItems.length },
    { id: "order", label: filterLabels.filterOrder, count: baseOrders.length },
  ];

  // 모든 탭이 한 줄 목록을 쓴다 — 「전체」에서는 종류가 섞이고 도쿄 날짜별로 묶는다.
  type Row = { key: string; time: string; node: React.ReactNode; active?: boolean; daysLeft?: number; orderGroup?: "active" | "deliv" | "past"; sortKey?: string };
  const rows: Row[] = [
    ...visibleLostItems.map((item) => {
      // 보관 중이면 시각 대신 자동 폐기까지 D-day(만료면 +n). 3일 이내 · 만료는 빨간 상태 글자.
      const clock = lostItemClock(item, todayKey);
      return {
      key: `l-${item.id}`,
      time: item.found_at,
      active: clock != null,
      daysLeft: clock?.daysLeft ?? 0,
      node: (
        <RequestListCard
          key={item.id}
          live={`l-${item.id}`}
          kind="lost-found"
          href={`/mobile/requests/lost-found/${item.id}${listQueryString ? `?${listQueryString}` : ""}`}
          title={item.item_name}
          meta={[
            item.location.roomLabel,
            item.location.buildingLabel,
            item.reporter_name,
            clock ? (clock.daysLeft < 0 ? `D+${-clock.daysLeft}` : `D-${clock.daysLeft}`) : formatTime(item.found_at, locale),
          ]}
          statusLabel={lostFoundCopy.statusLabels[item.status]}
          statusTone={clock && (clock.isDueSoon || clock.isExpired) ? "soon" : activeLostStatuses.has(item.status) ? "open" : "done"}
          onDelete={
            canDeleteAny || item.reported_by_user_id === currentUserId
              ? () => openDelete({ type: "lost-found", id: item.id, title: item.item_name })
              : undefined
          }
          deleteLabel={deleteCopy.deleteAction}
        />
      ),
      };
    }),
    ...visibleMaintenance.map((report) => ({
      key: `m-${report.id}`,
      time: report.created_at,
      node: (
        <RequestListCard
          key={report.id}
          live={`m-${report.id}`}
          kind="maintenance"
          href={`/mobile/requests/maintenance/${report.id}${listQueryString ? `?${listQueryString}` : ""}`}
          title={report.issue_title}
          urgentLabel={report.priority === "urgent" ? maintenanceCopy.urgentLabel : null}
          meta={[
            report.is_building_only ? maintenanceCopy.buildingOnly : report.location.roomLabel,
            report.location.buildingLabel,
            report.reporter_name,
            formatTime(report.created_at, locale),
          ]}
          statusLabel={maintenanceCopy.statusLabels[report.status]}
          statusTone={report.status === "in_progress" ? "prog" : activeMaintenanceStatuses.has(report.status) ? "open" : "done"}
          onDelete={
            canDeleteAny || report.reported_by_user_id === currentUserId
              ? () => openDelete({ type: "maintenance", id: report.id, title: report.issue_title })
              : undefined
          }
          deleteLabel={deleteCopy.deleteAction}
        />
      ),
    })),
    ...visibleOrders.map((order) => {
      const win = formatDeliveryDateWindow(order.delivery_start_date, order.delivery_end_date, order.delivery_date, locale);
      // 비품 주문 탭 묶음(2026-10-14 시안 Order-Tablet): 처리 중(요청됨 · 승인됨) → 배송 예정(주문 처리됨 · 배송이 오늘 이후) → 지난 요청.
      const delivEnd = order.delivery_end_date ?? order.delivery_date;
      const delivStart = order.delivery_start_date ?? order.delivery_date;
      const isOrdered = order.status === "ordered" || order.status === "received";
      const orderGroup: "active" | "deliv" | "past" =
        order.status === "requested" || order.status === "approved"
          ? "active"
          : isOrdered && delivEnd && delivEnd >= todayKey
            ? "deliv"
            : "past";
      const arrive = (() => {
        if (!isOrdered || !delivStart) return null;
        if (delivStart === todayKey) return orderCopy.arriveToday;
        if (delivStart === shiftDateKey(todayKey, 1)) return orderCopy.arriveTomorrow;
        return orderCopy.arriveOn.replace("{d}", `${+delivStart.slice(5, 7)}/${+delivStart.slice(8, 10)}`);
      })();
      const reqDay = tokyoDateKey(order.created_at);
      return {
        key: `o-${order.id}`,
        time: order.created_at,
        orderGroup,
        sortKey: orderGroup === "deliv" ? (delivStart ?? "") : order.created_at,
        node: (
          <RequestListCard
            key={order.id}
            live={`o-${order.id}`}
            kind="order"
            href={`/mobile/requests/orders/${order.id}${listQueryString ? `?${listQueryString}` : ""}`}
            title={order.title || order.parsedItems[0]?.name || "-"}
            meta={[
              order.room_label,
              localizePropertyName(order.building_name, buildingLabels),
              order.reporter_name,
              typeFilter === "order"
                ? (arrive ?? orderCopy.reqOn.replace("{d}", `${+reqDay.slice(5, 7)}/${+reqDay.slice(8, 10)}`))
                : win
                  ? `${orderCopy.deliveryDateShort} ${win}`
                  : formatTime(order.created_at, locale),
            ]}
            statusLabel={orderCopy.statusLabels[order.status]}
            statusTone={activeOrderStatuses.has(order.status) ? "open" : "done"}
            onDelete={
              canDeleteAny || order.reported_by_user_id === currentUserId
                ? () => openDelete({ type: "order", id: order.id, title: order.title || order.parsedItems[0]?.name || order.id })
                : undefined
            }
            deleteLabel={deleteCopy.deleteAction}
          />
        ),
      };
    }),
  ].sort((x, y) => (x.time < y.time ? 1 : -1));
  // 분실물 탭만 날짜 대신 「보관 중 · 자동 폐기 가까운 순」 → 「완료 · 최근 순」으로 묶는다(2026-10-14 시안 LF-Tablet).
  const rowGroups =
    typeFilter === "lost-found"
      ? [
          {
            key: "lf-active",
            label: lostFoundCopy.groupActive,
            items: rows.filter((r) => r.active).sort((x, y) => (x.daysLeft ?? 0) - (y.daysLeft ?? 0)),
          },
          { key: "lf-closed", label: lostFoundCopy.groupClosed, items: rows.filter((r) => !r.active) },
        ].filter((g) => g.items.length > 0)
      : typeFilter === "order"
        ? [
            {
              key: "o-active",
              label: orderCopy.groupActive,
              items: rows.filter((r) => r.orderGroup === "active").sort((x, y) => (x.time < y.time ? -1 : 1)),
            },
            {
              key: "o-deliv",
              label: orderCopy.groupDeliv,
              items: rows.filter((r) => r.orderGroup === "deliv").sort((x, y) => ((x.sortKey ?? "") < (y.sortKey ?? "") ? -1 : 1)),
            },
            { key: "o-past", label: orderCopy.groupPast, items: rows.filter((r) => r.orderGroup === "past") },
          ].filter((g) => g.items.length > 0)
        : groupByDate(rows, (r) => r.time);

  return (
    <div className="space-y-4">
      {/* 화이트 리디자인(2026-10-13, 시안 Req-Phone): 글자 탭(건수) → [전체 | 내가 등록] · 기간/필터 · (주문이면 납품 달력). */}
      <div className="space-y-3">
        <div className="rqw-tabs" role="tablist">
          {typeTabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={typeFilter === tab.id}
              className={typeFilter === tab.id ? "on" : undefined}
              onClick={() => updateQuery({ type: tab.id === DEFAULT_TYPE ? null : tab.id })}
              type="button"
            >
              {tab.label}
              <span>{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="rqw-bar">
          <div className="rqw-seg" role="tablist">
            <button
              type="button"
              aria-pressed={scopeFilter !== "mine"}
              className={scopeFilter !== "mine" ? "on" : undefined}
              onClick={() => updateQuery({ scope: null })}
            >
              {filterLabels.filterAll}
            </button>
            <button
              type="button"
              aria-pressed={scopeFilter === "mine"}
              className={scopeFilter === "mine" ? "on" : undefined}
              onClick={() => updateQuery({ scope: "mine" })}
            >
              {typeFilter === "lost-found" ? filterLabels.filterScopeMine : filterLabels.filterScopeMineRequest}
            </button>
          </div>
          {typeFilter === "order" ? (
            <button
              aria-label={deliveryCalendarCopy.openLabel}
              className="rqw-icon"
              onClick={() => setDeliveryCalOpen(true)}
              type="button"
            >
              <CalendarDays aria-hidden="true" />
            </button>
          ) : null}
          <button
            ref={sheetTriggerRef}
            aria-haspopup="dialog"
            aria-expanded={filterSheetOpen}
            className={`rqw-filter${activeFilterCount > 0 ? " is-on" : ""}`}
            onClick={() => setFilterSheetOpen(true)}
            type="button"
          >
            {dateChipLabel ?? filterLabels.filterButton}
            {activeFilterCount > 1 ? <b>{activeFilterCount}</b> : null}
            <ChevronDown aria-hidden="true" />
          </button>
        </div>

        {/* 완료-목록 진입 행 (분실물 탭 전용) — 반환완료·폐기 내역. 필터 행이 좁아 별도 줄로 분리했다. */}
        {typeFilter === "lost-found" ? (
          <div className="rqw-links">
            <Link href="/mobile/requests/lost-found/returned">{filterLabels.returnedEntry} ›</Link>
            <Link href="/mobile/requests/lost-found/disposed">{filterLabels.disposedEntry} ›</Link>
          </div>
        ) : null}

        {/* 활성 필터 칩(범위는 제외 — 위 토글이 처리한다). */}
        {activeChips.length > 0 ? (
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {activeChips.map((chip) => (
              <button
                key={chip.id}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 text-[12px] font-bold text-slate-700 shadow-[0_8px_18px_-18px_rgba(31,58,95,0.4)] transition-colors hover:bg-slate-50"
                onClick={chip.onClear}
                type="button"
              >
                {chip.label}
                <X className="size-3 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <DateRangeCalendar
        labels={{
          apply: filterLabels.calendarApply,
          clear: filterLabels.calendarClear,
          close: filterLabels.calendarClose,
          previousMonth: filterLabels.calendarPreviousMonth,
          nextMonth: filterLabels.calendarNextMonth,
          selectEnd: filterLabels.calendarSelectEnd,
          selectStart: filterLabels.calendarSelectStart,
          title: filterLabels.calendarTitle,
        }}
        locale={locale}
        onApply={applyRange}
        onClear={clearRange}
        onClose={() => setCalendarOpen(false)}
        open={calendarOpen}
        value={{ endDate, startDate }}
      />

      {filterSheetOpen ? (
        <BottomSheet
          ariaLabel={filterLabels.filterButton}
          ariaLabelledBy="filter-sheet-title"
          className="flex max-h-[85dvh] flex-col"
          header={
            <p
              id="filter-sheet-title"
              className="px-1 text-[15px] font-black tracking-[-0.03em] text-slate-950"
            >
              {filterLabels.filterButton}
            </p>
          }
          onClose={() => setFilterSheetOpen(false)}
          zIndexClassName="z-[95]"
        >
          {({ close }) => (
            <div
              ref={sheetRef}
              className="flex min-h-0 flex-1 flex-col"
              onKeyDown={handleSheetKeyDown}
            >
                {/* 스크롤되는 옵션 영역 */}
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1 py-4">
                  {/* 상태 */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">
                      {filterLabels.groupStatus}
                    </p>
                    <SegTrack>
                      <SegButton
                        active={statusFilter === "all"}
                        label={filterLabels.filterAll}
                        onClick={() => updateQuery({ status: null })}
                      />
                      <SegButton
                        active={statusFilter === "active"}
                        label={filterLabels.filterActive}
                        onClick={() => updateQuery({ status: "active" })}
                      />
                      <SegButton
                        active={statusFilter === "closed"}
                        label={filterLabels.filterClosed}
                        onClick={() => updateQuery({ status: "closed" })}
                      />
                    </SegTrack>
                  </div>

                  {/* 날짜 */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">
                      {filterLabels.groupDate}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SegTrack>
                        <SegButton
                          active={activePreset === "all"}
                          label={filterLabels.filterAll}
                          onClick={() => setDatePreset("all")}
                        />
                        <SegButton
                          active={activePreset === "today"}
                          label={filterLabels.filterToday}
                          onClick={() => setDatePreset("today")}
                        />
                        <SegButton
                          active={activePreset === "7d"}
                          label={filterLabels.filterLast7Days}
                          onClick={() => setDatePreset("7d")}
                        />
                        <SegButton
                          active={activePreset === "30d"}
                          label={filterLabels.filterLast30Days}
                          onClick={() => setDatePreset("30d")}
                        />
                      </SegTrack>
                      <button
                        aria-haspopup="dialog"
                        aria-expanded={calendarOpen}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-bold transition-colors",
                          hasCustomRange
                            ? "border-primary/20 bg-primary/10 text-primary"
                            : "border-dashed border-border text-muted-foreground hover:border-primary/20 hover:text-foreground",
                        )}
                        onClick={() => setCalendarOpen(true)}
                        type="button"
                      >
                        <CalendarRange className="size-3.5" aria-hidden="true" />
                        {rangeLabel}
                      </button>
                      {hasCustomRange ? (
                        <button
                          aria-label={filterLabels.calendarClear}
                          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                          onClick={clearRange}
                          type="button"
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* 건물 */}
                  {buildingOptions.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/70">
                        {filterLabels.building}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          aria-pressed={!selectedBuildingKey}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-bold transition-colors",
                            !selectedBuildingKey
                              ? "bg-primary/10 text-primary"
                              : "bg-muted/50 text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setBuildingFilter(null)}
                          type="button"
                        >
                          {filterLabels.filterAll}
                          {!selectedBuildingKey ? <Check className="size-3.5" aria-hidden="true" /> : null}
                        </button>
                        {buildingOptions.map((option) => (
                          <button
                            aria-pressed={selectedBuildingKey === option.key}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-bold transition-colors",
                              selectedBuildingKey === option.key
                                ? "bg-primary/10 text-primary"
                                : "bg-muted/50 text-muted-foreground hover:text-foreground",
                            )}
                            key={option.key}
                            onClick={() => setBuildingFilter(option.key)}
                            type="button"
                          >
                            {option.label}
                            {selectedBuildingKey === option.key ? (
                              <Check className="size-3.5" aria-hidden="true" />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* 푸터 — 액션 버튼 */}
                <div className="flex shrink-0 items-center gap-2 border-t-[0.5px] border-[var(--separator)] px-1 pt-4">
                  <button
                    className="h-11 flex-1 rounded-2xl border border-border bg-surface text-sm font-bold text-slate-700 shadow-[0_8px_16px_-14px_rgba(34,40,60,0.3)] transition-colors hover:bg-muted/60 disabled:opacity-40"
                    disabled={activeFilterCount === 0}
                    onClick={resetFilters}
                    type="button"
                  >
                    {filterLabels.calendarClear}
                  </button>
                  <button
                    className="h-11 flex-1 rounded-2xl bg-primary text-sm font-black text-white shadow-[0_12px_22px_-14px_hsl(var(--primary-hsl)/0.6)] transition-colors hover:bg-primary/90"
                    onClick={close}
                    type="button"
                  >
                    {filterLabels.calendarApply}
                  </button>
                </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {!hasAnyResults ? <FoldyEmpty title={filterLabels.noFilterResults} /> : null}

      {/* 새 요청이 들어오면(실시간 · 당겨서 새로고침) 맨 위에서 내려와 끼어든다 — 탭 · 필터로 통째로 바뀔 땐 그대로. */}
      <LiveWash move sig={rows.map((r) => r.key).join(",")}>
        {rowGroups.map((group) => (
          <div key={group.key}>
            <GroupHeader label={group.label} count={group.items.length} />
            <div className="rqw-list">{group.items.map((r) => r.node)}</div>
          </div>
        ))}
      </LiveWash>

      {/* ── 삭제 확인 시트 ── */}
      {deleteTarget ? (
        <BottomSheet
          ariaLabel={deleteCopy.confirmTitle}
          ariaLabelledBy="delete-confirm-title"
          onClose={closeDelete}
          zIndexClassName="z-[200]"
          header={
            <div className="flex flex-col items-center gap-3 px-1 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-red-50 text-red-500 ring-1 ring-red-200/70">
                <AlertTriangle className="size-7" aria-hidden="true" />
              </div>
              <div>
                <h3
                  className="text-lg font-black tracking-tight text-foreground"
                  id="delete-confirm-title"
                >
                  {deleteCopy.confirmTitle}
                </h3>
                <p className="mt-1 text-[13px] font-semibold text-muted-foreground">
                  {deleteCopy.confirmBody}
                </p>
              </div>
              <div className="w-full rounded-2xl border border-border/60 bg-muted/40 px-3 py-2.5">
                <p className="truncate text-sm font-black text-foreground">
                  {deleteTarget.title}
                </p>
              </div>
            </div>
          }
        >
          {({ close }) => (
            <div className="px-1 pt-4">
              {deleteError ? (
                <p className="mb-3 text-center text-xs font-semibold text-destructive">
                  {deleteError}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-background/70 text-sm font-bold text-foreground transition-colors hover:bg-muted/70 disabled:opacity-40"
                  disabled={isDeleting}
                  onClick={close}
                  type="button"
                >
                  {deleteCopy.cancel}
                </button>
                <button
                  className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-red-500 text-sm font-black text-white transition-colors hover:bg-red-600 disabled:opacity-40"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  type="button"
                >
                  {isDeleting ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                  {deleteCopy.deleteAction}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {deliveryCalOpen ? (
        <OrderDeliveryCalendar
          buildingLabels={buildingLabels}
          copy={{
            title: deliveryCalendarCopy.title,
            empty: deliveryCalendarCopy.empty,
            dayEmpty: deliveryCalendarCopy.dayEmpty,
            today: deliveryCalendarCopy.today,
            close: deliveryCalendarCopy.close,
            previousMonth: deliveryCalendarCopy.previousMonth,
            nextMonth: deliveryCalendarCopy.nextMonth,
            countTemplate: deliveryCalendarCopy.countTemplate,
            rangeLabel: deliveryCalendarCopy.rangeLabel,
            monthCountTemplate: deliveryCalendarCopy.monthCountTemplate,
            tomorrow: deliveryCalendarCopy.tomorrow,
          }}
          locale={locale}
          onClose={() => setDeliveryCalOpen(false)}
          onOpenOrder={(id) => {
            setDeliveryCalOpen(false);
            splitPush(`/mobile/requests/orders/${id}`);
          }}
          orders={deliveryCalendarOrders}
          statusLabels={orderCopy.statusLabels}
        />
      ) : null}
    </div>
  );
}
