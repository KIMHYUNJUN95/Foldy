import "server-only";

import { getDictionary } from "@/lib/i18n";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
  localizePropertyName,
} from "@/lib/room-label-normalization";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { excludePendingInquiries } from "@/lib/beds24/reservation-status";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type ReservationPickRow = {
  reservationId: string;
  plat: "airbnb" | "booking" | "direct";
  propertyName: string;
  roomLabel: string;
  displayPropertyName: string;
  displayRoomLabel: string;
  place: string;
  guest: string;
  stay: string;
  meta: string;
  live: boolean;
  group: "staying" | "upcoming";
};

function detectPlatform(source: string): "airbnb" | "booking" | "direct" {
  const normalized = (source ?? "").toLowerCase();
  if (normalized.includes("airbnb")) return "airbnb";
  if (normalized.includes("booking")) return "booking";
  return "direct";
}

function fmtStayRange(checkIn: string, checkOut: string): string {
  const [, inMonth, inDay] = checkIn.split("-").map(Number);
  const [, outMonth, outDay] = checkOut.split("-").map(Number);
  return `${inMonth}/${inDay} - ${outMonth}/${outDay}`;
}

type ReservationRow = {
  id: string;
  guest_name: string;
  property_name: string;
  room_label: string;
  source: string;
  check_in_date: string;
  check_out_date: string;
};

/**
 * 예약 없이 건물·객실만 지정할 때 쓰는 선택지.
 *
 * 예약 피커는 「지금 머무는 / 30일 내 예약」만 보여 준다. 자사 홈페이지·전화·워크인처럼 **Beds24를
 * 거치지 않고 들어온 예약**은 그 목록에 아예 없어서, 예약 연결만으로는 건물·객실을 남길 방법이
 * 없었다(= 컴플레인이 어느 방 건인지 모른 채 쌓인다). 객실 마스터에서 직접 고르는 경로를 열어
 * 그 구멍을 막는다. 자유 텍스트가 아니라 마스터에서 고르게 하는 이유는 「문제 객실」 집계가
 * 표기 흔들림 없이 같은 키로 묶여야 하기 때문이다.
 */
export type PlacePickRow = {
  propertyId: string;
  propertyName: string;
  displayPropertyName: string;
  roomId: string;
  /** 정규화된 객실 라벨 — 저장·집계 키. 화면에는 `displayRoomLabel`을 쓴다. */
  roomLabel: string;
  displayRoomLabel: string;
};

export async function listComplaintPickerPlaces(
  organizationId: string,
  locale: string,
): Promise<PlacePickRow[]> {
  const catalog = await getActiveRoomCatalogServer(organizationId);
  if (!catalog) return [];

  const buildingLabels = getDictionary(locale).cleaning.buildingLabels;

  // 같은 물리 객실에 어카운트가 둘 붙어 있으면 카탈로그에 두 번 나온다 — 선택지는 한 번만 보여 준다.
  const seen = new Set<string>();
  const rows: PlacePickRow[] = [];
  for (const item of catalog) {
    const key = `${item.propertyName}::${item.canonicalRoomLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      propertyId: item.propertyId,
      propertyName: item.propertyName,
      displayPropertyName: localizePropertyName(item.propertyName, buildingLabels),
      roomId: item.roomId,
      roomLabel: item.canonicalRoomLabel,
      displayRoomLabel: localizePropertyName(item.displayRoomLabel, buildingLabels),
    });
  }

  return rows.sort(
    (left, right) =>
      left.displayPropertyName.localeCompare(right.displayPropertyName) ||
      left.displayRoomLabel.localeCompare(right.displayRoomLabel),
  );
}

export async function listComplaintPickerReservations(
  organizationId: string,
  locale: string,
): Promise<ReservationPickRow[]> {
  const supabase = getSupabaseServiceClient();
  const dict = getDictionary(locale);
  const buildingLabels = dict.cleaning.buildingLabels;

  const platformDisplay: Record<ReservationPickRow["plat"], string> = {
    airbnb: "Airbnb",
    booking: "Booking.com",
    direct: dict.complaints.platformDirect,
  };

  const tokyoFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" });
  const today = tokyoFormatter.format(new Date());
  const limit = new Date();
  limit.setDate(limit.getDate() + 30);
  const window30 = tokyoFormatter.format(limit);

  // 문의 · 예약 요청은 피드백을 붙일 예약 고르기에 내지 않는다(2026-11-19).
  const { data, error } = await excludePendingInquiries(
    supabase
      .from("reservations")
      .select("id, guest_name, property_name, room_label, source, check_in_date, check_out_date")
      .eq("organization_id", organizationId)
      .not("status", "in", '("cancelled","no_show")')
      .or(
        `and(check_in_date.lte.${today},check_out_date.gt.${today}),` +
          `and(check_in_date.gt.${today},check_in_date.lte.${window30})`,
      ),
  ).order("check_in_date", { ascending: true });

  if (error || !data) {
    return [];
  }

  const rows = (data as ReservationRow[])
    .filter((reservation) => {
      if (isExcludedOperationalProperty(reservation.property_name)) return false;
      if (isExcludedOperationalRoom(reservation.property_name, reservation.room_label)) return false;
      return true;
    })
    .map<ReservationPickRow>((reservation) => {
      const plat = detectPlatform(reservation.source ?? "");
      const stay = fmtStayRange(reservation.check_in_date, reservation.check_out_date);
      const live =
        reservation.check_in_date <= today && reservation.check_out_date > today;

      const canonicalProperty = getCanonicalPropertyName(reservation.property_name);
      const canonicalRoom = getCanonicalRoomLabel(
        reservation.property_name,
        reservation.room_label,
      );
      const displayRoom = getDisplayRoomLabel(canonicalProperty, canonicalRoom);
      const displayPropertyName = localizePropertyName(canonicalProperty, buildingLabels);
      const displayRoomLabel = localizePropertyName(displayRoom, buildingLabels);

      return {
        reservationId: reservation.id,
        plat,
        propertyName: canonicalProperty,
        roomLabel: displayRoom,
        displayPropertyName,
        displayRoomLabel,
        place: `${displayPropertyName} · ${displayRoomLabel}`,
        guest: reservation.guest_name,
        stay,
        meta: `${platformDisplay[plat]} · ${stay}`,
        live,
        group: live ? "staying" : "upcoming",
      };
    });

  return [
    ...rows.filter((row) => row.group === "staying"),
    ...rows.filter((row) => row.group === "upcoming"),
  ];
}
