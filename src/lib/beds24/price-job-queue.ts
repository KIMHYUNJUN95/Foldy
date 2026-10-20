import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateCalendarDateValues,
  type CalendarDateValues,
} from "@/lib/beds24/calendar-write-payload";
import type { PriceJobRoomUpdate } from "@/lib/beds24/price-job-merge";
import {
  resolveMinStayWriteRoomIds,
  resolvePriceWriteRoomIds,
  type WriteTargetUnit,
} from "@/lib/beds24/write-target-room";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { Database } from "@/types/database";

/**
 * 작업 큐에 넣는 쪽.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「작업 큐」
 * 원본: STAY ARI Manager `functions/index.js` — `setRoomPrices`, `setMinStay`
 *
 * **여기서 대상 유닛이 정해진다.** 가격은 소스 유닛으로, 최소숙박은 그 날짜에 운영 중인
 * 유닛으로 간다(`write-target-room.ts`). 화면은 「어느 객실·어느 날짜」만 말하고,
 * 「어느 Beds24 유닛」은 서버가 정한다 — 화면이 정하면 규칙이 두 군데가 된다.
 */

type Client = SupabaseClient<Database>;

/** 화면에서 올라오는 요청 단위 — 캘린더 한 칸. */
export type PriceJobCellRequest = {
  /** 우리 `rooms.id` 가 아니라 **캘린더 행**이다. 한 행 뒤에 유닛이 여럿일 수 있다. */
  roomIds: string[];
  roomLabel: string | null;
  stayDate: string;
  values: CalendarDateValues;
};

/** 문구가 아니라 **코드**다. 화면이 사전에서 골라 보여준다. */
export type EnqueueError =
  | "no_cells"
  | "invalid_values"
  | "no_writable_room"
  | "enqueue_failed";

export type EnqueueResult =
  | { ok: false; error: EnqueueError }
  | { ok: true; jobId: string; targetRooms: number; skippedDates: string[] };

type RoomUnitRow = {
  id: string;
  external_room_id: string | null;
  external_price_source_room_id: string | null;
  property_id: string;
  /** 활성 유닛이 둘 이상일 때 여기에만 쓰라는 예외 지정. 보통 `null`. */
  preferred_min_stay_room_id: string | null;
};

/**
 * 칸 목록을 Beds24 유닛별 작업으로 바꿔 큐에 넣는다.
 *
 * 최소숙박은 **날짜마다** 대상 유닛이 달라질 수 있다 — 오쿠보C 는 10/1 에 판매 유닛이
 * 바뀐다. 그래서 날짜 단위로 판정한다.
 */
export async function enqueueBeds24PriceJob(args: {
  supabase: Client;
  organizationId: string;
  jobType: "price" | "min_stay";
  cells: PriceJobCellRequest[];
  requestedBy: string | null;
  requestedByName: string | null;
  /** 이력에 「퍼센트로 바꿨다」가 남아야 한다. 화면에서만 합치고 데이터는 구분한다. */
  adjustMode?: "amount" | "percent" | "min_stay" | "revert";
  percentValue?: number | null;
}): Promise<EnqueueResult> {
  if (args.cells.length === 0) return { error: "no_cells", ok: false };

  // **큐에 넣기 전에 막는다.** 숫자가 아닌 값이 통과하면 Beds24 가 가격을 지운다.
  for (const cell of args.cells) {
    const invalid = validateCalendarDateValues({ [cell.stayDate]: cell.values });
    if (invalid) {
      // 사유는 로그에만 남긴다 — 화면에는 번역된 문구가 나가야 한다.
      console.warn("[beds24/price-job] 입력 거부", { reason: invalid });
      return { error: "invalid_values", ok: false };
    }
  }

  const allRoomIds = [...new Set(args.cells.flatMap((cell) => cell.roomIds))];
  const unitsResult = await readAllPages<RoomUnitRow>((from, to) =>
    args.supabase
      .from("rooms")
      .select(
        "id, external_room_id, external_price_source_room_id, property_id, preferred_min_stay_room_id",
      )
      .eq("organization_id", args.organizationId)
      .in("id", allRoomIds)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (unitsResult.error) return { error: "enqueue_failed", ok: false };

  const unitByRoomId = new Map<string, RoomUnitRow>();
  for (const row of unitsResult.data) unitByRoomId.set(row.id, row);

  // 그 날짜의 minStay 를 알아야 「운영 중인 유닛」을 고를 수 있다.
  //
  // **쪽을 나눠 끝까지 읽는다**(2026-10-19). 한 번에 읽으면 1,000행에서 잘려(`read-all-pages.ts`), 1,000칸 넘는 수정은
  // 뒤쪽 칸의 minStay 가 비어 「운영 중인 유닛 없음」으로 빠지거나 엉뚱한 유닛을 골랐다 — 최소숙박이 일부만 나갔다.
  // 날짜는 처음 ~ 끝 **범위로** 거른다(2026-10-20) — 가격 패널에서 기간을 1년까지 넓히면 날짜 목록 `in` 이 주소를 수천 자로
  // 만든다. 범위 안의 남는 날은 아래 `minStayByKey` 대조에서 쓰이지 않는다.
  const stayDates = [...new Set(args.cells.map((cell) => cell.stayDate))].sort();
  const ratesResult = await readAllPages<{ room_id: string; stay_date: string; min_stay: number | null }>(
    (from, to) =>
      args.supabase
        .from("room_daily_rates")
        .select("room_id, stay_date, min_stay")
        .eq("organization_id", args.organizationId)
        .in("room_id", allRoomIds)
        .gte("stay_date", stayDates[0])
        .lte("stay_date", stayDates[stayDates.length - 1])
        .order("room_id", { ascending: true })
        .order("stay_date", { ascending: true })
        .range(from, to),
  );
  if (ratesResult.error) {
    // 못 읽은 채 진행하면 모든 유닛의 minStay 가 null 이 되어 「운영 중인 유닛」을 잘못 고른다 —
    // 최소숙박이 엉뚱한 유닛에 써진다.
    console.error("[beds24/price-job] 요금 읽기 실패", ratesResult.error);
    return { error: "enqueue_failed", ok: false };
  }
  const minStayByKey = new Map<string, number | null>();
  for (const row of ratesResult.data) {
    minStayByKey.set(`${row.room_id}|${row.stay_date}`, row.min_stay);
  }

  const datesByExternalRoom = new Map<string, Record<string, CalendarDateValues>>();
  const labelByExternalRoom = new Map<string, string | null>();
  const propertyIds = new Set<string>();
  const skippedDates: string[] = [];

  for (const cell of args.cells) {
    const units: WriteTargetUnit[] = cell.roomIds
      .map((roomId) => unitByRoomId.get(roomId))
      .filter((row): row is RoomUnitRow => !!row && !!row.external_room_id)
      .map((row) => ({
        externalPriceSourceRoomId: row.external_price_source_room_id,
        externalRoomId: String(row.external_room_id),
        id: row.id,
        minStay: minStayByKey.get(`${row.id}|${cell.stayDate}`) ?? null,
      }));
    if (units.length === 0) {
      skippedDates.push(cell.stayDate);
      continue;
    }
    // 보통 비어 있다. 특정 유닛에만 써야 하는 예외가 있을 때만 값이 들어온다
    // (`rooms.preferred_min_stay_room_id`). 그 유닛이 **활성일 때만** 적용된다.
    const preferredOverride =
      cell.roomIds
        .map((roomId) => unitByRoomId.get(roomId)?.preferred_min_stay_room_id ?? null)
        .find((value) => value !== null) ?? null;
    for (const roomId of cell.roomIds) {
      const property = unitByRoomId.get(roomId)?.property_id;
      if (property) propertyIds.add(property);
    }

    const targets =
      args.jobType === "price"
        ? resolvePriceWriteRoomIds(units)
        : resolveMinStayWriteRoomIds(units, preferredOverride);

    if (targets.length === 0) {
      // 운영 중인 유닛이 없는 날짜다. **조용히 넘기지 않고** 몇 개가 빠졌는지 알려준다.
      skippedDates.push(cell.stayDate);
      continue;
    }

    for (const externalRoomId of targets) {
      const dates = datesByExternalRoom.get(externalRoomId) ?? {};
      dates[cell.stayDate] = cell.values;
      datesByExternalRoom.set(externalRoomId, dates);
      if (cell.roomLabel) labelByExternalRoom.set(externalRoomId, cell.roomLabel);
    }
  }

  if (datesByExternalRoom.size === 0) {
    return { error: "no_writable_room", ok: false };
  }

  const roomUpdates: PriceJobRoomUpdate[] = [...datesByExternalRoom].map(
    ([externalRoomId, dates]) => ({
      dates,
      externalRoomId,
      roomLabel: labelByExternalRoom.get(externalRoomId) ?? null,
    }),
  );

  const inserted = await args.supabase
    .from("beds24_price_jobs")
    .insert({
      adjust_mode: args.adjustMode ?? null,
      job_type: args.jobType,
      organization_id: args.organizationId,
      // 건물이 하나일 때만 기록한다 — 합치기가 건물 단위라 섞인 작업은 합치지 않는다.
      property_id: propertyIds.size === 1 ? [...propertyIds][0] : null,
      percent_value: args.percentValue ?? null,
      requested_by: args.requestedBy,
      requested_by_name: args.requestedByName,
      room_updates: roomUpdates as never,
      total_count: roomUpdates.length,
    })
    .select("id")
    .single();
  if (inserted.error) {
    console.error("[beds24/price-job] 큐 적재 실패", inserted.error);
    return { error: "enqueue_failed", ok: false };
  }

  return {
    jobId: (inserted.data as { id: string }).id,
    ok: true,
    skippedDates,
    targetRooms: roomUpdates.length,
  };
}

/** 아직 안 끝난 작업이 있는가. 요금 동기화가 양보할지 판단할 때 쓴다. */
export async function hasPendingPriceJobs(supabase: Client): Promise<boolean> {
  const result = await supabase
    .from("beds24_price_jobs")
    .select("id")
    .in("status", ["queued", "processing"])
    .limit(1)
    .maybeSingle();
  return !result.error && !!result.data;
}
