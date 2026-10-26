"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getAdminSessionForApi } from "@/lib/admin-session";
import { enqueueBeds24PriceJob, type PriceJobCellRequest } from "@/lib/beds24/price-job-queue";
import {
  Beds24HttpError,
  fetchBeds24BookingById,
  fetchBeds24Calendar,
  postBeds24Booking,
  postBeds24BookingCancel,
  postBeds24BookingUpdate,
} from "@/lib/beds24/calendar-client";
import { resolveReservationStatusFromBeds24Record } from "@/lib/beds24/reservation-status";
import { processBeds24WebhookBooking } from "@/lib/beds24/process-webhook-booking";
import {
  acquireBeds24Lock,
  activateBeds24Cooldown,
  getBeds24Cooldown,
  releaseBeds24Lock,
} from "@/lib/beds24/sync-locks";
import { isActiveUnitMinStay } from "@/lib/ops-gap-detection";
import { mergeOpsRateUnits, type OpsRateUnit } from "@/lib/ops-rate-merge";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import {
  beds24UnsellableNights,
  classifyBookingCreateError,
  manualBookingLockName,
  MAX_STAY_NIGHTS,
  readBeds24CancelTargetId,
  resolveStayUnit,
  splitGuestName,
  stayNights,
  validateManualBooking,
  type ManualBookingError,
  type ManualBookingInput,
} from "@/lib/ops-manual-booking";
import { opsUnitRoomKey, resolveOpsRowRoomKey } from "@/lib/ops-room-key";
import { toJstDateString } from "@/lib/admin-calendar-dashboard";
import {
  clearRoomBlock,
  createRoomBlock,
  type BlockWriteFailure,
} from "@/lib/beds24/block-write";
import { groupSelectionIntoRanges } from "@/lib/ops-calendar-selection";
import { parsePropertyParam } from "@/lib/ops-calendar-properties";
import { canAccessOpsAdmin, canWriteOpsCalendar } from "@/lib/ops-admin";
import { getOpsSalesSummary } from "@/lib/ops-sales-summary-server";
import type { OpsSalesSummary } from "@/lib/ops-sales-summary";
import type { SalesYoyPrevious } from "@/lib/ops-sales-yoy";
import {
  OPS_CALENDAR_ROLLING_DAYS,
  readOpsMoveTargets,
  readOpsRoomUnavailableNights,
} from "@/lib/ops-calendar";
import {
  addedNights,
  buildBeds24BookingUpdate,
  diffBookingReadback,
  validateBookingEdit,
  type BookingEditChanges,
  type BookingEditDraft,
  type BookingEditError,
} from "@/lib/ops-booking-edit";
import { buildOpsReservationDetail, type OpsReservationDetail } from "@/lib/ops-reservation-detail";
import {
  buildBeds24BookingMove,
  diffMoveReadback,
  moveTargetNights,
  validateReservationMove,
  type ReservationMoveError,
} from "@/lib/ops-booking-move";
import {
  buildAdjustmentPreview,
  type AdjustmentInput,
  type AdjustmentCellInput,
} from "@/lib/ops-price-adjustment";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { signalBeds24Change } from "@/lib/beds24/live-signal";
import { recordBlockLog } from "@/lib/beds24/block-log";
import { chunkCellsByRanges, planRevertCells, type RevertField } from "@/lib/ops-revert";
import { kickPriceJobWorker } from "@/lib/beds24/price-job-kick";
import {
  groupChangeRows,
  type ChangeGroup,
  type ChangeLogRow,
} from "@/lib/ops-history";
import { runNextPriceJob } from "@/lib/beds24/price-job-worker";
import { readRoomNames } from "@/app/api/ops/calendar/reads";

/**
 * 판매 캘린더의 **쓰기**.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md
 *
 * **권한을 매번 다시 본다.** service-role 은 RLS 를 우회하므로 화면에서 버튼을 감추는 것만
 * 으로는 막은 게 아니다(CLAUDE.md §6).
 *
 * 여기서는 **큐에 넣기만** 한다. Beds24 로는 워커가 보낸다 — 크레딧이 계정 단위라 즉시
 * 순차 POST 하면 예약 동기화와 다투고 429 가 난다. 접수 직후 워커를 한 번 깨우되
 * **기다리지 않는다**: 화면은 몇 초 안에 응답을 받아야 하고, 작업이 길면 크론이 이어받는다.
 */

const CONSOLE_PATH = "/admin/ops/calendar";
/** 모바일 판매 캘린더도 같은 데이터를 그린다 — 쓰기 뒤에는 두 화면을 함께 새로 받는다(2026-10-02). */
const MOBILE_CALENDAR_PATH = "/mobile/ops/calendar";
function revalidateOpsCalendars() {
  revalidatePath(CONSOLE_PATH);
  revalidatePath(MOBILE_CALENDAR_PATH);
}

/**
 * 실패 사유는 **코드로** 돌려준다. 문구는 화면이 사전에서 고른다 — 서버 액션이 한국어를
 * 직접 돌려주면 일본어·영어 사용자에게 한국어가 뜬다(CLAUDE.md §2).
 */
export type PriceChangeError =
  | "forbidden"
  | "no_cells"
  | "no_priced_cells"
  | "bad_min_stay"
  | "no_writable_room"
  | "invalid_values"
  | "enqueue_failed";

export type PriceChangeResult =
  | { ok: false; error: PriceChangeError }
  | { ok: true; jobId: string; cells: number; targetRooms: number; skippedDates: string[] };

/** 화면이 보내오는 칸. **어느 Beds24 유닛에 쓸지는 서버가 정한다.** */
export type PriceChangeCell = {
  roomKey: string;
  roomLabel: string;
  /** 그 캘린더 행 뒤의 우리 `rooms.id` 전부. 유닛이 여럿일 수 있다. */
  roomIds: string[];
  date: string;
  /** 지금 화면에 보이는 가격. 퍼센트 계산의 기준이다. */
  currentPrice: number | null;
};

/** 보기(읽기) — 운영 관리자 영역에 들어올 수 있으면 된다(`ops_admin.access`). */
async function requireOpsReader() {
  // 화면을 옮기지 않고 「권한 없음」만 돌려준다 — 모바일 판매 캘린더 · 자동화도 같은 액션을 부른다.
  const auth = await getAdminSessionForApi();
  if (!auth.ok) return null;
  const { session } = auth;
  if (!canAccessOpsAdmin(session)) return null;
  return session;
}

/**
 * 바꾸기(쓰기) — 가격 · 최소숙박 · 차단 · 수기 예약 · 예약 수정 · 옮기기 · 취소 · 되돌리기 · 대기 가격 보내기. 보기 권한에 더해
 * `ops_calendar.write` 가 있어야 한다(2026-10-20 권한 정리 5-1 — 채널로 바로 나가는 쓰기를 따로 잠근다. 기본은 대표 · 전무라 지금과 같다).
 */
async function requireOpsWriter() {
  const session = await requireOpsReader();
  if (!session || !canWriteOpsCalendar(session)) return null;
  return session;
}

/**
 * 칸마다 **지금 가격**(격자와 같은 병합 — 운영 중 유닛의 p1). 칸의 유닛은 이 조직 것만 읽는다. 읽기에 실패하면
 * `null` — 기준가를 모르면 보내지 않는다.
 */
async function readServerCellPrices(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  organizationId: string,
  cells: readonly PriceChangeCell[],
): Promise<Map<string, number | null> | null> {
  const roomIds = [...new Set(cells.flatMap((cell) => cell.roomIds))];
  const dates = [...new Set(cells.map((cell) => cell.date))];
  if (roomIds.length === 0 || dates.length === 0) return new Map();
  const rates = await readAllPages<OpsRateUnit & { room_id: string; stay_date: string }>((from, to) =>
    supabase
      .from("room_daily_rates")
      .select("room_id, stay_date, price1, price2, price3, min_stay, max_stay, num_avail, override_kind")
      .eq("organization_id", organizationId)
      .in("room_id", roomIds)
      .in("stay_date", dates)
      .order("room_id", { ascending: true })
      .order("stay_date", { ascending: true })
      .range(from, to),
  );
  if (rates.error) return null;
  const byUnitDate = new Map(rates.data.map((row) => [`${row.room_id}|${row.stay_date}`, row]));
  const prices = new Map<string, number | null>();
  for (const cell of cells) {
    const units = cell.roomIds
      .map((id) => byUnitDate.get(`${id}|${cell.date}`))
      .filter((row): row is OpsRateUnit & { room_id: string; stay_date: string } => !!row);
    prices.set(`${cell.roomKey}|${cell.date}`, mergeOpsRateUnits(units)?.price ?? null);
  }
  return prices;
}

/**
 * 가격 수정.
 *
 * **`p1`(에어비앤비)만 쓴다.** 나머지 슬롯은 Beds24 가격 링크가 `p1` 에서 계산한다 —
 * 2026-09-29 전수 실측: `p2` = Booking.com(×1.48 등), `p3` = 방마다 다르다(홈페이지 ×1 이 37개,
 * **오쿠보C 는 Agoda ×1.3, 사노는 Booking.com ×1.65**), 39개 방 전부 **링크 슬롯**이다.
 *
 * 예전에는 저쪽을 따라 `p3` 에도 같은 값을 썼다(「p3 = 홈페이지 ×1」 전제). 링크 슬롯이라
 * Beds24 가 무시해 피해는 없었지만, 누가 링크를 끊는 순간 **그 방의 Agoda·Booking.com 가격이
 * 에어비앤비 가격으로 덮인다**(오쿠보C Agoda 23%, 사노 Booking.com 39% 싸짐). 보낼 이유가 없다.
 */
export async function submitPriceChange(args: {
  cells: PriceChangeCell[];
  input: AdjustmentInput;
}): Promise<PriceChangeResult> {
  const session = await requireOpsWriter();
  if (!session) return { error: "forbidden", ok: false };
  if (args.cells.length === 0) return { error: "no_cells", ok: false };

  const supabase = getSupabaseServiceClient();

  // **화면이 보낸 금액을 그대로 믿지 않는다.** 같은 계산을 서버에서 다시 한다 —
  // 보이는 것과 보내는 것이 갈라지면 「¥30,000 으로 바꿨다」는데 다른 값이 나간다.
  //
  // **기준가(지금 가격)도 서버가 읽는다**(2026-10-05). 전에는 화면이 보낸 `currentPrice` 에 % 를 곱했다 — 화면을
  // 연 뒤 Beds24 에서 바뀐 가격이나 조작된 값이 그대로 기준이 됐다. 격자와 같은 병합(`mergeOpsRateUnits` — 운영 중
  // 유닛의 p1)으로 칸마다 다시 구한다. 요금 칸이 없으면 기준가가 없어 그 칸은 빠진다(격자의 빈 칸과 같다).
  const serverPrices = await readServerCellPrices(supabase, session.organization.id, args.cells);
  if (!serverPrices) return { error: "no_priced_cells", ok: false };
  const preview = buildAdjustmentPreview(
    args.cells.map(
      (cell): AdjustmentCellInput => ({
        date: cell.date,
        price: serverPrices.get(`${cell.roomKey}|${cell.date}`) ?? null,
        roomKey: cell.roomKey,
        roomLabel: cell.roomLabel,
      }),
    ),
    args.input,
  );
  if (preview.rows.length === 0) {
    return { error: "no_priced_cells", ok: false };
  }

  const roomIdsByCell = new Map(
    args.cells.map((cell) => [`${cell.roomKey}|${cell.date}`, cell.roomIds]),
  );
  const requests: PriceJobCellRequest[] = preview.rows.map((row) => ({
    roomIds: roomIdsByCell.get(`${row.roomKey}|${row.date}`) ?? [],
    roomLabel: row.roomLabel,
    stayDate: row.date,
    // p1 = 에어비앤비. 나머지는 **넣지 않는다**(키가 없으면 Beds24 가 유지하고, 링크가 계산한다).
    values: { p1: row.newPrice },
  }));

  const queued = await enqueueBeds24PriceJob({
    adjustMode: args.input.kind,
    cells: requests,
    jobType: "price",
    percentValue: args.input.kind === "percent" ? args.input.percent : null,
    organizationId: session.organization.id,
    requestedBy: session.user.id,
    requestedByName: session.user.name,
    supabase,
  });
  if (!queued.ok) return { error: queued.error, ok: false };

  // **응답 뒤에 워커를 돌린다**(`after`) — `void` 로 흘려 두면 배포 환경은 응답과 함께 함수를
  // 멈춰서, 다음 크론(실측 수십 분 지연)까지 반영이 밀렸다(2026-09-28).
  //
  // `revalidatePath` 는 **하지 않는다.** 이 시점엔 접수만 했고 바뀐 데이터가 없는데, 하면 응답에
  // 페이지 전체 재렌더가 실려 「저장」 응답만 느려진다. 반영 뒤에 화면이 스스로 다시 받는다
  // (`ops-write-tracker.ts`).
  after(kickWorker);
  return {
    cells: preview.rows.length,
    jobId: queued.jobId,
    ok: true,
    skippedDates: queued.skippedDates,
    targetRooms: queued.targetRooms,
  };
}

/**
 * 최소 숙박일 수정 — **「1박으로」가 이것이다.**
 *
 * 1박 갭(하루만 비었는데 최소 2박이라 아무도 못 사는 날)을 실제로 팔 수 있게 만드는 버튼이다.
 * 가격과 달리 **그 날짜에 운영 중인 유닛**으로 간다(`price-job-queue.ts`).
 */
export async function submitMinStayChange(args: {
  cells: Array<{ roomKey: string; roomLabel: string; roomIds: string[]; date: string }>;
  minStay: number;
}): Promise<PriceChangeResult> {
  const session = await requireOpsWriter();
  if (!session) return { error: "forbidden", ok: false };
  if (args.cells.length === 0) return { error: "no_cells", ok: false };
  // 0은 Beds24 에서 「비활성」과 구별이 안 된다. 상한은 비활성 문턱(50) 바로 아래.
  if (!Number.isInteger(args.minStay) || args.minStay < 1 || args.minStay > 49) {
    return { error: "bad_min_stay", ok: false };
  }

  const supabase = getSupabaseServiceClient();
  const queued = await enqueueBeds24PriceJob({
    adjustMode: "min_stay",
    cells: args.cells.map((cell) => ({
      roomIds: cell.roomIds,
      roomLabel: cell.roomLabel,
      stayDate: cell.date,
      values: { m: args.minStay },
    })),
    jobType: "min_stay",
    organizationId: session.organization.id,
    requestedBy: session.user.id,
    requestedByName: session.user.name,
    supabase,
  });
  if (!queued.ok) return { error: queued.error, ok: false };

  // **응답 뒤에 워커를 돌린다**(`after`) — `void` 로 흘려 두면 배포 환경은 응답과 함께 함수를
  // 멈춰서, 다음 크론(실측 수십 분 지연)까지 반영이 밀렸다(2026-09-28).
  //
  // `revalidatePath` 는 **하지 않는다.** 이 시점엔 접수만 했고 바뀐 데이터가 없는데, 하면 응답에
  // 페이지 전체 재렌더가 실려 「저장」 응답만 느려진다. 반영 뒤에 화면이 스스로 다시 받는다
  // (`ops-write-tracker.ts`).
  after(kickWorker);
  return {
    cells: args.cells.length,
    jobId: queued.jobId,
    ok: true,
    skippedDates: queued.skippedDates,
    targetRooms: queued.targetRooms,
  };
}

/** 접수 직후 워커를 깨운다 — `src/lib/beds24/price-job-kick.ts`. */
async function kickWorker(): Promise<void> {
  await kickPriceJobWorker(getSupabaseServiceClient());
}

/**
 * 블록(차단) 걸기·해제.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「저쪽 블록의 실제 규칙」
 * 쓰기 계층: `src/lib/beds24/block-write.ts` (되읽기 검증 · 보상 롤백)
 *
 * ## 가격·최소숙박과 달리 **큐에 넣지 않는다**
 *
 * 가격은 수천 칸을 한 번에 바꾸므로 큐·배치가 필요하다. 블록은 방 몇 개 × 밤 며칠이고,
 * 무엇보다 **사람이 화면 앞에서 결과를 기다린다** — 「막혔나 안 막혔나」를 모른 채 넘어가면
 * 그 자리에서 초과예약이 난다. 저쪽도 동기로 한다.
 *
 * ## 모든 유닛에 건다
 *
 * 최소숙박과 달리 **활성 유닛만 고르지 않는다.** 막는 것은 「그 물리적 방을 팔지 않는다」는
 * 뜻이고, 잠긴 유닛에 `override: blackout` 을 걸어도 잠금(minStay)은 그대로라 부작용이 없다.
 * 오히려 한 유닛만 막으면 나머지 listing 으로 그 방이 팔린다.
 */
export type BlockChangeError = BlockWriteFailure | "forbidden" | "no_cells" | "unknown_room" | "past_date";

export type BlockChangeResult =
  /**
   * `appliedRanges` — 실패 **앞에서** 이미 Beds24 에 반영된 구간 수. 0 이 아니면 일부는 막혔다(풀렸다)는 뜻이라
   * 화면이 그렇게 알려야 한다 — 「실패」만 보면 사람은 전부 안 된 줄 알고 다시 누른다(2026-10-01).
   */
  | {
      ok: false;
      error: BlockChangeError;
      detail?: string;
      appliedRanges?: number;
      /**
       * 반영되지 **않은** 구간 — 실패한 구간과 그 뒤 손대지 않은 구간(2026-10-19). 둘 다 우리 표 · Beds24 모두 누르기 전
       * 그대로다(실패 구간은 `block-write.ts` 가 되돌린다). 화면이 「어느 방 · 며칠」인지 적어 다시 고르게 한다.
       */
      unappliedRanges?: BlockUnappliedRange[];
    }
  /** `at` — 이 한 번의 누름이 이력에 남긴 시각(`price_change_logs.created_at`). 알림의 「되돌리기」가 그대로 넘긴다(`revertBlockChange`). */
  | { ok: true; ranges: number; nights: number; at: string };

export type BlockChangeCell = { roomKey: string; roomLabel: string; roomIds: string[]; date: string };

export type BlockUnappliedRange = { roomKey: string; roomLabel: string; startDate: string; endDate: string };

/** 한 번에 처리하는 구간 수. 실수로 격자 전체를 고르고 누르는 것을 서버에서도 막는다. */
const MAX_BLOCK_RANGES = 60;

type BlockRoomRow = {
  id: string;
  external_room_id: string | null;
  room_label: string;
  properties: { name: string } | { name: string }[] | null;
};

/** `YYYY-MM-DD` 양끝 포함 — 차단 구간의 밤들. */
function eachNightInclusive(startDate: string, endDate: string): string[] {
  const nights: string[] = [];
  const cursor = new Date(`${startDate}T12:00:00Z`);
  for (let guard = 0; guard < 400; guard += 1) {
    const date = cursor.toISOString().slice(0, 10);
    if (date > endDate) break;
    nights.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

/** 차단 사유 코드 — 화면이 번역한다(`bkPurposes`). DB 체크 제약과 같다(`202610010001`). */
export type BlockPurpose = "repair" | "cleaning" | "owner" | "other";
const BLOCK_PURPOSES: readonly BlockPurpose[] = ["repair", "cleaning", "owner", "other"];
const BLOCK_MEMO_MAX = 200;

async function runBlockChange(
  args: { cells: BlockChangeCell[]; purpose?: string | null; memo?: string | null },
  mode: "block" | "unblock",
): Promise<BlockChangeResult> {
  const session = await requireOpsWriter();
  if (!session) return { error: "forbidden", ok: false };
  if (args.cells.length === 0) return { error: "no_cells", ok: false };
  // 사유는 **걸 때만** 남긴다. 모르는 코드는 버리고(없는 것과 같다), 메모는 잘라서 받는다.
  const purpose =
    mode === "block" && BLOCK_PURPOSES.includes(args.purpose as BlockPurpose) ? (args.purpose as BlockPurpose) : null;
  const memo = mode === "block" ? args.memo?.trim().slice(0, BLOCK_MEMO_MAX) || null : null;

  const ranges = groupSelectionIntoRanges(
    args.cells.map((cell) => ({ date: cell.date, roomKey: cell.roomKey })),
  );
  if (ranges.length === 0) return { error: "no_cells", ok: false };
  if (ranges.length > MAX_BLOCK_RANGES) {
    return { detail: `${ranges.length}`, error: "no_cells", ok: false };
  }
  // **지난 밤은 막지 않는다**(도쿄 오늘부터). 지난 날짜 차단은 팔 수 없는 밤을 또 막는 것이라 의미가 없고,
  // 변경 이력만 어지럽힌다 — 격자도 지난 칸은 흐리게 그린다. 해제는 막지 않는다(지난 차단 정리).
  if (mode === "block") {
    const today = toJstDateString(new Date());
    if (ranges.some((range) => range.startDate < today)) return { error: "past_date", ok: false };
  }

  // 화면이 보낸 `roomIds` 는 우리 `rooms.id` 다. Beds24 roomId 는 **서버가 찾는다** —
  // 클라이언트가 외부 식별자를 들고 다니면 조작된 값이 그대로 Beds24 로 나간다.
  const roomIdsByKey = new Map<string, string[]>();
  for (const cell of args.cells) roomIdsByKey.set(cell.roomKey, cell.roomIds);
  const allRoomIds = [...new Set(args.cells.flatMap((cell) => cell.roomIds))];

  const supabase = getSupabaseServiceClient();
  const roomsResult = await supabase
    .from("rooms")
    .select("id, external_room_id, room_label, properties(name)")
    .eq("organization_id", session.organization.id)
    .in("id", allRoomIds);
  if (roomsResult.error) return { error: "unknown_room", ok: false };

  const unitById = new Map<string, BlockRoomRow>();
  for (const row of (roomsResult.data ?? []) as BlockRoomRow[]) unitById.set(row.id, row);

  // 행 키는 **서버가 다시 계산한다** — 수기 예약 · 예약 수정과 같은 검사(`resolveOpsRowRoomKey`). 화면이 보낸
  // 「행 키 + 유닛 id」가 한 행으로 모이지 않거나 다른 조직 유닛이 섞이면 거절한다. 전에는 조직만 확인해서,
  // 키와 유닛을 엇갈려 보내면 다른 방이 막히고 이력엔 엉뚱한 행으로 남을 수 있었다.
  const ownedUnits = [...unitById.values()].map((unit) => ({
    id: unit.id,
    propertyName: (Array.isArray(unit.properties) ? unit.properties[0] : unit.properties)?.name,
    roomLabel: unit.room_label,
  }));
  for (const [roomKey, roomIds] of roomIdsByKey) {
    const row = resolveOpsRowRoomKey({ clientRoomKey: roomKey, ownedUnits, requestedRoomIds: roomIds });
    if (!row.ok) return { error: "unknown_room", ok: false };
  }

  const unitsOfRange = (roomKey: string) =>
    (roomIdsByKey.get(roomKey) ?? [])
      .map((id) => unitById.get(id))
      .filter((row): row is BlockRoomRow => !!row && !!row.external_room_id);
  // 쓸 수 없는 방은 **아무것도 쓰기 전에** 거절한다 — 중간에 멈추면 앞 구간만 반영된다.
  if (ranges.some((range) => unitsOfRange(range.roomKey).length === 0)) return { error: "unknown_room", ok: false };

  let nights = 0;
  let appliedRanges = 0;
  const labelByKey = new Map(args.cells.map((cell) => [cell.roomKey, cell.roomLabel]));
  // 한 번 누른 것은 **같은 시각**으로 남긴다 — 변경 이력이 이 시각으로 한 줄로 묶는다(`groupChangeRows`).
  const actedAt = new Date().toISOString();
  for (const range of ranges) {
    const units = unitsOfRange(range.roomKey);

    const property = Array.isArray(units[0].properties) ? units[0].properties[0] : units[0].properties;
    const shared = {
      externalRoomIds: units.map((unit) => String(unit.external_room_id)),
      organizationId: session.organization.id,
      propertyName: property?.name ?? "",
      range: { endDate: range.endDate, startDate: range.startDate },
      roomLabel: units[0].room_label,
      supabase,
    };

    const result =
      mode === "block"
        ? await createRoomBlock({ ...shared, actorUserId: session.user.id })
        : await clearRoomBlock(shared);

    // 변경 이력 — 가격·최소숙박과 같은 표(`price_change_logs.field = 'blackout'`, 1 = 차단 · 0 = 열림).
    // 방당 **유닛 하나**만 적는다 — 유닛이 둘인 방도 화면에서는 한 칸이다.
    if (result.ok) {
      const historyRows = eachNightInclusive(range.startDate, range.endDate).map((date) => ({
        adjust_mode: "block",
        changed_by: session.user.id,
        changed_by_name: session.user.name ?? null,
        created_at: actedAt,
        external_room_id: String(units[0].external_room_id),
        field: "blackout",
        job_id: null,
        new_value: mode === "block" ? 1 : 0,
        old_value: mode === "block" ? 0 : 1,
        organization_id: session.organization.id,
        percent_value: null,
        room_id: units[0].id,
        room_label: units[0].room_label,
        stay_date: date,
      }));
      const logged = await supabase.from("price_change_logs").insert(historyRows as never);
      if (logged.error) console.error("[ops/calendar] block history log failed", logged.error);
    }

    // 성공이든 실패든 **구간마다** 남긴다 — 「이력 → Beds24 전송」 탭(`beds24_block_logs`).
    await recordBlockLog(supabase, {
      action: mode,
      detail: result.ok ? null : Array.isArray(result.detail) ? result.detail.join(", ") : (result.detail ?? null),
      end_date: range.endDate,
      external_room_ids: shared.externalRoomIds,
      memo,
      nights: result.ok ? result.nights : null,
      organization_id: session.organization.id,
      property_name: shared.propertyName || null,
      purpose,
      reason: result.ok ? null : result.reason,
      requested_by: session.user.id,
      requested_by_name: session.user.name ?? null,
      room_label: shared.roomLabel,
      start_date: range.startDate,
      status: result.ok ? "succeeded" : "failed",
    });

    // **첫 실패에서 멈춘다.** 이어서 더 쓰면 「어디까지 됐는지」를 사람이 알 수 없다.
    // 이미 성공한 구간은 되읽기로 검증된 상태라 그대로 두어도 안전하다 — 다만 **화면은 새로 그려야 한다.**
    // 예전에는 여기서 바로 돌아가 앞 구간이 막힌 것이 격자에 안 보였다(2026-10-01).
    if (!result.ok) {
      if (appliedRanges > 0) revalidateOpsCalendars();
      const unappliedRanges = ranges.slice(appliedRanges).map((item) => ({
        endDate: item.endDate,
        roomKey: item.roomKey,
        roomLabel: labelByKey.get(item.roomKey) ?? item.roomKey,
        startDate: item.startDate,
      }));
      return { appliedRanges, detail: result.detail, error: result.reason, ok: false, unappliedRanges };
    }
    nights += result.nights;
    appliedRanges += 1;
  }

  revalidateOpsCalendars();
  return { at: actedAt, nights, ok: true, ranges: ranges.length };
}

export async function submitRoomBlock(args: {
  cells: BlockChangeCell[];
  purpose?: BlockPurpose | null;
  memo?: string | null;
}): Promise<BlockChangeResult> {
  return runBlockChange(args, "block");
}

export async function submitRoomUnblock(args: { cells: BlockChangeCell[] }): Promise<BlockChangeResult> {
  return runBlockChange(args, "unblock");
}

/**
 * 수동 예약 생성.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「수동 예약 생성」
 * 규칙: `src/lib/ops-manual-booking.ts` (순수 · 테스트로 고정)
 *
 * ## 저쪽과 다르게 한 것 하나
 *
 * 저쪽은 **손님 이름에 `blackout` / `room block` 이 들어가면 차단을 만든다.** 화면 어디에도
 * 안 적힌 매직 문자열이라 빼기로 했다(2026-09-28 사용자 확인). 우리는 차단 전용 모드가
 * 따로 있고, 그쪽은 되읽기 검증·재고 스냅샷·보상 롤백까지 갖췄다. 여기서는 **예약만** 만든다.
 *
 * ## 예약은 roomId 하나에 붙는다
 *
 * 숙박 전체에서 살아 있는 유닛을 하나 고른다. 중간에 갈리면 **거부하고 갈리는 날짜를
 * 돌려준다** — 저쪽도 거부하지만 「안 된다」만 말해서, 사람이 무엇을 고쳐야 할지 몰랐다.
 */
export type ManualBookingResult =
  /** `reservationId` — 우리 표에 넣은 행(다시 읽어 넣기에 성공했을 때만). 모바일 알림의 「열기」가 쓴다(2026-10-02). */
  | { ok: true; bookingId: string; reservationId: string | null }
  | {
      ok: false;
      error:
        | ManualBookingError
        | "forbidden"
        | "unknown_room"
        | "beds24_failed"
        | "cooldown"
        /** 숙박 중간에 파는 유닛이 갈린다 — `conflictDates` 에 갈리는 밤이 담긴다. */
        | "unit_changes"
        /** 그 밤에 파는 유닛이 하나도 없다. */
        | "no_active_unit"
        /** 이미 예약·블록이 있는 밤이 끼어 있다 — `conflictDates` 에 그 밤이 담긴다. */
        | "occupied"
        /** 같은 요청 키가 아직 처리 중이다 — 두 번 눌렀다. */
        | "duplicate_request"
        /** 같은 방에 다른 수기 예약을 만드는 중이다(방 잠금, 2026-10-19). 잠시 뒤 다시. */
        | "room_busy"
        /** Beds24 가 제때 답하지 않아 **만들어졌는지 모른다**(2026-10-19). Beds24 에서 확인해야 한다 — 그냥 다시 누르면 두 번 생길 수 있다. */
        | "unconfirmed";
      /** 유닛이 갈리거나 팔 수 없는 밤. 화면이 날짜를 적어 준다. */
      conflictDates?: string[];
      detail?: string;
    };

export type RoomAvailabilityResult =
  | { ok: true; booked: string[]; unsellable: string[] }
  | { ok: false; error: "forbidden" | "bad_range" | "read_failed" };

/** 한 번에 읽는 최대 기간. 피커는 한 달씩 넘기므로 두 달이면 충분하다. */
const AVAILABILITY_MAX_DAYS = 62;

/**
 * 수동 예약 패널의 날짜 피커가 **팔 수 없는 밤**을 회색으로 칠하려고 부른다.
 *
 * 격자가 가진 예약은 화면 창(30일·한 달)뿐이라, 피커로 다음 달을 넘기면 모른다. 그래서
 * 피커가 여는 달마다 여기서 읽는다. 겹침 검사와 **같은 함수**다.
 */
export async function loadRoomAvailability(args: {
  roomKey: string;
  roomIds: string[];
  from: string;
  toExclusive: string;
  /** 예약 수정에서 — 그 예약 자신은 「이미 찬 밤」으로 세지 않는다. */
  excludeReservationId?: string;
}): Promise<RoomAvailabilityResult> {
  const session = await requireOpsReader();
  if (!session) return { error: "forbidden", ok: false };

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(args.from) || !datePattern.test(args.toExclusive)) {
    return { error: "bad_range", ok: false };
  }
  if (args.toExclusive <= args.from || stayNights(args.from, args.toExclusive).length > AVAILABILITY_MAX_DAYS) {
    return { error: "bad_range", ok: false };
  }

  const supabase = getSupabaseServiceClient();
  // 넘어온 유닛이 **이 조직의 것인지** 확인한다 — 서비스 키로 읽으므로 RLS 가 막아 주지 않는다.
  const ownedResult = await supabase
    .from("rooms")
    .select("id")
    .eq("organization_id", session.organization.id)
    .in("id", args.roomIds);
  if (ownedResult.error) return { error: "read_failed", ok: false };
  const roomIds = (ownedResult.data ?? []).map((row) => row.id as string);

  try {
    const result = await readOpsRoomUnavailableNights({
      excludeReservationId: args.excludeReservationId,
      from: args.from,
      organizationId: session.organization.id,
      roomIds,
      roomKey: args.roomKey,
      supabase,
      toExclusive: args.toExclusive,
    });
    return { ...result, ok: true };
  } catch (error) {
    console.error("[ops-calendar] availability read failed", error);
    return { error: "read_failed", ok: false };
  }
}

/** 수기 예약 Beds24 호출 시간 제한. 생성은 보통 2~4초 — 넘으면 「모름」으로 다룬다(`classifyBookingCreateError`). */
const MANUAL_BOOKING_CREATE_TIMEOUT_MS = 20_000;
/** 가용 재확인 · 생성 뒤 다시 읽기. */
const MANUAL_BOOKING_READ_TIMEOUT_MS = 10_000;
/** 방 잠금 수명 — 위 두 호출의 최악(읽기 10 + 생성 20 + 다시 읽기 10초)과 DB 쓰기를 넉넉히 덮는다. 함수가 죽어도 이만큼 뒤에 풀린다. */
const MANUAL_BOOKING_LOCK_TTL_MS = 90_000;

export async function submitManualBooking(args: {
  input: ManualBookingInput;
  /** 그 캘린더 행 뒤의 우리 `rooms.id` 전부. Beds24 roomId 는 서버가 찾는다. */
  roomIds: string[];
  guestEmail: string;
  guestPhone: string;
  comments: string;
  /**
   * 요청 키 — 패널을 열 때 화면이 만든 uuid. 같은 키로는 예약을 **한 번만** 만든다
   * (`ops_manual_booking_requests`, 2026-10-05). 다시 누르면 처음 만든 예약을 돌려준다.
   */
  requestKey: string;
}): Promise<ManualBookingResult> {
  const session = await requireOpsWriter();
  if (!session) return { error: "forbidden", ok: false };
  const requestKey = String(args.requestKey ?? "").trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestKey)) return { error: "beds24_failed", detail: "bad_request_key", ok: false };

  const today = toJstDateString(new Date());
  const invalid = validateManualBooking(args.input, today);
  if (invalid) return { error: invalid, ok: false };

  const nights = stayNights(args.input.arrival, args.input.departure);
  const supabase = getSupabaseServiceClient();

  const unitsResult = await supabase
    .from("rooms")
    .select("id, room_label, external_room_id, properties(name, external_property_id)")
    .eq("organization_id", session.organization.id)
    .in("id", args.roomIds);
  if (unitsResult.error) return { error: "unknown_room", ok: false };

  type UnitProperty = { name: string | null; external_property_id: string | null };
  type UnitRow = {
    id: string;
    room_label: string;
    external_room_id: string | null;
    properties: UnitProperty | UnitProperty[] | null;
  };
  const unitRows = (unitsResult.data ?? []) as unknown as UnitRow[];
  // 행 키는 **서버가 다시 계산한다** — 화면이 보낸 키를 믿으면 다른 행의 빈 칸을 근거로
  // 겹침 검사를 통과할 수 있다. 다른 조직 유닛이 섞였거나 키가 다르면 거절.
  const row = resolveOpsRowRoomKey({
    clientRoomKey: args.input.roomKey,
    ownedUnits: unitRows.map((unit) => ({
      id: unit.id,
      propertyName: (Array.isArray(unit.properties) ? unit.properties[0] : unit.properties)?.name,
      roomLabel: unit.room_label,
    })),
    requestedRoomIds: args.roomIds,
  });
  if (!row.ok) return { error: "unknown_room", ok: false };
  const units = unitRows.filter((unit) => !!unit.external_room_id);
  if (units.length === 0) return { error: "unknown_room", ok: false };

  // 밤마다 **그때 살아 있는** 유닛을 센다. `rooms.status` 는 오늘 하루의 스냅샷이라
  // 「10월 3일에 이 유닛이 팔렸나」에는 답하지 못한다.
  const ratesResult = await supabase
    .from("room_daily_rates")
    .select("room_id, stay_date, min_stay")
    .eq("organization_id", session.organization.id)
    .in("room_id", units.map((unit) => unit.id))
    .in("stay_date", nights);
  const minStayByKey = new Map<string, number | null>();
  for (const row of (ratesResult.data ?? []) as Array<{
    room_id: string;
    stay_date: string;
    min_stay: number | null;
  }>) {
    minStayByKey.set(`${row.room_id}|${row.stay_date}`, row.min_stay);
  }

  const activeByNight = new Map<string, string[]>();
  for (const night of nights) {
    const active = units
      .filter((unit) => isActiveUnitMinStay(minStayByKey.get(`${unit.id}|${night}`) ?? null))
      .map((unit) => String(unit.external_room_id));
    activeByNight.set(night, active);
  }

  // 같은 요청 키를 **먼저** 본다 — 이미 만든 예약이면 그것을 돌려준다. 아래 겹침 확인보다 앞이어야 한다: 방금 만든 그 예약이
  // 자기 밤을 「찬 밤」으로 만들어, 다시 누른 사람에게 「이미 예약 있음」이 떴다(2026-10-19).
  const priorKey = await supabase
    .from("ops_manual_booking_requests")
    .select("booking_id, reservation_id")
    .eq("organization_id", session.organization.id)
    .eq("request_key", requestKey)
    .maybeSingle();
  const priorKeyRow = priorKey.data as { booking_id: string | null; reservation_id: string | null } | null;
  if (priorKeyRow?.booking_id) {
    return { bookingId: priorKeyRow.booking_id, ok: true, reservationId: priorKeyRow.reservation_id };
  }
  if (priorKeyRow) return { error: "duplicate_request", ok: false };

  // **같은 방의 수기 예약은 한 번에 하나만**(2026-10-19). 가용 확인 → 생성 사이에 다른 요청이 끼면 둘 다 「비어 있음」을 보고
  // 둘 다 만든다 — Beds24 는 수기 예약의 겹침을 막아 주지 않는다. 방 단위 잠금(`beds24_try_lock`)을 잡고 그 안에서 확인 · 생성한다.
  const lockName = manualBookingLockName(session.organization.id, row.roomKey);
  const lock = await acquireBeds24Lock(supabase, lockName, session.user.id, MANUAL_BOOKING_LOCK_TTL_MS);
  if (!lock.acquired) {
    return lock.reason === "busy"
      ? { error: "room_busy", ok: false }
      : { detail: "lock_error", error: "beds24_failed", ok: false };
  }

  const createLocked = async (): Promise<ManualBookingResult> => {
    // **겹침은 서버가 한 번 더 막는다.** 패널이 회색으로 칠해 두지만 화면은 몇 초 전의 사정이다
    // — 그 사이에 채널 예약이 들어올 수 있고, Beds24 는 수기 예약의 겹침을 막아 주지 않는다.
    // 격자와 **같은 매칭**(`readOpsRoomUnavailableNights`)으로 본다.
    let unavailable: Awaited<ReturnType<typeof readOpsRoomUnavailableNights>>;
    try {
      unavailable = await readOpsRoomUnavailableNights({
        from: args.input.arrival,
        organizationId: session.organization.id,
        roomIds: units.map((unit) => unit.id),
        roomKey: row.roomKey,
        supabase,
        toExclusive: args.input.departure,
      });
    } catch (error) {
      // 확인을 못 했으면 만들지 않는다 — 「비어 있을 것이다」로 보내면 그대로 초과예약이다.
      return { detail: (error as Error).message, error: "beds24_failed", ok: false };
    }
    if (unavailable.booked.length > 0) {
      return { conflictDates: unavailable.booked, error: "occupied", ok: false };
    }

    const resolved = resolveStayUnit(activeByNight);
    if (!resolved.ok) {
      return { conflictDates: resolved.conflictDates, error: resolved.reason, ok: false };
    }

    const target = units.find((unit) => String(unit.external_room_id) === resolved.externalRoomId);
    const property = Array.isArray(target?.properties) ? target?.properties[0] : target?.properties;
    const propertyId = Number(property?.external_property_id ?? "");
    if (!target || !Number.isInteger(propertyId)) return { error: "unknown_room", ok: false };

    // **Beds24 에서 한 번 더 본다**(2026-10-19). 우리 표는 웹훅 · 동기화를 거친 값이라, 방금 들어온 채널 예약이나 방금 만든
    // 수기 예약(API 로 만든 예약은 웹훅이 오지 않는다 — 시간 초과로 결과를 모르는 것 포함)을 모를 수 있다. 그 유닛 · 그 밤만
    // 읽는다(요청 한 번). 확인을 못 하면 만들지 않는다.
    const cooldown = await getBeds24Cooldown(supabase);
    if (cooldown.active) return { error: "cooldown", ok: false };
    let live: Awaited<ReturnType<typeof fetchBeds24Calendar>>;
    try {
      live = await fetchBeds24Calendar(
        {
          endDate: nights[nights.length - 1],
          externalRoomIds: [resolved.externalRoomId],
          includeNumAvail: true,
          includeOverride: true,
          startDate: nights[0],
        },
        { timeoutMs: MANUAL_BOOKING_READ_TIMEOUT_MS },
      );
    } catch (error) {
      if (error instanceof Beds24HttpError && error.isRateLimit) {
        await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: error.resetInSec });
        return { error: "cooldown", ok: false };
      }
      return { detail: "availability_check_failed", error: "beds24_failed", ok: false };
    }
    if ("skipped" in live || live.truncated) {
      return { detail: "availability_check_failed", error: "beds24_failed", ok: false };
    }
    const liveTaken = beds24UnsellableNights(live.roomsById.get(resolved.externalRoomId)?.calendar ?? [], nights);
    if (liveTaken.length > 0) return { conflictDates: liveTaken, error: "occupied", ok: false };

    // **Beds24 를 부르기 전에 요청 키를 잡는다.** 이미 있으면 — 만든 예약이 있으면 그것을 돌려주고(우리 표 반영이
    // 실패해 화면에 안 보여 다시 누른 경우), 아직 처리 중이면 거절한다. 전에는 다시 누르면 같은 예약이 또 생겼다.
    const claim = await supabase
      .from("ops_manual_booking_requests")
      .insert({ created_by: session.user.id, organization_id: session.organization.id, request_key: requestKey });
    if (claim.error) {
      if (claim.error.code !== "23505") return { detail: claim.error.message, error: "beds24_failed", ok: false };
      const prior = await supabase
        .from("ops_manual_booking_requests")
        .select("booking_id, reservation_id")
        .eq("organization_id", session.organization.id)
        .eq("request_key", requestKey)
        .maybeSingle();
      const priorBooking = prior.data as { booking_id: string | null; reservation_id: string | null } | null;
      if (priorBooking?.booking_id) {
        return { bookingId: priorBooking.booking_id, ok: true, reservationId: priorBooking.reservation_id };
      }
      return { error: "duplicate_request", ok: false };
    }
    // Beds24 가 만들지 않았다고 답한 경우에만 키를 놓아 다시 시도할 수 있게 한다.
    const releaseClaim = () =>
      supabase
        .from("ops_manual_booking_requests")
        .delete()
        .eq("organization_id", session.organization.id)
        .eq("request_key", requestKey)
        .is("booking_id", null);

    const { firstName, lastName } = splitGuestName(args.input.guestName);
    let created: Awaited<ReturnType<typeof postBeds24Booking>>;
    try {
      created = await postBeds24Booking(
        {
          apiSource: "Direct",
          arrival: args.input.arrival,
          comments: args.comments.trim(),
          departure: args.input.departure,
          email: args.guestEmail.trim(),
          firstName,
          lastName,
          numAdult: args.input.numAdult,
          numChild: args.input.numChild,
          phone: args.guestPhone.trim(),
          price: args.input.totalPrice ?? 0,
          propertyId,
          roomId: Number(resolved.externalRoomId),
        },
        { timeoutMs: MANUAL_BOOKING_CREATE_TIMEOUT_MS },
      );
    } catch (error) {
      // **안 만들어진 게 확실할 때만** 키를 놓는다(`classifyBookingCreateError`). 시간 초과 · 연결 끊김은 이미 만들어졌을 수
      // 있다 — 키를 놓으면 다시 눌러 같은 예약이 두 번 생긴다. 키는 붙잡아 두고(같은 키 = 「처리 중」) 확인을 요청한다.
      // 다른 키로 다시 만들려 해도 위의 Beds24 재확인이 그 밤을 막는다.
      if (classifyBookingCreateError(error) === "unknown") {
        console.error("[ops/manual-booking] create outcome unknown", {
          error: error instanceof Error ? error.name : "unknown",
          roomId: resolved.externalRoomId,
        });
        return { error: "unconfirmed", ok: false };
      }
      await releaseClaim();
      if (error instanceof Beds24HttpError && error.isRateLimit) {
        await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: error.resetInSec });
        return { error: "cooldown", ok: false };
      }
      return {
        detail: error instanceof Error ? error.message : "unknown",
        error: "beds24_failed",
        ok: false,
      };
    }

    // 응답을 읽지 못했거나 성공인데 예약번호가 없으면 **만들어졌을 수 있다** — 위와 같이 키를 붙잡아 둔다.
    if (!("skipped" in created) && !created.ok && ["unexpected_response", "missing_booking_id"].includes(created.error)) {
      return { error: "unconfirmed", ok: false };
    }
    if ("skipped" in created || !created.ok) {
      await releaseClaim();
      return { detail: "skipped" in created ? created.skipped : created.error, error: "beds24_failed", ok: false };
    }
    // 만들어졌다 — 키에 예약번호를 단다. 이후 같은 키는 이 예약을 돌려받는다.
    const marked = await supabase
      .from("ops_manual_booking_requests")
      .update({ booking_id: created.bookingId })
      .eq("organization_id", session.organization.id)
      .eq("request_key", requestKey);
    if (marked.error) console.error("[ops/manual-booking] request key mark failed", marked.error);

    // **웹훅을 기다리지 않는다.** 방금 만든 예약이 화면에 안 보이면 사람은 또 만든다 — 게다가 API 로 만든
    // 예약은 Beds24 가 웹훅을 보내지 않는다(2026-10-01 실측). 예약 웹훅과 **같은 처리기**를 태운다.
    //
    // **만든 예약을 예약번호로 다시 읽어서** 넣는다(예약 수정과 같다). 생성 응답(`created.raw`)은 보낸
    // 필드 + id 뿐이라 처리기가 필수값 부족으로 조용히 건너뛰었다 — 가부키초 502 11/19 예약이 Beds24 에만
    // 있고 우리 표에 없던 원인(2026-10-01). 다시 읽기에 실패하면 생성 응답으로라도 시도한다.
    let reservationId: string | null = null;
    try {
      let payload = created.raw;
      try {
        const fetched = await fetchBeds24BookingById(created.bookingId, { timeoutMs: MANUAL_BOOKING_READ_TIMEOUT_MS });
        if (!("skipped" in fetched) && fetched.ok) payload = fetched.booking;
        else console.warn("[ops/manual-booking] re-read failed; using create response", { bookingId: created.bookingId });
      } catch (error) {
        console.warn("[ops/manual-booking] re-read threw; using create response", { bookingId: created.bookingId, error });
      }
      const saved = await processBeds24WebhookBooking({
        organizationIdDefault: session.organization.id,
        payload,
        supabase,
      });
      // 건너뛰어도 던지지 않는다 — 결과를 보고 **소리 내서** 남긴다. 다음 정합성(매일)이 맞출 때까지 화면에 없다.
      if (!saved.ok) {
        console.error("[ops/manual-booking] local upsert skipped", { bookingId: created.bookingId, result: saved });
      } else {
        reservationId = saved.reservationId ?? null;
      }
    } catch (error) {
      // 만들어진 것은 사실이다. 우리 표에 늦게 들어올 뿐이라 실패로 돌리지 않는다.
      console.error("[ops/manual-booking] local upsert failed", { bookingId: created.bookingId, error });
    }

    if (reservationId) {
      await supabase
        .from("ops_manual_booking_requests")
        .update({ reservation_id: reservationId })
        .eq("organization_id", session.organization.id)
        .eq("request_key", requestKey);
    }

    revalidateOpsCalendars();
    return { bookingId: created.bookingId, ok: true, reservationId };

  };

  try {
    return await createLocked();
  } finally {
    await releaseBeds24Lock(supabase, lockName, lock.lockId);
  }
}

/**
 * 예약 취소.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 취소」
 * 원본: `BuildingCalendar.jsx`(확인창) + `functions/index.js` → `cancelBooking`
 *
 * **되돌릴 수 없다.** 채널에도 그대로 나가고, Beds24 에서 다시 `confirmed` 로 돌려도 손님에게
 * 간 취소 통지는 취소되지 않는다. 화면이 확인 단계를 두고, 서버는 그 위에 두 가지를 더 본다 —
 *
 * 1. **이미 취소된 예약은 다시 취소하지 않는다.** 같은 요청을 두 번 보내면 Beds24 에
 *    「Cancelled by User」 주석만 덧씌워진다.
 * 2. **예약번호가 숫자일 때만 부른다.** 우리 표의 `apiReference` 는 채널 예약코드라,
 *    그걸로 부르면 엉뚱한 예약이 취소되거나 조용히 아무 일도 안 일어난다
 *    (`readBeds24CancelTargetId`).
 */
/**
 * 예약 상세 패널이 연다 — 막대를 누르면 **그 한 건만** 읽는다.
 *
 * 격자의 막대는 이름·날짜·채널만 들고 있다. 전부를 격자에 실으면 30일 창의 예약 수백 건
 * 원본이 매번 오가므로, 누른 것만 여기서 읽는다.
 *
 * **원본을 통째로 돌려주지 않는다** — 결제 토큰이 들어 있다. 이름을 지정한 필드만
 * (`buildOpsReservationDetail`).
 */
export async function loadReservationDetail(
  reservationId: string,
): Promise<{ ok: true; detail: OpsReservationDetail } | { ok: false; error: "forbidden" | "not_found" }> {
  const session = await requireOpsReader();
  if (!session) return { error: "forbidden", ok: false };

  const result = await getSupabaseServiceClient()
    .from("reservations")
    .select("id, status, guest_name, check_in_date, check_out_date, property_name, room_label, raw_payload")
    // service-role 로 읽으므로 **조직을 직접 건다** — RLS 가 막아 주지 않는다.
    .eq("organization_id", session.organization.id)
    .eq("id", reservationId)
    .maybeSingle();
  if (result.error || !result.data) return { error: "not_found", ok: false };

  return { detail: buildOpsReservationDetail(result.data), ok: true };
}

export type ReservationEditResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | BookingEditError
        | "forbidden"
        | "not_found"
        | "cancelled"
        | "no_booking_id"
        | "occupied"
        | "no_active_unit"
        /** 같은 방에 수기 예약 · 옮기기 · 다른 수정이 진행 중(방 잠금 · 2026-10-26). 잠깐 뒤 다시. */
        | "room_busy"
        | "beds24_failed"
        /** Beds24 가 받았지만 다시 읽으니 날짜 · 인원 · 금액이 안 바뀌었다(2026-10-08). `detail` = 항목 코드. */
        | "not_applied"
        | "cooldown";
      /** 겹치거나 판매 유닛이 없는 밤. 화면이 날짜를 적어 준다. */
      conflictDates?: string[];
      detail?: string;
    };

/**
 * 예약 수정.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 수정」
 * 규칙: `src/lib/ops-booking-edit.ts` (순수 · 테스트로 고정)
 * 원본: `functions/index.js` → `updateBooking`
 *
 * ## 저쪽보다 두 가지를 더 본다
 *
 * 저쪽은 날짜를 바꿔도 **아무것도 검사하지 않았다.** 우리는 **새로 묵게 되는 밤**만 골라
 * (`addedNights`) —
 *
 * 1. 다른 예약·블록과 겹치는지 — 격자와 **같은 매칭**, 그 예약 자신은 뺀다.
 * 2. 그 예약의 **유닛이 그 밤에 팔리고 있는지** — 예약은 roomId 하나에 붙어 있고 수정해도
 *    유닛은 그대로다. 잠긴 유닛의 밤으로 늘리면 접어둔 listing 이 다시 열린다.
 * 3. (2026-10-26) 새 밤이 있으면 수기 예약 · 옮기기와 **같은 방 잠금** 안에서 확인 → 보내기를 하고, 보내기 직전
 *    **Beds24 가용을 한 번 더** 읽는다(그 유닛 · 새 밤만). 잠금을 못 잡으면 `room_busy`.
 *
 * 원래 값은 **화면이 아니라 DB 에서** 읽는다 — 화면이 보낸 「원래 값」을 믿으면 채널 예약의
 * 잠금을 우회할 수 있다.
 */
export async function submitReservationEdit(args: {
  reservationId: string;
  /** 격자의 행 키와 그 행의 우리 `rooms.id` — 겹침 검사가 쓴다. */
  roomKey: string;
  roomIds: string[];
  changes: BookingEditChanges;
}): Promise<ReservationEditResult> {
  const session = await requireOpsWriter();
  if (!session) return { error: "forbidden", ok: false };

  const supabase = getSupabaseServiceClient();
  const found = await supabase
    .from("reservations")
    .select("id, status, source, guest_name, check_in_date, check_out_date, raw_payload")
    .eq("organization_id", session.organization.id)
    .eq("id", args.reservationId)
    .maybeSingle();
  if (found.error || !found.data) return { error: "not_found", ok: false };
  const row = found.data as {
    id: string;
    status: string;
    source: string;
    guest_name: string;
    check_in_date: string;
    check_out_date: string;
    raw_payload: unknown;
  };
  if (row.status === "cancelled" || row.status === "no_show") return { error: "cancelled", ok: false };

  const bookingId = readBeds24CancelTargetId(row.raw_payload);
  if (!bookingId) return { error: "no_booking_id", ok: false };

  const raw =
    row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
      ? (row.raw_payload as Record<string, unknown>)
      : {};
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  const num = (key: string) => {
    const value = Number(raw[key]);
    return Number.isFinite(value) ? value : null;
  };
  const original: BookingEditDraft = {
    arrival: row.check_in_date,
    departure: row.check_out_date,
    email: text("email"),
    guestName: row.guest_name,
    notes: text("notes"),
    numAdult: num("numAdult") ?? 1,
    numChild: num("numChild") ?? 0,
    phone: text("phone"),
    totalPrice: num("price"),
  };

  // 화면이 보낸 것 중 **정말 바뀐 것만** 남긴다(원래 값은 DB 기준).
  const changes: BookingEditChanges = {};
  for (const [key, value] of Object.entries(args.changes) as Array<[keyof BookingEditDraft, unknown]>) {
    const before = original[key];
    const same =
      typeof value === "string" && typeof before === "string" ? value.trim() === before.trim() : value === before;
    if (!same) (changes as Record<string, unknown>)[key] = typeof value === "string" ? value.trim() : value;
  }

  const today = toJstDateString(new Date());
  const invalid = validateBookingEdit({ changes, original, today });
  if (invalid) return { error: invalid, ok: false };

  const newNights = addedNights(original, changes).filter((night) => night >= today);
  // 새로 묵게 되는 밤이 있으면 행 키를 서버가 다시 계산하고, 수기 예약 · 옮기기와 **같은 방 잠금**(`manualBookingLockName`)
  // 안에서 확인 → 보내기를 한다(2026-10-26). 잠금 없이는 확인과 보내기 사이에 같은 방 수기 예약이 끼어 둘 다 「비어 있음」을
  // 보고 겹칠 수 있었다. 새 밤이 없으면(인원 · 금액 · 메모 · 줄이기만) 가용이 바뀌지 않으므로 잠그지 않는다.
  let lockedAxis: { roomKey: string; roomIds: string[] } | null = null;
  if (newNights.length > 0) {
    const ownedResult = await supabase
      .from("rooms")
      .select("id, room_label, properties(name)")
      .eq("organization_id", session.organization.id)
      .in("id", args.roomIds);
    if (ownedResult.error) return { detail: ownedResult.error.message, error: "beds24_failed", ok: false };
    type OwnedRow = { id: string; room_label: string; properties: { name: string | null } | { name: string | null }[] | null };
    // 행 키는 **서버가 다시 계산한다**(수동 예약과 같은 이유). 다른 조직 유닛·어긋난 키는 거절.
    const axis = resolveOpsRowRoomKey({
      clientRoomKey: args.roomKey,
      ownedUnits: ((ownedResult.data ?? []) as unknown as OwnedRow[]).map((unit) => ({
        id: unit.id,
        propertyName: (Array.isArray(unit.properties) ? unit.properties[0] : unit.properties)?.name,
        roomLabel: unit.room_label,
      })),
      requestedRoomIds: args.roomIds,
    });
    if (!axis.ok) return { error: "not_found", ok: false };
    lockedAxis = { roomIds: axis.roomIds, roomKey: axis.roomKey };
  }

  const editLocked = async (): Promise<ReservationEditResult> => {
    if (lockedAxis) {
      const axis = lockedAxis;
      const sorted = [...newNights].sort();
      const toExclusive = (() => {
        const at = new Date(`${sorted[sorted.length - 1]}T12:00:00Z`);
        at.setUTCDate(at.getUTCDate() + 1);
        return at.toISOString().slice(0, 10);
      })();

      let unavailable: Awaited<ReturnType<typeof readOpsRoomUnavailableNights>>;
      try {
        unavailable = await readOpsRoomUnavailableNights({
          excludeReservationId: row.id,
          from: sorted[0],
          organizationId: session.organization.id,
          roomIds: axis.roomIds,
          roomKey: axis.roomKey,
          supabase,
          toExclusive,
        });
      } catch (error) {
        // 확인을 못 했으면 보내지 않는다 — 「비어 있을 것이다」로 늘리면 그대로 초과예약이다.
        return { detail: (error as Error).message, error: "beds24_failed", ok: false };
      }
      const newSet = new Set(newNights);
      const clash = unavailable.booked.filter((night) => newSet.has(night));
      if (clash.length > 0) return { conflictDates: clash, error: "occupied", ok: false };

      // 예약이 붙은 **그 유닛**이 새 밤에 팔리고 있어야 한다.
      // **이 행의 유닛 안에서** 찾는다(`axis.roomIds` — 서버가 확인한 값). 조직 전체에서 `maybeSingle` 로 찾으면 같은
      // 방 번호의 유닛이 둘 이상일 때 오류가 나 「팔 수 있는 방 없음」으로 잘못 떨어졌다. 읽기 실패도 그 오류로
      // 덮지 않는다.
      const unitExternalId = String(raw.roomId ?? "");
      const unit = await supabase
        .from("rooms")
        .select("id")
        .eq("organization_id", session.organization.id)
        .in("id", axis.roomIds)
        .eq("external_room_id", unitExternalId)
        .limit(1);
      if (unit.error) return { detail: unit.error.message, error: "beds24_failed", ok: false };
      const unitId = ((unit.data ?? []) as Array<{ id: string }>)[0]?.id;
      if (!unitId) return { conflictDates: newNights, error: "no_active_unit", ok: false };
      const rates = await supabase
        .from("room_daily_rates")
        .select("stay_date, min_stay")
        .eq("organization_id", session.organization.id)
        .eq("room_id", unitId)
        .in("stay_date", newNights);
      const active = new Set(
        ((rates.data ?? []) as Array<{ stay_date: string; min_stay: number | null }>)
          .filter((rate) => isActiveUnitMinStay(rate.min_stay))
          .map((rate) => rate.stay_date),
      );
      const locked = newNights.filter((night) => !active.has(night));
      if (locked.length > 0) return { conflictDates: locked, error: "no_active_unit", ok: false };

      // **Beds24 에서 한 번 더 본다** — 수기 예약 · 옮기기와 같은 확인(그 유닛 · 새 밤만, 요청 한 번). 우리 표는 웹훅 · 동기화를
      // 거친 값이라 방금 들어온 채널 예약이나 API 로 만든 수기 예약을 모를 수 있다. 확인을 못 하면 보내지 않는다.
      const cooldown = await getBeds24Cooldown(supabase);
      if (cooldown.active) return { error: "cooldown", ok: false };
      let live: Awaited<ReturnType<typeof fetchBeds24Calendar>>;
      try {
        live = await fetchBeds24Calendar(
          {
            endDate: sorted[sorted.length - 1],
            externalRoomIds: [unitExternalId],
            includeNumAvail: true,
            includeOverride: true,
            startDate: sorted[0],
          },
          { timeoutMs: MOVE_READ_TIMEOUT_MS },
        );
      } catch (error) {
        if (error instanceof Beds24HttpError && error.isRateLimit) {
          await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: error.resetInSec });
          return { error: "cooldown", ok: false };
        }
        return { detail: "availability_check_failed", error: "beds24_failed", ok: false };
      }
      if ("skipped" in live || live.truncated) return { detail: "availability_check_failed", error: "beds24_failed", ok: false };
      const taken = beds24UnsellableNights(live.roomsById.get(unitExternalId)?.calendar ?? [], sorted);
      if (taken.length > 0) return { conflictDates: taken, error: "occupied", ok: false };
    }

    const updatePayload = buildBeds24BookingUpdate(bookingId, changes);
    let posted: Awaited<ReturnType<typeof postBeds24BookingUpdate>>;
    try {
      posted = await postBeds24BookingUpdate(updatePayload);
    } catch (error) {
      if (error instanceof Beds24HttpError && error.isRateLimit) {
        await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: error.resetInSec });
        return { error: "cooldown", ok: false };
      }
      return { detail: error instanceof Error ? error.message : "unknown", error: "beds24_failed", ok: false };
    }
    if ("skipped" in posted) return { detail: posted.skipped, error: "beds24_failed", ok: false };
    if (!posted.ok) return { detail: posted.error, error: "beds24_failed", ok: false };

    // **다시 읽어 확인하고 우리 표를 맞춘다** — 예약 웹훅과 같은 처리기라 형식이 갈리지 않는다.
    // 다시 읽은 날짜 · 인원 · 금액이 보낸 값과 다르면 「반영 안 됨」으로 돌린다(2026-10-08 — Beds24 는 받기만 하고 안 바꾼 것도
    // 성공으로 답할 수 있다). 다시 읽기 자체가 안 되면(네트워크) Beds24 가 받아들인 대로 성공 — 웹훅 · 정합성이 곧 맞춘다.
    let notApplied: string[] = [];
    try {
      const fetched = await fetchBeds24BookingById(bookingId);
      if (!("skipped" in fetched) && fetched.ok) {
        notApplied = diffBookingReadback(updatePayload, fetched.booking);
        await processBeds24WebhookBooking({
          organizationIdDefault: session.organization.id,
          payload: fetched.booking,
          supabase,
        });
      }
    } catch (error) {
      console.error("[ops/reservation-edit] local refresh failed", error);
    }

    revalidateOpsCalendars();
    if (notApplied.length > 0) {
      console.error("[ops/reservation-edit] Beds24 readback mismatch", { bookingId, fields: notApplied });
      return { detail: notApplied.join(","), error: "not_applied", ok: false };
    }
    return { ok: true };
  };

  if (!lockedAxis) return editLocked();
  const lockName = manualBookingLockName(session.organization.id, lockedAxis.roomKey);
  const lock = await acquireBeds24Lock(supabase, lockName, session.user.id, MOVE_LOCK_TTL_MS);
  if (!lock.acquired) {
    return lock.reason === "busy" ? { error: "room_busy", ok: false } : { detail: "lock_error", error: "beds24_failed", ok: false };
  }
  try {
    return await editLocked();
  } finally {
    await releaseBeds24Lock(supabase, lockName, lock.lockId);
  }
}

export type ReservationMoveResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | ReservationMoveError
        | "forbidden"
        | "not_found"
        | "cancelled"
        | "no_booking_id"
        | "unknown_room"
        /** 다른 건물로는 옮기지 않는다 — Beds24 예약은 건물(프로퍼티)에 묶여 있다. */
        | "other_building"
        | "occupied"
        | "no_active_unit"
        | "unit_changes"
        | "room_busy"
        | "beds24_failed"
        /** Beds24 가 받았지만 다시 읽으니 객실 · 날짜가 안 바뀌었다. `detail` = 항목 코드. */
        | "not_applied"
        | "cooldown";
      conflictDates?: string[];
      detail?: string;
    };

export type ReservationMoveTarget = {
  roomKey: string;
  /** free = 그 날짜에 비어 있고 팔고 있음 · booked = 예약 있음 · unsellable = 판매 안 함(최소숙박 50↑ 등) · current = 지금 객실. */
  state: "free" | "booked" | "unsellable" | "current";
  clashGuest: string | null;
};

/**
 * 「객실 옮기기」 패널의 후보 줄 — 같은 건물 줄마다 그 날짜에 옮길 수 있는가(2026-10-19). 화면이 주는 줄은 **조직 소속을
 * 확인한 유닛만** 쓴다. 최종 판정은 `submitReservationMove` 가 다시 한다(이건 미리 보여 주기).
 */
export async function loadReservationMoveTargets(args: {
  reservationId: string;
  currentRoomKey: string;
  arrival: string;
  departure: string;
  rows: Array<{ roomKey: string; roomIds: string[] }>;
}): Promise<{ ok: true; targets: ReservationMoveTarget[] } | { ok: false; error: "forbidden" | "bad_range" | "read_failed" }> {
  const session = await requireOpsReader();
  if (!session) return { error: "forbidden", ok: false };
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(args.arrival) || !datePattern.test(args.departure) || args.departure <= args.arrival) {
    return { error: "bad_range", ok: false };
  }
  if (stayNights(args.arrival, args.departure).length > AVAILABILITY_MAX_DAYS || args.rows.length > 80) {
    return { error: "bad_range", ok: false };
  }
  const supabase = getSupabaseServiceClient();
  const owned = await supabase
    .from("rooms")
    .select("id")
    .eq("organization_id", session.organization.id)
    .in("id", [...new Set(args.rows.flatMap((row) => row.roomIds))]);
  if (owned.error) return { error: "read_failed", ok: false };
  const ownedIds = new Set((owned.data ?? []).map((row) => row.id as string));
  const rows = args.rows.map((row) => ({ roomIds: row.roomIds.filter((id) => ownedIds.has(id)), roomKey: row.roomKey }));
  try {
    const byKey = await readOpsMoveTargets({
      excludeReservationId: args.reservationId,
      from: args.arrival,
      organizationId: session.organization.id,
      rows,
      supabase,
      toExclusive: args.departure,
    });
    const today = toJstDateString(new Date());
    return {
      ok: true,
      targets: rows.map((row) => {
        const info = byKey.get(row.roomKey);
        const ahead = (nights: string[] | undefined) => (nights ?? []).filter((night) => night >= today);
        const state: ReservationMoveTarget["state"] =
          row.roomKey === args.currentRoomKey
            ? "current"
            : row.roomIds.length === 0
              ? "unsellable"
              : ahead(info?.booked).length > 0
                ? "booked"
                : ahead(info?.unsellable).length > 0
                  ? "unsellable"
                  : "free";
        return { clashGuest: state === "booked" ? (info?.clashGuest ?? null) : null, roomKey: row.roomKey, state };
      }),
    };
  } catch (error) {
    console.error("[ops/reservation-move] targets read failed", error);
    return { error: "read_failed", ok: false };
  }
}

/**
 * 모바일 「객실 · 날짜 옮기기」 달력 — 한 달 동안 **그날 체크인하면 박수만큼 비어 있는 객실이 하나도 없는 날**(2026-10-19,
 * 시안 「예약 옮기기 · 모바일 날짜 시안」). 같은 건물 줄 전부(지금 줄 포함 — 날짜를 옮기면 지금 객실도 후보)를 본다.
 * 지난 날은 화면이 막는다. 미리 보여 주기일 뿐, 최종 판정은 `submitReservationMove`.
 */
export async function loadReservationMoveMonth(args: {
  reservationId: string;
  /** `YYYY-MM`. */
  month: string;
  nights: number;
  rows: Array<{ roomKey: string; roomIds: string[] }>;
}): Promise<{ ok: true; fullDays: string[] } | { ok: false; error: "forbidden" | "bad_range" | "read_failed" }> {
  const session = await requireOpsReader();
  if (!session) return { error: "forbidden", ok: false };
  if (!/^\d{4}-\d{2}$/.test(args.month) || !Number.isInteger(args.nights) || args.nights < 1 || args.nights > MAX_STAY_NIGHTS) {
    return { error: "bad_range", ok: false };
  }
  if (args.rows.length === 0 || args.rows.length > 80) return { error: "bad_range", ok: false };
  const [year, month] = args.month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const from = `${args.month}-01`;
  // 날짜 문자열끼리만 더한다(도쿄 운영일 — 정오 UTC 로 두면 하루가 밀리지 않는다).
  const addDays = (date: string, days: number) => {
    const at = new Date(`${date}T12:00:00Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
  };
  const toExclusive = addDays(`${args.month}-${String(lastDay).padStart(2, "0")}`, args.nights);
  const supabase = getSupabaseServiceClient();
  const owned = await supabase
    .from("rooms")
    .select("id")
    .eq("organization_id", session.organization.id)
    .in("id", [...new Set(args.rows.flatMap((row) => row.roomIds))]);
  if (owned.error) return { error: "read_failed", ok: false };
  const ownedIds = new Set((owned.data ?? []).map((row) => row.id as string));
  const rows = args.rows
    .map((row) => ({ roomIds: row.roomIds.filter((id) => ownedIds.has(id)), roomKey: row.roomKey }))
    .filter((row) => row.roomIds.length > 0);
  try {
    const byKey = await readOpsMoveTargets({
      excludeReservationId: args.reservationId,
      from,
      organizationId: session.organization.id,
      rows,
      supabase,
      toExclusive,
    });
    const taken = rows.map((row) => {
      const info = byKey.get(row.roomKey);
      return new Set([...(info?.booked ?? []), ...(info?.unsellable ?? [])]);
    });
    const fullDays: string[] = [];
    for (let day = 1; day <= lastDay; day += 1) {
      const arrival = `${args.month}-${String(day).padStart(2, "0")}`;
      const stay = stayNights(arrival, addDays(arrival, args.nights));
      if (!taken.some((set) => stay.every((night) => !set.has(night)))) fullDays.push(arrival);
    }
    return { fullDays, ok: true };
  } catch (error) {
    console.error("[ops/reservation-move] month read failed", error);
    return { error: "read_failed", ok: false };
  }
}

/** 옮기기 Beds24 호출 시간 제한 · 방 잠금 수명 — 수기 예약과 같은 값. */
const MOVE_WRITE_TIMEOUT_MS = 20_000;
const MOVE_READ_TIMEOUT_MS = 10_000;
const MOVE_LOCK_TTL_MS = 90_000;

/**
 * 예약 옮기기 — 같은 예약의 객실(과 직접 · 수기면 날짜)을 바꾼다(2026-10-19 사용자 확정).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「예약 옮기기」. 규칙: `src/lib/ops-booking-move.ts`.
 *
 * 1. 옮길 줄은 **서버가 다시 계산한다**(`resolveOpsRowRoomKey`) — 다른 조직 유닛 · 어긋난 키는 거절. 같은 건물만.
 * 2. **옮길 줄을 잠그고**(수기 예약과 같은 잠금 이름 — 그 줄의 수기 예약 생성과도 서로 막는다) 그 안에서
 *    우리 표 겹침(`readOpsRoomUnavailableNights`, 이 예약 자신은 뺀다) → 그 밤에 팔고 있는 유닛 고르기 → Beds24 가용 재확인.
 * 3. `POST /bookings` 로 **같은 예약**의 `roomId`(·날짜)만 바꾸고, 다시 읽어 옮겨졌는지 확인한 뒤 우리 표를 웹훅 처리기로 맞춘다.
 */
export async function submitReservationMove(args: {
  reservationId: string;
  /** 옮길 줄의 행 키와 그 줄의 우리 `rooms.id` 전부. Beds24 roomId 는 서버가 고른다. */
  targetRoomKey: string;
  targetRoomIds: string[];
  /** 새 체크인 · 체크아웃 — 채널 예약은 원래 날짜와 같아야 한다. 비우면 그대로. */
  arrival?: string;
  departure?: string;
}): Promise<ReservationMoveResult> {
  const session = await requireOpsWriter();
  if (!session) return { error: "forbidden", ok: false };

  const supabase = getSupabaseServiceClient();
  const found = await supabase
    .from("reservations")
    .select("id, status, source, check_in_date, check_out_date, raw_payload")
    .eq("organization_id", session.organization.id)
    .eq("id", args.reservationId)
    .maybeSingle();
  if (found.error || !found.data) return { error: "not_found", ok: false };
  const row = found.data as {
    id: string;
    status: string;
    source: string;
    check_in_date: string;
    check_out_date: string;
    raw_payload: unknown;
  };
  if (row.status === "cancelled" || row.status === "no_show") return { error: "cancelled", ok: false };
  const bookingId = readBeds24CancelTargetId(row.raw_payload);
  if (!bookingId) return { error: "no_booking_id", ok: false };
  const raw =
    row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
      ? (row.raw_payload as Record<string, unknown>)
      : {};
  const currentRoomId = String(raw.roomId ?? "");
  const currentPropertyId = String(raw.propertyId ?? "");

  const original = { arrival: row.check_in_date, departure: row.check_out_date };
  const next = { arrival: args.arrival ?? original.arrival, departure: args.departure ?? original.departure };

  const unitsResult = await supabase
    .from("rooms")
    .select("id, room_label, external_room_id, properties(name, external_property_id)")
    .eq("organization_id", session.organization.id)
    .in("id", args.targetRoomIds);
  if (unitsResult.error) return { error: "unknown_room", ok: false };
  type UnitProperty = { name: string | null; external_property_id: string | null };
  type UnitRow = { id: string; room_label: string; external_room_id: string | null; properties: UnitProperty | UnitProperty[] | null };
  const unitRows = (unitsResult.data ?? []) as unknown as UnitRow[];
  const target = resolveOpsRowRoomKey({
    clientRoomKey: args.targetRoomKey,
    ownedUnits: unitRows.map((unit) => ({
      id: unit.id,
      propertyName: (Array.isArray(unit.properties) ? unit.properties[0] : unit.properties)?.name,
      roomLabel: unit.room_label,
    })),
    requestedRoomIds: args.targetRoomIds,
  });
  if (!target.ok) return { error: "unknown_room", ok: false };
  const units = unitRows.filter((unit) => !!unit.external_room_id);
  if (units.length === 0) return { error: "unknown_room", ok: false };
  const propertyOf = (unit: UnitRow) => (Array.isArray(unit.properties) ? unit.properties[0] : unit.properties);
  if (currentPropertyId && units.some((unit) => String(propertyOf(unit)?.external_property_id ?? "") !== currentPropertyId)) {
    return { error: "other_building", ok: false };
  }
  const sameRow = units.some((unit) => String(unit.external_room_id) === currentRoomId);

  const today = toJstDateString(new Date());
  const invalid = validateReservationMove({ next, original, sameRow, today });
  if (invalid) return { error: invalid, ok: false };

  // 옮긴 숙박의 남은 밤(오늘부터) — 이 밤에 팔고 있는 유닛이어야 한다. 같은 줄이면 지금 유닛을 우선 쓴다.
  const stayAhead = stayNights(next.arrival, next.departure).filter((night) => night >= today);
  const ratesResult = await supabase
    .from("room_daily_rates")
    .select("room_id, stay_date, min_stay")
    .eq("organization_id", session.organization.id)
    .in("room_id", units.map((unit) => unit.id))
    .in("stay_date", stayAhead);
  if (ratesResult.error) return { detail: ratesResult.error.message, error: "beds24_failed", ok: false };
  const minStayByKey = new Map<string, number | null>();
  for (const rate of (ratesResult.data ?? []) as Array<{ room_id: string; stay_date: string; min_stay: number | null }>) {
    minStayByKey.set(`${rate.room_id}|${rate.stay_date}`, rate.min_stay);
  }
  const activeByNight = new Map<string, string[]>();
  for (const night of stayAhead) {
    activeByNight.set(
      night,
      units.filter((unit) => isActiveUnitMinStay(minStayByKey.get(`${unit.id}|${night}`) ?? null)).map((unit) => String(unit.external_room_id)),
    );
  }
  const keepCurrent = sameRow && stayAhead.every((night) => (activeByNight.get(night) ?? []).includes(currentRoomId));
  let targetRoomId = currentRoomId;
  if (!keepCurrent) {
    const resolved = resolveStayUnit(activeByNight);
    if (!resolved.ok) return { conflictDates: resolved.conflictDates, error: resolved.reason, ok: false };
    targetRoomId = resolved.externalRoomId;
  }

  const lockName = manualBookingLockName(session.organization.id, target.roomKey);
  const lock = await acquireBeds24Lock(supabase, lockName, session.user.id, MOVE_LOCK_TTL_MS);
  if (!lock.acquired) {
    return lock.reason === "busy" ? { error: "room_busy", ok: false } : { detail: "lock_error", error: "beds24_failed", ok: false };
  }

  const moveLocked = async (): Promise<ReservationMoveResult> => {
    // 우리 표 — 이 예약 자신은 「찬 밤」으로 세지 않는다.
    const newNights = moveTargetNights({ next, original, sameRow, today });
    if (newNights.length > 0) {
      let unavailable: Awaited<ReturnType<typeof readOpsRoomUnavailableNights>>;
      try {
        unavailable = await readOpsRoomUnavailableNights({
          excludeReservationId: row.id,
          from: newNights[0],
          organizationId: session.organization.id,
          roomIds: units.map((unit) => unit.id),
          roomKey: target.roomKey,
          supabase,
          toExclusive: next.departure,
        });
      } catch (error) {
        return { detail: (error as Error).message, error: "beds24_failed", ok: false };
      }
      const wanted = new Set(newNights);
      const clash = unavailable.booked.filter((night) => wanted.has(night));
      if (clash.length > 0) return { conflictDates: clash, error: "occupied", ok: false };
    }

    // Beds24 에서 한 번 더 — 그 유닛 · 그 밤만. 같은 유닛이면 원래 묵던 밤은 이 예약 자신이 차지한 밤이라 뺀다.
    const liveNights = targetRoomId === currentRoomId ? newNights : stayAhead;
    if (liveNights.length > 0) {
      const cooldown = await getBeds24Cooldown(supabase);
      if (cooldown.active) return { error: "cooldown", ok: false };
      const sorted = [...liveNights].sort();
      let live: Awaited<ReturnType<typeof fetchBeds24Calendar>>;
      try {
        live = await fetchBeds24Calendar(
          {
            endDate: sorted[sorted.length - 1],
            externalRoomIds: [targetRoomId],
            includeNumAvail: true,
            includeOverride: true,
            startDate: sorted[0],
          },
          { timeoutMs: MOVE_READ_TIMEOUT_MS },
        );
      } catch (error) {
        if (error instanceof Beds24HttpError && error.isRateLimit) {
          await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: error.resetInSec });
          return { error: "cooldown", ok: false };
        }
        return { detail: "availability_check_failed", error: "beds24_failed", ok: false };
      }
      if ("skipped" in live || live.truncated) return { detail: "availability_check_failed", error: "beds24_failed", ok: false };
      const taken = beds24UnsellableNights(live.roomsById.get(targetRoomId)?.calendar ?? [], sorted);
      if (taken.length > 0) return { conflictDates: taken, error: "occupied", ok: false };
    }

    const payload = buildBeds24BookingMove(bookingId, { next, original, roomId: targetRoomId });
    let posted: Awaited<ReturnType<typeof postBeds24BookingUpdate>>;
    try {
      posted = await postBeds24BookingUpdate(payload, { timeoutMs: MOVE_WRITE_TIMEOUT_MS });
    } catch (error) {
      if (error instanceof Beds24HttpError && error.isRateLimit) {
        await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: error.resetInSec });
        return { error: "cooldown", ok: false };
      }
      // 시간 초과 · 연결 끊김 — **이미 옮겨졌을 수 있다.** 다시 읽어 옮겨졌으면 성공으로 이어 간다(아니면 실패 — 다시 눌러도
      // 같은 예약을 고치는 것이라 중복이 생기지 않는다).
      posted = { ok: false, error: error instanceof Error ? error.message : "unknown" };
      try {
        const check = await fetchBeds24BookingById(bookingId, { timeoutMs: MOVE_READ_TIMEOUT_MS });
        if (!("skipped" in check) && check.ok && diffMoveReadback(payload, check.booking).length === 0) posted = { ok: true };
      } catch {
        // 확인 못 함 — 실패로 둔다.
      }
    }
    if ("skipped" in posted) return { detail: posted.skipped, error: "beds24_failed", ok: false };
    if (!posted.ok) return { detail: posted.error, error: "beds24_failed", ok: false };

    // 다시 읽어 옮겨졌는지 보고 우리 표를 맞춘다(예약 수정과 같다). 다시 읽기 자체가 안 되면 Beds24 가 받은 대로 성공 —
    // 정합성이 곧 맞춘다.
    let notApplied: string[] = [];
    try {
      const fetched = await fetchBeds24BookingById(bookingId, { timeoutMs: MOVE_READ_TIMEOUT_MS });
      if (!("skipped" in fetched) && fetched.ok) {
        notApplied = diffMoveReadback(payload, fetched.booking);
        await processBeds24WebhookBooking({ organizationIdDefault: session.organization.id, payload: fetched.booking, supabase });
      }
    } catch (error) {
      console.error("[ops/reservation-move] local refresh failed", error);
    }

    revalidateOpsCalendars();
    await signalBeds24Change(session.organization.id, "reservations");
    if (notApplied.length > 0) {
      console.error("[ops/reservation-move] Beds24 readback mismatch", { bookingId, fields: notApplied });
      return { detail: notApplied.join(","), error: "not_applied", ok: false };
    }
    return { ok: true };
  };

  try {
    return await moveLocked();
  } finally {
    await releaseBeds24Lock(supabase, lockName, lock.lockId);
  }
}

export type CancelReservationResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "forbidden"
        | "not_found"
        | "already_cancelled"
        | "no_booking_id"
        | "beds24_failed"
        | "cooldown"
        /** Beds24 가 받았지만 다시 읽으니 취소가 아니다(2026-10-08). */
        | "not_applied";
      detail?: string;
    };

export async function submitReservationCancel(args: {
  /** 우리 `reservations.id`. Beds24 예약번호는 **서버가 찾는다.** */
  reservationId: string;
  reason?: string | null;
}): Promise<CancelReservationResult> {
  const session = await requireOpsWriter();
  if (!session) return { error: "forbidden", ok: false };

  const supabase = getSupabaseServiceClient();
  const found = await supabase
    .from("reservations")
    .select("id, status, raw_payload")
    .eq("organization_id", session.organization.id)
    .eq("id", args.reservationId)
    .maybeSingle();
  if (found.error || !found.data) return { error: "not_found", ok: false };

  const row = found.data as { id: string; status: string; raw_payload: unknown };
  if (row.status === "cancelled") return { error: "already_cancelled", ok: false };

  const bookingId = readBeds24CancelTargetId(row.raw_payload);
  if (!bookingId) return { error: "no_booking_id", ok: false };

  let result: Awaited<ReturnType<typeof postBeds24BookingCancel>>;
  try {
    result = await postBeds24BookingCancel({ bookingId, reason: args.reason });
  } catch (error) {
    if (error instanceof Beds24HttpError && error.isRateLimit) {
      await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: error.resetInSec });
      return { error: "cooldown", ok: false };
    }
    return {
      detail: error instanceof Error ? error.message : "unknown",
      error: "beds24_failed",
      ok: false,
    };
  }
  if ("skipped" in result) return { detail: result.skipped, error: "beds24_failed", ok: false };
  if (!result.ok) return { detail: result.error, error: "beds24_failed", ok: false };

  // **다시 읽어 정말 취소됐는지 본다**(2026-10-08 — 응답만 믿지 않는다). 취소가 아니면 우리 표를 Beds24 그대로 맞추고
  // 「반영 안 됨」. 다시 읽기 자체가 안 되면(네트워크) Beds24 가 받아들인 대로 화면을 바꾼다 — 웹훅이 오면 같은 값으로 덮인다.
  let readback: Record<string, unknown> | null = null;
  try {
    const fetched = await fetchBeds24BookingById(bookingId);
    if (!("skipped" in fetched) && fetched.ok) readback = fetched.booking;
  } catch (error) {
    console.error("[ops/reservation-cancel] readback failed", error);
  }
  if (readback && resolveReservationStatusFromBeds24Record(readback) !== "cancelled") {
    console.error("[ops/reservation-cancel] Beds24 readback is not cancelled", { bookingId });
    await processBeds24WebhookBooking({ organizationIdDefault: session.organization.id, payload: readback, supabase });
    revalidateOpsCalendars();
    return { error: "not_applied", ok: false };
  }
  await supabase
    .from("reservations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("organization_id", session.organization.id)
    .eq("id", row.id);
  await signalBeds24Change(session.organization.id, "reservations");

  revalidateOpsCalendars();
  return { ok: true };
}

// ───────────────────────── 이력 · 전송 로그 ─────────────────────────
//
// 판매 캘린더 「이력」 패널(`ops-history-panel.tsx`). 계약: `src/lib/ops-history.ts`.
// service-role 로 읽으므로 **조직을 직접 건다** — RLS 가 막아 주지 않는다.

/** 변경 이력은 7일씩 끊어 읽는다 — 한 번의 대량 수정이 칸 수천 개라 건수로 끊으면 한 수정이 잘린다. */
const HISTORY_WINDOW_DAYS = 7;
/** 한 창에서 읽을 칸 이력 상한. 넘으면 그 창은 잘렸다고 알린다. */
const HISTORY_ROW_CAP = 20_000;

export type OpsChangeHistoryResult =
  | { ok: true; groups: ChangeGroup[]; windowFrom: string; nextBefore: string | null; truncated: boolean }
  | { ok: false; error: "forbidden" | "failed" };

/** 변경 이력 — `before` 직전 7일. 처음엔 지금부터. */
export async function loadOpsChangeHistory(args: { before?: string | null }): Promise<OpsChangeHistoryResult> {
  const session = await requireOpsReader();
  if (!session) return { error: "forbidden", ok: false };
  const supabase = getSupabaseServiceClient();
  const before = args.before ? new Date(args.before) : new Date();
  if (!Number.isFinite(before.getTime())) return { error: "failed", ok: false };
  const from = new Date(before.getTime() - HISTORY_WINDOW_DAYS * 86_400_000);

  type Row = {
    job_id: string | null;
    created_at: string;
    adjust_mode: string | null;
    changed_by_name: string | null;
    field: string;
    old_value: number | null;
    new_value: number | null;
    stay_date: string;
    room_id: string | null;
    room_label: string | null;
  };
  const rows: Row[] = [];
  for (let offset = 0; offset < HISTORY_ROW_CAP; offset += 1000) {
    const page = await supabase
      .from("price_change_logs")
      .select("job_id, created_at, adjust_mode, changed_by_name, field, old_value, new_value, stay_date, room_id, room_label")
      .eq("organization_id", session.organization.id)
      .gte("created_at", from.toISOString())
      .lt("created_at", before.toISOString())
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (page.error) return { error: "failed", ok: false };
    rows.push(...((page.data ?? []) as Row[]));
    if ((page.data ?? []).length < 1000) break;
  }

  const [names, older] = await Promise.all([
    readRoomNames(session),
    supabase
      .from("price_change_logs")
      .select("id")
      .eq("organization_id", session.organization.id)
      .lt("created_at", from.toISOString())
      .limit(1)
      .maybeSingle(),
  ]);

  const groups = groupChangeRows(
    rows.map((row): ChangeLogRow => {
      const room = row.room_id ? names.byId.get(row.room_id) : undefined;
      return {
        adjust_mode: row.adjust_mode,
        changed_by_name: row.changed_by_name,
        created_at: row.created_at,
        field: row.field,
        job_id: row.job_id,
        new_value: row.new_value,
        old_value: row.old_value,
        property_name: room?.property ?? null,
        room_label: room?.room ?? row.room_label,
        stay_date: row.stay_date,
      };
    }),
  );
  return {
    groups,
    nextBefore: older.data ? from.toISOString() : null,
    ok: true,
    truncated: rows.length >= HISTORY_ROW_CAP,
    windowFrom: from.toISOString(),
  };
}

/**
 * 「지금 보내기」 — 대기 중인 작업을 바로 처리한다(응답 뒤 `after()`).
 *
 * **실패한 작업을 다시 넣지는 않는다.** 실패는 대개 값·유닛 문제라 같은 것을 또 보내면 또 실패하고,
 * 그 사이 누가 다른 값을 넣었을 수도 있다. 다시 하려면 캘린더에서 새로 고친다.
 */

export type RevertError =
  | "forbidden"
  | "not_found"
  | "not_revertible"
  | "nothing_to_revert"
  | "no_cells"
  | "invalid_values"
  | "no_writable_room"
  | "enqueue_failed"
  | "block_failed";

export type RevertPriceJobResult =
  | { ok: true; cells: number; skippedChanged: number }
  | { ok: false; error: RevertError };

type RevertLogRow = {
  room_id: string | null;
  room_label: string | null;
  stay_date: string;
  old_value: number | null;
  new_value: number | null;
};

type RevertSession = NonNullable<Awaited<ReturnType<typeof requireOpsWriter>>>;

/**
 * 한 필드의 칸 이력을 **이전 값으로** 되돌린다 — 가격 · 최소숙박은 큐(`adjust_mode = 'revert'`), 차단은 차단
 * 걸기/풀기 경로. 「그 뒤에 다시 바뀐 칸은 건너뛴다」는 지금 값(`room_daily_rates`)과 대조한다(`planRevertCells`).
 */
async function revertLogsOfField(
  session: RevertSession,
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  field: RevertField,
  logs: readonly RevertLogRow[],
): Promise<{ ok: true; cells: number; skippedChanged: number } | { ok: false; error: RevertError }> {
  const roomIds = [...new Set(logs.map((log) => log.room_id).filter((id): id is string => !!id))];
  const dates = [...new Set(logs.map((log) => log.stay_date))];
  if (roomIds.length === 0) return { cells: 0, ok: true, skippedChanged: 0 };

  // **쪽을 나눠 끝까지** 읽는다(2026-10-19) — 1,000행에서 잘리면 뒤쪽 칸의 지금 값이 없어 「그 뒤에 바뀐 칸」으로
  // 건너뛰었다. 1,000칸 넘는 수정의 되돌리기가 일부만 돌아온 원인이다.
  const ratesResult = await readAllPages<{
    room_id: string;
    stay_date: string;
    price1: number | null;
    min_stay: number | null;
    override_kind: string | null;
  }>((from, to) =>
    supabase
      .from("room_daily_rates")
      .select("room_id, stay_date, price1, min_stay, override_kind")
      .eq("organization_id", session.organization.id)
      .in("room_id", roomIds)
      .in("stay_date", dates)
      .order("room_id", { ascending: true })
      .order("stay_date", { ascending: true })
      .range(from, to),
  );
  if (ratesResult.error) return { error: "not_found", ok: false };
  const current = new Map<string, number | null>();
  for (const row of ratesResult.data) {
    const value =
      field === "price1"
        ? row.price1
        : field === "min_stay"
          ? row.min_stay
          : (row.override_kind ?? "").toLowerCase() === "blackout"
            ? 1
            : 0;
    current.set(`${row.room_id}|${row.stay_date}`, value);
  }

  const plan = planRevertCells({ current, field, logs });
  if (plan.cells.length === 0) return { cells: 0, ok: true, skippedChanged: plan.skippedChanged };

  if (field === "blackout") {
    // 차단은 큐가 아니라 걸기/풀기 경로. 행 키는 서버가 계산한다.
    //
    // **그 방의 유닛 전부**로 보낸다(2026-10-01) — 차단은 활성 · 비활성(최소숙박 잠금) 유닛을 가리지 않고 모두에
    // 거는 것이 규칙인데(`runBlockChange`), 이력은 방당 유닛 하나만 적는다. 예전에는 그 한 유닛만 되돌려서
    // 두 유닛짜리 방(302 + 302_2 등)은 하나만 풀리고 하나는 막힌 채 남았다.
    const unitsResult = await readAllPages<{
      id: string;
      room_label: string;
      properties: { name: string } | { name: string }[] | null;
    }>((from, to) =>
      supabase
        .from("rooms")
        .select("id, room_label, properties(name)")
        .eq("organization_id", session.organization.id)
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (unitsResult.error) return { error: "not_found", ok: false };
    const keyById = new Map<string, { roomKey: string; label: string }>();
    const unitIdsByKey = new Map<string, string[]>();
    for (const unit of unitsResult.data) {
      const property = Array.isArray(unit.properties) ? unit.properties[0] : unit.properties;
      const roomKey = opsUnitRoomKey({ propertyName: property?.name, roomLabel: unit.room_label });
      if (!roomKey) continue;
      keyById.set(unit.id, { label: unit.room_label, roomKey });
      const list = unitIdsByKey.get(roomKey);
      if (list) list.push(unit.id);
      else unitIdsByKey.set(roomKey, [unit.id]);
    }
    // 지난 밤은 다시 막지 않는다 — 걸기 경로가 지난 날짜를 거절한다(`past_date`). 풀기는 그대로.
    const todayKey = toJstDateString(new Date());
    for (const target of [0, 1] as const) {
      const cells: BlockChangeCell[] = plan.cells
        .filter((cell) => cell.value === target && keyById.has(cell.roomId))
        .filter((cell) => target === 0 || cell.stayDate >= todayKey)
        .map((cell) => ({
          date: cell.stayDate,
          roomIds: [cell.roomId],
          roomKey: keyById.get(cell.roomId)!.roomKey,
          roomLabel: keyById.get(cell.roomId)!.label,
        }));
      if (cells.length === 0) continue;
      // 그 행의 유닛 전부 — 걸기/풀기와 같은 범위(활성 · 비활성 모두).
      for (const cell of cells) cell.roomIds = unitIdsByKey.get(cell.roomKey) ?? cell.roomIds;
      // 이전이 열림(0)이면 푼다, 막힘(1)이면 다시 건다. 구간 상한(`MAX_BLOCK_RANGES`) 안으로 나눠 보낸다 — 큰 묶음이
      // 통째로 거절되지 않게(2026-10-19).
      for (const chunk of chunkCellsByRanges(cells, MAX_BLOCK_RANGES)) {
        const result = await runBlockChange({ cells: chunk }, target === 0 ? "unblock" : "block");
        if (!result.ok) return { error: "block_failed", ok: false };
      }
    }
    return { cells: plan.cells.length, ok: true, skippedChanged: plan.skippedChanged };
  }

  const queued = await enqueueBeds24PriceJob({
    adjustMode: "revert",
    cells: plan.cells.map(
      (cell): PriceJobCellRequest => ({
        roomIds: [cell.roomId],
        roomLabel: cell.roomLabel,
        stayDate: cell.stayDate,
        values: field === "price1" ? { p1: cell.value } : { m: cell.value },
      }),
    ),
    jobType: field === "price1" ? "price" : "min_stay",
    organizationId: session.organization.id,
    requestedBy: session.user.id,
    requestedByName: session.user.name,
    supabase,
  });
  if (!queued.ok) return { error: queued.error, ok: false };
  after(kickWorker);
  return { cells: plan.cells.length, ok: true, skippedChanged: plan.skippedChanged };
}

/** 필드별 결과를 하나로 — 하나라도 실패하면 실패, 아무 칸도 없으면 「되돌릴 것 없음」. */
function mergeRevertResults(
  results: Array<{ ok: true; cells: number; skippedChanged: number } | { ok: false; error: RevertError }>,
): RevertPriceJobResult {
  let cells = 0;
  let skippedChanged = 0;
  for (const result of results) {
    if (!result.ok) return result;
    cells += result.cells;
    skippedChanged += result.skippedChanged;
  }
  return cells === 0 ? { error: "nothing_to_revert", ok: false } : { cells, ok: true, skippedChanged };
}

/**
 * 가격·최소숙박 수정 **되돌리기** (2026-10-01, 새 기능 — 저쪽에는 없다).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「수정 되돌리기」
 *
 * 그 작업이 남긴 칸 이력(`price_change_logs`, `job_id`)의 **이전 값**을 새 작업으로 다시 보낸다 — 같은 큐 ·
 * 같은 되읽기 검증을 탄다(`adjust_mode = 'revert'`). **그 뒤에 다시 바뀐 칸은 건너뛴다.** 끝난 작업만.
 */
export async function revertPriceJob(args: { jobId: string }): Promise<RevertPriceJobResult> {
  const session = await requireOpsWriter();
  if (!session) return { error: "forbidden", ok: false };
  if (!/^[0-9a-f-]{36}$/i.test(args.jobId)) return { error: "not_found", ok: false };
  const supabase = getSupabaseServiceClient();

  const jobResult = await supabase
    .from("beds24_price_jobs")
    .select("id, job_type, status")
    .eq("organization_id", session.organization.id)
    .eq("id", args.jobId)
    .maybeSingle();
  if (jobResult.error || !jobResult.data) return { error: "not_found", ok: false };
  const job = jobResult.data as { id: string; job_type: "price" | "min_stay"; status: string };
  // 끝난 작업만 — 아직 도는 작업을 되돌리면 순서가 꼬인다.
  if (!["completed", "partial_failed"].includes(job.status)) return { error: "not_revertible", ok: false };

  const field: RevertField = job.job_type === "price" ? "price1" : "min_stay";
  // 칸 이력은 **쪽을 나눠 전부** 읽는다(2026-10-19) — `.limit(5000)` 이어도 PostgREST 는 1,000행에서 자른다.
  const logsResult = await readAllPages<RevertLogRow>((from, to) =>
    supabase
      .from("price_change_logs")
      .select("room_id, room_label, stay_date, old_value, new_value")
      .eq("organization_id", session.organization.id)
      .eq("job_id", job.id)
      .eq("field", field)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (logsResult.error) return { error: "not_found", ok: false };
  return mergeRevertResults([await revertLogsOfField(session, supabase, field, logsResult.data)]);
}

/**
 * **Beds24 에서 바뀐 것** 되돌리기 (2026-10-01, 사용자 요청).
 *
 * Beds24 변경 이력은 동기화가 「우리가 알던 값 → 새 값」으로 감지한 것이라 작업 번호가 없다 — **같은 시각에 감지된
 * 묶음**(`adjust_mode = 'beds24'`, `created_at`)이 한 줄이다. 가격 · 최소숙박 · 차단을 각각 이전 값으로 돌린다.
 * 이전 값은 **우리가 마지막으로 읽었던 값**이다 — 그 사이 Beds24 에서 여러 번 고쳤다면 중간 값은 모른다.
 */
export async function revertBeds24Change(args: { at: string }): Promise<RevertPriceJobResult> {
  const session = await requireOpsWriter();
  if (!session) return { error: "forbidden", ok: false };
  if (Number.isNaN(Date.parse(args.at))) return { error: "not_found", ok: false };
  const supabase = getSupabaseServiceClient();

  const logsResult = await readAllPages<RevertLogRow & { field: string }>((from, to) =>
    supabase
      .from("price_change_logs")
      .select("room_id, room_label, stay_date, field, old_value, new_value")
      .eq("organization_id", session.organization.id)
      .eq("adjust_mode", "beds24")
      .eq("created_at", args.at)
      .in("field", ["price1", "min_stay", "blackout"])
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (logsResult.error) return { error: "not_found", ok: false };
  const rows = logsResult.data;
  if (rows.length === 0) return { error: "not_found", ok: false };

  const results = [];
  for (const field of ["price1", "min_stay", "blackout"] as const) {
    const logs = rows.filter((row) => row.field === field);
    if (logs.length > 0) results.push(await revertLogsOfField(session, supabase, field, logs));
  }
  return mergeRevertResults(results);
}

/**
 * **우리 앱에서 건 차단 · 푼 차단** 되돌리기(2026-10-02 사용자 요청 「블락 해제 되돌리기」).
 *
 * 앱 차단 이력은 작업 번호가 없고 한 번 누른 것이 **같은 시각**으로 남는다(`adjust_mode = 'block'`, `runBlockChange` 의
 * `actedAt`) — 그 묶음의 칸마다 이전 값(0 열림 / 1 막힘)으로 돌린다. 차단을 걸었던 묶음이면 풀고, 풀었던 묶음이면 다시
 * 건다. 경로는 Beds24 변경 되돌리기와 같다(`revertLogsOfField` → `runBlockChange`, 그 방의 유닛 전부). 그 뒤에 다시
 * 바뀐 칸은 건너뛴다.
 */
export async function revertBlockChange(args: { at: string }): Promise<RevertPriceJobResult> {
  const session = await requireOpsWriter();
  if (!session) return { error: "forbidden", ok: false };
  if (Number.isNaN(Date.parse(args.at))) return { error: "not_found", ok: false };
  const supabase = getSupabaseServiceClient();

  const logsResult = await readAllPages<RevertLogRow>((from, to) =>
    supabase
      .from("price_change_logs")
      .select("room_id, room_label, stay_date, old_value, new_value")
      .eq("organization_id", session.organization.id)
      .eq("adjust_mode", "block")
      .eq("field", "blackout")
      .eq("created_at", args.at)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (logsResult.error) return { error: "not_found", ok: false };
  const logs = logsResult.data;
  if (logs.length === 0) return { error: "not_found", ok: false };
  return mergeRevertResults([await revertLogsOfField(session, supabase, "blackout", logs)]);
}

export type SendPendingResult = {
  ok: boolean;
  /**
   * 첫 작업의 결과 — 화면이 사람 말로 보여준다. 예전에는 응답 뒤에만 돌려 **아무 반응이 없는 것처럼**
   * 보였다(잠금이 막혀 있어도 알 수 없었다, 2026-09-29).
   */
  outcome: "sent" | "empty" | "cooldown" | "lock_busy" | "lock_error" | "failed" | "forbidden";
  cooldownSec?: number;
};

export async function sendPendingPriceJobs(): Promise<SendPendingResult> {
  const session = await requireOpsWriter();
  if (!session) return { ok: false, outcome: "forbidden" };
  const supabase = getSupabaseServiceClient();
  try {
    // 첫 작업은 **기다린다**(보통 몇 초) — 결과를 사람에게 돌려주려고. 남은 것은 응답 뒤에.
    // 이 버튼은 **호출한 조직의 작업만** 집는다. 뒤이은 `kickWorker` 는 전역 워커(계정 하나)다.
    const first = await runNextPriceJob(supabase, { organizationId: session.organization.id });
    if (first.ran && first.status !== "requeued") {
      after(kickWorker);
      return { ok: true, outcome: "sent" };
    }
    // `requeued` — 보내던 중 쿨다운에 걸려 남은 객실을 다시 대기로 돌렸다. 「보냄」이 아니다.
    if (first.ran || first.reason === "cooldown") {
      const cooldown = await getBeds24Cooldown(supabase);
      return { cooldownSec: cooldown.remainingSec, ok: false, outcome: "cooldown" };
    }
    return { ok: first.reason === "empty", outcome: first.reason };
  } catch (error) {
    console.error("[ops/calendar] send now failed", error);
    return { ok: false, outcome: "failed" };
  }
}

export type OpsSalesSummaryResult =
  | { ok: false; error: "forbidden" | "bad_window" | "failed" }
  | { ok: true; summary: OpsSalesSummary & { properties: string[]; previous: SalesYoyPrevious } };

/**
 * 「매출 요약」 모달 — **보고 있는 창 × 고른 건물**의 매출·수수료·가동률·ADR·빈방(2026-09-30).
 *
 * 창은 격자가 보고 있는 첫날과 일수로 받는다. 30일이면 30일 뷰, 아니면 그 달(월간 뷰 — 첫날이 1일이어야
 * 한다). 서버가 창을 **다시 계산해** 받은 값과 맞지 않으면 거절한다 — 임의 범위를 읽는 통로가 아니다.
 * 식은 `src/lib/ops-sales-summary.ts`(저쪽 건물 캘린더 그대로 — 34번 문서).
 */
export async function loadOpsSalesSummary(args: {
  start: string;
  days: number;
  properties?: readonly string[] | null;
}): Promise<OpsSalesSummaryResult> {
  const session = await requireOpsReader();
  if (!session) return { error: "forbidden", ok: false };
  const start = typeof args.start === "string" ? args.start : "";
  const days = typeof args.days === "number" && Number.isInteger(args.days) ? args.days : 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || days < 1 || days > 31) return { error: "bad_window", ok: false };
  const mode = days === OPS_CALENDAR_ROLLING_DAYS ? "rolling" : "monthly";
  if (mode === "monthly" && !start.endsWith("-01")) return { error: "bad_window", ok: false };
  const properties = parsePropertyParam(
    Array.isArray(args.properties) ? args.properties.filter((name): name is string => typeof name === "string") : [],
  );
  try {
    const summary = await getOpsSalesSummary(session, { mode, month: start.slice(0, 7), properties, start });
    if (summary.start !== start || summary.days !== days) return { error: "bad_window", ok: false };
    return { ok: true, summary };
  } catch (error) {
    console.error("[ops-calendar] sales summary read failed", error);
    return { error: "failed", ok: false };
  }
}
