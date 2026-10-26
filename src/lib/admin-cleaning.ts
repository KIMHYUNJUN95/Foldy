import "server-only";

import {
  BUILDING_ORDER,
  buildingKeyOf,
  type BuildingKey,
  type CleaningTaskType,
} from "@/components/admin/cleaning/cleaning-console-data";
import {
  cleaningOperatingTimeZone,
  getCleaningStaffOptions,
  getOrgCleaningSessionsFiltered,
  getOrgTodayCleaningSessions,
  isCleaningTaskKey,
  type CleaningSessionRow,
  type CleaningSessionWithStaff,
  type CleaningStaffOption,
} from "@/lib/cleaning";
import { getCleaningTargets, type SettingTarget } from "@/lib/cleaning-targets";
import type { CleaningExportFilters } from "@/lib/export/cleaning-filters";
import {
  buildLegacyAliasToRoomKeyMap,
  buildSessionLabelToRoomKeyMap,
  buildSessionRoomLabel,
  compareRoomLabel,
  getDisplayRoomLabel,
  getDisplaySessionRoomLabel,
  physicalRoomKeyOfSessionLabel,
  resolveRoomKey,
} from "@/lib/room-label-normalization";
import { getActiveRoomCatalogServer, type ActiveRoomCatalogItem } from "@/lib/rooms";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AppSession } from "@/lib/session";

// 관리자 청소 콘솔 "오늘 현황" 보드의 실데이터 레이어 — 예약에서 나온 오늘 대상 위에 실제
// cleaning_sessions 상태를 얹는다 (/mobile/cleaning 과 같은 출처). 다만 모바일 "미처리 큐"와 달리 관리자 보드는
// 처리된 방을 빼지 않고 모든 방을 현재 상태와 함께 계속
// 보여 준다. 참고:
// docs/product/07-cleaning-workflow.md → "2026-07-14 어드민 청소 대시보드 — 백엔드 연동".

export type AdminCleaningStatus = "pending" | "progress" | "done" | "cancelled";

export type AdminCleaningTask = {
  id: string;
  sessionId: string | null;
  roomKey: string;
  building: BuildingKey | null;
  buildingRaw: string;
  /** 표시용 라벨. 아라키초 서브유닛은 501_2 → 501 로 축약된다 — 저장/매칭에 쓰면 안 된다. */
  room: string;
  /**
   * 저장/매칭용 canonical `cleaning_sessions.room_label` ("아라키초A 501_2").
   * 모바일 큐(getCleaningTargets → sessionRoomLabel)와 동일한 값이라, 강제완료가 이 값을 그대로
   * 저장해야 모바일 큐에서도 처리 완료로 인식된다. 축약된 `room` 을 저장하면 매칭이 깨진다.
   */
  sessionRoomLabel: string;
  type: CleaningTaskType;
  status: AdminCleaningStatus;
  staffId: string | null;
  staffName: string | null;
  start: string | null;
  end: string | null;
  note: string;
  reports: { lost?: number; issue?: number; lostIds?: string[]; issueIds?: string[] } | null;
  proxy: boolean;
  /** 청소 배정 「처리 끝」으로 남긴 기록(청소 안 함) — 대리 완료 대신 「처리 끝 · 청소 안 함」으로 보인다. */
  closed: boolean;
  /**
   * 오늘 이 객실에서 취소된 세션 수. 취소는 모바일에서 "다시 청소 대상으로 되돌리는" 동작이라
   * (docs: cancelCleaningMessage) 카드 상태 자체는 `pending` 을 유지하고, 취소가 있었다는 사실만
   * 별도 배지로 노출한다.
   */
  cancelledCount: number;
  guest: string | null;
  pax: number | null;
  hasArrivalToday: boolean;
};

export type AdminSettingTarget = {
  roomKey: string;
  building: BuildingKey | null;
  buildingRaw: string;
  room: string;
  guest: string;
  pax: number | null;
};

export type AdminCleaningTodayData = {
  tasks: AdminCleaningTask[];
  setupTargets: AdminSettingTarget[];
  staff: CleaningStaffOption[];
  /** 오늘 데이터 소스가 하나라도 로드에 실패하면 true — KPI 띠가 건수 대신 "-" 를 보인다. */
  loadError: boolean;
};

function taskLabelToType(taskLabel: string): CleaningTaskType {
  if (!isCleaningTaskKey(taskLabel)) return "checkout";
  if (taskLabel === "long_stay") return "longstay";
  return taskLabel;
}


/** 고정된 운영 건물 순서. 알 수 없거나 매핑되지 않은 숙소는 표준 7개 뒤로 정렬된다. */
function buildingRank(building: BuildingKey | null): number {
  if (!building) return BUILDING_ORDER.length;
  const index = BUILDING_ORDER.indexOf(building);
  return index === -1 ? BUILDING_ORDER.length : index;
}

/** 건물 순 → 객실번호 순. 건물별 그룹과 상태별 버킷이 같은 정렬을 공유하도록 서버에서 한 번만 적용한다. */
function compareByBuildingThenRoom(
  a: { building: BuildingKey | null; buildingRaw: string; room: string },
  b: { building: BuildingKey | null; buildingRaw: string; room: string },
): number {
  return (
    buildingRank(a.building) - buildingRank(b.building) ||
    a.buildingRaw.localeCompare(b.buildingRaw, "ko") ||
    compareRoomLabel(a.room, b.room)
  );
}

function formatTokyoTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: cleaningOperatingTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 오늘 객실의 가장 관련 있는 세션: in_progress, 그다음 completed 를 우선하고, cancelled 뿐이면 없음. */
function pickRelevantSession(sessions: CleaningSessionRow[]): CleaningSessionRow | null {
  const live = sessions.filter((s) => s.status !== "cancelled");
  if (live.length === 0) return null;
  const inProgress = live.find((s) => s.status === "in_progress");
  if (inProgress) return inProgress;
  return live[0]; // getOrgTodayCleaningSessions 가 이미 started_at 내림차순으로 정렬해 줌
}

function countCancelled(sessions: CleaningSessionRow[]): number {
  return sessions.filter((s) => s.status === "cancelled").length;
}

/** DB `cleaning_status` → 콘솔 카드 상태. pending 은 세션이 아예 없는 예약 대상에만 쓰인다. */
function sessionStatusToAdminStatus(status: string): AdminCleaningStatus {
  if (status === "in_progress") return "progress";
  if (status === "cancelled") return "cancelled";
  return "done";
}

type ReportLinks = { lostIds: string[]; issueIds: string[] };

// 세션별로 실제 분실물/유지보수 신고 id 를 모은다(건수만이 아니라) — 상세
// 패널의 신고 타일이 숫자만 보이는 대신 연결된 기록으로 바로 이동할 수 있게 한다.
async function collectReportLinksBySession(
  organizationId: string,
  sessionIds: string[],
): Promise<Map<string, ReportLinks>> {
  const result = new Map<string, ReportLinks>();
  if (sessionIds.length === 0) return result;

  const supabase = await getSupabaseServerClient();
  // 기록 탭은 한 달치 세션 id 를 넘길 수 있어 URL 이 길어지지 않게 나눠서 묻는다.
  const chunks: string[][] = [];
  for (let i = 0; i < sessionIds.length; i += 150) chunks.push(sessionIds.slice(i, i + 150));
  const responses = await Promise.all(
    chunks.map((ids) =>
      Promise.all([
        supabase
          .from("lost_items")
          .select("id, cleaning_session_id")
          .eq("organization_id", organizationId)
          .in("cleaning_session_id", ids),
        supabase
          .from("maintenance_reports")
          .select("id, cleaning_session_id")
          .eq("organization_id", organizationId)
          .in("cleaning_session_id", ids),
      ]),
    ),
  );
  const lostRes = { data: responses.flatMap(([lost]) => lost.data ?? []) };
  const issueRes = { data: responses.flatMap(([, issue]) => issue.data ?? []) };

  for (const row of (lostRes.data ?? []) as { id: string; cleaning_session_id: string | null }[]) {
    if (!row.cleaning_session_id) continue;
    const entry = result.get(row.cleaning_session_id) ?? { lostIds: [], issueIds: [] };
    entry.lostIds.push(row.id);
    result.set(row.cleaning_session_id, entry);
  }
  for (const row of (issueRes.data ?? []) as { id: string; cleaning_session_id: string | null }[]) {
    if (!row.cleaning_session_id) continue;
    const entry = result.get(row.cleaning_session_id) ?? { lostIds: [], issueIds: [] };
    entry.issueIds.push(row.id);
    result.set(row.cleaning_session_id, entry);
  }
  return result;
}

/**
 * `date` 를 주면 그날의 현황을 만든다(기본값은 오늘). 대상은 예약에서 **재계산**하고 세션은 그날의
 * **사실**이라, 과거 날짜에서는 "해야 했던 것 vs 실제로 한 것"이 자연스럽게 대조된다 — 기록에 없는
 * 대상이 곧 빠뜨린 청소다(2026-08-04).
 */
export async function getAdminCleaningToday(
  session: AppSession,
  date?: string,
): Promise<AdminCleaningTodayData> {
  const organizationId = session.organization.id;

  let loadError = false;
  const [targetsResult, roomCatalog, orgTodaySessions, staff] = await Promise.all([
    getCleaningTargets(organizationId, date).catch(() => {
      loadError = true;
      return null;
    }),
    getActiveRoomCatalogServer(organizationId).catch(() => undefined),
    getOrgTodayCleaningSessions(organizationId, date).catch(() => {
      loadError = true;
      return [] as CleaningSessionRow[];
    }),
    getCleaningStaffOptions(organizationId).catch(() => {
      loadError = true;
      return [] as CleaningStaffOption[];
    }),
  ]);

  const catalog: ActiveRoomCatalogItem[] = roomCatalog ?? [];
  const catalogLabelMap = buildSessionLabelToRoomKeyMap(catalog);
  const legacyAliasMap = buildLegacyAliasToRoomKeyMap(catalog);
  const staffNameById = new Map(staff.map((s) => [s.id, s.name] as const));

  // 오늘의 모든 세션을 roomKey 로 해석한다. roomKey 별로 묶어 가장 관련 있는 세션을
  // (in_progress > completed > cancelled 뿐이면 없음) 방마다 찾는다.
  //
  // 짝짓기는 **실제 방** 단위(2026-10-15) — 아라키초는 한 방에 계정이 둘이라 「401」 예약 카드와 「401_2_2」 로 시작한 세션이
  // 같은 방이다. 글자 키로 짝지으면 카드는 「대기」로 남고 세션은 따로 「기타」 카드가 된다.
  const sessionsByRoomKey = new Map<string, CleaningSessionRow[]>();
  for (const s of orgTodaySessions) {
    const resolved = resolveRoomKey(s.room_label, catalogLabelMap, legacyAliasMap);
    const key = physicalRoomKeyOfSessionLabel(s.room_label) ?? resolved.roomKey ?? `unresolved:${s.room_label}`;
    const list = sessionsByRoomKey.get(key) ?? [];
    list.push(s);
    sessionsByRoomKey.set(key, list);
  }

  const targetRoomKeys = new Set<string>();
  const tasks: AdminCleaningTask[] = [];

  if (targetsResult) {
    for (const target of targetsResult.cleaningList) {
      const physicalKey = physicalRoomKeyOfSessionLabel(target.sessionRoomLabel) ?? target.roomKey;
      targetRoomKeys.add(physicalKey);
      const roomSessions = sessionsByRoomKey.get(physicalKey) ?? [];
      const matched = pickRelevantSession(roomSessions);

      // 취소만 있는 방은 모바일 큐에서 다시 "미처리"로 돌아가므로 콘솔에서도 `pending` 이 맞다.
      // 다만 취소가 있었다는 사실이 콘솔에서 완전히 사라지지 않도록 cancelledCount 로 남긴다.
      let status: AdminCleaningStatus = "pending";
      if (matched?.status === "in_progress") status = "progress";
      else if (matched?.status === "completed") status = "done";

      tasks.push({
        id: matched?.id ?? `pending:${target.roomKey}`,
        sessionId: matched?.id ?? null,
        roomKey: target.roomKey,
        building: buildingKeyOf(target.canonicalPropertyName),
        buildingRaw: target.canonicalPropertyName,
        room: getDisplayRoomLabel(target.canonicalPropertyName, target.canonicalRoomLabel),
        sessionRoomLabel: matched?.room_label ?? target.sessionRoomLabel,
        type: matched ? taskLabelToType(matched.task_label) : "checkout",
        status,
        staffId: matched?.staff_user_id ?? null,
        staffName: matched ? (staffNameById.get(matched.staff_user_id) ?? null) : null,
        start: formatTokyoTime(matched?.started_at ?? null),
        end: matched?.closed_without_cleaning ? null : formatTokyoTime(matched?.completed_at ?? null),
        note: matched?.notes ?? "",
        reports: null, // 아래에서 세션 id 를 알게 되면 채움
        proxy: Boolean(matched?.completed_by_admin),
        closed: Boolean(matched?.closed_without_cleaning),
        cancelledCount: countCancelled(roomSessions),
        guest: target.hasTurnover ? target.arrivingGuestName : null,
        pax: target.hasTurnover ? target.arrivingPax : null,
        hasArrivalToday: target.hasTurnover,
      });
    }
  }

  // 오늘 세션 중 예약 기반 대상에 해당하지 않는 것 (수동 / 장기 체류
  // 청소를 모바일 "기타" 섹션에서 시작했거나 임시 객실) — 그래도 카드로 보여 줘서
  // 실제로 일어나는 작업이 실데이터에서 조용히 사라지지 않게 한다.
  // 취소만 있는 방은 되돌아갈 예약 대상이 없으므로 "취소" 카드로 노출한다 — 예전처럼 통째로
  // 버리면 콘솔에서 그 세션이 존재조차 하지 않게 된다.
  for (const [roomKey, sessions] of sessionsByRoomKey) {
    if (targetRoomKeys.has(roomKey)) continue;
    const relevant = pickRelevantSession(sessions) ?? sessions[0]; // started_at 내림차순
    if (!relevant) continue;

    let buildingRaw = relevant.room_label;
    let room = getDisplaySessionRoomLabel(relevant.room_label);
    const catalogMatch = catalog.find(
      (item) =>
        buildSessionRoomLabel(item.propertyName, item.canonicalRoomLabel) === relevant.room_label ||
        item.canonicalRoomLabel === relevant.room_label,
    );
    if (catalogMatch) {
      buildingRaw = catalogMatch.propertyName;
      room = getDisplayRoomLabel(catalogMatch.propertyName, catalogMatch.canonicalRoomLabel);
    }

    tasks.push({
      id: relevant.id,
      sessionId: relevant.id,
      roomKey,
      building: buildingKeyOf(buildingRaw),
      buildingRaw,
      room,
      sessionRoomLabel: relevant.room_label,
      type: taskLabelToType(relevant.task_label),
      status: sessionStatusToAdminStatus(relevant.status),
      staffId: relevant.staff_user_id,
      staffName: staffNameById.get(relevant.staff_user_id) ?? null,
      start: formatTokyoTime(relevant.started_at),
      end: relevant.closed_without_cleaning ? null : formatTokyoTime(relevant.completed_at),
      note: relevant.notes ?? "",
      reports: null,
      proxy: Boolean(relevant.completed_by_admin),
      closed: Boolean(relevant.closed_without_cleaning),
      cancelledCount: countCancelled(sessions),
      guest: null,
      pax: null,
      hasArrivalToday: false,
    });
  }

  // 실제 세션이 있는 모든 작업에 연결된 분실물/유지보수 신고 id (와 파생 건수)를 붙여서
  // 상세 패널의 신고 타일이 연결된 기록으로 바로 이동할 수 있게 한다.
  const sessionIds = tasks.map((t) => t.sessionId).filter((id): id is string => id !== null);
  const reportLinks = await collectReportLinksBySession(organizationId, sessionIds).catch(
    () => new Map<string, ReportLinks>(),
  );
  for (const task of tasks) {
    if (!task.sessionId) continue;
    const links = reportLinks.get(task.sessionId);
    if (!links || (links.lostIds.length === 0 && links.issueIds.length === 0)) continue;
    task.reports = {
      lost: links.lostIds.length || undefined,
      issue: links.issueIds.length || undefined,
      lostIds: links.lostIds.length ? links.lostIds : undefined,
      issueIds: links.issueIds.length ? links.issueIds : undefined,
    };
  }

  const setupTargets: AdminSettingTarget[] = targetsResult
    ? targetsResult.settingList.map((target: SettingTarget) => ({
        roomKey: target.roomKey,
        building: buildingKeyOf(target.canonicalPropertyName),
        buildingRaw: target.canonicalPropertyName,
        room: getDisplayRoomLabel(target.canonicalPropertyName, target.canonicalRoomLabel),
        guest: target.arrivingGuestName,
        pax: target.arrivingPax,
      }))
    : [];

  // 대상은 예약 순서로 오고 임시 세션은 그 뒤에 붙으므로, 이게 없으면
  // 카드가 사실상 임의의 객실 순서(402 → 302 → 202)로 렌더된다. 정렬을 보드 컴포넌트가 아니라 여기서 하면
  // 건물별 그룹 / 상태별 버킷 / 셋팅 대상이 하나의 순서를 쓰게 된다.
  tasks.sort(compareByBuildingThenRoom);
  setupTargets.sort(compareByBuildingThenRoom);

  return { tasks, setupTargets, staff, loadError };
}

/* ============================================================
   기록 (history) 탭 — 기존 getOrgCleaningSessionsFiltered 위의 얇은 래퍼로,
   관리자 콘솔의 이력 표/내보내기가 이미 기대하는 모양으로 매핑한다.
   ============================================================ */

export type AdminCleaningHistoryItem = {
  id: string;
  date: string;
  building: BuildingKey | null;
  buildingRaw: string;
  room: string;
  type: CleaningTaskType;
  staffId: string;
  staffName: string;
  start: string;
  /** 분 단위 소요시간. 아직 끝나지 않았거나(진행중) 취소된 세션은 null. */
  dur: number | null;
  /** 실제 세션 상태(진행중/완료/취소) — 표의 "상태" 열은 이 값을 쓴다. */
  status: AdminCleaningStatus;
  /** 관리자 대리 완료 여부. 세션 상태와는 별개인 "완료 유형" 축. */
  proxy: boolean;
  /** 청소 배정 「처리 끝」으로 남긴 기록(청소 안 함). */
  closed: boolean;
  note: string;
  /** 이 세션에서 올라온 분실물 · 수리 신고(화이트 리디자인 2026-10-13 — 기록 표 · 상세의 「연결된 기록」). */
  reports: { lost?: number; issue?: number; lostIds?: string[]; issueIds?: string[] } | null;
};

function mapSessionToHistoryItem(
  s: CleaningSessionWithStaff,
  catalog: readonly ActiveRoomCatalogItem[],
): AdminCleaningHistoryItem {
  let buildingRaw = s.room_label;
  let room = getDisplaySessionRoomLabel(s.room_label);
  const catalogMatch = catalog.find(
    (item) =>
      buildSessionRoomLabel(item.propertyName, item.canonicalRoomLabel) === s.room_label ||
      item.canonicalRoomLabel === s.room_label,
  );
  if (catalogMatch) {
    buildingRaw = catalogMatch.propertyName;
    room = getDisplayRoomLabel(catalogMatch.propertyName, catalogMatch.canonicalRoomLabel);
  }

  return {
    id: s.id,
    date: s.cleaning_date,
    building: buildingKeyOf(buildingRaw),
    buildingRaw,
    room,
    type: taskLabelToType(s.task_label),
    staffId: s.staff_user_id,
    staffName: s.staff_name,
    start: formatTokyoTime(s.started_at) ?? "",
    // 「처리 끝」 기록은 청소한 시간이 없다 — 총 · 평균 소요에 0분으로 섞이지 않게 비운다.
    dur: s.duration_seconds == null || s.closed_without_cleaning ? null : Math.round(s.duration_seconds / 60),
    status: sessionStatusToAdminStatus(s.status),
    proxy: Boolean(s.completed_by_admin),
    closed: Boolean(s.closed_without_cleaning),
    note: s.notes ?? "",
    reports: null,
  };
}

/** 기록 탭 필터(기간·건물·직원·상태) 적용 조회.
 * status 필터를 안 넘기면 **모든 세션 상태**(진행중/완료/취소)를 돌려준다. 예전에는 `completed`
 * 로 기본 필터링해서 취소된 세션이 콘솔 어디에서도 보이지 않았다 — 상태는 표의 "상태" 열과
 * 세션 상태 필터에서 클라이언트가 걸러낸다. */
export async function getAdminCleaningHistory(
  session: AppSession,
  filters: CleaningExportFilters,
  roomCatalog?: readonly ActiveRoomCatalogItem[],
): Promise<AdminCleaningHistoryItem[]> {
  const catalog = roomCatalog ?? (await getActiveRoomCatalogServer(session.organization.id).catch(() => undefined)) ?? [];
  const sessions = await getOrgCleaningSessionsFiltered(session, filters, catalog);
  // 쿼리 순서는 cleaning_date ASC, started_at DESC — 날짜 순서는 유지하되 하루 안의 객실은
  // 시작 시각 순이 아니라 운영 순서로 읽히게 한다. 표 행과 Excel/PDF
  // 내보내기가 모두 이 배열에서 나오므로 서로 동기화된다.
  const items = sessions
    .map((s) => mapSessionToHistoryItem(s, catalog))
    .sort((a, b) => a.date.localeCompare(b.date) || compareByBuildingThenRoom(a, b));
  const links = await collectReportLinksBySession(
    session.organization.id,
    items.map((item) => item.id),
  ).catch(() => new Map<string, ReportLinks>());
  for (const item of items) {
    const link = links.get(item.id);
    if (!link || (link.lostIds.length === 0 && link.issueIds.length === 0)) continue;
    item.reports = {
      lost: link.lostIds.length || undefined,
      issue: link.issueIds.length || undefined,
      lostIds: link.lostIds.length ? link.lostIds : undefined,
      issueIds: link.issueIds.length ? link.issueIds : undefined,
    };
  }
  return items;
}

