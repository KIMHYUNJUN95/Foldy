// 교통비 정산 — 서버 전용 쿼리 레이어 (사용자별 월 장부).
//
// 급여 인접의 전용 기능: attendance_month_snapshots /
// hourly_rate_history 와 완전히 분리해 둬야 한다. 임금 값은 여기서 읽거나 복사하거나 합치지 않는다 — 교통비 합계는
// 독립된 장부다. 모든 함수는 호출자 무관(세션 없음)이며: 호출자가 조직 + 사용자를 해석하고,
// 접근을 확인한 뒤 넘긴다. 쓰기는 service-role 클라이언트로 한다 (RLS 가 직접 인증 쓰기를 거부함;
// supabase/migrations/202606260001_transport_reimbursement.sql 참고).

import "server-only";
import { getDisplaySessionRoomLabel } from "@/lib/room-label-normalization";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Service = ReturnType<typeof getSupabaseServiceClient>;

// transport_reimbursement_* 테이블은 아직 생성된 Database 타입에 없어서 service-client
// 테이블 접근은 `untyped` 로 캐스팅한다. src/types/database.ts 를 다시 생성하면 제거할 것.
function untyped(service: Service) {
  return service as unknown as {
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: (...args: any[]) => any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert: (...args: any[]) => any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: (...args: any[]) => any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete: (...args: any[]) => any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upsert: (...args: any[]) => any;
    };
  };
}

export type TransportReportStatus =
  | "draft"
  | "submitted"
  | "reviewing"
  | "approved"
  | "rejected"
  | "changes_requested";
export type TransportEntryMode = "linked" | "manual";

export type TransportReportRow = {
  id: string;
  organizationId: string;
  userId: string;
  targetMonth: string; // 'YYYY-MM-01'
  status: TransportReportStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewNote: string | null;
  totalAmountCached: number;
  createdAt: string;
  updatedAt: string;
};

export type TransportImageRow = {
  id: string;
  itemId: string;
  storagePath: string;
  sortOrder: number;
  createdAt: string;
};

export type TransportItemWorkContext = {
  buildingLabel?: string;
  roomLabel?: string;
  taskLabel?: string;
  contextSummary?: string;
};

export type TransportItemRow = {
  id: string;
  organizationId: string;
  reportId: string;
  userId: string;
  usageDate: string; // 'YYYY-MM-DD'
  amountYen: number;
  entryMode: TransportEntryMode;
  attendanceSessionId: string | null;
  propertyId: string | null;
  roomId: string | null;
  workContext: TransportItemWorkContext;
  memo: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  imageCount: number;
  images: TransportImageRow[];
};

export type LinkedTransportCandidate = {
  /** React 키이자 「이미 고른 후보」 판정용. 근태는 세션 id, 청소는 날짜+건물로 유일하다. */
  key: string;
  type: "attendance" | "cleaning";
  date: string; // 'YYYY-MM-DD'
  attendanceSessionId?: string;
  propertyId?: string;
  buildingLabel: string;
  contextSummary: string;
  workContext: Record<string, string>;
};

// ── DB 행 모양 (raw snake_case from the service client) ─────────────────────

type ReportDbRow = {
  id: string;
  organization_id: string;
  user_id: string;
  target_month: string;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  review_note: string | null;
  total_amount_cached: number;
  created_at: string;
  updated_at: string;
};

type ItemDbRow = {
  id: string;
  organization_id: string;
  report_id: string;
  user_id: string;
  usage_date: string;
  amount_yen: number;
  entry_mode: string;
  attendance_session_id: string | null;
  property_id: string | null;
  room_id: string | null;
  work_context: TransportItemWorkContext | null;
  memo: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type ImageDbRow = {
  id: string;
  item_id: string;
  storage_path: string;
  sort_order: number;
  created_at: string;
};

function mapReport(row: ReportDbRow): TransportReportRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    targetMonth: row.target_month,
    status: row.status as TransportReportStatus,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewNote: row.review_note,
    totalAmountCached: row.total_amount_cached,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapImage(row: ImageDbRow): TransportImageRow {
  return {
    id: row.id,
    itemId: row.item_id,
    storagePath: row.storage_path,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

/**
 * 사용자-월의 기존 초안/리포트를 가져오거나 없으면 `draft` 로 만든다. UNIQUE
 * (organization_id, user_id, target_month) 제약 덕에 동시성에서도 멱등이다: 삽입이
 * 충돌하면 기존 행을 다시 읽는다.
 */
export async function getOrCreateTransportReport(
  service: Service,
  organizationId: string,
  userId: string,
  targetMonthDate: string,
): Promise<TransportReportRow> {
  const existing = await getTransportReport(service, organizationId, userId, targetMonthDate);
  if (existing) return existing;

  const ins = await untyped(service)
    .from("transport_reimbursement_reports")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      target_month: targetMonthDate,
      status: "draft",
    })
    .select("*")
    .maybeSingle();

  if (ins.data) return mapReport(ins.data as ReportDbRow);

  // 삽입 경쟁에서 졌다 (unique 위반) — 행은 이제 존재하므로 다시 읽는다.
  const after = await getTransportReport(service, organizationId, userId, targetMonthDate);
  if (after) return after;
  throw new Error("transport_report_create_failed");
}

export async function getTransportReport(
  service: Service,
  organizationId: string,
  userId: string,
  targetMonthDate: string,
): Promise<TransportReportRow | null> {
  const res = await untyped(service)
    .from("transport_reimbursement_reports")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("target_month", targetMonthDate)
    .maybeSingle();
  if (!res.data) return null;
  return mapReport(res.data as ReportDbRow);
}

/**
 * 리포트의 모든 항목 (리포트 자체를 통한 조직 범위), 각각 이미지와 조인. 정렬:
 * usage_date ASC 후 sort_order ASC.
 */
export async function getTransportItems(
  service: Service,
  reportId: string,
): Promise<TransportItemRow[]> {
  const itemsRes = await untyped(service)
    .from("transport_reimbursement_items")
    .select("*")
    .eq("report_id", reportId)
    .order("usage_date", { ascending: true })
    .order("sort_order", { ascending: true });
  const itemRows = (itemsRes.data ?? []) as ItemDbRow[];
  if (itemRows.length === 0) return [];

  const itemIds = itemRows.map((r) => r.id);
  const imagesRes = await untyped(service)
    .from("transport_reimbursement_item_images")
    .select("id, item_id, storage_path, sort_order, created_at")
    .in("item_id", itemIds)
    .order("sort_order", { ascending: true });
  const imageRows = (imagesRes.data ?? []) as ImageDbRow[];

  const imagesByItem = new Map<string, TransportImageRow[]>();
  for (const img of imageRows) {
    const list = imagesByItem.get(img.item_id) ?? [];
    list.push(mapImage(img));
    imagesByItem.set(img.item_id, list);
  }

  return itemRows.map((row) => {
    const images = imagesByItem.get(row.id) ?? [];
    return {
      id: row.id,
      organizationId: row.organization_id,
      reportId: row.report_id,
      userId: row.user_id,
      usageDate: row.usage_date,
      amountYen: row.amount_yen,
      entryMode: row.entry_mode as TransportEntryMode,
      attendanceSessionId: row.attendance_session_id,
      propertyId: row.property_id,
      roomId: row.room_id,
      workContext: row.work_context ?? {},
      memo: row.memo,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      imageCount: images.length,
      images,
    };
  });
}

/** 'YYYY-MM-01' 월 키의 첫날 / 양끝 포함 마지막 도쿄 달력일. */
function monthBounds(targetMonthDate: string): { first: string; last: string } {
  const ym = targetMonthDate.slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${ym}-01`, last: `${ym}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * 사용자-월의 연결된 교통비 후보, 두 운영 출처에서 가져온다:
 *   1. operating_date 가 그 달인 attendance_sessions → attendance_sites 로 현장 이름.
 *   2. cleaning_date 가 그 달인 cleaning_sessions → rooms(
 *      room_label 로 매칭) → properties 로 건물 이름.
 * 호출자가 고른 후보를 `linked` 항목으로 바꾼다. 날짜 ASC 정렬.
 */
export async function getLinkedTransportCandidates(
  service: Service,
  organizationId: string,
  userId: string,
  targetMonthDate: string,
): Promise<LinkedTransportCandidate[]> {
  const { first, last } = monthBounds(targetMonthDate);
  const candidates: LinkedTransportCandidate[] = [];

  // 1) 그 달의 근태 세션.
  const attRes = await service
    .from("attendance_sessions")
    .select("id, operating_date, clock_in_site_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .gte("operating_date", first)
    .lte("operating_date", last)
    .order("operating_date", { ascending: true });
  const attRows = (attRes.data ?? []) as {
    id: string;
    operating_date: string;
    clock_in_site_id: string | null;
  }[];

  const siteIds = Array.from(
    new Set(attRows.map((r) => r.clock_in_site_id).filter(Boolean) as string[]),
  );
  const siteNames = new Map<string, string>();
  // 근무지에는 건물 FK 가 있다. 이것을 같이 들고 와야 교통비 항목이 `property_id` 를 채울 수 있고,
  // 그래야 「이 사람이 이 건물에 넣었던 금액」 기억이 자동 연결에서도 동작한다.
  const siteProperties = new Map<string, string>();
  if (siteIds.length > 0) {
    const sitesRes = await service
      .from("attendance_sites")
      .select("id, name, property_id")
      .eq("organization_id", organizationId)
      .in("id", siteIds);
    for (const s of (sitesRes.data ?? []) as {
      id: string;
      name: string;
      property_id: string | null;
    }[]) {
      siteNames.set(s.id, s.name);
      if (s.property_id) siteProperties.set(s.id, s.property_id);
    }
  }

  for (const row of attRows) {
    const buildingLabel =
      (row.clock_in_site_id ? siteNames.get(row.clock_in_site_id) : null) ?? "";
    candidates.push({
      key: `attendance:${row.id}`,
      type: "attendance",
      date: row.operating_date,
      attendanceSessionId: row.id,
      propertyId: row.clock_in_site_id ? siteProperties.get(row.clock_in_site_id) : undefined,
      buildingLabel,
      contextSummary: buildingLabel,
      workContext: buildingLabel ? { buildingLabel } : {},
    });
  }

  // 2) 그 달의 청소 세션. cleaning_sessions 에는 property_id 가 없으므로 건물은
  //    room_label → rooms → properties 로 매칭해 해석한다 (모두 조직 범위).
  const cleanRes = await service
    .from("cleaning_sessions")
    .select("id, cleaning_date, room_label, task_label")
    .eq("organization_id", organizationId)
    .eq("staff_user_id", userId)
    // 청소 배정 「처리 끝」 기록은 실제로 그 건물에 간 것이 아니다.
    .eq("closed_without_cleaning", false)
    .gte("cleaning_date", first)
    .lte("cleaning_date", last)
    .order("cleaning_date", { ascending: true });
  const cleanRows = (cleanRes.data ?? []) as {
    id: string;
    cleaning_date: string;
    room_label: string;
    task_label: string;
  }[];

  const roomLabels = Array.from(new Set(cleanRows.map((r) => r.room_label).filter(Boolean)));
  const roomByLabel = new Map<string, { propertyId: string }>();
  const propertyNames = new Map<string, string>();
  if (roomLabels.length > 0) {
    const roomsRes = await service
      .from("rooms")
      .select("room_label, property_id")
      .eq("organization_id", organizationId)
      .in("room_label", roomLabels);
    const roomRows = (roomsRes.data ?? []) as { room_label: string; property_id: string }[];
    for (const r of roomRows) {
      if (!roomByLabel.has(r.room_label)) roomByLabel.set(r.room_label, { propertyId: r.property_id });
    }
    const propertyIds = Array.from(new Set(roomRows.map((r) => r.property_id).filter(Boolean)));
    if (propertyIds.length > 0) {
      const propRes = await service
        .from("properties")
        .select("id, name, display_name_ko")
        .eq("organization_id", organizationId)
        .in("id", propertyIds);
      for (const p of (propRes.data ?? []) as {
        id: string;
        name: string;
        display_name_ko: string | null;
      }[]) {
        propertyNames.set(p.id, p.display_name_ko ?? p.name);
      }
    }
  }

  for (const row of cleanRows) {
    const room = roomByLabel.get(row.room_label);
    const propertyId = room?.propertyId;
    const buildingLabel = (propertyId ? propertyNames.get(propertyId) : null) ?? "";
    // 사용자 대상 명세서에서는 아라키초 하위 호실(201_2 → 201)을 합친다; 위의 매칭은 원본을 유지한다.
    const displayRoomLabel = getDisplaySessionRoomLabel(row.room_label);
    const summaryParts = [buildingLabel, displayRoomLabel].filter(Boolean);
    const contextSummary = summaryParts.join(" · ");
    const workContext: Record<string, string> = {};
    if (buildingLabel) workContext.buildingLabel = buildingLabel;
    if (displayRoomLabel) workContext.roomLabel = displayRoomLabel;
    if (row.task_label) workContext.taskLabel = row.task_label;
    candidates.push({
      key: `cleaning:${row.id}`,
      type: "cleaning",
      date: row.cleaning_date,
      propertyId,
      buildingLabel,
      contextSummary,
      workContext,
    });
  }

  candidates.sort((a, b) => a.date.localeCompare(b.date));
  return candidates;
}

/**
 * 항목에서 캐시된 합계를 다시 계산하고(항목이 진실 공급원) 리포트에
 * 저장한다. 내부 헬퍼; 호출자는 항목 쓰기 뒤에 호출한다.
 */
export async function syncReportTotalAmount(
  service: Service,
  reportId: string,
): Promise<number> {
  const res = await untyped(service)
    .from("transport_reimbursement_items")
    .select("amount_yen")
    .eq("report_id", reportId);
  const rows = (res.data ?? []) as { amount_yen: number }[];
  const total = rows.reduce((sum, r) => sum + (r.amount_yen ?? 0), 0);

  await untyped(service)
    .from("transport_reimbursement_reports")
    .update({ total_amount_cached: total })
    .eq("id", reportId);
  return total;
}

export type TransportReportAdminSummary = {
  userId: string;
  userName: string;
  status: TransportReportStatus;
  totalAmount: number;
  itemCount: number;
  missingCount: number;
  submittedAt: string | null;
};

/**
 * 관리자 조직 전체 월 요약: 리포트가 있는 사용자마다 한 항목, 상태, 캐시된 합계,
 * 항목 수. 호출자는 먼저 권한(owner / attendance_payroll_admin)을 반드시 확인해야 한다.
 */
export async function getTransportReportSummaryForAdmin(
  service: Service,
  organizationId: string,
  targetMonthDate: string,
): Promise<TransportReportAdminSummary[]> {
  const reportsRes = await untyped(service)
    .from("transport_reimbursement_reports")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("target_month", targetMonthDate);
  const reports = (reportsRes.data ?? []) as ReportDbRow[];
  if (reports.length === 0) return [];

  const reportIds = reports.map((r) => r.id);
  const userIds = Array.from(new Set(reports.map((r) => r.user_id)));

  const itemsRes = await untyped(service)
    .from("transport_reimbursement_items")
    .select("id, report_id")
    .in("report_id", reportIds);
  const itemCounts = new Map<string, number>();
  const itemRows = (itemsRes.data ?? []) as { id: string; report_id: string }[];
  for (const r of itemRows) {
    itemCounts.set(r.report_id, (itemCounts.get(r.report_id) ?? 0) + 1);
  }
  const itemIdToReportId = new Map(itemRows.map((row) => [row.id, row.report_id]));
  const itemIds = itemRows.map((row) => row.id);
  const itemIdsWithImages = new Set<string>();
  if (itemIds.length > 0) {
    const imagesRes = await untyped(service)
      .from("transport_reimbursement_item_images")
      .select("item_id")
      .in("item_id", itemIds);
    for (const row of (imagesRes.data ?? []) as { item_id: string }[]) {
      itemIdsWithImages.add(row.item_id);
    }
  }
  const missingCounts = new Map<string, number>();
  for (const itemId of itemIds) {
    if (itemIdsWithImages.has(itemId)) continue;
    const reportId = itemIdToReportId.get(itemId);
    if (!reportId) continue;
    missingCounts.set(reportId, (missingCounts.get(reportId) ?? 0) + 1);
  }

  const names = new Map<string, string>();
  const profRes = await service.from("profiles").select("id, name").in("id", userIds);
  for (const p of (profRes.data ?? []) as { id: string; name: string }[]) names.set(p.id, p.name);

  return reports.map((r) => ({
    userId: r.user_id,
    userName: names.get(r.user_id) ?? "—",
    status: r.status as TransportReportStatus,
    totalAmount: r.total_amount_cached,
    itemCount: itemCounts.get(r.id) ?? 0,
    missingCount: missingCounts.get(r.id) ?? 0,
    submittedAt: r.submitted_at,
  }));
}

/**
 * 관리자 사용자별 월 상세: 리포트와 그 항목(이미지 포함). 호출자는 먼저 권한을 반드시
 * 확인해야 한다. 그 달 리포트가 없으면 null 을 반환한다.
 */
export async function getTransportReportUserDetailForAdmin(
  service: Service,
  organizationId: string,
  userId: string,
  targetMonthDate: string,
): Promise<{ report: TransportReportRow; items: TransportItemRow[] } | null> {
  const report = await getTransportReport(service, organizationId, userId, targetMonthDate);
  if (!report) return null;
  const items = await getTransportItems(service, report.id);
  return { report, items };
}
