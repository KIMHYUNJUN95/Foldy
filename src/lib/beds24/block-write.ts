/**
 * 블록(차단) 걸기·풀기 — Beds24 왕복 + 되읽기 검증 + 보상 롤백.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「저쪽 블록의 실제 규칙」
 * 페이로드 규칙: `block-write-payload.ts` (순수 함수 · 테스트로 고정)
 * 원본: `functions/index.js` → `createBooking`(isBlock 분기) · `cancelBooking`(override 분기)
 *
 * ## 왜 가격처럼 큐에 넣지 않는가
 *
 * 가격은 「67객실 × 3개월」처럼 한 번에 수천 칸을 바꾸므로 큐·배치·크레딧 조율이 필요하다.
 * 블록은 **방 몇 개 × 밤 며칠**이고, 무엇보다 사람이 화면 앞에서 결과를 기다린다 —
 * 「막혔나 안 막혔나」를 모른 채 넘어가면 그 자리에서 초과예약이 난다. 저쪽도 동기로 한다.
 *
 * ## 순서가 곧 안전장치다
 *
 * ```
 * ① 되읽기(전)  numAvail 스냅샷 + 이미 막혀 있는지 확인
 * ② POST        override: blackout
 * ③ 되읽기(후)  정말 들어갔는지 — Beds24 는 안 들어가도 success 를 준다
 * ④ 로컬 저장   스냅샷 · room_blocks · room_daily_rates
 * ⑤ 실패하면    ②를 되돌린다 (보상 롤백)
 * ```
 *
 * ⑤가 없으면 **「화면엔 아무것도 없는데 방은 판매 정지」인 고아 블록**이 남는다. 해제할 행이
 * 없으니 UI 로는 손댈 방법이 없고, Beds24 화면에 직접 들어가야 풀린다.
 *
 * ## 스냅샷은 Beds24 에서 읽는다
 *
 * 저쪽은 자기 캐시(`price_sync`)에서 numAvail 을 읽는다. 우리는 **Beds24 에서 직접 읽는다** —
 * `room_daily_rates` 는 15분 주기 동기화라 낡았을 수 있고, 이 값은 나중에 **그대로 다시
 * 써넣을 값**이다. 낡은 값을 복원하면 재고가 틀린 채로 고정된다. ①은 어차피 「이미 막혀
 * 있는가」를 보려고 읽어야 하므로 왕복이 늘지도 않는다.
 */

import { trimBlockRows } from "@/lib/beds24/block-trim";
import {
  type BlockRange,
  type BlockSnapshotRow,
  buildBlockNightSegments,
  buildBlockSegments,
  buildUnblockSegments,
  diffBlockReadback,
  eachNight,
  mergeSnapshotNumAvail,
  planSnapshotTrim,
  preBlockNumAvailOf,
  validateBlockRange,
} from "@/lib/beds24/block-write-payload";
import {
  Beds24HttpError,
  type CalendarRoomData,
  fetchBeds24Calendar,
  postBeds24Calendar,
} from "@/lib/beds24/calendar-client";
import { activateBeds24Cooldown, getBeds24Cooldown } from "@/lib/beds24/sync-locks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { signalBeds24Change } from "@/lib/beds24/live-signal";

type Client = SupabaseClient<Database>;

/**
 * 실패 사유는 **코드로** 돌려준다. 화면 문구는 i18n 사전이 만든다 — 서버가 한국어 문자열을
 * 돌려주면 `no-hardcoded-i18n` 가드에 걸리고, 무엇보다 ja/en 에서 한국어가 튀어나온다.
 */
export type BlockWriteFailure =
  | "invalid_date"
  | "range_reversed"
  | "invalid_room_id"
  | "no_rooms"
  | "cooldown"
  | "beds24_unavailable"
  | "beds24_rejected"
  | "verify_mismatch"
  | "readback_truncated"
  | "save_failed_rolled_back"
  | "save_failed_not_rolled_back"
  /** 막기 전 재고 기록(스냅샷)을 못 읽었다 — 복원 없이 풀면 재고가 틀어지므로 풀지 않았다. */
  | "snapshot_read_failed"
  /** 해제가 확인되지 않았고, 우리 표에 맞춰 차단으로 되돌리지도 못했다 — Beds24 에서 직접 확인해야 한다. */
  | "unblock_not_restored";

export type BlockWriteResult =
  | { ok: true; nights: number; roomIds: string[] }
  | { ok: false; reason: BlockWriteFailure; detail?: string };

/** 한 번에 막을 수 있는 밤 수. 실수로 1년을 막는 일을 서버에서도 막는다. */
export const MAX_BLOCK_NIGHTS = 370;

type NightOverrides = Map<string, string | null>;
type NightNumAvail = Record<string, number>;

function readCalendarNights(room: CalendarRoomData | undefined): {
  overrides: NightOverrides;
  numAvail: NightNumAvail;
} {
  const overrides: NightOverrides = new Map();
  const numAvail: NightNumAvail = {};
  for (const entry of room?.calendar ?? []) {
    const from = typeof entry.from === "string" ? entry.from : null;
    const to = typeof entry.to === "string" ? entry.to : from;
    if (!from || !to) continue;
    const override = typeof entry.override === "string" ? entry.override : null;
    const available =
      typeof entry.numAvail === "number" && Number.isInteger(entry.numAvail)
        ? entry.numAvail
        : null;
    // Beds24 는 구간으로 돌려준다 — 밤 단위로 펼쳐야 날짜별로 비교할 수 있다.
    for (const night of eachNight({ startDate: from, endDate: to })) {
      overrides.set(night, override);
      if (available !== null) numAvail[night] = available;
    }
  }
  return { overrides, numAvail };
}

async function readNights(args: {
  supabase: Client;
  externalRoomIds: string[];
  range: BlockRange;
}): Promise<
  | { ok: true; byRoom: Map<string, { overrides: NightOverrides; numAvail: NightNumAvail }> }
  | { ok: false; reason: BlockWriteFailure; detail?: string }
> {
  let fetched: Awaited<ReturnType<typeof fetchBeds24Calendar>>;
  try {
    fetched = await fetchBeds24Calendar({
      externalRoomIds: args.externalRoomIds,
      startDate: args.range.startDate,
      endDate: args.range.endDate,
      includeNumAvail: true,
      includeOverride: true,
    });
  } catch (error) {
    // 던지면 쓰기 뒤 되읽기에서 보상 롤백을 건너뛴 채 액션이 터진다 — 실패로 돌려 호출부가 되돌리게 한다(2026-10-19).
    if (error instanceof Beds24HttpError && error.isRateLimit) {
      await activateBeds24Cooldown(args.supabase, { reason: "rate_limit", resetInSec: error.resetInSec });
      return { ok: false, reason: "cooldown" };
    }
    return { ok: false, reason: "beds24_unavailable", detail: error instanceof Error ? error.message : "unknown" };
  }
  if ("skipped" in fetched) {
    return { ok: false, reason: "beds24_unavailable", detail: fetched.skipped };
  }
  // 잘린 응답으로는 「일치한다」를 증명할 수 없다. 성공으로 치면 안 막힌 방이 막힌 것으로 남는다.
  if (fetched.truncated) return { ok: false, reason: "readback_truncated" };

  const byRoom = new Map<string, { overrides: NightOverrides; numAvail: NightNumAvail }>();
  for (const roomId of args.externalRoomIds) {
    byRoom.set(roomId, readCalendarNights(fetched.roomsById.get(roomId)));
  }
  return { ok: true, byRoom };
}

/** 429 를 만나면 쿨다운을 켠다 — 다른 경로(요금 동기화·가격 워커)도 같이 물러나게. */
async function postWithCooldownGuard(
  supabase: Client,
  payload: { roomId: number; calendar: unknown[] }[],
): Promise<
  | { ok: true; rejected: string[] }
  /** `acceptedRoomIds` — 거절이 섞였을 때 **받아들여진** 방. 그 방은 이미 바뀌었으니 호출부가 되돌린다. */
  | { ok: false; reason: BlockWriteFailure; detail?: string; acceptedRoomIds?: string[] }
> {
  try {
    const result = await postBeds24Calendar(payload);
    if ("skipped" in result) {
      return { ok: false, reason: "beds24_unavailable", detail: result.skipped };
    }
    const rejected = result.items.filter((item) => !item.accepted);
    if (rejected.length > 0) {
      return {
        acceptedRoomIds: result.items.filter((item) => item.accepted).map((item) => item.externalRoomId),
        ok: false,
        reason: "beds24_rejected",
        detail: rejected.map((item) => `${item.externalRoomId}:${item.error ?? "?"}`).join(", "),
      };
    }
    return { ok: true, rejected: [] };
  } catch (error) {
    if (error instanceof Beds24HttpError && error.isRateLimit) {
      await activateBeds24Cooldown(supabase, { reason: "rate_limit", resetInSec: error.resetInSec });
      return { ok: false, reason: "cooldown" };
    }
    return {
      ok: false,
      reason: "beds24_unavailable",
      detail: error instanceof Error ? error.message : "unknown",
    };
  }
}

/**
 * 블록을 건다.
 *
 * `externalRoomIds` 는 **같은 물리적 방의 모든 유닛**이어야 한다. 하나만 막으면 나머지 유닛으로
 * 그 방이 그대로 팔린다 — 듀얼 ID 객실에서 실제로 일어나는 일이다.
 */
export async function createRoomBlock(args: {
  supabase: Client;
  organizationId: string;
  /** 같은 물리적 방의 모든 Beds24 roomId. */
  externalRoomIds: string[];
  /** 막을 **밤** 범위 (양끝 포함). 체크아웃 날짜가 아니다. */
  range: BlockRange;
  actorUserId?: string | null;
  propertyName: string;
  roomLabel: string;
}): Promise<BlockWriteResult> {
  const rangeError = validateBlockRange(args.range);
  if (rangeError) return { ok: false, reason: rangeError };

  const roomIds = [...new Set(args.externalRoomIds.map((id) => String(id ?? "").trim()))].filter(
    Boolean,
  );
  if (roomIds.length === 0) return { ok: false, reason: "no_rooms" };

  const nights = eachNight(args.range);
  if (nights.length > MAX_BLOCK_NIGHTS) {
    return { ok: false, reason: "range_reversed", detail: `${nights.length} nights` };
  }

  const cooldown = await getBeds24Cooldown(args.supabase);
  if (cooldown.active) {
    return { ok: false, reason: "cooldown", detail: `${cooldown.remainingSec}s` };
  }

  // ① 막기 전 상태 — 되돌릴 numAvail 을 여기서 찍는다.
  const before = await readNights({ externalRoomIds: roomIds, range: args.range, supabase: args.supabase });
  if (!before.ok) return before;

  const payload = buildBlockSegments({ externalRoomIds: roomIds, range: args.range });
  if (payload.length === 0) return { ok: false, reason: "invalid_room_id" };

  // ②~③ 이 실패하면 **우리 표에는 아무것도 안 남는다.** 그런데 Beds24 에 일부라도 들어갔으면 「화면엔 없는데 판매 정지」인
  // 고아 블록이다 — 그래서 들어갔을 수 있는 방은 막기 전으로 되돌린다(2026-10-19). 되돌리지 못하면 사람이 Beds24 에서
  // 직접 확인해야 하므로 그렇게 알린다(`save_failed_not_rolled_back`).
  const undo = async (
    failure: { reason: BlockWriteFailure; detail?: string },
    touchedRoomIds: string[],
  ): Promise<BlockWriteResult> => {
    if (touchedRoomIds.length === 0) return { ok: false, reason: failure.reason, detail: failure.detail };
    const rolledBack = await rollbackBlackout({
      before: before.byRoom,
      range: args.range,
      roomIds: touchedRoomIds,
      supabase: args.supabase,
    });
    return rolledBack
      ? { ok: false, reason: failure.reason, detail: failure.detail }
      : { ok: false, reason: "save_failed_not_rolled_back", detail: failure.detail ?? failure.reason };
  };

  // ② 쓰기
  const posted = await postWithCooldownGuard(args.supabase, payload);
  if (!posted.ok) return undo(posted, posted.acceptedRoomIds ?? []);

  // ③ 되읽기 — Beds24 는 아무것도 안 들어가도 success 를 준다.
  const after = await readNights({ externalRoomIds: roomIds, range: args.range, supabase: args.supabase });
  if (!after.ok) return undo(after, roomIds);

  const mismatched: string[] = [];
  for (const roomId of roomIds) {
    const missing = diffBlockReadback({
      nights,
      actual: after.byRoom.get(roomId)?.overrides ?? new Map(),
      expect: "blackout",
    });
    if (missing.length > 0) mismatched.push(`${roomId}:${missing.length}`);
  }
  if (mismatched.length > 0) {
    return undo({ detail: mismatched.join(", "), reason: "verify_mismatch" }, roomIds);
  }

  // ④ 로컬 저장
  //
  // 같은 구간 스냅샷이 이미 있으면(같은 차단을 다시 건 경우) **그 값이 먼저다** — 이번에 읽은 재고는 막힌 동안의 값일 수 있다.
  // 이미 막혀 있던 밤의 재고도 넣지 않는다(`preBlockNumAvailOf`, 2026-10-19).
  const nowIso = new Date().toISOString();
  const existing = await args.supabase
    .from("room_block_snapshots")
    .select("external_room_id, pre_block_num_avail")
    .eq("organization_id", args.organizationId)
    .in("external_room_id", roomIds)
    .eq("start_date", args.range.startDate)
    .eq("end_date", args.range.endDate);
  const existingByRoom = new Map<string, Record<string, number>>();
  for (const row of (existing.data ?? []) as Array<{ external_room_id: string; pre_block_num_avail: unknown }>) {
    const value = row.pre_block_num_avail;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      existingByRoom.set(row.external_room_id, value as Record<string, number>);
    }
  }
  const snapshotRows = roomIds.map((roomId) => {
    const read = before.byRoom.get(roomId);
    return {
      organization_id: args.organizationId,
      external_room_id: roomId,
      start_date: args.range.startDate,
      end_date: args.range.endDate,
      pre_block_num_avail: {
        ...(read ? preBlockNumAvailOf(read) : {}),
        ...(existingByRoom.get(roomId) ?? {}),
      },
      created_by_user_id: args.actorUserId ?? null,
    };
  });

  const snapshotSaved = existing.error
    ? existing
    : await args.supabase
        .from("room_block_snapshots")
        .upsert(snapshotRows, { onConflict: "organization_id,external_room_id,start_date,end_date" });

  if (snapshotSaved.error) {
    // ⑤ 보상 롤백 — Beds24 에는 걸렸는데 우리는 되돌릴 값을 잃었다. 그대로 두면 고아 블록이다.
    const rolledBack = await rollbackBlackout({
      supabase: args.supabase,
      roomIds,
      range: args.range,
      before: before.byRoom,
    });
    return {
      ok: false,
      reason: rolledBack ? "save_failed_rolled_back" : "save_failed_not_rolled_back",
      detail: snapshotSaved.error.message,
    };
  }

  // `room_blocks` 는 Beds24 동기화가 주인이라 **넣지 않아도 다음 동기화에 들어온다.** 다만 그
  // 사이(최대 15분) 화면에 안 보이면 「안 막혔나?」 하고 또 누른다. 같은 규칙으로 미리 넣어 둔다.
  await args.supabase.from("room_blocks").upsert(
    {
      organization_id: args.organizationId,
      source: "beds24",
      property_name: args.propertyName,
      room_label: args.roomLabel,
      external_room_id: roomIds[0],
      start_date: args.range.startDate,
      end_date: args.range.endDate,
      override_kind: "blackout",
      synced_at: nowIso,
    },
    { onConflict: "organization_id,source,property_name,room_label,start_date" },
  );

  // 판매 캘린더의 BLOCK 막대는 요금 표의 `override_kind` 로도 그린다(12개월). 바로 맞춰 둔다.
  await patchLocalOverride({
    externalRoomIds: roomIds,
    kind: "blackout",
    nights,
    organizationId: args.organizationId,
    supabase: args.supabase,
  });

  await signalBeds24Change(args.organizationId, "blocks");
  return { ok: true, nights: nights.length, roomIds };
}

/**
 * Beds24 만 되돌린다. 성공 여부를 돌려주되 **던지지 않는다** — 롤백 실패도 보고할 사실이다.
 *
 * **막기 전에 이미 막혀 있던 밤은 풀지 않는다**(2026-10-19) — 다른 차단과 겹친 밤까지 풀면 되돌리기가 남의 차단을 지운다.
 */
async function rollbackBlackout(args: {
  supabase: Client;
  roomIds: string[];
  range: BlockRange;
  before: Map<string, { overrides: NightOverrides; numAvail: NightNumAvail }>;
}): Promise<boolean> {
  try {
    const nights = eachNight(args.range);
    const payload = args.roomIds
      .map((roomId) => {
        const read = args.before.get(roomId);
        const wasOpen = nights.filter((night) => read?.overrides.get(night) !== "blackout");
        if (wasOpen.length === 0) return null;
        return buildUnblockSegments({
          externalRoomId: roomId,
          onlyNights: wasOpen,
          range: args.range,
          preBlockNumAvail: read?.numAvail ?? null,
        });
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    // 되돌릴 밤이 없다 = 전부 원래 막혀 있었다. Beds24 는 막기 전 그대로다.
    if (payload.length === 0) return true;
    const result = await postBeds24Calendar(payload);
    return !("skipped" in result) && result.items.every((item) => item.accepted);
  } catch {
    return false;
  }
}

/**
 * 블록을 푼다.
 *
 * 스냅샷이 없으면 **사람이 Beds24 화면에서 직접 건 블록**이다. 그때는 재고를 건드리지 않고
 * 오버라이드만 푼다 — 모르는 값을 추측해 쓰는 것보다 그대로 두는 쪽이 안전하다.
 */
export async function clearRoomBlock(args: {
  supabase: Client;
  organizationId: string;
  externalRoomIds: string[];
  range: BlockRange;
  propertyName: string;
  roomLabel: string;
}): Promise<BlockWriteResult> {
  const rangeError = validateBlockRange(args.range);
  if (rangeError) return { ok: false, reason: rangeError };

  const roomIds = [...new Set(args.externalRoomIds.map((id) => String(id ?? "").trim()))].filter(
    Boolean,
  );
  if (roomIds.length === 0) return { ok: false, reason: "no_rooms" };

  const cooldown = await getBeds24Cooldown(args.supabase);
  if (cooldown.active) {
    return { ok: false, reason: "cooldown", detail: `${cooldown.remainingSec}s` };
  }

  // 이 구간과 **겹치는** 스냅샷 전부(2026-10-19) — 일부만 풀거나 여러 구간으로 나눠 풀어도 밤마다 막기 전 재고를 찾는다
  // (`mergeSnapshotNumAvail`). 전에는 시작일 · 종료일이 똑같은 것만 찾아, 일부 해제는 재고를 복원하지 않았다.
  // 못 읽었으면 **풀지 않는다** — 복원 없이 풀면 막을 때 줄어든 재고가 남아 방이 안 팔릴 수 있다.
  const snapshots = await args.supabase
    .from("room_block_snapshots")
    .select("id, external_room_id, start_date, end_date, created_at, pre_block_num_avail")
    .eq("organization_id", args.organizationId)
    .in("external_room_id", roomIds)
    .lte("start_date", args.range.endDate)
    .gte("end_date", args.range.startDate);
  if (snapshots.error) return { ok: false, reason: "snapshot_read_failed", detail: snapshots.error.message };
  const snapshotRows = (snapshots.data ?? []) as BlockSnapshotRow[];
  const restoreByRoom = mergeSnapshotNumAvail(snapshotRows, args.range);

  const payload = roomIds
    .map((roomId) =>
      buildUnblockSegments({
        externalRoomId: roomId,
        range: args.range,
        preBlockNumAvail: restoreByRoom.get(roomId) ?? null,
      }),
    )
    .filter((item): item is NonNullable<typeof item> => item !== null);
  if (payload.length === 0) return { ok: false, reason: "invalid_room_id" };

  const nights = eachNight(args.range);

  // 해제가 확인되지 않으면 **우리 표는 「막힘」 그대로**다(스냅샷 · room_blocks · 요금 표 모두 손대지 않는다). 그런데 Beds24 에서
  // 일부라도 풀렸으면 「화면엔 막힘, 실제로는 판매 중」이 된다 — 그래서 풀렸을 수 있는 밤을 다시 막아 둘을 맞춘다(2026-10-19).
  // 다시 막지도 못하면 상태를 모르므로 사람에게 Beds24 확인을 요청한다(`unblock_not_restored`).
  const reblock = async (
    failure: { reason: BlockWriteFailure; detail?: string },
    nightsByRoom: Map<string, string[]>,
  ): Promise<BlockWriteResult> => {
    const reblockPayload = [...nightsByRoom]
      .map(([roomId, list]) => buildBlockNightSegments({ externalRoomId: roomId, nights: list }))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (reblockPayload.length === 0) return { ok: false, reason: failure.reason, detail: failure.detail };
    try {
      const result = await postBeds24Calendar(reblockPayload);
      if (!("skipped" in result) && result.items.every((item) => item.accepted)) {
        return { ok: false, reason: failure.reason, detail: failure.detail };
      }
    } catch {
      // 아래에서 알린다.
    }
    return { ok: false, reason: "unblock_not_restored", detail: failure.detail ?? failure.reason };
  };
  const allNights = (ids: readonly string[]) => new Map(ids.map((roomId) => [roomId, nights]));

  const posted = await postWithCooldownGuard(args.supabase, payload);
  if (!posted.ok) return reblock(posted, allNights(posted.acceptedRoomIds ?? []));

  const after = await readNights({ externalRoomIds: roomIds, range: args.range, supabase: args.supabase });
  if (!after.ok) return reblock(after, allNights(roomIds));

  const stillBlocked: string[] = [];
  const cleared = new Map<string, string[]>();
  for (const roomId of roomIds) {
    const actual = after.byRoom.get(roomId)?.overrides ?? new Map<string, string | null>();
    const remaining = diffBlockReadback({ nights, actual, expect: "cleared" });
    if (remaining.length > 0) stillBlocked.push(`${roomId}:${remaining.length}`);
    const blockedSet = new Set(remaining);
    cleared.set(roomId, nights.filter((night) => !blockedSet.has(night)));
  }
  if (stillBlocked.length > 0) {
    return reblock({ detail: stillBlocked.join(", "), reason: "verify_mismatch" }, cleared);
  }

  // 풀렸으면 **푼 밤의** 스냅샷은 쓸모가 없다. 남겨두면 다음에 같은 밤을 막을 때 **옛 재고**를 복원한다. 구간 앞 · 뒤에 남는
  // 밤은 그 밤의 재고만 들고 남긴다 — 나머지를 풀 때 복원할 값이다(`planSnapshotTrim`).
  const snapshotTrim = planSnapshotTrim(snapshotRows, args.range);
  if (snapshotTrim.deleteIds.length > 0) {
    const removed = await args.supabase.from("room_block_snapshots").delete().in("id", snapshotTrim.deleteIds);
    if (removed.error) console.error("[beds24/block] snapshot trim delete failed", removed.error.message);
    else if (snapshotTrim.keep.length > 0) {
      const kept = await args.supabase.from("room_block_snapshots").upsert(
        snapshotTrim.keep.map((row) => ({ ...row, organization_id: args.organizationId })),
        { onConflict: "organization_id,external_room_id,start_date,end_date" },
      );
      if (kept.error) console.error("[beds24/block] snapshot trim keep failed", kept.error.message);
    }
  }

  // `room_blocks` 에서 **푼 밤만 잘라 낸다 — 그 방의 유닛 전부**(`trimBlockRows`, 2026-10-06). 전에는 시작일이 같고 첫 유닛
  // 이름인 줄만 지워, 구간 일부 해제 · 두 번째 유닛 줄이 남아 수기 예약 겹침 검사가 푼 밤을 막았다.
  const overlapping = await args.supabase
    .from("room_blocks")
    .select("id, organization_id, source, property_name, room_label, external_room_id, start_date, end_date, override_kind")
    .eq("organization_id", args.organizationId)
    .eq("source", "beds24")
    .in("external_room_id", roomIds)
    .lte("start_date", args.range.endDate)
    .gte("end_date", args.range.startDate);
  if (overlapping.error) {
    console.error("[beds24/block] room_blocks trim read failed", overlapping.error.message);
  } else {
    const trimmed = trimBlockRows(overlapping.data ?? [], args.range);
    if (trimmed.deleteIds.length > 0) {
      const removed = await args.supabase.from("room_blocks").delete().in("id", trimmed.deleteIds);
      if (removed.error) console.error("[beds24/block] room_blocks trim delete failed", removed.error.message);
    }
    if (trimmed.keep.length > 0) {
      const kept = await args.supabase.from("room_blocks").upsert(
        trimmed.keep.map((row) => ({
          end_date: row.end_date,
          external_room_id: row.external_room_id,
          organization_id: row.organization_id,
          override_kind: row.override_kind,
          property_name: row.property_name,
          room_label: row.room_label,
          source: row.source,
          start_date: row.start_date,
          synced_at: new Date().toISOString(),
        })),
        { onConflict: "organization_id,source,property_name,room_label,start_date" },
      );
      if (kept.error) console.error("[beds24/block] room_blocks trim keep failed", kept.error.message);
    }
  }

  // 요금 표가 아직 `blackout` 이면 판매 캘린더가 **푼 차단을 계속 그린다**(요금 동기화까지 몇 시간).
  await patchLocalOverride({
    externalRoomIds: roomIds,
    kind: "none",
    nights,
    organizationId: args.organizationId,
    supabase: args.supabase,
  });

  await signalBeds24Change(args.organizationId, "blocks");
  return { ok: true, nights: nights.length, roomIds };
}

/**
 * 우리 요금 표(`room_daily_rates`)의 `override_kind` 를 되읽기로 **검증된 값**으로 맞춘다.
 *
 * 판매 캘린더는 12개월 BLOCK 막대를 이 칸으로 그린다(2026-09-29 — `ops-block-ranges.ts`). 요금
 * 동기화는 GitHub Actions 라 실측 몇 시간 간격이어서, 안 고치면 걸고 푼 것이 그만큼 늦게 보인다.
 * **있는 행만** 고친다 — 없는 날에 행을 만들면 가격·최소숙박이 비어 「안 파는 날」로 보인다.
 * 실패해도 Beds24 에는 이미 들어갔다(다음 동기화가 맞춘다).
 */
async function patchLocalOverride(args: {
  supabase: Client;
  organizationId: string;
  externalRoomIds: string[];
  nights: string[];
  kind: "blackout" | "none";
}): Promise<void> {
  try {
    const units = await args.supabase
      .from("rooms")
      .select("id")
      .eq("organization_id", args.organizationId)
      .in("external_room_id", args.externalRoomIds);
    const roomIds = ((units.data ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (roomIds.length === 0 || args.nights.length === 0) return;
    const result = await args.supabase
      .from("room_daily_rates")
      .update({ override_kind: args.kind } as never)
      .eq("organization_id", args.organizationId)
      .in("room_id", roomIds)
      .in("stay_date", args.nights);
    if (result.error) console.error("[beds24/block] 로컬 override 반영 실패", result.error);
  } catch (error) {
    console.error("[beds24/block] 로컬 override 반영 실패", error);
  }
}

