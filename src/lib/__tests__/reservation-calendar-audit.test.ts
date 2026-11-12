import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decideCalendarDeepLink } from "@/lib/calendar-deep-link";
import { assignLanes } from "@/lib/calendar-lanes";
import { PROPERTY_MAP_META } from "@/lib/property-map-links";
import {
  classifyPropertyInfoReadError,
  mergePropertyMapMeta,
  validatePropertyInfoInput,
} from "@/lib/property-operation-info-rules";
import { getReservationDisplayId } from "@/lib/reservation-display-id";
import {
  classifyNoteDbError,
  isNoteChanged,
  NoteSaveTracker,
  pickLatestNote,
  planReservationNoteWrite,
  pruneSavedNotes,
  reconcileNoteDrafts,
  validateExpectedUpdatedAt,
  validateNoteInput,
} from "@/lib/reservation-note-sync";
import { resolveRoomBlockRoom } from "@/lib/room-block-room";
import { buildGlobalExternalRoomToCanonical, buildPropertyRoomLookups, type ActiveRoomCatalogItem } from "@/lib/rooms";
import { msUntilNextTokyoMidnight } from "@/lib/tokyo-date";
import { occupiedRoomsOn, splitVacantRooms } from "@/lib/vacant-rooms";

// 2026-11-12 예약 캘린더 점검 — 고친 규칙마다 회귀 테스트.

describe("내부 메모 — 바뀐 것만 저장 · 조건부 쓰기", () => {
  const server = { note: "청소 늦게", updatedAt: "2026-11-12T01:00:00.000000+00:00" };

  it("칸을 떠나도 값이 같으면 저장하지 않는다(앞뒤 공백 무시)", () => {
    expect(isNoteChanged("청소 늦게", server)).toBe(false);
    expect(isNoteChanged("  청소 늦게 ", server)).toBe(false);
    expect(isNoteChanged("", undefined)).toBe(false);
    expect(isNoteChanged("새 메모", server)).toBe(true);
    expect(isNoteChanged("", server)).toBe(true);
  });

  it("버전 없음 + 빈 값은 아무것도 안 한다 — 빈 칸으로 남의 메모를 지우지 않는다", () => {
    expect(planReservationNoteWrite({ note: "  ", expectedUpdatedAt: null })).toBe("noop");
    expect(planReservationNoteWrite({ note: "a", expectedUpdatedAt: null })).toBe("insert");
    expect(planReservationNoteWrite({ note: "a", expectedUpdatedAt: server.updatedAt })).toBe("update");
    expect(planReservationNoteWrite({ note: "", expectedUpdatedAt: server.updatedAt })).toBe("delete");
  });

  it("DB 오류는 코드로만 — RLS 거절은 forbidden, 고유 키 충돌은 conflict", () => {
    expect(classifyNoteDbError("42501")).toBe("forbidden");
    expect(classifyNoteDbError("23505")).toBe("conflict");
    expect(classifyNoteDbError("08006")).toBe("save_failed");
    expect(classifyNoteDbError(undefined)).toBe("save_failed");
  });

  it("입력 검사 — 문자열 · 2,000자 · 버전 형식", () => {
    expect(validateNoteInput(" a ")).toEqual({ ok: true, note: "a" });
    expect(validateNoteInput(5)).toEqual({ ok: false, error: "invalid_note" });
    expect(validateNoteInput("x".repeat(2001))).toEqual({ ok: false, error: "note_too_long" });
    expect(validateExpectedUpdatedAt(null)).toBeNull();
    expect(validateExpectedUpdatedAt(server.updatedAt)).toBe(server.updatedAt);
    expect(validateExpectedUpdatedAt("not-a-date")).toBeUndefined();
    expect(validateExpectedUpdatedAt(undefined)).toBeUndefined();
  });

  it("새 서버 값이 와도 고치던 칸은 그대로, 서버와 같아진 칸은 정리", () => {
    const drafts = { a: "내가 고치는 중", b: "저장 끝남" };
    const next = reconcileNoteDrafts(drafts, {
      a: { note: "다른 사람 값", updatedAt: "x" },
      b: { note: "저장 끝남", updatedAt: "y" },
    });
    expect(next).toEqual({ a: "내가 고치는 중" });
  });
});

describe("내부 메모 — 늦게 온 옛 읽기가 방금 저장한 값을 되돌리지 않는다", () => {
  const t1 = "2026-11-12T01:00:00.000000+00:00";
  const t2 = "2026-11-12T02:00:00.000000+00:00";
  it("저장 값이 더 새것이면 저장 값, 서버가 따라오면 서버 값", () => {
    expect(pickLatestNote({ note: "옛", updatedAt: t1 }, { note: "새", updatedAt: t2 })).toEqual({ note: "새", updatedAt: t2 });
    expect(pickLatestNote({ note: "새", updatedAt: t2 }, { note: "새", updatedAt: t2 })).toEqual({ note: "새", updatedAt: t2 });
    expect(pickLatestNote(undefined, undefined)).toEqual({ note: "", updatedAt: null });
  });
  it("지운 메모는 옛 읽기로 되살아나지 않고, 그 뒤 누가 새로 쓰면 그 값", () => {
    const deleted = { note: "", updatedAt: null, supersedes: t1 };
    expect(pickLatestNote({ note: "옛", updatedAt: t1 }, deleted)).toEqual({ note: "", updatedAt: null });
    expect(pickLatestNote({ note: "남이 새로", updatedAt: t2 }, deleted)).toEqual({ note: "남이 새로", updatedAt: t2 });
  });
});

describe("새 서버 묶음이 오면 서버가 정답 — 남이 지운 메모가 남지 않는다", () => {
  const t1 = "2026-11-12T01:00:00.000000+00:00";
  const t2 = "2026-11-12T02:00:00.000000+00:00";
  it("내가 저장한 v2 를 남이 지우면(서버에 없음) 버린다", () => {
    expect(pruneSavedNotes({ a: { note: "내 v2", updatedAt: t2, supersedes: t1 } }, {})).toEqual({});
  });
  it("서버가 따라왔거나 더 새것이면 버리고, 분명히 옛 읽기면 남긴다", () => {
    const saved = { a: { note: "내 v2", updatedAt: t2, supersedes: t1 } };
    expect(pruneSavedNotes(saved, { a: { note: "내 v2", updatedAt: t2 } })).toEqual({});
    expect(pruneSavedNotes(saved, { a: { note: "옛", updatedAt: t1 } })).toEqual(saved);
  });
  it("내가 지운 메모 — 지우기 전 버전을 든 옛 읽기면 남기고, 서버에도 없으면 버린다", () => {
    const deleted = { a: { note: "", updatedAt: null, supersedes: t1 } };
    expect(pruneSavedNotes(deleted, { a: { note: "옛", updatedAt: t1 } })).toEqual(deleted);
    expect(pruneSavedNotes(deleted, {})).toEqual({});
    expect(pruneSavedNotes(deleted, { a: { note: "남이 새로", updatedAt: t2 } })).toEqual({});
  });
});

describe("저장 진행 표시 — 보내는 중 두 번째 요청은 줄 세운다", () => {
  it("begin 은 한 번만, 보내는 중엔 queue, 끝난 뒤 takeQueued 한 번", () => {
    const tracker = new NoteSaveTracker();
    expect(tracker.begin("a")).toBe(true);
    expect(tracker.begin("a")).toBe(false);
    tracker.queue("a");
    tracker.setDraft("a", "더 쓴 글");
    expect(tracker.takeQueued("a")).toBe(true);
    expect(tracker.takeQueued("a")).toBe(false);
    expect(tracker.draft("a")).toBe("더 쓴 글");
    tracker.clearDraftIf("a", " 더 쓴 글 ");
    expect(tracker.draft("a")).toBeUndefined();
    tracker.end("a");
    expect(tracker.isInflight("a")).toBe(false);
  });
});

describe("건물 운영 정보 — 읽기 오류 · 지운 코드", () => {
  const base = PROPERTY_MAP_META.find((item) => item.canonicalName === "아라키초A")!;

  it("코드 기본값으로 물러서는 건 표가 없을 때뿐", () => {
    expect(classifyPropertyInfoReadError({ code: "42P01" })).toBe("missing_table");
    expect(classifyPropertyInfoReadError({ code: "PGRST205" })).toBe("missing_table");
    // 예전엔 메시지에 표 이름만 있어도 기본값(옛 출입 코드)을 보였다.
    expect(
      classifyPropertyInfoReadError({ code: "42501", message: 'permission denied for table property_operation_infos' }),
    ).toBe("failed");
    expect(classifyPropertyInfoReadError({ code: "57014", message: "timeout" })).toBe("failed");
  });

  it("출입 코드를 전부 지우고 저장하면 비어 있는 채로 남는다(기본값이 되살아나지 않는다)", () => {
    const checked = validatePropertyInfoInput(base, {
      address: base.address,
      note: "",
      roomAccess: (base.roomAccess ?? []).map((room) => ({ ...room, code: "" })),
      sharedAccess: base.sharedAccess.map((access) => ({ ...access, code: "" })),
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const merged = mergePropertyMapMeta(base, {
      canonical_name: base.canonicalName,
      address_ko: checked.value.address_ko,
      address_ja: checked.value.address_ja,
      address_en: checked.value.address_en,
      note: checked.value.note,
      room_access: checked.value.room_access,
      shared_access: checked.value.shared_access,
      updated_at: "2026-11-12T00:00:00+00:00",
    });
    expect(merged.sharedAccess.every((access) => access.code === "")).toBe(true);
    expect(merged.roomAccess?.every((room) => room.code === "")).toBe(true);
    expect(merged.roomAccess?.length).toBe(base.roomAccess?.length);
    expect(merged.updatedAt).toBe("2026-11-12T00:00:00+00:00");
  });

  it("빈 목록으로 저장해도 빈 목록, 저장된 줄이 없으면 기본값", () => {
    const merged = mergePropertyMapMeta(base, {
      canonical_name: base.canonicalName,
      address_ko: null,
      address_ja: null,
      address_en: null,
      note: null,
      room_access: [],
      shared_access: [],
    });
    expect(merged.roomAccess).toEqual([]);
    expect(merged.sharedAccess).toEqual([]);
    expect(merged.address.ko).toBe(base.address.ko);
    expect(mergePropertyMapMeta(base).roomAccess).toEqual(base.roomAccess);
    expect(mergePropertyMapMeta(base).updatedAt).toBeNull();
  });

  it("너무 긴 값은 거른다", () => {
    expect(validatePropertyInfoInput(base, { ...base, note: "x".repeat(2001) })).toEqual({ ok: false, error: "too_long" });
    expect(
      validatePropertyInfoInput(base, { ...base, sharedAccess: [{ labelKey: "storage", code: "1".repeat(101) }] }),
    ).toEqual({ ok: false, error: "too_long" });
  });
});

describe("차단 → 방 해석기(모바일 · PC 공용)", () => {
  const catalog: ActiveRoomCatalogItem[] = [
    { canonicalRoomLabel: "402", displayRoomLabel: "402", externalRoomId: "9001", propertyName: "아라키초A", propertyId: "p", roomId: "r1", roomLabel: "402" },
    { canonicalRoomLabel: "402_2", displayRoomLabel: "402", externalRoomId: "9002", propertyName: "아라키초A", propertyId: "p", roomId: "r2", roomLabel: "402_2" },
    { canonicalRoomLabel: "201", displayRoomLabel: "201", externalRoomId: "9003", propertyName: "아라키초A", propertyId: "p", roomId: "r3", roomLabel: "201" },
  ];
  const context = {
    globalExternalRoomToCanonical: buildGlobalExternalRoomToCanonical(catalog),
    isAuthoritative: true,
    lookups: buildPropertyRoomLookups(catalog),
  };

  it("Beds24 객실 id 를 먼저 본다 — 이름이 달라도 그 방", () => {
    const resolved = resolveRoomBlockRoom({ external_room_id: "9003", property_name: "아라키초A", room_label: "이상한 이름" }, context);
    expect(resolved).toEqual({ canonicalRoomLabel: "201", displayRoomLabel: "201", propertyName: "아라키초A" });
  });

  it("id 가 없거나 모르는 id 면 방 이름으로, 하위 호실은 한 행으로", () => {
    expect(resolveRoomBlockRoom({ external_room_id: null, property_name: "아라키초A", room_label: "402_2" }, context).displayRoomLabel).toBe("402");
    expect(resolveRoomBlockRoom({ external_room_id: "nope", property_name: "아라키초A", room_label: "201" }, context).canonicalRoomLabel).toBe("201");
  });
});

describe("빈 방 — 예약도 차단도 없는 방(정의 하나)", () => {
  it("차단된 방은 빈 방으로 세지 않고 따로 모은다", () => {
    const occupied = occupiedRoomsOn(
      [
        { checkInDate: "2026-11-10", checkOutDate: "2026-11-12", room: "201" },
        { checkInDate: "2026-11-12", checkOutDate: "2026-11-13", room: "202" },
      ],
      "2026-11-12",
      (stay) => stay.room,
    );
    expect([...occupied]).toEqual(["202"]);
    const split = splitVacantRooms(["201", "202", "301"], occupied, new Set(["301"]));
    expect(split).toEqual({ vacant: ["201"], blockedEmpty: ["301"] });
  });
});

describe("예약 번호 — 두 화면 같은 값", () => {
  it("Beds24 예약 번호(bookId) 먼저, 없으면 저장 번호에서 객실 꼬리표를 뗀 값", () => {
    expect(getReservationDisplayId({ raw_payload: { apiReference: "HMABC", bookId: 123 }, source_reservation_id: "123" })).toBe("123");
    expect(getReservationDisplayId({ raw_payload: null, source_reservation_id: "555" })).toBe("555");
  });
});

describe("레인 — 겹치는 예약은 아래 줄로", () => {
  it("겹치면 줄을 나누고, 같은 날 교체(퇴실=입실)는 같은 줄", () => {
    const { placed, laneCount } = assignLanes(
      [
        { id: "a", s: 0.5, e: 3.5 },
        { id: "b", s: 1.5, e: 2.5 },
        { id: "c", s: 3.5, e: 5.5 },
      ],
      (item) => ({ start: item.s, end: item.e }),
    );
    const lane = Object.fromEntries(placed.map((entry) => [entry.item.id, entry.lane]));
    expect(lane).toEqual({ a: 0, b: 1, c: 0 });
    expect(laneCount).toBe(2);
    expect(assignLanes([], () => ({ start: 0, end: 1 })).laneCount).toBe(1);
  });
});

describe("도쿄 자정까지 남은 시간", () => {
  it("도쿄 23:59:30 → 30초, 도쿄 자정 직후 → 거의 하루", () => {
    expect(msUntilNextTokyoMidnight(new Date("2026-11-12T23:59:30+09:00"))).toBe(30_000);
    expect(msUntilNextTokyoMidnight(new Date("2026-11-13T00:00:00+09:00"))).toBe(86_400_000);
    // UTC 날짜가 하루 앞서 있어도(UTC 15:00 = 도쿄 다음 날 0시) 도쿄 기준.
    expect(msUntilNextTokyoMidnight(new Date("2026-11-12T14:00:00Z"))).toBe(3_600_000);
  });
});


describe("모바일 딥링크 — 그 예약의 달 · 건물로, 못 열면 이유", () => {
  const base = { currentMonth: "2026-11", excluded: false, nextMonth: "2026-12" };
  const stay = { checkInDate: "2026-12-03", checkOutDate: "2026-12-05", propertyName: "아라키초A", status: "confirmed" };

  it("창 안이면 체크인 달 · 건물로 연다", () => {
    expect(decideCalendarDeepLink({ ...base, reservation: stay })).toEqual({ kind: "open", month: "2026-12", property: "아라키초A" });
  });
  it("지난달 체크인 · 이번 달까지 묵으면 이번 달", () => {
    expect(
      decideCalendarDeepLink({ ...base, reservation: { ...stay, checkInDate: "2026-10-30", checkOutDate: "2026-11-02" } }),
    ).toEqual({ kind: "open", month: "2026-11", property: "아라키초A" });
  });
  it("못 여는 경우는 이유를 준다", () => {
    expect(decideCalendarDeepLink({ ...base, reservation: null })).toEqual({ kind: "notice", reason: "not_found" });
    expect(decideCalendarDeepLink({ ...base, reservation: { ...stay, status: "cancelled" } })).toEqual({ kind: "notice", reason: "cancelled" });
    expect(decideCalendarDeepLink({ ...base, reservation: { ...stay, status: "no_show" } })).toEqual({ kind: "notice", reason: "cancelled" });
    expect(decideCalendarDeepLink({ ...base, excluded: true, reservation: stay })).toEqual({ kind: "notice", reason: "no_property" });
    expect(decideCalendarDeepLink({ ...base, reservation: { ...stay, checkInDate: "2027-01-02", checkOutDate: "2027-01-04" } })).toEqual({
      kind: "notice",
      reason: "out_of_window",
    });
    expect(decideCalendarDeepLink({ ...base, reservation: { ...stay, checkInDate: "2026-09-02", checkOutDate: "2026-09-04" } })).toEqual({
      kind: "notice",
      reason: "out_of_window",
    });
  });
});
