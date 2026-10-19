import { getBeds24Cooldown } from "@/lib/beds24/sync-locks";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  buildBlockSendEntry,
  buildJobSendEntry,
  mergeSendEntries,
  opsRoomDisplayName,
  type BlockLogRow,
  type PriceJobLogRow,
  type SendEntry,
} from "@/lib/ops-history";
import {
  getOpsPriceConversions,
  getOpsRecentBookings,
  readOpsCellHistory,
  type OpsPriceConversion,
  type OpsRecentBooking,
} from "@/lib/ops-calendar";
import { parsePropertyParam } from "@/lib/ops-calendar-properties";
import type { CellHistory } from "@/lib/ops-price-history";
import { resolveRecentRange } from "@/lib/ops-recent-bookings-range";
import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 판매 캘린더 **읽기** — 서버 액션 큐 밖(GET Route Handler)에서 돈다(2026-10-19).
 *
 * Next 는 서버 액션 · `router.refresh` 를 한 줄로 하나씩 처리한다. 폴링 · 호버 조회가 액션이면 사용자의
 * 저장 · 예약 상세 열기가 그 뒤에 서서 기다렸다(실측: 로드 뒤 액션 3회 x 0.8초, 화면이 7.5초에야 조용해짐).
 * 읽기는 `GET /api/ops/calendar/*` 로 옮겨 병렬로 돈다. 권한은 `route-auth.ts` 가 액션과 같은 조건으로 본다.
 * service-role 로 읽으므로 조직 조건이 곧 경계다 — 세션의 조직으로 직접 건다.
 */

const SEND_LOG_PAGE = 30;

export type PriceJobStatus = {
  status: string;
  processedCount: number;
  totalCount: number;
  failedRoomIds: string[];
  error: string | null;
};

/** 화면이 폴링한다. 「처리 중」이 언제 끝나는지 사람이 알아야 한다. */
export async function readPriceJobStatus(session: AppSession, jobId: string): Promise<PriceJobStatus | null> {

  const result = await getSupabaseServiceClient()
    .from("beds24_price_jobs")
    .select("status, processed_count, total_count, failed_room_ids, error, organization_id")
    .eq("id", jobId)
    .maybeSingle();
  const row = result.data as {
    status: string;
    processed_count: number;
    total_count: number;
    failed_room_ids: string[];
    error: string | null;
    organization_id: string;
  } | null;
  // service-role 로 읽었으므로 **조직 확인을 직접 한다.**
  if (!row || row.organization_id !== session.organization.id) return null;

  return {
    error: row.error,
    failedRoomIds: row.failed_room_ids,
    processedCount: row.processed_count,
    status: row.status,
    totalCount: row.total_count,
  };
}

type RoomNameRow = {
  id: string;
  external_room_id: string | null;
  room_label: string;
  properties: { name: string } | { name: string }[] | null;
};

/**
 * 우리 `rooms.id` · Beds24 roomId → 판매 캘린더와 같은 방 이름(`opsRoomDisplayName`). 건물은 보는 사람
 * 언어로 — 언어는 **서버가 세션에서** 정한다(클라이언트가 넘기지 않는다).
 */
export async function readRoomNames(session: { organization: { id: string }; user: { preferredLanguage: Locale } }) {
  const buildingLabels = getDictionary(session.user.preferredLanguage).cleaning.buildingLabels as Record<string, string>;
  const result = await getSupabaseServiceClient()
    .from("rooms")
    .select("id, external_room_id, room_label, properties(name)")
    .eq("organization_id", session.organization.id);
  const byId = new Map<string, { property: string | null; room: string }>();
  const byExternal = new Map<string, string>();
  for (const row of (result.data ?? []) as RoomNameRow[]) {
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const name = opsRoomDisplayName(property?.name, row.room_label, buildingLabels);
    byId.set(row.id, name);
    if (row.external_room_id) {
      byExternal.set(String(row.external_room_id), [name.property, name.room].filter(Boolean).join(" "));
    }
  }
  return { buildingLabels, byExternal, byId };
}

export type OpsSendLogResult =
  | { ok: true; entries: SendEntry[]; nextBefore: string | null }
  | { ok: false; error: "forbidden" | "failed" };

/** Beds24 전송 로그 — 가격·최소숙박 작업 + 차단, 최신 먼저 30줄씩. */
export async function readOpsSendLog(session: AppSession, args: { before?: string | null }): Promise<OpsSendLogResult> {
  const supabase = getSupabaseServiceClient();
  const before = args.before ?? new Date(Date.now() + 60_000).toISOString();

  const [jobs, blocks, names, cooldown] = await Promise.all([
    supabase
      .from("beds24_price_jobs")
      .select("id, job_type, status, created_at, completed_at, requested_by_name, error, results, room_updates")
      .eq("organization_id", session.organization.id)
      .lt("created_at", before)
      .order("created_at", { ascending: false })
      .limit(SEND_LOG_PAGE),
    supabase
      .from("beds24_block_logs")
      .select(
        "id, action, status, created_at, requested_by_name, property_name, room_label, start_date, end_date, nights, reason, detail",
      )
      .eq("organization_id", session.organization.id)
      .lt("created_at", before)
      .order("created_at", { ascending: false })
      .limit(SEND_LOG_PAGE),
    readRoomNames(session),
    // 전역 쿨다운이 켜져 있으면 대기 작업은 「안 나감」이 아니라 「Beds24 한도 대기」다(`resolveSendWait`).
    getBeds24Cooldown(supabase).catch(() => null),
  ]);
  if (jobs.error || blocks.error) return { error: "failed", ok: false };

  const now = Date.now();
  const merged = mergeSendEntries(
    ((jobs.data ?? []) as PriceJobLogRow[]).map((job) => buildJobSendEntry(job, names.byExternal, now, cooldown)),
    ((blocks.data ?? []) as BlockLogRow[]).map((row) => {
      const name = opsRoomDisplayName(row.property_name, row.room_label ?? "", names.buildingLabels);
      return buildBlockSendEntry({ ...row, property_name: name.property, room_label: name.room || null });
    }),
    SEND_LOG_PAGE,
  );
  return { entries: merged.entries, nextBefore: merged.nextBefore, ok: true };
}

export type OpsCellHistoryResult =
  | { ok: true; history: CellHistory | null }
  | { ok: false; error: "forbidden" | "bad_request" | "failed" };

/** 한 행 뒤의 유닛은 많아야 몇 개다 — 넉넉히 잡되 끝은 둔다. */
const CELL_HISTORY_MAX_ROOM_IDS = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 칸 하나의 변경 이력 — 가격 칸 호버 카드가 뜰 때 부른다(2026-09-30 속도).
 *
 * 예전에는 창 전체 이력을 페이지와 함께 보냈다. 이제 페이지는 「이력이 있는 칸」 표시만 싣고, 목록은
 * 그 칸을 볼 때만 여기서 받는다. 조회는 **세션의 조직으로** 거른다 — 넘어온 유닛 id 가 다른 조직의
 * 것이면 아무것도 나오지 않는다(서비스 키라 RLS 가 막아 주지 않으므로 조직 조건이 곧 경계다).
 */
export async function readOpsCellHistoryFor(session: AppSession, args: { roomIds: string[]; date: string }): Promise<OpsCellHistoryResult> {
  if (
    !Array.isArray(args.roomIds) ||
    args.roomIds.length === 0 ||
    args.roomIds.length > CELL_HISTORY_MAX_ROOM_IDS ||
    !args.roomIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id)) ||
    typeof args.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(args.date)
  ) {
    return { error: "bad_request", ok: false };
  }
  try {
    const history = await readOpsCellHistory({
      date: args.date,
      organizationId: session.organization.id,
      roomIds: args.roomIds,
      supabase: getSupabaseServiceClient(),
    });
    return { history, ok: true };
  } catch (error) {
    console.error("[ops-calendar] cell history read failed", error);
    return { error: "failed", ok: false };
  }
}

export type OpsPriceConversionsResult =
  | { ok: true; conversions: OpsPriceConversion[] }
  | { ok: false; error: "forbidden" | "failed" };

/**
 * 가격 개입 전환(최근 90일) — 격자가 그린 뒤 따로 받는다(2026-09-30 속도).
 *
 * 창과 무관하고 판정이 가장 느린 단계라 페이지 렌더에서 뺐다. 건물을 고르면 그 건물(들) 것만.
 */
export async function readOpsPriceConversionsFor(session: AppSession, args: {
  /** 고른 건물(들). 빈 목록 = 전체(2026-09-30 다중 선택). */
  properties?: readonly string[] | null;
  /** 보고 있는 창의 첫날 · 일수(2026-10-02 — 창 안 숙박만 판정). */
  start: string;
  days: number;
}): Promise<OpsPriceConversionsResult> {
  const start = typeof args.start === "string" ? args.start : "";
  const days = typeof args.days === "number" && Number.isInteger(args.days) ? args.days : 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || days < 1 || days > 31) return { error: "failed", ok: false };
  const [y, m, d] = start.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + days - 1)).toISOString().slice(0, 10);
  try {
    // 클라이언트가 보낸 값이라 모양부터 다시 거른다 — 문자열만, 공백 제거, 중복 제거.
    const properties = parsePropertyParam(
      Array.isArray(args.properties) ? args.properties.filter((name): name is string => typeof name === "string") : [],
    );
    const conversions = await getOpsPriceConversions(session, { end, properties, start });
    return { conversions, ok: true };
  } catch (error) {
    console.error("[ops-calendar] price conversions read failed", error);
    return { error: "failed", ok: false };
  }
}

export type OpsRecentBookingsResult =
  | { ok: false; error: "forbidden" | "failed" }
  | { ok: true; bookings: OpsRecentBooking[]; from: string; to: string; isDefault: boolean; endsNow: boolean };

/**
 * 「최근 예약」(2026-10-05) — 정한 시간대에 들어온 확정 예약 중 가격 개입 성공을 뺀 것, **보고 있는 창 × 고른 건물**.
 * 시간대를 안 보내면 기본(지금부터 48시간 전 ~ 지금, 2026-10-07). 서버가 시간대를 다시 거른다(31일 넘게 · 거꾸로면 기본).
 */
export async function readOpsRecentBookingsFor(session: AppSession, args: {
  properties?: readonly string[] | null;
  start: string;
  days: number;
  from?: string | null;
  to?: string | null;
}): Promise<OpsRecentBookingsResult> {
  const start = typeof args.start === "string" ? args.start : "";
  const days = typeof args.days === "number" && Number.isInteger(args.days) ? args.days : 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || days < 1 || days > 31) return { error: "failed", ok: false };
  const [y, m, d] = start.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + days - 1)).toISOString().slice(0, 10);
  const range = resolveRecentRange(Date.now(), {
    from: typeof args.from === "string" ? args.from : null,
    to: typeof args.to === "string" ? args.to : null,
  });
  try {
    const properties = parsePropertyParam(
      Array.isArray(args.properties) ? args.properties.filter((name): name is string => typeof name === "string") : [],
    );
    const bookings = await getOpsRecentBookings(session, { end, fromMs: range.fromMs, properties, start, toMs: range.toMs });
    return {
      bookings,
      endsNow: range.endsNow,
      from: new Date(range.fromMs).toISOString(),
      isDefault: range.isDefault,
      ok: true,
      to: new Date(range.toMs).toISOString(),
    };
  } catch (error) {
    console.error("[ops-calendar] recent bookings read failed", error);
    return { error: "failed", ok: false };
  }
}
