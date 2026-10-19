"use client";

import { MobileCalendarView, type CalendarReservationItem, type CalendarRoomBlock } from "@/components/calendar/mobile-calendar-view";
import type { PropertyMapMeta } from "@/lib/property-map-links";
import type { Dictionary, Locale } from "@/lib/i18n";
import { useBeds24LiveRefresh } from "@/components/shared/beds24-live-refresh";

type MobileCalendarLiveViewProps = {
  wcopy: Dictionary["mobile"]["calendarW"];
  copy: {
    calendar: string;
    calendarBuildingChange: string;
    calendarBuildingHotelLabel: string;
    calendarBuildingHouseLabel: string;
    calendarBuildingPickerBody: string;
    calendarBuildingPickerQuestion: string;
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
    guestBreakdown: string;
    propertyLabel: string;
    reservationId: string;
    roomLabel: string;
    stayingToday: string;
    today: string;
  };
  isOutOfWindow: boolean;
  buildingInfos: PropertyMapMeta[];
  locale: Locale;
  organizationId: string;
  propertyLabelMap: Record<string, string>;
  propertyOptions: string[];
  propertyRoomsMap?: Record<string, string[]>;
  reservations: CalendarReservationItem[];
  roomBlocks: CalendarRoomBlock[];
  roomMasterRooms?: string[];
  roomSourceDebug?: {
    activeRoomLabels: string[];
    fetchWindow?: { from: string; to: string };
    mode: "authoritative_active" | "authoritative_zero" | "provisional";
    reservationsQuery?: "executed" | "skipped";
  } | null;
  selectedMonth: string;
  selectedMonthLabel: string;
  selectedProperty: string | null;
  statusLabels: Record<CalendarReservationItem["status"], string>;
  today: string;
  initialReservationId?: string | null;
};

export function MobileCalendarLiveView(props: MobileCalendarLiveViewProps) {
  // 웹훅 한 건에 다시 읽기 한 번 — Beds24 신호(예약 · 차단 · 요금) + 놓친 변경 따라잡기(끊김 복구 · 온라인 복귀 ·
  // 오래 가려졌다 다시 보임)를 판매 캘린더와 같은 공용 장치 하나로 처리한다(2026-10-09). 예전엔 여기서
  // `reservations` 의 postgres_changes 채널을 따로 열어 같은 변경에 refresh 가 두 번 돌았다(2026-10-19 제거).
  // `reservation_internal_notes` 는 realtime publication 에 없어 그 리스너는 한 번도 울리지 않았다 — 메모는
  // 저장한 기기가 액션의 revalidatePath 로 갱신하고, 다른 기기는 다음 읽기 때 반영된다.
  useBeds24LiveRefresh(props.organizationId);
  return <MobileCalendarView {...props} />;
}
