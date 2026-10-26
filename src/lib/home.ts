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
  taskLabel?: string; // only present for cleaning_completed events
  timestamp: string; // ISO UTC
  type: HomeActivityEventType;
};

export type HomeCheckInOutCounts = {
  checkIns: number;
  checkOuts: number;
};

/** A single reservation checking in / out today, for the home detail sheet. */
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

/** UTC window covering today 00:00–24:00 in JST (Asia/Tokyo = UTC+9). */
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
 * Today's check-in / check-out reservations (the actual guest list behind the home
 * count cards). Returns sorted lists; counts are just the lengths. Cancelled / no-show
 * are excluded, matching `getHomeCheckInOutCounts`. Room/property localization is left
 * to the caller (it owns the building-label dictionary).
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
    // Fetch reservations + the room-master catalog together so we can resolve each
    // reservation to its canonical room exactly like the calendar does (the catalog
    // is the authoritative room axis; `raw_payload.roomId` disambiguates 2-account rooms).
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

    // Mirror the calendar's resolution: authoritative once the catalog is classified
    // (string[] / non-undefined); provisional (normalized fallback) before that.
    const lookups = buildPropertyRoomLookups(catalog ?? []);
    const globalExternalRoomToCanonical = buildGlobalExternalRoomToCanonical(catalog ?? []);
    const isAuthoritative = catalog !== undefined;

    const rows = ((data ?? []) as ReservationListRow[]).filter(
      (r) =>
        !EXCLUDED_RESERVATION_STATUSES.includes(r.status) &&
        !isExcludedOperationalProperty(r.property_name ?? "") &&
        !isExcludedOperationalRoom(r.property_name ?? "", r.room_label ?? ""),
    );

    // Resolve to the same canonical property + display room label the calendar renders.
    // Never drop: if a reservation does not map to an active room-master row, fall back to
    // the normalized room label so the guest still appears (mirrors the calendar + the
    // in-house reference system, which never discards a booking).
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
      // Okubo (room key == property) or an empty fallback → show the building only.
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
        // building + room so the home log localizes it the same way as other events.
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

/** Format ISO UTC timestamp as HH:MM in JST. */
export function formatActivityTimeJst(isoTimestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(isoTimestamp));
}
