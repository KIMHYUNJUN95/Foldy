import "server-only";

import type { AppSession } from "@/lib/session";
import {
  getCleaningOperatingDateKey,
  getCleaningSessionsForDate,
} from "@/lib/cleaning";
import { getDisplaySessionRoomLabel } from "@/lib/room-label-normalization";
import { getOrgMaintenanceReports } from "@/lib/maintenance-reports";
import { getOrgLostItems } from "@/lib/lost-found";
import { getOrgOrderRequests } from "@/lib/order-requests";
import { getAttendanceReviewQueue, type ReviewQueueItem } from "@/lib/attendance-review";
import { getVisibleAnnouncements } from "@/lib/announcements";
import { getVisibleTasks } from "@/lib/tasks";
import {
  getHomeCheckInOutCounts,
  getHomeCheckInOutReservations,
  type HomeReservationRow,
} from "@/lib/home";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getDictionary } from "@/lib/i18n";
import {
  buildDashboardBuildingMap,
  fetchBuildingMapSource,
  type DashboardBuildingMap,
} from "@/lib/admin-building-map";

/**
 * Admin dashboard home aggregation — the desktop operations console reads every
 * top-priority block from one server call. Each block is wrapped so a single
 * failing source never blanks the whole console (returns empty for that block).
 *
 * Wires the real domain queries (cleaning / maintenance / lost-found / orders /
 * attendance review / announcements / tasks / reservations). The shape is built
 * to be auto-refresh-ready (re-fetch on the server and re-render).
 *
 * See docs/product/05-admin-web-ia.md → "Dashboard Home".
 */

export type CleaningLive = {
  id: string;
  room: string;
  taskLabel: string;
  staff: string;
  startedAt: string | null;
};

export type QueueKind = "maintenance" | "lost" | "order";

export type QueueEntry = {
  id: string;
  kind: QueueKind;
  title: string;
  location: string;
  createdAt: string;
  urgent: boolean;
};

export type NoticeItem = {
  id: string;
  title: string;
  important: boolean;
  createdAt: string;
};

export type TodoItem = {
  id: string;
  title: string;
  done: boolean;
  priority: string;
};

export type AdminDashboardData = {
  ops: {
    occupiedRooms: number;
    totalRooms: number;
    checkIns: number;
    checkOuts: number;
    cleaningInProgress: number;
    openRequests: number;
    attendanceReview: number;
  };
  cleaning: CleaningLive[];
  queue: QueueEntry[];
  attendance: ReviewQueueItem[];
  notices: NoticeItem[];
  todos: TodoItem[];
  reservations: {
    checkIns: HomeReservationRow[];
    checkOuts: HomeReservationRow[];
  };
  /** 「오늘의 건물」 지도 카드 — 읽기 실패면 null(카드를 숨긴다). */
  buildingMap: DashboardBuildingMap | null;
};

const EMPTY: AdminDashboardData = {
  ops: { occupiedRooms: 0, totalRooms: 0, checkIns: 0, checkOuts: 0, cleaningInProgress: 0, openRequests: 0, attendanceReview: 0 },
  cleaning: [],
  queue: [],
  attendance: [],
  notices: [],
  todos: [],
  reservations: { checkIns: [], checkOuts: [] },
  buildingMap: null,
};

async function safe<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.warn(`[admin-dashboard] ${label} failed`, error);
    return fallback;
  }
}

// 재실 객실(점유율): 오늘 체크인~체크아웃 사이의 예약이 점유한 객실 수 / 활성 객실 총수.
async function getOccupancy(
  organizationId: string,
  today: string,
): Promise<{ occupied: number; total: number }> {
  const service = getSupabaseServiceClient();
  const [resvRes, rooms] = await Promise.all([
    service
      .from("reservations")
      .select("room_label, status")
      .eq("organization_id", organizationId)
      .lte("check_in_date", today)
      .gt("check_out_date", today),
    getActiveRoomCatalogServer(organizationId),
  ]);
  const rows = (resvRes.data ?? []) as { room_label: string | null; status: string }[];
  const occupiedRooms = new Set(
    rows
      .filter((r) => r.status !== "cancelled" && r.status !== "no_show" && r.room_label)
      .map((r) => r.room_label as string),
  );
  return { occupied: occupiedRooms.size, total: rooms?.length ?? 0 };
}

export async function getAdminDashboard(session: AppSession): Promise<AdminDashboardData> {
  if (session.organization.id === "platform") return EMPTY;

  const today = getCleaningOperatingDateKey();

  const [
    cleaningSessions,
    maintenance,
    lost,
    orders,
    review,
    announcements,
    tasks,
    checkCounts,
    reservations,
    occupancy,
    buildingSource,
  ] = await Promise.all([
    safe("cleaning", () => getCleaningSessionsForDate(session, today), []),
    safe("maintenance", () => getOrgMaintenanceReports(session), []),
    safe("lost", () => getOrgLostItems(session), []),
    safe("orders", () => getOrgOrderRequests(session), []),
    safe("attendanceReview", () => getAttendanceReviewQueue(session.organization.id, { limit: 8 }), []),
    safe("announcements", () => getVisibleAnnouncements(session), []),
    safe("tasks", () => getVisibleTasks(session), []),
    safe("checkCounts", () => getHomeCheckInOutCounts(session), { status: "empty" as const }),
    safe(
      "reservations",
      () => getHomeCheckInOutReservations(session),
      { status: "ok" as const, data: { checkIns: [], checkOuts: [] } },
    ),
    safe("occupancy", () => getOccupancy(session.organization.id, today), { occupied: 0, total: 0 }),
    safe("buildingMap", () => fetchBuildingMapSource(session, today), null),
  ]);

  // 진행 중 청소
  const cleaning: CleaningLive[] = cleaningSessions
    .filter((s) => s.status === "in_progress")
    .map((s) => ({
      id: s.id,
      room: getDisplaySessionRoomLabel(s.room_label),
      taskLabel: s.task_label ?? "",
      staff: s.staff_name || "",
      startedAt: s.started_at ?? null,
    }));

  // 즉시 처리 큐 (정비 open/in_progress · 분실물 registered · 주문 requested/approved)
  const maintenanceQueue: QueueEntry[] = maintenance
    .filter((m) => m.status === "open" || m.status === "in_progress")
    .map((m) => ({
      id: m.id,
      kind: "maintenance" as const,
      title: m.issue_title,
      location: [m.property_name, m.room_label].filter(Boolean).join(" · "),
      createdAt: m.created_at,
      // 2026-07-14: `priority`가 실제 컬럼이 되기 전에는 open 이면 전부 urgent로 표시했다(= 사실상
      // 전부 빨간색). 이제 신고자가 고른 우선순위를 그대로 쓴다.
      urgent: m.priority === "urgent",
    }));
  const lostQueue: QueueEntry[] = lost
    .filter((l) => l.status === "registered")
    .map((l) => ({
      id: l.id,
      kind: "lost" as const,
      title: l.item_name,
      location: l.room_label ?? "",
      createdAt: l.created_at,
      urgent: false,
    }));
  const orderQueue: QueueEntry[] = orders
    .filter((o) => o.status === "requested" || o.status === "approved")
    .map((o) => ({
      id: o.id,
      kind: "order" as const,
      title: o.title,
      location: [o.building_name, o.room_label].filter(Boolean).join(" · "),
      createdAt: o.created_at,
      urgent: o.urgency === "high",
    }));
  const queue = [...maintenanceQueue, ...lostQueue, ...orderQueue].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );

  // 중요 공지 (중요/고정 우선)
  const notices: NoticeItem[] = announcements
    .map((a) => ({
      id: a.id,
      title: a.title,
      important: Boolean(a.is_important),
      createdAt: a.published_at ?? a.created_at,
    }))
    .sort((a, b) => Number(b.important) - Number(a.important))
    .slice(0, 4);

  // 오늘 할 일 (오늘 예정 + 마감)
  const todos: TodoItem[] = tasks
    .filter((t) => t.scheduledDate === today || (t.dueAt ?? "").slice(0, 10) === today)
    .map((t) => ({
      id: t.id,
      title: t.title,
      done: t.status === "done" || t.status === "completed",
      priority: t.priority,
    }))
    .slice(0, 6);

  const checkIns = checkCounts.status === "ok" ? checkCounts.data.checkIns : 0;
  const checkOuts = checkCounts.status === "ok" ? checkCounts.data.checkOuts : 0;
  const resvLists =
    reservations.status === "ok" ? reservations.data : { checkIns: [], checkOuts: [] };

  return {
    ops: {
      occupiedRooms: occupancy.occupied,
      totalRooms: occupancy.total,
      checkIns,
      checkOuts,
      cleaningInProgress: cleaning.length,
      openRequests: queue.length,
      attendanceReview: review.length,
    },
    cleaning,
    queue,
    attendance: review,
    notices,
    todos,
    reservations: resvLists,
    buildingMap: buildingSource
      ? buildDashboardBuildingMap(
          buildingSource,
          cleaningSessions,
          today,
          getDictionary(session.user.preferredLanguage).cleaning.buildingLabels,
        )
      : null,
  };
}
