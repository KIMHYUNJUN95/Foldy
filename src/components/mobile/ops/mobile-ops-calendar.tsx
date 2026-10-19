"use client";

import { memo, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  revertBlockChange,
  revertPriceJob,
} from "@/app/admin/ops/calendar/actions";
import { fetchOpsCellHistory, fetchOpsPriceConversions } from "@/components/admin/ops/ops-reads";
import { MobileOpsBlockSheet } from "@/components/mobile/ops/mobile-ops-block-sheet";
import { MobileOpsBookingSheet } from "@/components/mobile/ops/mobile-ops-booking-sheet";
import { MobileOpsReservationSheet } from "@/components/mobile/ops/mobile-ops-reservation-sheet";
import { MobileOpsMinStaySheet } from "@/components/mobile/ops/mobile-ops-minstay-sheet";
import { MobileOpsPriceSheet, type MobilePriceSubmitted } from "@/components/mobile/ops/mobile-ops-price-sheet";
import { MobileOpsToast, type MobileToast } from "@/components/mobile/ops/mobile-ops-toast";
import { loadOpsReservationPlacement } from "@/app/admin/ops/calendar/search-actions";
import { type BookingPanelRoom } from "@/components/admin/ops/ops-booking-panel";
import { OpsCellHistoryCard } from "@/components/admin/ops/ops-cell-history-card";
import { OpsHistoryPanel } from "@/components/admin/ops/ops-history-panel";
import { type PanelCell } from "@/components/admin/ops/ops-price-panel";
import { OpsPriceWinsPanel } from "@/components/admin/ops/ops-price-wins-panel";
import { OpsRecentBookingsPanel, recentRangeLabel } from "@/components/admin/ops/ops-recent-bookings-panel";
import { useRecentBookings } from "@/components/admin/ops/use-recent-bookings";
import { OpsSalesSummarySheet } from "@/components/admin/ops/ops-sales-summary-modal";
import { watchOpsWriteJob, type OpsWriteKind, type RunOpsWrite } from "@/components/admin/ops/ops-write-tracker";
import { Beds24LiveDot } from "@/components/shared/beds24-live-dot";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { DatePickerSheet } from "@/components/shell/date-picker-sheet";
import type { Dictionary } from "@/lib/i18n";
import { assignBarLanes, assignBlockLanes } from "@/lib/ops-bar-lanes";
import { formatGridPrice } from "@/lib/ops-price-format";
import { attachMouseDragScroll } from "@/lib/mouse-drag-scroll";
import type {
  OpsCalendarBlock,
  OpsCalendarDay,
  OpsCalendarRoom,
  OpsPriceConversion,
  OpsReservationPlacement,
} from "@/lib/ops-calendar";
import { buildOpsCalendarHref } from "@/lib/ops-calendar-properties";
import {
  buildRowRateLookup,
  dayFlagAt,
  decodeRowRate,
  reuseStableRows,
  rowGapCellKeys,
  sameOpsDays,
  type OpsGridRowData,
} from "@/lib/ops-calendar-rows";
import {
  applyDragRect,
  applyScopeToSelection,
  buildScopeCells,
  buildSelectableWeeks,
  EMPTY_SCOPE,
  isExactCellSelection,
  isScopeActive,
  removeCells,
  selectionCellKey,
  toggleCellGroup,
  toggleInList,
  toggleWeekdayPreset,
  WEEKDAY_WEEKDAYS,
  WEEKEND_WEEKDAYS,
  type OpsSelectionCell,
  type OpsSelectionScope,
} from "@/lib/ops-calendar-selection";
import { buildOpsDaySummaries } from "@/lib/ops-day-summary";
import { buildGapContext } from "@/lib/ops-gap-context";
import { hasOpsLargeRooms, orderOpsLargeRoomsFirst } from "@/lib/ops-large-rooms";
import type { CellHistory } from "@/lib/ops-price-history";
import { buildOpsScopeSummary } from "@/lib/ops-scope-summary";
import { opsUrgentVacantCells } from "@/lib/ops-urgent-vacant";
import { opsVacantRoomKeys } from "@/lib/ops-vacant-today";
import "./mobile-ops-calendar.css";
import "./mobile-ops-calendar-white.css";

/**
 * 모바일 판매 캘린더 격자(2026-10-01, 시안 1a v2).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「모바일 판매 캘린더」
 *
 * **데스크톱 대시보드의 기능을 전부 가진다**(2026-10-01 사용자 지시) — 같은 데이터 · 같은 판정 · 같은 패널 ·
 * 같은 서버 액션. 다른 것은 입력 방식뿐이다:
 *
 * | 데스크톱 | 모바일 |
 * | --- | --- |
 * | 드래그 · Shift+클릭 | 길게 누른 뒤 끌기(칸 · 날짜 머리 · 객실 이름 모두) |
 * | 편집 모드의 축(객실 · 기간 · 요일) | 「범위 선택」 시트 — 같은 `buildScopeCells` · `applyScopeToSelection` |
 * | 오른쪽 패널 · 옆 패널 | 공용 `BottomSheet` 안에 같은 패널 |
 * | 칸 이력 호버 카드 | 한 칸만 골랐을 때 도구줄의 「이력」 |
 * | 빈 칸 `+` → 체크아웃 | 한 객실의 이어진 빈 밤을 고르면 도구줄의 「예약」 |
 * | 날짜 이동 달력 | 범위 라벨 칩 → 앱 공용 날짜 시트(`DatePickerSheet`). 예약 검색은 모바일에 두지 않는다(2026-10-02) |
 *
 * 패널 CSS 변수가 `.adm` · `.ops` 에 걸려 있어 시트 내용을 그 두 클래스로 감싸고, 데스크톱 모양(302px 카드 ·
 * 오른쪽 고정 패널 · X 버튼)은 `.mops-panel` 아래에서 걷는다 — 시트 계약(X 없음, 끌기 · 스크림 · Esc)을 따른다.
 */

type Copy = Dictionary["opsAdmin"]["calendar"];

type PropertyPill = { name: string; href: string; selected: boolean };

type Nav = {
  allHref: string;
  cancelledHref: string;
  isRolling: boolean;
  monthlyHref: string;
  nextHref: string;
  prevHref: string;
  rangeLabel: string;
  rollingHref: string;
  showCancelled: boolean;
  todayHref: string;
};

/** 날짜 이동 — 고른 날짜로 `start`(30일) 또는 `ym`(월간)만 바꾸고 나머지 쿼리는 그대로. */
type Jump = {
  base: { cancelled?: string; mode: string; property: string[] };
  month: string;
  start: string;
};

type Pending = { token: number; value: number };
type PanelKind = "price" | "minstay" | "block";
type Overlay =
  | { kind: PanelKind | "scope" | "history" | "wins" | "recent" | "jump" }
  | { kind: "reservation"; placement: OpsReservationPlacement }
  | { kind: "booking"; room: BookingPanelRoom; checkIn: string; checkOut: string }
  | { kind: "cellHistory"; roomKey: string; date: string }
  | { kind: "blockInfo"; block: OpsCalendarBlock; roomTitle: string };

const BASE_PATH = "/mobile/ops/calendar";
/** 칸 폭 · 트랙. CSS(`mobile-ops-calendar.css`)의 같은 이름 변수와 짝이다. */
const CELL_W = 46;
const TOP_H = 34;
const LANE_H = 22;
/** 막대를 줄 안에서 조금 내린다(화이트 리디자인 — 막대 높이 16px 을 22px 줄 가운데에). */
const BAR_DY = 3;
/** 길게 누르기 판정. iOS 기본 콜아웃(약 500ms)보다 짧아야 그쪽이 먼저 뜨지 않는다. */
const LONG_PRESS_MS = 380;
/** 이만큼 움직이면 스크롤로 본다 — 길게 누르기를 취소한다. */
const MOVE_SLOP = 8;
/** 끌다가 격자 가장자리에 이만큼 다가가면 그쪽으로 저절로 넘긴다. */
const EDGE = 36;
/** 붙어 있는 머리 높이 — 달 줄 22 + 날짜 40 + 빈 방 24 + 평균가 24 + 선 1. CSS `.mops-head` 와 짝. */
const HEAD_H = 111;
const ROOM_W = 56;

function dropTokens(map: Map<string, Pending>, tokens: ReadonlySet<number>): Map<string, Pending> {
  let changed = false;
  const next = new Map<string, Pending>();
  for (const [key, entry] of map) {
    if (tokens.has(entry.token)) changed = true;
    else next.set(key, entry);
  }
  return changed ? next : map;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** BLOCK 막대 시트의 「누가 · 언제」 — 도쿄 시각 「10/08 14:22」. */
function tokyoStamp(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  })
    .format(new Date(iso))
    .slice(5)
    .replace("-", "/");
}

export function MobileOpsCalendar({
  copy: copyProp,
  days: daysProp,
  historyAlerts,
  jump,
  nav,
  properties,
  rows: rowsProp,
  selectedProperties,
  staleRates,
  syncedLabel,
  today,
}: {
  copy: Copy;
  days: OpsCalendarDay[];
  historyAlerts: number;
  jump: Jump;
  nav: Nav;
  properties: PropertyPill[];
  rows: OpsGridRowData[];
  selectedProperties: string[];
  staleRates: boolean;
  syncedLabel: string;
  today: string;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  /*
   * ── 새로고침이 와도 **안 바뀐 것은 참조를 유지한다**(데스크톱 격자와 같은 방식) ──────────
   * 실시간 신호 · 쓰기 반영으로 서버 데이터를 다시 받으면 모든 prop 이 새 객체로 온다. 그대로 넘기면 메모된
   * 행(`MobileOpsRow`)이 전부 다시 그려져 폰에서 버벅였다(2026-10-02 사용자 지적). 행은 내용 해시(`sig`)로,
   * 가로축 · 문구는 내용으로 비교해 같으면 직전 것을 쓴다. 렌더 중 비교 → 다를 때만 setState.
   */
  const [rowsState, setRowsState] = useState({ seen: rowsProp, stable: rowsProp });
  let rows = rowsState.stable;
  if (rowsState.seen !== rowsProp) {
    rows = reuseStableRows(rowsState.stable, rowsProp);
    setRowsState({ seen: rowsProp, stable: rows });
  }
  const [stableDays, setStableDays] = useState(daysProp);
  const days = sameOpsDays(stableDays, daysProp) ? stableDays : daysProp;
  if (days !== stableDays) setStableDays(days);
  const [copyState, setCopyState] = useState({ seen: copyProp, stable: copyProp });
  const copyArrived = copyState.seen !== copyProp;
  // 문구는 언어를 바꿀 때만 달라진다 — 받은 객체가 바뀔 때 한 번만 비교한다.
  const copy =
    !copyArrived || JSON.stringify(copyProp) === JSON.stringify(copyState.stable) ? copyState.stable : copyProp;
  if (copyArrived) setCopyState({ seen: copyProp, stable: copy });
  const dates = useMemo(() => days.map((day) => day.date), [days]);

  /*
   * 건물 · 기간을 바꾸는 링크는 서버에서 새 격자를 받아야 해서 누른 뒤 한동안 아무 반응이 없었다(「이동할 때 렉」,
   * 2026-10-02). 누르는 즉시 격자를 흐리게 해 「받는 중」을 보이고, 새 데이터가 오면(행 배열이 바뀌면) 걷는다.
   */
  const [navPending, setNavPending] = useState<{ from: OpsGridRowData[] } | null>(null);
  if (navPending && navPending.from !== rowsProp) setNavPending(null);
  const markNav = (href: string) => () => {
    if (href === `${window.location.pathname}${window.location.search}`) return;
    setNavPending({ from: rowsProp });
  };
  useEffect(() => {
    if (!navPending) return;
    // 같은 데이터가 와서 배열이 안 바뀌는 경우의 안전장치.
    const timer = setTimeout(() => setNavPending(null), 8000);
    return () => clearTimeout(timer);
  }, [navPending]);
  const todayInView = dates.includes(today);

  // ── 보기 필터(데스크톱과 같은 판정) ────────────────────────────────────────
  const [vacantOnly, setVacantOnly] = useState(false);
  const [largeFirst, setLargeFirst] = useState(false);
  const serverRooms = useMemo(() => rows.map((row) => row.room), [rows]);
  const allBars = useMemo(() => rows.flatMap((row) => row.bars), [rows]);
  const allBlocks = useMemo(() => rows.flatMap((row) => row.blocks), [rows]);
  const hasLargeRooms = useMemo(() => hasOpsLargeRooms(serverRooms), [serverRooms]);
  const vacantKeys = useMemo(
    () => opsVacantRoomKeys({ bars: allBars, roomKeys: serverRooms.map((room) => room.key), today }),
    [allBars, serverRooms, today],
  );
  const vacantActive = vacantOnly && todayInView;
  const rooms = useMemo(() => {
    const base = vacantActive ? serverRooms.filter((room) => vacantKeys.has(room.key)) : serverRooms;
    return (hasLargeRooms && largeFirst ? orderOpsLargeRoomsFirst(base) : base) as OpsCalendarRoom[];
  }, [hasLargeRooms, largeFirst, serverRooms, vacantActive, vacantKeys]);
  const rowByKey = useMemo(() => new Map(rows.map((row) => [row.room.key, row])), [rows]);
  const roomKeys = useMemo(() => rooms.map((room) => room.key), [rooms]);
  const roomByKey = useMemo(() => new Map(rooms.map((room) => [room.key, room])), [rooms]);

  const rateAt = useMemo(() => buildRowRateLookup(rows, dates), [rows, dates]);
  const gapCells = useMemo(() => rowGapCellKeys(rows, dates), [rows, dates]);
  const soldCells = useMemo(() => {
    const sold = new Set<string>();
    for (const bar of allBars) {
      if (bar.isCancelled) continue;
      for (const date of dates) if (date >= bar.checkIn && date < bar.checkOut) sold.add(selectionCellKey(bar.roomKey, date));
    }
    return sold;
  }, [allBars, dates]);
  const blockedCells = useMemo(() => {
    const blocked = new Set<string>();
    for (const block of allBlocks) {
      for (const date of dates) {
        if (date >= block.startDate && date <= block.endDate) blocked.add(selectionCellKey(block.roomKey, date));
      }
    }
    return blocked;
  }, [allBlocks, dates]);

  /**
   * 고를 수 있는 칸 — 오늘 이후 밤. **팔린 밤도 고른다**(2026-10-06) — 모바일은 칸을 먼저 고르고 할 일(가격 · 최소숙박 · 차단)을
   * 나중에 정하므로, 예약과 겹친 차단을 풀려면 팔린 밤도 골라져야 한다. 가격 · 최소숙박 시트에는 팔린 밤을 빼고 넘긴다
   * (`editableCells` — 데스크톱이 그 두 모드에서 팔린 밤을 못 고르게 하는 것과 같은 결과).
   */
  const canSelect = (roomKey: string, date: string) => date >= today;
  const occupancyAt = (roomKey: string, date: string) => ({
    hasBlockingReservation: soldCells.has(selectionCellKey(roomKey, date)),
  });

  // ── 선택 · 범위 축(데스크톱과 같은 모양: 고른 칸 + 축이 넣어 준 칸의 키) ─────────────
  const [selState, setSelState] = useState<{ cells: OpsSelectionCell[]; scopeKeys: Set<string> }>({
    cells: [],
    scopeKeys: new Set(),
  });
  const [scope, setScope] = useState<OpsSelectionScope>(EMPTY_SCOPE);
  const selection = selState.cells;
  const setSelection = (next: OpsSelectionCell[] | ((previous: OpsSelectionCell[]) => OpsSelectionCell[])) =>
    setSelState((previous) => ({
      cells: typeof next === "function" ? next(previous.cells) : next,
      scopeKeys: previous.scopeKeys,
    }));
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  /** 「객실 옮기기」 후보 — 연 예약과 같은 건물 줄(2026-10-19). 시트가 다시 읽지 않게 같은 배열을 유지한다. */
  const moveRooms = useMemo(() => {
    if (overlay?.kind !== "reservation") return [];
    const propertyName = overlay.placement.propertyName;
    return serverRooms
      .filter((room) => room.propertyName === propertyName && room.roomIds.length > 0)
      .map((room) => ({ label: room.displayRoomLabel, roomIds: room.roomIds, roomKey: room.key }));
  }, [overlay, serverRooms]);
  const [salesOpen, setSalesOpen] = useState(false);

  // 예약 바로 열기 — 다른 화면에서 `?resv=<id>` 로 넘어오면 그 예약 상세 시트를 연다(데스크톱과 같다).
  // 창 밖 숙박이라도 상세는 열린다. 새로고침으로 다시 열리지 않게 주소에서는 바로 뗀다.
  useEffect(() => {
    const url = new URL(window.location.href);
    const reservationId = url.searchParams.get("resv");
    if (!reservationId) return;
    url.searchParams.delete("resv");
    window.history.replaceState(window.history.state, "", url.toString());
    void loadOpsReservationPlacement(reservationId).then((result) => {
      // 취소 플래그를 두지 않는다 — 개발 모드 이중 실행에서 첫 실행이 주소를 떼고 정리되면
      // 두 번째 실행은 `resv` 를 못 봐서 시트가 영영 안 열린다(데스크톱 격자와 같은 이유).
      if (result.ok) setOverlay({ kind: "reservation", placement: result.placement });
    });
  }, []);
  // 필터가 방을 화면에서 지우면 그 방의 칸도 선택에서 뺀다 — 요약과 실제로 보내는 칸이 어긋나지 않게.
  // 칸 수 × 객실 수로 훑지 않는다(끄는 동안 렌더마다 돈다) — 객실 Map 으로 한 번에.
  if (selection.some((cell) => !roomByKey.has(cell.roomKey))) {
    setSelState({ cells: selection.filter((cell) => roomByKey.has(cell.roomKey)), scopeKeys: selState.scopeKeys });
  }
  const selectedKeys = useMemo(
    () => new Set(selection.map((cell) => selectionCellKey(cell.roomKey, cell.date))),
    [selection],
  );
  const clearSelection = () => {
    setScope(EMPTY_SCOPE);
    setSelState({ cells: [], scopeKeys: new Set() });
  };
  /** 축을 바꾼다 — 곧바로 선택에 반영하되 직접 찍은 칸은 보존한다(데스크톱 `applyScope` 와 같다). */
  const applyScope = (next: OpsSelectionScope) => {
    setScope(next);
    const built = buildScopeCells({ dates, occupancyAt, roomKeys, scope: next, today });
    setSelState((previous) => {
      const applied = applyScopeToSelection({
        nextScopeCells: built.cells,
        previous: previous.cells,
        previousScopeKeys: previous.scopeKeys,
      });
      return { cells: applied.selection, scopeKeys: applied.scopeKeys };
    });
  };
  const weeks = useMemo(() => buildSelectableWeeks(dates, today), [dates, today]);
  const allRoomsInScope = roomKeys.length > 0 && roomKeys.every((key) => scope.roomKeys.includes(key));

  const urgentCells = useMemo(
    () =>
      todayInView
        ? opsUrgentVacantCells({
            dates,
            hasPrice: (roomKey, date) => rateAt(roomKey, date)?.price != null,
            isBlocked: (roomKey, date) => blockedCells.has(selectionCellKey(roomKey, date)),
            isSold: (roomKey, date) => soldCells.has(selectionCellKey(roomKey, date)),
            roomKeys,
            today,
          })
        : [],
    [blockedCells, dates, rateAt, roomKeys, soldCells, today, todayInView],
  );
  const urgentKeys = useMemo(
    () => new Set(urgentCells.map((cell) => selectionCellKey(cell.roomKey, cell.date))),
    [urgentCells],
  );
  const selectableGaps = useMemo(() => {
    const visible = new Set(roomKeys);
    const cells: OpsSelectionCell[] = [];
    for (const key of gapCells) {
      const separator = key.indexOf("|");
      const roomKey = key.slice(0, separator);
      const date = key.slice(separator + 1);
      if (visible.has(roomKey) && date >= today && !soldCells.has(selectionCellKey(roomKey, date))) {
        cells.push({ date, roomKey });
      }
    }
    return cells;
  }, [gapCells, roomKeys, soldCells, today]);

  // 한 번에 고르는 버튼은 **다시 누르면 끈다** — 지금 선택이 그 칸들 그대로면 켜진 모양 · 누르면 해제(2026-10-02).
  const urgentPicked = isExactCellSelection(selectedKeys, selection.length, urgentCells);
  const gapsPicked = isExactCellSelection(selectedKeys, selection.length, selectableGaps);
  const openWith = (cells: OpsSelectionCell[], kind: PanelKind) => {
    if (cells.length === 0) return;
    setScope(EMPTY_SCOPE);
    setSelState({ cells, scopeKeys: new Set() });
    setOverlay({ kind });
  };

  // ── 가격 개입 성공(데스크톱과 같은 판정 · 같은 지연 로드) ─────────────────────────
  const [priceWinsOnly, setPriceWinsOnly] = useState(false);
  const [conversionsState, setConversionsState] = useState<{ propertyKey: string; list: OpsPriceConversion[] } | null>(
    null,
  );
  const propertyKey = selectedProperties.join("\n");
  // 보고 있는 창 × 건물만(2026-10-02 사용자 지시 — 달을 넘겨도 지난 목록이 남던 것). 바뀌면 「불러오는 중」부터.
  const windowStart = days[0]?.date ?? "";
  const conversionsKey = `${propertyKey}#${windowStart}#${days.length}`;
  const conversionsRequestRef = useRef(0);
  useEffect(() => {
    conversionsRequestRef.current += 1;
    const requestId = conversionsRequestRef.current;
    if (!windowStart) return;
    void fetchOpsPriceConversions({
      days: days.length,
      properties: propertyKey ? propertyKey.split("\n") : [],
      start: windowStart,
    }).then((result) => {
      if (!result.ok || requestId !== conversionsRequestRef.current) return;
      setConversionsState({ list: result.conversions, propertyKey: conversionsKey });
    });
    // 서버 데이터가 새로 올 때마다(= 새 예약이 들어왔을 수 있다) 다시 판정한다 — 데스크톱과 같다.
  }, [conversionsKey, days.length, propertyKey, rows, windowStart]);
  const priceConversions = useMemo(() => {
    if (!conversionsState || conversionsState.propertyKey !== conversionsKey) return null;
    const visible = new Set(serverRooms.map((room) => room.key));
    return conversionsState.list.filter((conversion) => visible.has(conversion.roomKey));
  }, [conversionsState, conversionsKey, serverRooms]);
  const winIdsByRoom = useMemo(() => {
    const ids = new Set((priceConversions ?? []).map((conversion) => conversion.reservationId));
    const byRoom = new Map<string, string[]>();
    for (const bar of allBars) {
      if (!ids.has(bar.id)) continue;
      const list = byRoom.get(bar.roomKey);
      if (list) list.push(bar.id);
      else byRoom.set(bar.roomKey, [bar.id]);
    }
    return new Map([...byRoom].map(([roomKey, list]) => [roomKey, list.join("|")]));
  }, [allBars, priceConversions]);

  // ── 최근 예약(2026-10-05 — 데스크톱과 같은 훅 · 같은 판정). 가격 개입 성공과 둘 중 하나만 켠다. ──
  const [recentOnly, setRecentOnly] = useState(false);
  const recent = useRecentBookings({ days: days.length, propertyKey, refreshToken: rows, windowStart });
  const recentBookings = useMemo(() => {
    if (!recent.bookings) return null;
    const visible = new Set(serverRooms.map((room) => room.key));
    return recent.bookings.filter((booking) => visible.has(booking.roomKey));
  }, [recent.bookings, serverRooms]);
  const recentIdsByRoom = useMemo(() => {
    const ids = new Set((recentBookings ?? []).map((booking) => booking.reservationId));
    const byRoom = new Map<string, string[]>();
    for (const bar of allBars) {
      if (!ids.has(bar.id)) continue;
      const list = byRoom.get(bar.roomKey);
      if (list) list.push(bar.id);
      else byRoom.set(bar.roomKey, [bar.id]);
    }
    return new Map([...byRoom].map(([roomKey, list]) => [roomKey, list.join("|")]));
  }, [allBars, recentBookings]);

  // ── 쓰기(흐린 값 → 접수 → 반영 대기 → 다시 읽기) ──────────────────────────
  const [pendingPrices, setPendingPrices] = useState<Map<string, Pending>>(new Map());
  const [pendingMinStay, setPendingMinStay] = useState<Map<string, Pending>>(new Map());
  const [settledTokens, setSettledTokens] = useState<Set<number>>(new Set());
  /** 아직 Beds24 에 반영 중인 쓰기 수 — 시트를 닫아도 「가는 중」임을 위에 띄운다(데스크톱 `msQueued`). */
  const [writesInFlight, setWritesInFlight] = useState(0);
  const writeTokenRef = useRef(0);
  /*
   * 서버 데이터가 새로 오면 **반영이 끝났고 값도 맞아진** 쓰기의 흐린 값을 거둔다. 값이 끝내 안 맞는
   * 예외(반올림 등)는 아래 `runWrite` 의 타이머가 거둔다 — 흐린 채로 남지 않는다.
   */
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    if (settledTokens.size > 0) {
      const ready = new Set<number>();
      for (const [key, entry] of pendingPrices) {
        const separator = key.indexOf("|");
        if (settledTokens.has(entry.token) && rateAt(key.slice(0, separator), key.slice(separator + 1))?.price === entry.value) {
          ready.add(entry.token);
        }
      }
      for (const [key, entry] of pendingMinStay) {
        const separator = key.indexOf("|");
        if (settledTokens.has(entry.token) && rateAt(key.slice(0, separator), key.slice(separator + 1))?.minStay === entry.value) {
          ready.add(entry.token);
        }
      }
      if (ready.size > 0) {
        setPendingPrices(dropTokens(pendingPrices, ready));
        setPendingMinStay(dropTokens(pendingMinStay, ready));
        setSettledTokens(new Set([...settledTokens].filter((token) => !ready.has(token))));
      }
    }
  }

  const runWrite: RunOpsWrite = async (kind: OpsWriteKind, values, submit) => {
    writeTokenRef.current += 1;
    const token = writeTokenRef.current;
    const setPending = kind === "price" ? setPendingPrices : setPendingMinStay;
    const drop = () => setPending((previous) => dropTokens(previous, new Set([token])));
    setPending((previous) => {
      const next = new Map(previous);
      for (const item of values) next.set(item.key, { token, value: item.value });
      return next;
    });
    const result = await submit();
    if (!result.ok) {
      drop();
      return { result, settled: null };
    }
    setWritesInFlight((count) => count + 1);
    const settled = watchOpsWriteJob(result.jobId).then((outcome) => {
      setWritesInFlight((count) => Math.max(0, count - 1));
      if (outcome === "failed") drop();
      else {
        setSettledTokens((previous) => new Set(previous).add(token));
        // 값이 끝내 안 맞아도 흐린 채로 두지 않는다.
        setTimeout(drop, 8000);
      }
      startRefresh(() => router.refresh());
      return outcome;
    });
    return { result, settled };
  };

  const removeSentCells = (sent: OpsSelectionCell[]) => {
    setSelection((previous) => removeCells(previous, sent));
  };

  /*
   * ── 알림(시안 v3 · 2026-10-02) ── 가격 시트는 접수되면 닫히고, 진행 · 결과를 탭 바 위 알림으로 보여 준다.
   * 진행(접수 — 반영 중) → 완료(「되돌리기」 = 이력의 되돌리기와 같은 `revertPriceJob`) / 일부 실패 · 실패(「이력 보기」).
   * 한 번에 하나 — 새 쓰기가 오면 그걸로 바뀐다.
   */
  const [toast, setToast] = useState<MobileToast | null>(null);
  const toastSeqRef = useRef(0);
  /** 결과 한 줄(되돌리기 없는 것 — 예약 저장 · 취소 · 만듦). */
  const showToast = (next: Omit<MobileToast, "id" | "count"> & { count?: number }) => {
    toastSeqRef.current += 1;
    setToast({ count: 0, ...next, id: toastSeqRef.current });
  };
  /** 작업 큐 쓰기(가격 · 최소숙박) — 진행 알림 → 끝나면 결과. `doneText` 가 있으면 완료 문구를 그것으로. */
  const trackJobWrite = ({ count, jobId, settled }: MobilePriceSubmitted, doneText?: string) => {
    toastSeqRef.current += 1;
    const id = toastSeqRef.current;
    setToast({ count, doneText, id, jobId, kind: "pending" });
    void settled?.then((outcome) => {
      setToast((current) =>
        current?.id === id
          ? {
              ...current,
              kind:
                outcome === "completed" ? "done" : outcome === "partial_failed" ? "partial" : outcome === "failed" ? "failed" : "slow",
            }
          : current,
      );
    });
  };
  /** 되돌리기 — 작업 큐 쓰기는 작업 번호로(`revertPriceJob`), 차단 · 해제는 그 묶음 시각으로(`revertBlockChange`). */
  const undoWrite = async (target: { jobId?: string; blockAt?: string }, count: number) => {
    toastSeqRef.current += 1;
    const id = toastSeqRef.current;
    setToast({ count, id, kind: "undoing", text: copy.mtUndoing.replace("{n}", String(count)) });
    const result = target.blockAt
      ? await revertBlockChange({ at: target.blockAt })
      : await revertPriceJob({ jobId: target.jobId ?? "" });
    setToast((current) =>
      current?.id === id
        ? {
            ...current,
            kind: result.ok ? "info" : "failed",
            text: result.ok
              ? copy.mtUndoing.replace("{n}", String(result.cells))
              : result.error === "nothing_to_revert"
                ? copy.mtUndoNothing
                : copy.mtUndoFailed,
          }
        : current,
    );
  };

  /*
   * ── 날짜 열 위 「빈 방」 · 「평균가」(화이트 리디자인 2026-10-16, 데스크톱과 같은 `buildOpsDaySummaries`) ──
   * 보이는 객실(필터 반영) × 보이는 날짜에서 계산한다. 반영 중인 가격은 새 값으로 센다(칸이 보여 주는 값과 같게).
   */
  const daySummaries = useMemo(
    () =>
      buildOpsDaySummaries({
        dates,
        isBlocked: (roomKey, date) => blockedCells.has(selectionCellKey(roomKey, date)),
        isSold: (roomKey, date) => soldCells.has(selectionCellKey(roomKey, date)),
        priceAt: (roomKey, date) =>
          pendingPrices.get(selectionCellKey(roomKey, date))?.value ?? rateAt(roomKey, date)?.price ?? null,
        roomKeys,
      }),
    [blockedCells, dates, pendingPrices, rateAt, roomKeys, soldCells],
  );
  /** 달 줄 「2026년 10월」 — 첫 열과 달이 바뀌는 열에만. 문구 대신 기기 언어 형식(`localeTag`)을 쓴다. */
  const monthLabel = useMemo(() => {
    const format = new Intl.DateTimeFormat(copy.localeTag, { month: "long", timeZone: "UTC", year: "numeric" });
    return (date: string) => format.format(new Date(`${date.slice(0, 7)}-01T00:00:00Z`));
  }, [copy.localeTag]);

  // ── 패널에 넘길 모양 ───────────────────────────────────────────────────────
  const panelCells: PanelCell[] = selection
    .map((cell) => {
      const room = roomByKey.get(cell.roomKey);
      if (!room || room.roomIds.length === 0) return null;
      const key = selectionCellKey(cell.roomKey, cell.date);
      return {
        date: cell.date,
        isGap: gapCells.has(`${cell.roomKey}|${cell.date}`),
        price: pendingPrices.get(key)?.value ?? rateAt(cell.roomKey, cell.date)?.price ?? null,
        roomIds: room.roomIds,
        roomKey: cell.roomKey,
        roomLabel: room.displayRoomLabel,
      };
    })
    .filter((cell): cell is PanelCell => cell !== null);
  /** 가격 · 최소숙박 시트에 넘기는 칸 — 팔린 밤은 뺀다(차단 시트는 `panelCells` 전부). */
  const editableCells = panelCells.filter((cell) => !soldCells.has(selectionCellKey(cell.roomKey, cell.date)));
  const scopeSummary = buildOpsScopeSummary({ andMore: copy.andMore, rooms, selection });
  const gapContext = useMemo(
    () =>
      buildGapContext({
        bars: allBars,
        blocks: allBlocks,
        gapCells,
        propertyNames: new Map(rooms.map((room) => [room.key, room.propertyName])),
        roomLabels: new Map(rooms.map((room) => [room.key, room.displayRoomLabel])),
        roomOrder: new Map(rooms.map((room, index) => [room.key, index])),
      }),
    [allBars, allBlocks, gapCells, rooms],
  );

  /*
   * 도구줄의 상황별 버튼.
   * - **예약**: 한 객실의 **이어진 빈 밤**만 골랐을 때 — 체크인 = 첫 밤, 체크아웃 = 마지막 밤 다음 날(데스크톱의 빈 칸
   *   `+` → 체크아웃과 같은 결과). 패널에서 날짜는 다시 고칠 수 있다.
   * - **이력**: 한 칸만 골랐고 그 칸에 변경 이력이 있을 때 — 데스크톱 호버 카드 대신.
   */
  const bookingDraft = (() => {
    if (selection.length === 0) return null;
    const roomKey = selection[0].roomKey;
    if (selection.some((cell) => cell.roomKey !== roomKey)) return null;
    const room = roomByKey.get(roomKey);
    if (!room || room.roomIds.length === 0) return null;
    const sorted = [...new Set(selection.map((cell) => cell.date))].sort();
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] !== addDays(sorted[index - 1], 1)) return null;
    }
    return {
      checkIn: sorted[0],
      checkOut: addDays(sorted[sorted.length - 1], 1),
      room: { key: room.key, label: room.displayRoomLabel, propertyName: room.propertyName, roomIds: room.roomIds },
    };
  })();
  const historyCell = (() => {
    if (selection.length !== 1) return null;
    const cell = selection[0];
    const row = rowByKey.get(cell.roomKey);
    const index = dates.indexOf(cell.date);
    return row && dayFlagAt(row.history, index) ? cell : null;
  })();

  // ── 칸 이력(도구줄 「이력」) ─────────────────────────────────────────────────
  const [cellHistory, setCellHistory] = useState<{ key: string; history: CellHistory | null } | null>(null);
  const [historyHost, setHistoryHost] = useState<HTMLDivElement | null>(null);
  const cellHistoryTarget = overlay?.kind === "cellHistory" ? overlay : null;
  const cellHistoryKey = cellHistoryTarget ? selectionCellKey(cellHistoryTarget.roomKey, cellHistoryTarget.date) : null;
  useEffect(() => {
    if (!cellHistoryTarget || !cellHistoryKey) return;
    const room = rowByKey.get(cellHistoryTarget.roomKey)?.room;
    if (!room || room.roomIds.length === 0) return;
    let live = true;
    void fetchOpsCellHistory({ date: cellHistoryTarget.date, roomIds: room.roomIds }).then((result) => {
      if (live && result.ok) setCellHistory({ history: result.history, key: cellHistoryKey });
    });
    return () => {
      live = false;
    };
    // 칸이 바뀔 때만 다시 받는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellHistoryKey]);

  // ── 길게 누르기 · 끌기 ──────────────────────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /** 네이티브 리스너가 읽는 최신 값. 렌더 중이 아니라 효과에서만 갱신한다(React Compiler 규칙). */
  const liveRef = useRef({ applyScope, canSelect, dates, roomKeys, scope, selectedKeys, selection });
  useEffect(() => {
    liveRef.current = { applyScope, canSelect, dates, roomKeys, scope, selectedKeys, selection };
  });

  /** 끌기 상태를 비우는 함수(아래 네이티브 효과가 채운다) — 시트가 손짓 도중에 열리면 끝 신호(touchend)가 격자로 안
   *  돌아와 끌기 상태가 남고, 그 뒤 격자 스크롤이 막힐 수 있다(2026-10-02 「가격 수정 뒤 스크롤 안 됨」). */
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    type Hit = { kind: "cell"; row: number; col: number } | { kind: "day"; col: number } | { kind: "room"; row: number };
    /**
     * 끌기 셋 — 칸(사각형), 날짜 머리(열 범위 = 데스크톱 Shift+날짜), 객실 이름(객실 축 범위 = 데스크톱 객실명 클릭).
     */
    type Drag =
      | { kind: "cells"; anchor: { row: number; col: number }; base: OpsSelectionCell[]; adding: boolean; x: number; y: number }
      | { kind: "cols"; anchor: number; base: OpsSelectionCell[]; adding: boolean; x: number; y: number }
      | { kind: "rows"; anchor: number; baseRooms: string[]; adding: boolean; x: number; y: number };
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let press: { x: number; y: number } | null = null;
    let drag: Drag | null = null;
    let suppressClick = false;
    let autoFrame: number | null = null;

    /** 손가락 아래 — 막대 · 차단은 건너뛰고 그 밑의 칸 · 머리를 찾는다. */
    const hitAt = (x: number, y: number): Hit | null => {
      for (const element of document.elementsFromPoint(x, y) as HTMLElement[]) {
        if (!scroller.contains(element)) continue;
        const cell = element.closest<HTMLElement>("[data-i]");
        if (cell) {
          const row = cell.closest<HTMLElement>("[data-r]");
          if (row) return { col: Number(cell.dataset.i), kind: "cell", row: Number(row.dataset.r) };
        }
        const day = element.closest<HTMLElement>("[data-di]");
        if (day) return { col: Number(day.dataset.di), kind: "day" };
        const room = element.closest<HTMLElement>("[data-room]");
        if (room) {
          const row = room.closest<HTMLElement>("[data-r]");
          if (row) return { kind: "room", row: Number(row.dataset.r) };
        }
      }
      return null;
    };
    const applyAt = (x: number, y: number) => {
      if (!drag) return;
      const hit = hitAt(x, y);
      if (!hit) return;
      const live = liveRef.current;
      const lastRow = live.roomKeys.length - 1;
      if (drag.kind === "cells") {
        if (hit.kind !== "cell") return;
        setSelection(
          applyDragRect({
            adding: drag.adding,
            anchor: drag.anchor,
            base: drag.base,
            canSelect: live.canSelect,
            current: hit,
            dates: live.dates,
            roomKeys: live.roomKeys,
          }),
        );
      } else if (drag.kind === "cols") {
        if (hit.kind === "room") return;
        setSelection(
          applyDragRect({
            adding: drag.adding,
            anchor: { col: drag.anchor, row: 0 },
            base: drag.base,
            canSelect: live.canSelect,
            current: { col: hit.col, row: lastRow },
            dates: live.dates,
            roomKeys: live.roomKeys,
          }),
        );
      } else {
        if (hit.kind === "day") return;
        const from = Math.min(drag.anchor, hit.row);
        const to = Math.max(drag.anchor, hit.row);
        const range = live.roomKeys.slice(from, to + 1);
        const next = drag.adding
          ? [...new Set([...drag.baseRooms, ...range])]
          : drag.baseRooms.filter((key) => !range.includes(key));
        live.applyScope({ ...live.scope, roomKeys: next });
      }
    };
    const stopAuto = () => {
      if (autoFrame !== null) cancelAnimationFrame(autoFrame);
      autoFrame = null;
    };
    const autoScroll = () => {
      autoFrame = null;
      if (!drag) return;
      const box = scroller.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (drag.kind !== "rows") {
        if (drag.x < box.left + ROOM_W + EDGE) dx = -8;
        else if (drag.x > box.right - EDGE) dx = 8;
      }
      if (drag.kind !== "cols") {
        if (drag.y < box.top + HEAD_H + EDGE) dy = -8;
        else if (drag.y > box.bottom - EDGE) dy = 8;
      }
      if (dx === 0 && dy === 0) return;
      scroller.scrollBy(dx, dy);
      applyAt(drag.x, drag.y);
      autoFrame = requestAnimationFrame(autoScroll);
    };
    const startDrag = (x: number, y: number) => {
      const hit = hitAt(x, y);
      if (!hit) return false;
      const live = liveRef.current;
      if (hit.kind === "cell") {
        const roomKey = live.roomKeys[hit.row];
        const date = live.dates[hit.col];
        if (!roomKey || !date) return false;
        drag = {
          adding: !live.selectedKeys.has(selectionCellKey(roomKey, date)),
          anchor: hit,
          base: live.selection,
          kind: "cells",
          x,
          y,
        };
      } else if (hit.kind === "day") {
        const date = live.dates[hit.col];
        if (!date) return false;
        const selectable = live.roomKeys.filter((roomKey) => live.canSelect(roomKey, date));
        drag = {
          adding: !selectable.every((roomKey) => live.selectedKeys.has(selectionCellKey(roomKey, date))),
          anchor: hit.col,
          base: live.selection,
          kind: "cols",
          x,
          y,
        };
      } else {
        const roomKey = live.roomKeys[hit.row];
        if (!roomKey) return false;
        drag = {
          adding: !live.scope.roomKeys.includes(roomKey),
          anchor: hit.row,
          baseRooms: live.scope.roomKeys,
          kind: "rows",
          x,
          y,
        };
      }
      scroller.classList.add("is-dragging");
      applyAt(x, y);
      return true;
    };
    const endDrag = () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
      press = null;
      if (drag) {
        drag = null;
        suppressClick = true;
        scroller.classList.remove("is-dragging");
      }
      stopAuto();
    };
    const PRESSABLE = "[data-i], [data-bar], [data-block], [data-di], [data-room]";

    const onTouchStart = (event: TouchEvent) => {
      // 격자가 맨 위가 아니면 셸의 당겨서 새로고침을 무장시키지 않는다 — 격자를 위로 올리다가 화면 전체가
      // 새로고침되면 안 된다.
      if (scroller.scrollTop > 0) event.stopPropagation();
      if (event.touches.length !== 1) {
        endDrag();
        return;
      }
      const touch = event.touches[0];
      if (!(event.target as HTMLElement).closest(PRESSABLE)) return;
      press = { x: touch.clientX, y: touch.clientY };
      suppressClick = false;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (!press) return;
        if (startDrag(press.x, press.y)) navigator.vibrate?.(8);
      }, LONG_PRESS_MS);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (drag) {
        // 끄는 중에는 스크롤도, 셸의 당겨서 새로고침도 막는다.
        event.preventDefault();
        event.stopPropagation();
        drag.x = touch.clientX;
        drag.y = touch.clientY;
        applyAt(touch.clientX, touch.clientY);
        if (autoFrame === null) autoFrame = requestAnimationFrame(autoScroll);
        return;
      }
      if (press && Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > MOVE_SLOP) {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = null;
        press = null;
      }
      if (scroller.scrollTop > 0) event.stopPropagation();
    };
    const onTouchEnd = () => endDrag();
    /*
     * 마우스 — **손가락과 같게** 다룬다(2026-10-02 사용자 지적: 관리자 화면 「모바일 보기」(iframe)에서 끌어도 화면이 안
     * 넘어가고 휠만 됐다). 예전엔 누르는 즉시 칸 고르기 끌기였다. 이제:
     *   - 누른 채 움직이면 **격자를 넘긴다**(상하좌우, 손가락 스크롤처럼).
     *   - 움직이지 않고 길게 누르면(`LONG_PRESS_MS`) 칸 · 날짜 머리 · 객실 이름 **고르기 끌기**.
     *   - 짧게 누르고 떼면 그대로 click(칸 토글 · 막대 열기).
     */
    const onPointerDown = (event: PointerEvent) => {
      // 직전 끌기가 격자 밖에서 끝나 click 이 안 왔으면 표시가 남는다 — 새 손짓마다 지운다(안 지우면 다음 탭 하나가 먹힌다).
      suppressClick = false;
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      const target = event.target as HTMLElement;
      const startX = event.clientX;
      const startY = event.clientY;
      const originLeft = scroller.scrollLeft;
      const originTop = scroller.scrollTop;
      let panning = false;
      // 글자 선택 · 이미지 끌기 같은 기본 동작을 막는다(격자는 이미 user-select: none).
      event.preventDefault();
      const canSelect = !target.closest("[data-bar], [data-block]") && Boolean(target.closest(PRESSABLE));
      let holdTimer: ReturnType<typeof setTimeout> | null = canSelect
        ? setTimeout(() => {
            holdTimer = null;
            if (!panning) startDrag(startX, startY);
          }, LONG_PRESS_MS)
        : null;
      const onMove = (move: PointerEvent) => {
        if (drag) {
          drag.x = move.clientX;
          drag.y = move.clientY;
          applyAt(move.clientX, move.clientY);
          if (autoFrame === null) autoFrame = requestAnimationFrame(autoScroll);
          return;
        }
        const dx = move.clientX - startX;
        const dy = move.clientY - startY;
        if (!panning && Math.hypot(dx, dy) > MOVE_SLOP) {
          panning = true;
          if (holdTimer) clearTimeout(holdTimer);
          holdTimer = null;
          scroller.classList.add("is-panning");
        }
        if (panning) {
          scroller.scrollLeft = originLeft - dx;
          scroller.scrollTop = originTop - dy;
        }
      };
      const onUp = () => {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
        if (panning) {
          // 넘기고 뗀 자리의 click 이 칸을 토글하지 않게.
          suppressClick = true;
          scroller.classList.remove("is-panning");
        }
        endDrag();
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
    // 길게 눌러 끈 뒤 손을 떼면 click 이 한 번 더 온다 — 그걸로 칸이 토글되면 안 된다.
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    };
    const onContextMenu = (event: Event) => {
      if ((event.target as HTMLElement).closest(PRESSABLE)) event.preventDefault();
    };

    endDragRef.current = endDrag;
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchEnd);
    scroller.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("click", onClickCapture, true);
    scroller.addEventListener("contextmenu", onContextMenu);
    return () => {
      endDrag();
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      scroller.removeEventListener("pointerdown", onPointerDown);
      scroller.removeEventListener("click", onClickCapture, true);
      scroller.removeEventListener("contextmenu", onContextMenu);
    };
    // `setSelection` 은 `setSelState` 만 쓰는 함수라 첫 렌더 것을 붙잡아도 같다.
  }, []);

  /*
   * 빈 곳을 누르면 선택을 푼다(도구줄에 X 가 없다 — 2026-10-01 사용자 지시). 격자 · 도구줄 · 시트 · 버튼 · 링크는
   * 「빈 곳」이 아니다 — 칸을 더 고르거나, 칩으로 다른 선택을 시작하거나, 건물을 바꾸는 손짓이다.
   */
  const hasSelection = selection.length > 0;
  const overlayOpen = overlay !== null || salesOpen;
  useEffect(() => {
    if (overlayOpen) endDragRef.current?.();
  }, [overlayOpen]);
  useEffect(() => {
    if (!hasSelection || overlayOpen) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest(".mops-grid, .mops-dock, [data-sheet], a, button, input, textarea, select")) return;
      setScope(EMPTY_SCOPE);
      setSelState({ cells: [], scopeKeys: new Set() });
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [hasSelection, overlayOpen]);

  const placementOf = (roomKey: string, barId: string): OpsReservationPlacement | null => {
    const row = rowByKey.get(roomKey);
    const bar = row?.bars.find((candidate) => candidate.id === barId);
    if (!row || !bar) return null;
    return { bar, propertyName: row.room.propertyName, roomIds: row.room.roomIds, roomLabel: row.room.displayRoomLabel };
  };

  /** 탭 한 번(이벤트는 격자 한 곳에서 받는다 — 칸마다 핸들러를 달지 않는다). */
  const onGridClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const rowElement = target.closest<HTMLElement>("[data-r]");
    const rowKey = rowElement ? roomKeys[Number(rowElement.dataset.r)] : undefined;
    // 예약 막대 = 그 예약 상세(데스크톱 막대 클릭과 같다).
    const barElement = target.closest<HTMLElement>("[data-bar]");
    if (barElement && rowKey) {
      const placement = placementOf(rowKey, barElement.dataset.bar ?? "");
      if (placement) setOverlay({ kind: "reservation", placement });
      return;
    }
    // BLOCK 막대 = 사유 · 메모 · 건 사람(데스크톱은 막대에 마우스를 올리면 보인다).
    const blockElement = target.closest<HTMLElement>("[data-block]");
    if (blockElement && rowKey) {
      const row = rowByKey.get(rowKey);
      const block = row?.blocks.find((candidate) => candidate.id === blockElement.dataset.block);
      if (row && block) {
        setOverlay({ block, kind: "blockInfo", roomTitle: `${row.room.propertyName} · ${row.room.displayRoomLabel}` });
      }
      return;
    }
    const cell = target.closest<HTMLElement>("[data-i]");
    if (cell && rowKey) {
      const date = dates[Number(cell.dataset.i)];
      if (!date || !canSelect(rowKey, date)) return;
      setSelection((previous) => toggleCellGroup(previous, [{ date, roomKey: rowKey }]));
      return;
    }
    // 객실 이름 = **객실 축 토글**(데스크톱 객실명 클릭과 같다) — 기간 · 요일 축과 곱해진다.
    const roomButton = target.closest<HTMLElement>("[data-room]");
    if (roomButton) {
      const roomKey = roomButton.dataset.room ?? "";
      applyScope({ ...scope, roomKeys: toggleInList(scope.roomKeys, roomKey) });
      return;
    }
    // 날짜 머리 = 그 열(고를 수 있는 칸만). 전부 골라져 있으면 해제.
    const dayButton = target.closest<HTMLElement>("[data-day]");
    if (dayButton) {
      const date = dayButton.dataset.day ?? "";
      const cells = roomKeys.filter((roomKey) => canSelect(roomKey, date)).map((roomKey) => ({ date, roomKey }));
      if (cells.length > 0) setSelection((previous) => toggleCellGroup(previous, cells));
    }
  };

  /*
   * **셸 크롬(머리 · 탭 바)은 다른 화면처럼 스크롤에 따라 숨었다 나타난다** — 대신 그 빈자리를 격자가 채운다.
   *
   * 이 격자는 자기 상자 안에서 넘어가는 고정 높이라, 셸이 크롬만 치우면 위아래로 빈 띠가 남았다(2026-10-01 지적).
   * 그래서 셸의 표시 상태를 따라간다: 숨으면 화면 전체를 머리 높이(64px)만큼 올리고 격자를 화면 바닥까지 늘린다.
   * 움직임 곡선 · 시간은 셸과 같다(숨기 200ms ease-in, 나타나기 400ms 스프링).
   *
   * 셸은 크롬 상태를 밖으로 알려 주지 않는다 — 탭 바가 숨을 때 붙는 `pointer-events-none` 클래스를 지켜본다.
   * 격자 스크롤은 `mobile-shell-scroll` 로 셸에 알린다(달력 보기와 같은 공용 신호).
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  /**
   * 셸에 보내는 스크롤 값. 격자 높이를 우리가 바꾸면(크롬 숨김/표시) 바닥 근처에서는 브라우저가 scrollTop 을 끌어내린다
   * — 그걸 셸이 「위로 넘김」으로 읽고 크롬을 다시 띄우면 높이가 또 바뀌어 **바닥에서 덜덜 떨었다**(2026-10-02 사용자
   * 지적 「끝까지 올리면 끊긴다」). 그래서 ① 높이를 바꾸는 동안 생긴 움직임은 보정치(`bias`)로 흡수해 셸에 안 보내고
   * ② 고무줄 튕김(맨 위 · 맨 아래 너머)은 끝값으로 자른다.
   */
  const shellScrollRef = useRef({ bias: 0, canHide: true, quietUntil: 0, raw: 0 });
  /** 격자 높이를 다시 맞추는 함수(아래 효과가 채운다) — 객실 수 · 줄 높이 · 선택 도구줄이 바뀐 뒤 부른다. */
  const refitGridRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const grid = scrollerRef.current;
    const root = rootRef.current;
    if (!grid || !root) return;
    const HEADER = 64;
    const tabbar = document.querySelector<HTMLElement>("nav.tabbar");
    let hidden = false;
    /** 크롬이 보일 때의 격자 위 끝(변형을 뺀 자리) · 탭 바 위 끝 · 화면 바닥. **실제 위치를 잰다** — `innerHeight -
     *  탭 바 높이` 로 셈하면 셸이 창과 크기가 다를 때(관리자 미리보기 등) 맨 아래 줄이 탭 바 밑으로 들어갔다. */
    let naturalTop = 0;
    let barTop = window.innerHeight;
    let barBottom = window.innerHeight;
    let tabTop = window.innerHeight;
    let screenBottom = window.innerHeight;
    const measure = () => {
      naturalTop = grid.getBoundingClientRect().top + (hidden ? HEADER : 0);
      // 넓은 화면(태블릿 · 펼친 폴드)에서는 탭 바가 숨는다(`display: none` — 메뉴는 왼쪽 레일). 그때는 창 바닥까지.
      const barShown = Boolean(tabbar && tabbar.getClientRects().length > 0);
      if (barShown && tabbar && !hidden) {
        const box = tabbar.getBoundingClientRect();
        barTop = box.top;
        barBottom = box.bottom;
      } else if (!barShown) {
        barTop = window.innerHeight;
        barBottom = window.innerHeight;
      }
      /*
       * **선택 도구줄이 떠 있으면 격자는 그 위에서 끝난다**(2026-10-05 사용자 지적 「도구줄이 뜨면 맨 아래 객실이
       * 가려진다」). 도구줄(가격 · 최소숙박 · 차단 버튼)은 탭 바보다 훨씬 높은데 격자는 탭 바 위 끝까지 차 있어서, 맨 아래
       * 두세 줄이 도구줄 밑에 깔려 넘겨도 안 보였다. 높이는 `offsetHeight` 로 잰다 — 올라오는 애니메이션(transform)에
       * 흔들리지 않는다. 도구줄은 화면 바닥에 붙은 고정 요소라 위 끝 = 창 높이 − 도구줄 높이.
       */
      const dock = document.querySelector<HTMLElement>(".mops-dock");
      const dockTop = dock ? window.innerHeight - dock.offsetHeight : Number.POSITIVE_INFINITY;
      tabTop = Math.min(barTop, dockTop);
      screenBottom = Math.min(barBottom, dockTop);
    };
    measure();
    /*
     * **높이는 애니메이션하지 않는다**(2026-10-02 — 스크롤 방향이 바뀔 때마다 격자 전체가 매 프레임 다시
     * 배치돼 버벅였다). 움직이는 건 transform(합성기 전용)뿐이고, 높이는 한 번만 바꾼다: 숨을 때는 먼저
     * 늘려 두고(아래쪽은 내려가는 탭 바 뒤라 안 보인다), 나타날 때는 다 올라온 뒤 줄인다.
     */
    let shrinkTimer: ReturnType<typeof setTimeout> | null = null;
    const setHeight = (value: number) => {
      shellScrollRef.current.quietUntil = performance.now() + 120;
      // 가로 모드처럼 키가 낮은 화면에서는 최소 높이를 낮춘다 — 320px 를 고집하면 격자가 화면 밖으로 넘쳐 탭 바 밑에
      // 깔렸다(2026-10-02 가로 · 폴드 점검).
      const floor = window.innerHeight < 560 ? 160 : 320;
      /*
       * **객실이 적으면 격자를 내용 높이로 줄인다**(2026-10-02 사용자 지적 「객실 적은 건물은 밑에 빈 공간이 남고 위로
       * 많이 올라간다」). 예전엔 늘 탭 바까지 채워 아래가 빈 흰 칸이었고, 거기를 밀면 바깥 페이지가 끌려 올라갔다.
       * 줄이 다 들어가면 맨 아래 여유 칸(`.mops-endpad` — 탭 바 · 편집 버튼에 가리지 말라고 둔 것)도 필요 없다.
       */
      const pad = grid.querySelector<HTMLElement>(".mops-endpad");
      const rowsBottom = pad ? pad.offsetTop + 2 : Number.POSITIVE_INFINITY; // + 위아래 테두리
      const target = Math.max(floor, Math.floor(value));
      grid.style.height = `${rowsBottom <= target ? rowsBottom : target}px`;
    };
    const apply = (animate: boolean) => {
      if (shrinkTimer) clearTimeout(shrinkTimer);
      shrinkTimer = null;
      const tall = screenBottom - (naturalTop - HEADER);
      const short = tabTop - naturalTop;
      /*
       * **크롬을 숨겨도 되는 건물인가**(2026-10-02 사용자 지적 「아라키초B 같은 애매한 건물은 빠르게 올리면 더 올라간다」).
       * 줄이 화면보다 조금만 길면, 넘기다 크롬이 숨어 격자가 늘어나는 순간 줄이 다 들어가 버린다 — 더 넘길 게 없어
       * 크롬을 되돌릴 손짓도 없고, 화면은 위로 밀린 채 아래가 비었다. 그래서 **숨긴 뒤에도 넘칠 만큼 길 때만** 숨긴다.
       * 그보다 짧으면 크롬은 그대로 두고 남는 몇 줄만 격자 안에서 넘긴다.
       */
      const pad = grid.querySelector<HTMLElement>(".mops-endpad");
      const rowsBottom = pad ? pad.offsetTop + 2 : Number.POSITIVE_INFINITY;
      const canHide = rowsBottom > tall;
      shellScrollRef.current.canHide = canHide;
      if (!canHide && hidden) {
        // 지금 숨어 있으면 되돌린다 — 셸이 크롬을 띄우면 위 MutationObserver 가 다시 apply 한다.
        window.dispatchEvent(new CustomEvent("mobile-shell-scroll", { detail: { scrollTop: 0 } }));
      }
      root.style.transition = !animate
        ? "none"
        : hidden
          ? "transform 200ms cubic-bezier(0.4, 0, 1, 1)"
          : "transform 400ms cubic-bezier(0.22, 1, 0.36, 1)";
      root.style.transform = hidden ? `translateY(-${HEADER}px)` : "";
      if (hidden || !animate) setHeight(hidden ? tall : short);
      else shrinkTimer = setTimeout(() => setHeight(short), 400);
    };
    const onResize = () => {
      measure();
      apply(false);
    };
    // 회전 · 폴드를 펴고 접을 때는 크기 이벤트가 레이아웃이 다 바뀌기 **전에** 올 때가 있다 — 한 번 더 잰다.
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const onOrientation = () => {
      onResize();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(onResize, 350);
    };
    refitGridRef.current = () => {
      measure();
      apply(false);
      // 다 들어가서 넘길 게 없는데 크롬이 숨어 있으면(큰 건물에서 내려가다 작은 건물로 옮김) 다시 띄울 손짓이 없다 —
      // 맨 위로 알려 크롬을 돌려놓는다.
      if (grid.scrollHeight <= grid.clientHeight + 1) {
        shellScrollRef.current = { ...shellScrollRef.current, bias: 0, quietUntil: 0, raw: 0 };
        window.dispatchEvent(new CustomEvent("mobile-shell-scroll", { detail: { scrollTop: 0 } }));
      }
    };
    const observer = new MutationObserver(() => {
      const next = tabbar?.classList.contains("pointer-events-none") ?? false;
      if (next === hidden) return;
      hidden = next;
      apply(true);
    });
    if (tabbar) observer.observe(tabbar, { attributeFilter: ["class"], attributes: true });
    apply(false);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientation);
    window.visualViewport?.addEventListener("resize", onOrientation);
    return () => {
      if (shrinkTimer) clearTimeout(shrinkTimer);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientation);
      window.visualViewport?.removeEventListener("resize", onOrientation);
      if (settleTimer) clearTimeout(settleTimer);
      refitGridRef.current = null;
    };
  }, []);

  // 위쪽 가로 줄(건물 칩 · 빠른 칩 · 범례)도 마우스로 끌어 넘긴다 — 격자만 되던 것(2026-10-02 사용자 지적).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const detach = [...root.querySelectorAll<HTMLElement>(".mops-pills, .mops-chips, .mops-meta")].map(attachMouseDragScroll);
    return () => detach.forEach((off) => off());
  }, []);

  /*
   * 이 화면은 **격자 안에서만 넘긴다** — 셸 본문(바깥 스크롤)은 잠근다. 셸 본문의 위아래 여백(머리 84px · 탭 바 124px)
   * 때문에 바깥이 수십 px 더 넘어가, 격자 밖을 밀면 화면 전체가 위로 끌려 올라갔다(2026-10-02). 당겨서 새로고침은 셸이
   * 터치로 따로 받으므로 그대로 된다.
   */
  useEffect(() => {
    let outer = rootRef.current?.parentElement ?? null;
    while (outer && getComputedStyle(outer).overflowY !== "auto") outer = outer.parentElement;
    if (!outer) return;
    const previous = outer.style.overflowY;
    outer.scrollTop = 0;
    outer.style.overflowY = "hidden";
    return () => {
      outer.style.overflowY = previous;
    };
  }, []);
  const onGridScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const grid = event.currentTarget;
    const state = shellScrollRef.current;
    const raw = Math.min(Math.max(grid.scrollTop, 0), Math.max(0, grid.scrollHeight - grid.clientHeight));
    if (performance.now() < state.quietUntil) {
      state.bias += state.raw - raw;
      state.raw = raw;
      return;
    }
    if (raw === state.raw) return;
    state.raw = raw;
    // 크롬을 숨겨 봐야 줄이 다 들어가 버리는 건물이면 셸에 알리지 않는다 — 크롬은 그대로, 격자 안에서만 넘긴다.
    if (!state.canHide) return;
    if (raw <= 0) state.bias = 0;
    // 맨 위가 아닌데 보정 때문에 「맨 위」로 읽히면 셸이 크롬을 띄운다 — 맨 위 판정(8px) 밖으로 둔다.
    const sent = raw <= 0 ? 0 : Math.max(9, raw + state.bias);
    window.dispatchEvent(new CustomEvent("mobile-shell-scroll", { detail: { scrollTop: sent } }));
  };

  /**
   * 날짜 이동 — **앱 공용 날짜 시트**(`DatePickerSheet`, 청소 화면과 같은 것)로 고른다(2026-10-02 사용자 결정). 예전엔
   * 기기 날짜 선택(`<input type="date">`)이라 아이폰 휠 · 안드로이드 달력이 제각각이고 앱 모양과 어긋났다. 날짜를 누르면
   * 그 날짜로 바로 간다 — 30일 보기는 그날부터, 월간 보기는 그 달.
   */
  const jumpTo = (date: string) => {
    // 「오늘」은 줄의 예전 「오늘」 버튼과 같은 곳으로(30일 보기 = 어제부터 — 어제 체크아웃이 보이게).
    const href =
      date === today
        ? nav.todayHref
        : buildOpsCalendarHref(nav.isRolling ? { ...jump.base, start: date } : { ...jump.base, ym: date.slice(0, 7) }, BASE_PATH);
    if (href === `${window.location.pathname}${window.location.search}`) return;
    setNavPending({ from: rowsProp });
    router.push(href, { scroll: false });
  };

  // ── 행별로 쪼갠 표시 상태(바뀐 행만 다시 그린다) ────────────────────────────
  const flagsFor = (roomKey: string, keys: ReadonlySet<string>) => {
    if (keys.size === 0) return "";
    let flags = "";
    for (const date of dates) flags += keys.has(selectionCellKey(roomKey, date)) ? "1" : "0";
    return flags.includes("1") ? flags : "";
  };
  /*
   * 반영 중 칸 — 접수 뒤 Beds24 에 가는 동안은 숨 쉬듯 깜빡이고(`pend`), 반영이 끝나 다시 읽기를 기다리는 동안은 보라(`pend ok`),
   * 새 값이 오면 원래 색으로 천천히 돌아간다(화이트 리디자인 2026-10-16). `settled` 는 `p:날짜` · `m:날짜`.
   */
  const pendingByRoom = useMemo(() => {
    const byRoom = new Map<string, { price: Map<string, number>; minStay: Map<string, number>; settled: Set<string> }>();
    const bucket = (key: string) => {
      const roomKey = key.slice(0, key.indexOf("|"));
      let entry = byRoom.get(roomKey);
      if (!entry) {
        entry = { minStay: new Map(), price: new Map(), settled: new Set() };
        byRoom.set(roomKey, entry);
      }
      return { date: key.slice(key.indexOf("|") + 1), entry };
    };
    for (const [key, item] of pendingPrices) {
      const { date, entry } = bucket(key);
      entry.price.set(date, item.value);
      if (settledTokens.has(item.token)) entry.settled.add(`p:${date}`);
    }
    for (const [key, item] of pendingMinStay) {
      const { date, entry } = bucket(key);
      entry.minStay.set(date, item.value);
      if (settledTokens.has(item.token)) entry.settled.add(`m:${date}`);
    }
    return byRoom;
  }, [pendingMinStay, pendingPrices, settledTokens]);

  const groups: { property: string; rooms: OpsCalendarRoom[] }[] = [];
  for (const room of rooms) {
    const last = groups.at(-1);
    if (last && last.property === room.propertyName) last.rooms.push(room);
    else groups.push({ property: room.propertyName, rooms: [room] });
  }
  const rowIndexByKey = new Map(roomKeys.map((key, index) => [key, index]));
  const allSelected = selectedProperties.length === 0;
  const rowCopy = useMemo(
    () => ({ blockLabel: copy.blockLabel, bkPurposes: copy.bkPurposes as Record<string, string> }),
    [copy.blockLabel, copy.bkPurposes],
  );

  const selCount = selection.length;
  const hasDock = selCount > 0;
  // 줄 수 · 줄 높이(취소 보기 · 차단 층) · 맨 아래 여유(선택 도구줄)가 바뀌면 격자 높이를 다시 맞춘다 — 객실이 적은
  // 건물로 옮기면 줄어들고, 많은 건물로 옮기면 다시 탭 바까지 찬다.
  const hadDockRef = useRef(false);
  useEffect(() => {
    const grid = scrollerRef.current;
    const before = grid?.clientHeight ?? 0;
    refitGridRef.current?.();
    // 도구줄이 막 떴으면 — 방금 누른 칸이 줄어든 격자 아래로 밀려 가려지지 않게 그만큼만 넘겨 보여 준다.
    if (grid && hasDock && !hadDockRef.current && grid.clientHeight < before) {
      const view = grid.getBoundingClientRect();
      let lowest = 0;
      for (const cell of grid.querySelectorAll<HTMLElement>(".mops-c.sel")) lowest = Math.max(lowest, cell.getBoundingClientRect().bottom);
      const hiddenBy = lowest - view.bottom;
      if (hiddenBy > 0) grid.scrollTop += hiddenBy + 8;
    }
    hadDockRef.current = hasDock;
  }, [days, hasDock, nav.showCancelled, rooms, rows]);
  const selRoomCount = new Set(selection.map((cell) => cell.roomKey)).size;
  const scopeActive = isScopeActive(scope);
  const panelKind = overlay && (overlay.kind === "price" || overlay.kind === "minstay" || overlay.kind === "block") ? overlay.kind : null;

  return (
    <div aria-busy={navPending ? true : undefined} className={`mops${navPending ? " is-nav" : ""}`} ref={rootRef}>
      {/* 건물 — 옅은 보라 선택 글자 탭(화이트 리디자인 2026-10-16). 모바일은 한 건물씩 — 누르면 그 건물**만** 본다
          (2026-10-05: 예전 「함께 보기」 동그라미가 칩 옆에 붙어 있어 잘못 누르면 이전 건물이 남았다). */}
      <div className="mops-pills" role="group" aria-label={copy.propertyGroupLabel}>
        <Link
          aria-current={allSelected ? "page" : undefined}
          className={`mops-pill${allSelected ? " on" : ""}`}
          href={nav.allHref}
          onNavigate={markNav(nav.allHref)}
          scroll={false}
        >
          {copy.allProperties}
        </Link>
        {properties.map((property) => (
          <Link
            aria-current={property.selected ? "page" : undefined}
            className={`mops-pill${property.selected ? " on" : ""}`}
            href={property.href}
            key={property.name}
            onNavigate={markNav(property.href)}
            scroll={false}
          >
            {property.name}
          </Link>
        ))}
      </div>

      {/* 기간 — 30일/월간 · ‹ 기간 ›. 기간 칩 = 앱 공용 날짜 시트(데스크톱 범위 라벨 달력 · 월 선택기와 같은 자리).
          「오늘」 버튼은 줄에서 뺐다(폭 360px · 영어에서 기간이 잘렸다) — 날짜 시트 안 「오늘」이 같은 곳으로 간다. */}
      <div className="mops-bar">
        <div className="mops-seg">
          <Link className={nav.isRolling ? "on" : ""} href={nav.rollingHref} onNavigate={markNav(nav.rollingHref)} scroll={false}>
            {copy.viewRolling}
          </Link>
          <Link className={nav.isRolling ? "" : "on"} href={nav.monthlyHref} onNavigate={markNav(nav.monthlyHref)} scroll={false}>
            {copy.viewMonthly}
          </Link>
        </div>
        <div className="mops-move">
          <Link aria-label={copy.prev} className="mops-nav" href={nav.prevHref} onNavigate={markNav(nav.prevHref)} scroll={false}>
            <ChevronLeft aria-hidden="true" />
          </Link>
          <button aria-label={copy.mJump} className="mops-range" onClick={() => setOverlay({ kind: "jump" })} type="button">
            <CalendarDays aria-hidden="true" />
            <span>{nav.rangeLabel}</span>
          </button>
          <Link aria-label={copy.next} className="mops-nav" href={nav.nextHref} onNavigate={markNav(nav.nextHref)} scroll={false}>
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      </div>

      {/*
        도구 — 글자만 있는 가로 스크롤 줄(화이트 리디자인 2026-10-16, 예전 테두리 알약 칩). 기능은 전부 그대로:
        자주 쓰는 고르기(1박 갭 · 임박 빈방 · 오늘 빈방만 · 범위 선택) → 보기 · 목록(가격 개입 성공 · 목록 · 최근 예약 ·
        이력 · 매출 요약) → 보기 필터(취소만 보기 · 큰방 위로). 숫자는 글자와 함께(색만으로 뜻을 전하지 않는다).
      */}
      <div className="mops-chips" role="toolbar" aria-label={copy.mwTools}>
        {selectableGaps.length > 0 && (
          <button
            aria-pressed={gapsPicked}
            className={`mops-chip gap${gapsPicked ? " on" : ""}`}
            onClick={() => (gapsPicked ? clearSelection() : openWith(selectableGaps, "minstay"))}
            title={copy.gapOpenHint}
            type="button"
          >
            {copy.gapLabel}
            <b>{selectableGaps.length}</b>
          </button>
        )}
        {todayInView && (
          <button
            aria-pressed={urgentPicked}
            className={`mops-chip urg${urgentPicked ? " on" : ""}`}
            disabled={urgentCells.length === 0}
            onClick={() => (urgentPicked ? clearSelection() : openWith(urgentCells, "price"))}
            title={copy.urgentVacantHint}
            type="button"
          >
            {copy.urgentVacant}
            <b>{urgentCells.length}</b>
          </button>
        )}
        {todayInView && (
          <button
            aria-pressed={vacantOnly}
            className={`mops-chip${vacantOnly ? " on" : ""}`}
            onClick={() => setVacantOnly((value) => !value)}
            type="button"
          >
            {copy.vacantToday}
            <b>{vacantKeys.size}</b>
          </button>
        )}
        <button
          aria-haspopup="dialog"
          aria-pressed={scopeActive}
          className={`mops-chip${scopeActive ? " on" : ""}`}
          onClick={() => setOverlay({ kind: "scope" })}
          type="button"
        >
          {copy.mScope}
        </button>
        <button
          aria-pressed={priceWinsOnly}
          className={`mops-chip${priceWinsOnly ? " on" : ""}`}
          onClick={() => {
            setPriceWinsOnly((value) => !value);
            setRecentOnly(false);
          }}
          type="button"
        >
          {copy.pwToggle}
          <b>{priceConversions ? priceConversions.length : "…"}</b>
        </button>
        <button aria-haspopup="dialog" className="mops-chip" onClick={() => setOverlay({ kind: "wins" })} type="button">
          {copy.pwList}
        </button>
        {/* 최근 예약 — 가격을 건드리지 않았는데 정한 시간대에 들어온 예약. 켜면 시간대 칩(누르면 목록 · 기간 바꾸기). */}
        <button
          aria-pressed={recentOnly}
          className={`mops-chip${recentOnly ? " on" : ""}`}
          onClick={() => {
            setRecentOnly((value) => !value);
            setPriceWinsOnly(false);
          }}
          type="button"
        >
          {copy.rbToggle}
          <b>{recentBookings ? recentBookings.length : "…"}</b>
        </button>
        {recentOnly && (
          <button aria-haspopup="dialog" className="mops-chip dashed" onClick={() => setOverlay({ kind: "recent" })} type="button">
            {recent.range ? recentRangeLabel(recent.range, copy.rbNow) : "…"}
          </button>
        )}
        {/* 이력 — 최근 7일 전송 실패 · 멈춘 작업이 있으면 빨간 점 + 「실패 N」(데스크톱 `opsg__hist.alert`). */}
        <button
          aria-haspopup="dialog"
          className={`mops-chip${historyAlerts > 0 ? " alert" : ""}`}
          onClick={() => setOverlay({ kind: "history" })}
          title={historyAlerts > 0 ? copy.hsAlertTitle.replace("{n}", String(historyAlerts)) : undefined}
          type="button"
        >
          {historyAlerts > 0 && <i aria-hidden="true" className="mops-chip__dot" />}
          {copy.hsButton}
          {historyAlerts > 0 && <b>{copy.mwHistoryFailed.replace("{n}", String(historyAlerts))}</b>}
        </button>
        {days.length > 0 && (
          <button aria-haspopup="dialog" className="mops-chip" onClick={() => setSalesOpen(true)} type="button">
            {copy.ssButton}
          </button>
        )}
        <Link
          className={`mops-chip${nav.showCancelled ? " on" : ""}`}
          href={nav.cancelledHref}
          onNavigate={markNav(nav.cancelledHref)}
          scroll={false}
        >
          {nav.showCancelled ? copy.showCancelledOn : copy.showCancelled}
        </Link>
        {hasLargeRooms && (
          <button
            aria-pressed={largeFirst}
            className={`mops-chip${largeFirst ? " on" : ""}`}
            onClick={() => setLargeFirst((value) => !value)}
            type="button"
          >
            {copy.largeFirst}
          </button>
        )}
      </div>

      {/* 상태 · 범례 한 줄 — 가격 신선도 · 실시간 점 · 반영 중 · 범례(데스크톱 위 줄 오른쪽 + 범례 줄). 넓은 화면에서도
          이 한 줄뿐이다(예전 범례를 따로 두지 않는다). */}
      <div aria-label={copy.mLegend} className="mops-meta">
        <span className={`mops-sync${staleRates ? " stale" : ""}`} title={copy.syncedHint}>
          <Beds24LiveDot offLabel={copy.liveOff} onLabel={copy.liveOn} />
          {syncedLabel}
        </span>
        {writesInFlight > 0 && (
          <span className="mops-inflight" role="status">
            <i aria-hidden="true" />
            {copy.msQueued}
          </span>
        )}
        <span className="mops-lg abnb">
          <i />
          Airbnb
        </span>
        <span className="mops-lg bkng">
          <i />
          Booking.com
        </span>
        <span className="mops-lg dir">
          <i />
          {copy.legendDirect}
        </span>
        <span className="mops-lg blk">
          <i />
          {copy.legendBlock}
        </span>
        <span className="mops-lg">
          <em className="ms1">1</em>
          {copy.legendOneNight}
        </span>
        <span className="mops-lg">
          <em className="msg">2</em>
          {copy.gapLabel}
        </span>
        <span className="mops-lg">
          <em className="ms3">3</em>
          {copy.legendLongStay}
        </span>
        <span className="mops-lg">
          <em>
            1<sup>•</sup>
          </em>
          {copy.legendMixed}
        </span>
      </div>

      {/* 격자 — 가로 · 세로 모두 이 상자 안에서 넘긴다(날짜 머리 · 객실 열이 붙어 있게). */}
      <div
        aria-label={copy.mGridLabel}
        className="mops-grid"
        // 격자는 가로로 넘기고 칸을 끌어 고른다 — 화면 스와이프 뒤로가기가 가져가지 않게(16-mobile-navigation).
        data-swipe-back="off"
        onClick={onGridClick}
        onScroll={onGridScroll}
        ref={scrollerRef}
        role="grid"
        style={{ "--mops-cols": days.length } as React.CSSProperties}
      >
        {/* 붙어 있는 머리 — 달 줄 · 날짜 · 빈 방 · 평균가(화이트 리디자인 2026-10-16). 높이는 `HEAD_H` 와 짝. */}
        <div className="mops-head">
          <div aria-hidden="true" className="mops-head__months">
            <div className="mops-corner" />
            {days.map((day, index) => (
              <div className="mops-mo" key={day.date}>
                {(index === 0 || day.startsMonth) && <span>{monthLabel(day.date)}</span>}
              </div>
            ))}
          </div>
          <div className="mops-head__days">
            <div className="mops-corner">{copy.roomsHeader}</div>
            {days.map((day, index) => (
              <button
                className={`mops-d${day.isWeekend ? " we" : ""}${day.isToday ? " today" : ""}${day.startsMonth ? " m1" : ""}${day.date < today ? " past" : ""}`}
                data-day={day.date}
                data-di={index}
                key={day.date}
                type="button"
              >
                <b>{day.day}</b>
                <span>{copy.weekDaysFromSunday[day.weekday]}</span>
              </button>
            ))}
          </div>
          <div aria-label={copy.mwDaySummaryLabel} className="mops-head__sum" role="group">
            <div className="mops-corner">{copy.mwDayVacant}</div>
            {daySummaries.map((summary, index) => {
              const day = days[index];
              return (
                <div
                  className={`mops-s v${day?.isWeekend ? " we" : ""}${day?.isToday ? " today" : ""}${summary.date < today ? " past" : ""}`}
                  key={summary.date}
                >
                  {summary.vacant}
                </div>
              );
            })}
          </div>
          <div className="mops-head__sum avg">
            <div className="mops-corner">{copy.mwDayAvg}</div>
            {daySummaries.map((summary, index) => {
              const day = days[index];
              return (
                <div
                  className={`mops-s${day?.isWeekend ? " we" : ""}${day?.isToday ? " today" : ""}${summary.date < today ? " past" : ""}`}
                  key={summary.date}
                >
                  {summary.avgPrice !== null ? formatGridPrice(summary.avgPrice) : "–"}
                </div>
              );
            })}
          </div>
        </div>
        {rooms.length === 0 && <div className="mops-empty">{vacantActive ? copy.vacantEmpty : copy.emptyBody}</div>}
        {groups.map((group) => (
          <div key={group.property}>
            {/* 객실이 하나뿐인 건물(독채)은 묶음 머리를 달지 않는다 — 「오쿠보A · 객실 1」 아래 「오쿠보A」 한 줄이
                중복으로 보였고 이름도 56px 열에서 잘렸다(2026-10-01 사용자 지적). 이름은 객실 열에 줄바꿈해 적는다. */}
            {group.rooms.length > 1 && (
              <div className="mops-group">
                <span className="mops-group__name">{group.property}</span>
                <span>{copy.roomCount.replace("{count}", String(group.rooms.length))}</span>
              </div>
            )}
            {group.rooms.map((room) => {
              const row = rowByKey.get(room.key);
              if (!row) return null;
              return (
                <MobileOpsRow
                  copy={rowCopy}
                  days={days}
                  key={room.key}
                  pending={pendingByRoom.get(room.key)}
                  priceWinsOnly={priceWinsOnly || recentOnly}
                  row={row}
                  rowIndex={rowIndexByKey.get(room.key) ?? 0}
                  scopeOn={scope.roomKeys.includes(room.key)}
                  selFlags={flagsFor(room.key, selectedKeys)}
                  showCancelled={nav.showCancelled}
                  solo={group.rooms.length === 1}
                  today={today}
                  // 임박 빈방 테두리는 칩을 **켰을 때만**(2026-10-02 사용자 지시 — 늘 그리면 격자가 복잡해 보였다).
                  urgFlags={urgentPicked ? flagsFor(room.key, urgentKeys) : ""}
                  winIds={
                    priceWinsOnly
                      ? (winIdsByRoom.get(room.key) ?? "")
                      : recentOnly
                        ? (recentIdsByRoom.get(room.key) ?? "")
                        : ""
                  }
                />
              );
            })}
          </div>
        ))}
        {/* 맨 아래 여유 — 탭 바 위로 솟은 편집 버튼 · 홈 표시줄(안전 영역)에 마지막 줄이 가리지 않게. 선택 도구줄이
            뜨면 격자 자체가 도구줄 위에서 끝난다(위 높이 맞춤). */}
        <div aria-hidden="true" className="mops-endpad" />
      </div>

      {/*
        선택 도구줄 — **고르는 동안 하단 탭 바 자리를 대신한다**(사진 앱의 선택 모드와 같다). 격자 위에 떠 있는
        카드는 칸을 가리고 탭 바 · 편집 버튼과 겹쳐 어색했다(2026-10-01 사용자 지적). 닫기는 X 없이 **아래로 밀기**
        또는 **빈 곳 탭**(시트와 같은 손짓). 선택을 풀면 탭 바가 돌아온다.
        셸의 스크롤 · 당겨서 새로고침과 섞이지 않게 body 로 띄운다.
      */}
      {/* 시트가 열려 있어도 내리지 않는다 — 시트 스크림 밑에 그대로 둬야 여닫을 때 탭 바가 번쩍 끼어들지 않는다
          (도구줄 z 70 < 시트 z 80). */}
      {selCount > 0 &&
        typeof document !== "undefined" &&
        createPortal(
          <MobileOpsDock
            count={copy.mSelCount.replace("{n}", String(selCount))}
            extras={[
              ...(bookingDraft
                ? [
                    {
                      key: "book",
                      label: copy.mwBookNights.replace(
                        "{n}",
                        String(
                          Math.round((Date.parse(bookingDraft.checkOut) - Date.parse(bookingDraft.checkIn)) / 86_400_000),
                        ),
                      ),
                      onClick: () => setOverlay({ kind: "booking", ...bookingDraft }),
                    },
                  ]
                : []),
              ...(historyCell
                ? [
                    {
                      key: "history",
                      label: copy.mCellHistory,
                      onClick: () => setOverlay({ date: historyCell.date, kind: "cellHistory", roomKey: historyCell.roomKey }),
                    },
                  ]
                : []),
            ]}
            labels={{ block: copy.mActBlock, clear: copy.mClearSel, minStay: copy.mActMinStay, price: copy.mActPrice }}
            onClear={clearSelection}
            onOpen={(kind) => setOverlay({ kind })}
            summary={
              scopeSummary
                ? `${scopeSummary.rooms} · ${scopeSummary.dates}`
                : copy.mSelSummary.replace("{rooms}", String(selRoomCount)).replace("{dates}", "")
            }
          />,
          document.body,
        )}

      {/* ── 시트들 — 전부 공용 `BottomSheet`, 내용은 데스크톱 패널 그대로 ─────────────────────── */}
      {panelKind && (
        <BottomSheet
          ariaLabel={panelKind === "price" ? copy.panelTitle : panelKind === "minstay" ? copy.minStayTitle : copy.bkTitle}
          // 시트는 **높이 고정** — 값을 넣을 때마다 줄 수가 바뀌어 시트 위 끝이 오르내렸다(2026-10-02 사용자 지적).
          className="flex h-[88dvh] flex-col"
          onClose={() => setOverlay(null)}
        >
          {/* 가격 · 최소숙박 · 차단 — 모두 모바일 전용 시트(시안 v3 · 2026-10-02). 계산 · 서버 경로는 데스크톱 패널과 같다.
              성공하면 시트가 스스로 미끄러져 닫히고 탭 바 위 알림으로 진행 · 결과(되돌리기)를 보여 준다. 실패하면 열린 채
              이유를 보여 준다. 「선택 해제」도 시트를 닫는다. */}
          {({ close }) =>
            panelKind === "price" ? (
              <MobileOpsPriceSheet
                cells={editableCells}
                copy={copy}
                onApplied={removeSentCells}
                onClear={() => {
                  clearSelection();
                  close();
                }}
                onSubmitted={(submitted) => {
                  close();
                  trackJobWrite(submitted);
                }}
                runWrite={runWrite}
                scopeSummary={scopeSummary}
              />
            ) : panelKind === "minstay" ? (
              <MobileOpsMinStaySheet
                cells={editableCells.map((cell) => {
                  const key = selectionCellKey(cell.roomKey, cell.date);
                  return {
                    date: cell.date,
                    minStay: pendingMinStay.get(key)?.value ?? rateAt(cell.roomKey, cell.date)?.minStay ?? null,
                    roomIds: cell.roomIds,
                    roomKey: cell.roomKey,
                    roomLabel: cell.roomLabel,
                  };
                })}
                copy={copy}
                gapContext={gapContext}
                onApplied={removeSentCells}
                onClear={() => {
                  clearSelection();
                  close();
                }}
                onSubmitted={(submitted) => {
                  close();
                  trackJobWrite(
                    submitted,
                    copy.mtMinStayDone.replace("{nights}", String(submitted.nights)).replace("{n}", String(submitted.count)),
                  );
                }}
                runWrite={runWrite}
                scopeSummary={scopeSummary}
              />
            ) : (
              <MobileOpsBlockSheet
                blockedKeys={blockedCells}
                cells={panelCells.map((cell) => ({
                  date: cell.date,
                  roomIds: cell.roomIds,
                  roomKey: cell.roomKey,
                  roomLabel: cell.roomLabel,
                }))}
                copy={copy}
                onClear={() => {
                  clearSelection();
                  close();
                }}
                onDone={({ at, mode, nights }) => {
                  clearSelection();
                  close();
                  toastSeqRef.current += 1;
                  setToast({
                    blockAt: at,
                    count: nights,
                    id: toastSeqRef.current,
                    kind: "done",
                    text: (mode === "block" ? copy.mtBlockDone : copy.mtUnblockDone).replace("{n}", String(nights)),
                  });
                }}
                scopeSummary={scopeSummary}
              />
            )
          }
        </BottomSheet>
      )}

      {toast && (
        <MobileOpsToast
          key={toast.id}
          onAction={
            toast.kind === "done" && toast.openReservationId
              ? () => {
                  const id = toast.openReservationId!;
                  setToast(null);
                  void loadOpsReservationPlacement(id).then((result) => {
                    if (result.ok) setOverlay({ kind: "reservation", placement: result.placement });
                  });
                }
              : toast.kind === "done" && (toast.jobId || toast.blockAt)
              ? () => void undoWrite({ blockAt: toast.blockAt, jobId: toast.jobId }, toast.count)
              : toast.kind === "partial" || toast.kind === "failed"
                ? () => {
                    setToast(null);
                    setOverlay({ kind: "history" });
                  }
                : undefined
          }
          onDismiss={() => setToast((current) => (current?.id === toast.id ? null : current))}
          toast={toast}
          copy={{
            done: copy.mtDone,
            failed: copy.mtFailed,
            history: copy.mtHistory,
            open: copy.mtOpen,
            partial: copy.mtPartial,
            queued: copy.mtQueued,
            slow: copy.mtSlow,
            undo: copy.mtUndo,
          }}
        />
      )}

      {overlay?.kind === "scope" && (
        // 범위로 고르기(화이트 리디자인 2026-10-16, 시안 SalesScope) — 데스크톱 편집 모드의 세 축(객실 × 기간 × 요일)을
        // 그대로 곱한다. 기간 축은 **주 단위**(요금이 주 단위로 움직인다 — `buildSelectableWeeks`)라 시안의 「부터 · 까지」
        // 입력 대신 주 버튼을 여러 개 고른다. 바닥에서 바로 가격 · 최소숙박 · 차단 시트로 넘어간다.
        <BottomSheet ariaLabel={copy.mScopeTitle} className="flex max-h-[88dvh] flex-col" onClose={() => setOverlay(null)}>
          <div className="mops-scope mops-vars">
            <div className="mops-scope__head">
              <b>{copy.mScopeTitle}</b>
              <span>{copy.mScopeHint}</span>
            </div>
            <div className="mops-scope__body">
              <div className="mops-scope__axis">
                <span className="mops-scope__label">{copy.scopeRooms}</span>
                <div className="mops-wseg" role="group" aria-label={copy.scopeRooms}>
                  <button
                    aria-pressed={allRoomsInScope}
                    className={allRoomsInScope ? "on" : ""}
                    onClick={() => applyScope({ ...scope, roomKeys: allRoomsInScope ? [] : roomKeys })}
                    type="button"
                  >
                    {copy.mScopeRoomsAll}
                  </button>
                  <button
                    aria-pressed={scope.roomKeys.length > 0 && !allRoomsInScope}
                    className={scope.roomKeys.length > 0 && !allRoomsInScope ? "on" : ""}
                    disabled={scope.roomKeys.length === 0 || allRoomsInScope}
                    onClick={() => applyScope({ ...scope, roomKeys: [] })}
                    title={copy.mScopeRoomsPicked.replace("{n}", String(scope.roomKeys.length))}
                    type="button"
                  >
                    {copy.mwScopeRoomsPicked.replace("{n}", String(allRoomsInScope ? 0 : scope.roomKeys.length))}
                  </button>
                </div>
              </div>
              <div className="mops-scope__axis">
                <span className="mops-scope__label">
                  {copy.scopeWeeks}
                  <em>{opsWindowLabel(days).replace("–", " – ")}</em>
                </span>
                <div className="mops-wseg wrap" role="group" aria-label={copy.scopeWeeks}>
                  <button
                    aria-pressed={scope.weekStarts.length === 0}
                    className={scope.weekStarts.length === 0 ? "on" : ""}
                    onClick={() => applyScope({ ...scope, weekStarts: [] })}
                    type="button"
                  >
                    {copy.scopeAll}
                  </button>
                  {weeks.map((week) => {
                    const on = scope.weekStarts.includes(week.start);
                    return (
                      <button
                        aria-pressed={on}
                        className={on ? "on" : ""}
                        key={week.start}
                        onClick={() => applyScope({ ...scope, weekStarts: toggleInList(scope.weekStarts, week.start) })}
                        type="button"
                      >
                        {shortDate(week.start)} – {shortDate(week.end)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mops-scope__axis">
                <span className="mops-scope__label">{copy.scopeDays}</span>
                <div className="mops-wseg" role="group" aria-label={copy.scopeDays}>
                  {(() => {
                    const weekendOn =
                      scope.weekdays.length === 3 && WEEKEND_WEEKDAYS.every((d) => scope.weekdays.includes(d));
                    const weekdayOn =
                      scope.weekdays.length === 4 && WEEKDAY_WEEKDAYS.every((d) => scope.weekdays.includes(d));
                    return (
                      <>
                        <button
                          aria-pressed={scope.weekdays.length === 0}
                          className={scope.weekdays.length === 0 ? "on" : ""}
                          onClick={() => applyScope({ ...scope, weekdays: [] })}
                          type="button"
                        >
                          {copy.scopeAll}
                        </button>
                        <button
                          aria-pressed={weekendOn}
                          className={weekendOn ? "on" : ""}
                          onClick={() => applyScope({ ...scope, weekdays: toggleWeekdayPreset(scope.weekdays, WEEKEND_WEEKDAYS) })}
                          type="button"
                        >
                          {copy.scopeWeekend}
                        </button>
                        <button
                          aria-pressed={weekdayOn}
                          className={weekdayOn ? "on" : ""}
                          onClick={() => applyScope({ ...scope, weekdays: toggleWeekdayPreset(scope.weekdays, WEEKDAY_WEEKDAYS) })}
                          type="button"
                        >
                          {copy.scopeWeekday}
                        </button>
                      </>
                    );
                  })()}
                </div>
                <div className="mops-scope__days">
                  {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
                    const on = scope.weekdays.includes(weekday);
                    return (
                      <button
                        aria-pressed={on}
                        className={`${on ? "on" : ""}${weekday === 0 || weekday >= 5 ? " we" : ""}`}
                        key={weekday}
                        onClick={() => applyScope({ ...scope, weekdays: toggleInList(scope.weekdays, weekday) })}
                        type="button"
                      >
                        {copy.weekDaysFromSunday[weekday]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mops-scope__foot">
              <div className="mops-scope__sum">
                <p>
                  <b>{copy.mSelCount.replace("{n}", String(selCount))}</b>
                  {selCount > 0 && (
                    <span>
                      {copy.mwScopeCount
                        .replace("{rooms}", String(selRoomCount))
                        .replace("{days}", String(new Set(selection.map((cell) => cell.date)).size))}
                    </span>
                  )}
                </p>
                <button disabled={selCount === 0 && !scopeActive} onClick={clearSelection} type="button">
                  {copy.scopeClear}
                </button>
              </div>
              <div className="mops-dock__acts">
                <button className="mops-dock__act go" disabled={selCount === 0} onClick={() => setOverlay({ kind: "price" })} type="button">
                  {copy.mActPrice}
                </button>
                <button className="mops-dock__act ms" disabled={selCount === 0} onClick={() => setOverlay({ kind: "minstay" })} type="button">
                  {copy.mActMinStay}
                </button>
                <button className="mops-dock__act blk" disabled={selCount === 0} onClick={() => setOverlay({ kind: "block" })} type="button">
                  {copy.mActBlock}
                </button>
              </div>
            </div>
          </div>
        </BottomSheet>
      )}

      {overlay?.kind === "history" && (
        <BottomSheet ariaLabel={copy.hsTitle} className="flex h-[88dvh] flex-col" onClose={() => setOverlay(null)}>
          {({ close }) => (
          <div className="adm ops mops-panel mops-side">
            <OpsHistoryPanel copy={copy} onClose={close} />
          </div>
          )}
        </BottomSheet>
      )}

      {overlay?.kind === "wins" && (
        <BottomSheet ariaLabel={copy.pwList} className="flex max-h-[88dvh] flex-col" onClose={() => setOverlay(null)}>
          {({ close }) => (
          <div className="adm ops mops-panel mops-side">
            <OpsPriceWinsPanel
              conversions={priceConversions}
              copy={copy}
              localeTag={copy.localeTag}
              onClose={close}
              onOpenReservation={(conversion) =>
                setOverlay({
                  kind: "reservation",
                  placement: {
                    bar: {
                      channel: conversion.channel,
                      checkIn: conversion.checkIn,
                      checkOut: conversion.checkOut,
                      guestName: conversion.guestName,
                      id: conversion.reservationId,
                      isCancelled: false,
                      roomKey: conversion.roomKey,
                    },
                    propertyName: conversion.propertyName,
                    roomIds: rowByKey.get(conversion.roomKey)?.room.roomIds ?? [],
                    roomLabel: conversion.roomLabel,
                  },
                })
              }
              propertyName={
                selectedProperties.length > 1
                  ? selectedProperties.join(" · ")
                  : new Set(rooms.map((room) => room.propertyName)).size === 1
                    ? (rooms[0]?.propertyName ?? null)
                    : null
              }
              windowLabel={opsWindowLabel(days)}
            />
          </div>
          )}
        </BottomSheet>
      )}

      {overlay?.kind === "recent" && (
        <BottomSheet ariaLabel={copy.rbTitle} className="flex max-h-[88dvh] flex-col" onClose={() => setOverlay(null)}>
          {({ close }) => (
          <div className="adm ops mops-panel mops-side">
            <OpsRecentBookingsPanel
              bookings={recentBookings}
              copy={copy}
              localeTag={copy.localeTag}
              onApplyRange={recent.setRange}
              onClose={close}
              onOpenReservation={(booking) =>
                setOverlay({
                  kind: "reservation",
                  placement: {
                    bar: {
                      channel: booking.channel,
                      checkIn: booking.checkIn,
                      checkOut: booking.checkOut,
                      guestName: booking.guestName,
                      id: booking.reservationId,
                      isCancelled: false,
                      roomKey: booking.roomKey,
                    },
                    propertyName: booking.propertyName,
                    roomIds: rowByKey.get(booking.roomKey)?.room.roomIds ?? [],
                    roomLabel: booking.roomLabel,
                  },
                })
              }
              onResetRange={recent.resetRange}
              propertyName={
                selectedProperties.length > 1
                  ? selectedProperties.join(" · ")
                  : new Set(rooms.map((room) => room.propertyName)).size === 1
                    ? (rooms[0]?.propertyName ?? null)
                    : null
              }
              range={recent.range}
            />
          </div>
          )}
        </BottomSheet>
      )}

      {overlay?.kind === "reservation" && (
        // 예약 상세 · 수정 · 취소 — 모바일 전용 시트(시안 v3 5a~5d). 높이 고정(불러오는 동안 튀지 않게).
        <BottomSheet ariaLabel={copy.rpTitle} className="flex h-[88dvh] flex-col" onClose={() => setOverlay(null)}>
          {({ close }) => (
            <MobileOpsReservationSheet
              bar={overlay.placement.bar}
              copy={copy}
              key={overlay.placement.bar.id}
              localeTag={copy.localeTag}
              nights={Math.max(
                0,
                Math.round((Date.parse(overlay.placement.bar.checkOut) - Date.parse(overlay.placement.bar.checkIn)) / 86_400_000),
              )}
              onCancelled={() => {
                close();
                showToast({ kind: "done", text: copy.mtCancelled.replace("{name}", overlay.placement.bar.guestName) });
                startRefresh(() => router.refresh());
              }}
              onSaved={() => {
                close();
                showToast({ kind: "done", text: copy.mtSaved.replace("{name}", overlay.placement.bar.guestName) });
                startRefresh(() => router.refresh());
              }}
              moveRooms={moveRooms}
              onMoved={(moved) => {
                close();
                showToast({
                  kind: "done",
                  text: copy.mvDone
                    .replace("{guest}", moved.guestName)
                    .replace("{from}", moved.from.room.label)
                    .replace("{to}", moved.to.room.label),
                });
                startRefresh(() => router.refresh());
              }}
              propertyName={overlay.placement.propertyName}
              roomIds={overlay.placement.roomIds}
              roomKey={overlay.placement.bar.roomKey}
              roomLabel={overlay.placement.roomLabel}
              today={today}
            />
          )}
        </BottomSheet>
      )}

      {overlay?.kind === "booking" && (
        // 수기 예약 — 모바일 전용 시트(시안 v3 5e). 만들어지면 알림 「열기」로 방금 만든 예약 상세.
        <BottomSheet ariaLabel={copy.mBook} className="flex h-[88dvh] flex-col" onClose={() => setOverlay(null)}>
          {({ close }) => (
            <MobileOpsBookingSheet
              checkIn={overlay.checkIn}
              checkOut={overlay.checkOut}
              copy={copy}
              localeTag={copy.localeTag}
              onCancel={close}
              onCreated={({ guestName, nights, reservationId }) => {
                clearSelection();
                close();
                showToast({
                  kind: "done",
                  openReservationId: reservationId ?? undefined,
                  text: copy.mtCreated.replace("{name}", guestName).replace("{n}", String(nights)),
                });
                startRefresh(() => router.refresh());
              }}
              rateAt={(date) => {
                const rate = rateAt(overlay.room.key, date);
                return { airbnb: rate?.price ?? null, booking: rate?.bookingPrice ?? null };
              }}
              room={overlay.room}
              today={today}
            />
          )}
        </BottomSheet>
      )}

      {overlay?.kind === "cellHistory" &&
        (() => {
          const row = rowByKey.get(overlay.roomKey);
          const key = selectionCellKey(overlay.roomKey, overlay.date);
          const rate = rateAt(overlay.roomKey, overlay.date);
          const loaded = cellHistory?.key === key ? cellHistory : null;
          return (
            <BottomSheet ariaLabel={copy.mCellHistory} className="flex max-h-[80dvh] flex-col" onClose={() => setOverlay(null)}>
              <div className="adm ops mops-panel mops-hc" ref={setHistoryHost}>
                {row && historyHost && (
                  <OpsCellHistoryCard
                    anchor={historyHost.getBoundingClientRect()}
                    container={historyHost}
                    copy={copy}
                    currentMinStay={pendingMinStay.get(key)?.value ?? rate?.minStay ?? null}
                    currentPrice={pendingPrices.get(key)?.value ?? rate?.price ?? null}
                    date={overlay.date}
                    history={loaded ? loaded.history : null}
                    localeTag={copy.localeTag}
                    roomTitle={`${row.room.propertyName} ${row.room.displayRoomLabel}`}
                  />
                )}
              </div>
            </BottomSheet>
          );
        })()}

      {overlay?.kind === "blockInfo" && (
        // 차단 정보(화이트 리디자인 2026-10-16, 시안 SalesBlockInfo) — 제목 · 「건물 · 객실 · 기간 · N박」 · 가는 가로줄 목록.
        <BottomSheet ariaLabel={copy.mBlockInfoTitle} onClose={() => setOverlay(null)}>
          <div className="mops-binfo mops-vars">
            <div className="mops-binfo__head">
              <b>{copy.mBlockInfoTitle}</b>
              <span>
                {overlay.roomTitle} · {shortDate(overlay.block.startDate)} → {shortDate(addDays(overlay.block.endDate, 1))} ·{" "}
                {copy.mwNights.replace(
                  "{n}",
                  String(
                    Math.round((Date.parse(overlay.block.endDate) - Date.parse(overlay.block.startDate)) / 86_400_000) + 1,
                  ),
                )}
              </span>
            </div>
            {overlay.block.purpose || overlay.block.memo || overlay.block.by || overlay.block.at ? (
              <dl className="mops-binfo__list">
                {overlay.block.purpose && (
                  <div>
                    <dt>{copy.mBlockReason}</dt>
                    <dd>{(copy.bkPurposes as Record<string, string>)[overlay.block.purpose] ?? overlay.block.purpose}</dd>
                  </div>
                )}
                {overlay.block.memo && (
                  <div>
                    <dt>{copy.mBlockMemo}</dt>
                    <dd>{overlay.block.memo}</dd>
                  </div>
                )}
                {(overlay.block.by || overlay.block.at) && (
                  <div>
                    <dt>{copy.mBlockBy}</dt>
                    <dd>
                      {copy.blockNoteBy
                        .replace("{name}", overlay.block.by ?? "")
                        .replace("{date}", overlay.block.at ? tokyoStamp(overlay.block.at) : "")
                        .replace(/^ · | · $/g, "")}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="mops-binfo__none">{copy.mBlockNoInfo}</p>
            )}
            <p className="mops-binfo__hint">{copy.mwBlockUnblockHint}</p>
          </div>
        </BottomSheet>
      )}

      {overlay?.kind === "jump" && (
        <DatePickerSheet
          labels={{ nextMonth: copy.dateNext, prevMonth: copy.datePrev, title: copy.mJump, today: copy.today }}
          locale={copy.localeTag}
          onClose={() => setOverlay(null)}
          onSelect={jumpTo}
          today={today}
          value={nav.isRolling ? jump.start : `${jump.month}-01`}
        />
      )}


      {salesOpen && days.length > 0 && (
        <OpsSalesSummarySheet
          copy={copy}
          days={days.length}
          onClose={() => setSalesOpen(false)}
          properties={selectedProperties}
          scope={rows}
          start={days[0].date}
        />
      )}
    </div>
  );
}

type DockExtra = { key: string; label: string; onClick: () => void };

/**
 * 선택 도구줄(화이트 리디자인 2026-10-16, 시안 SalesSelect · SalesBook). 흰 바탕 · 위 22px 둥근 모서리 · 아이콘 없는 글자 버튼.
 * 위 줄 = **몇 칸**(보라) · 어디 · 「선택 해제」. 가운데 = 가격(채움) · 최소숙박(옅은 보라) · 차단(옅은 빨강).
 * 상황에 맞으면 아래 줄에 「예약 만들기 · N박」(한 객실의 이어진 빈 밤) · 「이력」(한 칸)이 붙는다.
 * **아래로 밀면 선택을 푼다**(시트의 끌어서 닫기와 같은 손짓 · 같은 문턱) — 버튼 위에서 시작해도 밀 수 있다. 조금이라도
 * 끌었으면 그 손짓 끝의 click 은 버튼에 보내지 않는다.
 */
function MobileOpsDock({
  count,
  extras,
  labels,
  onClear,
  onOpen,
  summary,
}: {
  count: string;
  extras: DockExtra[];
  labels: { price: string; minStay: string; block: string; clear: string };
  onClear: () => void;
  onOpen: (kind: PanelKind) => void;
  summary: string;
}) {
  const [dragY, setDragY] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const startRef = useRef<{ y: number; id: number } | null>(null);
  const movedRef = useRef(false);
  const DISMISS = 56;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    startRef.current = { id: event.pointerId, y: event.clientY };
    movedRef.current = false;
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.id !== event.pointerId) return;
    const dy = event.clientY - start.y;
    if (!movedRef.current && Math.abs(dy) > 6) {
      movedRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (movedRef.current) setDragY(Math.max(0, dy));
  };
  const onPointerEnd = () => {
    if (!startRef.current) return;
    startRef.current = null;
    if (dragY > DISMISS) {
      setLeaving(true);
      setTimeout(onClear, 200);
    } else {
      setDragY(0);
    }
  };
  const onClickCapture = (event: React.MouseEvent) => {
    if (!movedRef.current) return;
    movedRef.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  return (
    <div
      aria-label={count}
      className={`mops-dock${dragY > 0 && !leaving ? " is-dragging" : ""}`}
      onClickCapture={onClickCapture}
      onPointerCancel={onPointerEnd}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      role="toolbar"
      style={{ transform: leaving ? "translateY(110%)" : dragY > 0 ? `translateY(${dragY}px)` : undefined }}
    >
      <div className="mops-dock__info">
        <p>
          <b>{count}</b>
          <span>{summary}</span>
        </p>
        <button className="mops-dock__clear" onClick={onClear} type="button">
          {labels.clear}
        </button>
      </div>
      <div className="mops-dock__acts">
        <button className="mops-dock__act go" onClick={() => onOpen("price")} type="button">
          {labels.price}
        </button>
        <button className="mops-dock__act ms" onClick={() => onOpen("minstay")} type="button">
          {labels.minStay}
        </button>
        <button className="mops-dock__act blk" onClick={() => onOpen("block")} type="button">
          {labels.block}
        </button>
      </div>
      {extras.length > 0 && (
        <div className="mops-dock__more" style={{ gridTemplateColumns: `repeat(${extras.length}, minmax(0, 1fr))` }}>
          {extras.map((extra) => (
            <button className="mops-dock__act more" key={extra.key} onClick={extra.onClick} type="button">
              {extra.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 객실 한 줄. **자기 몫의 값만** 받는다 — 선택은 칸마다 한 글자인 문자열이라, 고른 칸이 바뀌어도 그 줄이
 * 아니면 다시 그리지 않는다(끄는 동안 수십 번 바뀐다).
 */
const MobileOpsRow = memo(function MobileOpsRow({
  copy,
  days,
  pending,
  priceWinsOnly,
  row,
  rowIndex,
  scopeOn,
  selFlags,
  showCancelled,
  solo,
  today,
  urgFlags,
  winIds,
}: {
  copy: { blockLabel: string; bkPurposes: Record<string, string> };
  days: OpsCalendarDay[];
  pending: { price: Map<string, number>; minStay: Map<string, number>; settled: Set<string> } | undefined;
  priceWinsOnly: boolean;
  row: OpsGridRowData;
  rowIndex: number;
  /** 객실 축에 들어 있다(데스크톱 객실명 강조와 같다). */
  scopeOn: boolean;
  selFlags: string;
  showCancelled: boolean;
  /** 객실 하나뿐인 건물(독채) — 묶음 머리 대신 객실 열에 건물 이름을 적는다. */
  solo: boolean;
  today: string;
  urgFlags: string;
  /** 가격 개입 성공 막대 id(`|` 로 이음). 토글이 꺼져 있으면 빈 문자열. */
  winIds: string;
}) {
  const first = days[0]?.date ?? "";
  const last = days.at(-1)?.date ?? "";
  const indexOf = (date: string) => days.findIndex((day) => day.date === date);
  const wins = new Set(winIds ? winIds.split("|") : []);
  // 보기 모드로 거른다 — 「취소 보기」면 취소만, 아니면 살아 있는 예약만(데스크톱과 같다).
  const bars = row.bars.filter((bar) => bar.isCancelled === showCancelled && bar.checkOut > first && bar.checkIn <= last);
  const barLanes = assignBarLanes(bars);
  const blocks = row.blocks.filter((block) => block.endDate >= first && block.startDate <= last);
  // 차단은 예약 층 아래 따로 둔 줄에(데스크톱과 같다, 2026-10-06) — 0층은 예약 막대 · 빈 칸 자리.
  const blockLanes = assignBlockLanes(
    bars.map((bar) => ({ checkIn: bar.checkIn, checkOut: bar.checkOut, lane: barLanes.laneById.get(bar.id) ?? 0 })),
    blocks,
    { fromLane: Math.max(1, barLanes.laneCountByRoom.get(row.room.key) ?? 0) },
  );
  const laneCount = Math.max(1, blockLanes.laneCount, barLanes.laneCountByRoom.get(row.room.key) ?? 0);
  const height = TOP_H + laneCount * LANE_H + 4;

  return (
    <div className={`mops-row${solo ? " solo" : ""}`} data-r={rowIndex}
      // 줄 차례로 살짝 떠오름(건물을 바꿔 새 줄이 붙을 때만 — 실시간 새로고침은 같은 줄이라 다시 안 뜬다).
      style={{ height, "--mops-i": Math.min(rowIndex, 12) } as React.CSSProperties}
    >
      <button className={`mops-room${solo ? " solo" : ""}${scopeOn ? " on" : ""}`} data-room={row.room.key} type="button">
        {solo ? (
          <>
            <span className="mops-room__p">{row.room.propertyName}</span>
            {row.room.displayRoomLabel !== row.room.propertyName && (
              <span className="mops-room__l">{row.room.displayRoomLabel}</span>
            )}
          </>
        ) : (
          row.room.displayRoomLabel
        )}
      </button>
      <div className="mops-track">
        {days.map((day, index) => {
          const rate = decodeRowRate(row.rates, index);
          const price = pending?.price.get(day.date) ?? rate?.price ?? null;
          const minStay = pending?.minStay.get(day.date) ?? rate?.minStay ?? null;
          const isPendingPrice = pending?.price.has(day.date) ?? false;
          const isPendingMin = pending?.minStay.has(day.date) ?? false;
          const priceDone = isPendingPrice && (pending?.settled.has(`p:${day.date}`) ?? false);
          const minDone = isPendingMin && (pending?.settled.has(`m:${day.date}`) ?? false);
          const selected = selFlags !== "" && dayFlagAt(selFlags, index);
          const urgent = urgFlags !== "" && dayFlagAt(urgFlags, index);
          const gap = dayFlagAt(row.gap, index);
          const msClass = minStay === 1 ? " ms1" : minStay !== null && minStay >= 3 ? " ms3" : "";
          return (
            <div
              className={`mops-c${day.isWeekend ? " we" : ""}${day.isToday ? " today" : ""}${day.date < today ? " past" : ""}${gap ? " gap" : ""}${urgent ? " urg" : ""}${selected ? " sel" : ""}`}
              data-i={index}
              key={day.date}
            >
              {dayFlagAt(row.history, index) && <i className="mops-hdot" />}
              {price !== null && <span className={`mops-p${isPendingPrice ? (priceDone ? " pend ok" : " pend") : ""}`}>{formatGridPrice(price)}</span>}
              {minStay !== null && (
                <span className={`mops-m${msClass}${isPendingMin ? (minDone ? " pend ok" : " pend") : ""}`}>
                  {/* 숫자만 적는다(데스크톱 격자와 같다) — 「2박」은 46px 칸에서 가격과 겹쳐 읽힌다. */}
                  {minStay}
                  {rate?.minStayByUnit && <sup>•</sup>}
                </span>
              )}
            </div>
          );
        })}
        {bars.map((bar) => {
          const startIndex = bar.checkIn < first ? -1 : indexOf(bar.checkIn);
          const endIndex = bar.checkOut > last ? days.length : indexOf(bar.checkOut);
          const left = startIndex < 0 ? 0 : (startIndex + 0.5) * CELL_W + 1;
          const right = endIndex >= days.length ? days.length * CELL_W : (endIndex + 0.5) * CELL_W - 1;
          const lane = barLanes.laneById.get(bar.id) ?? 0;
          const channel = bar.channel === "airbnb" ? "abnb" : bar.channel === "booking" ? "bkng" : "dir";
          const winClass = priceWinsOnly && !showCancelled ? (wins.has(bar.id) ? " pw-win" : " pw-dim") : "";
          return (
            <span
              className={`mops-bar-r ${channel}${startIndex < 0 ? " open-l" : ""}${bar.isCancelled ? " cxl" : ""}${winClass}`}
              data-bar={bar.id}
              key={bar.id}
              style={{ left, top: TOP_H + lane * LANE_H + BAR_DY, width: Math.max(12, right - left) }}
            >
              {bar.guestName}
            </span>
          );
        })}
        {blocks.map((block) => {
          const startIndex = block.startDate < first ? 0 : indexOf(block.startDate);
          const endIndex = block.endDate > last ? days.length - 1 : indexOf(block.endDate);
          const lane = blockLanes.laneById.get(block.id) ?? 0;
          return (
            <span
              className="mops-blk"
              data-block={block.id}
              key={block.id}
              style={{
                left: startIndex * CELL_W + 2,
                top: TOP_H + lane * LANE_H + BAR_DY,
                width: (endIndex - startIndex + 1) * CELL_W - 4,
              }}
            >
              {/* 사유가 있으면 막대에도 짧게 붙인다(데스크톱과 같다). */}
              {block.purpose && block.purpose in copy.bkPurposes
                ? `${copy.blockLabel} · ${copy.bkPurposes[block.purpose]}`
                : copy.blockLabel}
            </span>
          );
        })}
      </div>
    </div>
  );
});

/** 보고 있는 창 「9/28–10/27」 — 가격 개입 목록 머리에 쓴다. */
function opsWindowLabel(days: readonly { date: string }[]): string {
  const first = days[0]?.date;
  const last = days.at(-1)?.date;
  if (!first || !last) return "";
  const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  return `${md(first)}–${md(last)}`;
}
