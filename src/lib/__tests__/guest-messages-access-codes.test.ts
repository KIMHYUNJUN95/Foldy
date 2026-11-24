import { describe, expect, it } from "vitest";

import { accessCodesReducer, canSeeStaffCodes, conversationAccessCodes, sameRoom, type AccessCodesView } from "@/lib/guest-messages/access-codes";
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
  ] as const)("%s ↔ %s → %s", (conversation, code, expected) => {
    expect(sameRoom(conversation, code)).toBe(expected);
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
