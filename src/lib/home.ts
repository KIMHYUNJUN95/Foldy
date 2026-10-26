import type { AppSession } from "@/lib/session";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import {
  getCanonicalPropertyName,
  getCanonicalRoomLabel,
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  isExcludedOperationalRoom,
} from "@/lib/room-label-normalization";
import {
  buildGlobalExternalRoomToCanonical,
  buildPropertyRoomLookups,
  getActiveRoomCatalog,
  resolveReservationCanonicalRoomLabel,
} from "@/lib/rooms";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type ReservationStatus = Database["public"]["Enums"]["reservation_status"];

const EXCLUDED_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  "cancelled",
  "no_show",
];

type ReservationCountRow = {
  check_in_date: string;
  check_out_date: string;
  status: ReservationStatus;
};

export type HomeActivityEventType =
  | "cleaning_completed"
  | "lost_item_reported"
  | "maintenance_reported"
  | "order_requested"
  | "linen_returned";

export type HomeActivityEvent = {
  id: string;
  room: string;
  taskLabel?: string; // cleaning_completed 이벤트에만 존재
  timestamp: string; // ISO UTC
  type: HomeActivityEventType;
};

export type HomeCheckInOutCounts = {
  checkIns: number;
  checkOuts: number;
};

/** 오늘 체크인 / 체크아웃하는 예약 한 건 (홈 상세 시트용). */
export type HomeReservationRow = {
  id: string;
  guestName: string;
  propertyName: string;
  roomLabel: string;
  source: string;
};

export type HomeCheckInOutLists = {
  checkIns: HomeReservationRow[];
  checkOuts: HomeReservationRow[];
};

export type HomeActiveSession = {
  id: string;
  room_label: string;
  started_at: string;
  task_label: string;
};

export type HomeResult<T> =
  | { status: "ok"; data: T }
  | { status: "empty" }
  | { status: "error" };

/** JST(Asia/Tokyo = UTC+9) 기준 오늘 00:00–24:00 을 덮는 UTC 구간. */
function getTodayJstUtcRange() {
  const today = getCleaningOperatingDateKey();
  const start = new Date(`${today}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86_400_000);
  return { end: end.toISOString(), start: start.toISOString() };
}

export async function getHomeCheckInOutCounts(
  session: AppSession,
): Promise<HomeResult<HomeCheckInOutCounts>> {
  if (session.organization.id === "platform") return { status: "empty" };
  try {
    const supabase = await getSupabaseServerClient();
    const today = getCleaningOperatingDateKey();
    const { data, error } = await supabase
      .from("reservations")
      .select("check_in_date, check_out_date, status")
      .eq("organization_id", session.organization.id)
      .or(`check_in_date.eq.${today},check_out_date.eq.${today}`);
    if (error) return { status: "error" };
    const rows = ((data ?? []) as ReservationCountRow[]).filter(
      (r) => !EXCLUDED_RESERVATION_STATUSES.includes(r.status),
    );
    return {
      status: "ok",
      data: {
        checkIns: rows.filter((r) => r.check_in_date === today).length,
        checkOuts: rows.filter((r) => r.check_out_date === today).length,
      },
    };
  } catch {
    return { status: "error" };
  }
}

/**
 * 오늘의 체크인 / 체크아웃 예약 (홈 카운트 카드 뒤의 실제 게스트
 * 목록). 정렬된 목록을 반환하며 카운트는 길이일 뿐이다. 취소 / 노쇼는
 * `getHomeCheckInOutCounts` 와 같게 제외한다. 방/숙소 현지화는
 * 호출자에게 맡긴다 (건물 라벨 사전은 호출자가 가지고 있다).
 */
export async function getHomeCheckInOutReservations(
  session: AppSession,
): Promise<HomeResult<HomeCheckInOutLists>> {
  if (session.organization.id === "platform") {
    return { status: "ok", data: { checkIns: [], checkOuts: [] } };
  }
  try {
    const supabase = await getSupabaseServerClient();
    const today = getCleaningOperatingDateKey();
    // 예약 + 방 마스터 카탈로그를 함께 가져와 각 예약을
    // 캘린더와 똑같이 정식 방으로 해석한다 (카탈로그가
    // 권위 있는 방 축이며, `raw_payload.roomId` 로 계정 2개짜리 방을 구분한다).
    const [{ data, error }, catalog] = await Promise.all([
      supabase
        .from("reservations")
        .select(
          "id, guest_name, property_name, room_label, source, check_in_date, check_out_date, status, raw_payload",
        )
        .eq("organization_id", session.organization.id)
        .or(`check_in_date.eq.${today},check_out_date.eq.${today}`),
      getActiveRoomCatalog(session.organization.id, supabase),
    ]);
    if (error) return { status: "error" };

    type ReservationListRow = {
      id: string;
      guest_name: string | null;
      property_name: string | null;
      room_label: string | null;
      source: string | null;
      check_in_date: string;
      check_out_date: string;
      status: ReservationStatus;
      raw_payload: Database["public"]["Tables"]["reservations"]["Row"]["raw_payload"];
    };

    // 캘린더의 해석을 따른다: 카탈로그가 분류된 뒤에는 확정(string[] / undefined 아님),
    // 그 전에는 임시(정규화된 폴백).
    const lookups = buildPropertyRoomLookups(catalog ?? []);
    const globalExternalRoomToCanonical = buildGlobalExternalRoomToCanonical(catalog ?? []);
    const isAuthoritative = catalog !== undefined;

    const rows = ((data ?? []) as ReservationListRow[]).filter(
      (r) =>
        !EXCLUDED_RESERVATION_STATUSES.includes(r.status) &&
        !isExcludedOperationalProperty(r.property_name ?? "") &&
        !isExcludedOperationalRoom(r.property_name ?? "", r.room_label ?? ""),
    );

    // 캘린더가 그리는 것과 같은 정식 숙소 + 표시용 방 라벨로 해석한다.
    // 절대 버리지 않는다: 예약이 활성 방 마스터 행과 매핑되지 않으면
    // 정규화된 방 라벨로 대체해 게스트가 계속 보이게 한다 (캘린더 + 사내
    // 참조 시스템과 동일하며, 예약을 버리지 않는다).
    const toItem = (r: ReservationListRow): HomeReservationRow => {
      const canonicalProperty = getCanonicalPropertyName((r.property_name ?? "").trim());
      const internalKey =
        resolveReservationCanonicalRoomLabel(
          {
            property_name: r.property_name ?? "",
            room_label: r.room_label ?? "",
            raw_payload: r.raw_payload,
          },
          { lookups, globalExternalRoomToCanonical, isAuthoritative },
        ) || getCanonicalRoomLabel(canonicalProperty, (r.room_label ?? "").trim());
      // 오쿠보(방 키 == 숙소)이거나 빈 폴백 → 건물만 표시.
      const roomLabel =
        !internalKey || internalKey === canonicalProperty
          ? ""
          : getDisplayRoomLabel(canonicalProperty, internalKey);
      return {
        id: r.id,
        guestName: (r.guest_name ?? "").trim(),
        propertyName: canonicalProperty,
        roomLabel,
        source: (r.source ?? "").trim(),
      };
    };

    const byPlace = (a: HomeReservationRow, b: HomeReservationRow) =>
      a.propertyName.localeCompare(b.propertyName) ||
      a.roomLabel.localeCompare(b.roomLabel, undefined, { numeric: true });

    return {
      status: "ok",
      data: {
        checkIns: rows
          .filter((r) => r.check_in_date === today)
          .map(toItem)
          .sort(byPlace),
        checkOuts: rows
          .filter((r) => r.check_out_date === today)
          .map(toItem)
          .sort(byPlace),
      },
    };
  } catch {
    return { status: "error" };
  }
}

export async function getHomeTodayActivity(
  session: AppSession,
  limit = 5,
): Promise<HomeResult<HomeActivityEvent[]>> {
  if (session.organization.id === "platform") return { status: "empty" };
  try {
    const supabase = await getSupabaseServerClient();
    const today = getCleaningOperatingDateKey();
    const { start, end } = getTodayJstUtcRange();

    const [cleaningRes, lostRes, maintRes, orderRes, linenRes] = await Promise.all([
      supabase
        .from("cleaning_sessions")
        .select("id, room_label, task_label, completed_at")
        .eq("organization_id", session.organization.id)
        .eq("cleaning_date", today)
        .eq("status", "completed")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(limit),
      supabase
        .from("lost_items")
        .select("id, room_label, created_at")
        .eq("organization_id", session.organization.id)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("maintenance_reports")
        .select("id, room_label, created_at, property_name, is_building_only")
        .eq("organization_id", session.organization.id)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("order_requests")
        .select("id, building_name, room_label, created_at")
        .eq("organization_id", session.organization.id)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("linen_return_records")
        .select("id, building_name, created_at")
        .eq("organization_id", session.organization.id)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    if (cleaningRes.error || lostRes.error || maintRes.error || orderRes.error || linenRes.error) {
      return { status: "error" };
    }

    type CleaningActivityRow = { id: string; room_label: string; task_label: string; completed_at: string | null };
    type SimpleActivityRow = { id: string; room_label: string; created_at: string };
    type OrderActivityRow = { id: string; building_name: string; room_label: string; created_at: string };
    type LinenActivityRow = { id: string; building_name: string; created_at: string };

    const events: HomeActivityEvent[] = [];

    for (const row of (cleaningRes.data ?? []) as CleaningActivityRow[]) {
      if (row.completed_at) {
        events.push({
          id: `cleaning-${row.id}`,
          room: row.room_label,
          taskLabel: row.task_label,
          timestamp: row.completed_at,
          type: "cleaning_completed",
        });
      }
    }
    for (const row of (lostRes.data ?? []) as SimpleActivityRow[]) {
      events.push({
        id: `lost-${row.id}`,
        room: row.room_label,
        timestamp: row.created_at,
        type: "lost_item_reported",
      });
    }
    for (const row of (maintRes.data ?? []) as (SimpleActivityRow & {
      property_name: string | null;
      is_building_only: boolean | null;
    })[]) {
      events.push({
        id: `maint-${row.id}`,
        // 건물 전체 신고는 room_label 이 "-" 라(2026-10-26) 건물 이름을 자리 라벨로 쓴다 — 그리는 곳에서 번역된다.
        room: row.is_building_only && row.property_name ? row.property_name : row.room_label,
        timestamp: row.created_at,
        type: "maintenance_reported",
      });
    }
    for (const row of (orderRes.data ?? []) as OrderActivityRow[]) {
      events.push({
        id: `order-${row.id}`,
        // 건물 + 방으로 두어 홈 로그가 다른 이벤트와 같은 방식으로 현지화하게 한다.
        room: `${row.building_name} ${row.room_label}`.trim(),
        timestamp: row.created_at,
        type: "order_requested",
      });
    }
    for (const row of (linenRes.data ?? []) as LinenActivityRow[]) {
      events.push({
        id: `linen-${row.id}`,
        room: row.building_name,
        timestamp: row.created_at,
        type: "linen_returned",
      });
    }

    const sorted = events
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);

    if (sorted.length === 0) return { status: "empty" };
    return { status: "ok", data: sorted };
  } catch {
    return { status: "error" };
  }
}

export async function getHomeActiveCleaningSession(
  session: AppSession,
): Promise<HomeResult<HomeActiveSession>> {
  if (session.organization.id === "platform") return { status: "empty" };
  try {
    const supabase = await getSupabaseServerClient();
    const today = getCleaningOperatingDateKey();
    const { data, error } = await supabase
      .from("cleaning_sessions")
      .select("id, room_label, task_label, started_at")
      .eq("organization_id", session.organization.id)
      .eq("staff_user_id", session.user.id)
      .eq("cleaning_date", today)
      .eq("status", "in_progress")
      .maybeSingle();
    if (error) return { status: "error" };
    if (!data) return { status: "empty" };
    return { status: "ok", data: data as HomeActiveSession };
  } catch {
    return { status: "error" };
  }
}

/** ISO UTC 타임스탬프를 JST 의 HH:MM 으로 포맷. */
export function formatActivityTimeJst(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(isoTimestamp));
}
