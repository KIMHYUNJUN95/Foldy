"use client";

import Link from "next/link";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import {
  BedDouble,
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  LoaderCircle,
  Lock,
  Pencil,
  Phone,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  savePropertyOperationInfoAction,
  saveReservationInternalNoteAction,
} from "@/app/admin/calendar/actions";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { formatPhoneDisplay, phoneHref } from "@/lib/phone-format";
import {
  getPropertyAddress,
  type PropertyAccessInfo,
  type PropertyMapMeta,
} from "@/lib/property-map-links";
import { getDictionary, type Locale } from "@/lib/i18n";
import { collectBlockedRooms } from "@/lib/room-blocks";
import { localizePropertyName } from "@/lib/room-label-normalization";
import type { Database } from "@/types/database";
import "./admin-reservation-console.css";

type ReservationStatus = Database["public"]["Enums"]["reservation_status"];

type ReservationChannel = "airbnb" | "booking" | "manual";
type ViewMode = "month" | "today" | "rooms" | "info";

type CalendarSelection =
  | { type: "reservation"; reservationId: string }
  | { type: "room"; roomKey: string }
  | null;

type AccessDraft = PropertyAccessInfo & { id: string };
type RoomCodeDraft = { roomLabel: string; code: string };

export type AdminReservationConsoleProps = {
  beds24SyncPaused: boolean;
  blockedProperties: Array<{
    propertyName: string;
    roomCount: number;
  }>;
  buildingInfos: PropertyMapMeta[];
  currentMonth: string;
  dates: string[];
  initialLocale: Locale;
  isOutOfWindow: boolean;
  nextMonth: string;
  prevMonth: string;
  propertyOptions: string[];
  reservationNotes: Record<string, string>;
  reservations: Array<{
    beds24Id: string;
    channel: ReservationChannel;
    checkInDate: string;
    checkOutDate: string;
    guestCount: number | null;
    /** 성인 · 어린이 — 성인 수를 모르면 `null`(합계만 보인다). */
    adults: number | null;
    children: number | null;
    guestName: string;
    id: string;
    phone: string | null;
    propertyName: string;
    roomKey: string;
    roomLabel: string;
    status: ReservationStatus;
  }>;
  /**
   * Beds24 캘린더에서 막아 둔 구간. `startDate`~`endDate` 는 **막힌 밤의 범위이며 양끝 포함**이다.
   * 예약과 겹칠 수 있다 — 채널 판매를 막아 두고 그 자리에 수기 예약을 넣는 운영이 실제로 쓰인다.
   */
  roomBlocks: Array<{
    endDate: string;
    id: string;
    propertyName: string;
    roomKey: string;
    roomLabel: string;
    startDate: string;
  }>;
  roomRows: Array<{
    displayRoomLabel: string;
    key: string;
    propertyName: string;
  }>;
  selectedMonth: string;
  selectedProperty: string | null;
  today: string;
};

const DAY_WIDTH_MIN = 34;
const LABEL_WIDTH_BASE = 176;
const PANEL_TRANSITION_MS = 220;
/** 운영 기본 시각 — 손님별 시각이 아니다(모바일 상세 시트와 같은 값, docs/product/15 「Reservation Detail Modal Policy」). */
const DEFAULT_CHECK_IN_TIME = "16:00";
const DEFAULT_CHECK_OUT_TIME = "10:00";

const CHANNEL_STYLE: Record<
  ReservationChannel,
  { accent: string; background: string; badge: string; tint: string }
> = {
  airbnb: {
    accent: "hsl(352 71% 60%)",
    background: "hsl(353 88% 96.1%)",
    badge: "linear-gradient(180deg, #ff9fad 0%, #f16f82 100%)",
    // 월간 보드 막대 바탕 — 흰 바탕에서 또렷하게(2026-10-15 「예약바가 너무 흰색」).
    tint: "#fbdde7",
  },
  booking: {
    accent: "hsl(214 57% 46%)",
    background: "hsl(212 70% 95.9%)",
    badge: "linear-gradient(180deg, #7ca3e5 0%, #4b72bf 100%)",
    tint: "#dce8fb",
  },
  manual: {
    accent: "hsl(221 11% 42%)",
    background: "hsl(218 17% 95.7%)",
    badge: "linear-gradient(180deg, #bdc6d2 0%, #909daf 100%)",
    tint: "#e8e6ef",
  },
};

const STATUS_STYLE: Record<
  ReservationStatus,
  { badge: string; dot: string; dimmed?: boolean }
> = {
  cancelled: { badge: "pill pill--danger", dot: "var(--danger)" },
  checked_in: { badge: "pill pill--done", dot: "var(--done)" },
  checked_out: { badge: "pill pill--muted", dot: "var(--adm-muted)", dimmed: true },
  confirmed: { badge: "pill pill--info", dot: "var(--info)" },
  no_show: { badge: "pill pill--danger", dot: "var(--danger)" },
};

function buildMonthLabel(month: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function formatShortDate(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatDateRangeShort(checkInDate: string, checkOutDate: string, locale: Locale) {
  return `${formatShortDate(checkInDate, locale)} ~ ${formatShortDate(checkOutDate, locale)}`;
}

function formatFullDate(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${date}T00:00:00Z`));
}

function weekdayLabel(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${date}T00:00:00Z`));
}

function dayOfWeek(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function nightsBetween(checkInDate: string, checkOutDate: string) {
  const start = Date.parse(`${checkInDate}T00:00:00Z`);
  const end = Date.parse(`${checkOutDate}T00:00:00Z`);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function buildCalendarHref(month: string, property: string | null) {
  const params = new URLSearchParams({ month });
  if (property) params.set("property", property);
  return `/admin/calendar?${params.toString()}`;
}

function buildCalendarPrintHref(month: string, property: string | null) {
  const params = new URLSearchParams({ month });
  if (property) params.set("property", property);
  return `/admin/calendar/print?${params.toString()}`;
}

function buildLinkedActionHref(
  kind: "maintenance" | "complaint" | "lost",
  reservationId: string,
) {
  const path =
    kind === "maintenance"
      ? "/mobile/maintenance/new"
      : kind === "complaint"
        ? "/mobile/complaints/new"
        : "/mobile/lost-found/new";

  return `${path}?reservationId=${encodeURIComponent(reservationId)}`;
}

function buildChannelLabel(
  channel: ReservationChannel,
  dictionary: ReturnType<typeof getDictionary>,
) {
  const copy = dictionary.admin.calendar;
  if (channel === "airbnb") return copy.channelAirbnb;
  if (channel === "booking") return copy.channelBooking;
  return copy.channelManual;
}

function buildAccessLabel(
  access: PropertyAccessInfo,
  dictionary: ReturnType<typeof getDictionary>,
) {
  const t = dictionary.mobile;
  const labelMap: Record<PropertyAccessInfo["labelKey"], string> = {
    doorPassword: t.calendarMapAccessKindDoorPassword,
    keyBox: t.calendarMapAccessKindKeyBox,
    keyBoxPassword: t.calendarMapAccessKindKeyBoxPassword,
    linenStorageEntrancePassword: t.calendarMapAccessKindLinenStorageEntrancePassword,
    roomPassword: t.calendarMapAccessKindRoomPassword,
    storage: t.calendarMapAccessKindStorage,
    storagePassword: t.calendarMapAccessKindStoragePassword,
  };

  const prefixMap: Record<NonNullable<PropertyAccessInfo["prefixKey"]>, string> = {
    floor1: t.calendarMapAccessFloor1,
  };

  const noteMap: Record<NonNullable<PropertyAccessInfo["noteKey"]>, string> = {
    allRoomsSame: t.calendarMapAccessNoteAllRoomsSame,
  };

  const label = labelMap[access.labelKey];
  const prefix = access.prefixKey ? prefixMap[access.prefixKey] : null;
  const note = access.noteKey ? noteMap[access.noteKey] : null;
  return {
    label: prefix ? `${prefix} · ${label}` : label,
    note,
  };
}

function cloneBuildingInfos(buildingInfos: PropertyMapMeta[]) {
  return Object.fromEntries(
    buildingInfos.map((item) => [
      item.canonicalName,
      {
        address: { ...item.address },
        googleMapsUrl: item.googleMapsUrl,
        kind: item.kind,
        note: item.note ?? "",
        roomAccess: (item.roomAccess ?? []).map((room) => ({ ...room })),
        sharedAccess: item.sharedAccess.map((access, index) => ({
          ...access,
          id: `${item.canonicalName}-${index}`,
        })),
      },
    ]),
  ) as Record<
    string,
    {
      address: PropertyMapMeta["address"];
      googleMapsUrl: string;
      kind: PropertyMapMeta["kind"];
      note: string;
      roomAccess: RoomCodeDraft[];
      sharedAccess: AccessDraft[];
    }
  >;
}

function copyText(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value).catch(() => legacyCopy(value));
  }
  return legacyCopy(value);
}

/** 보안 컨텍스트가 아니거나 권한이 막혔을 때 — 숨긴 입력칸으로 복사한다(초대코드 복사와 같은 방식). */
function legacyCopy(value: string) {
  if (typeof document === "undefined") return Promise.reject(new Error("clipboard_unavailable"));
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(area);
  return ok ? Promise.resolve() : Promise.reject(new Error("clipboard_unavailable"));
}

export function AdminReservationConsole({
  beds24SyncPaused,
  blockedProperties,
  buildingInfos,
  currentMonth,
  dates,
  initialLocale,
  isOutOfWindow,
  nextMonth,
  prevMonth,
  propertyOptions,
  reservationNotes: initialReservationNotes,
  reservations,
  roomBlocks,
  roomRows,
  selectedMonth,
  selectedProperty,
  today,
}: AdminReservationConsoleProps) {
  const router = useRouter();
  const { dismiss, showToast, toast } = useAdminToast();

  const [activeView, setActiveView] = useState<ViewMode>("month");
  const [channelFilter, setChannelFilter] = useState<ReservationChannel | "all">("all");
  const [editingBuilding, setEditingBuilding] = useState<string | null>(null);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [savingBuilding, setSavingBuilding] = useState<string | null>(null);
  const [panelSelection, setPanelSelection] = useState<CalendarSelection>(null);
  const [propertyDrafts, setPropertyDrafts] = useState(() => cloneBuildingInfos(buildingInfos));
  const [reservationNotes, setReservationNotes] = useState<Record<string, string>>(
    initialReservationNotes,
  );
  const [gridSizes, setGridSizes] = useState({
    dayWidth: DAY_WIDTH_MIN,
    labelWidth: LABEL_WIDTH_BASE,
  });

  const gridWrapRef = useRef<HTMLDivElement | null>(null);

  const uiLocale = initialLocale;
  const dictionary = getDictionary(uiLocale);
  const copy = dictionary.admin.calendar;
  const statusLabels = dictionary.admin.reservationStatusLabels;
  const buildingLabels = dictionary.cleaning.buildingLabels;

  const localizedPropertyName = (propertyName: string) =>
    localizePropertyName(propertyName, buildingLabels);

  const groupedRows = propertyOptions
    .filter((propertyName) => (selectedProperty ? propertyName === selectedProperty : true))
    .map((propertyName) => {
      const rows = roomRows.filter((row) => row.propertyName === propertyName);
      const blocked = blockedProperties.find((item) => item.propertyName === propertyName) ?? null;
      return {
        blocked,
        propertyName,
        rows,
      };
    });

  const visibleReservations = reservations.filter((reservation) => {
    if (selectedProperty && reservation.propertyName !== selectedProperty) return false;
    if (channelFilter !== "all" && reservation.channel !== channelFilter) return false;
    return true;
  });

  const reservationsByRoom = new Map<string, typeof visibleReservations>();
  for (const reservation of visibleReservations) {
    const bucket = reservationsByRoom.get(reservation.roomKey);
    if (bucket) bucket.push(reservation);
    else reservationsByRoom.set(reservation.roomKey, [reservation]);
  }

  const blocksByRoom = new Map<string, AdminReservationConsoleProps["roomBlocks"]>();
  for (const block of roomBlocks) {
    if (selectedProperty && block.propertyName !== selectedProperty) continue;
    const bucket = blocksByRoom.get(block.roomKey);
    if (bucket) bucket.push(block);
    else blocksByRoom.set(block.roomKey, [block]);
  }

  // 오늘 막혀 있는 방. 「예약은 없지만 팔 수 없는」 상태를 공실과 구분하는 데 쓴다 —
  // 판매만 막아 두는 운영이 실제로 있어서, 그걸 「빈 객실」로 보여주면 잘못된 판단을 부른다.
  const blockedRoomKeysToday = collectBlockedRooms(roomBlocks, today, (block) => block.roomKey);

  const activeReservations = reservations.filter((reservation) => {
    if (selectedProperty && reservation.propertyName !== selectedProperty) return false;
    return reservation.status !== "cancelled" && reservation.status !== "no_show";
  });
  const hasReservationNote = (reservationId: string) =>
    Boolean(reservationNotes[reservationId]?.trim());
  /** 「성인 2」 / 「성인 2 · 어린이 1」 / 합계만 — 막대 · 목록 한 줄용. */
  const guestShort = (reservation: AdminReservationConsoleProps["reservations"][number]) => {
    if (reservation.adults !== null) {
      const full = copy.guestBreakdown
        .replace("{adults}", String(reservation.adults))
        .replace("{children}", String(reservation.children ?? 0));
      return reservation.children ? full : full.split(" · ")[0];
    }
    return reservation.guestCount === null ? copy.guestCountUnknown : copy.guestCount(reservation.guestCount);
  };

  const arrivalsToday = activeReservations.filter((reservation) => reservation.checkInDate === today);
  const departuresToday = activeReservations.filter((reservation) => reservation.checkOutDate === today);
  const inHouseToday = activeReservations.filter(
    (reservation) => reservation.checkInDate <= today && reservation.checkOutDate > today,
  );
  const departureRoomKeysToday = new Set(departuresToday.map((reservation) => reservation.roomKey));
  /**
   * 셋팅 대상 = 오늘 체크인인데 같은 방 체크아웃은 없는 방 (= 불 꺼진 방에 손님이 든다).
   * 체크아웃 당일 체크인이면 청소하며 그대로 이어지므로 셋팅 대상이 아니다.
   *
   * **중복 제거는 «오늘 도착분» 안에서만 해야 한다 (2026-08-07 수정).** 이전 구현은
   * `activeReservations` 전체를 훑어 `findIndex` 가 그 객실의 *가장 과거* 예약을 가리켰다.
   * 한 객실에는 수십 건의 예약이 있으니 오늘 도착 건이 그 자리에 올 일이 거의 없어, 조건이
   * 사실상 항상 거짓 → **KPI 가 늘 0** 이었다 (2026-08-07 실측: 화면 0 / 실제 2건).
   *
   * `roomKey` 는 `displayRoomLabel` 기반이라 아라키초 `501` / `501_2` 처럼 한 물리 객실에
   * 리스팅이 둘인 경우도 이미 한 키로 합쳐진다 — 여기서 따로 처리할 것은 없다.
   */
  const settingTargetsToday = arrivalsToday.filter(
    (reservation, index, collection) =>
      !departureRoomKeysToday.has(reservation.roomKey) &&
      collection.findIndex((item) => item.roomKey === reservation.roomKey) === index,
  );
  const occupiedKeysToday = new Set(inHouseToday.map((reservation) => reservation.roomKey));
  const activeRoomCount = roomRows.filter(
    (room) => !selectedProperty || room.propertyName === selectedProperty,
  ).length;
  const occupancyPercent =
    activeRoomCount > 0 ? Math.round((occupiedKeysToday.size / activeRoomCount) * 100) : 0;


  const reservationLookup = Object.fromEntries(
    activeReservations.map((reservation) => [reservation.id, reservation]),
  ) as Record<string, (typeof activeReservations)[number] | undefined>;
  const roomLookup = Object.fromEntries(roomRows.map((row) => [row.key, row])) as Record<
    string,
    (typeof roomRows)[number] | undefined
  >;

  const panelReservation =
    panelSelection?.type === "reservation"
      ? reservationLookup[panelSelection.reservationId] ?? null
      : null;
  const panelRoom =
    panelSelection?.type === "room" ? roomLookup[panelSelection.roomKey] ?? null : null;

  useEffect(() => {
    if (!gridWrapRef.current || activeView !== "month" || isOutOfWindow) return;

    const element = gridWrapRef.current;
    const days = dates.length;
    const update = () => {
      const available = element.clientWidth - LABEL_WIDTH_BASE;
      const dayWidth = Math.max(DAY_WIDTH_MIN, Math.floor(available / Math.max(1, days)));
      const extra = Math.max(0, available - dayWidth * days);
      setGridSizes({
        dayWidth,
        labelWidth: LABEL_WIDTH_BASE + extra,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeView, dates.length, isOutOfWindow]);

  // 선언 순서: Esc 효과가 쓰기 전에 있어야 React Compiler 가 이 콘솔을 컴파일한다.
  function closePanel() {
    setIsPanelVisible(false);
    window.setTimeout(() => {
      setPanelSelection((current) => (current ? null : current));
    }, PANEL_TRANSITION_MS);
  }

  useEffect(() => {
    if (!panelSelection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelSelection]);

  const handleSyncRefresh = () => {
    if (beds24SyncPaused) return;
    if (isRefreshing) return;
    setIsRefreshing(true);
    showToast(copy.syncRefreshStarted);
    startTransition(() => {
      router.refresh();
      window.setTimeout(() => {
        setIsRefreshing(false);
        showToast(copy.syncRefreshFinished);
      }, 500);
    });
  };

  const openReservationPanel = (reservationId: string) => {
    setIsPanelVisible(true);
    setPanelSelection({ type: "reservation", reservationId });
  };

  const openRoomPanel = (roomKey: string) => {
    setIsPanelVisible(true);
    setPanelSelection({ type: "room", roomKey });
  };

  const clearMonthFilters = () => {
    setChannelFilter("all");
  };

  const handleSaveBuildingInfo = async (propertyName: string) => {
    const draft = propertyDrafts[propertyName];
    if (!draft || savingBuilding) return;

    setSavingBuilding(propertyName);
    const result = await savePropertyOperationInfoAction({
      canonicalName: propertyName,
      data: {
        address: draft.address,
        note: draft.note,
        roomAccess: draft.roomAccess,
        sharedAccess: draft.sharedAccess.map((entry) => {
          const { id, ...access } = entry;
          void id;
          return access;
        }),
      },
    });
    setSavingBuilding(null);

    if (!result.ok) {
      showToast(copy.buildingInfoSaveFailedToast, true);
      return;
    }

    setEditingBuilding(null);
    showToast(copy.sessionSavedToast);
    router.refresh();
  };

  const viewTabs: Array<{ key: ViewMode; label: string; icon: ComponentType<{ className?: string }> }> = [
    { key: "month", label: copy.monthView, icon: CalendarDays },
    { key: "today", label: copy.todayOpsView, icon: Sparkles },
    { key: "rooms", label: copy.roomStatusView, icon: BedDouble },
    { key: "info", label: copy.buildingInfoView, icon: Building2 },
  ];

  const channelOptions: Array<{ value: ReservationChannel | "all"; label: string }> = [
    { value: "all", label: copy.channelAll },
    { value: "airbnb", label: copy.channelAirbnb },
    { value: "booking", label: copy.channelBooking },
    { value: "manual", label: copy.channelManual },
  ];

  const renderMonthView = () => {
    const hasMatchingReservations = visibleReservations.length > 0;
    const visibleGroups = groupedRows
      .map((group) => {
        const rows = group.rows;
        if (group.blocked && rows.length === 0) {
          return { ...group, rows: [] };
        }
        return { ...group, rows };
      })
      .filter((group) => group.rows.length > 0 || group.blocked);

    // 이번 달 가동률 = 판 밤 / (객실 × 날짜). 빈 방 줄 = 그날 밤 예약도 차단도 없는 방 수(채널 고르기와 무관).
    const nightTaken = (roomKey: string, date: string) =>
      activeReservations.some((r) => r.roomKey === roomKey && r.checkInDate <= date && r.checkOutDate > date);
    const nightBlocked = (roomKey: string, date: string) =>
      (blocksByRoom.get(roomKey) ?? []).some((block) => block.startDate <= date && block.endDate >= date);
    const groupStats = (rows: AdminReservationConsoleProps["roomRows"]) => {
      const empty = dates.map((date) => rows.filter((row) => !nightTaken(row.key, date) && !nightBlocked(row.key, date)).length);
      const taken = rows.reduce((sum, row) => sum + dates.filter((date) => nightTaken(row.key, date)).length, 0);
      const percent = rows.length && dates.length ? Math.round((taken / (rows.length * dates.length)) * 100) : 0;
      return { empty, percent };
    };

    return (
      <>
        <div className="acw-sub">
          <span>{copy.wSubline.replace("{n}", String(activeRoomCount))}</span>
          <span className="acw-legend">
            {(["airbnb", "booking", "manual"] as ReservationChannel[]).map((channel) => (
              <span key={channel}>
                <i style={{ background: CHANNEL_STYLE[channel].accent }} />
                {buildChannelLabel(channel, dictionary)}
              </span>
            ))}
            <span>
              <i className="is-block" />
              {copy.wBlockedLegend}
            </span>
          </span>
        </div>

        {isOutOfWindow ? (
          <div className="admcal__state-card">
            <TriangleAlert className="size-5" />
            <div>
              <div className="admcal__state-title">{copy.outOfWindowTitle}</div>
              <div className="admcal__state-body">{copy.outOfWindowBody}</div>
            </div>
          </div>
        ) : visibleGroups.length === 0 ? (
          <div className="admcal__state-card">
            <Search className="size-5" />
            <div>
              <div className="admcal__state-title">{copy.emptyTitle}</div>
              <div className="admcal__state-body">
                {hasMatchingReservations ? copy.emptyBody : copy.emptyBodyNoReservations}
              </div>
            </div>
            <button className="admcal__subtle-btn" onClick={clearMonthFilters} type="button">
              {copy.clearFilters}
            </button>
          </div>
        ) : (
          <>
            <div className="admcal__grid-card">
              <div className="admcal__grid-wrap" ref={gridWrapRef}>
                <div
                  className="admcal__grid"
                  style={
                    {
                      "--admcal-day-count": dates.length,
                      "--admcal-day-width": `${gridSizes.dayWidth}px`,
                      "--admcal-label-width": `${gridSizes.labelWidth}px`,
                    } as CSSProperties
                  }
                >
                  <div className="admcal__grid-head">
                    <div className="admcal__grid-corner">
                      <BedDouble className="size-4" />
                      <span>{copy.room}</span>
                    </div>
                    <div className="admcal__grid-days">
                      {dates.map((date) => {
                        const dow = dayOfWeek(date);
                        const isToday = date === today;
                        return (
                          <div
                            className={[
                              "admcal__day-head",
                              dow === 0 ? "is-sun" : "",
                              dow === 6 ? "is-sat" : "",
                              isToday ? "is-today" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            key={date}
                          >
                            <span className="admcal__day-week">{weekdayLabel(date, uiLocale)}</span>
                            <span className="admcal__day-number">{date.slice(8)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {visibleGroups.map((group) => {
                    const stats = groupStats(group.rows);
                    return (
                      <div className="admcal__group" key={group.propertyName}>
                        <div className="acw-ghead">
                          <b>{localizedPropertyName(group.propertyName)}</b>
                          <span className="num">
                            {group.blocked
                              ? copy.blockedProperty
                              : copy.wGroupMeta
                                  .replace("{n}", String(group.rows.length))
                                  .replace("{p}", String(stats.percent))}
                          </span>
                        </div>
                        {group.blocked ? null : (
                          <div className="acw-empty-row">
                            <div className="admcal__room-label">{copy.wEmptyRow}</div>
                            <div className="acw-empty-row__days">
                              {stats.empty.map((count, index) => (
                                <span className={`num${count ? "" : " is-zero"}`} key={dates[index]}>
                                  {count || "–"}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {group.blocked ? (
                          <div className="admcal__blocked-row">
                            <div className="admcal__room-label admcal__room-label--blocked">
                              {copy.blockedProperty}
                            </div>
                            <div className="admcal__blocked-track">
                              <span className="admcal__blocked-chip">
                                <Lock className="size-3.5" />
                                {copy.blockedProperty}
                              </span>
                            </div>
                          </div>
                        ) : (
                          group.rows.map((room) => {
                            const roomReservations = (reservationsByRoom.get(room.key) ?? []).filter(
                              (reservation) =>
                                reservation.checkInDate < `${nextMonth}-01` &&
                                reservation.checkOutDate > `${selectedMonth}-01`,
                            );
                            return (
                              <div className="admcal__room-row" key={room.key}>
                                <div className="admcal__room-label">{room.displayRoomLabel}</div>
                                <div className="admcal__room-track">
                                  {dates.map((date) => {
                                    const dow = dayOfWeek(date);
                                    return (
                                      <div
                                        className={[
                                          "admcal__cell",
                                          dow === 0 ? "is-sun" : "",
                                          dow === 6 ? "is-sat" : "",
                                          date === today ? "is-today" : "",
                                        ]
                                          .filter(Boolean)
                                          .join(" ")}
                                        key={date}
                                      />
                                    );
                                  })}

                                  {(blocksByRoom.get(room.key) ?? [])
                                    .filter(
                                      (block) =>
                                        block.startDate < `${nextMonth}-01` &&
                                        block.endDate >= `${selectedMonth}-01`,
                                    )
                                    .map((block) => {
                                      // 블락은 「밤」의 범위이고 양끝을 포함한다. 예약 막대와 눈금을
                                      // 맞추려면 체크인 S · 체크아웃 E+1 인 예약과 같게 놓아야 한다 —
                                      // 그래서 끝을 하루 밀어 계산한다.
                                      const exclusiveEnd = new Date(`${block.endDate}T00:00:00Z`);
                                      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
                                      const endExclusive = exclusiveEnd.toISOString().slice(0, 10);

                                      const startsBeforeMonth = block.startDate < `${selectedMonth}-01`;
                                      const endsAfterMonth = endExclusive >= `${nextMonth}-01`;
                                      const startUnit = startsBeforeMonth
                                        ? 0
                                        : Number(block.startDate.slice(8)) - 1 + 0.5;
                                      const endUnit = endsAfterMonth
                                        ? dates.length
                                        : Number(endExclusive.slice(8)) - 1 + 0.5;
                                      const span = Math.max(0.75, endUnit - startUnit);
                                      return (
                                        <div
                                          aria-label={copy.blockedRoom}
                                          className={[
                                            "admcal__block",
                                            startsBeforeMonth ? "is-clamped-left" : "",
                                            endsAfterMonth ? "is-clamped-right" : "",
                                          ]
                                            .filter(Boolean)
                                            .join(" ")}
                                          key={block.id}
                                          style={
                                            {
                                              left: `calc(${startUnit} * var(--admcal-day-width) + 3px)`,
                                              width: `calc(${span} * var(--admcal-day-width) - 6px)`,
                                            } as CSSProperties
                                          }
                                          title={`${copy.blockedRoom} · ${formatDateRangeShort(
                                            block.startDate,
                                            endExclusive,
                                            uiLocale,
                                          )}`}
                                        >
                                          {span >= 1.4 ? (
                                            <span className="admcal__block-text">{copy.blockedRoom}</span>
                                          ) : null}
                                        </div>
                                      );
                                    })}

                                  {roomReservations.map((reservation) => {
                                    const checkInDay = Number(reservation.checkInDate.slice(8));
                                    const checkOutDay = Number(reservation.checkOutDate.slice(8));
                                    const hasInternalNote = hasReservationNote(reservation.id);
                                    const startsBeforeMonth = reservation.checkInDate < `${selectedMonth}-01`;
                                    // Checkout ON the 1st of next month still occupies the whole last day of
                                    // THIS month, so it must clamp to the month-end edge. Using `>` here left
                                    // checkout==nextMonth-01 to fall through to `checkOutDay(=1) - 1 + 0.5`,
                                    // collapsing multi-night stays that end on the 1st into a 0.75 dot.
                                    const endsAfterMonth = reservation.checkOutDate >= `${nextMonth}-01`;
                                    const startUnit = startsBeforeMonth ? 0 : checkInDay - 1 + 0.5;
                                    const endUnit = endsAfterMonth ? dates.length : checkOutDay - 1 + 0.5;
                                    const span = Math.max(0.75, endUnit - startUnit);
                                    const statusStyle = STATUS_STYLE[reservation.status];
                                    const channelStyle = CHANNEL_STYLE[reservation.channel];
                                    return (
                                      <button
                                        className={[
                                          "admcal__bar",
                                          startsBeforeMonth ? "is-clamped-left" : "",
                                          endsAfterMonth ? "is-clamped-right" : "",
                                          statusStyle.dimmed ? "is-dimmed" : "",
                                          panelSelection?.type === "reservation" &&
                                          panelSelection.reservationId === reservation.id
                                            ? "is-selected"
                                            : "",
                                        ]
                                          .filter(Boolean)
                                          .join(" ")}
                                        key={reservation.id}
                                        onClick={() => openReservationPanel(reservation.id)}
                                        style={
                                          {
                                            "--admcal-bar-accent": channelStyle.accent,
                                            "--admcal-bar-background": channelStyle.background,
                                            "--acw-bar-tint": channelStyle.tint,
                                            "--admcal-status-dot": statusStyle.dot,
                                            left: `calc(${startUnit} * var(--admcal-day-width) + 3px)`,
                                            width: `calc(${span} * var(--admcal-day-width) - 6px)`,
                                          } as CSSProperties
                                        }
                                        aria-label={`${reservation.guestName} · ${buildChannelLabel(reservation.channel, dictionary)}`}
                                        title={`${reservation.guestName} · ${buildChannelLabel(
                                          reservation.channel,
                                          dictionary,
                                        )} · ${statusLabels[reservation.status]}`}
                                        type="button"
                                      >
                                        <span className="admcal__bar-dot" />
                                        {span >= 1.4 ? (
                                          <span className="admcal__bar-text">
                                            {reservation.guestName}
                                            {span >= 3.2 ? ` · ${guestShort(reservation)}` : ""}
                                          </span>
                                        ) : null}
                                        {hasInternalNote ? <Pencil className="acw-bar-note" aria-hidden="true" /> : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

          </>
        )}
      </>
    );
  };

  const renderTodayBoard = () => {
    const rangeShort = (r: { checkInDate: string; checkOutDate: string }) =>
      `${Number(r.checkInDate.slice(5, 7))}/${Number(r.checkInDate.slice(8))} – ${Number(r.checkOutDate.slice(5, 7))}/${Number(r.checkOutDate.slice(8))}`;
    const vacantTonight = Math.max(0, activeRoomCount - occupiedKeysToday.size - [...blockedRoomKeysToday].filter((key) => !occupiedKeysToday.has(key)).length);
    const kpis = [
      { label: copy.kpiArrivals, value: arrivalsToday.length, unit: copy.wUnitCount, sub: copy.wKpiToday },
      { label: copy.kpiDepartures, value: departuresToday.length, unit: copy.wUnitCount, sub: copy.wKpiToday },
      { label: copy.kpiSettingTargets, value: settingTargetsToday.length, unit: copy.wUnitCount, sub: copy.wKpiSettingSub },
      { label: copy.kpiInHouse, value: inHouseToday.length, unit: copy.wUnitRoom, sub: copy.wKpiTonight },
      { label: copy.wEmptyRow, value: vacantTonight, unit: copy.wUnitRoom, sub: copy.wKpiVacantSub.replace("{p}", String(occupancyPercent)), accent: true },
    ];
    const columns: Array<{ title: string; items: typeof arrivalsToday; empty: string; name: (r: (typeof arrivalsToday)[number]) => string; sub: (r: (typeof arrivalsToday)[number]) => string }> = [
      {
        title: copy.todayArrivalsTitle,
        items: arrivalsToday,
        empty: copy.wNone,
        name: (r) => r.guestName,
        sub: (r) =>
          copy.wStaySub
            .replace("{guests}", guestShort(r))
            .replace("{nights}", copy.nights(nightsBetween(r.checkInDate, r.checkOutDate)))
            .replace("{channel}", buildChannelLabel(r.channel, dictionary)),
      },
      {
        title: copy.todayDeparturesTitle,
        items: departuresToday,
        empty: copy.wNone,
        name: (r) => r.guestName,
        sub: (r) => copy.wDepartSub.replace("{guests}", guestShort(r)).replace("{range}", rangeShort(r)),
      },
      {
        title: copy.todaySettingTitle,
        items: settingTargetsToday,
        empty: copy.todaySettingEmpty,
        name: (r) => copy.wArriving.replace("{name}", r.guestName),
        sub: () => copy.wSettingSub,
      },
      {
        title: copy.todayInHouseTitle,
        items: inHouseToday,
        empty: copy.wNone,
        name: (r) => r.guestName,
        sub: (r) => copy.wUntil.replace("{date}", `${Number(r.checkOutDate.slice(5, 7))}/${Number(r.checkOutDate.slice(8))}`),
      },
    ];

    return (
      <>
        <div className="acw-kpis">
          {kpis.map((kpi) => (
            <div className="acw-kpi" key={kpi.label}>
              <span>{kpi.label}</span>
              <b className={`num${kpi.accent ? " is-accent" : ""}`}>
                {kpi.value}
                {kpi.unit ? <small>{kpi.unit}</small> : null}
              </b>
              <span>{kpi.sub}</span>
            </div>
          ))}
        </div>
        <div className="acw-cols">
          {columns.map((column) => (
            <section className="acw-col" key={column.title}>
              <div className="acw-col__h">
                <b>{column.title}</b>
                <span className="num">{column.items.length}</span>
              </div>
              {column.items.length === 0 ? (
                <p className="acw-col__empty">{column.empty}</p>
              ) : (
                column.items.map((reservation) => (
                  <button className="acw-row" key={reservation.id} onClick={() => openReservationPanel(reservation.id)} type="button">
                    <span className="acw-room">{roomLookup[reservation.roomKey]?.displayRoomLabel ?? reservation.roomLabel}</span>
                    <span className="acw-row__t">
                      <b>{column.name(reservation)}</b>
                      <span>
                        {selectedProperty ? "" : `${localizedPropertyName(reservation.propertyName)} · `}
                        {column.sub(reservation)}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </section>
          ))}
        </div>
      </>
    );
  };

  const renderRoomStatusBoard = () => {
    return (
      <>
        <div className="admcal__table-card">
          <table className="admcal__table">
            <thead>
              <tr>
                <th>{copy.room}</th>
                <th>{copy.roomStatus}</th>
                <th>{copy.currentGuest}</th>
                <th>{copy.nextReservation}</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map((group) => {
                if (selectedProperty && group.propertyName !== selectedProperty) return null;
                if (!group.blocked && group.rows.length === 0) return null;
                const groupRows = group.rows;
                return (
                  <FragmentRows
                    group={group}
                    groupRows={groupRows}
                    blockedRoomKeysToday={blockedRoomKeysToday}
                    inHouseToday={inHouseToday}
                    localizedPropertyName={localizedPropertyName}
                    onRoomClick={openRoomPanel}
                    reservations={activeReservations}
                    today={today}
                    copy={copy}
                    uiLocale={uiLocale}
                    key={group.propertyName}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderBuildingInfoBoard = () => {
    const cards = propertyOptions
      .filter((propertyName) => (selectedProperty ? propertyName === selectedProperty : true))
      .map((propertyName) => {
        const info = propertyDrafts[propertyName];
        const meta = buildingInfos.find((item) => item.canonicalName === propertyName) ?? null;
        const blocked = blockedProperties.find((item) => item.propertyName === propertyName) ?? null;
        return {
          blocked,
          info,
          meta,
          propertyName,
        };
      });

    return (
      <>
        <div className="acw-infos">
          {cards.map((card) => {
            const isEditing = editingBuilding === card.propertyName;
            if (card.blocked || !card.info || !card.meta) {
              return (
                <section className="admcal__info-card is-blocked" key={card.propertyName}>
                  <div className="admcal__info-head">
                    <div className="admcal__info-title">
                      <span className="admcal__info-icon">
                        <Lock className="size-4" />
                      </span>
                      <span>{localizedPropertyName(card.propertyName)}</span>
                    </div>
                    <span className="pill pill--muted">{copy.blockedProperty}</span>
                  </div>
                  <div className="admcal__info-empty">{copy.blockedPropertyHint}</div>
                </section>
              );
            }

            return (
              <section className="acw-info" key={card.propertyName}>
                <div className="acw-info__a">
                  <b>{localizedPropertyName(card.propertyName)}</b>
                  {isEditing ? (
                    <input
                      aria-label={copy.address}
                      className="admcal__input"
                      onChange={(event) =>
                        setPropertyDrafts((current) => ({
                          ...current,
                          [card.propertyName]: {
                            ...current[card.propertyName],
                            address: { ...current[card.propertyName].address, [uiLocale]: event.target.value },
                          },
                        }))
                      }
                      value={getPropertyAddress({ ...card.meta, address: card.info.address }, uiLocale)}
                    />
                  ) : (
                    <span className="acw-soft">{getPropertyAddress({ ...card.meta, address: card.info.address }, uiLocale)}</span>
                  )}
                  <span className="acw-info__links">
                    <a className="acw-link" href={card.info.googleMapsUrl} rel="noreferrer" target="_blank">
                      {copy.openMap}
                      <ExternalLink aria-hidden="true" />
                    </a>
                    {isEditing ? (
                      <>
                        <button
                          className="acw-link is-soft"
                          onClick={() => {
                            setEditingBuilding(null);
                            setPropertyDrafts(cloneBuildingInfos(buildingInfos));
                          }}
                          type="button"
                        >
                          {dictionary.common.cancel}
                        </button>
                        <button
                          className="acw-btn is-pri"
                          disabled={savingBuilding === card.propertyName}
                          onClick={() => void handleSaveBuildingInfo(card.propertyName)}
                          type="button"
                        >
                          {savingBuilding === card.propertyName ? <LoaderCircle className="size-4 animate-spin" /> : null}
                          {dictionary.common.save}
                        </button>
                      </>
                    ) : (
                      <button className="acw-link is-soft" onClick={() => setEditingBuilding(card.propertyName)} type="button">
                        {copy.wEdit}
                      </button>
                    )}
                  </span>
                </div>

                <div className="acw-info__b">
                  {card.info.sharedAccess.map((access) => {
                    const labels = buildAccessLabel(access, dictionary);
                    return (
                      <div className="acw-code" key={access.id}>
                        <span className="acw-k">
                          {labels.label}
                          {labels.note ? ` · ${labels.note}` : ""}
                        </span>
                        {isEditing ? (
                          <input
                            aria-label={labels.label}
                            className="admcal__code-input"
                            onChange={(event) =>
                              setPropertyDrafts((current) => ({
                                ...current,
                                [card.propertyName]: {
                                  ...current[card.propertyName],
                                  sharedAccess: current[card.propertyName].sharedAccess.map((item) =>
                                    item.id === access.id ? { ...item, code: event.target.value } : item,
                                  ),
                                },
                              }))
                            }
                            value={access.code}
                          />
                        ) : (
                          <CopyCode
                            big
                            code={access.code}
                            copiedLabel={copy.wCodeCopied}
                            label={copy.wCopyCode.replace("{label}", labels.label)}
                          />
                        )}
                      </div>
                    );
                  })}
                  <div className="acw-code">
                    <span className="acw-k">{copy.opsNote}</span>
                    {isEditing ? (
                      <textarea
                        aria-label={copy.opsNote}
                        className="admcal__textarea"
                        onChange={(event) =>
                          setPropertyDrafts((current) => ({
                            ...current,
                            [card.propertyName]: { ...current[card.propertyName], note: event.target.value },
                          }))
                        }
                        value={card.info.note}
                      />
                    ) : (
                      <span className={card.info.note ? "acw-note" : "acw-note is-dim"}>{card.info.note || copy.opsNotePlaceholder}</span>
                    )}
                  </div>
                </div>

                <div className="acw-info__c">
                  <span className="acw-k">{copy.wRoomCodes}</span>
                  {card.info.roomAccess.length === 0 ? (
                    <span className="acw-note is-dim">{copy.noRoomAccess}</span>
                  ) : (
                    <div className="acw-rcs">
                    {card.info.roomAccess.map((room) => (
                      <div className="acw-rc" key={room.roomLabel}>
                        <span className="acw-mono">{room.roomLabel}</span>
                        {isEditing ? (
                          <input
                            aria-label={room.roomLabel}
                            className="admcal__code-input"
                            onChange={(event) =>
                              setPropertyDrafts((current) => ({
                                ...current,
                                [card.propertyName]: {
                                  ...current[card.propertyName],
                                  roomAccess: current[card.propertyName].roomAccess.map((item) =>
                                    item.roomLabel === room.roomLabel ? { ...item, code: event.target.value } : item,
                                  ),
                                },
                              }))
                            }
                            value={room.code}
                          />
                        ) : (
                          room.code ? (
                            <CopyCode
                              code={room.code}
                              copiedLabel={copy.wCodeCopied}
                              label={copy.wCopyCode.replace("{label}", room.roomLabel)}
                            />
                          ) : (
                            <span className="acw-soft">{copy.none}</span>
                          )
                        )}
                      </div>
                    ))}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <div className="admcal acw">
      {/* 화이트 리디자인(2026-10-14, 시안 Cal-PC · CalOps-PC · CalRooms-PC · CalInfo-PC · CalDetail-PC):
          위 숫자 카드 다섯은 「오늘 운영」 보기 맨 위로 옮겼다. 한 줄 = 보기 탭 · (월간) 달 이동 · 건물 · (월간) 채널 · 인쇄 · 방금 갱신. */}
      <div className="acw-bar">
        <div className="lviews" role="tablist" aria-label={copy.monthView} style={{ margin: 0 }}>
          {viewTabs.map((tab) => (
            <button
              aria-selected={activeView === tab.key}
              className={activeView === tab.key ? "on" : ""}
              key={tab.key}
              onClick={() => {
                setActiveView(tab.key);
                setIsPanelVisible(false);
                setPanelSelection(null);
              }}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeView === "month" ? (
          <div className="acw-month">
            <Link aria-label={copy.prevMonth} className="acw-ib" href={buildCalendarHref(prevMonth, selectedProperty)}>
              <ChevronLeft aria-hidden="true" />
            </Link>
            <span className="acw-month__label num">{buildMonthLabel(selectedMonth, uiLocale)}</span>
            <Link aria-label={copy.nextMonth} className="acw-ib" href={buildCalendarHref(nextMonth, selectedProperty)}>
              <ChevronRight aria-hidden="true" />
            </Link>
            {selectedMonth !== currentMonth ? (
              <Link className="acw-link" href={buildCalendarHref(currentMonth, selectedProperty)}>
                {copy.thisMonth}
              </Link>
            ) : null}
          </div>
        ) : activeView !== "info" ? (
          <span className="acw-soft num">{copy.wTodayLine.replace("{date}", formatFullDate(today, uiLocale))}</span>
        ) : (
          <span className="acw-soft">{copy.wInfoHint}</span>
        )}

        <span className="acw-sp" />
        <AdmDropdown
          size="sm"
          ariaLabel={copy.wPropertyAria}
          value={selectedProperty ?? ""}
          onChange={(value) => router.push(buildCalendarHref(selectedMonth, value || null), { scroll: false })}
          options={[
            { value: "", label: copy.wAllProperties },
            ...propertyOptions.map((propertyName) => ({ value: propertyName, label: localizedPropertyName(propertyName) })),
          ]}
        />
        {activeView === "month" ? (
          <>
            <AdmDropdown
              size="sm"
              ariaLabel={copy.wChannelAria}
              value={channelFilter}
              onChange={(value) => setChannelFilter(value as ReservationChannel | "all")}
              options={channelOptions}
            />
            <Link className="acw-chip" href={buildCalendarPrintHref(selectedMonth, selectedProperty)} target="_blank">
              <Printer aria-hidden="true" />
              {copy.wPrint}
            </Link>
          </>
        ) : null}
        {beds24SyncPaused ? (
          <span className="acw-fresh is-paused">
            <i aria-hidden="true" />
            {copy.syncPausedLabel}
          </span>
        ) : (
          <button
            aria-label={copy.wFreshAria}
            className={`acw-fresh${isRefreshing ? " is-spin" : ""}`}
            onClick={handleSyncRefresh}
            title={copy.wFreshAria}
            type="button"
          >
            <i aria-hidden="true" />
            {copy.wFresh}
            <RefreshCw aria-hidden="true" />
          </button>
        )}
      </div>

      {activeView === "month" && renderMonthView()}
      {activeView === "today" && renderTodayBoard()}
      {activeView === "rooms" && renderRoomStatusBoard()}
      {activeView === "info" && renderBuildingInfoBoard()}

      <div className={`admcal__panel-scrim${isPanelVisible ? " is-visible" : ""}`} onClick={closePanel} />

      <aside
        aria-hidden={!isPanelVisible}
        aria-label={panelReservation?.guestName ?? panelRoom?.displayRoomLabel ?? copy.closePanel}
        aria-modal={isPanelVisible || undefined}
        className={`admcal__panel${isPanelVisible ? " is-visible" : ""}`}
        role="dialog"
      >
        {panelReservation ? (
          <ReservationPanel
            beds24Id={panelReservation.beds24Id}
            channelLabel={buildChannelLabel(panelReservation.channel, dictionary)}
            channelStyle={CHANNEL_STYLE[panelReservation.channel]}
            copy={copy}
            note={reservationNotes[panelReservation.id] ?? ""}
            onChangeNote={(value) =>
              setReservationNotes((current) => ({ ...current, [panelReservation.id]: value }))
            }
            onClose={closePanel}
            onCopyBeds24Id={async () => {
              try {
                await copyText(panelReservation.beds24Id);
                showToast(copy.beds24CopiedToast);
              } catch {
                showToast(copy.copyFailedToast, true);
              }
            }}
            onCopyPhone={async () => {
              const phone = panelReservation.phone ?? ""; // try 안의 ?? 는 React Compiler 가 거부한다
              try {
                await copyText(phone);
                showToast(copy.wPhoneCopied);
              } catch {
                showToast(copy.copyFailedToast, true);
              }
            }}
            onLinkedAction={(kind) => router.push(buildLinkedActionHref(kind, panelReservation.id))}
            onSaveNote={async (value) => {
              const result = await saveReservationInternalNoteAction(panelReservation.id, value);
              if (!result.ok) {
                showToast(copy.internalNoteSaveFailedToast, true);
                return;
              }

              setReservationNotes((current) => ({
                ...current,
                [panelReservation.id]: result.note,
              }));
              showToast(copy.internalNoteSavedToast);
            }}
            reservation={panelReservation}
            roomLabel={panelReservation.roomLabel}
            propertyLabel={localizedPropertyName(panelReservation.propertyName)}
            uiLocale={uiLocale}
          />
        ) : null}

        {panelRoom ? (
          <RoomPanel
            copy={copy}
            onClose={closePanel}
            onOpenReservation={openReservationPanel}
            propertyLabel={localizedPropertyName(panelRoom.propertyName)}
            reservations={activeReservations}
            room={panelRoom}
            today={today}
            uiLocale={uiLocale}
          />
        ) : null}
      </aside>

      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}

function ReservationPanel({
  beds24Id,
  channelLabel,
  channelStyle,
  copy,
  note,
  onChangeNote,
  onClose,
  onCopyBeds24Id,
  onCopyPhone,
  onLinkedAction,
  onSaveNote,
  propertyLabel,
  reservation,
  roomLabel,
  uiLocale,
}: {
  beds24Id: string;
  channelLabel: string;
  channelStyle: { accent: string; background: string; badge: string };
  copy: ReturnType<typeof getDictionary>["admin"]["calendar"];
  note: string;
  onChangeNote: (value: string) => void;
  onClose: () => void;
  onCopyBeds24Id: () => void;
  onCopyPhone: () => void;
  onLinkedAction: (kind: "maintenance" | "complaint" | "lost") => void;
  onSaveNote: (value: string) => Promise<void>;
  propertyLabel: string;
  reservation: AdminReservationConsoleProps["reservations"][number];
  roomLabel: string;
  uiLocale: Locale;
}) {
  // 성인 · 어린이를 나눠 보인다 — 판매 캘린더와 같은 표기(2026-10-05). 성인 수를 모르는 예약만 합계.
  const guestCountLabel =
    reservation.adults !== null
      ? reservation.children
        ? copy.guestBreakdown
            .replace("{adults}", String(reservation.adults))
            .replace("{children}", String(reservation.children))
        : copy.guestBreakdown.replace("{adults}", String(reservation.adults)).split(" · ")[0]
      : reservation.guestCount === null
        ? copy.guestCountUnknown
        : copy.guestCount(reservation.guestCount);

  const nights = copy.nights(nightsBetween(reservation.checkInDate, reservation.checkOutDate));
  const phoneText = formatPhoneDisplay(reservation.phone);
  const tel = phoneHref(reservation.phone);

  // 화이트 리디자인(2026-10-14, 시안 CalDetail-PC): 채널 · 예약번호 → 이름 → 체크인/체크아웃 → 연락처 → 내부 메모 → 이 예약으로 등록.
  return (
    <div className="admcal__panel-inner acw-panel">
      <div className="acw-ph">
        <span className="acw-kick">
          <i style={{ background: channelStyle.accent }} />
          {channelLabel} · {copy.wResNo} <span className="acw-mono">{beds24Id}</span>
          <button aria-label={copy.wCopyResNo} className="acw-ib is-sm" onClick={onCopyBeds24Id} title={copy.wCopyResNo} type="button">
            <Copy aria-hidden="true" />
          </button>
        </span>
        <button aria-label={copy.wClose} className="acw-ib acw-ph__x" onClick={onClose} type="button">
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="admcal__panel-body acw-pb">
        <div className="acw-who">
          <h2>{reservation.guestName}</h2>
          <span>
            {propertyLabel} · <b className="acw-mono">{roomLabel}</b> · {guestCountLabel}
          </span>
        </div>

        <div className="acw-stay">
          <div>
            <span className="acw-k">{copy.checkIn}</span>
            <b>{formatFullDate(reservation.checkInDate, uiLocale)}</b>
            <span className="acw-soft">{copy.wFromTime.replace("{time}", DEFAULT_CHECK_IN_TIME)}</span>
          </div>
          <div>
            <span className="acw-k">{copy.checkOut}</span>
            <b>{formatFullDate(reservation.checkOutDate, uiLocale)}</b>
            <span className="acw-soft">{copy.wUntilTime.replace("{time}", DEFAULT_CHECK_OUT_TIME).replace("{nights}", nights)}</span>
          </div>
        </div>

        <div className="acw-phone">
          <span className={`num${phoneText ? "" : " acw-soft"}`}>{phoneText || copy.wPhoneMissing}</span>
          {reservation.phone ? (
            <>
              <button aria-label={copy.wCopyPhone} className="acw-sq" onClick={onCopyPhone} title={copy.wCopyPhone} type="button">
                <Copy aria-hidden="true" />
              </button>
              {tel ? (
                <a aria-label={copy.wCall} className="acw-sq is-pri" href={tel} title={copy.wCall}>
                  <Phone aria-hidden="true" />
                </a>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="acw-nf">
          <label htmlFor="acw-note">{copy.internalNote}</label>
          <textarea
            id="acw-note"
            onChange={(event) => onChangeNote(event.target.value)}
            onBlur={(event) => {
              startTransition(() => {
                void onSaveNote(event.target.value);
              });
            }}
            placeholder={copy.internalNotePlaceholder}
            rows={3}
            value={note}
          />
          <span>{copy.wNoteHint}</span>
        </div>

        <div className="acw-links">
          <span className="acw-k">{copy.wRegister}</span>
          <span>
            <button className="acw-link" onClick={() => onLinkedAction("maintenance")} type="button">
              {copy.linkMaintenance}
            </button>
            <button className="acw-link" onClick={() => onLinkedAction("complaint")} type="button">
              {copy.linkComplaint}
            </button>
            <button className="acw-link" onClick={() => onLinkedAction("lost")} type="button">
              {copy.linkLostFound}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function RoomPanel({
  copy,
  onClose,
  onOpenReservation,
  propertyLabel,
  reservations,
  room,
  today,
  uiLocale,
}: {
  copy: ReturnType<typeof getDictionary>["admin"]["calendar"];
  onClose: () => void;
  onOpenReservation: (reservationId: string) => void;
  propertyLabel: string;
  reservations: AdminReservationConsoleProps["reservations"];
  room: AdminReservationConsoleProps["roomRows"][number];
  today: string;
  uiLocale: Locale;
}) {
  const currentGuest =
    reservations.find(
      (reservation) =>
        reservation.roomKey === room.key &&
        reservation.checkInDate <= today &&
        reservation.checkOutDate > today,
    ) ?? null;
  const nextReservation =
    reservations
      .filter((reservation) => reservation.roomKey === room.key && reservation.checkInDate > today)
      .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))[0] ?? null;

  return (
    <div className="admcal__panel-inner">
      <div className="admcal__panel-header">
        <div className="admcal__panel-kicker">
          {copy.roomStatusView} · {propertyLabel}
        </div>
        <button className="admcal__panel-close" onClick={onClose} type="button">
          <X className="size-4" />
        </button>
        <div className="admcal__panel-title">{room.displayRoomLabel}</div>
        <div className="admcal__panel-subtitle">{propertyLabel}</div>
      </div>

      <div className="admcal__panel-body">
        <section className="admcal__panel-section">
          <div className="admcal__section-title">{copy.currentGuest}</div>
          {currentGuest ? (
            <button className="admcal__linked-card" onClick={() => onOpenReservation(currentGuest.id)} type="button">
              <div className="admcal__linked-card-title">{currentGuest.guestName}</div>
              <div className="admcal__linked-card-body">
                {copy.checkIn}: {formatShortDate(currentGuest.checkInDate, uiLocale)} · {copy.checkOut}:{" "}
                {formatShortDate(currentGuest.checkOutDate, uiLocale)}
              </div>
            </button>
          ) : (
            <div className="admcal__linked-empty">{copy.statusVacant}</div>
          )}
        </section>

        <section className="admcal__panel-section">
          <div className="admcal__section-title">{copy.nextReservation}</div>
          {nextReservation ? (
            <button className="admcal__linked-card" onClick={() => onOpenReservation(nextReservation.id)} type="button">
              <div className="admcal__linked-card-title">{nextReservation.guestName}</div>
              <div className="admcal__linked-card-body">
                {copy.checkIn}: {formatShortDate(nextReservation.checkInDate, uiLocale)} · {copy.checkOut}:{" "}
                {formatShortDate(nextReservation.checkOutDate, uiLocale)}
              </div>
            </button>
          ) : (
            <div className="admcal__linked-empty">{copy.noNextReservation}</div>
          )}
        </section>
      </div>

      <div className="admcal__panel-footer">
        <button className="admcal__subtle-btn is-full" onClick={onClose} type="button">
          {copy.closePanel}
        </button>
      </div>
    </div>
  );
}

function FragmentRows({
  copy,
  blockedRoomKeysToday,
  group,
  groupRows,
  inHouseToday,
  localizedPropertyName,
  onRoomClick,
  reservations,
  today,
  uiLocale,
}: {
  blockedRoomKeysToday: Set<string>;
  copy: ReturnType<typeof getDictionary>["admin"]["calendar"];
  group: {
    blocked: AdminReservationConsoleProps["blockedProperties"][number] | null;
    propertyName: string;
    rows: AdminReservationConsoleProps["roomRows"];
  };
  groupRows: AdminReservationConsoleProps["roomRows"];
  inHouseToday: AdminReservationConsoleProps["reservations"];
  localizedPropertyName: (propertyName: string) => string;
  onRoomClick: (roomKey: string) => void;
  reservations: AdminReservationConsoleProps["reservations"];
  today: string;
  uiLocale: Locale;
}) {
  return (
    <>
      <tr className="admcal__table-group">
        <td colSpan={4}>
          <span className="admcal__table-group-title">
            {localizedPropertyName(group.propertyName)}
            {group.blocked ? null : (
              <small className="num">
                {copy.wRoomsGroupMeta
                  .replace("{n}", String(groupRows.length))
                  .replace(
                    "{v}",
                    String(
                      groupRows.filter(
                        (room) =>
                          !inHouseToday.some((r) => r.roomKey === room.key) && !blockedRoomKeysToday.has(room.key),
                      ).length,
                    ),
                  )
                  .replace("{i}", String(groupRows.filter((room) => reservations.some((r) => r.roomKey === room.key && r.checkInDate === today)).length))
                  .replace("{o}", String(groupRows.filter((room) => reservations.some((r) => r.roomKey === room.key && r.checkOutDate === today)).length))}
              </small>
            )}
          </span>
        </td>
      </tr>
      {group.blocked ? (
        <tr>
          <td>{copy.blockedProperty}</td>
          <td>
            <span className="pill pill--muted">{copy.blockedProperty}</span>
          </td>
          <td colSpan={2}>{copy.blockedPropertyHint}</td>
        </tr>
      ) : (
        groupRows.map((room) => {
          const currentGuest =
            inHouseToday.find((reservation) => reservation.roomKey === room.key) ?? null;
          const departing =
            reservations.find((reservation) => reservation.roomKey === room.key && reservation.checkOutDate === today) ?? null;
          const hasDeparture = Boolean(departing);
          const hasArrival = reservations.some(
            (reservation) =>
              reservation.roomKey === room.key && reservation.checkInDate === today,
          );
          const nextReservation =
            reservations
              .filter(
                (reservation) =>
                  reservation.roomKey === room.key && reservation.checkInDate > today,
              )
              .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))[0] ?? null;

          let statusClass = "pill pill--muted";
          let statusText = copy.statusVacant;

          if (currentGuest) {
            statusClass = "pill pill--done";
            statusText = copy.statusOccupied;
          } else if (blockedRoomKeysToday.has(room.key)) {
            // 물리적으로는 비어 있지만 팔 수 없다. 「빈 객실」보다 「차단」이 더 구체적인
            // 정보라 이쪽을 보여준다. 투숙 중이면 손님이 먼저다.
            statusClass = "pill pill--muted";
            statusText = copy.blockedRoom;
          } else if (hasDeparture) {
            statusClass = "pill pill--warn";
            statusText = copy.statusCleaningDue;
          } else if (hasArrival) {
            statusClass = "pill pill--info";
            statusText = copy.statusArrivingToday;
          }

          return (
            <tr className="admcal__table-row" key={room.key}>
              <td>
                <button className="admcal__table-link" onClick={() => onRoomClick(room.key)} type="button">
                  {room.displayRoomLabel}
                </button>
              </td>
              <td>
                <span className={statusClass}>{statusText}</span>
              </td>
              <td>
                {currentGuest ? (
                  <div className="admcal__cell-stack">
                    <span>{currentGuest.guestName}</span>
                    <span>{formatDateRangeShort(currentGuest.checkInDate, currentGuest.checkOutDate, uiLocale)}</span>
                  </div>
                ) : departing ? (
                  <span className="admcal__info-muted">{copy.wLeavingToday.replace("{name}", departing.guestName)}</span>
                ) : (
                  <span className="admcal__info-muted">{copy.none}</span>
                )}
              </td>
              <td>
                {nextReservation ? (
                  <div className="admcal__cell-stack">
                    <span>{nextReservation.guestName}</span>
                    <span>{formatDateRangeShort(nextReservation.checkInDate, nextReservation.checkOutDate, uiLocale)}</span>
                  </div>
                ) : (
                  <span className="admcal__info-muted">{copy.noNextReservation}</span>
                )}
              </td>
            </tr>
          );
        })
      )}
    </>
  );
}

/**
 * 출입 코드 복사 — 화이트 리디자인(2026-10-14, 사용자 요청 · 시안 CalInfo-PC). 코드를 누르면 복사되고 그 자리가 1.6초 「✓ 복사됨」(체크 그리기).
 * 따로 알림 창을 띄우지 않는다 — 누른 자리에서 결과가 보인다.
 */
function CopyCode({ code, label, copiedLabel, big = false }: { code: string; label: string; copiedLabel: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      aria-label={label}
      className={`acw-copy${big ? " is-big" : ""}${copied ? " is-done" : ""}`}
      onClick={() => {
        copyText(code)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
      title={label}
      type="button"
    >
      {copied ? (
        <span className="acw-copy__done" role="status">
          <Check aria-hidden="true" strokeWidth={2.4} />
          {copiedLabel}
        </span>
      ) : (
        <>
          <span className="acw-mono">{code}</span>
          <Copy aria-hidden="true" className="acw-copy__ic" />
        </>
      )}
    </button>
  );
}
