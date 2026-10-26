import "server-only";

// 관리자 수리·점검 콘솔의 실제 데이터 계층. 다음 파일의 목(mock)을 대체한다:
// `src/components/admin/maintenance/maintenance-console-data.ts` (디자인 우선 이식, 2026-07-14).
// `admin-cleaning.ts` 와 같은 형태: 표시용으로 평평하게 만든 뷰 모델, 조직 범위 쿼리,
// 그리고 KPI 줄이 오해를 부르는 0 대신 "-" 를 보이게 하는 `loadError` 플래그.
//
// 두 값은 읽을 때 DERIVED 되며 저장하지 않는다:
//   · 재실 중(occupied) — 연결된 예약이 오늘(도쿄)을 덮는다.
//   · 오래된 미해결(aging) — `open` 상태로 MAINTENANCE_AGING_HOURS 를 넘김.
// docs/product/08-maintenance-workflow.md 참고.

import {
  MAINTENANCE_AGING_HOURS,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceStatus,
} from "@/lib/maintenance-constants";
import { getOrgMaintenanceReports, type MaintenanceReportWithReporter } from "@/lib/maintenance-reports";
import { resolveRequestLocation } from "@/lib/request-location";
import { getActiveRoomCatalogServer, type ActiveRoomCatalogItem } from "@/lib/rooms";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type AdminMaintenanceLink = {
  cleaning: { date: string; room: string; staff: string } | null;
  reservation: { checkIn: string; checkOut: string; guest: string } | null;
};

export type AdminMaintenanceReport = {
  id: string;
  /** 화면에 노출하는 짧은 번호. uuid 앞 6자리(대문자). */
  shortId: string;
  buildingLabel: string;
  buildingRaw: string | null;
  /** null = 건물 전체(공용부) 신고. */
  room: string | null;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  title: string;
  description: string;
  reporterId: string;
  reporterName: string;
  /** "YYYY-MM-DD HH:MM" (도쿄). */
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  completedByName: string | null;
  completedByAdmin: boolean;
  photos: readonly string[];
  resolutionPhotos: readonly string[];
  memo: string;
  /** DERIVED — 조회 시점에 예약이 방을 덮고 있으면 true. 저장값이 아니다. */
  occupied: boolean;
  /** DERIVED — open 상태로 MAINTENANCE_AGING_HOURS를 넘겼으면 true. */
  aging: boolean;
  link: AdminMaintenanceLink;
};

export type AdminMaintenanceData = {
  reports: AdminMaintenanceReport[];
  loadError: boolean;
};

const TOKYO_TZ = "Asia/Tokyo";

/** 도쿄 기준 "YYYY-MM-DD". */
function tokyoDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** 도쿄 기준 "YYYY-MM-DD HH:MM" — 콘솔 포매터가 기대하는 형식. */
function tokyoStamp(iso: string | null): string | null {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function todayKeyTokyo(): string {
  return tokyoDateKey(new Date().toISOString());
}

type ReservationRow = {
  check_in_date: string;
  check_out_date: string;
  guest_name: string;
  id: string;
};

type CleaningSessionRow = {
  id: string;
  room_label: string;
  staff_user_id: string | null;
  started_at: string | null;
};

/**
 * 링크된 예약/청소를 배치로 한 번씩만 조회한다 (행마다 조회하면 N+1).
 * 실패해도 리포트 자체는 살아야 하므로 빈 Map으로 degrade한다.
 */
async function collectLinks(
  reports: MaintenanceReportWithReporter[],
): Promise<{
  reservations: Map<string, ReservationRow>;
  sessions: Map<string, CleaningSessionRow>;
  staffNames: Map<string, string>;
}> {
  const empty = {
    reservations: new Map<string, ReservationRow>(),
    sessions: new Map<string, CleaningSessionRow>(),
    staffNames: new Map<string, string>(),
  };
  const reservationIds = [...new Set(reports.map((r) => r.reservation_id).filter(Boolean))] as string[];
  const sessionIds = [...new Set(reports.map((r) => r.cleaning_session_id).filter(Boolean))] as string[];
  if (reservationIds.length === 0 && sessionIds.length === 0) return empty;

  const supabase = await getSupabaseServerClient();

  async function loadReservations(): Promise<ReservationRow[]> {
    if (reservationIds.length === 0) return [];
    const { data } = await supabase
      .from("reservations")
      .select("id, guest_name, check_in_date, check_out_date")
      .in("id", reservationIds);
    return (data ?? []) as ReservationRow[];
  }
  async function loadSessions(): Promise<CleaningSessionRow[]> {
    if (sessionIds.length === 0) return [];
    const { data } = await supabase
      .from("cleaning_sessions")
      .select("id, room_label, staff_user_id, started_at")
      .in("id", sessionIds);
    return (data ?? []) as CleaningSessionRow[];
  }

  const [reservationResult, sessionResult] = await Promise.all([
    loadReservations().catch(() => [] as ReservationRow[]),
    loadSessions().catch(() => [] as CleaningSessionRow[]),
  ]);

  const staffIds = [...new Set(sessionResult.map((s) => s.staff_user_id).filter(Boolean))] as string[];
  const staffNames = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, name").in("id", staffIds);
    for (const p of (data ?? []) as { id: string; name: string }[]) {
      staffNames.set(p.id, p.name);
    }
  }

  return {
    reservations: new Map(reservationResult.map((r) => [r.id, r] as const)),
    sessions: new Map(sessionResult.map((s) => [s.id, s] as const)),
    staffNames,
  };
}

export async function getAdminMaintenance(
  session: AppSession,
  /** 건물 라벨 사전 (dictionary.cleaning.buildingLabels) — 청소 콘솔과 같은 표기를 쓰기 위해. */
  buildingLabels: Record<string, string>,
): Promise<AdminMaintenanceData> {
  let loadError = false;

  const [reports, roomCatalog] = await Promise.all([
    getOrgMaintenanceReports(session).catch(() => {
      loadError = true;
      return [] as MaintenanceReportWithReporter[];
    }),
    getActiveRoomCatalogServer(session.organization.id).catch(() => undefined),
  ]);

  const links = await collectLinks(reports).catch(() => ({
    reservations: new Map<string, ReservationRow>(),
    sessions: new Map<string, CleaningSessionRow>(),
    staffNames: new Map<string, string>(),
  }));

  const catalog: ActiveRoomCatalogItem[] | undefined = roomCatalog;
  const today = todayKeyTokyo();
  const agingCutoffMs = MAINTENANCE_AGING_HOURS * 60 * 60 * 1000;
  const nowMs = Date.now();

  const mapped: AdminMaintenanceReport[] = reports.map((row) => {
    const location = resolveRequestLocation(row.room_label, catalog, buildingLabels, row.property_name);

    const reservation = row.reservation_id ? (links.reservations.get(row.reservation_id) ?? null) : null;
    const cleaningSession = row.cleaning_session_id
      ? (links.sessions.get(row.cleaning_session_id) ?? null)
      : null;

    // 재실 중 — 저장값이 아니라 조회 시점 계산. check_in ≤ 오늘(Tokyo) < check_out.
    const occupied = reservation
      ? reservation.check_in_date <= today && today < reservation.check_out_date
      : false;

    const aging =
      row.status === "open" && nowMs - new Date(row.created_at).getTime() > agingCutoffMs;

    return {
      id: row.id,
      shortId: row.id.slice(0, 6).toUpperCase(),
      buildingLabel: location.buildingLabel ?? (row.property_name ?? ""),
      buildingRaw: row.property_name,
      room: row.is_building_only ? null : location.roomLabel,
      category: row.category,
      priority: row.priority,
      status: row.status,
      title: row.issue_title,
      description: row.description ?? "",
      reporterId: row.reported_by_user_id,
      reporterName: row.reporter_name,
      createdAt: tokyoStamp(row.created_at) ?? "",
      updatedAt: tokyoStamp(row.updated_at) ?? "",
      completedAt: tokyoStamp(row.completed_at),
      completedByName: row.completed_by_name,
      completedByAdmin: row.completed_by_admin,
      photos: row.image_urls,
      resolutionPhotos: row.resolution_image_urls,
      memo: row.resolution_memo ?? "",
      occupied,
      aging,
      link: {
        cleaning: cleaningSession
          ? {
              date: tokyoDateKey(cleaningSession.started_at ?? row.created_at),
              room: cleaningSession.room_label,
              staff: cleaningSession.staff_user_id
                ? (links.staffNames.get(cleaningSession.staff_user_id) ?? "")
                : "",
            }
          : null,
        reservation: reservation
          ? {
              checkIn: reservation.check_in_date,
              checkOut: reservation.check_out_date,
              guest: reservation.guest_name,
            }
          : null,
      },
    };
  });

  return { reports: mapped, loadError };
}
