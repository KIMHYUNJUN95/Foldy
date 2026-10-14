"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { MobileCalendarView, type CalendarReservationItem, type CalendarRoomBlock } from "@/components/calendar/mobile-calendar-view";
import type { PropertyMapMeta } from "@/lib/property-map-links";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
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
  const router = useRouter();
  // Beds24 신호(차단 · 요금 · 예약 동기화) + **놓친 변경 따라잡기**는 판매 캘린더와 같은 공용 장치로(2026-10-09).
  // 연결이 끊겼다 다시 붙거나 · 네트워크가 돌아오거나 · 1분 넘게 가려졌던 화면이 다시 보이면 한 번 다시 읽는다 —
  // 예전엔 폰을 잠갔다 열면 그 사이 들어온 예약이 다음 변경 · 새로고침까지 안 보였다.
  useBeds24LiveRefresh(props.organizationId);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefreshRef = useRef(false);
  const channelName = useMemo(
    () => `calendar-reservations:${props.organizationId}`,
    [props.organizationId],
  );

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const scheduleRefresh = () => {
      if (document.visibilityState !== "visible") {
        pendingRefreshRef.current = true;
        return;
      }
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = setTimeout(() => {
        pendingRefreshRef.current = false;
        router.refresh();
      }, 250);
    };

    let wasDisconnected = false;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "reservations",
        filter: `organization_id=eq.${props.organizationId}`,
      }, () => {
        scheduleRefresh();
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "reservation_internal_notes",
        filter: `organization_id=eq.${props.organizationId}`,
      }, () => {
        scheduleRefresh();
      })
      .subscribe((status) => {
        // 이 구독이 끊겼다 **다시** 붙으면 그 사이 예약 · 메모 변경을 놓쳤을 수 있다 — 한 번 다시 읽는다.
        if (status === "SUBSCRIBED") {
          if (wasDisconnected) scheduleRefresh();
          wasDisconnected = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          wasDisconnected = true;
        }
      });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && pendingRefreshRef.current) {
        scheduleRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      void supabase.removeChannel(channel);
    };
  }, [channelName, props.organizationId, router]);

  return <MobileCalendarView {...props} />;
}
