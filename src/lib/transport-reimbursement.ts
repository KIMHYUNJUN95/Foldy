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
  /** 서버가 붙인 10분짜리 서명 주소(2026-11-25). 못 받았으면 null, 아직 서명하지 않았으면 없음. */
  signedUrl?: string | null;
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
  /** 사진 중 하나라도 서명 주소를 못 받았다(2026-11-25). 서명한 화면에서만 채운다. */
  imageUrlsFailed?: boolean;
};

export type LinkedTransportCandidate = {
  /** React 키이자 「이미 고른 후보」 판정용. 근태는 세션 id, 청소는 날짜+건물로 유일하다. */
  key: string;
  type: "attendance" | "cleaning";
  date: string; // 'YYYY-MM-DD'
  attendanceSessionId?: string;
  /** 청소 후보의 청소 세션 id(2026-11-11 H2). 저장 때 서버가 그날 · 그 사람 청소인지 다시 확인한다. */
  cleaningSessionId?: string;
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
  // 읽기 오류는 던진다(2026-11-25) — 「정산서 없음」(null)과 섞이면 빈 달로 보이거나 새 정산서를 또 만들려 든다.
  if (res.error) throw new Error(`transport report read failed: ${res.error.message}`);
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
  // 읽기 오류는 던진다(2026-11-25) — 빈 목록 · 「증빙 없음」으로 보이면 사진이 사라진 것처럼 보인다.
  if (itemsRes.error) throw new Error(`transport items read failed: ${itemsRes.error.message}`);
  const itemRows = (itemsRes.data ?? []) as ItemDbRow[];
  if (itemRows.length === 0) return [];

  const itemIds = itemRows.map((r) => r.id);
  const imageRows = await selectInChunks<ImageDbRow>(
    itemIds,
    (chunk) =>
      untyped(service)
        .from("transport_reimbursement_item_images")
        .select("id, item_id, storage_path, sort_order, created_at")
        .in("item_id", chunk)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
    "transport item images",
  );

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

// ── 자동 연결 항목 — 한 판정으로 정한다(2026-11-25) ─────────────────────────
//
// 「연결 항목의 건물 정보는 서버가 연결 기록에서 정한다.」 후보 목록(getLinkedTransportCandidates)과
// 저장(createTransportItemAction → resolveLinkedTransportPlace)이 **아래 상수 · 함수를 같이 쓴다.** 예전에는 후보가 만든
// 이름 · 요약 · 건물 id 를 화면이 그대로 돌려보냈고 서버는 그 값을 믿었다. 기준은 지금 저장된 값과 같다:
// - 근태: 출근한 근무지(`clock_in_site_id`, 같은 조직 `attendance_sites`)의 `name` · `property_id`. 요약 = 건물 이름.
// - 청소: 청소 방(`room_label`) → 같은 조직 `rooms`(첫 줄) → 같은 조직 `properties` 의 `display_name_ko ?? name` · id.
//   요약 = 「건물 · 방」(방은 `getDisplaySessionRoomLabel`). 방이 다른 조직 건물을 가리키면 건물 없음.
// 못 찾으면 빈 값. 읽는 쪽(`localizeStoredPlaceText` · 모바일 `useBuildingName`)이 한국어 이름을 보는 사람 언어로 바꾼다.

/**
 * 자동 연결할 수 있는 기록(2026-11-25, 문서 24 「후보 목록 자체가 실제 근무 기록이라, 목록에 없는 날은 애초에 자동
 * 연결로 넣을 수 없다」). 후보 목록과 저장 확인이 같은 조건을 쓴다.
 * - 근태: `invalid` 가 아닌 기록(DB 검사 트리거와 같은 조건).
 * - 청소: 「청소한 기록」 = 완료 + 처리 끝 아님 (docs/product/45 표 3 · src/lib/cleaning-record-rules.ts). 취소 · 진행 중 ·
 *   「못 했어요」로 닫은 날은 직접 입력.
 */
export const LINKABLE_ATTENDANCE_EXCLUDED_STATUS = "invalid";
export const LINKABLE_CLEANING_STATUS = "completed";

/** 근태 근무지 → 저장할 건물 이름. */
export function transportSiteBuildingLabel(site: { name: string | null } | null | undefined): string {
  return site?.name?.trim() ?? "";
}

/** 청소 건물 → 저장할 건물 이름. */
export function transportPropertyBuildingLabel(
  property: { name: string | null; display_name_ko: string | null } | null | undefined,
): string {
  if (!property) return "";
  return (property.display_name_ko ?? property.name ?? "").trim();
}

/** 연결 기록에서 정한 장소 — 후보 · 저장 둘 다 이 모양. `propertyId` 는 같은 조직 건물일 때만. */
export type LinkedTransportPlace = {
  propertyId: string | null;
  buildingLabel: string;
  contextSummary: string;
  /** 청소만 — 표시용 방(`getDisplaySessionRoomLabel`). */
  roomLabel: string;
};

/** 근태 근무지(같은 조직에서 찾은 것, 없으면 null) → 장소. */
export function linkedAttendancePlace(
  site: { name: string | null; property_id: string | null } | null | undefined,
): LinkedTransportPlace {
  const buildingLabel = transportSiteBuildingLabel(site);
  return { propertyId: site?.property_id ?? null, buildingLabel, contextSummary: buildingLabel, roomLabel: "" };
}

/** 청소 방 + 방이 가리키는 같은 조직 건물(없으면 null) → 장소. 요약은 「건물 · 방」. */
export function linkedCleaningPlace(
  rawRoomLabel: string | null | undefined,
  property: { id: string; name: string | null; display_name_ko: string | null } | null | undefined,
): LinkedTransportPlace {
  const buildingLabel = transportPropertyBuildingLabel(property);
  // 사용자 대상 명세서에서는 아라키초 하위 호실(201_2 → 201)을 합친다; 방 매칭은 원본을 쓴다.
  const roomLabel = rawRoomLabel ? getDisplaySessionRoomLabel(rawRoomLabel) : "";
  return {
    propertyId: property?.id ?? null,
    buildingLabel,
    contextSummary: [buildingLabel, roomLabel].filter(Boolean).join(" · "),
    roomLabel,
  };
}

export type LinkedTransportSource =
  | { type: "attendance"; siteId: string | null }
  | { type: "cleaning"; roomLabel: string | null };

/**
 * 연결된 기록 하나의 장소. 기록 자체(내 것 · 같은 조직 · 그날 · 연결할 수 있는 상태)는 호출하는 쪽이 이미 확인했다.
 * 읽기 오류는 `read_failed` — 빈 이름으로 저장하면 「이름 없음」과 「못 읽음」이 섞인다.
 */
export async function resolveLinkedTransportPlace(
  service: Service,
  organizationId: string,
  source: LinkedTransportSource,
): Promise<{ ok: true; place: LinkedTransportPlace } | { ok: false; error: "read_failed" }> {
  if (source.type === "attendance") {
    if (!source.siteId) return { ok: true, place: linkedAttendancePlace(null) };
    const res = await service
      .from("attendance_sites")
      .select("id, name, property_id")
      .eq("id", source.siteId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (res.error) return { ok: false, error: "read_failed" };
    return {
      ok: true,
      place: linkedAttendancePlace(res.data as { name: string | null; property_id: string | null } | null),
    };
  }

  if (!source.roomLabel) return { ok: true, place: linkedCleaningPlace(source.roomLabel, null) };
  const roomRes = await service
    .from("rooms")
    .select("room_label, property_id")
    .eq("organization_id", organizationId)
    .eq("room_label", source.roomLabel)
    .limit(1);
  if (roomRes.error) return { ok: false, error: "read_failed" };
  const propertyId = ((roomRes.data ?? []) as { property_id: string | null }[])[0]?.property_id ?? null;
  if (!propertyId) return { ok: true, place: linkedCleaningPlace(source.roomLabel, null) };
  const propRes = await service
    .from("properties")
    .select("id, name, display_name_ko")
    .eq("id", propertyId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (propRes.error) return { ok: false, error: "read_failed" };
  return {
    ok: true,
    place: linkedCleaningPlace(
      source.roomLabel,
      propRes.data as { id: string; name: string | null; display_name_ko: string | null } | null,
    ),
  };
}

/**
 * 사용자-월의 연결된 교통비 후보, 두 운영 출처에서 가져온다:
 *   1. operating_date 가 그 달인 attendance_sessions → attendance_sites 로 현장 이름.
 *   2. cleaning_date 가 그 달인 cleaning_sessions → rooms(
 *      room_label 로 매칭) → properties 로 건물 이름.
 * 호출자가 고른 후보를 `linked` 항목으로 바꾼다. 날짜 ASC 정렬.
 * 읽기 오류는 던진다(2026-11-25) — 조용히 빈 목록 · 빈 건물 이름이 되지 않게(화면은 오류 화면으로 간다).
 */
export async function getLinkedTransportCandidates(
  service: Service,
  organizationId: string,
  userId: string,
  targetMonthDate: string,
): Promise<LinkedTransportCandidate[]> {
  const { first, last } = monthBounds(targetMonthDate);
  const candidates: LinkedTransportCandidate[] = [];

  // 1) 그 달의 근태 세션(연결할 수 있는 것만 — 저장 확인과 같은 조건).
  const attRes = await service
    .from("attendance_sessions")
    .select("id, operating_date, clock_in_site_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .neq("status", LINKABLE_ATTENDANCE_EXCLUDED_STATUS)
    .gte("operating_date", first)
    .lte("operating_date", last)
    .order("operating_date", { ascending: true });
  if (attRes.error) throw new Error(`transport candidates attendance read failed: ${attRes.error.message}`);
  const attRows = (attRes.data ?? []) as {
    id: string;
    operating_date: string;
    clock_in_site_id: string | null;
  }[];

  const siteIds = Array.from(
    new Set(attRows.map((r) => r.clock_in_site_id).filter(Boolean) as string[]),
  );
  // 근무지에는 건물 FK 가 있다. 이것을 같이 들고 와야 교통비 항목이 `property_id` 를 채울 수 있고,
  // 그래야 「이 사람이 이 건물에 넣었던 금액」 기억이 자동 연결에서도 동작한다.
  const sites = new Map<string, { name: string | null; property_id: string | null }>();
  if (siteIds.length > 0) {
    const sitesRes = await service
      .from("attendance_sites")
      .select("id, name, property_id")
      .eq("organization_id", organizationId)
      .in("id", siteIds);
    if (sitesRes.error) throw new Error(`transport candidates sites read failed: ${sitesRes.error.message}`);
    for (const s of (sitesRes.data ?? []) as { id: string; name: string | null; property_id: string | null }[]) {
      sites.set(s.id, s);
    }
  }

  for (const row of attRows) {
    const place = linkedAttendancePlace(row.clock_in_site_id ? sites.get(row.clock_in_site_id) : null);
    candidates.push({
      key: `attendance:${row.id}`,
      type: "attendance",
      date: row.operating_date,
      attendanceSessionId: row.id,
      propertyId: place.propertyId ?? undefined,
      buildingLabel: place.buildingLabel,
      contextSummary: place.contextSummary,
      workContext: place.buildingLabel ? { buildingLabel: place.buildingLabel } : {},
    });
  }

  // 2) 그 달의 청소 세션. cleaning_sessions 에는 property_id 가 없으므로 건물은
  //    room_label → rooms → properties 로 매칭해 해석한다 (모두 조직 범위).
  const cleanRes = await service
    .from("cleaning_sessions")
    .select("id, cleaning_date, room_label, task_label")
    .eq("organization_id", organizationId)
    .eq("staff_user_id", userId)
    .eq("status", LINKABLE_CLEANING_STATUS)
    .eq("closed_without_cleaning", false)
    .gte("cleaning_date", first)
    .lte("cleaning_date", last)
    .order("cleaning_date", { ascending: true });
  if (cleanRes.error) throw new Error(`transport candidates cleaning read failed: ${cleanRes.error.message}`);
  const cleanRows = (cleanRes.data ?? []) as {
    id: string;
    cleaning_date: string;
    room_label: string;
    task_label: string;
  }[];

  const roomLabels = Array.from(new Set(cleanRows.map((r) => r.room_label).filter(Boolean)));
  const propertyIdByRoom = new Map<string, string | null>();
  const properties = new Map<string, { id: string; name: string | null; display_name_ko: string | null }>();
  if (roomLabels.length > 0) {
    const roomsRes = await service
      .from("rooms")
      .select("room_label, property_id")
      .eq("organization_id", organizationId)
      .in("room_label", roomLabels);
    if (roomsRes.error) throw new Error(`transport candidates rooms read failed: ${roomsRes.error.message}`);
    const roomRows = (roomsRes.data ?? []) as { room_label: string; property_id: string | null }[];
    for (const r of roomRows) {
      if (!propertyIdByRoom.has(r.room_label)) propertyIdByRoom.set(r.room_label, r.property_id);
    }
    const propertyIds = Array.from(new Set(roomRows.map((r) => r.property_id).filter(Boolean) as string[]));
    if (propertyIds.length > 0) {
      const propRes = await service
        .from("properties")
        .select("id, name, display_name_ko")
        .eq("organization_id", organizationId)
        .in("id", propertyIds);
      if (propRes.error) throw new Error(`transport candidates properties read failed: ${propRes.error.message}`);
      for (const p of (propRes.data ?? []) as { id: string; name: string | null; display_name_ko: string | null }[]) {
        properties.set(p.id, p);
      }
    }
  }

  for (const row of cleanRows) {
    const propertyId = propertyIdByRoom.get(row.room_label) ?? null;
    const place = linkedCleaningPlace(row.room_label, propertyId ? properties.get(propertyId) : null);
    const workContext: Record<string, string> = {};
    if (place.buildingLabel) workContext.buildingLabel = place.buildingLabel;
    if (place.roomLabel) workContext.roomLabel = place.roomLabel;
    if (row.task_label) workContext.taskLabel = row.task_label;
    candidates.push({
      key: `cleaning:${row.id}`,
      type: "cleaning",
      date: row.cleaning_date,
      cleaningSessionId: row.id,
      propertyId: place.propertyId ?? undefined,
      buildingLabel: place.buildingLabel,
      contextSummary: place.contextSummary,
      workContext,
    });
  }

  candidates.sort((a, b) => a.date.localeCompare(b.date));
  return candidates;
}

/**
 * 항목에서 캐시된 합계를 다시 계산하고(항목이 진실 공급원) 리포트에 저장한다.
 *
 * 읽기 · 쓰기 오류는 **던진다**(2026-11-11 M12). 예전에는 오류를 삼켜서 항목 읽기가 실패하면 합계가 0엔으로
 * 저장될 수 있었다. 마이그레이션 202611110002 뒤에는 DB 트리거(`sync_transport_report_total`)가 합계를 늘 맞추므로
 * 이 함수는 트리거가 아직 없는 동안의 보조다 — 항목 저장 뒤에는 호출자가 잡아서 기록만 하고, 제출 · 승인 직전에는
 * 실패를 그대로 실패로 돌린다.
 */
export async function syncReportTotalAmount(
  service: Service,
  reportId: string,
): Promise<number> {
  const res = await untyped(service)
    .from("transport_reimbursement_items")
    .select("amount_yen")
    .eq("report_id", reportId);
  if (res.error) throw new Error(`transport total read failed: ${res.error.message}`);
  const rows = (res.data ?? []) as { amount_yen: number }[];
  const total = rows.reduce((sum, r) => sum + (r.amount_yen ?? 0), 0);

  const upd = await untyped(service)
    .from("transport_reimbursement_reports")
    .update({ total_amount_cached: total })
    .eq("id", reportId);
  if (upd.error) throw new Error(`transport total write failed: ${upd.error.message}`);
  return total;
}

/** 항목 저장 뒤 합계 맞추기 — 실패해도 저장은 끝났으니 기록만 한다(트리거가 있으면 이미 맞다). */
export async function syncReportTotalAmountQuietly(service: Service, reportId: string): Promise<void> {
  try {
    await syncReportTotalAmount(service, reportId);
  } catch (error) {
    console.error("[transport] total sync failed:", error instanceof Error ? error.message : error);
  }
}

/** `.in()` 목록을 나눠 읽는다(2026-11-11 M14) — id 수백 개를 한 번에 넣으면 요청 주소 길이 한도를 넘는다. */
const IN_CHUNK = 200;
async function selectInChunks<T>(
  ids: string[],
  read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const res = await read(ids.slice(i, i + IN_CHUNK));
    if (res.error) throw new Error(`${what} read failed: ${res.error.message}`);
    out.push(...((res.data ?? []) as T[]));
  }
  return out;
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
  if (reportsRes.error) throw new Error(`transport reports read failed: ${reportsRes.error.message}`);
  const reports = (reportsRes.data ?? []) as ReportDbRow[];
  if (reports.length === 0) return [];

  const reportIds = reports.map((r) => r.id);
  const userIds = Array.from(new Set(reports.map((r) => r.user_id)));

  const itemRows = await selectInChunks<{ id: string; report_id: string }>(
    reportIds,
    (chunk) =>
      untyped(service)
        .from("transport_reimbursement_items")
        .select("id, report_id")
        .eq("organization_id", organizationId)
        .in("report_id", chunk),
    "transport items",
  );
  const itemCounts = new Map<string, number>();
  for (const r of itemRows) {
    itemCounts.set(r.report_id, (itemCounts.get(r.report_id) ?? 0) + 1);
  }
  const itemIdToReportId = new Map(itemRows.map((row) => [row.id, row.report_id]));
  const itemIds = itemRows.map((row) => row.id);
  const itemIdsWithImages = new Set<string>();
  if (itemIds.length > 0) {
    const imageRows = await selectInChunks<{ item_id: string }>(
      itemIds,
      (chunk) =>
        untyped(service)
          .from("transport_reimbursement_item_images")
          .select("item_id")
          .eq("organization_id", organizationId)
          .in("item_id", chunk),
      "transport images",
    );
    for (const row of imageRows) itemIdsWithImages.add(row.item_id);
  }
  const missingCounts = new Map<string, number>();
  for (const itemId of itemIds) {
    if (itemIdsWithImages.has(itemId)) continue;
    const reportId = itemIdToReportId.get(itemId);
    if (!reportId) continue;
    missingCounts.set(reportId, (missingCounts.get(reportId) ?? 0) + 1);
  }

  const names = new Map<string, string>();
  const profRows = await selectInChunks<{ id: string; name: string }>(
    userIds,
    (chunk) => service.from("profiles").select("id, name").in("id", chunk),
    "profiles",
  );
  for (const p of profRows) names.set(p.id, p.name);

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
