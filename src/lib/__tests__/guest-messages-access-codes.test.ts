import { describe, expect, it } from "vitest";

import { accessCodesReducer, canSeeStaffCodes, conversationAccessCodes, pickRoomAccess, pickSingleRoomAccess, sameRoom, type AccessCodesView } from "@/lib/guest-messages/access-codes";
import type { PropertyAccessInfo, PropertyRoomCode } from "@/lib/property-map-links";

/**
 * 대화 「출입 번호」 규칙 한 곳 — 방 맞추기 · 볼 사람 · 이 대화 번호 목록. docs/product/47 §6-3 · Q9
 * 번호 값은 일부러 가짜(000000 …)만 쓴다.
 */

describe("sameRoom — 대화 방 라벨 ↔ 출입 코드 방 라벨", () => {
  it.each([
    ["Ab402", "Ab402", true],
    ["Ab402", "402", false],
    ["아라키초A 201", "201", true],
    ["아라키초A 201", "아라키초A 201", true],
    ["  201  ", "201", true],
    ["아라키초A 201", "202", false],
    ["아라키초A 201", "아라키초A", false],
    ["201", "2010", false],
    [null, "201", false],
    ["", "201", false],
    ["   ", "201", false],
    ["", "", false],
    ["   ", "", false],
    [null, "", false],
    ["201", " 201 ", true],
    ["아라키초A 201", "201 ", true],
    ["201_2", "201", true],
    ["401_2_2", "401", true],
    ["아라키초A 401_2_2", "401", true],
    ["202#", "202", true],
    ["202_2#", "202", true],
    ["K202", "202", true],
    ["k202", "202", true],
    ["K202#", "202", true],
    ["O101", "101", true],
    ["O101", "O101", true],
    ["o101", "O101", true],
    ["Ab402", "402", false],
    ["Ab402_2", "402", false],
    ["2", "2f", true],
    ["2", "2F", true],
    ["2f", "2", true],
    ["9_2", "9f", true],
    ["201", "202", false],
    ["2", "201", false],
    ["20", "201", false],
    ["201", "2f", false],
    ["2", "20f", false],
    ["201_2", "202", false],
    ["_2", "2", false],
    ["#", "", false],
    ["K", "202", false],
    ["K202", "K203", false],
    ["Ab101", "Ab102", false],
    ["201#_2", "201", false],
    ["201_", "201", false],
    ["201_2#", "201", true],
    ["아라키초A  201", "201", true],
    ["2f_2", "2", true],
  ] as const)("%s ↔ %s → %s", (conversation, code, expected) => {
    expect(sameRoom(conversation, code)).toBe(expected);
  });
});

describe("pickRoomAccess — 정확히 같은 라벨 먼저 · 손님용은 하나일 때만", () => {
  const item = (roomLabel: string, code: string) => ({ roomLabel, code });
  it("K202 대화 → 코드에 202 와 K202 가 같이 있으면 K202 것만", () => {
    expect(pickRoomAccess("K202", [item("202", "1"), item("K202", "2")]).map((r) => r.code)).toEqual(["2"]);
  });
  it("대화 2 → 코드 2 와 2f 중 2 것만", () => {
    expect(pickRoomAccess("2", [item("2f", "1"), item("2", "2")]).map((r) => r.code)).toEqual(["2"]);
  });
  it("정확한 것이 없으면 느슨한 규칙으로", () => {
    expect(pickRoomAccess("201_2", [item("201", "1"), item("202", "2")]).map((r) => r.code)).toEqual(["1"]);
  });
  it("손님용: 하나면 그 항목, 느슨한 후보가 둘이면 못 찾음, 없어도 못 찾음", () => {
    expect(pickSingleRoomAccess("201_2", [item("201", "1")])?.code).toBe("1");
    expect(pickSingleRoomAccess("201_2", [item("201", "1"), item("201", "2")])).toBeNull();
    expect(pickSingleRoomAccess("301", [item("201", "1")])).toBeNull();
  });
  it("직원용 목록: 202 와 K202 가 같이 있어도 K202 대화엔 K202 것만", () => {
    const rooms = [item("202", "1111"), item("K202", "2222")];
    expect(conversationAccessCodes({ sharedAccess: [], roomAccess: rooms }, "K202", { shared: () => "", room: (l) => l }).map((c) => c.code)).toEqual(["2222"]);
  });
});

describe("canSeeStaffCodes — manage 또는 property_info.edit 만(Q9)", () => {
  it.each([
    [["guest_messages.view", "guest_messages.reply"], false],
    [["guest_messages.view"], false],
    [[], false],
    [["guest_messages.view", "guest_messages.manage"], true],
    [["guest_messages.view", "property_info.edit"], true],
  ] as const)("%j → %s", (caps, expected) => {
    expect(canSeeStaffCodes(caps)).toBe(expected);
  });
});

describe("conversationAccessCodes — 공용 번호 + 이 방 번호", () => {
  const shared: PropertyAccessInfo[] = [
    { labelKey: "doorPassword", code: "000000" },
    { labelKey: "keyBox", code: "   " },
    { labelKey: "storagePassword", code: "111111", prefixKey: "floor1" },
  ];
  const rooms: PropertyRoomCode[] = [
    { roomLabel: "201", code: "222222" },
    { roomLabel: "202", code: "333333" },
    { roomLabel: "203", code: "" },
  ];
  const labels = {
    shared: (access: PropertyAccessInfo) => `S:${access.labelKey}${access.prefixKey ? `@${access.prefixKey}` : ""}`,
    room: (roomLabel: string) => `R:${roomLabel}`,
  };

  it("빈 번호는 빼고, 다른 방 번호는 넣지 않는다 — 공용 먼저 · 방은 뒤", () => {
    expect(conversationAccessCodes({ sharedAccess: shared, roomAccess: rooms }, "아라키초A 201", labels)).toEqual([
      { kind: "shared", label: "S:doorPassword", code: "000000" },
      { kind: "shared", label: "S:storagePassword@floor1", code: "111111" },
      { kind: "room", label: "R:201", code: "222222" },
    ]);
  });

  it.each([["201_2"], ["201_2_2"], ["아라키초A 201_2"]])("변형 라벨 %s 도 201 방 번호가 나온다", (room) => {
    expect(conversationAccessCodes({ sharedAccess: [], roomAccess: rooms }, room, labels)).toEqual([
      { kind: "room", label: "R:201", code: "222222" },
    ]);
  });

  it("K202 → 202 · 2 → 2f 방 번호가 나온다", () => {
    expect(conversationAccessCodes({ sharedAccess: [], roomAccess: rooms }, "K202", labels)).toEqual([
      { kind: "room", label: "R:202", code: "333333" },
    ]);
    const floors: PropertyRoomCode[] = [
      { roomLabel: "2f", code: "4444" },
      { roomLabel: "3f", code: "5555" },
    ];
    expect(conversationAccessCodes({ sharedAccess: [], roomAccess: floors }, "2", labels)).toEqual([
      { kind: "room", label: "R:2f", code: "4444" },
    ]);
  });

  it("방 라벨이 없으면 공용 번호만", () => {
    expect(conversationAccessCodes({ sharedAccess: shared, roomAccess: rooms }, null, labels).map((c) => c.kind)).toEqual(["shared", "shared"]);
  });

  it("맞는 방이 있어도 번호가 비었으면 빠진다", () => {
    expect(conversationAccessCodes({ sharedAccess: [], roomAccess: rooms }, "203", labels)).toEqual([]);
  });

  it("건물을 모르면 빈 목록", () => {
    expect(conversationAccessCodes(null, "201", labels)).toEqual([]);
  });
});

describe("accessCodesReducer — 늦게 온 답 · 숨기기", () => {
  const codes = [{ kind: "shared" as const, label: "L", code: "000000" }];
  const hidden: AccessCodesView = { status: "hidden", request: 0 };

  it("보기 → 답 → 번호가 보인다", () => {
    const loading = accessCodesReducer(hidden, { type: "start" });
    expect(loading).toEqual({ status: "loading", request: 1 });
    expect(accessCodesReducer(loading, { type: "settle", request: 1, result: { ok: true, codes } })).toEqual({ status: "shown", request: 1, codes });
  });

  it("답이 오기 전에 숨기면 늦게 온 번호는 버린다", () => {
    const loading = accessCodesReducer(hidden, { type: "start" });
    const closed = accessCodesReducer(loading, { type: "hide" });
    expect(closed.status).toBe("hidden");
    const late = accessCodesReducer(closed, { type: "settle", request: 1, result: { ok: true, codes } });
    expect(late).toEqual(closed);
    expect(JSON.stringify(late)).not.toContain("000000");
  });

  it("숨겼다 다시 보기를 눌러도 앞선 요청의 답은 버린다", () => {
    let view = accessCodesReducer(hidden, { type: "start" });
    view = accessCodesReducer(view, { type: "hide" });
    view = accessCodesReducer(view, { type: "start" });
    expect(accessCodesReducer(view, { type: "settle", request: 1, result: { ok: true, codes } }).status).toBe("loading");
  });

  it("start → start: 첫 요청 답은 무시, 둘째 답만 반영", () => {
    const fake = [{ kind: "room" as const, label: "L", code: "fake-code" }];
    let view = accessCodesReducer(hidden, { type: "start" });
    view = accessCodesReducer(view, { type: "start" });
    expect(view).toEqual({ status: "loading", request: 2 });
    view = accessCodesReducer(view, { type: "settle", request: 1, result: { ok: true, codes: fake } });
    expect(view).toEqual({ status: "loading", request: 2 });
    view = accessCodesReducer(view, { type: "settle", request: 2, result: { ok: true, codes: fake } });
    expect(view).toEqual({ status: "shown", request: 2, codes: fake });
  });

  it("forbidden 은 권한 없음, 나머지 실패는 다시 시도", () => {
    const loading = accessCodesReducer(hidden, { type: "start" });
    expect(accessCodesReducer(loading, { type: "settle", request: 1, result: { ok: false, errorKey: "forbidden" } })).toEqual({ status: "forbidden", request: 1 });
    for (const errorKey of ["not_found", "invalid", "failed"] as const) {
      expect(accessCodesReducer(loading, { type: "settle", request: 1, result: { ok: false, errorKey } })).toEqual({ status: "failed", request: 1 });
    }
    expect(accessCodesReducer(loading, { type: "settle", request: 1, result: null })).toEqual({ status: "failed", request: 1 });
  });
});
