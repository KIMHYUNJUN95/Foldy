"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIEvent } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, Pencil, Phone } from "lucide-react";
import "./mobile-calendar.css";
import { collectBlockedRooms } from "@/lib/room-blocks";
import { type PropertyMapMeta, getPropertyAddress } from "@/lib/property-map-links";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet } from "@/components/shell/split-list";
import { BuildingPicker } from "@/components/calendar/building-picker";
import type { Dictionary, Locale } from "@/lib/i18n";
import { formatPhoneDisplay } from "@/lib/phone-format";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

export type CalendarReservationItem = {
  checkInDate: string;
  checkOutDate: string;
  guestCount: number | null;
  /** 성인 · 어린이 — 성인 수를 모르면 `null`(합계만 보인다). */
  adults: number | null;
  children: number | null;
  guestName: string;
  id: string;
  internalNote: string | null;
  phone: string | null;
  propertyName: string;
  roomLabel: string;
  source: string;
  sourceReservationId: string;
  status: "cancelled" | "checked_in" | "checked_out" | "confirmed" | "no_show";
};

type MobileCalendarViewProps = {
  /** 화이트 리디자인(2026-10-14) 문구 묶음 — `dictionary.mobile.calendarW`. */
  wcopy: Dictionary["mobile"]["calendarW"];
  copy: {
    calendar: string;
    calendarBuildingChange: string;
    calendarBuildingHotelLabel: string;
    calendarBuildingHouseLabel: string;
    calendarBuildingPickerBody: string;
    calendarTokyoNowLabel: string;
    calendarMapBuildingCount: string;
    legendDirect: string;
    calendarBuildingPickerTitle: string;
    call: string;
    checkInLabel: string;
    checkOutLabel: string;
    checkIns: string;
    checkOuts: string;
    close: string;
    copyNumber: string;
    copied: string;
    emptyAccuracyHint: string;
    calendarOutOfWindowBody: string;
    calendarOutOfWindowTitle: string;
    emptyToday: string;
    filterAll: string;
    listView: string;
    mapTab: string;
    mapAccessSheetTitle: string;
    mapAddressLabel: string;
    mapAddressCopy: string;
    mapAddressMissing: string;
    mapAccessFloor1: string;
    mapAccessKindDoorPassword: string;
    mapAccessKindKeyBox: string;
    mapAccessKindKeyBoxPassword: string;
    mapAccessKindLinenStorageEntrancePassword: string;
    mapAccessKindRoomPassword: string;
    mapAccessKindStorage: string;
    mapAccessKindStoragePassword: string;
    mapAccessNoteAllRoomsSame: string;
    mapCopiedAddress: string;
    mapCopiedCode: string;
    mapOpenAccess: string;
    mapOpenInMaps: string;
    mapOpenRoomAccess: string;
    mapOpenSharedAccess: string;
    mapRoomAccessLabel: string;
    mapSharedAccessLabel: string;
    mapNoAccessData: string;
    noFilterResults: string;
    noEmptyRooms: string;
    blockedRoom: string;
    internalNote: string;
    internalNoteEmpty: string;
    opsNote: string;
    opsNoteEmpty: string;
    phone: string;
    phoneMissing: string;
    listReferenceDate: string;
    emptyRoomsModalTitle: string;
    guestCountLabel: string;
    guestCountUnit: string;
    guestCountUnknown: string;
    /** 「성인 {adults} · 어린이 {children}」 — 판매 캘린더와 같은 표기(2026-10-05). */
    guestBreakdown: string;
    propertyLabel: string;
    reservationId: string;
    roomLabel: string;
    stayingToday: string;
    today: string;
  };
  // Computed server-side: true when selectedMonth is outside the 2-month operational window.
  // Passed as a prop to avoid recomputing on the client and to keep a single source of truth.
  isOutOfWindow: boolean;
  buildingInfos: PropertyMapMeta[];
  locale: Locale;
  reservations: CalendarReservationItem[];
  /** Beds24 캘린더 블락. 예약과 별개 통로로 들어온다(인벤토리 오버라이드). */
  roomBlocks: CalendarRoomBlock[];
  // When populated with room labels from the room master table, Empty today switches
  // to an authoritative count. Leave undefined while the rooms table does not exist.
  roomMasterRooms?: string[];
  propertyRoomsMap?: Record<string, string[]>;
  roomSourceDebug?: {
    activeRoomLabels: string[];
    fetchWindow?: { from: string; to: string };
    mode: "authoritative_active" | "authoritative_zero" | "provisional";
    reservationsQuery?: "executed" | "skipped";
  } | null;
  selectedMonth: string;
  selectedMonthLabel: string;
  propertyOptions: string[];
  propertyLabelMap: Record<string, string>;
  selectedProperty: string | null;
  statusLabels: Record<CalendarReservationItem["status"], string>;
  today: string;
  initialReservationId?: string | null;
};

const DAY_WIDTH = 34;
const ROOM_LABEL_WIDTH = 64;
const CALENDAR_BAR_HEIGHT = 32;
const CALENDAR_BAR_TOP = 8;
/** Compact vertical offset per lane -> keeps all bars within the fixed row height. */
const CALENDAR_COMPACT_LANE_OFFSET = 4;
const CALENDAR_SINGLE_ROW_HEIGHT = 48;
const DEFAULT_CHECK_IN_TIME = "16:00";
const DEFAULT_CHECK_OUT_TIME = "10:00";

type ReservationBarBounds = {
  leftPx: number;
  rightPx: number;
  widthPx: number;
};

type ReservationBarLayout = ReservationBarBounds & {
  id: string;
  item: CalendarReservationItem;
  laneIndex: number;
};

/**
 * Beds24 캘린더에서 막아 둔 구간 (2026-09-11).
 * `startDate`~`endDate` 는 **막힌 밤의 범위이며 양끝 포함**이다. 예약과 겹칠 수 있다.
 */
export type CalendarRoomBlock = {
  endDate: string;
  id: string;
  /** 정규 건물 이름 — 다른 건물의 같은 방 번호(「201」)에 블락이 그려지지 않게 고른 건물로 거른다(2026-10-26). */
  propertyName: string;
  roomLabel: string;
  startDate: string;
};

/** 막힌 마지막 밤 다음 날 = 같은 구간을 예약으로 봤을 때의 체크아웃 날짜. */
/** 날짜 키는 UTC 자정 기준이라 UTC 메서드로 더한다(`addDays`) — 로컬 `getDate` 는 UTC 보다 늦은 기기 시간대에서 하루 밀린다(2026-10-26). */
function blockCheckOutDate(endDate: string) {
  return addDays(endDate, 1);
}

function computeReservationBarBounds(
  item: CalendarReservationItem,
  rangeStart: string,
  rangeEndExclusive: string,
  datesLength: number,
): ReservationBarBounds {
  const checkInVisible = item.checkInDate >= rangeStart;
  const checkOutVisible = item.checkOutDate < rangeEndExclusive;

  const msPerDay = 86400000;
  const rangeStartMs = parseDate(rangeStart).getTime();

  const leftPx = checkInVisible
    ? ((parseDate(item.checkInDate).getTime() - rangeStartMs) / msPerDay) * DAY_WIDTH +
      DAY_WIDTH / 2
    : 0;

  const rightPx = checkOutVisible
    ? ((parseDate(item.checkOutDate).getTime() - rangeStartMs) / msPerDay) * DAY_WIDTH +
      DAY_WIDTH / 2
    : datesLength * DAY_WIDTH;

  const widthPx = Math.max(DAY_WIDTH / 2, rightPx - leftPx);
  return {
    leftPx: roundCalendarPx(leftPx),
    rightPx: roundCalendarPx(rightPx),
    widthPx: roundCalendarPx(widthPx),
  };
}

function roundCalendarPx(value: number) {
  return Math.round(value * 100) / 100;
}

/** Half-open rendered interval -> turnover at equal boundary is non-overlapping. */
function reservationBarsOverlap(
  a: Pick<ReservationBarBounds, "leftPx" | "rightPx">,
  b: Pick<ReservationBarBounds, "leftPx" | "rightPx">,
) {
  return a.leftPx < b.rightPx && b.leftPx < a.rightPx;
}

function assignReservationLanes(
  items: CalendarReservationItem[],
  rangeStart: string,
  rangeEndExclusive: string,
  datesLength: number,
): { bars: ReservationBarLayout[] } {
  if (items.length === 0) {
    return { bars: [] };
  }

  const bars = items.map((item) => {
    const bounds = computeReservationBarBounds(item, rangeStart, rangeEndExclusive, datesLength);
    return { ...bounds, id: item.id, item };
  });

  const sorted = [...bars].sort((a, b) => {
    if (a.leftPx !== b.leftPx) return a.leftPx - b.leftPx;
    return a.rightPx - b.rightPx;
  });

  const lanes: Array<Array<Pick<ReservationBarBounds, "leftPx" | "rightPx">>> = [];
  const assigned: ReservationBarLayout[] = [];

  for (const bar of sorted) {
    let laneIndex = 0;
    for (; laneIndex < lanes.length; laneIndex += 1) {
      const overlaps = lanes[laneIndex].some((existing) =>
        reservationBarsOverlap(bar, existing),
      );
      if (!overlaps) break;
    }

    if (laneIndex === lanes.length) {
      lanes.push([]);
    }
    lanes[laneIndex].push({ leftPx: bar.leftPx, rightPx: bar.rightPx });
    assigned.push({ ...bar, laneIndex });
  }

  return { bars: assigned };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function calendarRowHeightForBars(_bars: ReservationBarLayout[]) {
  return CALENDAR_SINGLE_ROW_HEIGHT;
}
// Centered pinned modal card (reservation detail / empty room / area info).

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateLabel(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(parseDate(value));
}

function addDays(base: string, days: number) {
  const date = parseDate(base);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildRange(start: string, days: number) {
  return Array.from({ length: days }, (_, index) => addDays(start, index));
}

function normalizeSource(source: string) {
  const value = source.toLowerCase();
  if (value.includes("booking")) return "booking";
  if (value.includes("airbnb")) return "airbnb";
  return "other";
}

function reservationBarLabel(name: string, widthPx: number) {
  const trimmed = name.trim();
  if (widthPx < 34) return "";
  if (widthPx < 52) return trimmed.slice(0, 1);
  if (widthPx < 82) return trimmed.split(/\s+/)[0] ?? trimmed;
  return trimmed;
}

function toDialablePhone(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().replace(/[^\d+]/g, "");
  return normalized.length > 0 ? normalized : null;
}

async function copyText(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function sharedAccessLabel(
  item: PropertyMapMeta["sharedAccess"][number],
  copy: MobileCalendarViewProps["copy"],
) {
  const labelByKey: Record<PropertyMapMeta["sharedAccess"][number]["labelKey"], string> = {
    doorPassword: copy.mapAccessKindDoorPassword,
    keyBox: copy.mapAccessKindKeyBox,
    keyBoxPassword: copy.mapAccessKindKeyBoxPassword,
    linenStorageEntrancePassword: copy.mapAccessKindLinenStorageEntrancePassword,
    roomPassword: copy.mapAccessKindRoomPassword,
    storage: copy.mapAccessKindStorage,
    storagePassword: copy.mapAccessKindStoragePassword,
  };
  const label = labelByKey[item.labelKey];
  return item.prefixKey === "floor1" ? `${copy.mapAccessFloor1} ${label}` : label;
}

function sharedAccessCodeLabel(
  item: PropertyMapMeta["sharedAccess"][number],
  copy: MobileCalendarViewProps["copy"],
) {
  return item.noteKey === "allRoomsSame"
    ? `${item.code} (${copy.mapAccessNoteAllRoomsSame})`
    : item.code;
}

type ListTab = "in" | "out" | "stay" | "empty";

export function MobileCalendarView({
  wcopy,
  buildingInfos,
  copy,
  isOutOfWindow,
  locale,
  propertyOptions,
  propertyLabelMap,
  reservations,
  roomBlocks,
  roomMasterRooms,
  propertyRoomsMap,
  roomSourceDebug,
  selectedProperty: selectedPropertyProp,
  selectedMonth,
  selectedMonthLabel,
  today,
  initialReservationId,
}: MobileCalendarViewProps) {
  const searchParams = useSearchParams();
  // Resolve the active building from the live URL first, falling back to the server prop.
  // A soft client navigation (router.push) to /mobile/calendar may serve a prefetched/cached RSC
  // payload whose searchParams differ from the URL (e.g. the param-less building-picker payload),
  // leaving the server prop stale. The page fetches reservations/propertyRoomsMap/propertyOptions
  // independently of the selected property, so deriving it from the URL renders the grid correctly
  // without a manual refresh. Falls back to the prop on full document loads.
  const selectedProperty = useMemo(() => {
    const fromUrl = searchParams.get("property");
    if (fromUrl && propertyOptions.includes(fromUrl)) return fromUrl;
    return selectedPropertyProp;
  }, [searchParams, propertyOptions, selectedPropertyProp]);
  const isTablet = useIsTablet();
  const [isBuildingSheetOpen, setIsBuildingSheetOpen] = useState(false);
  const [listTab, setListTab] = useState<ListTab>("in");
  const [paneReservationId, setPaneReservationId] = useState<string | null>(null);
  const [paneMapName, setPaneMapName] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // 복사하면 그 자리가 1.6초 체크로 바뀐다(따로 알림 창 없음).
  const flashCopied = useCallback((key: string) => {
    // 복사는 서버 저장이 아니라 선택 동작 — success 가 아니라 light(햅틱 공용 규칙).
    haptic("light");
    setCopiedKey(key);
  }, []);
  useEffect(() => {
    if (!copiedKey) return;
    const timer = setTimeout(() => setCopiedKey(null), 1600);
    return () => clearTimeout(timer);
  }, [copiedKey]);
  const [mode, setMode] = useState<"overview" | "lists" | "map">("overview");
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);
  const [selectedMapProperty, setSelectedMapProperty] = useState<PropertyMapMeta | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [mapCopyFeedback, setMapCopyFeedback] = useState<string | null>(null);

  // 바탕 잠금은 두 시트(예약 상세 · 건물 지도) 모두 공용 BottomSheet 가 한다(2026-10-19). 여기서 따로 잠그면 잠금이 두 겹이
  // 되어, 닫을 때 바깥 잠금이 「잠긴 값」을 되돌려 바탕이 안 넘어갈 수 있었다(BottomSheet 의 참조 수 잠금 주석 참고).

  // isOutOfWindow is computed server-side and passed as a prop to keep a single source of truth.
  // Server already passes reservations=[] when out-of-window; this guard is a defensive layer.
  const effectiveReservations = useMemo(() => {
    const base = isOutOfWindow ? [] : reservations;
    if (!selectedProperty) return base;
    return base.filter((item) => item.propertyName === selectedProperty);
  }, [isOutOfWindow, reservations, selectedProperty]);

  const selectedReservation = useMemo(
    () => effectiveReservations.find((item) => item.id === selectedReservationId) ?? null,
    [effectiveReservations, selectedReservationId],
  );

  const rooms = useMemo(() => {
    const source =
      selectedProperty && propertyRoomsMap
        ? propertyRoomsMap[selectedProperty] ?? []
        : roomMasterRooms ?? [];
    return [...new Set(source)].sort();
  }, [roomMasterRooms, propertyRoomsMap, selectedProperty]);

  const rangeStart = `${selectedMonth}-01`;
  const daysInMonth = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }, [selectedMonth]);
  const dates = useMemo(() => buildRange(rangeStart, daysInMonth), [daysInMonth, rangeStart]);
  const [selectedYear, selectedMonthNumber] = selectedMonth.split("-").map(Number);
  const previousMonth = new Date(Date.UTC(selectedYear, selectedMonthNumber - 2, 1))
    .toISOString()
    .slice(0, 7);
  const nextMonth = new Date(Date.UTC(selectedYear, selectedMonthNumber, 1))
    .toISOString()
    .slice(0, 7);
  // Exclusive upper bound for bar width / overlap calculations.
  // Using the first day of next month (not the last day of this month) ensures the final
  // day column is fully included: a stay ending on 06-01 occupies all of 05-31.
  const rangeEndExclusive = `${nextMonth}-01`;
  const monthBaseParams = new URLSearchParams();
  if (selectedProperty) {
    monthBaseParams.set("property", selectedProperty);
  }
  const previousHref = new URLSearchParams(monthBaseParams);
  previousHref.set("month", previousMonth);
  const nextHref = new URLSearchParams(monthBaseParams);
  nextHref.set("month", nextMonth);
  const buildingPickerHref = new URLSearchParams();
  buildingPickerHref.set("month", selectedMonth);
  const getPropertyCalendarHref = (property: string) => {
    const params = new URLSearchParams();
    params.set("month", selectedMonth);
    params.set("property", property);
    return `/mobile/calendar?${params.toString()}`;
  };

  const activeInRange = useMemo(
    () =>
      effectiveReservations.filter(
        (item) => item.checkInDate < rangeEndExclusive && item.checkOutDate > rangeStart,
      ),
    [effectiveReservations, rangeEndExclusive, rangeStart],
  );

  // 고른 건물의 블락만 — 방 축이 표시 라벨(「201」)뿐이라 건물로 거르지 않으면 다른 건물의 같은 번호 방에도 그려진다
  // (관리자 캘린더는 `건물::방` 키로 맞춘다, 2026-10-26). 건물을 안 고른 화면은 블락을 쓰지 않는다.
  const scopedRoomBlocks = useMemo(
    () => (selectedProperty ? roomBlocks.filter((block) => block.propertyName === selectedProperty) : []),
    [roomBlocks, selectedProperty],
  );

  const byRoom = useMemo(() => {
    const map = new Map<string, CalendarReservationItem[]>();
    for (const room of rooms) {
      map.set(room, []);
    }
    for (const item of activeInRange) {
      map.get(item.roomLabel)?.push(item);
    }
    return map;
  }, [activeInRange, rooms]);

  const roomBarLayouts = useMemo(() => {
    const layouts = new Map<string, { bars: ReservationBarLayout[]; rowHeight: number }>();
    for (const room of rooms) {
      const items = byRoom.get(room) ?? [];
      const { bars } = assignReservationLanes(
        items,
        rangeStart,
        rangeEndExclusive,
        dates.length,
      );
      layouts.set(room, { bars, rowHeight: calendarRowHeightForBars(bars) });
    }
    return layouts;
  }, [byRoom, dates.length, rangeEndExclusive, rangeStart, rooms]);

  // 블락을 방별로 모아 둔다. 예약 막대와 같은 계산기를 쓰되(눈금이 어긋나면 안 된다) 막힌
  // 마지막 밤 다음 날을 체크아웃으로 넘긴다 — 블락은 양끝 포함, 예약은 체크아웃 제외이기 때문.
  const blockBarsByRoom = useMemo(() => {
    const map = new Map<string, Array<{ block: CalendarRoomBlock; leftPx: number; widthPx: number }>>();
    for (const block of scopedRoomBlocks) {
      const checkOutDate = blockCheckOutDate(block.endDate);
      if (block.startDate >= rangeEndExclusive || checkOutDate <= rangeStart) continue;
      const bounds = computeReservationBarBounds(
        { checkInDate: block.startDate, checkOutDate } as CalendarReservationItem,
        rangeStart,
        rangeEndExclusive,
        dates.length,
      );
      const bucket = map.get(block.roomLabel);
      const entry = { block, leftPx: bounds.leftPx, widthPx: bounds.widthPx };
      if (bucket) bucket.push(entry);
      else map.set(block.roomLabel, [entry]);
    }
    return map;
  }, [dates.length, rangeEndExclusive, rangeStart, scopedRoomBlocks]);


  // today is passed from server (Asia/Tokyo) -> never recompute on client
  // findIndex (not indexOf) makes the "date === today" predicate explicit
  const todayIndex = dates.findIndex((date) => date === today);
  const isTodayInView = todayIndex !== -1;
  // Lists mode always uses the real operational "today" snapshot, regardless of selectedMonth.
  const listReferenceDate = today;

  const activeRoomSet = useMemo(() => new Set(rooms), [rooms]);
  const activeReservations = useMemo(
    () => effectiveReservations.filter((item) => activeRoomSet.has(item.roomLabel)),
    [effectiveReservations, activeRoomSet],
  );
  const checkInsToday = useMemo(
    () => activeReservations.filter((item) => item.checkInDate === listReferenceDate),
    [activeReservations, listReferenceDate],
  );
  const checkOutsToday = useMemo(
    () => activeReservations.filter((item) => item.checkOutDate === listReferenceDate),
    [activeReservations, listReferenceDate],
  );
  const stayingToday = useMemo(
    () =>
      activeReservations.filter(
        (item) => item.checkInDate <= listReferenceDate && item.checkOutDate > listReferenceDate,
      ),
    [activeReservations, listReferenceDate],
  );
  const emptyRoomLabels = useMemo(() => {
    const occupiedRoomSet = new Set(stayingToday.map((item) => item.roomLabel));
    return rooms.filter((room) => !occupiedRoomSet.has(room));
  }, [rooms, stayingToday]);

  /**
   * 기준일에 막혀 있는 방.
   *
   * **「오늘 빈 객실」 수에서 빼지는 않는다.** 그 숫자는 「물리적으로 비어 있는 방」이고 블락은
   * 판매만 막은 것이라 방 자체는 비어 있다 — 빼면 청소·점검 인원이 보는 숫자가 달라진다.
   * 대신 목록에서 「차단」으로 표시해, 팔 수 있는 방으로 착각하지 않게 한다.
   */
  const blockedRoomsAtReference = useMemo(
    () => collectBlockedRooms(scopedRoomBlocks, listReferenceDate, (block) => block.roomLabel),
    [listReferenceDate, scopedRoomBlocks],
  );

  // 날짜별 「빈 방」 수(머리 줄) — 렌더마다 날짜 × 예약을 다시 돌지 않게 한 번만 센다(2026-10-26).
  const emptyCountByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const date of dates) {
      const occupied = new Set<string>();
      for (const item of activeInRange) {
        if (item.checkInDate <= date && item.checkOutDate > date) occupied.add(item.roomLabel);
      }
      const blocked = collectBlockedRooms(scopedRoomBlocks, date, (block) => block.roomLabel);
      counts.set(date, rooms.filter((room) => !occupied.has(room) && !blocked.has(room)).length);
    }
    return counts;
  }, [activeInRange, dates, rooms, scopedRoomBlocks]);

  // Auto-scroll: bring today (and the day before) into view on first entry per month/property.
  // Uses a Set so each selectedMonth+selectedProperty combo scrolls at most once per session.
  // mode is in the dependency array so the effect re-runs when overview panel mounts.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastDateLabelRef = useRef<string | null>(null);
  const autoScrolledKeys = useRef(new Set<string>());
  const [visibleDateRangeLabel, setVisibleDateRangeLabel] = useState<string | null>(null);

  const updateVisibleDateRangeLabel = useCallback(
    (scrollLeft: number, clientWidth: number) => {
      let label: string | null = null;
      if (dates.length > 0) {
        const startIndex = Math.max(0, Math.min(dates.length - 1, Math.floor(scrollLeft / DAY_WIDTH)));
        const visibleDateCount = Math.max(1, Math.ceil((clientWidth - ROOM_LABEL_WIDTH) / DAY_WIDTH));
        const endIndex = Math.max(
          startIndex,
          Math.min(dates.length - 1, startIndex + visibleDateCount - 1),
        );
        label = `${formatDateLabel(dates[startIndex], locale)} - ${formatDateLabel(dates[endIndex], locale)}`;
      }
      // Only re-render when the label text actually CHANGES. Calling setState on every scroll frame
      // re-rendered the whole calendar each frame, which starved the main thread and made the
      // JS-driven frozen header jitter as it fell behind the compositor-driven grid scroll.
      if (label !== lastDateLabelRef.current) {
        lastDateLabelRef.current = label;
        setVisibleDateRangeLabel(label);
      }
    },
    [dates, locale],
  );

  // The grid is now the native 2-axis scroll surface (sticky header + sticky room-label column
  // ride along with zero JS sync), so it also owns vertical scroll — forward scrollTop to the
  // shell's auto-hiding top chrome, which otherwise listens to the page scroller.
  const handleGridScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const { scrollLeft, scrollTop, clientWidth } = event.currentTarget;
      window.dispatchEvent(
        new CustomEvent("mobile-shell-scroll", { detail: { scrollTop } }),
      );
      updateVisibleDateRangeLabel(scrollLeft, clientWidth);
    },
    [updateVisibleDateRangeLabel],
  );

  // 예약 상세 시트 — 공용 BottomSheet(2026-10-19). 고르면 띄우고, 시트가 미끄러져 나간 뒤 onClose 에서 비운다.
  const openReservationSheet = useCallback((reservationId: string) => {
    setCopyFeedback(null);
    setSelectedReservationId(reservationId);
  }, []);

  // Auto-open the reservation sheet when arriving via deep-link from a task context.
  // Read the reservationId from the live URL (useSearchParams) rather than the server prop, for the
  // same stale-RSC-payload reason as selectedProperty above. The reservations list is fetched
  // independently of this param, so the cached list still holds the target.
  const deepLinkReservationId =
    searchParams.get("reservationId") ?? initialReservationId ?? null;
  // Guard set INSIDE the rAF callback (not before scheduling) so React StrictMode's mount→cleanup→
  // mount double-invoke can't cancel the only scheduled open: the first cleanup cancels its frame
  // without marking it done, and the second mount re-schedules. Deferring via rAF also keeps
  // setState out of the effect body (lint: react-hooks/set-state-in-effect).
  const autoOpenedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkReservationId) return;
    if (autoOpenedIdRef.current === deepLinkReservationId) return;
    if (!reservations.some((r) => r.id === deepLinkReservationId)) return;
    const raf = requestAnimationFrame(() => {
      autoOpenedIdRef.current = deepLinkReservationId;
      openReservationSheet(deepLinkReservationId);
    });
    return () => cancelAnimationFrame(raf);
  }, [deepLinkReservationId, reservations, openReservationSheet]);


  // 건물 없이 들어오면 **늘 건물 고르기 화면**이다(2026-10-15 사용자 결정 — 「건물 고르기 화면 그대로 있어야 해」).
  // 예전엔 지난번 건물로 저절로 넘겼는데(localStorage → 이후 쿠키), 고르기를 보려는 사람을 가로채서 없앴다.

  useEffect(() => {
    if (mode !== "overview") return;
    if (!isTodayInView) return;
    const container = scrollRef.current;
    if (!container) return;
    const scrollKey = `${selectedMonth}:${selectedProperty ?? ""}`;
    if (autoScrolledKeys.current.has(scrollKey)) return;
    // Position so yesterday (today-1) sits at the left edge and today is the next column;
    // the rest is reached by manual scroll. Defer with a double rAF so the scroll content has
    // its full width before we set scrollLeft (otherwise the first-open scroll clamps to 0).
    autoScrolledKeys.current.add(scrollKey);
    const target = Math.max(0, todayIndex - 1) * DAY_WIDTH;
    const apply = () => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollLeft = target;
      updateVisibleDateRangeLabel(el.scrollLeft, el.clientWidth);
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(apply));
    return () => cancelAnimationFrame(raf);
  }, [mode, isTodayInView, todayIndex, selectedMonth, selectedProperty, updateVisibleDateRangeLabel]);

  useEffect(() => {
    if (mode !== "overview") return;
    const container = scrollRef.current;
    if (!container) return;
    updateVisibleDateRangeLabel(container.scrollLeft, container.clientWidth);
  }, [mode, selectedMonth, selectedProperty, updateVisibleDateRangeLabel]);

  const w = wcopy;
  const propertyName = (name: string) => propertyLabelMap[name] ?? name;
  // 독채(오쿠보 · 사노)는 객실 이름이 건물 이름(한국어 정규 명칭)이다 — 그때만 건물 이름처럼 바꾼다(2026-10-22).
  const roomName = (label: string) => propertyLabelMap[label] ?? label;
  const channelName = (source: string) => {
    const normalized = normalizeSource(source);
    return normalized === "booking" ? "Booking.com" : normalized === "airbnb" ? "Airbnb" : w.channelDirect;
  };
  const guestsShort = (item: CalendarReservationItem) => {
    if (item.adults !== null) {
      const full = copy.guestBreakdown
        .replace("{adults}", String(item.adults))
        .replace("{children}", String(item.children ?? 0));
      return item.children ? full : full.split(" · ")[0];
    }
    return item.guestCount ? `${item.guestCount}${copy.guestCountUnit}` : copy.guestCountUnknown;
  };
  const nightsOf = (item: CalendarReservationItem) =>
    Math.max(0, Math.round((parseDate(item.checkOutDate).getTime() - parseDate(item.checkInDate).getTime()) / 86_400_000));
  const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const longDate = (date: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(parseDate(date));

  // 건물마다 객실 수 · 오늘 빈 방 — 건물 고르기 목록에 쓴다.
  const buildingRows = propertyOptions.map((property) => {
    const propertyRooms = propertyRoomsMap?.[property] ?? [];
    const occupied = new Set(
      reservations
        .filter((item) => item.propertyName === property && item.checkInDate <= today && item.checkOutDate > today)
        .map((item) => item.roomLabel),
    );
    return { property, rooms: propertyRooms.length, empty: propertyRooms.filter((room) => !occupied.has(room)).length };
  });

  const buildingList = (onPick?: () => void) => (
    <div className="mcw-blist">
      {buildingRows.map((row) => {
        const on = row.property === selectedProperty;
        return (
          <Link
            aria-current={on ? "true" : undefined}
            className={`mcw-brow${on ? " on" : ""}`}
            href={getPropertyCalendarHref(row.property)}
            key={row.property}
            onClick={() => onPick?.()}
          >
            <span className="mcw-brow__t">
              <b>{propertyName(row.property)}</b>
              <span className="num">
                {w.roomsToday.replace("{n}", String(row.rooms)).replace("{e}", row.empty ? String(row.empty) : w.noneEmpty)}
              </span>
            </span>
            {on ? <Check aria-hidden="true" className="mcw-brow__ck" /> : <ChevronRight aria-hidden="true" className="mcw-brow__go" />}
          </Link>
        );
      })}
    </div>
  );

  // 건물을 아직 안 고른 첫 화면 — 지난번에 본 건물이 있으면 그리로 바로 간다(시안 CalPick-Phone: 카드 첫 화면 대신 건물 고르기).
  // 지도 | 목록(2026-10-15, 시안 Motion-D-Map-Phone) — `building-picker.tsx`.
  if (!selectedProperty) {
    return (
      <BuildingPicker
        rows={buildingRows.map((row) => ({ ...row, label: propertyName(row.property), href: getPropertyCalendarHref(row.property) }))}
        w={w}
      />
    );
  }

  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });

  const listTabs: Array<{ key: ListTab; label: string; count: number }> = [
    { key: "in", label: w.tabCheckIn, count: checkInsToday.length },
    { key: "out", label: w.tabCheckOut, count: checkOutsToday.length },
    { key: "stay", label: w.tabStay, count: stayingToday.length },
    { key: "empty", label: w.tabEmpty, count: emptyRoomLabels.length },
  ];
  const listItems = listTab === "in" ? checkInsToday : listTab === "out" ? checkOutsToday : listTab === "stay" ? stayingToday : [];
  const listSub = (item: CalendarReservationItem) =>
    listTab === "stay"
      ? `${guestsShort(item)} · ${w.untilSub.replace("{date}", md(item.checkOutDate))}`
      : listTab === "out"
        ? `${guestsShort(item)} · ${md(item.checkInDate)} – ${md(item.checkOutDate)}`
        : w.staySub
            .replace("{guests}", guestsShort(item))
            .replace("{nights}", w.nights.replace("{n}", String(nightsOf(item))))
            .replace("{channel}", channelName(item.source));
  const paneReservation = isTablet
    ? (listItems.find((item) => item.id === paneReservationId) ?? listItems[0] ?? null)
    : null;
  const paneMap = isTablet && mode === "map" ? (buildingInfos.find((item) => item.canonicalName === paneMapName) ?? buildingInfos[0] ?? null) : null;

  const reservationBody = (item: CalendarReservationItem, onCopied: (key: string) => void, copiedKey: string | null) => {
    const phone = item.phone?.trim() || null;
    const tel = toDialablePhone(phone);
    return (
      <>
        <div className="mcw-dk">
          <i className={`mcw-dot is-${normalizeSource(item.source)}`} aria-hidden="true" />
          <span>
            {channelName(item.source)} · {w.resNo} <span className="mcw-mono">{item.sourceReservationId}</span>
          </span>
          <button
            aria-label={copiedKey === "res" ? w.copied : w.copyResNo}
            className="mcw-ib is-sm"
            onClick={async () => {
              await copyText(item.sourceReservationId);
              onCopied("res");
            }}
            title={w.copyResNo}
            type="button"
          >
            {copiedKey === "res" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </button>
        </div>
        <div className="mcw-dwho">
          <h2>{item.guestName}</h2>
          <span>
            {propertyName(item.propertyName)} · <b className="mcw-mono">{roomName(item.roomLabel)}</b> · {guestsShort(item)}
          </span>
        </div>
        <div className="mcw-dstay">
          <div>
            <span className="mcw-k">{copy.checkInLabel}</span>
            <b>{longDate(item.checkInDate)}</b>
            <span className="mcw-soft">{w.fromTime.replace("{time}", DEFAULT_CHECK_IN_TIME)}</span>
          </div>
          <div>
            <span className="mcw-k">{copy.checkOutLabel}</span>
            <b>{longDate(item.checkOutDate)}</b>
            <span className="mcw-soft">
              {w.untilTime.replace("{time}", DEFAULT_CHECK_OUT_TIME).replace("{nights}", w.nights.replace("{n}", String(nightsOf(item))))}
            </span>
          </div>
        </div>
        <div className="mcw-dphone">
          <span className={`num${phone ? "" : " mcw-soft"}`}>{phone ? formatPhoneDisplay(phone) : copy.phoneMissing}</span>
          {phone ? (
            <button
              aria-label={copiedKey === "phone" ? w.copied : w.copyPhone}
              className={`mcw-sq${copiedKey === "phone" ? " is-done" : ""}`}
              onClick={async () => {
                await copyText(phone);
                onCopied("phone");
              }}
              title={w.copyPhone}
              type="button"
            >
              {copiedKey === "phone" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </button>
          ) : null}
          {tel ? (
            <a aria-label={w.call} className="mcw-sq is-pri" href={`tel:${tel}`} onClick={() => haptic("light")}>
              <Phone aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <div className="mcw-dnote">
          <span className="mcw-k">{copy.internalNote}</span>
          <p className={item.internalNote?.trim() ? "" : "mcw-soft"}>{item.internalNote?.trim() || w.noNote}</p>
        </div>
      </>
    );
  };

  const accessBody = (meta: PropertyMapMeta, onCopied: (key: string) => void, copiedKey: string | null) => {
    const address = getPropertyAddress(meta, locale);
    return (
      <>
        <div className="mcw-dwho">
          <h2>{propertyName(meta.canonicalName)}</h2>
          <span>{address || copy.mapAddressMissing}</span>
          <span className="mcw-links">
            <a className="mcw-link" href={meta.googleMapsUrl} rel="noopener noreferrer" target="_blank">
              {w.openMap}
              <ExternalLink aria-hidden="true" />
            </a>
            {address ? (
              <button
                className="mcw-link"
                onClick={async () => {
                  await copyText(address);
                  onCopied("addr");
                }}
                type="button"
              >
                {copiedKey === "addr" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copiedKey === "addr" ? w.copied : w.copyAddress}
              </button>
            ) : null}
          </span>
        </div>
        <div className="mcw-codes">
          {meta.sharedAccess.map((item, index) => {
            const key = `s${index}`;
            return (
              <div className="mcw-code" key={key}>
                <span className="mcw-code__t">
                  <span className="mcw-k">{sharedAccessLabel(item, copy)}</span>
                  <b className="mcw-mono">{sharedAccessCodeLabel(item, copy)}</b>
                </span>
                <button
                  aria-label={copiedKey === key ? w.copied : `${sharedAccessLabel(item, copy)} · ${copy.copyNumber}`}
                  className={`mcw-sq${copiedKey === key ? " is-done" : ""}`}
                  onClick={async () => {
                    await copyText(item.code);
                    onCopied(key);
                  }}
                  type="button"
                >
                  {copiedKey === key ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="mcw-rcodes">
          <span className="mcw-k">{w.roomCodes}</span>
          {meta.roomAccess && meta.roomAccess.length > 0 ? (
            meta.roomAccess.map((item) => {
              const key = `r${item.roomLabel}`;
              return (
                <button
                  aria-label={`${roomName(item.roomLabel)} · ${copy.copyNumber}`}
                  className="mcw-rcode"
                  key={item.roomLabel}
                  onClick={async () => {
                    await copyText(item.code);
                    onCopied(key);
                  }}
                  type="button"
                >
                  <span className="mcw-mono">{roomName(item.roomLabel)}</span>
                  {copiedKey === key ? (
                    <span className="mcw-done">
                      <Check aria-hidden="true" />
                      {w.copied}
                    </span>
                  ) : (
                    <span className="mcw-mono mcw-rcode__v">{item.code}</span>
                  )}
                </button>
              );
            })
          ) : (
            <span className="mcw-soft">{copy.mapNoAccessData}</span>
          )}
        </div>
        <div className="mcw-dnote">
          <span className="mcw-k">{w.opsNote}</span>
          <p className={meta.note?.trim() ? "" : "mcw-soft"}>{meta.note?.trim() || copy.opsNoteEmpty}</p>
        </div>
      </>
    );
  };

  return (
    <div className="mcw">
      {roomSourceDebug ? (
        <p className="mcw-debug">
          room source: {roomSourceDebug.mode} · {roomSourceDebug.activeRoomLabels.length}
        </p>
      ) : null}

      {/* 화이트 리디자인(2026-10-14, 시안 Cal-Phone · Cal-Fold · Cal-Tablet · CalList-* · CalMap-* · CalDetail-Phone · CalPick-Phone):
          머리 = 「예약 캘린더」 + 건물 이름(누르면 건물 고르기 시트) + 달 이동, 그 아래 캘린더 · 목록 · 지도. */}
      {/* HIG 2차(2026-10-20): 건물 이름이 큰 제목 34 라 달 이동은 「예약 캘린더」 줄 오른쪽으로. */}
      <div className="mcw-h">
        <div className="mcw-h__top">
          <span className="mcw-h__k">{w.title}</span>
          <div className="mcw-month">
            <Link aria-label={w.prevMonth} className="mcw-ib" href={`/mobile/calendar?${previousHref.toString()}`}>
              <ChevronLeft aria-hidden="true" />
            </Link>
            <span className="num">{selectedMonthLabel}</span>
            <Link aria-label={w.nextMonth} className="mcw-ib" href={`/mobile/calendar?${nextHref.toString()}`}>
              <ChevronRight aria-hidden="true" />
            </Link>
          </div>
        </div>
        <button
          aria-label={w.pickAria.replace("{name}", propertyName(selectedProperty))}
          className="mcw-h__t mcw-h__pick"
          onClick={() => setIsBuildingSheetOpen(true)}
          type="button"
        >
          {propertyName(selectedProperty)}
          <ChevronDown aria-hidden="true" />
        </button>
      </div>

      <div className="mcw-seg" role="tablist" aria-label={w.title}>
        {(
          [
            ["overview", copy.calendar],
            ["lists", copy.listView],
            ["map", copy.mapTab],
          ] as const
        ).map(([key, label]) => (
          <button
            aria-selected={mode === key}
            className={mode === key ? "on" : ""}
            key={key}
            onClick={() => setMode(key)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "overview" ? (
        isOutOfWindow ? (
          <div className="mcw-empty">
            <b>{copy.calendarOutOfWindowTitle}</b>
            <span>{copy.calendarOutOfWindowBody}</span>
          </div>
        ) : (
          <>
            <div
              className="mcw-grid"
              data-swipe-back="off"
              onScroll={handleGridScroll}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              ref={scrollRef}
              style={{ maxHeight: "calc(100dvh - 21rem - env(safe-area-inset-bottom, 0px))" }}
            >
              <div className="mcw-grid__in" style={{ minWidth: `${ROOM_LABEL_WIDTH + dates.length * DAY_WIDTH}px` }}>
                {/* 열 바탕 — 세로선 대신 주말은 옅은 회색, 오늘은 옅은 보라(PC 와 같은 규칙). */}
                <div aria-hidden="true" className="mcw-cols" style={{ left: `${ROOM_LABEL_WIDTH}px` }}>
                  {dates.map((date) => {
                    const dow = parseDate(date).getUTCDay();
                    return (
                      <span
                        className={date === today ? "is-today" : dow === 0 || dow === 6 ? "is-we" : ""}
                        key={`c-${date}`}
                        style={{ width: `${DAY_WIDTH}px` }}
                      />
                    );
                  })}
                </div>
                <div className="mcw-head">
                  <div className="mcw-head__days">
                    <div className="mcw-corner" style={{ width: `${ROOM_LABEL_WIDTH}px` }} />
                    {dates.map((date) => {
                      const dow = parseDate(date).getUTCDay();
                      const isToday = date === today;
                      return (
                        <div
                          className={cn("mcw-day", isToday && "is-today", dow === 6 && "is-sat", dow === 0 && "is-sun")}
                          key={date}
                          style={{ width: `${DAY_WIDTH}px` }}
                        >
                          <span>{isToday ? copy.today : weekdayFmt.format(parseDate(date))}</span>
                          <b className="num">{Number(date.slice(8, 10))}</b>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mcw-head__empty">
                    <div className="mcw-corner is-label" style={{ width: `${ROOM_LABEL_WIDTH}px` }}>
                      {w.emptyRow}
                    </div>
                    {dates.map((date) => {
                      const count = emptyCountByDate.get(date) ?? 0;
                      return (
                        <span className={`num${count ? "" : " is-zero"}`} key={`e-${date}`} style={{ width: `${DAY_WIDTH}px` }}>
                          {count || "–"}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {rooms.map((room) => {
                  const layout = roomBarLayouts.get(room);
                  const rowHeight = layout?.rowHeight ?? CALENDAR_SINGLE_ROW_HEIGHT;
                  return (
                    <div className="mcw-row" key={room} style={{ height: `${rowHeight}px` }}>
                      <div className="mcw-room" style={{ width: `${ROOM_LABEL_WIDTH}px` }}>
                        {roomName(room)}
                      </div>
                      <div className="mcw-track" style={{ width: `${dates.length * DAY_WIDTH}px` }}>
                        {(blockBarsByRoom.get(room) ?? []).map((entry) => (
                          <div
                            aria-label={copy.blockedRoom}
                            className="mcw-block"
                            key={entry.block.id}
                            style={{
                              left: `${entry.leftPx + 3}px`,
                              width: `${Math.max(12, entry.widthPx - 6)}px`,
                              top: `${CALENDAR_BAR_TOP}px`,
                              height: `${CALENDAR_BAR_HEIGHT}px`,
                            }}
                            title={copy.blockedRoom}
                          >
                            {entry.widthPx >= 58 ? copy.blockedRoom : null}
                          </div>
                        ))}
                        {layout?.bars
                          .toSorted((a, b) => a.laneIndex - b.laneIndex)
                          .map((bar) => {
                            const hasInternalNote = Boolean(bar.item.internalNote?.trim());
                            const label = reservationBarLabel(bar.item.guestName, bar.widthPx);
                            const startsInView = bar.item.checkInDate >= rangeStart;
                            const endsInView = bar.item.checkOutDate < rangeEndExclusive;
                            const withGuests = bar.widthPx >= 150;
                            return (
                              <button
                                aria-label={`${bar.item.guestName}, ${roomName(bar.item.roomLabel)}, ${channelName(bar.item.source)}`}
                                className={cn(
                                  "mcw-bar",
                                  `is-${normalizeSource(bar.item.source)}`,
                                  !startsInView && "is-cut-l",
                                  !endsInView && "is-cut-r",
                                  selectedReservationId === bar.id && "is-on",
                                )}
                                key={bar.id}
                                onClick={() => openReservationSheet(bar.id)}
                                style={{
                                  left: `${bar.leftPx + 3}px`,
                                  width: `${Math.max(12, bar.widthPx - 6)}px`,
                                  top: `${CALENDAR_BAR_TOP + bar.laneIndex * CALENDAR_COMPACT_LANE_OFFSET}px`,
                                  height: `${CALENDAR_BAR_HEIGHT}px`,
                                }}
                                title={hasInternalNote ? `${bar.item.guestName} · ${copy.internalNote}` : bar.item.guestName}
                                type="button"
                              >
                                {bar.widthPx >= 30 ? <i className={`mcw-dot is-${normalizeSource(bar.item.source)}`} aria-hidden="true" /> : null}
                                <span className="mcw-bar__t">
                                  {label}
                                  {withGuests ? ` · ${guestsShort(bar.item)}` : ""}
                                </span>
                                {hasInternalNote && bar.widthPx >= 40 ? <Pencil aria-hidden="true" className="mcw-bar__note" /> : null}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="mcw-hint">
              <span className="mcw-legend">
                <span>
                  <i className="mcw-dot is-airbnb" />
                  Airbnb
                </span>
                <span>
                  <i className="mcw-dot is-booking" />
                  Booking
                </span>
                <span>
                  <i className="mcw-dot is-other" />
                  {copy.legendDirect}
                </span>
              </span>
              <span>{visibleDateRangeLabel ? `${visibleDateRangeLabel} · ` : ""}{w.hint}</span>
            </p>
          </>
        )
      ) : null}

      {mode === "lists" ? (
        isOutOfWindow ? (
          <div className="mcw-empty">
            <b>{copy.calendarOutOfWindowTitle}</b>
            <span>{copy.calendarOutOfWindowBody}</span>
          </div>
        ) : (
          <div className={isTablet ? "mcw-split" : ""}>
            <div className="mcw-listcol">
              <div className="mcw-tabs" role="tablist" aria-label={copy.listView}>
                {listTabs.map((tab) => (
                  <button
                    aria-selected={listTab === tab.key}
                    className={listTab === tab.key ? "on" : ""}
                    key={tab.key}
                    onClick={() => setListTab(tab.key)}
                    role="tab"
                    type="button"
                  >
                    {tab.label}
                    <b className="num">{tab.count}</b>
                  </button>
                ))}
              </div>
              <div className="mcw-list">
                {listTab === "empty" ? (
                  emptyRoomLabels.length === 0 ? (
                    <p className="mcw-none">{copy.noEmptyRooms}</p>
                  ) : (
                    emptyRoomLabels.map((roomLabel) => (
                      <div className="mcw-li" key={roomLabel}>
                        <span className="mcw-li__room">{roomName(roomLabel)}</span>
                        <span className="mcw-li__t">
                          <b>{propertyName(selectedProperty)}</b>
                          {blockedRoomsAtReference.has(roomLabel) ? <span>{w.blocked}</span> : null}
                        </span>
                      </div>
                    ))
                  )
                ) : listItems.length === 0 ? (
                  <p className="mcw-none">{w.none}</p>
                ) : (
                  listItems.map((item) => {
                    const tel = toDialablePhone(item.phone?.trim() || null);
                    const on = isTablet && paneReservation?.id === item.id;
                    return (
                      <div className={`mcw-li${on ? " on" : ""}`} key={item.id}>
                        <button
                          className="mcw-li__main"
                          onClick={() => (isTablet ? setPaneReservationId(item.id) : openReservationSheet(item.id))}
                          type="button"
                        >
                          <span className="mcw-li__room">{roomName(item.roomLabel)}</span>
                          <span className="mcw-li__t">
                            <b>{item.guestName}</b>
                            <span>{listSub(item)}</span>
                          </span>
                        </button>
                        {tel && !isTablet ? (
                          <a
                            aria-label={w.callAria.replace("{name}", item.guestName)}
                            className="mcw-call"
                            href={`tel:${tel}`}
                            onClick={() => haptic("light")}
                          >
                            <Phone aria-hidden="true" />
                          </a>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            {isTablet ? (
              <div className="mcw-pane">
                {paneReservation ? (
                  <div className="mcw-detail" key={paneReservation.id}>
                    {reservationBody(paneReservation, flashCopied, copiedKey)}
                  </div>
                ) : (
                  <p className="mcw-none">{w.pickHint}</p>
                )}
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {mode === "map" ? (
        <div className={isTablet ? "mcw-split" : ""}>
          <div className="mcw-listcol">
            <p className="mcw-soft">{w.mapHint.replace("{n}", String(buildingInfos.length))}</p>
            <div className="mcw-list">
              {buildingInfos.map((meta) => {
                const address = getPropertyAddress(meta, locale);
                const on = isTablet && paneMap?.canonicalName === meta.canonicalName;
                return (
                  <div className={`mcw-mrow${on ? " on" : ""}`} key={meta.canonicalName}>
                    <div className="mcw-mrow__h">
                      <b>{propertyName(meta.canonicalName)}</b>
                      <a className="mcw-link" href={meta.googleMapsUrl} rel="noopener noreferrer" target="_blank">
                        {w.openMap}
                        <ExternalLink aria-hidden="true" />
                      </a>
                    </div>
                    <span className="mcw-soft">{address || copy.mapAddressMissing}</span>
                    <div className="mcw-mrow__f">
                      <span className="mcw-soft">
                        {w.sharedEntry} <span className="mcw-mask">••••</span>
                      </span>
                      <button
                        className="mcw-link"
                        onClick={() => {
                          if (isTablet) {
                            setPaneMapName(meta.canonicalName);
                            return;
                          }
                          setMapCopyFeedback(null);
                          setSelectedMapProperty(meta);
                        }}
                        type="button"
                      >
                        {w.accessInfo}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {isTablet ? (
            <div className="mcw-pane">
              {paneMap ? (
                <div className="mcw-detail" key={paneMap.canonicalName}>
                  {accessBody(paneMap, flashCopied, copiedKey)}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedReservation ? (
        <BottomSheet
          ariaLabel={selectedReservation.guestName}
          className="flex max-h-[88dvh] flex-col"
          onClose={() => {
            setCopyFeedback(null);
            setSelectedReservationId(null);
          }}
          zIndexClassName="z-[200]"
        >
          <div className="mcw mcw-sheet min-h-0 overflow-y-auto" style={{ paddingInline: 0 }}>
            <div className="mcw-detail">
              {reservationBody(selectedReservation, (key) => setCopyFeedback(key), copyFeedback)}
            </div>
          </div>
        </BottomSheet>
      ) : null}

      {isBuildingSheetOpen ? (
        <BottomSheet
          onClose={() => setIsBuildingSheetOpen(false)}
          className="max-h-[82dvh] flex flex-col"
          header={
            <div className="px-1 pb-2 pt-1">
              <p className="text-lg font-bold">{w.pickBuilding}</p>
            </div>
          }
        >
          <div className="mcw -mx-1 max-h-[65vh] overflow-y-auto px-1 pb-2">{buildingList(() => setIsBuildingSheetOpen(false))}</div>
        </BottomSheet>
      ) : null}

      {selectedMapProperty ? (
        <BottomSheet
          onClose={() => {
            setSelectedMapProperty(null);
            setMapCopyFeedback(null);
          }}
          className="max-h-[82dvh] flex flex-col"
          header={<div className="px-1 pt-1" />}
        >
          <div className="mcw -mx-1 max-h-[70vh] overflow-y-auto px-1 pb-2">
            <div className="mcw-detail">{accessBody(selectedMapProperty, (key) => setMapCopyFeedback(key), mapCopyFeedback)}</div>
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
