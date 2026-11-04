import { addDays } from "@/lib/cleaning-assign/day-state";
import { roomShareState, sameRoomRecords, storedSessionRoomKey } from "@/lib/cleaning-assign/room-key";
import { DAILY_CAP, overDailyCap, roomWeight, type SuggestPerson, type SuggestRoom } from "@/lib/cleaning-assign/suggest";
import { holdSkipReason } from "@/lib/cleaning-assign/task-kind";
import { isCleanedRecord } from "@/lib/cleaning-record-rules";
import { buildSessionRoomLabel, CALENDAR_BUILDING_ORDER, compareRoomLabel, physicalRoomKeyOfSessionLabel } from "@/lib/room-label-normalization";
import { tokyoDateOf, tokyoDayStart } from "@/lib/tokyo-date";

/**
 * 청소 · 배정 **판단 한 곳** — docs/product/45-cleaning-rules-table.md 의 줄이 여기 있다. 순수 모듈(DB 를 모른다, 클라이언트도 쓴다).
 *
 * 화면 · 서버 액션 · 월/하루 계산은 이 결과만 쓰고 따로 판단하지 않는다. 지적받은 자리만 고치다 같은 규칙을 다르게 판단하는 곳이 남아
 * 수정마다 새 문제가 났기 때문이다(2026-11-04). 규칙을 바꾸려면 표를 먼저 고치고, 테스트 `__tests__/cleaning-rules-table.test.ts` 도 같이.
 */

// ── 방 모양 ──────────────────────────────────────────────────────────────────────────────────────

export type AssignRoomSource = "checkout" | "extra" | "carry";
export type AssignRoomStatus = "pending" | "progress" | "done";

export type AssignRoom = {
  roomKey: string;
  propertyName: string;
  roomLabel: string;
  /** `cleaning_sessions.room_label` 모양 — 청소 시작 · 기록 짝짓기. */
  sessionRoomLabel: string;
  source: AssignRoomSource;
  hasTurnover: boolean;
  arrivingGuests: number | null;
  /** 오늘 들어오는 손님 이름(체크인 있는 방). */
  arrivingGuestName: string | null;
  nextCheckInDate: string | null;
  nextGuests: number | null;
  /** 다음 체크인 손님 이름(오늘 체크인 없는 방 · 30일 안). */
  nextGuestName: string | null;
  /** 수기 추가 메모. */
  note: string | null;
  /** 못 한 방 — 원래 청소해야 했던 날 · 며칠째. */
  carriedFrom: string | null;
  carryDays: number;
  /** 이전에 미룰 때 남긴 사유. */
  holdReason: string | null;
  /** 오늘 미룬 방(다음 날 · 날짜 지정) — 미배정에서 빠진다. */
  deferredUntil: string | null;
  /** 「처리 끝」으로 둔 방(청소 필요 없음) — 상태는 끝남, 「되돌리기」로 다시 미배정에. */
  resolvedHold: boolean;
  status: AssignRoomStatus;
  /**
   * 2인 방에서 일부만 끝냄(2026-11-02 사용자 결정 — 「1/2 끝남」). 끝낸 사람 수 · 필요한 수(그날 그 방 배정 인원). 이때 `status` 는
   * `progress`(아직 다 끝난 방이 아님). 그 밖에는 null. 계산은 `roomShareState` 하나.
   */
  partial: { done: number; need: number } | null;
  usualHeadcount: number;
};

export type RoomKeyFields = { roomKey: string; propertyName: string; roomLabel: string; sessionRoomLabel: string };

/** 그날 목록의 씨앗(체크아웃 · 수기 추가) — 체크인 정보는 하루 보기만 채운다. */
export type DayRoomSeed = RoomKeyFields & {
  source: AssignRoomSource;
  note: string | null;
  hasTurnover?: boolean;
  arrivingGuests?: number | null;
  arrivingGuestName?: string | null;
  nextCheckInDate?: string | null;
  nextGuests?: number | null;
  nextGuestName?: string | null;
};

export type RangeRooms = ReadonlyMap<string, ReadonlyMap<string, DayRoomSeed>>;

export type HoldRow = {
  room_key: string;
  origin_date: string;
  kind: string;
  until_date: string | null;
  reason: string | null;
  property_name: string;
  room_label: string;
  created_at: string;
};

/** 판정에 쓰는 청소 기록 한 줄(진행 중 · 완료 · 취소). */
export type SessionRow = {
  room_key?: string | null;
  room_label: string;
  status: string;
  cleaning_date: string;
  staff_user_id: string;
  closed_without_cleaning?: boolean | null;
};

/** 못 한 방을 몇 날 앞까지 찾는가. */
export const CARRY_LOOKBACK_DAYS = 7;
/** 「날짜 정해 미루기」 최대 일수(서버 액션 `holdRoom` 과 같다) — 이만큼 앞의 미룸까지 찾아야 정한 날 다시 뜬다. */
export const MAX_DEFER_DAYS = 60;

/** 운영 건물 순서(가부키초 다음 스테이아리 · 사노 맨 뒤) → 객실 번호 순. */
export function buildingRank(propertyName: string): number {
  const index = CALENDAR_BUILDING_ORDER.indexOf(propertyName);
  return index === -1 ? CALENDAR_BUILDING_ORDER.length : index;
}

export function compareAssignRooms(a: { propertyName: string; roomLabel: string }, b: { propertyName: string; roomLabel: string }): number {
  return buildingRank(a.propertyName) - buildingRank(b.propertyName) || a.propertyName.localeCompare(b.propertyName, "ko") || compareRoomLabel(a.roomLabel, b.roomLabel);
}

// ── 미룸 · 처리 끝(R7~R12) ───────────────────────────────────────────────────────────────────────

/** 미룸이 덮는 기준 날(도쿄) — 관리자가 **보고 있던 날**. `holdUpsertRow` 가 `created_at` 에 그 날로 적는다(R1 · R9 · R11). */
function holdMadeOn(hold: Pick<HoldRow, "created_at" | "origin_date">): string {
  return tokyoDateOf(hold.created_at) ?? hold.origin_date;
}

/** 그날 기준으로 아직 효력이 있나 — 처리 끝은 늘, 미룸은 정한 날 전까지. */
function holdActive(hold: Pick<HoldRow, "kind" | "until_date">, date: string): boolean {
  return hold.kind === "resolved" || (hold.kind === "defer" && hold.until_date !== null && hold.until_date > date);
}

/**
 * `origin` 날 청소를 덮는 미룸 줄 하나 — 하루 보기와 시작 막기의 **유일한 기준**(R9).
 * 미룸 · 처리 끝은 그 방의 **미룬 날까지 쌓인 청소**를 함께 덮는다: 그 날짜 줄이거나, `미룸 처음 날 < origin ≤ 미룬 날` 이고 아직 효력이 있는 줄.
 * 미룬 날 **뒤에** 생긴 체크아웃은 덮지 않는다 — 그 방은 정상 방이고 시작도 된다.
 */
export function holdForOrigin<T extends Pick<HoldRow, "origin_date" | "kind" | "until_date" | "created_at">>(holdsOfRoom: readonly T[], origin: string, date: string): T | undefined {
  return (
    holdsOfRoom.find((row) => row.origin_date === origin) ??
    holdsOfRoom.find((row) => row.origin_date < origin && holdMadeOn(row) >= origin && holdActive(row, date))
  );
}

/** 시작을 막는 이유(R7 · R8 · R9 · R10 · R11 · R12) — 방이 하루 목록에 있으면 하루 보기 판단 그대로, 없는데 미룬 기간이면 막는다. */
export function roomStartBlock(room: { deferredUntil: string | null; resolvedHold: boolean } | undefined, hasActiveDefer: boolean): "held" | "resolved" | null {
  if (room) return holdSkipReason(room);
  return hasActiveDefer ? "held" : null;
}

/** 그날 효력이 있는 미룸 — 방 키 → 정한 날. 미룬 기간이라 하루 목록에 없는 배정 방에 「예약 바뀜」 대신 미룸 문구를 쓰게(R8). */
export function activeDeferUntil(holds: readonly Pick<HoldRow, "room_key" | "origin_date" | "kind" | "until_date">[], date: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const hold of holds) {
    if (hold.kind === "defer" && hold.until_date && hold.origin_date <= date && hold.until_date > date) out.set(hold.room_key, hold.until_date);
  }
  return out;
}

/** 「방 추가」를 막는 미룸인가(A5) — 미룬 기간이거나 그날 처리 끝. 지난 처리 끝은 새 일이라 걸리지 않는다. */
export function holdBlocksAddRoom(hold: Pick<HoldRow, "origin_date" | "kind" | "until_date" | "created_at">, date: string): boolean {
  if (hold.origin_date > date) return false;
  if (hold.kind === "defer") return hold.until_date !== null && hold.until_date > date;
  return hold.kind === "resolved" && holdMadeOn(hold) >= date;
}

/**
 * 미룸 저장 줄. **`created_at` 은 보고 있던 날로 쓴다**(`holdForOrigin` · 「그날 미룸」 판단이 이 값을 본다).
 * - upsert 가 기존 줄을 바꿀 때 예전 값이 남으면 기간 지난 방을 다시 미룬 날 목록에서 사라졌다(R11).
 * - 어제 보기에서 눌렀는데 「지금」을 쓰면 오늘 새 체크아웃까지 덮여 시작이 막히고, 어제 보기의 줄과 되돌리기가 사라졌다(R1 · R9).
 * 오늘 보기면 지금 시각, 다른 날 보기면 그 날 0시(도쿄).
 */
export function holdUpsertRow(
  input: {
    organizationId: string;
    createdBy: string;
    kind: "defer" | "resolved";
    originDate: string;
    until: string | null;
    reason: string;
    closedSessionId: string | null;
    removedUserIds: string[];
    room: { roomKey: string; propertyName: string; roomLabel: string };
    /** 관리자가 보고 있던 날. */
    viewedDate: string;
  },
  nowIso: string,
) {
  return {
    closed_session_id: input.closedSessionId,
    created_at: tokyoDateOf(nowIso) === input.viewedDate ? nowIso : tokyoDayStart(input.viewedDate),
    created_by: input.createdBy,
    kind: input.kind,
    organization_id: input.organizationId,
    origin_date: input.originDate,
    property_name: input.room.propertyName,
    reason: input.reason || null,
    removed_user_ids: input.removedUserIds,
    room_key: input.room.roomKey,
    room_label: input.room.roomLabel,
    until_date: input.until,
  };
}

/**
 * 되돌리기가 다시 넣을 사람(A8). 기간이 지난 줄을 다시 걸 때는 **지금 배정만** — 전에 뺀 사람을 합치면 그날 배정한 적 없는 사람이 되살아난다.
 * 아직 효력이 있는 줄(이미 뺀 사람이 그 효력 안에 있음)만 합친다.
 */
export function holdRemovedUserIds(
  previous: { kind: string; until_date: string | null; removed_user_ids: readonly string[] | null } | null,
  current: readonly string[],
  date: string,
): string[] {
  return previous && holdActive(previous, date) ? [...new Set([...(previous.removed_user_ids ?? []), ...current])] : [...new Set(current)];
}

// ── 하루 목록(R1~R13 · C9) ───────────────────────────────────────────────────────────────────────

export type SessionIndex = {
  /** 방 키 → 끝낸 날짜들(처리 끝 포함 — 그 방은 다시 밀려 오지 않는다). */
  completedDates: ReadonlyMap<string, readonly string[]>;
  /** `날짜|방 키` → 그날 기록. */
  byDayRoom: ReadonlyMap<string, readonly { staffId: string; status: string; closed: boolean }[]>;
};

/**
 * 청소 기록 묶기. 키는 저장된 방 키, 없으면(예전 기록) 라벨에서 만든 키, 그것도 없는 새 건물은 라벨 그대로 — 방 쪽도 `sessionRoomLabel` 로
 * 한 번 더 찾는다(안 그러면 그 방은 청소해도 늘 「대기」로 보이고 다음 날 다시 떴다).
 */
export function indexSessions(rows: readonly SessionRow[]): SessionIndex {
  const completedDates = new Map<string, string[]>();
  const byDayRoom = new Map<string, { staffId: string; status: string; closed: boolean }[]>();
  for (const row of rows) {
    if (row.status === "cancelled") continue;
    const key = storedSessionRoomKey(row);
    if (row.status === "completed") completedDates.set(key, [...(completedDates.get(key) ?? []), row.cleaning_date]);
    const dayKey = `${row.cleaning_date}|${key}`;
    byDayRoom.set(dayKey, [...(byDayRoom.get(dayKey) ?? []), { closed: Boolean(row.closed_without_cleaning), staffId: row.staff_user_id, status: row.status }]);
  }
  return { byDayRoom, completedDates };
}

/**
 * 하루 배정 대상 방 — 하루 보기 · 월 보기 · 월 제안 · 알바 「배정 없음」이 **모두 이 계산**을 쓴다(C9 · C10).
 * - `seeds`: 그날 체크아웃 · 수기 추가.
 * - 못 한 방: 배정을 쓴 날(`usedDays`)과 미룬 방이 있는 날만 본다 — 기능을 쓰기 전 날의 방까지 몰려오지 않게.
 * - **앞날(`date > today`)엔 밀려 오지 않는다**(R4) — 아직 오지 않은 날이라 안 끝날지 모른다. 그날로 미룬 방만 나온다.
 *   단 그날 이미 넣어 둔 배정이 있고 아직 안 끝난 방은 남긴다 — 없애면 그 배정이 「취소됨」으로 보인다.
 *   지난 날은 그날 기준으로 보여 준다(기록 정리용).
 * - 끝낸 기록이 한 사람이라도 있으면 치운 방 — 다음 날 안 나온다(R5). 취소 · 「못 했어요」는 다시 뜬다(R6).
 */
export function buildDayRooms(input: {
  date: string;
  today: string;
  seeds: readonly DayRoomSeed[];
  /** 지난 날짜별 체크아웃 · 수기 추가. */
  range: RangeRooms;
  usedDays: Iterable<string>;
  sessions: SessionIndex;
  holds: readonly HoldRow[];
  /** 그날 방 키 → 배정된 사람. */
  assignees: ReadonlyMap<string, readonly string[]>;
  usual: ReadonlyMap<string, number>;
}): AssignRoom[] {
  const { date, sessions, usual } = input;
  const future = date > input.today;
  const lookFrom = addDays(date, -CARRY_LOOKBACK_DAYS);
  const yesterday = addDays(date, -1);

  const holds = input.holds.filter((row) => row.origin_date <= date);
  const holdsByKey = new Map<string, HoldRow[]>();
  for (const row of holds) holdsByKey.set(row.room_key, [...(holdsByKey.get(row.room_key) ?? []), row]);
  const holdFor = (roomKey: string, origin: string) => holdForOrigin(holdsByKey.get(roomKey) ?? [], origin, date);

  const doneDatesOf = (room: { roomKey: string; sessionRoomLabel: string }) => sessions.completedDates.get(room.roomKey) ?? sessions.completedDates.get(room.sessionRoomLabel) ?? [];
  const shareOf = (key: { roomKey: string; sessionRoomLabel: string }) =>
    roomShareState(sessions.byDayRoom.get(`${date}|${key.roomKey}`) ?? sessions.byDayRoom.get(`${date}|${key.sessionRoomLabel}`) ?? [], input.assignees.get(key.roomKey) ?? []);

  const base = (key: RoomKeyFields): AssignRoom => {
    const share = shareOf(key);
    return {
      arrivingGuestName: null,
      arrivingGuests: null,
      carriedFrom: null,
      carryDays: 0,
      deferredUntil: null,
      hasTurnover: false,
      holdReason: null,
      nextCheckInDate: null,
      nextGuestName: null,
      nextGuests: null,
      note: null,
      partial: share.partial ? { done: share.done, need: share.need } : null,
      propertyName: key.propertyName,
      resolvedHold: false,
      roomKey: key.roomKey,
      roomLabel: key.roomLabel,
      sessionRoomLabel: key.sessionRoomLabel,
      source: "checkout",
      status: share.status,
      usualHeadcount: usual.get(key.roomKey) ?? 1,
    };
  };

  const rooms = new Map<string, AssignRoom>();
  for (const seed of input.seeds) {
    if (rooms.has(seed.roomKey)) continue;
    rooms.set(seed.roomKey, {
      ...base(seed),
      arrivingGuestName: seed.arrivingGuestName ?? null,
      arrivingGuests: seed.arrivingGuests ?? null,
      hasTurnover: seed.hasTurnover ?? false,
      nextCheckInDate: seed.nextCheckInDate ?? null,
      nextGuestName: seed.nextGuestName ?? null,
      nextGuests: seed.nextGuests ?? null,
      note: seed.note,
      source: seed.source,
    });
  }

  const daysSince = (origin: string) => Math.round((Date.parse(date) - Date.parse(origin)) / 86_400_000);

  // 오늘 미룬 방(origin = 오늘) — 또는 밀려 온 방을 오늘 미뤄 오늘 체크아웃까지 덮인 방(origin = 처음 날, 되돌리기도 그 날짜로).
  for (const room of rooms.values()) {
    const hold = holdFor(room.roomKey, date);
    const deferred = hold?.kind === "defer" && hold.until_date !== null && hold.until_date > date;
    if (hold && deferred) {
      room.deferredUntil = hold.until_date;
      room.holdReason = hold.reason;
    }
    if (hold?.kind === "resolved") {
      room.status = "done";
      room.partial = null;
      room.resolvedHold = true;
      room.holdReason = hold.reason;
    }
    if (hold && (deferred || hold.kind === "resolved") && hold.origin_date < date) {
      room.carriedFrom = hold.origin_date;
      room.carryDays = daysSince(hold.origin_date);
    }
  }

  // 못 한 방을 **오늘** 미뤘거나 처리 끝으로 뒀으면 오늘 목록에 남긴다(R7 · R11 · R12 — 실수로 눌러도 되돌릴 수 있게).
  // 다음 날부터는 안 보인다(R8 — 미룬 방은 정한 날 다시 뜬다).
  const heldToday = (hold: HoldRow): boolean => holdMadeOn(hold) === date && holdActive(hold, date);
  const markHeld = (room: AssignRoom, hold: HoldRow) => {
    if (hold.kind === "resolved") {
      room.status = "done";
      room.partial = null;
      room.resolvedHold = true;
    } else {
      room.deferredUntil = hold.until_date;
    }
    room.holdReason = hold.reason;
    return room;
  };

  // 미룬 방이 있는 날도 넣는다 — 그날 배정이 하나도 없었어도 미룬 방은 정한 날 다시 떠야 한다.
  // 단 **그 방만** — 배정을 쓰지 않은 날(7일보다 오래된 날 포함)의 다른 방까지 끌려오면 안 된다.
  const deferRows = holds.filter((row) => row.kind === "defer" && row.origin_date < date);
  const deferredKeysOf = new Map<string, Set<string>>();
  for (const row of deferRows) deferredKeysOf.set(row.origin_date, (deferredKeysOf.get(row.origin_date) ?? new Set()).add(row.room_key));
  const assignDays = new Set([...input.usedDays].filter((day) => day >= lookFrom && day <= yesterday));
  const origins = [...new Set([...assignDays, ...deferredKeysOf.keys()])].sort();
  // R4 — 앞날에는 그날로 미룬 방과 그날 이미 배정이 있는 방만.
  const keepOnFuture = (roomKey: string, until: string | null | undefined) => until === date || (input.assignees.get(roomKey)?.length ?? 0) > 0;
  for (const origin of origins) {
    for (const candidate of input.range.get(origin)?.values() ?? []) {
      if (!assignDays.has(origin) && !deferredKeysOf.get(origin)?.has(candidate.roomKey)) continue;
      if (doneDatesOf(candidate).some((d) => d >= origin && d < date)) continue;
      const hold = holdFor(candidate.roomKey, origin);
      const carryDays = daysSince(origin);
      if (hold && holdActive(hold, date)) {
        if (hold && heldToday(hold) && !rooms.has(candidate.roomKey)) {
          rooms.set(candidate.roomKey, markHeld({ ...base(candidate), carriedFrom: origin, carryDays, note: candidate.note, source: "carry" }, hold));
        }
        continue;
      }
      if (future && !keepOnFuture(candidate.roomKey, hold?.kind === "defer" ? hold.until_date : null)) continue;
      const existing = rooms.get(candidate.roomKey);
      if (existing) {
        // 오늘도 퇴실이 있는 방 — 오늘 방으로 두되 밀려 온 표시는 남긴다(R3, 가장 이른 날 기준).
        // 미룬 방은 되돌리기가 미룸 기록의 날짜를 써야 하므로 그대로 둔다.
        if (!existing.deferredUntil && !existing.resolvedHold && (!existing.carriedFrom || origin < existing.carriedFrom)) {
          existing.carriedFrom = origin;
          existing.carryDays = carryDays;
          existing.holdReason = existing.holdReason ?? hold?.reason ?? null;
        }
        continue;
      }
      rooms.set(candidate.roomKey, { ...base(candidate), carriedFrom: origin, carryDays, holdReason: hold?.reason ?? null, note: candidate.note, source: "carry" });
    }
  }

  // 7일보다 앞서 미룬 방 — 정한 날이 됐고 그 사이 청소 기록이 없으면 다시 띄운다(위 반복은 최근 7일만 본다).
  for (const hold of holds) {
    if (hold.origin_date >= lookFrom) continue;
    const key: RoomKeyFields = { propertyName: hold.property_name, roomKey: hold.room_key, roomLabel: hold.room_label, sessionRoomLabel: buildSessionRoomLabel(hold.property_name, hold.room_label) };
    if (doneDatesOf(key).some((d) => d >= hold.origin_date && d < date)) continue;
    const carryDays = daysSince(hold.origin_date);
    // 오늘 다시 미뤘거나 처리 끝으로 둔 오래된 방 — 오늘만 표시(되돌리기).
    if (heldToday(hold)) {
      if (!rooms.has(hold.room_key)) rooms.set(hold.room_key, markHeld({ ...base(key), carriedFrom: hold.origin_date, carryDays, source: "carry" }, hold));
      continue;
    }
    if (hold.kind !== "defer" || !hold.until_date || hold.until_date > date) continue;
    if (future && !keepOnFuture(hold.room_key, hold.until_date)) continue;
    const existing = rooms.get(hold.room_key);
    if (existing) {
      if (!existing.carriedFrom || hold.origin_date < existing.carriedFrom) {
        existing.carriedFrom = hold.origin_date;
        existing.carryDays = carryDays;
        existing.holdReason = existing.holdReason ?? hold.reason;
      }
      continue;
    }
    rooms.set(hold.room_key, { ...base(key), carriedFrom: hold.origin_date, carryDays, holdReason: hold.reason, source: "carry" });
  }

  return [...rooms.values()].sort(compareAssignRooms);
}

/** 「N일째」(R2 · R3 · R6 · R10) — 지난 날부터 밀린 방. 오늘 체크아웃이 겹친 방도 같은 표시. */
export function carryBadgeDays(room: { carriedFrom: string | null; carryDays: number }): number | null {
  return room.carriedFrom && room.carryDays > 0 ? room.carryDays + 1 : null;
}

/** 미배정 = 시작 전이고, 미룸 · 처리 끝이 아니고, 아무도 안 들어간 방 — 하루 숫자 · 월 숫자 · 알바 「배정 없음」이 같이 쓴다(C9 · C10). */
export function isOpenRoom(room: Pick<AssignRoom, "status" | "deferredUntil" | "resolvedHold">, assignedCount: number): boolean {
  return assignedCount === 0 && room.status === "pending" && !room.deferredUntil && !room.resolvedHold;
}

export function countOpenRooms(rooms: readonly (Pick<AssignRoom, "roomKey" | "status" | "deferredUntil" | "resolvedHold">)[], assignedKeys: ReadonlySet<string>): number {
  return rooms.filter((room) => isOpenRoom(room, assignedKeys.has(room.roomKey) ? 1 : 0)).length;
}

/** 하루 보기 「미배정」 구역 — 비었거나 인원이 모자라거나 밀려 온 방(R10 · 정한 날 도착한 방이 맨 위 구역에). */
export function isOpenSectionRoom(room: Pick<AssignRoom, "status" | "deferredUntil" | "carriedFrom" | "usualHeadcount"> & { cancelled: boolean; people: readonly unknown[] }): boolean {
  if (room.cancelled || room.status !== "pending" || room.deferredUntil) return false;
  return room.people.length === 0 || room.people.length < room.usualHeadcount || Boolean(room.carriedFrom);
}

/** 미배정 구역 순서(R10) — 정한 날 도착한 · 밀려 온 방이 맨 위(오래된 순), 나머지는 원래 순서(건물 → 객실). */
export function sortOpenSection<T extends { carriedFrom: string | null }>(rooms: readonly T[]): T[] {
  return [...rooms.filter((room) => room.carriedFrom)].sort((a, b) => a.carriedFrom!.localeCompare(b.carriedFrom!)).concat(rooms.filter((room) => !room.carriedFrom));
}

/**
 * `/mobile/cleaning` 목록에 시작 버튼을 내밀 방(R7 · R8) — 서버 `startSessionCore` 의 `roomStartBlock` 과 같은 판단이라 눌렀다가 거절되는 일이 없다.
 * `activeHoldKeys` 는 그날 미룬 기간 · 처리 끝인 방 키(`holdBlocksAddRoom`).
 */
export function startableListTargets<T extends { roomKey: string; sessionRoomLabel: string }>(
  targets: readonly T[],
  dayRooms: readonly (Pick<AssignRoom, "roomKey" | "sessionRoomLabel" | "deferredUntil" | "resolvedHold">)[],
  activeHoldKeys: ReadonlySet<string>,
): T[] {
  return targets.filter((target) => {
    const physical = physicalRoomKeyOfSessionLabel(target.sessionRoomLabel);
    const room = dayRooms.find((item) => item.roomKey === target.roomKey || item.sessionRoomLabel === target.sessionRoomLabel || item.roomKey === physical);
    return roomStartBlock(room, activeHoldKeys.has(target.roomKey) || (physical !== null && activeHoldKeys.has(physical))) === null;
  });
}

// ── 배정 바꾸기(A1~A6) ──────────────────────────────────────────────────────────────────────────

export type CapRoom = Pick<AssignRoom, "status" | "partial" | "deferredUntil" | "resolvedHold"> & { cancelled?: boolean };

/** 미룸 · 처리 끝인 방 — 먼저 되돌린다(A5). */
const isHeldRoom = (room: CapRoom) => Boolean(room.deferredUntil || room.resolvedHold);

/**
 * 콘솔 카드 담당 칸 · 담당 거르기 · 검색이 보는 사람 — 그날 그 방의 기록한 사람 + 배정된 사람(중복 없이, 기록한 사람 먼저). 2026-11-04.
 * 카드가 대표 기록 한 사람만 읽어 기록 전 방은 모두 「미배정」, 2인 방은 동료가 거르기에 안 잡혔다.
 * `staffId` 는 대표 기록의 담당 그대로 둔다(대신 완료 · 기록 동작이 그 값을 쓴다). **직원별 요약은 이 값을 쓰지 않는다** — 사람별 기록(`task.workers`)만 센다.
 */
export function consoleWhoIds(task: { staffId: string | null; workers: readonly { staffId: string }[]; assigneeIds: readonly string[] }): string[] {
  return [...new Set([...(task.staffId ? [task.staffId] : []), ...task.workers.map((work) => work.staffId), ...task.assigneeIds])];
}

/**
 * 강제 완료 창 담당 칸 기본값 — 기록의 담당이 있으면 그 사람, 없고 배정이 한 명이면 그 사람,
 * 두 명 이상이거나 없으면 비워 둔다(누구 기록인지 관리자가 고른다). 고를 수 없는 사람은 채우지 않는다.
 */
export function forceCompleteDefaultStaff(
  task: { assigneeIds: readonly string[]; staffId: string | null },
  isSelectable: (staffId: string) => boolean,
): string {
  const assignees = [...new Set(task.assigneeIds)];
  const picked = task.staffId ?? (assignees.length === 1 ? assignees[0] : "");
  return picked && isSelectable(picked) ? picked : "";
}

/** 「N명 더 필요」 — 사람을 넣을 수 있는 방에만. 끝남 · 1/2 끝남 · 청소 중 · 미룸 · 처리 끝에는 뜨지 않는다. */
export function needMoreCount(room: CapRoom & { usualHeadcount: number }, assignedCount: number): number {
  return canAddPerson(room) ? Math.max(0, room.usualHeadcount - assignedCount) : 0;
}

/** 사람 넣기 — 대기 방만(A1). */
export function canAddPerson(room: CapRoom): boolean {
  return !room.cancelled && !isHeldRoom(room) && room.status === "pending";
}

/** 빼기 — 기록 있는 사람은 그 방에서 빠지지 않고, 기록 없는 사람은 옮길 수 있다(표 2 머리말). 예약 취소된 방은 빼기만 된다(A6). */
export function canRemovePerson(room: CapRoom, hasRecord: boolean): boolean {
  if (hasRecord || isHeldRoom(room)) return false;
  return true;
}

/** 교체 — 빼기와 같고, 예약 취소된 방만 잠근다(A6). */
export function canSwapPerson(room: CapRoom, hasRecord: boolean): boolean {
  return !room.cancelled && canRemovePerson(room, hasRecord);
}

/** 미루기 · 처리 끝 — 대기 방만(A1~A6). */
export function canHoldRoom(room: CapRoom): boolean {
  return canAddPerson(room);
}

/** 방 추가 — 대기 방이거나, 목록에 없는 방 · 예약 취소된 방(수기 방으로, A6). 미룬 기간이면 막는다(A5). */
export function canAddRoom(room: CapRoom | undefined, heldByHold: boolean): boolean {
  if (heldByHold) return false;
  if (!room || room.cancelled) return true;
  return canAddPerson(room);
}

/** 그 사람의 그 방 그날 기록 = 진행 중 · 완료(취소 · 처리 끝 제외). `rows` 는 그날 기록. */
export function personHasRoomRecord(rows: readonly SessionRow[], room: { roomKey: string; sessionRoomLabel: string }, userId: string): boolean {
  return sameRoomRecords(rows, room.sessionRoomLabel, room.roomKey).some((row) => row.staffId === userId && !row.closed && (row.status === "in_progress" || row.status === "completed"));
}

/** 예약이 취소돼 목록에서 빠졌는데 배정이 남은 방 — 「취소됨」으로 남긴다(R13 · A6). */
export function ghostAssignRoom(row: { roomKey: string; propertyName: string; roomLabel: string }): AssignRoom {
  return {
    arrivingGuestName: null,
    arrivingGuests: null,
    carriedFrom: null,
    carryDays: 0,
    deferredUntil: null,
    hasTurnover: false,
    holdReason: null,
    nextCheckInDate: null,
    nextGuestName: null,
    nextGuests: null,
    note: null,
    partial: null,
    propertyName: row.propertyName,
    resolvedHold: false,
    roomKey: row.roomKey,
    roomLabel: row.roomLabel,
    sessionRoomLabel: buildSessionRoomLabel(row.propertyName, row.roomLabel),
    source: "checkout",
    status: "pending",
    usualHeadcount: 1,
  };
}

// ── 일정 취소 · 되돌리기 · 강제 완료 · 일괄 처리(A7~A10) ─────────────────────────────────────────

/**
 * 그날 일정 취소(취소 요청 수락 포함) — 청소 중이면 막는다. 끝낸 방의 배정은 남기고 시작하지 않은 방만 뺀다(A7).
 * `sessions` 는 그 사람의 그날 기록.
 */
export function planCancelDay(
  assignments: readonly { id: string; roomKey: string; propertyName: string; roomLabel: string }[],
  sessions: readonly SessionRow[],
  userId: string,
): { blocked: boolean; removeIds: string[]; keepIds: string[] } {
  if (sessions.some((row) => row.staff_user_id === userId && row.status === "in_progress" && !row.closed_without_cleaning)) return { blocked: true, keepIds: [], removeIds: [] };
  const hasRecord = (row: (typeof assignments)[number]) => personHasRoomRecord(sessions, { roomKey: row.roomKey, sessionRoomLabel: buildSessionRoomLabel(row.propertyName, row.roomLabel) }, userId);
  return { blocked: false, keepIds: assignments.filter(hasRecord).map((row) => row.id), removeIds: assignments.filter((row) => !hasRecord(row)).map((row) => row.id) };
}

/** 되돌릴 때 다시 넣을 사람 — 그 사이 시작된 방이면 미룸만 지우고 아무도 다시 넣지 않는다(A8). 처리 끝 기록은 「시작」이 아니다. */
export function restoreIdsAfterRelease(input: { candidates: readonly string[]; rows: readonly SessionRow[]; room: { roomKey: string; sessionRoomLabel: string } }): string[] {
  const share = roomShareState(sameRoomRecords(input.rows, input.room.sessionRoomLabel, input.room.roomKey), []);
  return share.status === "pending" ? [...input.candidates] : [];
}

/** 알바의 「취소 요청」(A7) — 일정이 이미 취소된 날(끝낸 방만 남음)은 서버도 받지 않으므로 내밀지 않는다. */
export function canRequestCancel(input: { date: string; today: string; cancelled: boolean }): boolean {
  return !input.cancelled && input.date >= input.today;
}

/** 강제 완료 끝 시각 — 미래는 거절(A9). */
export function forceCompleteEndAllowed(endIso: string, nowMs: number): boolean {
  return Date.parse(endIso) <= nowMs;
}

type StepResult = { error: boolean };

/**
 * 미루기 · 처리 끝 저장 순서(A10). **미룸 줄이 먼저, 처리 끝 기록은 그다음** — 줄 없이 처리 끝 기록만 남으면 방이 「대기」로 보이는데
 * 시작은 `room_resolved` 로 막히고 되돌릴 줄도 없어 재시도까지 conflict 였다. 어디서 실패하든 원래대로 되돌리므로 같은 동작을 다시 누르면 된다.
 * 되돌리기까지 실패하면 알리고(`reportRollback`) **미룸 줄을 남긴다** — 화면에 「처리 끝 · 되돌리기」가 있어 그걸로 풀린다.
 * (`closed_session_id` 는 `cleaning_sessions` FK 라 기록을 만든 뒤에 잇는다.)
 */
export async function applyHoldSteps(
  kind: "defer" | "resolved",
  ports: {
    saveHold: () => Promise<StepResult>;
    undoHold: () => Promise<StepResult>;
    insertClosed: () => Promise<StepResult & { id: string | null }>;
    linkClosed: (id: string) => Promise<StepResult>;
    deleteClosed: (id: string) => Promise<StepResult>;
    removeAssignments: () => Promise<StepResult>;
    reportRollback: (what: "closed_session" | "hold") => void;
  },
): Promise<"ok" | "error"> {
  const rollback = async (closedId: string | null): Promise<"error"> => {
    if (closedId && (await ports.deleteClosed(closedId)).error) {
      ports.reportRollback("closed_session");
      return "error";
    }
    if ((await ports.undoHold()).error) ports.reportRollback("hold");
    return "error";
  };
  if ((await ports.saveHold()).error) return "error";
  let closedId: string | null = null;
  if (kind === "resolved") {
    const closed = await ports.insertClosed();
    if (closed.error || !closed.id) return rollback(null);
    closedId = closed.id;
    if ((await ports.linkClosed(closedId)).error) return rollback(closedId);
  }
  if ((await ports.removeAssignments()).error) return rollback(closedId);
  return "ok";
}

/**
 * 되돌리기 저장 순서(A10). 배정 넣기 → 처리 끝 기록 지우기 → **미룸 줄 지우기(맨 끝)**. 줄이 남아 있는 한 언제든 다시 누를 수 있다 —
 * 줄을 먼저 지우면 뺀 사람(`removed_user_ids`)을 되찾을 길이 없고, 처리 끝 기록만 남아 재시도도 conflict 였다.
 * 실패하면 방금 넣은 배정을 되돌린다(미룬 방에 사람이 남지 않게). 그 되돌리기 실패도 알린다.
 */
export async function releaseHoldSteps(
  restoreIds: readonly string[],
  closedSessionIds: readonly string[],
  ports: {
    restore: (ids: readonly string[]) => Promise<StepResult & { insertedIds: string[] }>;
    deleteRestored: (rowIds: string[]) => Promise<StepResult>;
    deleteClosedSessions: (sessionIds: readonly string[]) => Promise<StepResult>;
    deleteHold: () => Promise<StepResult>;
    reportRollback: (what: "restored_assignments") => void;
  },
): Promise<"ok" | "error"> {
  let inserted: string[] = [];
  if (restoreIds.length > 0) {
    const restored = await ports.restore(restoreIds);
    if (restored.error) return "error";
    inserted = restored.insertedIds;
  }
  const failed = async (): Promise<"error"> => {
    if (inserted.length > 0 && (await ports.deleteRestored(inserted)).error) ports.reportRollback("restored_assignments");
    return "error";
  };
  if (closedSessionIds.length > 0 && (await ports.deleteClosedSessions(closedSessionIds)).error) return failed();
  if ((await ports.deleteHold()).error) return failed();
  return "ok";
}

// ── 세는 기준 · 닫기 · 시작(C5 · C8 · C12 · C13) ────────────────────────────────────────────────

/** 비교표 청소 수 — 그 사람의 「청소한 기록」이 있는 방(날짜 × 실제 방)마다 1개, 나누지 않는다(C5). */
export function cleanedRoomCount(rows: readonly SessionRow[], userId: string): number {
  const rooms = new Set<string>();
  for (const row of rows) {
    if (row.staff_user_id === userId && isCleanedRecord(row)) rooms.add(`${row.cleaning_date}|${storedSessionRoomKey(row)}`);
  }
  return rooms.size;
}

/**
 * PC 콘솔 카드의 「1/2 끝남」 — 예약 카드 · 수기 · 밀려 온 카드가 같이 쓴다(C8). 방 상태는 `roomShareState` 하나.
 * 대신 완료할 같이 한 사람은 「1/2 끝남」일 때만 — 끝난 방에 빠진 사람을 내밀지 않는다. 처리 끝 방은 세지 않는다.
 */
export function consolePartial(
  rows: readonly { staff_user_id: string; status: string; closed_without_cleaning?: boolean | null }[],
  assignees: readonly string[],
  cardStatus: string,
): { partial: { done: number; need: number } | null; missingAssignees: string[] } {
  const closed = rows.some((row) => row.status === "completed" && row.closed_without_cleaning);
  const share = roomShareState(rows.map((row) => ({ closed: Boolean(row.closed_without_cleaning), staffId: row.staff_user_id, status: row.status })), assignees);
  if (closed || cardStatus !== "done" || !share.partial) return { missingAssignees: [], partial: null };
  const live = new Set(rows.filter((row) => row.status !== "cancelled" && !row.closed_without_cleaning).map((row) => row.staff_user_id));
  return { missingAssignees: assignees.filter((id) => !live.has(id)), partial: { done: share.done, need: share.need } };
}

/**
 * 청소 기록을 닫을 때 쓰는 값 — 끝내기 · 취소 · 「청소했어요 / 못 했어요」가 모두 이 함수를 쓴다(C12).
 * **지난 날 기록은 소요 0초** — 며칠에 걸친 「지금 − 시작」을 넣으면 더하는 집계가 부풀려진다. 완료는 끝 = 시작(「끝낸 시각 모름」 표시),
 * 취소는 닫은 시각. DB check 제약: 완료 · 취소 모두 completed_at · duration_seconds 가 있어야 한다.
 */
export function sessionCloseFields(input: { cleaned: boolean; cleaningDate: string; today: string; startedAt: string; now: Date }): { completed_at: string; duration_seconds: number; status: "completed" | "cancelled" } {
  const status = input.cleaned ? "completed" : "cancelled";
  if (input.cleaningDate < input.today) {
    return { completed_at: input.cleaned ? input.startedAt : input.now.toISOString(), duration_seconds: 0, status };
  }
  return { completed_at: input.now.toISOString(), duration_seconds: Math.max(0, Math.round((input.now.getTime() - new Date(input.startedAt).getTime()) / 1000)), status };
}

/**
 * `/mobile/cleaning` 목록에서 시작한 방을 서버가 다시 확인(C13) — 지금 청소 · 셋팅 목록에 없으면(예약 취소 등) null, 있으면 그 목록의 종류.
 * 쉬는 계정 라벨도 같은 실제 방으로 본다. 수기 경로는 이 함수를 거치지 않는다(목록 밖 방 + 화면에서 고른 종류).
 */
export function cleaningListStart(
  targets: { cleaningList: readonly { sessionRoomLabel: string }[]; settingList: readonly { sessionRoomLabel: string }[] },
  roomLabel: string,
): { taskKey: "checkout" | "simple" } | null {
  const physical = physicalRoomKeyOfSessionLabel(roomLabel);
  const same = (target: { sessionRoomLabel: string }) => target.sessionRoomLabel === roomLabel || (physical !== null && physicalRoomKeyOfSessionLabel(target.sessionRoomLabel) === physical);
  if (targets.cleaningList.some(same)) return { taskKey: "checkout" };
  if (targets.settingList.some(same)) return { taskKey: "simple" };
  return null;
}

// ── 제안 입력(L4) ───────────────────────────────────────────────────────────────────────────────

/** 더 채울 인원 — 시작 전 · 미룸 · 처리 끝이 아닌 방만. */
export function needOf(room: Pick<AssignRoom, "status" | "deferredUntil" | "resolvedHold" | "usualHeadcount">, assigned: number): number {
  if (room.status !== "pending" || room.deferredUntil || room.resolvedHold) return 0;
  return Math.max(0, room.usualHeadcount - assigned);
}

/**
 * 하루 · 월 · 「고정 인력 먼저」 제안의 입력 — 같은 계산(C9 · L4). 이미 넣은 방도 몫에 넣고(목록에 없는 취소된 방은 일이 아니라 뺀다), 밀려 온 방 먼저.
 */
export function suggestInputsForDay(input: {
  rooms: readonly AssignRoom[];
  assignments: readonly { roomKey: string; propertyName: string; userId: string }[];
  people: readonly Omit<SuggestPerson, "loadToday" | "propertiesToday">[];
}): { suggestRooms: SuggestRoom[]; suggestPeople: SuggestPerson[] } {
  const byKey = new Map(input.rooms.map((room) => [room.roomKey, room]));
  const byRoom = new Map<string, string[]>();
  for (const row of input.assignments) byRoom.set(row.roomKey, [...(byRoom.get(row.roomKey) ?? []), row.userId]);
  const suggestRooms = input.rooms
    .map((room) => ({
      assigned: byRoom.get(room.roomKey) ?? [],
      need: needOf(room, byRoom.get(room.roomKey)?.length ?? 0),
      propertyName: room.propertyName,
      roomKey: room.roomKey,
      weight: roomWeight(room.usualHeadcount),
    }))
    .filter((room) => room.need > 0)
    .sort((a, b) => Number(Boolean(byKey.get(b.roomKey)!.carriedFrom)) - Number(Boolean(byKey.get(a.roomKey)!.carriedFrom)));
  const suggestPeople = input.people.map((person) => {
    const mine = input.assignments.filter((row) => row.userId === person.userId);
    return { ...person, loadToday: personLoad(mine, byKey), propertiesToday: [...new Set(mine.map((row) => row.propertyName))] };
  });
  return { suggestPeople, suggestRooms };
}

/** 한 사람의 그날 몫 — 목록에 있는 방의 무게 합. 취소된 방(목록 밖)은 뺀다. */
export function personLoad(rows: readonly { roomKey: string }[], roomByKey: ReadonlyMap<string, Pick<AssignRoom, "usualHeadcount">>): number {
  return rows.reduce((sum, row) => {
    const room = roomByKey.get(row.roomKey);
    return room ? sum + roomWeight(room.usualHeadcount) : sum;
  }, 0);
}

/** 관리자 직접 넣기 확인 창을 띄우나(L6) — 보통 인원 초과 또는 하루 몫 초과. 막지는 않는다. */
export function directAddWarning(room: { usualHeadcount: number; assignedCount: number }, personLoadNow: number): { overHeadcount: boolean; overCap: boolean } {
  return {
    overCap: overDailyCap(personLoadNow, roomWeight(room.usualHeadcount)),
    overHeadcount: room.assignedCount >= Math.max(1, room.usualHeadcount),
  };
}

/** 여러 명을 한 번에 넣을 때(방 추가 창 · 모바일 담당 넣기) — `directAddWarning` 과 같은 기준. `assignedCount` 는 넣기 전 인원(뺀 사람 제외). */
export function directAddWarnings(room: { usualHeadcount: number; assignedCount: number }, adds: readonly { name: string; load: number }[]): { overHeadcount: boolean; overCapNames: string[]; total: number } {
  const total = room.assignedCount + adds.length;
  return {
    overCapNames: adds.filter((person) => overDailyCap(person.load, roomWeight(room.usualHeadcount))).map((person) => person.name),
    overHeadcount: adds.length > 0 && total > Math.max(1, room.usualHeadcount),
    total,
  };
}

/** 교체 뒤 하루 몫을 넘는 사람(L6) — 새로 받는 방이 있는 사람만. `fromA` 는 A 가 내주는 방, `fromB` 는 B 가 내주는 방. */
export function swapOverCapNames(
  a: { name: string; load: number },
  b: { name: string; load: number },
  fromA: readonly { usualHeadcount: number }[],
  fromB: readonly { usualHeadcount: number }[],
): string[] {
  const weight = (list: readonly { usualHeadcount: number }[]) => list.reduce((sum, room) => sum + roomWeight(room.usualHeadcount), 0);
  return [
    ...(fromB.length > 0 && a.load - weight(fromA) + weight(fromB) > DAILY_CAP ? [a.name] : []),
    ...(fromA.length > 0 && b.load - weight(fromB) + weight(fromA) > DAILY_CAP ? [b.name] : []),
  ];
}
